// Автокопия проектов в «Документы/GeoRomb» — эта папка не стирается при удалении приложения,
// а файл потом открывает «Импорт проектов». Здесь только логика (без DOM); подключение — в backup.ts.
//
// Имя файла с меткой установки: после переустановки Android (11+) не даёт перезаписать файл прошлой
// установки, поэтому новая установка пишет в свои файлы, а чужие не трогает.

export const BACKUP_DIR = 'GeoRomb';
export const KEEP_DAYS = 7;
const NAME_RE = /^georomb-backup-(\d{4})-(\d{2})-(\d{2})-([A-Z2-9]+)\.json$/;

export interface BackupFs {
  writeFile(o: { path: string; data: string; directory: string; encoding: string; recursive: boolean }): Promise<unknown>;
  readdir(o: { path: string; directory: string }): Promise<{ files: ({ name: string } | string)[] }>;
  deleteFile(o: { path: string; directory: string }): Promise<unknown>;
  checkPermissions?(): Promise<{ publicStorage: string }>;
  requestPermissions?(): Promise<{ publicStorage: string }>;
}

const z = (x: number) => String(x).padStart(2, '0');
const dayKey = (d: Date) => d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());

/** georomb-backup-YYYY-MM-DD-<метка>.json — одна копия на день (по местному времени). */
export function backupFileName(d: Date, tag: string): string {
  return 'georomb-backup-' + dayKey(d) + '-' + tag + '.json';
}

/** Свои копии старше KEEP_DAYS дней (сегодня — первый из них). */
export function filesToPrune(names: string[], tag: string, today: Date, keepDays = KEEP_DAYS): string[] {
  const oldest = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (keepDays - 1));
  const oldestKey = dayKey(oldest);
  return names.filter(n => {
    const m = NAME_RE.exec(n);
    return !!m && m[4] === tag && (m[1] + '-' + m[2] + '-' + m[3]) < oldestKey;
  });
}

export interface AutoBackupOptions {
  fs: BackupFs;
  getJson: () => string;       // содержимое копии (как у «Экспорт проектов»)
  tag: string;                 // метка установки
  now?: () => Date;
  delayMs?: number;            // пауза после последнего изменения
  canRun?: () => boolean;      // false — пока нельзя (экран активации): изменения копятся, запись позже
  declined?: { get(): boolean; set(): void };   // «в разрешении на память отказали» — помним между запусками
  beforeAsk?: () => void;      // объяснить пользователю, зачем сейчас появится системный запрос
}

/**
 * Отпечаток проекта для поиска повторов при восстановлении: без id, номеров и nid —
 * они меняются при каждом импорте, а содержимое (имя, дата, размеры, деления) — нет.
 */
export function projectFingerprint(p: unknown): string {
  return JSON.stringify(p, (k, v) => (k === 'id' || k === 'number' || k === 'nid' || k === 'history' || k === 'redo') ? undefined : v);
}

export function createAutoBackup(o: AutoBackupOptions): { schedule(): void; flush(): Promise<boolean> } {
  const now = o.now || (() => new Date());
  const delay = o.delayMs ?? 3000;
  let dirty = false, timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<boolean> = Promise.resolve(false);

  async function write(path: string, data: string): Promise<void> {
    await o.fs.writeFile({ path, data, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
  }
  async function prune(today: Date): Promise<void> {
    try{
      const r = await o.fs.readdir({ path: BACKUP_DIR, directory: 'DOCUMENTS' });
      const names = r.files.map(f => typeof f === 'string' ? f : f.name);
      for(const n of filesToPrune(names, o.tag, today)){
        try{ await o.fs.deleteFile({ path: BACKUP_DIR + '/' + n, directory: 'DOCUMENTS' }); }catch{ /* не наш или уже удалён */ }
      }
    }catch{ /* папку не прочитать — старые копии останутся */ }
  }
  // Android ≤ 10: без разрешения плагин сам показывает системный диалог на каждый вызов — поэтому проверяем
  // заранее, спрашиваем один раз, а при отказе запоминаем и файлы больше не трогаем. На Android 11+ всегда granted.
  async function permitted(): Promise<boolean> {
    if(o.declined && o.declined.get()) return false;
    if(!o.fs.checkPermissions) return true;
    try{
      if((await o.fs.checkPermissions()).publicStorage === 'granted') return true;
      if(o.fs.requestPermissions){
        if(o.beforeAsk) o.beforeAsk();
        if((await o.fs.requestPermissions()).publicStorage === 'granted') return true;
      }
    }catch{ /* считаем отказом */ }
    if(o.declined) o.declined.set();
    return false;
  }
  async function run(): Promise<boolean> {
    if(!dirty || (o.canRun && !o.canRun())) return false;
    if(!(await permitted())){ dirty = false; return false; }
    dirty = false;
    const today = now();
    const path = BACKUP_DIR + '/' + backupFileName(today, o.tag);
    try{
      await write(path, o.getJson());
    }catch(err){
      console.warn('Автокопия не сохранена:', err);
      return false;                          // dirty уже сброшен: следующее изменение попробует снова
    }
    await prune(today);
    return true;
  }

  function flush(): Promise<boolean> {
    if(timer){ clearTimeout(timer); timer = null; }
    chain = chain.then(run, run);
    return chain;
  }
  function schedule(): void {
    dirty = true;
    if(timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void flush(); }, delay);
  }
  return { schedule, flush };
}
