// Автокопия в «Документы/GeoRomb»: файл переживает удаление приложения, его потом открывает «Импорт проектов».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_DIR, backupFileName, createAutoBackup, filesToPrune, type BackupFs } from '../src/features/autoBackup.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const day = (s: string) => new Date(s + 'T12:00:00');

function fakeFs(opts: { failWrites?: number; perm?: string; files?: string[] } = {}) {
  const writes: { path: string; data: string; directory: string }[] = [];
  const deleted: string[] = [];
  let failWrites = opts.failWrites || 0, permRequests = 0;
  const files = new Set(opts.files || []);
  const fs: BackupFs = {
    async writeFile(o){
      if(failWrites > 0){ failWrites--; throw new Error('EACCES'); }
      writes.push(o); files.add(o.path.split('/').pop()!);
      return { uri: 'file:///' + o.path };
    },
    async readdir(){ return { files: [...files].map(name => ({ name })) }; },
    async deleteFile(o){ deleted.push(o.path); files.delete(o.path.split('/').pop()!); },
    async checkPermissions(){ return { publicStorage: opts.perm || 'granted' }; },
    async requestPermissions(){ permRequests++; return { publicStorage: 'granted' }; }
  };
  return { fs, writes, deleted, permRequests: () => permRequests };
}

test('backupFileName: дата и метка установки', () => {
  assert.equal(backupFileName(day('2026-10-08'), 'AB3D'), 'georomb-backup-2026-10-08-AB3D.json');
});

test('filesToPrune: свои файлы старше 7 дней — удалить, чужие и прочие — не трогать', () => {
  const names = [
    'georomb-backup-2026-10-18-AB3D.json', 'georomb-backup-2026-10-12-AB3D.json',
    'georomb-backup-2026-10-11-AB3D.json', 'georomb-backup-2026-09-01-AB3D.json',
    'georomb-backup-2026-09-01-ZZZZ.json', 'photo.jpg'
  ];
  assert.deepEqual(filesToPrune(names, 'AB3D', day('2026-10-18')).sort(),
    ['georomb-backup-2026-09-01-AB3D.json', 'georomb-backup-2026-10-11-AB3D.json']);
});

test('schedule: несколько изменений подряд — одна запись после паузы', async () => {
  const f = fakeFs();
  let n = 0;
  const ab = createAutoBackup({ fs: f.fs, getJson: () => '{"n":' + (++n) + '}', tag: 'AB3D', now: () => day('2026-10-18'), delayMs: 20 });
  ab.schedule(); ab.schedule(); ab.schedule();
  assert.equal(f.writes.length, 0);
  await sleep(60);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0], { path: BACKUP_DIR + '/georomb-backup-2026-10-18-AB3D.json', data: '{"n":1}', directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
});

test('flush: пишет сразу, если были изменения; без изменений — ничего', async () => {
  const f = fakeFs();
  const ab = createAutoBackup({ fs: f.fs, getJson: () => '{}', tag: 'AB3D', now: () => day('2026-10-18'), delayMs: 10_000 });
  assert.equal(await ab.flush(), false);
  ab.schedule();
  assert.equal(await ab.flush(), true);
  assert.equal(f.writes.length, 1);
  assert.equal(await ab.flush(), false, 'второй раз без изменений');
});

test('ошибка записи: один раз просит разрешение и повторяет', async () => {
  const f = fakeFs({ failWrites: 1, perm: 'prompt' });
  const ab = createAutoBackup({ fs: f.fs, getJson: () => '{}', tag: 'AB3D', now: () => day('2026-10-18'), delayMs: 10 });
  ab.schedule();
  assert.equal(await ab.flush(), true);
  assert.equal(f.permRequests(), 1);
  assert.equal(f.writes.length, 1);
});

test('запись не удалась совсем — false без исключения, следующее изменение пробует снова', async () => {
  const f = fakeFs({ failWrites: 2 });
  const ab = createAutoBackup({ fs: f.fs, getJson: () => '{}', tag: 'AB3D', now: () => day('2026-10-18'), delayMs: 10 });
  ab.schedule();
  assert.equal(await ab.flush(), false);
  ab.schedule();
  assert.equal(await ab.flush(), false);
  ab.schedule();
  assert.equal(await ab.flush(), true);
});

test('после записи удаляет свои старые копии', async () => {
  const f = fakeFs({ files: ['georomb-backup-2026-09-01-AB3D.json', 'georomb-backup-2026-09-01-ZZZZ.json'] });
  const ab = createAutoBackup({ fs: f.fs, getJson: () => '{}', tag: 'AB3D', now: () => day('2026-10-18'), delayMs: 10 });
  ab.schedule();
  await ab.flush();
  assert.deepEqual(f.deleted, [BACKUP_DIR + '/georomb-backup-2026-09-01-AB3D.json']);
});

test('два flush одновременно — одна запись', async () => {
  const f = fakeFs();
  const ab = createAutoBackup({ fs: f.fs, getJson: () => '{}', tag: 'AB3D', now: () => day('2026-10-18'), delayMs: 10_000 });
  ab.schedule();
  const [a, b] = await Promise.all([ab.flush(), ab.flush()]);
  assert.deepEqual([a, b].sort(), [false, true]);
  assert.equal(f.writes.length, 1);
});
