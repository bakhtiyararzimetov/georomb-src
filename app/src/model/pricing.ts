// Расчёт стоимости (порт PriceSettingActivity + PriceEstimateActivity старого проекта).
import { DEFAULT_QTY, DEFAULT_SILL_DEPTH, DEFAULT_UNIT_LENGTH, S } from '../state.ts';
import { notifyDataChanged } from '../storage.ts';
import type { Mat, PriceSettings, Project, Rect, SubLayout, TreeNode, WasteMode, WinElement } from '../types.ts';
import { findColor, projectMat } from '../data/colors.ts';
import { NET_OVERLAP, REINF_MULLION_OFFSET, profileFor, sashInset, sashOverhang, sashProfile } from '../data/profiles.ts';
import { findGlass } from '../data/glass.ts';
import { computeLayout, insetRect, layoutNode, parseMm } from './layout.ts';
import { cutOptimize } from './cutOptimizer.ts';

export const PRICE_STORAGE_KEY = 'iwd.priceSettings.v2';

// ширины полки подоконника, см — у каждой своя цена за метр
export const SILL_WIDTHS = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
const sillPriceDefaults = (): Record<number, number> => SILL_WIDTHS.reduce<Record<number, number>>((o, w) => { o[w] = 0; return o; }, {});

export const PRICE_DEFAULTS: PriceSettings = {
  profile: {                                   // за погонный метр
    pvc: { frame:0, mullion:0, wSash:0, dSash:0, slidFrame:0, slidSash:0 },
    alu: { frame:0, mullion:0, wSash:0, dSash:0, slidFrame:0, slidSash:0 }
  },
  accessory: { Turn:0, TiltTurn:0, Tilt:0, Door:0, Sliding:0 }, // за створку
  glass: 0,                                    // за м²
  panel: { pvc:0, alu:0 },                     // за м²
  sill: sillPriceDefaults(),                   // за погонный метр, по ширине полки (см)
  reinf: 0,                                    // армирование ПВХ, за метр
  net: 0,                                      // москитная сетка, за м²
  waste: { mode:'none', percent:3 },           // отходы профиля в цене
  tax: 0,                                      // %
  currency: 'KZT',
  decimals: 0,
  glassByType: {},                             // за м² по виду стекла; нет цены — как glass
  bead: 0,                                     // штапик, за метр
  seal: 0,                                     // уплотнитель, за метр
  colorPct: { colored:0, laminated:0 },        // доплата к профилю, %
  works: { install:0, dismantle:0, slopes:0, delivery:0 }
};

export type ProfileKey = keyof PriceSettings['profile']['pvc'];
export type AccKey = keyof PriceSettings['accessory'];

// порядок полей — как на экране старого проекта
export const PROFILE_PARTS: [ProfileKey, string][] = [
  ['frame',     'Рама'],
  ['mullion',   'Средник'],
  ['wSash',     'Оконная рама'],
  ['dSash',     'Дверной пояс'],
  ['slidFrame', 'Раздвижная рама'],
  ['slidSash',  'Раздвижная лента']
];
export const ACC_PARTS: [AccKey, string][] = [
  ['Turn',     'Поворот'],
  ['TiltTurn', 'Наклон и поворот'],
  ['Tilt',     'Наклон'],
  ['Door',     'Дверь'],
  ['Sliding',  'Раздвижной']
];
// порядок профилей в СМЕТЕ
const EST_PROFILE_ORDER = (['frame', 'slidFrame', 'mullion', 'wSash', 'slidSash', 'dSash'] as ProfileKey[])
  .map(k => PROFILE_PARTS.find(part => part[0] === k)!);

export const WASTE_MODES: [WasteMode, string, string][] = [
  ['none',    'Без отходов (0%)',            'В цену идёт только длина деталей'],
  ['percent', 'Процент от профиля',          'К стоимости профиля добавляется указанный процент'],
  ['full',    'По полной длине',             'В цену идут все целые хлысты, нужные по раскрою'],
  ['smart',   'По минимальным размерам',     'Куски короче мин. обрезка и пропилы — в цену, деловые обрезки — нет']
];
export const isWasteMode = (v: unknown): v is WasteMode => WASTE_MODES.some(m => m[0] === v);

export function clonePriceDefaults(): PriceSettings { return JSON.parse(JSON.stringify(PRICE_DEFAULTS)) as PriceSettings; }

export function loadPriceSettings(): PriceSettings {
  const base = clonePriceDefaults();
  try{
    const raw = localStorage.getItem(PRICE_STORAGE_KEY);
    if(raw){
      const s = JSON.parse(raw) as Partial<PriceSettings> & { sill?: number | Record<number, number> };
      (['pvc','alu'] as Mat[]).forEach(m => Object.assign(base.profile[m], (s.profile && s.profile[m]) || {}));
      Object.assign(base.accessory, s.accessory || {});
      Object.assign(base.panel,     s.panel     || {});
      if(s.glass    != null) base.glass    = s.glass;
      // старый формат: sill — одно число на все ширины
      if(s.sill != null){
        if(typeof s.sill === 'object') Object.assign(base.sill, s.sill);
        else { const v = s.sill; SILL_WIDTHS.forEach(w => { base.sill[w] = v; }); }
      }
      if(s.reinf    != null) base.reinf    = s.reinf;
      if(s.net      != null) base.net      = s.net;
      if(s.waste && typeof s.waste === 'object'){
        if(isWasteMode(s.waste.mode)) base.waste.mode = s.waste.mode;
        if(s.waste.percent != null) base.waste.percent = Number(s.waste.percent) || 0;
      }
      if(s.tax      != null) base.tax      = s.tax;
      if(s.currency)         base.currency = s.currency;
      if(s.decimals != null) base.decimals = s.decimals;
      if(s.glassByType && typeof s.glassByType === 'object') Object.assign(base.glassByType, s.glassByType);
      if(s.bead != null) base.bead = Number(s.bead) || 0;
      if(s.seal != null) base.seal = Number(s.seal) || 0;
      if(s.colorPct && typeof s.colorPct === 'object') Object.assign(base.colorPct, s.colorPct);
      if(s.works && typeof s.works === 'object') Object.assign(base.works, s.works);
    }
  }catch{ /* localStorage недоступен — работаем на дефолтах */ }
  return base;
}
export function persistPriceSettings(): void {
  try{ localStorage.setItem(PRICE_STORAGE_KEY, JSON.stringify(S.prices)); }catch{ /* без сохранения */ }
  notifyDataChanged();
}

export function fmtMoney(v: number): string {
  const d = S.prices.decimals | 0;
  return (v||0).toLocaleString('ru-RU', { minimumFractionDigits:0, maximumFractionDigits:d }) + ' ' + S.prices.currency;
}
export function fmtNum(v: number, d?: number, maxD?: number): string {
  d = (d == null) ? 2 : d;
  return (v||0).toLocaleString('ru-RU', { minimumFractionDigits:d, maximumFractionDigits:(maxD == null ? d : maxD) });
}
// как Java DecimalFormat (HALF_EVEN): при ровно половине — к чётному
export function roundHalfEven(v: number, d: number): number {
  const f = Math.pow(10, d);
  const x = v * f;
  const r = Math.floor(x);
  if(Math.abs((x - r) - 0.5) < 1e-9) return (r % 2 === 0 ? r : r + 1) / f;
  return Math.round(x) / f;
}
// формат цены в резюме — как в старом проекте: "157,300 ( RUB )"
export function fmtSummaryMoney(v: number): string {
  const d = S.prices.decimals | 0;
  const n = roundHalfEven(v || 0, d);
  return n.toLocaleString('en-US', { minimumFractionDigits:0, maximumFractionDigits:d }) + ' ( ' + S.prices.currency + ' )';
}

export type PieceRole = 'frame' | 'mullion' | 'wSash' | 'dSash' | 'slidFrame' | 'slidSash' | 'bead' | 'panel' | 'reinf' | 'net';
/** Прямоугольная деталь (стекло, сетка), мм. */
export interface Pane { w: number; h: number; }
export interface Geometry {
  W: number; H: number; area: number; frameLen: number; mullionLen: number; sashWinLen: number; sashDoorLen: number;
  glassArea: number; panelArea: number; sashCount: number; acc: Partial<Record<AccKey, number>>;
  sillLen: number; sillWidth: number; profileLen: number;
  len: Partial<Record<ProfileKey, number>>;
  pieces: Record<PieceRole, number[]>;
  glasses: Pane[];             // стёкла (без панелей) — для стекольщика и раскроя листов
  nets: Pane[];                // москитные сетки
  netArea: number;             // м²
  beadLen: number;             // штапик, м
  sealLen: number;             // уплотнитель, м: 2 × периметр стёкол + периметр створок
  reinfLen: number;            // м, армирование (только ПВХ)
}
// отступ армирования рамы и створок с каждой стороны; настройки раскроя могут быть ещё не загружены
const reinfOffset = () => (S.cutting && S.cutting.reinfOffset >= 0) ? S.cutting.reinfOffset : 40;

// --- геометрия элемента: формулы старого проекта ---
//   рама и створка: периметр по ВНЕШНЕЙ кромке + припуск на сварку weld*2 на сторону;
//   импост: длина стороны ячейки + weld*2; створка: внешний размер = ячейка + 2*(sashB − sashGap);
//   стекло/панель: (ячейка перед штапиком − 2*glassGap). Штапик, Interlock и Front Locking в длину не входят.
/** Ближайшая ширина полки из прайса (см) к глубине отдельного подоконника; при равенстве — бо́льшая. */
function nearestSillWidth(depthMm: number): number {
  const cm = depthMm / 10;
  return SILL_WIDTHS.reduce((best, w) => Math.abs(w - cm) <= Math.abs(best - cm) ? w : best, SILL_WIDTHS[0]);
}
function sillGeometry(e: WinElement): Geometry {
  // отдельный подоконник: ширина элемента — длина, высота — глубина полки (как в раскрое и 3D)
  const W = parseMm(e.width), H = parseMm(e.height);
  const len = W > 0 ? W : 0, depth = H > 0 ? H : DEFAULT_SILL_DEPTH;
  return { W: len, H: depth, area: 0, frameLen: 0, mullionLen: 0, sashWinLen: 0, sashDoorLen: 0,
           glassArea: 0, panelArea: 0, sashCount: 0, acc: {}, sillLen: len / 1000, sillWidth: nearestSillWidth(depth),
           profileLen: 0, len: {}, pieces: { frame:[], mullion:[], wSash:[], dSash:[], slidFrame:[], slidSash:[], bead:[], panel:[], reinf:[], net:[] },
           glasses: [], nets: [], netArea: 0, reinfLen: 0, beadLen: 0, sealLen: 0 };
}

export function elementGeometry(e: WinElement, mat: Mat): Geometry {
  if(e.type === 'sill') return sillGeometry(e);
  const prof = profileFor({ type:mat });
  const out = computeLayout(e, prof);
  const { W, H } = out;
  const sliding = (e.type === 'sliding');
  const weldSide = 2 * prof.weld;
  const gg = prof.glassGap;
  const overhang = sashOverhang(prof);

  const g: Geometry = { W, H, area: W*H/1e6, frameLen: (2*(W+H) + 4*weldSide)/1000,
              mullionLen:0, sashWinLen:0, sashDoorLen:0,
              glassArea:0, panelArea:0, sashCount:0, acc:{},
              sillLen: e.sill ? (parseFloat(String(e.sillLen)) || 0) : 0,
              sillWidth: e.sill ? (parseFloat(String(e.sillWidth)) || 20) : 0,
              profileLen:0, len:{}, pieces:{ frame:[], mullion:[], wSash:[], dSash:[], slidFrame:[], slidSash:[], bead:[], panel:[], reinf:[], net:[] },
              glasses:[], nets:[], netArea:0, reinfLen:0, beadLen:0, sealLen:0 };

  // длины отдельных деталей в мм по ролям — для раскроя (в смету не входят)
  const pieces = g.pieces;
  const frameRole: PieceRole = sliding ? 'slidFrame' : 'frame';
  pieces[frameRole].push(W + weldSide, W + weldSide, H + weldSide, H + weldSide);

  // у раздвижных Interlock / Front Locking не оплачиваются
  if(!sliding) out.allMullions.forEach(m => {
    const len = Math.max(m.w, m.h) + weldSide;
    g.mullionLen += len/1000;
    pieces.mullion.push(len);
  });

  const cells = new Map<TreeNode, Rect>();
  out.leaves.forEach(l => cells.set(l.node, l.cell || l.rect));

  const bead = prof.bead, slat = Math.max(1, prof.panelSlat || 100);
  const addFill = (node: TreeNode, cell: Rect) => {
    const w = Math.max(0, cell.w - 2*gg), h = Math.max(0, cell.h - 2*gg);
    const a = w * h / 1e6;
    if(node.fill === 'panelV' || node.fill === 'panelH') g.panelArea += a;
    else { g.glassArea += a; if(w > 0 && h > 0) g.glasses.push({ w:Math.round(w), h:Math.round(h) }); }
    if(cell.w > 0 && cell.h > 0) pieces.bead.push(cell.w, cell.w, cell.h, cell.h);
    if(node.fill === 'panelV' || node.fill === 'panelH'){
      const pw = cell.w - 2*bead, ph = cell.h - 2*bead, vert = (node.fill === 'panelV');
      if(pw > 0 && ph > 0){
        const n = Math.ceil(((vert ? pw : ph) - 0.5) / slat);
        for(let i = 0; i < n; i++) pieces.panel.push(vert ? ph : pw);
      }
    }
  };
  out.leaves.forEach(l => {
    const n = l.node;
    const cell = cells.get(n) || l.rect;
    if(!n.opening){ addFill(n, cell); return; }

    const sashT = sashProfile(prof, n.opening);
    let outer: Rect, sashInner: Rect;
    if(sliding){
      outer = l.rect;
      sashInner = insetRect(outer, sashT);
    }else{
      outer = { x:cell.x - overhang, y:cell.y - overhang, w:cell.w + 2*overhang, h:cell.h + 2*overhang };
      sashInner = insetRect(cell, sashInset(prof, n.opening));
    }
    const per = (2*(outer.w + outer.h) + 4*weldSide)/1000;
    const sashRole: PieceRole = sliding ? 'slidSash' : (n.opening.type === 'Door' ? 'dSash' : 'wSash');
    if(n.opening.type === 'Door') g.sashDoorLen += per; else g.sashWinLen += per;
    pieces[sashRole].push(outer.w + weldSide, outer.w + weldSide, outer.h + weldSide, outer.h + weldSide);
    g.sashCount++;
    // раздвижные: фурнитура только у подвижных
    const key = (sliding ? (n.opening.type === 'Sliding' ? 'Sliding' : null) : n.opening.type) as AccKey | null;
    if(key) g.acc[key] = (g.acc[key] || 0) + 1;
    // москитная сетка: у створчатых — проём створки + заход на раму, у раздвижных — по подвижной створке
    if(e.net && (!sliding || n.opening.type === 'Sliding')){
      const nw = Math.round(sliding ? outer.w : cell.w + 2*NET_OVERLAP), nh = Math.round(sliding ? outer.h : cell.h + 2*NET_OVERLAP);
      if(nw > 0 && nh > 0){
        g.nets.push({ w:nw, h:nh });
        g.netArea += nw * nh / 1e6;
        pieces.net.push(nw, nw, nh, nh);
      }
    }

    if(!sliding && n.inner){
      // створка с переплётом: раскладываем КОПИЮ узла, чтобы не трогать node.sizes чертежа
      const io: SubLayout = { leaves:[], mullions:[] };
      layoutNode(JSON.parse(JSON.stringify(n.inner)) as TreeNode, sashInner, io, prof);
      io.mullions.forEach(m => {
        const len = Math.max(m.w, m.h) + weldSide;
        g.mullionLen += len/1000;
        pieces.mullion.push(len);
      });
      io.leaves.forEach(il => addFill(il.node, il.rect));
      return;
    }
    addFill(n, sashInner);
  });

  // армирование ПВХ: в раму, импосты и створки, короче детали на отступ с каждой стороны
  if(mat === 'pvc'){
    const off = reinfOffset();
    const add = (len: number, cut: number) => { const r = Math.round(len - 2*cut); if(r > 0){ pieces.reinf.push(r); g.reinfLen += r/1000; } };
    (['frame', 'slidFrame', 'wSash', 'dSash', 'slidSash'] as PieceRole[]).forEach(role => pieces[role].forEach(len => add(len, off)));
    pieces.mullion.forEach(len => add(len, REINF_MULLION_OFFSET));
  }

  g.profileLen = g.frameLen + g.mullionLen + g.sashWinLen + g.sashDoorLen;
  g.len = sliding
    ? { slidFrame:g.frameLen, slidSash:g.sashWinLen + g.sashDoorLen }
    : { frame:g.frameLen, mullion:g.mullionLen, wSash:g.sashWinLen, dSash:g.sashDoorLen };
  // штапик — длины деталей штапика; уплотнитель — с двух сторон каждого стекла и по периметру створок
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  g.beadLen = sum(g.pieces.bead) / 1000;
  g.sealLen = (2 * g.glasses.reduce((a, p) => a + 2 * (p.w + p.h), 0) + sum(g.pieces.wSash) + sum(g.pieces.dSash) + sum(g.pieces.slidSash)) / 1000;
  return g;
}

/** Короткое имя стекла для сметы: «Бронзовый (Planibel Bronze)» → «Бронзовый». */
export const glassShortName = (code: string): string => findGlass(code).name.replace(/\s*\(.*$/, '');
export type ColorClass = 'white' | 'colored' | 'laminated';
/** Белый или без цвета — без доплаты; плёнка под дерево — ламинация; остальное — цветной профиль. */
export function colorClass(e: WinElement, project: Project | null | undefined): ColorClass {
  const c = findColor(project, e.color || '');
  if(!c || /^ral9016a?$/.test(c.code)) return 'white';
  return c.laminate ? 'laminated' : 'colored';
}

/** Сколько штук раскраивать / заказывать: 0 — ничего, дробное (0,4) — хотя бы 1, не число — по умолчанию. */
export function pieceCount(qty: unknown): number {
  const q = parseMm(qty);
  if(!Number.isFinite(q)) return DEFAULT_QTY;
  return q > 0 ? Math.max(1, Math.round(q)) : 0;
}

export interface ElementCost {
  g: Geometry; qty: number; mat: Mat;
  profileCost: number; glassCost: number; panelCost: number; sillCost: number; accCost: number;
  reinfCost: number; netCost: number;
  beadCost: number; sealCost: number; colorCost: number;   // штапик, уплотнитель, доплата за цвет профиля
  glassCode: string; glassRate: number; color: ColorClass;
  unit: number; total: number; roundedTotal?: number;
}
export function calcElement(e: WinElement, project: Project | null | undefined): ElementCost {
  const mat = projectMat(project);
  const g = elementGeometry(e, mat);
  const ps = S.prices;
  const p = ps.profile[mat];
  const sliding = (e.type === 'sliding');
  const frameRate = sliding ? p.slidFrame : p.frame;
  const sashRate  = sliding ? p.slidSash  : p.wSash;
  const doorRate  = sliding ? p.slidSash  : p.dSash;
  const profileCost = g.frameLen * frameRate + g.mullionLen * p.mullion + g.sashWinLen * sashRate + g.sashDoorLen * doorRate;
  const glassCode = findGlass(e.glass).code;
  const glassRate = (ps.glassByType && ps.glassByType[glassCode]) || ps.glass;   // цена вида стекла или общая
  const glassCost = g.glassArea * glassRate;
  const panelCost = g.panelArea * ps.panel[mat];
  const sillRate  = (ps.sill && ps.sill[g.sillWidth]) || 0;
  const sillCost  = (g.sillLen || 0) * sillRate;
  let accCost = 0;
  (Object.keys(g.acc) as AccKey[]).forEach(k => { accCost += (g.acc[k] || 0) * (ps.accessory[k] || 0); });
  const reinfCost = g.reinfLen * (ps.reinf || 0);
  const netCost   = g.netArea * (ps.net || 0);
  const beadCost  = g.beadLen * (ps.bead || 0);
  const sealCost  = g.sealLen * (ps.seal || 0);
  const color = colorClass(e, project);
  const pct = color === 'colored' ? ps.colorPct.colored : color === 'laminated' ? ps.colorPct.laminated : 0;
  const colorCost = profileCost * (Number(pct) || 0) / 100;
  const unit = profileCost + glassCost + panelCost + sillCost + accCost + reinfCost + netCost + beadCost + sealCost + colorCost;
  const q = parseMm(e.qty), qty = (Number.isFinite(q) && q >= 0) ? q : DEFAULT_QTY;   // 0 шт — это 0, а не 1
  return { g, qty, mat, profileCost, glassCost, panelCost, sillCost, accCost, reinfCost, netCost, beadCost, sealCost, colorCost,
           glassCode, glassRate, color, unit, total: unit * qty };
}

export interface EstimateLine { name: string; qty: number; unit: string; price: number; sum: number; }
export interface ProfileWaste { mode: WasteMode; m: number; cost: number; bars: number; }
export interface ProjectCost {
  items: ElementCost[]; lines: EstimateLine[]; subtotal: number; taxRate: number; tax: number; grand: number;
  discount: number;            // скидка в валюте (из процента или суммы проекта)
  advance: number; due: number;   // аванс и остаток к оплате
  waste: ProfileWaste | null;
  totals: { qty: number; area: number; glassArea: number; profileLen: number; sillLen: number; netArea: number; reinfLen: number };
}
type RawLine = Omit<EstimateLine, 'sum'> & { fixedSum?: number };

// роли профиля, которые идут в цену, и их цена за метр
const PRICED_ROLES: PieceRole[] = ['frame', 'slidFrame', 'mullion', 'wSash', 'slidSash', 'dSash'];
function roleRate(role: PieceRole, mat: Mat): number {
  if(role === 'reinf') return mat === 'pvc' ? (S.prices.reinf || 0) : 0;
  return (S.prices.profile[mat] as Record<string, number>)[role] || 0;
}
/**
 * Отходы по раскрою (режимы full и smart): детали каждой роли и цвета раскладываются по хлыстам
 * тем же оптимизатором, что и экран «Раскрой», но без склада и без случайного поиска — результат всегда одинаковый.
 */
export function profileCutWaste(project: Project, items: ElementCost[], mode: 'full' | 'smart'): ProfileWaste {
  const mat = projectMat(project);
  const cs = S.cutting;
  const C = { k:cs ? cs.kerf : 5, minScrap:cs ? cs.minRemnant : 140, trimMax:cs ? cs.trimMax : 80 };
  const groups = new Map<string, { role: PieceRole; lens: number[] }>();
  const roles = (S.prices.reinf > 0 && mat === 'pvc') ? [...PRICED_ROLES, 'reinf' as PieceRole] : PRICED_ROLES;
  project.elements.forEach((e, i) => {
    const c = items[i];
    const qty = pieceCount(e.qty);
    roles.forEach(role => {
      const lens = c.g.pieces[role];
      if(!lens.length || !qty) return;
      // группа по цвету — как в раскрое: неизвестный код считается «без цвета»
      const col = findColor(project, e.color || '');
      const key = role + '|' + (role === 'reinf' ? '' : (col ? col.code : ''));
      if(!groups.has(key)) groups.set(key, { role, lens:[] });
      const gr = groups.get(key)!;
      // длина без дробной части — как в раскрое
      for(let q = 0; q < qty; q++) lens.forEach(len => { const mm = Math.floor(len + 1e-9); if(mm > 0) gr.lens.push(mm); });
    });
  });
  let m = 0, cost = 0, bars = 0;
  groups.forEach(gr => {
    const L = (cs && cs.roleUnit[mat] && cs.roleUnit[mat][gr.role]) || (cs ? cs.unitLength[mat] : DEFAULT_UNIT_LENGTH[mat]);
    const v = cutOptimize(gr.lens, L, C, [], 0).variants[0];
    if(!v) return;
    const mm = mode === 'full' ? v.totalMm - v.usedMm : v.wasteMm + v.kerfMm;
    m += mm / 1000;
    cost += mm / 1000 * roleRate(gr.role, mat);
    bars += v.newBars;
  });
  return { mode, m, cost, bars };
}

export function calcProject(project: Project): ProjectCost {
  const items = project.elements.map(e => calcElement(e, project));
  const ps = S.prices;
  const taxRate  = parseFloat(String(ps.tax)) || 0;
  // смета в стиле старого проекта: строки сгруппированы по названию позиции
  const mat = projectMat(project);
  const d = Math.max(0, ps.decimals | 0);
  const p = ps.profile[mat];
  const wmode = (ps.waste && ps.waste.mode) || 'none';
  const pct = Math.max(0, Number(ps.waste && ps.waste.percent) || 0);
  const cutWaste = (wmode === 'full' || wmode === 'smart') && items.length ? profileCutWaste(project, items, wmode) : null;
  // cut — отходы по раскрою (только для всего проекта; у элемента по отдельности их не посчитать)
  const buildLines = (list: ElementCost[], cut: ProfileWaste | null, withWorks: boolean): EstimateLine[] => {
    const sumBy = (fn: (g: Geometry) => number, only?: (c: ElementCost) => boolean) =>
      list.reduce((a, c) => a + (only && !only(c) ? 0 : fn(c.g) * c.qty), 0);
    const raw: RawLine[] = [];
    EST_PROFILE_ORDER.forEach(([k, label]) => raw.push({ name:label, unit:'м',  price:p[k] || 0,
      qty: sumBy(g => (g.len && g.len[k]) || 0) }));
    // армирование — строкой только когда у него есть цена (иначе смета прежняя)
    if(mat === 'pvc' && ps.reinf > 0) raw.push({ name:'Армирование', unit:'м', price:ps.reinf, qty: sumBy(g => g.reinfLen) });
    const profileRaw = raw.slice();
    if(wmode === 'percent' && pct > 0){
      // процент считается от уже округлённых строк профиля — так сумма сходится с тем, что видно в смете
      const done = profileRaw.filter(l => l.qty > 1e-9).map(l => roundHalfEven(roundHalfEven(l.price, d) * roundHalfEven(l.qty, 1), d));
      const qty = profileRaw.reduce((a, l) => a + l.qty, 0) * pct / 100;
      raw.push({ name:'Отходы профиля, ' + fmtNum(pct, 0, 2) + '%', unit:'м', price:0, qty, fixedSum: done.reduce((a, x) => a + x, 0) * pct / 100 });
    }else if(cut && cut.m > 1e-9){
      raw.push({ name:'Отходы профиля (' + (cut.mode === 'full' ? 'по полной длине' : 'по мин. размерам') + ')', unit:'м', price:0, qty:cut.m, fixedSum:cut.cost });
    }
    ACC_PARTS.forEach(([k, label]) => raw.push({ name:label, unit:'шт', price:ps.accessory[k] || 0,
      qty: sumBy(g => g.acc[k] || 0) }));
    // стекло: если заданы цены по видам — строкой на каждый вид, иначе одной строкой, как раньше
    if(ps.glassByType && Object.values(ps.glassByType).some(v => Number(v) > 0)){
      [...new Set(list.map(c => c.glassCode))].forEach(code => raw.push({ name:'Стекло: ' + glassShortName(code), unit:'м²',
        price: (ps.glassByType[code] || ps.glass || 0), qty: sumBy(g => g.glassArea, c => c.glassCode === code) }));
    }else raw.push({ name:'Стекло', unit:'м²', price:ps.glass || 0, qty: sumBy(g => g.glassArea) });
    raw.push({ name:'Панель', unit:'м²', price:ps.panel[mat] || 0, qty: sumBy(g => g.panelArea) });
    raw.push({ name:'Москитная сетка', unit:'м²', price:ps.net || 0, qty: sumBy(g => g.netArea) });
    SILL_WIDTHS.forEach(w => raw.push({ name:'Подоконник, ' + w + ' см', unit:'м',
      price:(ps.sill && ps.sill[w]) || 0,
      qty: sumBy(g => (g.sillWidth === w ? (g.sillLen || 0) : 0)) }));
    // новые статьи — только с ценой: у кого их нет, смета прежняя
    if(ps.bead > 0) raw.push({ name:'Штапик', unit:'м', price:ps.bead, qty: sumBy(g => g.beadLen) });
    if(ps.seal > 0) raw.push({ name:'Уплотнитель', unit:'м', price:ps.seal, qty: sumBy(g => g.sealLen) });
    ([['colored', 'цветной профиль'], ['laminated', 'ламинация']] as const).forEach(([cls, label]) => {
      const pc = Number(ps.colorPct[cls]) || 0;
      if(pc <= 0) return;
      const of = list.filter(c => c.color === cls);
      if(!of.length) return;
      // от округлённых строк профиля этих элементов — сумма сходится с тем, что видно в смете
      const only = (c: ElementCost) => c.color === cls;
      const base = EST_PROFILE_ORDER.reduce((acc, [k]) => {
        const q = sumBy(g => (g.len && g.len[k]) || 0, only);
        return q > 1e-9 ? acc + roundHalfEven(roundHalfEven(p[k] || 0, d) * roundHalfEven(q, 1), d) : acc;
      }, 0);
      raw.push({ name:'Доплата: ' + label + ', ' + fmtNum(pc, 0, 2) + '%', unit:'м', price:0,
        qty: of.reduce((a, c) => a + c.g.profileLen * c.qty, 0), fixedSum: base * pc / 100 });
    });
    if(withWorks && project.works){
      const wk = project.works, wp = ps.works;
      const windows = (c: ElementCost) => c.g.area > 0;                    // отдельный подоконник — не окно
      if(wk.install && wp.install > 0)   raw.push({ name:'Монтаж',   unit:'м²', price:wp.install,   qty: sumBy(g => g.area) });
      if(wk.dismantle && wp.dismantle > 0) raw.push({ name:'Демонтаж', unit:'м²', price:wp.dismantle, qty: sumBy(g => g.area) });
      if(wk.slopes && wp.slopes > 0)     raw.push({ name:'Откосы',   unit:'м',  price:wp.slopes,    qty: sumBy(g => (2 * g.H + g.W) / 1000, windows) });
      if(wk.delivery && wp.delivery > 0) raw.push({ name:'Доставка', unit:'шт', price:wp.delivery,  qty: 1 });
    }
    return raw.filter(l => l.qty > 1e-9).map(l => {
      const qty = roundHalfEven(l.qty, l.unit === 'шт' ? 0 : 1);
      if(l.fixedSum != null){
        const sum = roundHalfEven(l.fixedSum, d);
        return { name:l.name, qty, unit:l.unit, price: qty ? roundHalfEven(sum / qty, d) : 0, sum };
      }
      const unitPrice = roundHalfEven(l.price, d);          // цена округляется ДО умножения
      return { name:l.name, qty, unit:l.unit, price:unitPrice, sum: roundHalfEven(unitPrice * qty, d) };
    });
  };
  const lines = buildLines(items, cutWaste, true);
  items.forEach(c => { c.roundedTotal = buildLines([c], null, false).reduce((a, l) => a + l.sum, 0); });   // работы — только в проекте
  const subtotal = lines.reduce((a, l) => a + l.sum, 0);
  // скидка → налог со суммы после скидки → итого → аванс → остаток; ни одна сумма не уходит в минус
  const dsc = project.discount, dv = Math.max(0, Number(dsc && dsc.value) || 0);
  const discount = Math.min(subtotal, roundHalfEven(dsc && dsc.mode === 'pct' ? subtotal * Math.min(100, dv) / 100 : dv, d));
  const tax      = roundHalfEven((subtotal - discount) * taxRate / 100, d);
  const grand    = roundHalfEven(subtotal - discount + tax, d);
  const advance  = roundHalfEven(Math.max(0, Number(project.advance) || 0), d);
  const due      = Math.max(0, roundHalfEven(grand - advance, d));
  return {
    items, lines, subtotal, taxRate, tax, grand, discount, advance, due, waste: cutWaste,
    totals: {
      qty:        items.reduce((a, c) => a + c.qty, 0),
      area:       items.reduce((a, c) => a + c.g.area       * c.qty, 0),
      glassArea:  items.reduce((a, c) => a + c.g.glassArea  * c.qty, 0),
      profileLen: items.reduce((a, c) => a + c.g.profileLen * c.qty, 0),
      sillLen:    items.reduce((a, c) => a + (c.g.sillLen || 0) * c.qty, 0),
      netArea:    items.reduce((a, c) => a + c.g.netArea    * c.qty, 0),
      reinfLen:   items.reduce((a, c) => a + c.g.reinfLen   * c.qty, 0)
    }
  };
}
