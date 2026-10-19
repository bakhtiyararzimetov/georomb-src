// Доработки API: /api/v1, ключ доступа, лимит запросов, X-Request-Id, язык PDF, /openapi.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp, type AppDeps } from '../src/app.ts';
import { elementPageSvg } from '../src/page.ts';
import { parseProject } from '../src/project.ts';
import { setPdfLang } from '../../app/src/features/pdfI18n.ts';

const exampleText = readFileSync(new URL('../examples/project.json', import.meta.url), 'utf8');
const V1 = '/api/v1/generate-window-pdf';
const fakePdf = async () => new TextEncoder().encode('%PDF-1.7 test');

async function withApp(deps: AppDeps, run: (base: string) => Promise<void>): Promise<void> {
  const server: Server = createApp({ makePdf: fakePdf, ...deps });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try{ await run('http://127.0.0.1:' + (server.address() as AddressInfo).port); }
  finally{ await new Promise<void>(r => server.close(() => r())); }
}
const post = (base: string, path = V1, headers: Record<string, string> = {}, body = exampleText) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

test('/api/v1/generate-window-pdf и старый адрес отвечают одинаково', async () => {
  await withApp({}, async base => {
    for(const path of [V1, '/api/generate-window-pdf']){
      const res = await post(base, path);
      assert.equal(res.status, 200, path);
      assert.equal(res.headers.get('content-type'), 'application/pdf');
      await res.arrayBuffer();
    }
  });
});

test('ключ доступа: без ключа и с чужим — 401, с верным (X-API-Key или Bearer) — 200; /health без ключа', async () => {
  await withApp({ apiKeys: ['secret-1', 'secret-2'] }, async base => {
    for(const h of [{}, { 'X-API-Key': 'wrong' }, { Authorization: 'Bearer secret-1x' }, { Authorization: 'secret-1' }] as Record<string, string>[]){
      const res = await post(base, V1, h);
      assert.equal(res.status, 401, JSON.stringify(h));
      assert.equal(res.headers.get('www-authenticate'), 'Bearer');
      assert.equal(((await res.json()) as { error: string }).error, 'unauthorized');
    }
    for(const h of [{ 'X-API-Key': 'secret-1' }, { Authorization: 'Bearer secret-2' }] as Record<string, string>[]){
      const res = await post(base, V1, h);
      assert.equal(res.status, 200, JSON.stringify(h));
      await res.arrayBuffer();
    }
    assert.equal((await fetch(base + '/health')).status, 200);
  });
});

test('лимит запросов в минуту: 429 с Retry-After, у каждого ключа свой счёт, через минуту снова можно', async () => {
  let now = 1_000_000;
  await withApp({ apiKeys: ['a', 'b'], ratePerMin: 2, now: () => now }, async base => {
    const A = { 'X-API-Key': 'a' }, B = { 'X-API-Key': 'b' };
    for(let i = 0; i < 2; i++){
      const res = await post(base, V1, A);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-ratelimit-remaining'), String(1 - i));
      await res.arrayBuffer();
    }
    const over = await post(base, V1, A);
    assert.equal(over.status, 429);
    assert.equal(((await over.json()) as { error: string }).error, 'rate_limited');
    assert.ok(Number(over.headers.get('retry-after')) >= 1);
    const other = await post(base, V1, B);
    assert.equal(other.status, 200, 'у другого ключа свой лимит');
    await other.arrayBuffer();
    now += 60_000;
    const later = await post(base, V1, A);
    assert.equal(later.status, 200);
    await later.arrayBuffer();
  });
});

test('лимит без ключей — по IP; за прокси (trustProxy) — по X-Forwarded-For', async () => {
  await withApp({ ratePerMin: 1, trustProxy: true }, async base => {
    assert.equal((await post(base, V1, { 'X-Forwarded-For': '1.1.1.1' })).status, 200);
    // прокси дописывает настоящий IP в конец: подставленное клиентом начало не даёт нового счёта
    assert.equal((await post(base, V1, { 'X-Forwarded-For': '9.9.9.9, 1.1.1.1' })).status, 429);
    assert.equal((await post(base, V1, { 'X-Forwarded-For': '2.2.2.2' })).status, 200);
  });
  await withApp({ ratePerMin: 1 }, async base => {
    assert.equal((await post(base, V1, { 'X-Forwarded-For': '1.1.1.1' })).status, 200);
    assert.equal((await post(base, V1, { 'X-Forwarded-For': '2.2.2.2' })).status, 429, 'без trustProxy заголовок не подделать');
  });
});

test('таблица лимита не растёт без конца: новые клиенты сверх предела — 429, старые окна освобождают место', async () => {
  let now = 1_000_000;
  await withApp({ ratePerMin: 5, trustProxy: true, maxClients: 2, now: () => now }, async base => {
    for(const ip of ['1.1.1.1', '2.2.2.2']) assert.equal((await post(base, V1, { 'X-Forwarded-For': ip })).status, 200);
    assert.equal((await post(base, V1, { 'X-Forwarded-For': '3.3.3.3' })).status, 429);
    assert.equal((await post(base, V1, { 'X-Forwarded-For': '1.1.1.1' })).status, 200, 'знакомый клиент проходит');
    now += 60_000;
    assert.equal((await post(base, V1, { 'X-Forwarded-For': '3.3.3.3' })).status, 200);
  });
});

test('X-Request-Id: свой возвращается, без него — новый; в теле ошибки есть requestId', async () => {
  await withApp({}, async base => {
    const own = await post(base, V1, { 'X-Request-Id': 'bot-42' });
    assert.equal(own.headers.get('x-request-id'), 'bot-42');
    await own.arrayBuffer();
    const gen = await fetch(base + '/health');
    assert.match(gen.headers.get('x-request-id') || '', /^[0-9a-f-]{36}$/);
    const bad = await post(base, V1, { 'X-Request-Id': 'bad id with spaces' }, '{');
    const id = bad.headers.get('x-request-id') || '';
    assert.match(id, /^[0-9a-f-]{36}$/, 'небезопасный id заменяется');
    assert.deepEqual(Object.keys(await bad.json() as object).sort(), ['error', 'message', 'requestId']);
  });
});

test('?lang=uz|ky передаётся в отрисовку; неизвестный язык — 400 invalid_lang', async () => {
  const langs: string[] = [];
  await withApp({ makePdf: async (_p, lang) => { langs.push(lang); return fakePdf(); } }, async base => {
    for(const q of ['', '?lang=uz', '?lang=ky', '?lang=ru']) await (await post(base, V1 + q)).arrayBuffer();
    assert.deepEqual(langs, ['ru', 'uz', 'ky', 'ru']);
    const res = await post(base, V1 + '?lang=en');
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: string }).error, 'invalid_lang');
  });
});

test('страница PDF на узбекском и кыргызском', () => {
  const p = parseProject(JSON.parse(exampleText));
  try{
    setPdfLang('uz');
    const uz = elementPageSvg(p, 0);
    assert.ok(uz.includes('Element 1') && uz.includes('Oʻlcham') && !uz.includes('Размер'));
    setPdfLang('ky');
    assert.ok(elementPageSvg(p, 0).includes('Өлчөм'));
    setPdfLang('uz');
    assert.ok(elementPageSvg(parseProject({ elements: [{ width: 1000, height: 1000, net: true }] }), 0).includes('>bor<'), 'сетка: «есть» переведено');
  }finally{ setPdfLang('ru'); }
});

test('GET /openapi.json — описание API без ключа', async () => {
  await withApp({ apiKeys: ['k'] }, async base => {
    const res = await fetch(base + '/openapi.json');
    assert.equal(res.status, 200);
    const spec = await res.json() as { openapi: string; paths: Record<string, unknown> };
    assert.match(spec.openapi, /^3\./);
    assert.ok(spec.paths[V1] && spec.paths['/health']);
  });
});
