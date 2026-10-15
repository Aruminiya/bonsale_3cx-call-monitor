import dotenv from 'dotenv';

// quiet：dotenv 新版預設會在啟動時印一行宣傳訊息，關掉。
dotenv.config({ quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少環境變數 ${name}，請參考 .env.example`);
  return value;
}

// 啟動時一次讀完、缺什麼直接報錯，不要等到第一通電話進來、要呼叫 API 時才發現沒設定。
export const env = {
  pbxUrl: required('PBX_URL').replace(/\/+$/, ''),
  clientId: required('CLIENT_ID_3CX'),
  clientSecret: required('CLIENT_SECRET_3CX'),
  // 填工單 API 的規格還沒定，先允許留空：留空時只印 log、不真的呼叫（見 bonsale/workOrderApi.ts）。
  bonsaleHost: process.env.BONSALE_HOST?.replace(/\/+$/, '') ?? '',
  // BonSale 後端模式的服務對服務驗證：X-API-KEY / X-API-SECRET（同 bonsale_3cx-outbound-campaign）。
  bonsaleXApiKey: process.env.BONSALE_X_API_KEY ?? '',
  bonsaleXApiSecret: process.env.BONSALE_X_API_SECRET ?? '',
  port: Number(process.env.PORT ?? 8080),
};
