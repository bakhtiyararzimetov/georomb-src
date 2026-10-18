// ID устройства: после переустановки тот же (из ANDROID_ID), а уже сохранённый ID не меняется.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ID_RE, deviceIdFromHardware, pickDeviceId } from '../../shared/license.ts';

test('deviceIdFromHardware: один ANDROID_ID — один и тот же ID в формате приложения', async () => {
  const a = await deviceIdFromHardware('9774d56d682e549c');
  assert.match(a, ID_RE);
  assert.equal(await deviceIdFromHardware('9774d56d682e549c'), a);
  assert.notEqual(await deviceIdFromHardware('9774d56d682e549d'), a);
});

test('pickDeviceId: сохранённый ID остаётся — обновление не сбрасывает активацию', async () => {
  assert.equal(await pickDeviceId('ABCDEFGH23', 'ffff0000aaaa1111', () => 'ZZZZZZZZZZ'), 'ABCDEFGH23');
});

test('pickDeviceId: нет сохранённого — ID из ANDROID_ID', async () => {
  assert.equal(await pickDeviceId(null, 'ffff0000aaaa1111', () => 'ZZZZZZZZZZ'), await deviceIdFromHardware('ffff0000aaaa1111'));
});

test('pickDeviceId: сохранённый ID испорчен — как будто его нет', async () => {
  assert.equal(await pickDeviceId('bad', 'ffff0000aaaa1111', () => 'ZZZZZZZZZZ'), await deviceIdFromHardware('ffff0000aaaa1111'));
});

test('pickDeviceId: ANDROID_ID нет или пустой — случайный ID', async () => {
  assert.equal(await pickDeviceId(null, null, () => 'ZZZZZZZZZZ'), 'ZZZZZZZZZZ');
  assert.equal(await pickDeviceId(null, '  ', () => 'ZZZZZZZZZZ'), 'ZZZZZZZZZZ');
});

test('codeFromBackup: код из копии берём, только если он подходит этому устройству и своего кода нет', async () => {
  const { signCode, codeFromBackup } = await import('../../shared/license.ts');
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await crypto.subtle.exportKey('jwk', kp.privateKey), pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const mine = await signCode(priv, 'ABCDEFGH23', '0'), other = await signCode(priv, 'ZZZZZZZZZZ', '0');
  assert.equal(await codeFromBackup(mine, null, 'ABCDEFGH23', pub), mine);
  assert.equal(await codeFromBackup(other, null, 'ABCDEFGH23', pub), null, 'код другого устройства');
  assert.equal(await codeFromBackup(mine, 'already', 'ABCDEFGH23', pub), null, 'свой код уже есть');
  assert.equal(await codeFromBackup(42, null, 'ABCDEFGH23', pub), null, 'не строка');
  assert.equal(await codeFromBackup('x'.repeat(5000), null, 'ABCDEFGH23', pub), null, 'мусор');
});
