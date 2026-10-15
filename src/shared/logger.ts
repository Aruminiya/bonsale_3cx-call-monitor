// 每行 log 前面加上台北時間。Cloud Run 的 log 雖然也有時間戳，但本機開發時看終端機要靠這個。
function timestamp(): string {
  return new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
}

export const logger = {
  info: (...args: unknown[]) => console.log(`[${timestamp()}]`, ...args),
  warn: (...args: unknown[]) => console.warn(`[${timestamp()}] ⚠️`, ...args),
  error: (...args: unknown[]) => console.error(`[${timestamp()}] ❌`, ...args),
};
