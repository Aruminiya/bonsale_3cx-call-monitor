import axios, { type AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { env } from '@/config/env';
import { logger } from '@/shared/logger';

// 3CX 的 token 管理與 REST 呼叫。做法跟 TEST_3cx-call-control/src/api.js、3cx-report 的
// src/lib/threeCx/client.ts 相同（踩坑記錄見 TEST_3cx-call-control/doc/02-auth-token.md）：
// - 同一個 Client ID 同時只有一個有效 token，新的發出去舊的立刻 401。
// - 單飛：同時有好幾個請求發現要換 token 時，只發一次 /connect/token，大家等同一個結果。
// - 401 時只有「失敗的 token 還是快取裡那個」才清掉重拿，否則會把別人剛換好的新 token 又作廢。

type CachedToken = { value: string; expiresAt: number };

let cached: CachedToken | null = null;
let pending: Promise<string> | null = null;

// 3CX 回的 expires_in 單位不可靠（後台設定的分鐘數原封不動回傳），改看 JWT 裡簽章過的 exp。
function jwtExpiresAtMs(accessToken: string): number {
  const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'));
  return payload.exp * 1000;
}

async function requestToken(): Promise<string> {
  const response = await axios.post<{ access_token: string }>(
    `${env.pbxUrl}/connect/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.clientId,
      client_secret: env.clientSecret,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  const token = response.data.access_token;
  // 提早 60 秒視為過期，避免剛好在邊界上用到過期的 token。
  cached = { value: token, expiresAt: jwtExpiresAtMs(token) - 60_000 };
  logger.info('🔑 取得新的 3CX token');
  return token;
}

// forceRefresh：WebSocket 握手被 401 拒絕時用，代表快取裡那個已經被作廢了。
export async function getAccessToken(options?: { forceRefresh?: boolean }): Promise<string> {
  if (pending) return pending;
  if (options?.forceRefresh) cached = null;
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  pending = requestToken().finally(() => {
    pending = null;
  });
  return pending;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retriedAfter401?: boolean };

// 已掛好 Authorization 與 401 重試的 axios instance。
export const threeCx: AxiosInstance = axios.create({ baseURL: env.pbxUrl });

threeCx.interceptors.request.use(async (config) => {
  config.headers.Authorization = `Bearer ${await getAccessToken()}`;
  return config;
});

threeCx.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined;
    if (error.response?.status !== 401 || !config || config._retriedAfter401) throw error;
    config._retriedAfter401 = true;

    const failedToken = String(config.headers.Authorization ?? '').replace(/^Bearer /, '');
    if (cached?.value === failedToken) cached = null;
    config.headers.Authorization = `Bearer ${await getAccessToken()}`;
    return threeCx.request(config);
  },
);

export function describeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.response ? `HTTP ${error.response.status} ${JSON.stringify(error.response.data)}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
