// HTTP-контракт для бота: заголовки PDF, коды ошибок и JSON-тело ошибки.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/app.ts';

const exampleText = readFileSync(new URL('../examples/project.json', import.meta.url), 'utf8');
const URL_PATH = '/api/generate-window-pdf';

async function listen(server: Server): Promise<string> {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
}
const close = (server: Server) => new Promise<void>(r => server.close(() => r()));
const post = (base: string, body: string, path = URL_PATH) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

let server: Server, base: string;
before(async () => { server = createApp(); base = await listen(server); });
after(() => close(server));

async function expectError(res: Response, status: number, code: string): Promise<void> {
  assert.equal(res.status, status);
  assert.match(res.headers.get('content-type') || '', /^application\/json/);
  const j = await res.json() as { error: string; message: string };
  assert.equal(j.error, code);
  assert.ok(j.message.length > 0);
}

test('200: PDF с заголовками для скачивания', async () => {
  const res = await post(base, exampleText);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const cd = res.headers.get('content-disposition') || '';
  assert.match(cd, /^attachment; filename="georomb\.pdf"; filename\*=UTF-8''/);
  assert.ok(cd.includes(encodeURIComponent('Иванов, ул. Навои 12') + '.pdf'), cd);
  const body = new Uint8Array(await res.arrayBuffer());
  assert.equal(Buffer.from(body.subarray(0, 5)).toString('latin1'), '%PDF-');
  assert.equal(Number(res.headers.get('content-length')), body.length);
});

test('200: ?format=json — координаты вместо PDF', async () => {
  const res = await post(base, exampleText, URL_PATH + '?format=json');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /^application\/json/);
  const j = await res.json() as { elements: { leaves: unknown[] }[] };
  assert.equal(j.elements.length, 2);
});

test('имя файла без опасных символов', async () => {
  const res = await post(base, JSON.stringify({ name: 'a/b\\c"d\r\ne', elements: [{ width: 1000, height: 1000 }] }));
  const cd = res.headers.get('content-disposition') || '';
  assert.ok(!/[\r\n]/.test(cd));
  assert.ok(cd.endsWith("filename*=UTF-8''" + encodeURIComponent('a_b_c_d__e') + '.pdf'), cd);
});

test('400 invalid_json: тело не JSON', async () => {
  await expectError(await post(base, '{"elements": ['), 400, 'invalid_json');
});

test('400 invalid_project: JSON есть, но проект плохой — в сообщении номер элемента', async () => {
  const res = await post(base, JSON.stringify({ elements: [{ width: 5, height: 1000 }] }));
  assert.equal(res.status, 400);
  const j = await res.json() as { error: string; message: string };
  assert.equal(j.error, 'invalid_project');
  assert.match(j.message, /Элемент 1/);
});

test('413 payload_too_large: тело больше 1 МБ', async () => {
  await expectError(await post(base, JSON.stringify({ name: 'x'.repeat(1024 * 1024 + 10) })), 413, 'payload_too_large');
});

test('405 method_not_allowed: GET', async () => {
  const res = await fetch(base + URL_PATH);
  assert.equal(res.headers.get('allow'), 'POST');
  await expectError(res, 405, 'method_not_allowed');
});

test('404 not_found: другой адрес', async () => {
  await expectError(await post(base, exampleText, '/api/other'), 404, 'not_found');
});

test('400 invalid_format: неизвестный format', async () => {
  await expectError(await post(base, exampleText, URL_PATH + '?format=png'), 400, 'invalid_format');
});

test('500 pdf_generation_failed: отрисовка упала — сервер отвечает JSON и живёт дальше', async () => {
  const broken = createApp({ makePdf: async () => { throw new Error('boom'); } });
  const b = await listen(broken);
  try{
    await expectError(await post(b, exampleText), 500, 'pdf_generation_failed');
    const again = await post(b, exampleText);
    assert.equal(again.status, 500, 'сервер всё ещё отвечает');
    await again.arrayBuffer();
  }finally{
    await close(broken);
  }
});

test('GET /health — для проверки, что сервер жив', async () => {
  const res = await fetch(base + '/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});
