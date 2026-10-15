import axios from 'axios';
import { env } from '@/config/env';
import { logger } from '@/shared/logger';
import { describeError } from '@/threeCx/client';
import type { Trigger } from '@/triggers/detectTriggers';

const MAX_ATTEMPTS = 4;

// 呼叫 BonSale 後端填工單。
//
// TODO: 端點、欄位等後端提供規格後補上。目前 BONSALE_HOST 沒設定時只印 log、不呼叫，
// 方便先只跑「監聽 + 觸發判斷」驗證條件對不對。
//
// 重試：失敗或逾時會重試（1s、2s、4s）。逾時的時候我們不知道後端到底有沒有收到，所以重試一定會
// 有「其實已經填過了」的情況——要靠後端用 trigger.key 做冪等（同一個 key 只填一次，重送直接回成功）。
export async function submitWorkOrder(trigger: Trigger): Promise<void> {
  if (!env.bonsaleHost) {
    logger.info(`📝（未設定 BONSALE_HOST，只印不送）觸發 ${trigger.type}`, trigger);
    return;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // TODO: 換成後端提供的實際端點與 payload。
      await axios.post(
        `${env.bonsaleHost}/work-orders/from-call`,
        { idempotencyKey: trigger.key, ...trigger },
        {
          headers: { 'X-API-KEY': env.bonsaleXApiKey, 'X-API-SECRET': env.bonsaleXApiSecret },
          timeout: 10_000,
        },
      );
      logger.info(`📝 已送出填工單 ${trigger.key}`);
      return;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      // 4xx（除了 429）代表請求本身有問題，重試也不會成功。
      const retriable = status === undefined || status === 429 || status >= 500;
      if (!retriable || attempt === MAX_ATTEMPTS) {
        logger.error(`填工單失敗（放棄）${trigger.key}：${describeError(error)}`);
        return;
      }
      const delay = 1000 * 2 ** (attempt - 1);
      logger.warn(`填工單失敗（第 ${attempt} 次，${delay / 1000} 秒後重試）${trigger.key}：${describeError(error)}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
