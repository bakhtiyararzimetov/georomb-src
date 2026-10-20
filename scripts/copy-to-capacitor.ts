// Копирует собранный фронтенд (app/dist) в папку webDir Capacitor-проекта (старую сохраняет рядом)
// и свой нативный код native/android/*.java в Android-проект.
// Запуск: npm run build && npm run cap:copy   (затем в папке Capacitor: npx cap sync android)
// Путь к www: переменная CAP_WWW, по умолчанию ~/myapp/www (capacitor.config.json → "webDir": "www").
import { cpSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'app/dist');
const www = resolve(process.env.CAP_WWW || join(homedir(), 'myapp/www'));

if(!existsSync(join(dist, 'index.html'))){
  console.error('Нет сборки app/dist — сначала выполните: npm run build');
  process.exit(1);
}
if(existsSync(www)){
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);   // с миллисекундами: два запуска подряд не совпадут
  const backup = www + '.bak-' + stamp;
  renameSync(www, backup);
  console.log('Старая папка сохранена: ' + backup);
}
// старых копий храним 2 последние — иначе они копятся с каждой сборкой
const KEEP_BACKUPS = 2;
const bakPrefix = basename(www) + '.bak-';
readdirSync(dirname(www)).filter(n => n.startsWith(bakPrefix)).sort().slice(0, -KEEP_BACKUPS)
  .forEach(n => rmSync(join(dirname(www), n), { recursive: true, force: true }));
cpSync(dist, www, { recursive: true });
rmSync(join(www, '.vite'), { recursive: true, force: true });
// свой нативный код (плагин FolderAccess и MainActivity) — в Android-проект рядом с www
const javaDir = join(dirname(www), 'android/app/src/main/java/app/georomb');
if(existsSync(javaDir)){
  for(const f of readdirSync(join(root, 'native/android')).filter(n => n.endsWith('.java'))){
    cpSync(join(root, 'native/android', f), join(javaDir, f));
    console.log('Нативный код: ' + f + ' → ' + javaDir);
  }
}else console.warn('Нет папки ' + javaDir + ' — нативный код (native/android) не скопирован');
console.log('Скопировано в ' + www + '\nДальше: cd ' + dirname(www) + ' && npx cap sync android');
