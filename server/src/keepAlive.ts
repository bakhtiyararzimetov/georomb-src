// Самопинг: бесплатный Render усыпляет сервер после 15 минут без входящих запросов, и первый запрос
// после сна ждёт около минуты. Сервер сам раз в 10 минут запрашивает свой внешний /health — через
// прокси Render это считается входящим запросом. Включается KEEP_ALIVE=1; адрес — KEEP_ALIVE_URL
// или RENDER_EXTERNAL_URL (Render задаёт его сам).

export const KEEP_ALIVE_MS = 10 * 60 * 1000;

export function keepAliveUrl(env: Record<string, string | undefined>): string | null {
  if(env.KEEP_ALIVE !== '1') return null;
  const base = (env.KEEP_ALIVE_URL || env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  return /^https?:\/\//.test(base) ? base + '/health' : null;
}

export interface KeepAliveOpts {
  intervalMs?: number;
  fetch?: (url: string) => Promise<Response>;
  log?: (line: string) => void;
}

/** Запускает пинг; возвращает функцию остановки. Таймер не держит процесс (unref). */
export function startKeepAlive(url: string, o: KeepAliveOpts = {}): () => void {
  const get = o.fetch || ((u: string) => fetch(u, { signal: AbortSignal.timeout(30_000) }));
  const log = o.log || console.warn;
  const timer = setInterval(() => {
    get(url).then(r => r.body?.cancel(), (err: unknown) => log('Самопинг не прошёл: ' + ((err as Error)?.message || String(err))));
  }, o.intervalMs ?? KEEP_ALIVE_MS);
  timer.unref();
  return () => clearInterval(timer);
}
