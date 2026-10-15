import { submitWorkOrder } from '@/bonsale/workOrderApi';
import type { Trigger } from '@/triggers/detectTriggers';

// 最近送過的 key，擋掉同一個觸發在短時間內被偵測到好幾次（例如重連前後各看到一次）。
// 只放記憶體、重啟就清空，所以這只是第一道防線；真正保證「只填一次」要靠後端用 key 做冪等。
const RECENT_KEY_TTL_MS = 60 * 60 * 1000;
const recentKeys = new Map<string, number>();

function alreadySent(key: string): boolean {
  const now = Date.now();
  for (const [k, sentAt] of recentKeys) {
    if (now - sentAt > RECENT_KEY_TTL_MS) recentKeys.delete(k);
  }
  if (recentKeys.has(key)) return true;
  recentKeys.set(key, now);
  return false;
}

// 送出觸發。不 await：呼叫後端可能要好幾秒（還有重試），不能卡住 3CX 事件的處理隊伍。
export function dispatch(triggers: Trigger[]): void {
  for (const trigger of triggers) {
    if (alreadySent(trigger.key)) continue;
    void submitWorkOrder(trigger);
  }
}
