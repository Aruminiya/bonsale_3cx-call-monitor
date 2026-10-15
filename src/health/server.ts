import http from 'node:http';
import { logger } from '@/shared/logger';
import type { ConnectionStatus } from '@/threeCx/callControlConnection';

// 只做健康檢查：Cloud Run 的服務一定要聽一個 port，也方便部署後確認有沒有連上 3CX。
// GET /healthz → 200 + 連線狀態（就算 3CX 斷線也回 200，避免 Cloud Run 一直重啟它；
// 斷線靠程式自己重連，狀態看回應內容的 connected）。
export function startHealthServer(port: number, getStatus: () => ConnectionStatus): http.Server {
  const server = http.createServer((request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(getStatus()));
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(port, () => logger.info(`🩺 健康檢查 http://localhost:${port}/healthz`));
  return server;
}
