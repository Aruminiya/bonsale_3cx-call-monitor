import { env } from '@/config/env';
import { startHealthServer } from '@/health/server';
import { logger } from '@/shared/logger';
import { CallControlConnection } from '@/threeCx/callControlConnection';
import { detectTriggers } from '@/triggers/detectTriggers';
import { dispatch } from '@/triggers/dispatcher';

// 資料流：3CX WebSocket 事件 → 通話腿變化（state）→ 觸發判斷（triggers）→ 呼叫 BonSale 填工單
const connection = new CallControlConnection({
  onChange: (change) => dispatch(detectTriggers(change)),
});

const healthServer = startHealthServer(env.port, () => connection.getStatus());
connection.start();
logger.info('🚀 bonsale_3cx-call-monitor 啟動');

// Cloud Run 停掉 instance（部署新版、縮容）時會送 SIGTERM；本機 Ctrl+C 是 SIGINT。
function shutdown(signal: string) {
  logger.info(`收到 ${signal}，關閉中`);
  connection.stop();
  healthServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
