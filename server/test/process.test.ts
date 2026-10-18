// Отрисовка не должна останавливать сервер: проверяем из отдельного процесса
// (в одном процессе с сервером клиент сам стоит, пока сервер занят, и блокировку не видно).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('пока рисуется большой PDF, /health отвечает сразу', async () => {
  const port = 30000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['--no-experimental-webstorage', new URL('../src/main.ts', import.meta.url).pathname],
    { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  try{
    await new Promise<void>((resolve, reject) => {
      child.stdout!.on('data', (c: Buffer) => { if(String(c).includes('GeoRomb API')) resolve(); });
      child.on('exit', code => reject(new Error('сервер завершился: ' + code)));
    });
    const base = `http://127.0.0.1:${port}`;
    const col = { kind: 'branch', dir: 'v', children: Array.from({ length: 30 }, () => ({ kind: 'leaf' })) };
    const big = JSON.stringify({ elements: Array.from({ length: 15 }, () => ({ width: 9000, height: 9000, root: col })) });
    const t0 = Date.now();
    const pdf = fetch(base + '/api/generate-window-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big })
      .then(async r => { await r.arrayBuffer(); return { status: r.status, ms: Date.now() - t0 }; });
    await new Promise(r => setTimeout(r, 400));
    const h0 = Date.now();
    assert.equal((await fetch(base + '/health')).status, 200);
    const healthMs = Date.now() - h0;
    const done = await pdf;
    assert.equal(done.status, 200);
    assert.ok(done.ms > 1500, `отрисовка должна быть долгой (${done.ms} мс), иначе тест ничего не проверяет`);
    assert.ok(healthMs < 300, `/health ждал ${healthMs} мс — отрисовка блокирует сервер`);
  }finally{
    child.kill();
  }
});
