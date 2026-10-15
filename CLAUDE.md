# bonsale_3cx-call-monitor

常駐服務：監聽 3CX Call Control 事件，符合條件時呼叫 BonSale 後端 API 填工單。結構與資料流見 README.md，待確認事項見 ../../docs/README.md。

## 慣例
- Node 20 + TypeScript（CommonJS），pnpm。開發 `pnpm dev`（nodemon + ts-node），`pnpm type-check`、`pnpm lint`、`pnpm build` 都要過。
- 程式碼註解與 log 用繁體中文；註解寫「為什麼」，不重述程式在做什麼。
- 3CX 行為的實測記錄在 /Users/leo/Desktop/Program/Test/TEST_3cx-call-control/doc/，改連線或觸發條件前先讀。
- 不要自己 git add / commit / 開分支。

## 不能破壞的保護
- token：同一個 Client ID 只有一個有效 token；401 只在失敗的是目前快取的 token 時才清掉。
- 事件依序處理（draining 鎖）、generation 丟掉舊連線的結果、每次連上重拿快照。
- 快照不產生變化事件，否則每次重連都會重複觸發。
- 觸發一定帶冪等 key，重試靠後端用 key 擋重複。
