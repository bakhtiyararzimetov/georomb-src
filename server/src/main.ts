// Запуск API: npm run server. Настройки — переменные окружения (или файл .env):
//   PORT (3000), HOST (0.0.0.0), API_KEYS — ключи через запятую (пусто — без ключа),
//   RATE_LIMIT — запросов в минуту на ключ или IP (60, 0 — без лимита), TRUST_PROXY=1 — IP из X-Forwarded-For,
//   PUBLIC_URL — внешний адрес сервера (https://api.example.com) для документации /docs,
//   PDF_CONCURRENCY — одновременных отрисовок PDF (2; на слабом сервере — 1), PDF_TIMEOUT — секунд на PDF (60),
//   KEEP_ALIVE=1 — самопинг раз в 10 минут, чтобы бесплатный Render не засыпал (см. keepAlive.ts).
import { API_PATH, createApp } from './app.ts';
import { keepAliveUrl, startKeepAlive } from './keepAlive.ts';
import { renderPdfInWorker } from './worker.ts';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const apiKeys = (process.env.API_KEYS || '').split(',').map(s => s.trim()).filter(Boolean);
const rate = process.env.RATE_LIMIT === undefined || process.env.RATE_LIMIT === '' ? 60 : Number(process.env.RATE_LIMIT);
if(!(rate >= 0)) throw new Error('RATE_LIMIT — число запросов в минуту, 0 — без лимита');
const concurrency = Number(process.env.PDF_CONCURRENCY || 2);
if(!(Number.isInteger(concurrency) && concurrency >= 1)) throw new Error('PDF_CONCURRENCY — целое число от 1');
const timeoutS = Number(process.env.PDF_TIMEOUT || 60);
if(!(timeoutS > 0)) throw new Error('PDF_TIMEOUT — секунд на один PDF, больше 0');

const server = createApp({
  apiKeys, ratePerMin: rate, maxConcurrent: concurrency,
  makePdf: (project, lang) => renderPdfInWorker(project, lang, timeoutS * 1000), trustProxy: process.env.TRUST_PROXY === '1', publicUrl: process.env.PUBLIC_URL,
  log: line => console.log(new Date().toISOString() + ' ' + line)
});
server.listen(port, host, () => {
  console.log(`GeoRomb API: http://${host}:${port}${API_PATH}`);
  console.log(`Документация: http://${host}:${port}/docs`);
  if(!apiKeys.length) console.warn('API_KEYS не задан — API открыт для всех. На сервере в интернете задайте ключ.');
  const ping = keepAliveUrl(process.env);
  if(ping){ startKeepAlive(ping); console.log('Самопинг: ' + ping + ' раз в 10 минут'); }
});

// хостинг останавливает контейнер сигналом SIGTERM: дорисовываем начатые PDF (до 10 с) и выходим
for(const sig of ['SIGTERM', 'SIGINT'] as const){
  process.once(sig, () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 10_000).unref();   // не успели — выходим с ошибкой
  });
}
