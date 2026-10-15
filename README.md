# bonsale_3cx-call-monitor

常駐監聽 3CX Call Control 的通話事件，符合條件的通話呼叫 BonSale 後端 API 填寫工單。

## 資料流

```
3CX ══ WebSocket ══▶ callControlConnection（連線、重連、排隊 GET、快照重建）
                        │ 通話腿變化（previous → current）
                        ▼
                     detectTriggers（要不要觸發）
                        │ Trigger（帶冪等 key）
                        ▼
                     dispatcher（擋短時間重複）→ workOrderApi（呼叫後端，失敗重試）
```

## 結構

| 路徑 | 內容 |
|---|---|
| `src/app.ts` | 進入點：接線、健康檢查、SIGTERM 收尾 |
| `src/config/env.ts` | 讀環境變數，缺了啟動時直接報錯 |
| `src/threeCx/client.ts` | token（單飛、401 只在失敗的是目前 token 時才換）與 REST |
| `src/threeCx/callControlConnection.ts` | 常駐 WebSocket：ping、指數退避重連、依序處理事件、每次連上重拿快照 |
| `src/threeCx/state.ts` | 通話腿表，產生「從什麼變成什麼」的變化；快照不產生變化 |
| `src/triggers/detectTriggers.ts` | **觸發條件（待確認，目前是範例）** |
| `src/triggers/dispatcher.ts` | 記憶體內擋短時間重複，不卡住事件隊伍 |
| `src/bonsale/workOrderApi.ts` | **呼叫填工單 API（待後端規格）**，未設定時只印 log |
| `src/health/server.ts` | `GET /healthz` 回傳連線狀態 |

## 開發

```bash
cp .env.example .env   # 填 PBX_URL / CLIENT_ID_3CX / CLIENT_SECRET_3CX
pnpm install
pnpm dev               # nodemon + ts-node
```

`BONSALE_HOST` 留空時只印出觸發內容、不呼叫後端，可以先只驗證觸發條件。

## 部署注意

- **3CX Client ID 要專用**：不能跟 3cx-report、自動外撥共用，不然會互相作廢 token。
- **只能一個 instance**：多個 instance 會各自收到同一個事件、各自填一次單。
- **CPU 要常駐**：Cloud Run 預設沒請求時節流 CPU，WebSocket 會被凍結。要設 `--no-cpu-throttling --min-instances=1 --max-instances=1`。
- 部署用本機 `docker build` + `docker push`。

設計上待確認的事項見 `../../docs/README.md`。
