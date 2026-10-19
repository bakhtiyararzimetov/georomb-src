// Коды активации и подписанный revoked.json: граница срока, чужое устройство, мусор на входе.
// Подпись — на собственной тестовой паре ключей (настоящий закрытый ключ не используется).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CODE_PREFIX, bytesToB64u, codePayload, dateNum, signCode, signRevokedFile, verifyCode, verifyRevokedFile
} from '../../shared/license.ts';

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
const other = await crypto.subtle.exportKey('jwk', (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])).publicKey);
const ID = 'ABCDE23456';

test('срок включительно: в день окончания действует, на следующий — истёк', async () => {
  const code = await signCode(priv, ID, '20261018');
  assert.deepEqual(await verifyCode(code, ID, pub, 20261018), { ok: true, exp: '20261018' });
  assert.deepEqual(await verifyCode(code, ID, pub, 20261019), { ok: false, why: 'expired', exp: '20261018' });
  // переход через месяц/год сравнивается как число YYYYMMDD
  assert.equal((await verifyCode(await signCode(priv, ID, '20261231'), ID, pub, 20270101)).ok, false);
});

test('бессрочный код, чужое устройство, чужой ключ', async () => {
  const code = await signCode(priv, ID, '0');
  assert.equal((await verifyCode(code, ID, pub, 99991231)).ok, true);
  assert.deepEqual(await verifyCode(code, 'ZZZZZ99999', pub), { ok: false, why: 'device' });
  assert.deepEqual(await verifyCode(code, ID, other), { ok: false, why: 'sig' });
  // пробелы/переносы при вставке из мессенджера допускаются
  assert.equal((await verifyCode(code.slice(0, 20) + ' \n' + code.slice(20), ID, pub)).ok, true);
});

test('мусор на входе: только отказ, без исключений', async () => {
  const inputs: unknown[] = ['', null, undefined, 'IWD1', 'IWD1..', 'IWD1.a.b.c', 'IWD2.a.b', 'IWD1.!!!.@@@',
    'IWD1.' + 'A'.repeat(100000) + '.AA', CODE_PREFIX + '.' + bytesToB64u(codePayload(ID, '0')) + '.'];
  for(const x of inputs){
    const r = await verifyCode(x as string, ID, pub);
    assert.equal(r.ok, false, String(x).slice(0, 30));
  }
});

test('подмена срока в коде ломает подпись', async () => {
  const code = await signCode(priv, ID, '20260101');
  const s = code.split('.')[2];
  const forged = CODE_PREFIX + '.' + bytesToB64u(codePayload(ID, '0')) + '.' + s;
  assert.deepEqual(await verifyCode(forged, ID, pub), { ok: false, why: 'sig' });
});

test('revoked.json: подпись покрывает ids, lic и ts; мусор → null', async () => {
  const f = await signRevokedFile(priv, ['AAAAA22222'], [{ id: ID, exp: '20270101' }], 1000);
  assert.deepEqual(await verifyRevokedFile(f, pub), { ts: 1000, ids: ['AAAAA22222'], lic: [{ id: ID, exp: '20270101' }] });
  assert.equal(await verifyRevokedFile({ ...f, ids: [] }, pub), null);
  assert.equal(await verifyRevokedFile({ ...f, lic: [{ id: ID, exp: '0' }] }, pub), null);
  assert.equal(await verifyRevokedFile({ ...f, ts: 2000 }, pub), null);
  for(const x of [null, 1, 'x', [], { v: 2 }, { ...f, sig: '***' }, { ...f, lic: [null] }, { ...f, v: 1 }]){
    assert.equal(await verifyRevokedFile(x, pub), null);
  }
});

test('dateNum — по местному времени устройства', () => {
  assert.equal(dateNum(new Date(2026, 0, 5, 23, 59)), 20260105);
  assert.equal(dateNum(new Date(2026, 11, 31, 0, 0)), 20261231);
});

// CLI лицензий: команда add-list не требует закрытого ключа, база — во временной папке
function cliAddList(days: string, cmd = 'add-list'): string {
  const dir = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.tmp-lic-'))   // внутри репозитория, удаляется сразу;
  try{
    const db = join(dir, 'issued.json');
    const r = spawnSync(process.execPath, [new URL('../../backend/src/cli.ts', import.meta.url).pathname, cmd, 'ABCDE-23456', '--days', days],
      { env: { ...process.env, GEOROMB_DB: db, GEOROMB_KEY: join(dir, 'нет-ключа.json') }, encoding: 'utf8' });
    if(r.status !== 0) return 'ERROR';
    return (JSON.parse(readFileSync(db, 'utf8')) as { exp: string }[])[0].exp;
  }finally{ rmSync(dir, { recursive: true, force: true }); }
}

test('CLI: add-list --days 30 — срок через 30 дней', () => {
  const exp = cliAddList('30');
  assert.match(exp, /^\d{8}$/);
  assert.ok(Number(exp) > dateNum());
});

test('CLI: опечатка в --days не выдаёт бессрочную лицензию', () => {
  for(const d of ['3O', '-30', '30д']){
    const exp = cliAddList(d);
    assert.notEqual(exp, '0', '--days ' + d + ' дало бессрочную лицензию');
  }
});

test('CLI: extend с пустым или дробным --days — ошибка, а не бессрочная лицензия', () => {
  const dir = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.tmp-lic-'));
  try{
    const db = join(dir, 'issued.json');
    const env = { ...process.env, GEOROMB_DB: db, GEOROMB_KEY: join(dir, 'нет-ключа.json') };
    const cli = new URL('../../backend/src/cli.ts', import.meta.url).pathname;
    assert.equal(spawnSync(process.execPath, [cli, 'add-list', 'ABCDE-23456', '--days', '30'], { env, encoding: 'utf8' }).status, 0);
    const before = readFileSync(db, 'utf8');
    for(const args of [['--days'], ['--days', '1.5'], ['--days', '3O']]){
      const r = spawnSync(process.execPath, [cli, 'extend', 'ABCDE-23456', ...args], { env, encoding: 'utf8' });
      assert.notEqual(r.status, 0, 'extend ' + args.join(' ') + ' прошёл');
      assert.equal(readFileSync(db, 'utf8'), before, 'база не изменилась');
    }
  }finally{ rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: огромный --days — ошибка, а не подписанный срок NaN', () => {
  assert.equal(cliAddList('99999999999'), 'ERROR');
  assert.match(cliAddList('36500'), /^\d{8}$/);
});
