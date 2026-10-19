// HTTP API для WhatsApp-бота: POST /api/v1/generate-window-pdf — JSON проекта → PDF (или ?format=json → координаты).
// Ошибки всегда JSON: { "error": "<код>", "message": "<что не так>", "requestId": "<X-Request-Id>" }.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import type { PdfLang, Project } from '../../app/src/types.ts';
import { ProjectError, parseProject } from './project.ts';
import { renderPdfInWorker } from './worker.ts';
import { projectLayoutJson } from './layoutJson.ts';
import { docsFile, openapiJson } from './docs.ts';

export const API_PATH = '/api/v1/generate-window-pdf';
export const LEGACY_PATH = '/api/generate-window-pdf';   // первый адрес: оставлен, чтобы бот не сломался
export const MAX_BODY = 1024 * 1024;   // 1 МБ — проект на 50 окон занимает десятки КБ
const LANGS: PdfLang[] = ['ru', 'uz', 'ky'];

export interface AppDeps {
  makePdf?: (project: Project, lang: PdfLang) => Promise<Uint8Array>;
  maxConcurrent?: number;   // одновременных отрисовок PDF (CPU), по умолчанию 2
  maxQueue?: number;        // ждущих в очереди; больше — 503 server_busy, по умолчанию 8
  apiKeys?: string[];       // пусто — без ключа (для запуска на своём компьютере)
  ratePerMin?: number;      // запросов в минуту на ключ (без ключей — на IP); 0 — без лимита
  trustProxy?: boolean;     // IP клиента из X-Forwarded-For (только за своим прокси, иначе его подделают)
  maxClients?: number;      // клиентов в таблице лимита (память), по умолчанию MAX_CLIENTS
  publicUrl?: string;       // внешний адрес сервера для /openapi.json и /docs (PUBLIC_URL)
  log?: (line: string) => void;   // строка на каждый запрос
  now?: () => number;
}

class HttpError extends Error {
  readonly status: number; readonly code: string; readonly headers: Record<string, string>;
  constructor(status: number, code: string, message: string, headers: Record<string, string> = {}) {
    super(message); this.status = status; this.code = code; this.headers = headers;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, ...headers });
  res.end(data);
}
const sendError = (res: ServerResponse, e: HttpError, headers?: Record<string, string>) =>
  sendJson(res, e.status, { error: e.code, message: e.message, requestId: String(res.getHeader('X-Request-Id') || '') }, { ...e.headers, ...headers });

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0, tooLarge = false;
    req.on('data', (c: Buffer) => {
      if(tooLarge) return;                       // дочитываем и выбрасываем, чтобы ответ дошёл до клиента
      size += c.length;
      if(size > MAX_BODY){ tooLarge = true; chunks.length = 0; return; }
      chunks.push(c);
    });
    req.on('end', () => tooLarge
      ? reject(new HttpError(413, 'payload_too_large', `Тело запроса больше ${MAX_BODY / 1024 / 1024} МБ`))
      : resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// имя файла: как safeFileName в приложении, плюс управляющие символы (иначе можно сломать заголовок)
const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_').trim() || 'Проект';
const contentDisposition = (name: string) =>
  `attachment; filename="georomb.pdf"; filename*=UTF-8''${encodeURIComponent(safeFileName(name) + '.pdf')}`;

/** Ограничение одновременных отрисовок: страница рисуется ~0.2–0.5 с CPU, без лимита параллельные запросы складываются. */
function limiter(maxConcurrent: number, maxQueue: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(job: () => Promise<T>): Promise<T> => {
    if(active >= maxConcurrent){
      if(queue.length >= maxQueue) throw new HttpError(503, 'server_busy', 'Сервер занят другими PDF, повторите запрос через несколько секунд');
      await new Promise<void>(r => queue.push(r));
    }else active++;
    try{ return await job(); }
    finally{
      const next = queue.shift();
      if(next) next(); else active--;
    }
  };
}
type Limit = ReturnType<typeof limiter>;

// ключи сравниваются по SHA-256 за одинаковое время — длина и совпадение начала не угадываются по задержке
const digest = (s: string) => createHash('sha256').update(s).digest();
function keyChecker(keys: string[]): (req: IncomingMessage) => string | null {
  const known = keys.map(k => ({ key: k, d: digest(k) }));
  return req => {
    const auth = String(req.headers.authorization || '');
    const given = String(req.headers['x-api-key'] || '') || (/^Bearer\s+(.+)$/i.exec(auth)?.[1] ?? '');
    if(!given) return null;
    const d = digest(given.trim());
    let hit: string | null = null;
    for(const k of known) if(timingSafeEqual(k.d, d)) hit = k.key;
    return hit;
  };
}

/** Лимит запросов: окно в минуту на клиента; клиентов в памяти не больше maxClients. */
export const MAX_CLIENTS = 10_000;
function rateLimiter(perMin: number, now: () => number, maxClients = MAX_CLIENTS) {
  const WINDOW = 60_000, hits = new Map<string, { start: number; count: number }>();   // по порядку начала окна
  return (client: string): Record<string, string> => {
    const t = now();
    let h = hits.get(client);
    if(!h || t - h.start >= WINDOW){
      hits.delete(client);
      // старые окна — в начале Map: удаляем, пока не встретится живое (каждая запись удаляется один раз)
      for(const [k, v] of hits){ if(t - v.start < WINDOW) break; hits.delete(k); }
      if(hits.size >= maxClients) throw new HttpError(429, 'rate_limited', 'Слишком много клиентов за минуту, повторите позже', { 'Retry-After': '60' });
      h = { start: t, count: 0 };
      hits.set(client, h);
    }
    const headers = { 'X-RateLimit-Limit': String(perMin), 'X-RateLimit-Remaining': String(Math.max(0, perMin - h.count - 1)) };
    if(h.count >= perMin){
      const retry = String(Math.max(1, Math.ceil((h.start + WINDOW - t) / 1000)));
      throw new HttpError(429, 'rate_limited', `Не больше ${perMin} запросов в минуту, повторите через ${retry} с`, { ...headers, 'Retry-After': retry });
    }
    h.count++;
    return headers;
  };
}

const REQ_ID_RE = /^[\w.:-]{1,64}$/;
function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  // прокси (nginx, Render, Railway) дописывает настоящий IP в конец; начало заголовка присылает сам клиент
  if(trustProxy){
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').at(-1)!.trim();
    if(xff) return xff;
  }
  return req.socket.remoteAddress || '';
}

async function handleGenerate(req: IncomingMessage, res: ServerResponse, url: URL, makePdf: NonNullable<AppDeps['makePdf']>, limit: Limit): Promise<void> {
  const format = url.searchParams.get('format') || 'pdf';
  if(format !== 'pdf' && format !== 'json') throw new HttpError(400, 'invalid_format', 'Параметр format: pdf (по умолчанию) или json');
  const lang = (url.searchParams.get('lang') || 'ru') as PdfLang;
  if(LANGS.indexOf(lang) < 0) throw new HttpError(400, 'invalid_lang', 'Параметр lang: ru (по умолчанию), uz или ky');
  const raw = await readBody(req);
  let body: unknown;
  try{ body = JSON.parse(raw); }
  catch(err){ throw new HttpError(400, 'invalid_json', 'Тело запроса — не JSON: ' + (err as Error).message); }
  let project: Project;
  try{ project = parseProject(body); }
  catch(err){
    if(err instanceof ProjectError) throw new HttpError(400, 'invalid_project', err.message);
    throw err;
  }
  if(format === 'json'){ sendJson(res, 200, projectLayoutJson(project)); return; }

  const disposition = contentDisposition(project.name);   // до отрисовки: ошибка здесь не должна стоить CPU
  const pdf = await limit(async () => {
    try{ return await makePdf(project, lang); }
    catch(err){
      console.error(`PDF generation failed (id=${res.getHeader('X-Request-Id')}):`, err);
      throw new HttpError(500, 'pdf_generation_failed', 'Не удалось создать PDF: ' + ((err as Error)?.message || String(err)));
    }
  });
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': disposition,
    'Content-Length': pdf.length
  });
  res.end(pdf);
}

export function createApp(deps: AppDeps = {}): Server {
  const makePdf = deps.makePdf || renderPdfInWorker;
  const limit = limiter(deps.maxConcurrent ?? 2, deps.maxQueue ?? 8);
  const now = deps.now || Date.now;
  const keyOf = deps.apiKeys && deps.apiKeys.length ? keyChecker(deps.apiKeys) : null;
  const rate = deps.ratePerMin ? rateLimiter(deps.ratePerMin, now, deps.maxClients) : null;
  const openapi = openapiJson(deps.publicUrl);
  const server = createServer((req, res) => {
    const t0 = Date.now();
    const given = String(req.headers['x-request-id'] || '');
    res.setHeader('X-Request-Id', REQ_ID_RE.test(given) ? given : randomUUID());
    if(deps.log){
      const log = deps.log;
      res.on('finish', () => log(`${req.method} ${(req.url || '').split('?')[0]} ${res.statusCode} ${Date.now() - t0}ms id=${res.getHeader('X-Request-Id')}`));
    }
    const route = async (): Promise<void> => {
      let url: URL;
      try{ url = new URL(req.url || '/', 'http://localhost'); }
      catch{ throw new HttpError(400, 'bad_request', 'Некорректный адрес запроса'); }
      if(req.method === 'GET' && url.pathname === '/health'){ sendJson(res, 200, { ok: true }); return; }
      if(req.method === 'GET' && url.pathname === '/openapi.json'){
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': openapi.length });
        res.end(openapi);
        return;
      }
      if(req.method === 'GET' && (url.pathname === '/docs' || url.pathname.startsWith('/docs/'))){
        const f = docsFile(url.pathname);
        if(!f) throw new HttpError(404, 'not_found', 'Нет такого файла документации. Документация: GET /docs');
        res.writeHead(200, { 'Content-Type': f.type, 'Content-Length': f.body.length, ...f.headers });
        res.end(f.body);
        return;
      }
      if(url.pathname !== API_PATH && url.pathname !== LEGACY_PATH) throw new HttpError(404, 'not_found', `Нет такого адреса. API: POST ${API_PATH}`);
      if(req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', `Нужен метод POST, а пришёл ${req.method}`, { Allow: 'POST' });
      let client = 'ip:' + clientIp(req, !!deps.trustProxy);
      if(keyOf){
        const key = keyOf(req);
        if(!key) throw new HttpError(401, 'unauthorized', 'Нужен ключ API: заголовок X-API-Key или Authorization: Bearer <ключ>', { 'WWW-Authenticate': 'Bearer' });
        client = 'key:' + key;
      }
      if(rate) for(const [k, v] of Object.entries(rate(client))) res.setHeader(k, v);
      await handleGenerate(req, res, url, makePdf, limit);
    };
    route().catch((err: unknown) => {
      if(!(err instanceof HttpError)){
        console.error(`Unexpected error (id=${res.getHeader('X-Request-Id')}):`, err);
        err = new HttpError(500, 'internal_error', 'Внутренняя ошибка сервера');
      }
      req.resume();
      if(res.headersSent){ res.destroy(); return; }
      sendError(res, err as HttpError);
    });
  });
  // медленный или зависший клиент не держит соединение вечно
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  return server;
}
