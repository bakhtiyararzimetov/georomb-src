import type { GlassType, WinElement } from '../types.ts';

// ===== Цвет окна = стекло (стеклопакета). Хранится в элементе как e.glass. =====
// Тонированные в массе стёкла — серия AGC Planibel; lt — светопропускание LT, % для стекла 6 мм.
// У стекла нет HEX/RAL: цвет на экране приблизительный — считается из tint и lt.
export const GLASS_TYPES: GlassType[] = [
  { code:'clear',     name:'Прозрачный (Planibel Clear)',       tint:'#8fc4b8', lt:89, desc:'Светопропускание 89% (6 мм)' },
  { code:'bronze',    name:'Бронзовый (Planibel Bronze)',       tint:'#6b4423', lt:51, desc:'Светопропускание 51% (6 мм)' },
  { code:'grey',      name:'Серый (Planibel Grey)',             tint:'#3d4247', lt:44, desc:'Светопропускание 44% (6 мм)' },
  { code:'darkgrey',  name:'Тёмно-серый (Planibel Dark Grey)',  tint:'#1c1f23', lt:8,  desc:'Светопропускание 8% (6 мм)' },
  { code:'green',     name:'Зелёный (Planibel Green)',          tint:'#2f7d4f', lt:73, desc:'Светопропускание 73% (6 мм)' },
  { code:'azur',      name:'Голубой (Planibel Azur)',           tint:'#2fa4c9', lt:73, desc:'Светопропускание 73% (6 мм)' },
  { code:'darkblue',  name:'Синий (Planibel Dark Blue)',        tint:'#1c4f9a', lt:57, desc:'Светопропускание 57% (6 мм)' },
  { code:'privablue', name:'Тёмно-синий (Planibel PrivaBlue)',  tint:'#0a3a9e', lt:35, desc:'Светопропускание 35% (6 мм)' }
];
export const GLASS_DEFAULT = 'clear';
export const GLASS_NEW_DEFAULT = 'azur';   // стекло по умолчанию в форме нового элемента

export function findGlass(code: string | null | undefined): GlassType {
  return GLASS_TYPES.find(g => g.code === code) || GLASS_TYPES.find(g => g.code === GLASS_DEFAULT)!;
}
export function elementGlassName(e: WinElement | null | undefined): string { return findGlass(e && e.glass).name; }
// прозрачность заливки: чем ниже светопропускание, тем гуще цвет (для матового — молочная плотность)
export function glassAlpha(g: GlassType): number { return g.matte ? 0.8 : Math.min(0.96, Math.max(0.05, 1 - g.lt / 100)); }
// цвет стекла «на белом фоне» (для кружка в форме): смесь tint и белого по прозрачности
function glassOnWhite(g: GlassType): string {
  const a = glassAlpha(g), c = parseInt(g.tint.slice(1), 16);
  const mix = (v: number) => Math.round(255 * (1 - a) + v * a);
  return 'rgb(' + mix(c >> 16 & 255) + ',' + mix(c >> 8 & 255) + ',' + mix(c & 255) + ')';
}
export function glassSwatchCss(g: GlassType): string {
  return 'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.55), rgba(255,255,255,0) 55%), ' + glassOnWhite(g);
}
// <defs>-содержимое для заливки стекла: всегда id "glassGrad" (его же подменяют миниатюры и печать)
export function glassDefsSvg(code: string | null | undefined, W: number, H: number): string {
  const g = findGlass(code);
  const a = glassAlpha(g);
  const cl = (v: number) => Math.max(0, Math.min(1, v)).toFixed(3);
  if(g.matte){
    const p = (Math.max(W, H) || 1) / 110;
    return `<pattern id="glassGrad" width="${p.toFixed(3)}" height="${p.toFixed(3)}" patternUnits="userSpaceOnUse">
        <rect width="${p.toFixed(3)}" height="${p.toFixed(3)}" fill="#f1f4f6" fill-opacity="0.82"/>
        <circle cx="${(p*0.3).toFixed(3)}" cy="${(p*0.35).toFixed(3)}" r="${(p*0.11).toFixed(3)}" fill="#c3ccd2" fill-opacity="0.55"/>
        <circle cx="${(p*0.75).toFixed(3)}" cy="${(p*0.8).toFixed(3)}" r="${(p*0.09).toFixed(3)}" fill="#ffffff" fill-opacity="0.9"/>
      </pattern>`;
  }
  return `<linearGradient id="glassGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${g.tint}" stop-opacity="${cl(a * 0.78)}"/>
        <stop offset="0.5" stop-color="${g.tint}" stop-opacity="${cl(a * 1.08)}"/>
        <stop offset="0.9" stop-color="${g.tint}" stop-opacity="${cl(a * 0.78)}"/>
      </linearGradient>`;
}
