// Копирует собранный фронтенд (app/dist) в папку webDir Capacitor-проекта и делает резервную копию старой.
// Запуск: npm run build && npm run cap:copy   (затем в папке Capacitor: npx cap sync android)
// Путь к www: переменная CAP_WWW, по умолчанию ~/myapp/www (capacitor.config.json → "webDir": "www").
import { cpSync, existsSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'app/dist');
const www = resolve(process.env.CAP_WWW || join(homedir(), 'myapp/www'));

if(!existsSync(join(dist, 'index.html'))){
  console.error('Нет сборки app/dist — сначала выполните: npm run build');
  process.exit(1);
}
if(existsSync(www)){
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backup = www + '.bak-' + stamp;
  renameSync(www, backup);
  console.log('Старая папка сохранена: ' + backup);
}
cpSync(dist, www, { recursive: true });
rmSync(join(www, '.vite'), { recursive: true, force: true });
console.log('Скопировано в ' + www + '\nДальше: cd ' + dirname(www) + ' && npx cap sync android');
