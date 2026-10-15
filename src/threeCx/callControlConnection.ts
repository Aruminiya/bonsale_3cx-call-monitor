import WebSocket from 'ws';
import { env } from '@/config/env';
import { logger } from '@/shared/logger';
import { describeError, getAccessToken, threeCx } from '@/threeCx/client';
import {
  CallControlState,
  isParticipantEntity,
  type Participant,
  type ParticipantChange,
  type SnapshotEntry,
} from '@/threeCx/state';

// 常駐的 3CX Call Control WebSocket 連線：啟動就連、斷線自動重連，一直連著。
// 跟 3cx-report 的 src/lib/threeCx/callControl/connection.ts 同一套做法，差別是這裡
// 沒有「有人在看才連」——自動化要 24 小時都收得到事件。

const PING_INTERVAL_MS = 30_000; // 3CX 閒置 60 秒會斷線（code 1006），每 30 秒 ping 一次維持（已實測有效）
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export type ConnectionStatus = {
  connected: boolean;
  lastError: string | null;
  connectedAt: string | null;
  lastEventAt: string | null;
};

type Options = {
  // 每次通話腿真的有變化時呼叫（快照重建不會呼叫，見 CallControlState.applySnapshot）。
  onChange: (change: ParticipantChange) => void;
};

// 事件處理排隊：GET entity 一定要依序做，不然多個 GET 同時在飛、回來的順序不固定，
// 舊的內容會蓋掉新的。Remove 也排進同一條隊伍，不能插隊。
type QueueItem = { kind: 'snapshot' } | { kind: 'upsert'; entity: string } | { kind: 'remove'; entity: string };

export class CallControlConnection {
  private ws: WebSocket | null = null;
  // 連線的序號：每建立一條新連線就 +1。舊連線的事件、晚回來的 GET 用它判斷「已過期」直接丟掉。
  private generation = 0;
  private readonly state = new CallControlState();
  private queue: QueueItem[] = [];
  private draining = false;
  private reconnectDelay = RECONNECT_MIN_MS;
  private needsFreshToken = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly status: ConnectionStatus = { connected: false, lastError: null, connectedAt: null, lastEventAt: null };

  constructor(private readonly options: Options) {}

  getStatus(): ConnectionStatus {
    return { ...this.status };
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  // 程式結束（SIGTERM）時呼叫：關掉連線、不再重連。
  stop(): void {
    this.stopped = true;
    this.generation++;
    this.clearTimers();
    this.ws?.removeAllListeners();
    this.ws?.close();
    this.ws = null;
  }

  // ---- 連線生命週期 ----

  private async connect(): Promise<void> {
    const generation = ++this.generation;
    this.queue = [];

    let token: string;
    try {
      token = await getAccessToken({ forceRefresh: this.needsFreshToken });
      this.needsFreshToken = false;
    } catch (error) {
      this.failAndRetry(generation, `取得 3CX token 失敗：${describeError(error)}`);
      return;
    }
    if (generation !== this.generation) return;

    const url = `${env.pbxUrl.replace(/^http/, 'ws')}/callcontrol/ws`;
    logger.info(`🔌 連線 3CX Call Control ${url}`);
    // 3CX 要在握手的 HTTP header 帶 Bearer token，所以用 ws 套件。
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
    this.ws = ws;

    ws.on('open', () => {
      if (generation !== this.generation) return;
      logger.info('✅ WebSocket 連線成功，取得快照中');
      this.reconnectDelay = RECONNECT_MIN_MS;
      this.pingTimer = setInterval(() => ws.ping(), PING_INTERVAL_MS);
      // 快照排在隊伍最前面：之後收到的事件都在快照套用完才處理。
      this.enqueue(generation, { kind: 'snapshot' });
    });

    // 握手被拒（例如 401）時走這裡，不會觸發 open。
    ws.on('unexpected-response', (_request, response) => {
      if (generation !== this.generation) return;
      if (response.statusCode === 401) this.needsFreshToken = true;
      ws.terminate();
      this.failAndRetry(generation, `3CX 拒絕連線（HTTP ${response.statusCode}）`);
    });

    ws.on('message', (raw) => {
      if (generation !== this.generation) return;
      let message: { event?: { event_type?: number; entity?: string } };
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const entity = message.event?.entity;
      // 只處理 participant（通話腿）；devices 之類的其他 entity 跟通話狀態無關。
      if (typeof entity !== 'string' || !isParticipantEntity(entity)) return;
      this.status.lastEventAt = new Date().toISOString();
      if (message.event?.event_type === 0) this.enqueue(generation, { kind: 'upsert', entity });
      if (message.event?.event_type === 1) this.enqueue(generation, { kind: 'remove', entity });
    });

    ws.on('close', (code) => {
      if (generation !== this.generation) return;
      this.failAndRetry(generation, `連線中斷（code ${code}）`);
    });

    ws.on('error', (error) => {
      // 之後一定會接著觸發 close 或 unexpected-response，重連在那邊處理。
      logger.warn(`WebSocket 錯誤：${error.message}`);
    });
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  // 連線失敗或中斷：拆掉這條連線，指數退避（1s、2s、4s…最多 30s）後重連。
  // ⚠️ 斷線期間 3CX 的事件不會補送，這段時間開始又結束的通話會收不到（見 docs/README.md）。
  private failAndRetry(generation: number, reason: string): void {
    if (generation !== this.generation) return;
    this.generation++;
    this.clearTimers();
    this.ws?.removeAllListeners();
    this.ws?.terminate();
    this.ws = null;
    this.status.connected = false;
    this.status.lastError = reason;
    if (this.stopped) return;

    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    logger.warn(`${reason}，${delay / 1000} 秒後重連`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  // ---- 事件處理隊伍 ----

  private enqueue(generation: number, item: QueueItem): void {
    if (generation !== this.generation) return;
    // 同一個 entity 已經在排隊等 GET，再排一次只會拿到一樣的結果，合併掉。
    if (item.kind === 'upsert' && this.queue.some((q) => q.kind === 'upsert' && q.entity === item.entity)) return;
    // 要移除了，排在前面還沒跑的 Upsert GET 沒有意義（只會拿到 403）。
    if (item.kind === 'remove') {
      this.queue = this.queue.filter((q) => !(q.kind === 'upsert' && q.entity === item.entity));
    }
    this.queue.push(item);
    void this.drain(generation);
  }

  // 一次只處理一件：draining 是一把簡單的鎖。Node 是單執行緒，檢查和上鎖之間沒有 await，
  // 不會有別人插進來。
  private async drain(generation: number): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && generation === this.generation) {
        await this.processItem(generation, this.queue.shift()!);
      }
    } finally {
      this.draining = false;
    }
    if (this.queue.length > 0 && generation !== this.generation) void this.drain(this.generation);
  }

  private async processItem(generation: number, item: QueueItem): Promise<void> {
    if (item.kind === 'snapshot') {
      try {
        const response = await threeCx.get<SnapshotEntry[]>('/callcontrol');
        if (generation !== this.generation) return;
        this.state.applySnapshot(response.data);
        this.status.connected = true;
        this.status.lastError = null;
        this.status.connectedAt = new Date().toISOString();
        const dns = response.data.filter((entry) => entry.type !== 'Wroutepoint').map((entry) => entry.dn);
        logger.info(`📸 快照完成：被監控 DN ${dns.length} 個（${dns.join(', ') || '無'}）、通話腿 ${this.state.size} 條`);
        if (dns.length === 0) logger.warn('監控清單是空的：到 3CX 這個 API 應用的 Extensions to monitor 加入分機');
      } catch (error) {
        this.failAndRetry(generation, `取得快照失敗：${describeError(error)}`);
      }
      return;
    }

    if (item.kind === 'remove') {
      this.emit(this.state.applyRemove(item.entity));
      return;
    }

    try {
      const response = await threeCx.get<Participant>(item.entity);
      if (generation !== this.generation) return;
      this.emit(this.state.applyUpsert(item.entity, response.data));
    } catch (error) {
      // entity 已經不存在（掛斷了、Remove 事件還在路上）時 3CX 回 403，當成移除。
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 403 || status === 404) {
        this.emit(this.state.applyRemove(item.entity));
        return;
      }
      logger.warn(`GET ${item.entity} 失敗：${describeError(error)}`);
    }
  }

  private emit(change: ParticipantChange | null): void {
    if (!change) return;
    const leg = change.kind === 'upserted' ? change.current : change.last;
    const transition =
      change.kind === 'upserted' ? `${change.previous?.status ?? '(新)'} → ${change.current.status}` : '已移除';
    logger.info(`📞 分機 ${leg.dn} 通話 ${leg.callid}：${transition}（對方 ${leg.party_caller_id || leg.party_dn || '-'}）`);
    try {
      this.options.onChange(change);
    } catch (error) {
      // 觸發邏輯出錯不能拖垮連線與事件隊伍。
      logger.error(`處理通話變化時發生錯誤：${describeError(error)}`);
    }
  }
}
