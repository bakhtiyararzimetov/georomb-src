// Иконка и заставка Android из логотипа «GeoR◆mb»: синие буквы, жёлтый ромб вместо «o», белый фон.
// Рисуется вектором (шрифт DejaVu Sans Bold из npm) — чёткие PNG любого размера.
// Запуск: node scripts/make-icons.ts [папка res]   (по умолчанию ~/myapp/android/app/src/main/res)
// Файлы перезаписываются по тем же именам и размерам, что сделал Capacitor.
import { Resvg } from '@resvg/resvg-js';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BLUE = '#1E5AA8', YELLOW = '#FFC72C', WHITE = '#FFFFFF';
const fontDir = join(dirname(createRequire(import.meta.url).resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const FONT = { fontFiles: [join(fontDir, 'DejaVuSans-Bold.ttf')], loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' };
const FS = 100;                                       // кегль, в котором меряем; дальше всё масштабируется

// ширина надписи в DejaVu Sans Bold — по рамке отрисованного текста (resvg считает её сам)
function textWidth(s: string): number {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="300"><text x="10" y="200" font-family="DejaVu Sans" font-weight="700" font-size="${FS}" fill="#000">${s}</text></svg>`;
  const b = new Resvg(svg, { font: FONT }).getBBox();
  if(!b) throw new Error('шрифт DejaVu Sans Bold не найден');
  return b.width;
}
const W_LEFT = textWidth('GeoR'), W_RIGHT = textWidth('mb');
const DIAMOND_W = 0.56 * FS, DIAMOND_H = 0.84 * FS, GAP = 0.06 * FS, CAP = 0.73 * FS;
const LOGO_W = W_LEFT + GAP + DIAMOND_W + GAP + W_RIGHT;

/** Надпись шириной width с центром в (cx, cy). */
function logo(cx: number, cy: number, width: number): string {
  const k = width / LOGO_W, x0 = cx - width / 2, base = cy + CAP / 2 * k;
  const dx = x0 + (W_LEFT + GAP + DIAMOND_W / 2) * k, dy = cy, hw = DIAMOND_W / 2 * k, hh = DIAMOND_H / 2 * k;
  const t = (x: number, s: string) =>
    `<text x="${x}" y="${base}" font-family="DejaVu Sans" font-weight="700" font-size="${FS * k}" fill="${BLUE}">${s}</text>`;
  return t(x0, 'GeoR')
    + `<polygon points="${dx},${dy - hh} ${dx + hw},${dy} ${dx},${dy + hh} ${dx - hw},${dy}" fill="${YELLOW}"/>`
    + t(x0 + (W_LEFT + GAP + DIAMOND_W + GAP) * k, 'mb');
}

type Shape = 'square' | 'round' | 'none';
/** Иконка size×size: фон (скруглённый квадрат, круг или прозрачный) и надпись шириной part от стороны. */
export function iconSvg(size: number, shape: Shape, part: number): string {
  const bg = shape === 'square' ? `<rect width="${size}" height="${size}" rx="${size * 0.215}" fill="${WHITE}"/>`
    : shape === 'round' ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${WHITE}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg}${logo(size / 2, size / 2, size * part)}</svg>`;
}
/** Заставка w×h: белый фон, надпись по центру. */
export function splashSvg(w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${WHITE}"/>${logo(w / 2, h / 2, Math.min(w, h) * 0.5)}</svg>`;
}
const png = (svg: string) => new Resvg(svg, { font: FONT }).render().asPng();

const DENSITY: Record<string, number> = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const SPLASH: Record<string, [number, number]> = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };

export function writeIcons(res: string): string[] {
  const out: string[] = [];
  const put = (rel: string, svg: string) => { writeFileSync(join(res, rel), png(svg)); out.push(rel); };
  for(const [d, k] of Object.entries(DENSITY)){
    const legacy = Math.round(48 * k), fg = Math.round(108 * k);
    put(`mipmap-${d}/ic_launcher.png`, iconSvg(legacy, 'square', 0.78));
    put(`mipmap-${d}/ic_launcher_round.png`, iconSvg(legacy, 'round', 0.74));
    // адаптивная иконка: слой 108 dp, лаунчер показывает центр 72 dp и может скруглить его в круг —
    // надпись держим в безопасной зоне (центральный круг 66 dp)
    put(`mipmap-${d}/ic_launcher_foreground.png`, iconSvg(fg, 'none', 0.56));
    const [w, h] = SPLASH[d];
    put(`drawable-port-${d}/splash.png`, splashSvg(w, h));
    put(`drawable-land-${d}/splash.png`, splashSvg(h, w));
  }
  put('drawable/splash.png', splashSvg(480, 320));
  // фон адаптивной иконки — белый, как у логотипа
  const bgXml = join(res, 'values/ic_launcher_background.xml');
  writeFileSync(bgXml, readFileSync(bgXml, 'utf8').replace(/(<color name="ic_launcher_background">)[^<]*(<\/color>)/, `$1${WHITE}$2`));
  out.push('values/ic_launcher_background.xml');
  return out;
}

if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  const res = resolve(process.argv[2] || join(homedir(), 'myapp/android/app/src/main/res'));
  if(!existsSync(join(res, 'values/ic_launcher_background.xml'))){
    console.error('Не найдена папка res Android-проекта: ' + res);
    process.exit(1);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  writeFileSync(join(root, 'assets/icon.png'), png(iconSvg(1024, 'square', 0.78)));
  console.log(writeIcons(res).length + ' файлов в ' + res + '\nassets/icon.png — логотип 1024×1024');
}
