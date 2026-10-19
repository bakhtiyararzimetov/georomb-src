// Документация API: /openapi.json (адрес сервера подставляется из PUBLIC_URL) и /docs — Swagger UI.
// Файлы Swagger UI отдаются из npm-пакета swagger-ui-dist: страница не зависит от чужих CDN.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const SPEC = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8')) as Record<string, unknown>;

/** OpenAPI с адресом сервера: PUBLIC_URL — для «Try it out» с другого сайта, иначе — тот же сервер. */
export function openapiJson(publicUrl?: string): Buffer {
  const url = (publicUrl || '').replace(/\/+$/, '');
  const servers = url ? [{ url, description: 'API server' }] : [{ url: '/', description: 'этот сервер' }];
  return Buffer.from(JSON.stringify({ ...SPEC, servers }));
}

const UI_DIR = dirname(createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'));
// только эти файлы пакета: index.html и прочее из папки не отдаются
const UI_FILES: Record<string, string> = {
  'swagger-ui.css': 'text/css; charset=utf-8',
  'swagger-ui-bundle.js': 'text/javascript; charset=utf-8',
  'swagger-ui-standalone-preset.js': 'text/javascript; charset=utf-8',
  'favicon-32x32.png': 'image/png',
  'favicon-16x16.png': 'image/png'
};

const PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GeoRomb API</title>
<link rel="icon" type="image/png" href="/docs/favicon-32x32.png">
<link rel="stylesheet" href="/docs/swagger-ui.css">
<style>body{margin:0;background:#fafafa}</style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="/docs/swagger-ui-bundle.js"></script>
<script src="/docs/swagger-ui-standalone-preset.js"></script>
<script src="/docs/init.js"></script>
</body>
</html>
`;
// ключ после «Authorize» хранится в браузере (persistAuthorization), чтобы не вводить его заново
const INIT = `window.ui = SwaggerUIBundle({
  url: '/openapi.json',
  dom_id: '#swagger-ui',
  deepLinking: true,
  persistAuthorization: true,
  tryItOutEnabled: false,
  displayRequestDuration: true,
  filter: true,
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
  layout: 'StandaloneLayout'
});
`;

export interface DocFile { type: string; body: Buffer; headers: Record<string, string>; }
const HTML_HEADERS = {
  // свои скрипты; стили и картинки Swagger UI вставляет inline и через data:
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-cache'
};
const cache = new Map<string, Buffer>();

/** Файл страницы документации по пути запроса; null — такого нет (404). */
export function docsFile(pathname: string): DocFile | null {
  if(pathname === '/docs' || pathname === '/docs/') return { type: 'text/html; charset=utf-8', body: Buffer.from(PAGE), headers: HTML_HEADERS };
  if(pathname === '/docs/init.js') return { type: 'text/javascript; charset=utf-8', body: Buffer.from(INIT), headers: { 'Cache-Control': 'no-cache' } };
  const name = pathname.startsWith('/docs/') ? pathname.slice(6) : '';
  const type = Object.hasOwn(UI_FILES, name) ? UI_FILES[name] : null;
  if(!type) return null;
  let body = cache.get(name);
  if(!body){ body = readFileSync(join(UI_DIR, name)); cache.set(name, body); }
  return { type, body, headers: { 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } };
}
