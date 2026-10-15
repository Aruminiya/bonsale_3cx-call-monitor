// 記憶體裡的通話腿（participant）表，以及每次變化「從什麼變成什麼」。
// 純資料操作、不碰網路，方便拿實際事件 log 單獨驗證。

// GET /callcontrol/{dn}/participants/{id} 回來的內容，只列用得到的欄位
// （實測格式見 TEST_3cx-call-control/doc/01-websocket-events.md）。
export type Participant = {
  id: number;
  status: string; // 實測看過 Dialing、Connected
  dn: string; // 被監控的 DN（這條腿屬於誰）
  party_dn?: string; // 對方 DN；外線時是 trunk（例如 10000）
  party_dn_type?: string; // 例如 Wexternalline、Wextension、Wqueue
  party_caller_id?: string; // 對方號碼
  party_caller_name?: string;
  callid: number; // 同一通電話的每條腿都一樣
  legid?: number;
};

// GET /callcontrol 快照的一筆：一個被監控的 DN 跟它身上目前的 participants。
export type SnapshotEntry = { dn: string; type: string; participants?: Participant[] };

// 一次變化。觸發判斷（triggers/）靠 previous / current 判斷「狀態轉換」，
// 例如 previous.status = Dialing、current.status = Connected → 剛接通。
export type ParticipantChange =
  | { kind: 'upserted'; entity: string; previous: Participant | null; current: Participant }
  | { kind: 'removed'; entity: string; last: Participant };

const PARTICIPANT_PATH = /^\/callcontrol\/([^/]+)\/participants\/(\d+)$/;

export function isParticipantEntity(entity: string): boolean {
  return PARTICIPANT_PATH.test(entity);
}

export function participantEntity(dn: string, id: number): string {
  return `/callcontrol/${encodeURIComponent(dn)}/participants/${id}`;
}

export class CallControlState {
  // entity 路徑 → participant。Remove 之後再 GET 只會 403，最後狀態只能靠這裡記住。
  private readonly participants = new Map<string, Participant>();

  get size(): number {
    return this.participants.size;
  }

  // (重)連線時的快照：整個重建，不產生任何 change。
  // 快照不能當成事件——重連時進行中的通話會再出現一次，當成事件的話每次重連都會重複觸發。
  applySnapshot(entries: SnapshotEntry[]): void {
    this.participants.clear();
    for (const entry of entries) {
      for (const participant of entry.participants ?? []) {
        this.participants.set(participantEntity(entry.dn, participant.id), participant);
      }
    }
  }

  // 內容跟上次一樣（3CX 同一瞬間常連發好幾個 Upsert）回 null，不算變化。
  applyUpsert(entity: string, current: Participant): ParticipantChange | null {
    const previous = this.participants.get(entity) ?? null;
    this.participants.set(entity, current);
    if (previous && JSON.stringify(previous) === JSON.stringify(current)) return null;
    return { kind: 'upserted', entity, previous, current };
  }

  applyRemove(entity: string): ParticipantChange | null {
    const last = this.participants.get(entity);
    if (!last) return null;
    this.participants.delete(entity);
    return { kind: 'removed', entity, last };
  }
}
