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
}

export function createAutoBackup(o: AutoBackupOptions): { schedule(): void; flush(): Promise<boolean> } {
  const now = o.now || (() => new Date());
  const delay = o.delayMs ?? 3000;
  let dirty = false, timer: ReturnType<typeof setTimeout> | null = null, permAsked = false;
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
  async function run(): Promise<boolean> {
    if(!dirty) return false;
    dirty = false;
    const today = now();
    const path = BACKUP_DIR + '/' + backupFileName(today, o.tag);
    const data = o.getJson();
    try{
      try{ await write(path, data); }
      catch(err){
        // Android ≤ 10: без разрешения на память запись падает — спрашиваем один раз за сеанс и повторяем
        if(permAsked || !o.fs.checkPermissions || !o.fs.requestPermissions) throw err;
        permAsked = true;
        const p = await o.fs.checkPermissions();
        if(p.publicStorage === 'granted' || (await o.fs.requestPermissions()).publicStorage !== 'granted') throw err;
        await write(path, data);
      }
    }catch(err){
      console.warn('Автокопия не сохранена:', err);
      return false;                          // dirty уже сброшен: следующее изменение попробует снова
    }
    await prune(today);
    return true;
  }

  return {
    schedule(): void {
      dirty = true;
      if(timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void this.flush(); }, delay);
    },
    flush(): Promise<boolean> {
      if(timer){ clearTimeout(timer); timer = null; }
      chain = chain.then(run, run);
      return chain;
    }
  };
}
