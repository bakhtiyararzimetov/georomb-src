// HTTP API для WhatsApp-бота: POST /api/generate-window-pdf — JSON проекта → PDF (или ?format=json → координаты).
// Ошибки всегда JSON: { "error": "<код>", "message": "<что не так>" }.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Project } from '../../app/src/types.ts';
import { ProjectError, parseProject } from './project.ts';
import { drawWindowAndMakePdf } from './pdf.ts';
import { projectLayoutJson } from './layoutJson.ts';

export const API_PATH = '/api/generate-window-pdf';
export const MAX_BODY = 1024 * 1024;   // 1 МБ — проект на 50 окон занимает десятки КБ

export interface AppDeps { makePdf?: (project: Project) => Promise<Uint8Array>; }

class HttpError extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, ...headers });
  res.end(data);
}
const sendError = (res: ServerResponse, e: HttpError, headers?: Record<string, string>) =>
  sendJson(res, e.status, { error: e.code, message: e.message }, headers);

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

async function handleGenerate(req: IncomingMessage, res: ServerResponse, url: URL, makePdf: NonNullable<AppDeps['makePdf']>): Promise<void> {
  const format = url.searchParams.get('format') || 'pdf';
  if(format !== 'pdf' && format !== 'json') throw new HttpError(400, 'invalid_format', 'Параметр format: pdf (по умолчанию) или json');
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

  let pdf: Uint8Array;
  try{ pdf = await makePdf(project); }
  catch(err){
    console.error('PDF generation failed:', err);
    throw new HttpError(500, 'pdf_generation_failed', 'Не удалось создать PDF: ' + ((err as Error)?.message || String(err)));
  }
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': contentDisposition(project.name),
    'Content-Length': pdf.length
  });
  res.end(pdf);
}

export function createApp(deps: AppDeps = {}): Server {
  const makePdf = deps.makePdf || drawWindowAndMakePdf;
  return createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const route = async (): Promise<void> => {
      if(url.pathname === '/health' && req.method === 'GET'){ sendJson(res, 200, { ok: true }); return; }
      if(url.pathname !== API_PATH) throw new HttpError(404, 'not_found', `Нет такого адреса. API: POST ${API_PATH}`);
      if(req.method !== 'POST'){
        req.resume();
        sendError(res, new HttpError(405, 'method_not_allowed', `Нужен метод POST, а пришёл ${req.method}`), { Allow: 'POST' });
        return;
      }
      await handleGenerate(req, res, url, makePdf);
    };
    route().catch((err: unknown) => {
      if(!(err instanceof HttpError)){
        console.error('Unexpected error:', err);
        err = new HttpError(500, 'internal_error', 'Внутренняя ошибка сервера');
      }
      req.resume();
      if(res.headersSent){ res.destroy(); return; }
      sendError(res, err as HttpError);
    });
  });
}
