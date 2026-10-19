// Запуск API: npm run server. Настройки — переменные окружения (или файл .env):
//   PORT (3000), HOST (0.0.0.0), API_KEYS — ключи через запятую (пусто — без ключа),
//   RATE_LIMIT — запросов в минуту на ключ или IP (60, 0 — без лимита), TRUST_PROXY=1 — IP из X-Forwarded-For.
import { API_PATH, createApp } from './app.ts';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const apiKeys = (process.env.API_KEYS || '').split(',').map(s => s.trim()).filter(Boolean);
const rate = process.env.RATE_LIMIT === undefined || process.env.RATE_LIMIT === '' ? 60 : Number(process.env.RATE_LIMIT);
if(!(rate >= 0)) throw new Error('RATE_LIMIT — число запросов в минуту, 0 — без лимита');

const server = createApp({
  apiKeys, ratePerMin: rate, trustProxy: process.env.TRUST_PROXY === '1',
  log: line => console.log(new Date().toISOString() + ' ' + line)
});
server.listen(port, host, () => {
  console.log(`GeoRomb API: http://${host}:${port}${API_PATH}`);
  if(!apiKeys.length) console.warn('API_KEYS не задан — API открыт для всех. На сервере в интернете задайте ключ.');
});

// хостинг останавливает контейнер сигналом SIGTERM: дорисовываем начатые PDF (до 10 с) и выходим
for(const sig of ['SIGTERM', 'SIGINT'] as const){
  process.once(sig, () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 10_000).unref();   // не успели — выходим с ошибкой
  });
}
