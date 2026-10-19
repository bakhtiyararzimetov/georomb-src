// Самопинг для бесплатного Render: сервер засыпает после 15 минут без запросов, поэтому сам шлёт GET /health.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepAliveUrl, startKeepAlive } from '../src/keepAlive.ts';

test('адрес самопинга: KEEP_ALIVE=1 и RENDER_EXTERNAL_URL (или KEEP_ALIVE_URL), иначе выключено', () => {
  assert.equal(keepAliveUrl({}), null);
  assert.equal(keepAliveUrl({ RENDER_EXTERNAL_URL: 'https://x.onrender.com' }), null, 'без KEEP_ALIVE=1 не пингуем');
  assert.equal(keepAliveUrl({ KEEP_ALIVE: '1', RENDER_EXTERNAL_URL: 'https://x.onrender.com/' }), 'https://x.onrender.com/health');
  assert.equal(keepAliveUrl({ KEEP_ALIVE: '1', KEEP_ALIVE_URL: 'https://my.host', RENDER_EXTERNAL_URL: 'https://x.onrender.com' }), 'https://my.host/health');
  assert.equal(keepAliveUrl({ KEEP_ALIVE: '1' }), null, 'адреса нет — нечего пинговать');
  assert.equal(keepAliveUrl({ KEEP_ALIVE: '1', KEEP_ALIVE_URL: 'ftp://x' }), null);
});

test('пингует по таймеру, ошибки сети не роняют сервер, stop() останавливает', async () => {
  const calls: string[] = [], logs: string[] = [];
  let fail = true;
  const stop = startKeepAlive('https://x.onrender.com/health', {
    intervalMs: 20,
    fetch: async (url: string) => { calls.push(url); if(fail){ fail = false; throw new Error('нет сети'); } return new Response('{"ok":true}'); },
    log: s => logs.push(s)
  });
  await new Promise(r => setTimeout(r, 75));
  stop();
  const n = calls.length;
  assert.ok(n >= 2, `пингов: ${n}`);
  assert.ok(calls.every(u => u === 'https://x.onrender.com/health'));
  assert.ok(logs.some(l => l.includes('нет сети')), 'ошибка записана в лог');
  await new Promise(r => setTimeout(r, 50));
  assert.equal(calls.length, n, 'после stop() пингов нет');
});
