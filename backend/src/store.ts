// Хранилище бэкенда: закрытый ключ и база выданных кодов — локальные файлы, обе папки в .gitignore.
// Формат записей совпадает с экспортом keygen.html («Сохранить список в файл»), поэтому файлы взаимозаменяемы.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_KEY, normalizeId } from '../../shared/license.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const KEY_PATH = process.env.GEOROMB_KEY || resolve(ROOT, 'keys/private.jwk.json');
export const DB_PATH = process.env.GEOROMB_DB || resolve(ROOT, 'backend/data/issued.json');

export interface IssuedRow {
  id: string;
  name: string;
  exp: string;        // YYYYMMDD или "0"
  code: string;       // пусто — клиент только в списке (активация без кода)
  issued: number;     // YYYYMMDD
  revoked: boolean;
  list: boolean;      // попадает в lic[] revoked.json
}

function writeJson(path: string, data: unknown, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 1) + '\n', mode ? { mode } : undefined);
}

export function loadPrivateKey(): JsonWebKey {
  if(!existsSync(KEY_PATH)) throw new Error(`Нет закрытого ключа: ${KEY_PATH}\nСоздайте его командой: npm run license -- init-key --from ~/Downloads/keygen.html`);
  const key = JSON.parse(readFileSync(KEY_PATH, 'utf8')) as JsonWebKey;
  if(key.kty !== 'EC' || key.crv !== 'P-256' || !key.d) throw new Error('Файл ключа не похож на закрытый ключ P-256');
  // защита от чужого ключа: открытая часть обязана совпадать с ключом, вшитым в приложение
  if(key.x !== PUBLIC_KEY.x || key.y !== PUBLIC_KEY.y) throw new Error('Закрытый ключ не соответствует открытому ключу приложения');
  return { kty: 'EC', crv: 'P-256', x: key.x, y: key.y, d: key.d, ext: true };
}
export function savePrivateKey(key: JsonWebKey): void {
  writeJson(KEY_PATH, key, 0o600);
}

export function normalizeRow(x: Partial<IssuedRow>): IssuedRow | null {
  if(!x || typeof x.id !== 'string' || typeof x.exp !== 'string') return null;
  return {
    id: normalizeId(x.id), name: String(x.name || ''), exp: x.exp, code: String(x.code || ''),
    issued: Number(x.issued) || 0, revoked: !!x.revoked, list: !!x.list
  };
}
export function loadRows(path: string = DB_PATH): IssuedRow[] {
  if(!existsSync(path)) return [];
  const d: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if(!Array.isArray(d)) throw new Error('База выданных кодов повреждена: ожидался массив');
  return d.map(normalizeRow).filter((r): r is IssuedRow => r !== null);
}
export function saveRows(rows: IssuedRow[]): void {
  writeJson(DB_PATH, rows, 0o600);
}
export { writeJson };
