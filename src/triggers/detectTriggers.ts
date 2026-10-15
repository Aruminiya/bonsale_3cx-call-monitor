import type { ParticipantChange } from '@/threeCx/state';

// 一個「要呼叫 BonSale 填工單」的觸發。
export type Trigger = {
  // 冪等 key：同一通電話的同一種觸發，不管被偵測到幾次（3CX 連發事件、重試），都是同一個 key。
  // 會帶給後端，請後端用它擋掉重複填單（見 docs/README.md）。
  key: string;
  type: TriggerType;
  callId: number;
  extension: string; // 被監控的分機
  counterpart: string; // 對方號碼或 DN
  occurredAt: string;
};

// TODO: 觸發種類跟後端確認後補上。先放一個範例。
export type TriggerType = 'extension-answered';

// 從一次通話腿的變化，判斷要不要觸發。純函式，方便拿 TEST_3cx-call-control/logs 裡的實際事件測試。
//
// TODO: 觸發條件要跟需求確認，下面只是範例。寫條件時注意（TEST_3cx-call-control/doc/05-queue-outbound.md）：
// - 判斷「接通 / 掛斷」要看「分機」那條腿；佇列那條腿在客戶接起時就 Remove 了，看佇列會判斷錯。
// - participant 沒有方向欄位，進線還是外撥要從其他欄位推斷。
export function detectTriggers(change: ParticipantChange): Trigger[] {
  // 範例：分機的通話腿從非 Connected 變成 Connected = 這支分機剛接通。
  if (
    change.kind === 'upserted' &&
    change.current.status === 'Connected' &&
    change.previous?.status !== 'Connected'
  ) {
    const leg = change.current;
    return [
      {
        key: `${leg.callid}:extension-answered:${leg.dn}`,
        type: 'extension-answered',
        callId: leg.callid,
        extension: leg.dn,
        counterpart: leg.party_caller_id || leg.party_dn || '',
        occurredAt: new Date().toISOString(),
      },
    ];
  }
  return [];
}
