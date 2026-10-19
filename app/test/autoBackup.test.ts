// Автокопия в «Документы/GeoRomb»: файл переживает удаление приложения, его потом открывает «Импорт проектов».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_DIR, backupFileName, backupsNewestFirst, createAutoBackup, createBackupTarget, filesToPrune, folderFs, newestBackup, projectFingerprint, type BackupFs, type FolderApi } from '../src/features/autoBackup.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const day = (s: string) => new Date(s + 'T12:00:00');

function fakeFs(opts: { failWrites?: number; perm?: string; grant?: string; files?: string[] } = {}) {
  const writes: { path: string; data: string; directory: string }[] = [];
  const deleted: string[] = [];
  let failWrites = opts.failWrites || 0, permRequests = 0, calls = 0;
  const files = new Set(opts.files || []);
  const fs: BackupFs = {
    async writeFile(o){
      calls++;
      if(failWrites > 0){ failWrites--; throw new Error('EACCES'); }
      writes.push(o); files.add(o.path.split('/').pop()!);
      return { uri: 'file:///' + o.path };
    },
    async readdir(){ calls++; return { files: [...files].map(name => ({ name })) }; },
    async deleteFile(o){ deleted.push(o.path); files.delete(o.path.split('/').pop()!); },
    async checkPermissions(){ return { publicStorage: opts.perm || 'granted' }; },
    async requestPermissions(){ permRequests++; return { publicStorage: opts.grant || 'granted' }; }
  };
  return { fs, writes, deleted, permRequests: () => permRequests, calls: () => calls };
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

function memFlag(){ let v = false; return { get: () => v, set: () => { v = true; } }; }

test('нет разрешения (Android ≤ 10): спрашивает один раз до записи, разрешили — пишет', async () => {
  const f = fakeFs({ perm: 'prompt', grant: 'granted' });
  const ab = createAutoBackup({ fs: f.fs, getJson: () => '{}', tag: 'AB3D', now: () => day('2026-10-18'), delayMs: 10, declined: memFlag() });
  ab.schedule();
  assert.equal(await ab.flush(), true);
  assert.equal(f.permRequests(), 1);
  assert.equal(f.writes.length, 1);
});

test('отказали в разрешении — запоминаем и больше не трогаем файлы и не спрашиваем', async () => {
  const f = fakeFs({ perm: 'prompt', grant: 'denied' });
  const declined = memFlag();
  const ab = createAutoBackup({ fs: f.fs, getJson: () => '{}', tag: 'AB3D', now: () => day('2026-10-18'), delayMs: 10, declined });
  ab.schedule();
  assert.equal(await ab.flush(), false);
  assert.equal(declined.get(), true);
  assert.equal(f.calls(), 0, 'без разрешения файлы не трогаем — иначе плагин сам покажет системный диалог');
  const ab2 = createAutoBackup({ fs: f.fs, getJson: () => '{}', tag: 'AB3D', now: () => day('2026-10-18'), delayMs: 10, declined });
  ab2.schedule();
  assert.equal(await ab2.flush(), false);
  assert.equal(f.permRequests(), 1, 'после перезапуска тоже не спрашиваем');
});

test('пока приложение заблокировано (экран активации) — не пишем, но изменения не теряются', async () => {
  const f = fakeFs();
  let locked = true;
  const ab = createAutoBackup({ fs: f.fs, getJson: () => '{}', tag: 'AB3D', now: () => day('2026-10-18'), delayMs: 10, canRun: () => !locked });
  ab.schedule();
  assert.equal(await ab.flush(), false);
  assert.equal(f.calls(), 0);
  locked = false;
  assert.equal(await ab.flush(), true);
});

test('schedule можно передать как обычную функцию', async () => {
  const f = fakeFs();
  const ab = createAutoBackup({ fs: f.fs, getJson: () => '{}', tag: 'AB3D', now: () => day('2026-10-18'), delayMs: 10 });
  const cb = ab.schedule;
  cb();
  await sleep(40);
  assert.equal(f.writes.length, 1);
});

test('projectFingerprint: одинаковые проекты (кроме id и номера) совпадают, разные — нет', () => {
  const el = (w: number) => ({ id: 7, type: 'casement', width: w, height: 1200, qty: 1, color: null, root: { nid: 3, kind: 'leaf' } });
  const a = { id: 1, number: 1, name: 'Иванов', date: '3 сентября', elements: [el(1500)] };
  const b = { id: 9, number: 4, name: 'Иванов', date: '3 сентября', elements: [{ ...el(1500), id: 42, root: { nid: 77, kind: 'leaf' } }] };
  assert.equal(projectFingerprint(a), projectFingerprint(b));
  assert.notEqual(projectFingerprint(a), projectFingerprint({ ...b, elements: [el(1600)] }));
  assert.notEqual(projectFingerprint(a), projectFingerprint({ ...b, name: 'Петров' }));
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

test('newestBackup: самая свежая копия GeoRomb по времени изменения, чужие файлы не считаются', () => {
  assert.equal(newestBackup([]), null);
  assert.equal(newestBackup([{ name: 'фото.jpg', modified: 9e12 }, { name: 'projects-2026-10-01.json', modified: 9e12 }]), null);
  assert.equal(newestBackup([
    { name: 'georomb-backup-2026-10-17-AB3D.json', modified: 100 },
    { name: 'georomb-backup-2026-10-19-ZZZZ.json', modified: 300 },   // прошлая установка, но свежее
    { name: 'georomb-backup-2026-10-18-AB3D.json', modified: 200 },
    { name: 'notes.txt', modified: 999 }
  ]), 'georomb-backup-2026-10-19-ZZZZ.json');
  // время не известно (0) — по дате в имени
  assert.equal(newestBackup([{ name: 'georomb-backup-2026-10-17-AB3D.json', modified: 0 }, { name: 'georomb-backup-2026-10-18-AB3D.json', modified: 0 }]),
    'georomb-backup-2026-10-18-AB3D.json');
});

test('folderFs: автокопия пишет в выбранную папку по имени файла (без «GeoRomb/»), список и удаление — там же', async () => {
  const calls: string[] = [];
  const fa: FolderApi = {
    async pick(){ return { uri: 'content://x', name: 'GeoRomb' }; },
    async current(){ return { uri: 'content://x', name: 'GeoRomb' }; },
    async list(){ calls.push('list'); return { files: [{ name: 'georomb-backup-2026-10-01-AB3D.json', modified: 1 }] }; },
    async read(o){ calls.push('read ' + o.name); return { data: '{}' }; },
    async write(o){ calls.push('write ' + o.name + ' ' + o.data); },
    async remove(o){ calls.push('remove ' + o.name); }
  };
  const fs = folderFs(fa);
  const ab = createAutoBackup({ fs, tag: 'AB3D', getJson: () => '{"v":1}', now: () => day('2026-10-19'), delayMs: 5 });
  ab.schedule();
  assert.equal(await ab.flush(), true);
  assert.deepEqual(calls, ['write georomb-backup-2026-10-19-AB3D.json {"v":1}', 'list', 'remove georomb-backup-2026-10-01-AB3D.json']);
});

test('backupsNewestFirst: все копии от свежей к старой (если свежая испорчена — пробуем следующую)', () => {
  assert.deepEqual(backupsNewestFirst([
    { name: 'georomb-backup-2026-10-17-AB3D.json', modified: 100 },
    { name: 'x.txt', modified: 500 },
    { name: 'georomb-backup-2026-10-19-AB3D.json', modified: 300 }
  ]), ['georomb-backup-2026-10-19-AB3D.json', 'georomb-backup-2026-10-17-AB3D.json']);
});

function targetFixture(opts: { folder?: string | null; failFolder?: boolean; slowCurrent?: boolean } = {}) {
  const log: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const docs: BackupFs = {
    async writeFile(o){ log.push('docs ' + o.path); },
    async readdir(){ return { files: [] }; },
    async deleteFile(){},
    async checkPermissions(){ log.push('docs perm'); return { publicStorage: 'granted' }; },
    async requestPermissions(){ return { publicStorage: 'granted' }; }
  };
  const fa: FolderApi = {
    async pick(){ return { uri: 'u', name: 'GeoRomb' }; },
    async current(){ if(opts.slowCurrent) await gate; return opts.folder ? { uri: 'u', name: opts.folder } : { uri: null, name: null }; },
    async list(){ return { files: [] }; },
    async read(){ return { data: '' }; },
    async write(o){ if(opts.failFolder) throw new Error('IO'); log.push('folder ' + o.name); },
    async remove(){}
  };
  const fails: string[] = [];
  const t = createBackupTarget(docs, fa, name => fails.push(name));
  return { t, log, fails, release };
}

test('копия при запуске ждёт ответа «какая папка выбрана» и пишет в неё, а не в Documents', async () => {
  const { t, log, release } = targetFixture({ folder: 'GeoRomb', slowCurrent: true });
  const w = t.fs.writeFile({ path: 'GeoRomb/a.json', data: '{}', directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
  const p = t.fs.checkPermissions!();
  release();
  await w; await p;
  assert.deepEqual(log, ['folder a.json'], 'ни записи, ни запроса разрешения для Documents');
  assert.equal(t.folder(), 'GeoRomb');
});

test('папка не выбрана — как раньше, Documents/GeoRomb', async () => {
  const { t, log } = targetFixture({ folder: null });
  await t.fs.writeFile({ path: 'GeoRomb/a.json', data: '{}', directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
  assert.deepEqual(log, ['docs GeoRomb/a.json']);
});

test('выбранная папка недоступна (удалили) — копия всё равно сохраняется в Documents, пользователь узнаёт один раз', async () => {
  const { t, log, fails } = targetFixture({ folder: 'GeoRomb', failFolder: true });
  const o = { path: 'GeoRomb/a.json', data: '{}', directory: 'DOCUMENTS', encoding: 'utf8', recursive: true };
  await t.fs.writeFile(o);
  await t.fs.writeFile(o);
  assert.deepEqual(log, ['docs GeoRomb/a.json', 'docs GeoRomb/a.json']);
  assert.deepEqual(fails, ['GeoRomb']);
  t.setFolder('Новая');
  assert.equal(t.folder(), 'Новая');
});
