// CLI лицензий GeoRomb — TypeScript-замена keygen.html. Запуск: npm run license -- <команда> [аргументы]
// Результат — revoked.json того же формата, что и раньше: его нужно загрузить в репозиторий
// bakhtiyararzimetov/GeoRomb (GitHub Pages), приложение скачивает его по REVOKE_URL.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ID_RE, PUBLIC_KEY, dateNum, formatId, normalizeId, signCode, signRevokedFile, verifyCode, verifyRevokedFile
} from '../../shared/license.ts';
import { DB_PATH, KEY_PATH, type IssuedRow, loadPrivateKey, loadRows, normalizeRow, savePrivateKey, saveRows, writeJson } from './store.ts';

const HELP = `Команды:
  init-key --from <keygen.html>     извлечь закрытый ключ из keygen.html в keys/private.jwk.json
  import <файл.json>                загрузить список, сохранённый в keygen.html («iwindoor-issued-codes.json»)
  list                              показать всех клиентов
  issue <ID> [--days N] [--name X]  выдать код (без --days — навсегда)
  extend <ID> --days N              продлить (0 — навсегда); новый код, если он был
  add-list <ID> [--days N] [--name X]  добавить в список без кода (клиент жмёт «Проверить»)
  revoke <ID> | unrevoke <ID>       отозвать / вернуть
  remove <ID>                       удалить из базы
  build [--out revoked.json]        собрать и подписать revoked.json
  verify <revoked.json>             проверить подпись файла списка
  verify-code <ID> <код>            проверить код активации

Пути: ключ ${KEY_PATH}
      база ${DB_PATH}`;

function parseArgs(argv: string[]): { pos: string[]; opt: Record<string, string> } {
  const pos: string[] = [], opt: Record<string, string> = {};
  for(let i = 0; i < argv.length; i++){
    const a = argv[i];
    if(a.startsWith('--')){ opt[a.slice(2)] = argv[i + 1] ?? ''; i++; }
    else pos.push(a);
  }
  return { pos, opt };
}
function needId(v: string | undefined): string {
  const id = normalizeId(v || '');
  if(!ID_RE.test(id)) throw new Error('ID должен состоять из 10 символов (XXXXX-XXXXX)');
  return id;
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function toDate(n: string): Date { const v = Number(n); return new Date(Math.floor(v / 10000), Math.floor(v / 100) % 100 - 1, v % 100); }
// без --days и --days 0 — навсегда; иначе только целое число дней: опечатка («3O», «-30», «30д») — ошибка,
// а не бессрочная лицензия
function expFromDays(days: string | undefined): string {
  if(days === undefined) return '0';
  if(!/^\d+$/.test(days.trim())) throw new Error('--days: нужно целое число дней (0 — навсегда), а не «' + days + '»');
  const n = Number(days);
  return n > 0 ? String(dateNum(addDays(new Date(), n))) : '0';
}
function fmtExp(exp: string): string { return exp === '0' ? 'навсегда' : exp.slice(6, 8) + '.' + exp.slice(4, 6) + '.' + exp.slice(0, 4); }
function upsert(rows: IssuedRow[], row: IssuedRow): void {
  const i = rows.findIndex(r => r.id === row.id);
  if(i >= 0) rows[i] = row; else rows.unshift(row);
}
function findRow(rows: IssuedRow[], id: string): IssuedRow {
  const r = rows.find(x => x.id === id);
  if(!r) throw new Error('Клиента ' + formatId(id) + ' нет в базе');
  return r;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parseArgs(rest);
  const rows = loadRows();

  switch(cmd){
    case 'init-key': {
      const html = readFileSync(resolve(opt.from || pos[0] || ''), 'utf8');
      const m = /const\s+PRIV\s*=\s*(\{[^;]*\})\s*;/.exec(html);
      if(!m) throw new Error('В файле не найден закрытый ключ (const PRIV = {...})');
      const key = JSON.parse(m[1]) as JsonWebKey;
      if(key.x !== PUBLIC_KEY.x || key.y !== PUBLIC_KEY.y || !key.d) throw new Error('Ключ в файле не соответствует приложению');
      savePrivateKey({ kty: 'EC', crv: 'P-256', x: key.x, y: key.y, d: key.d, ext: true });
      console.log('Ключ сохранён: ' + KEY_PATH + ' (не публикуйте этот файл)');
      return;
    }
    case 'import': {
      const d: unknown = JSON.parse(readFileSync(resolve(pos[0] || ''), 'utf8'));
      if(!Array.isArray(d)) throw new Error('Ожидался массив записей из keygen.html');
      let n = 0;
      d.forEach(x => { const r = normalizeRow(x); if(r){ upsert(rows, r); n++; } });
      saveRows(rows);
      console.log('Импортировано записей: ' + n);
      return;
    }
    case 'list': {
      if(!rows.length){ console.log('База пуста'); return; }
      rows.forEach(r => console.log(
        `${formatId(r.id)}  ${fmtExp(r.exp).padEnd(10)}  ${r.revoked ? 'ОТОЗВАН ' : ''}${r.list ? 'в списке ' : ''}${r.code ? 'код ' : ''}${r.name}`));
      return;
    }
    case 'issue': {
      const id = needId(pos[0]);
      const exp = expFromDays(opt.days);
      const prev = rows.find(r => r.id === id);
      const code = await signCode(loadPrivateKey(), id, exp);
      upsert(rows, { id, name: opt.name ?? prev?.name ?? '', exp, code, issued: dateNum(), revoked: !!prev?.revoked, list: !!prev?.list });
      saveRows(rows);
      console.log(code);
      return;
    }
    case 'extend': {
      const id = needId(pos[0]);
      const r = findRow(rows, id);
      if(opt.days === undefined || !/^\d+$/.test(opt.days.trim())) throw new Error('Укажите --days N — целое число дней (0 — навсегда)');
      const n = Number(opt.days);
      let exp = '0';
      if(n > 0){
        const base = r.exp === '0' || dateNum() > Number(r.exp) ? new Date() : toDate(r.exp);
        exp = String(dateNum(addDays(base, n)));
      }
      r.exp = exp; r.issued = dateNum();
      if(r.code || !r.list) r.code = await signCode(loadPrivateKey(), id, exp);
      saveRows(rows);
      console.log('Новый срок: ' + fmtExp(exp) + (r.code ? '\n' + r.code : '') + (r.list ? '\nСоберите и загрузите revoked.json' : ''));
      return;
    }
    case 'add-list': {
      const id = needId(pos[0]);
      const prev = rows.find(r => r.id === id);
      upsert(rows, { id, name: opt.name ?? prev?.name ?? '', exp: expFromDays(opt.days), code: prev?.code ?? '',
                     issued: dateNum(), revoked: !!prev?.revoked, list: true });
      saveRows(rows);
      console.log('Добавлено. Теперь: npm run license -- build');
      return;
    }
    case 'revoke':
    case 'unrevoke': {
      const r = findRow(rows, needId(pos[0]));
      r.revoked = cmd === 'revoke';
      saveRows(rows);
      console.log((r.revoked ? 'Отозван' : 'Возвращён') + '. Теперь: npm run license -- build');
      return;
    }
    case 'remove': {
      const id = needId(pos[0]);
      findRow(rows, id);
      saveRows(rows.filter(r => r.id !== id));
      console.log('Удалён из базы');
      return;
    }
    case 'build': {
      // порядок и отбор — как в keygen.html: подпись идёт над отсортированными списками
      const ids = rows.filter(r => r.revoked).map(r => r.id).sort();
      const lic = rows.filter(r => r.list && !r.revoked).map(r => ({ id: r.id, exp: r.exp }))
                      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const file = await signRevokedFile(loadPrivateKey(), ids, lic);
      if(!(await verifyRevokedFile(file))) throw new Error('Самопроверка подписи не прошла');
      const out = resolve(opt.out || 'revoked.json');
      writeJson(out, file);
      console.log(`Собран ${out}: по списку ${lic.length}, отозванных ${ids.length}.\nЗагрузите его в репозиторий GeoRomb вместо старого.`);
      return;
    }
    case 'verify': {
      const r = await verifyRevokedFile(JSON.parse(readFileSync(resolve(pos[0] || 'revoked.json'), 'utf8')));
      if(!r){ console.log('Подпись НЕВЕРНА'); process.exitCode = 1; return; }
      console.log(`Подпись верна. ts=${r.ts} (${new Date(r.ts * 1000).toLocaleString('ru-RU')}), по списку ${r.lic.length}, отозванных ${r.ids.length}`);
      return;
    }
    case 'verify-code': {
      const res = await verifyCode(pos[1] || '', needId(pos[0]));
      console.log(res.ok ? 'Код действителен, срок: ' + fmtExp(res.exp) : 'Код не принят: ' + res.why);
      if(!res.ok) process.exitCode = 1;
      return;
    }
    default:
      console.log(HELP);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
