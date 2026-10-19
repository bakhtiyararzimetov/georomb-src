// Экран «Раскрой»: группы деталей проекта (роль × цвет), расчёт вариантов, списание со склада, PDF для цеха.
import { DEFAULT_QTY, S } from '../state.ts';
import type { CuttingSettings, Mat, Project } from '../types.ts';
import { $, $input, escapeHtml, showToast } from '../ui/dom.ts';
import { elementColorHex, findColor, projectMat } from '../data/colors.ts';
import { elementGeometry } from '../model/pricing.ts';
import { CUT_BUDGET_MS, type CutPlan, type CutResult, type CutVariant, type Scrap, cutOptimize } from '../model/cutOptimizer.ts';
import { CUT_PROFILE_ICONS } from '../render/icons.ts';
import { deliverFile } from '../platform/share.ts';
import { getCurrentProject, notifyDataChanged } from '../storage.ts';
import { PDF_DIM, PDF_FONT, PDF_GREY, PDF_INK, PDF_LINE, PDF_M, PDF_PH, PDF_PW, type JpegPage, type PdfPage,
         pdfCanvasJpeg, pdfFromJpegs, pdfNewPage, pdfState, pdfText, safeFileName } from './pdf.ts';
import { saveWarehouse, wh } from './warehouse.ts';
import { showTab } from './navigation.ts';
import { openPdfOptions, pdfRole, pdfT } from './pdfI18n.ts';
import { parseMm } from '../model/layout.ts';

export const CUT_ROLE_LABEL: Record<string, string> = {
  frame:'Рама', mullion:'Импост', wSash:'Створка окна', dSash:'Створка двери',
  slidFrame:'Рама (раздвижная)', slidSash:'Створка (раздвижная)',
  bead:'Штапик', panel:'Панель (планки)', sill:'Подоконник',
  reinf:'Армирование', net:'Профиль москитной сетки'
};
const CUT_ROLE_ORDER: Record<string, number> = { frame:0, slidFrame:0, mullion:1, wSash:2, slidSash:2, dSash:3, reinf:4, bead:5, panel:6, net:7, sill:8 };
// армирование — оцинкованная сталь, цвет у него один
const REINF_COLOR = { code:'', name:'Оцинкованная сталь', hex:'#9aa3ad' };
const CUT_STOCK_CHOICES = [6000, 6500];
// сечения профилей из romchi; у раздвижных своих картинок нет — рама (l) и створка (z)
const CUT_ROLE_ICON: Record<Mat, Record<string, string>> = {
  pvc:{ frame:'plastic_l', slidFrame:'plastic_l', mullion:'plastic_t', wSash:'plastic_z', slidSash:'plastic_z', dSash:'plastic_balkon_z', bead:'plastic_shtapik_paket', panel:'plastic_lambri', sill:'shelf' },
  alu:{ frame:'alumin_l',  slidFrame:'alumin_l',  mullion:'alumin_t',  wSash:'alumin_z',  slidSash:'alumin_z',  dSash:'alumin_balkon_z',  bead:'alumin_shtapik_paket',  panel:'alumin_lambri',  sill:'shelf' }
};
const roleIcon = (role: string, mat: Mat) => CUT_PROFILE_ICONS[(CUT_ROLE_ICON[mat] || CUT_ROLE_ICON.pvc)[role]];
function cutIconSvg(role: string, mat: Mat): string {
  const ic = roleIcon(role, mat);
  if(!ic) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ic.w} ${ic.h}" preserveAspectRatio="xMidYMid meet">`
    + ic.p.map(([d, f, eo]) => `<path d="${d}" fill="${f}"${eo ? ' fill-rule="evenodd"' : ''}/>`).join('') + '</svg>';
}
// цвета деталей по длине: одна длина — один цвет внутри группы
const CUT_PIECE_COLORS = ['#9fd8a4','#ffcf8a','#8fdcea','#d7a6e0','#9cc8f5','#f5a9c4','#e8e08a','#c9b3a8','#8fd1c4','#b9c4f0','#f2b58a','#b5d98a'];
function cutColorMap(v: CutVariant): Map<number, string> {
  const lens = [...new Set(v.plans.flatMap(p => p.cuts))].sort((a, b) => b - a);
  const m = new Map<number, string>();
  lens.forEach((len, i) => m.set(len, CUT_PIECE_COLORS[i % CUT_PIECE_COLORS.length]));
  return m;
}

// ===== Настройки раскроя =====
const CUT_SETTINGS_KEY = 'iwd.cutting.v1';
const CUT_DEFAULTS: CuttingSettings = { kerf:5, minRemnant:140, trimMax:80, unitLength:{ pvc:6000, alu:6000 }, roleUnit:{ pvc:{}, alu:{} }, showAlgorithms:false,
                                       reinf:true, reinfOffset:40 };
export function normalizeCuttingSettings(src: unknown): CuttingSettings {
  const s = (src && typeof src === 'object') ? src as Partial<CuttingSettings> : {};
  const d = CUT_DEFAULTS;
  const num = (v: unknown, ok: (n: number) => boolean, def: number) => { const n = Number(v); return (v !== null && v !== '' && ok(n)) ? n : def; };
  const roleUnit: CuttingSettings['roleUnit'] = { pvc:{}, alu:{} };
  (['pvc','alu'] as Mat[]).forEach(m => {
    const r = s.roleUnit && s.roleUnit[m];
    if(r && typeof r === 'object') Object.keys(r).forEach(role => {
      const n = Number(r[role]);
      if(CUT_ROLE_LABEL[role] && n > 0) roleUnit[m][role] = n;
    });
  });
  return {
    kerf:       num(s.kerf,       n => n >= 0, d.kerf),
    minRemnant: num(s.minRemnant, n => n >= 0, d.minRemnant),
    trimMax:    num(s.trimMax,    n => n >= 0, d.trimMax),
    unitLength: {
      pvc: num(s.unitLength && s.unitLength.pvc, n => n > 0, d.unitLength.pvc),
      alu: num(s.unitLength && s.unitLength.alu, n => n > 0, d.unitLength.alu)
    },
    roleUnit,
    showAlgorithms: !!s.showAlgorithms,
    reinf:       s.reinf === undefined ? d.reinf : !!s.reinf,
    reinfOffset: num(s.reinfOffset, n => n >= 0 && n < 500, d.reinfOffset)
  };
}
export function loadCuttingSettings(): CuttingSettings {
  let s: unknown = null;
  try{ s = JSON.parse(localStorage.getItem(CUT_SETTINGS_KEY) || 'null'); }catch{ s = null; }
  return normalizeCuttingSettings(s);
}
export function saveCuttingSettings(s: CuttingSettings): void {
  try{ localStorage.setItem(CUT_SETTINGS_KEY, JSON.stringify(s)); }catch{ /* без сохранения */ }
  notifyDataChanged();
}
export function cuttingSettingsAreUntouched(): boolean {
  return JSON.stringify(S.cutting) === JSON.stringify(normalizeCuttingSettings(null));
}

export interface CutGroup {
  key: string; role: string; roleLabel: string; colorCode: string; colorName: string; colorHex: string;
  unitLengthMm: number; pieces: { lengthMm: number; count: number }[]; totalCount: number;
}
interface CutGroupResult { grp: CutGroup; res: CutResult; sel: number; }
// группа, которую не удалось рассчитать: ошибка или нет ни одного варианта
interface CutFailed { grp: CutGroup; why: string; }

let cuttingProjectId: number | null = null;
let cuttingResults: CutGroupResult[] | null = null;
let cuttingFailed: CutFailed[] = [];
let cuttingBusy = false;
let cuttingProgress: { done: number; total: number } | null = null;
let cuttingWhUsage = new Map<number, number>();   // остаток → сколько штук берём
let cuttingWhCommitted = false;
let cuttingScrapsSaved = false;

function cutUnitFor(mat: Mat, role: string): number {
  return (S.cutting.roleUnit[mat] && S.cutting.roleUnit[mat][role]) || S.cutting.unitLength[mat];
}
// детали проекта по группам (роль × цвет, у подоконника ещё ширина)
export function extractCuttingGroups(project: Project): CutGroup[] {
  const mat = projectMat(project);
  const groups: Record<string, CutGroup & { lenCounts: Record<number, number> }> = {};
  project.elements.forEach(e => {
    const qty = Math.max(0, Math.round(parseMm(e.qty) || DEFAULT_QTY));
    if(!qty) return;
    // неизвестный код (например, цвет алюминия в проекте ПВХ из чужой копии) — как «Без цвета»: иначе две группы
    // «Без цвета» делят между собой один и тот же остаток склада
    const color = findColor(project, e.color || '');
    const colorCode = color ? color.code : '';
    const colorName = color ? color.name : 'Без цвета';
    const colorHex = elementColorHex(e, project);
    const push = (role: string, sub: string, subLabel: string, lens: number[]) => {
      const col = role === 'reinf' ? REINF_COLOR : { code:colorCode, name:colorName, hex:colorHex };
      const key = role + '|' + sub + '|' + col.code;
      if(!groups[key]) groups[key] = {
        key, role, roleLabel:(CUT_ROLE_LABEL[role] || role) + (subLabel ? ' ' + subLabel : ''),
        colorCode:col.code, colorName:col.name, colorHex:col.hex, unitLengthMm:cutUnitFor(mat, role),
        lenCounts:{}, pieces:[], totalCount:0
      };
      const grp = groups[key];
      lens.forEach(len => {
        const mm = Math.round(len);
        if(mm <= 0) return;
        grp.lenCounts[mm] = (grp.lenCounts[mm] || 0) + qty;
        grp.totalCount += qty;
      });
    };
    if(e.type === 'sill'){
      // отдельный подоконник: ширина элемента — длина, высота — глубина полки
      const len = parseMm(e.width) || 0, depth = Math.round(parseMm(e.height) || 0);
      if(len > 0) push('sill', 'd' + depth, depth + ' мм', [len]);
      return;
    }
    const g = elementGeometry(e, mat);
    (Object.keys(g.pieces) as (keyof typeof g.pieces)[]).forEach(role => {
      if(role === 'reinf' && !S.cutting.reinf) return;
      if(g.pieces[role].length) push(role, '', '', g.pieces[role]);
    });
    if(g.sillLen > 0) push('sill', 'w' + g.sillWidth, g.sillWidth + ' см', [g.sillLen * 1000]);
  });
  return Object.values(groups)
    .map(({ lenCounts, ...grp }) => ({
      ...grp,
      pieces: Object.keys(lenCounts).map(mm => ({ lengthMm:Number(mm), count:lenCounts[Number(mm)] }))
                     .sort((a, b) => b.lengthMm - a.lengthMm)
    }))
    .sort((a, b) => (a.role in CUT_ROLE_ORDER ? CUT_ROLE_ORDER[a.role] : 9) - (b.role in CUT_ROLE_ORDER ? CUT_ROLE_ORDER[b.role] : 9)
                || a.roleLabel.localeCompare(b.roleLabel, 'ru') || a.colorName.localeCompare(b.colorName, 'ru'));
}

// остатки склада, подходящие группе, по одной записи на штуку
function cutScrapsFor(mat: Mat, role: string, colorName: string): Scrap[] {
  if(role === 'sill') return [];
  const out: Scrap[] = [];
  S.warehouseRemnants
    .filter(r => r.lengthMm > 0 && r.qty > 0 && r.material === mat && r.role === role
              && wh.matcher.norm(r.color) === wh.matcher.norm(colorName))
    .forEach(r => { for(let i = 0; i < Math.min(r.qty, 200); i++) out.push({ id:r.id, uid:r.id + '.' + i, len:Math.round(r.lengthMm) }); });
  return out;
}
const cutSelected = (r: CutGroupResult): CutVariant | null => r.res.variants[r.sel] || r.res.variants[0] || null;
function computeWhUsage(results: CutGroupResult[] | null): Map<number, number> {
  const usage = new Map<number, number>();
  (results || []).forEach(r => {
    const v = cutSelected(r);
    if(v) v.plans.forEach(p => { if(p.scrap) usage.set(p.scrap.id, (usage.get(p.scrap.id) || 0) + 1); });
  });
  return usage;
}

// ---------- действия ----------
export function commitWarehouseUsage(): void {
  if(cuttingWhCommitted || !cuttingWhUsage || cuttingWhUsage.size === 0) return;
  let total = 0;
  cuttingWhUsage.forEach((count, id) => {
    const r = S.warehouseRemnants.find(x => x.id === id);
    if(r){ const n = Math.min(r.qty, count); r.qty -= n; total += n; }
  });
  S.warehouseRemnants = S.warehouseRemnants.filter(r => r.qty > 0);
  saveWarehouse();
  cuttingWhCommitted = true;
  showToast('Списано остатков со склада: ' + total + ' шт');
  renderCuttingScreen();
}
// годные обрезки выбранных вариантов → на склад (одинаковые складываются в одну строку)
export function saveCuttingScraps(): void {
  if(cuttingScrapsSaved || !cuttingResults) return;
  const project = S.projects.find(p => p.id === cuttingProjectId);
  if(!project) return;
  const mat = projectMat(project);
  let total = 0;
  cuttingResults.forEach(r => {
    const v = cutSelected(r);
    if(!v || r.grp.role === 'sill') return;
    v.plans.forEach(p => {
      if(!p.usable) return;
      const len = Math.round(p.left);
      const same = S.warehouseRemnants.find(x => x.material === mat && x.role === r.grp.role && x.lengthMm === len
        && wh.matcher.norm(x.color) === wh.matcher.norm(r.grp.colorName));
      if(same) same.qty += 1;
      else S.warehouseRemnants.push({ id:S.whNextId++, material:mat, role:r.grp.role, color:r.grp.colorName, lengthMm:len, qty:1 });
      total++;
    });
  });
  if(!total){ showToast('Годных обрезков нет'); return; }
  saveWarehouse();
  cuttingScrapsSaved = true;
  showToast('На склад добавлено обрезков: ' + total + ' шт');
  renderCuttingScreen();
}

export function openCutting(): void {
  showTab('cutting');
  if(cuttingProjectId === null || !S.projects.some(p => p.id === cuttingProjectId)){
    const cur = getCurrentProject();
    cuttingProjectId = cur ? cur.id : (S.projects[0] ? S.projects[0].id : null);
  }
  cuttingReset();
  renderCuttingScreen();
}
export function closeCutting(): void { showTab(null); }
function cuttingReset(): void {
  if(cuttingBusy) return;
  cuttingResults = null;
  cuttingFailed = [];
  cuttingWhUsage = new Map();
  cuttingWhCommitted = false;
  cuttingScrapsSaved = false;
}
export function cutProjectPick(id: number): void {
  if(cuttingBusy) return;
  cuttingProjectId = id;
  cuttingReset();
  closeCutProjectPicker();
  renderCuttingScreen();
}
export function openCutProjectPicker(): void {
  if(!S.projects.length || cuttingBusy) return;
  $('cutProjectList').innerHTML = S.projects.map(p => `
      <button class="color-opt${p.id === cuttingProjectId ? ' selected' : ''}" onclick="cutProjectPick(${p.id})">
        <span class="avatar" style="width:34px;height:34px;font-size:var(--fs-sm)">${escapeHtml(String(p.number != null ? p.number : p.id))}</span>
        <span>${escapeHtml(p.name)}</span>
        <span class="check">✓</span>
      </button>`).join('');
  $('cutProjectBackdrop').classList.add('open');
}
export function closeCutProjectPicker(): void { $('cutProjectBackdrop').classList.remove('open'); }
// справка «Как работают раскрой и склад»
export function openCutHelp(section: string): void {
  $('cutHelpBackdrop').classList.add('open');
  const body = $('cutHelpBody');
  const whH = document.getElementById('cutHelpWh');
  body.scrollTop = (section === 'wh' && whH) ? whH.offsetTop - body.offsetTop - 4 : 0;
}
export function closeCutHelp(): void { $('cutHelpBackdrop').classList.remove('open'); }

export function cuttingSettingChanged(field: string, mat?: Mat): void {
  if(cuttingBusy) return;
  const el = $input('cut' + field + (mat || ''));
  const v = parseFloat(el.value);
  const s = S.cutting;
  if(field === 'Kerf') s.kerf = v >= 0 ? v : s.kerf;
  else if(field === 'MinRemnant') s.minRemnant = v >= 0 ? v : s.minRemnant;
  else if(field === 'TrimMax') s.trimMax = v >= 0 ? v : s.trimMax;
  else if(field === 'Unit' && mat) s.unitLength[mat] = v > 0 ? v : s.unitLength[mat];
  else if(field === 'Algo') s.showAlgorithms = !!el.checked;
  else if(field === 'Reinf') s.reinf = !!el.checked;
  else if(field === 'ReinfOffset') s.reinfOffset = (v >= 0 && v < 500) ? v : s.reinfOffset;
  saveCuttingSettings(s);
  if(field !== 'Algo') cuttingReset();
  renderCuttingScreen();
}
// длина хлыста для роли: '' — как у материала
export function cuttingRoleUnitChanged(role: string, mat: Mat, value: string): void {
  if(cuttingBusy) return;
  const v = parseFloat(value);
  if(v > 0 && v !== S.cutting.unitLength[mat]) S.cutting.roleUnit[mat][role] = v;
  else delete S.cutting.roleUnit[mat][role];
  saveCuttingSettings(S.cutting);
  cuttingReset();
  renderCuttingScreen();
}
export function cutSelectVariant(gi: number, vi: number): void {
  if(!cuttingResults || !cuttingResults[gi] || cuttingWhCommitted || cuttingScrapsSaved) return;
  cuttingResults[gi].sel = vi;
  cuttingWhUsage = computeWhUsage(cuttingResults);
  renderCuttingScreen();
}
export async function calcCutting(): Promise<void> {
  if(cuttingBusy) return;
  const project = S.projects.find(p => p.id === cuttingProjectId);
  if(!project) return;
  const groups = extractCuttingGroups(project);
  const mat = projectMat(project);
  const C = { k:S.cutting.kerf, minScrap:S.cutting.minRemnant, trimMax:S.cutting.trimMax };
  cuttingReset();
  cuttingBusy = true;
  const results: CutGroupResult[] = [], failed: CutFailed[] = [];
  try{
    for(let i = 0; i < groups.length; i++){
      cuttingProgress = { done:i, total:groups.length };
      renderCuttingScreen();
      await new Promise(r => setTimeout(r, 16));   // дать экрану обновиться
      const grp = groups[i];
      const flat: number[] = [];
      grp.pieces.forEach(p => { for(let j = 0; j < p.count; j++) flat.push(p.lengthMm); });
      // одна неудачная группа не должна ломать весь раскрой — она попадает в список «не удалось рассчитать»
      try{
        const res = cutOptimize(flat, grp.unitLengthMm, C, cutScrapsFor(mat, grp.role, grp.colorName), CUT_BUDGET_MS);
        if(!res.variants.length && !res.tooLong.length) failed.push({ grp, why:'нет результата' });
        else results.push({ grp, res, sel:0 });
      }catch(err){
        console.error(err);
        failed.push({ grp, why:'ошибка расчёта' });
      }
    }
    cuttingResults = results;
    cuttingFailed = failed;
    cuttingWhUsage = computeWhUsage(cuttingResults);
  }catch(err){
    console.error(err);
    showToast('Не удалось рассчитать раскрой');
  }finally{
    cuttingBusy = false;
    cuttingProgress = null;
    renderCuttingScreen();
  }
}

// ---------- экран ----------
// одинаковые хлысты сворачиваются в «× N» (остатки склада — по одному)
function cutPatterns(v: CutVariant): { p: CutPlan; n: number }[] {
  const out: { p: CutPlan; n: number }[] = [], byKey = new Map<string, { p: CutPlan; n: number }>();
  v.plans.forEach(p => {
    const key = p.scrap ? 'wh' + p.scrap.uid : p.len + ':' + p.cuts.join(',');
    const ex = byKey.get(key);
    if(ex) ex.n++;
    else { const o = { p, n:1 }; byKey.set(key, o); out.push(o); }
  });
  return out;
}
const cutFmt = (n: number) => (Math.round(n * 10) / 10).toString().replace('.', ',');
function cutSummary(results: CutGroupResult[]) {
  const bars: Record<number, number> = {}; let fromWh = 0, waste = 0, scraps = 0, cuts = 0, whScraps = 0;
  results.forEach(r => {
    const v = cutSelected(r);
    if(!v) return;
    if(v.newBars) bars[r.grp.unitLengthMm] = (bars[r.grp.unitLengthMm] || 0) + v.newBars;
    fromWh += v.fromWh; waste += v.wasteMm; scraps += v.newScraps; cuts += v.cutsN;
    if(r.grp.role !== 'sill') whScraps += v.newScraps;   // подоконников на складе нет
  });
  return { bars, fromWh, waste, scraps, cuts, whScraps };
}
const barsText = (bars: Record<number, number>) =>
  Object.keys(bars).map(Number).sort((a, b) => a - b).map(l => `${l} мм × ${bars[l]}`).join(', ') || '—';
function cutBarHtml(p: CutPlan, colors: Map<number, string>): string {
  const pieces = p.cuts.map(len => `<div class="cut-piece" style="flex:${len} 0 0;background:${colors.get(len)}" title="${len} мм">${len}</div>`).join('');
  const left = p.left > 0
    ? `<div class="cut-piece ${p.usable ? 'cp-remnant' : 'cp-waste'}" style="flex:${p.left} 0 0" title="${p.usable ? 'деловой обрезок' : 'отход'}: ${p.left} мм">${p.left}</div>`
    : '';
  return `<div class="cut-bar">${pieces}${left}</div>`;
}

export function renderCuttingScreen(): void {
  const body = $('cuttingBody');
  const project = S.projects.find(p => p.id === cuttingProjectId);
  const mat = projectMat(project);
  const cs = S.cutting;
  const dis = cuttingBusy ? ' disabled' : '';
  const settingsHtml = `
      <div class="cut-settings">
        <label>Пропил, мм
          <input id="cutKerf" type="number" min="0" step="1" value="${cs.kerf}" onchange="cuttingSettingChanged('Kerf')"${dis}>
        </label>
        <label>Мин. обрезок, мм
          <input id="cutMinRemnant" type="number" min="0" step="10" value="${cs.minRemnant}" onchange="cuttingSettingChanged('MinRemnant')"${dis}>
        </label>
        <label>Хлыст, мм
          <input id="cutUnit${mat}" type="number" min="1000" step="100" value="${cs.unitLength[mat]}" onchange="cuttingSettingChanged('Unit','${mat}')"${dis}>
        </label>
        <label>Подрезка остатка, мм
          <input id="cutTrimMax" type="number" min="0" step="10" value="${cs.trimMax}" onchange="cuttingSettingChanged('TrimMax')"${dis}>
        </label>
      </div>
      <label class="cut-check"><input id="cutAlgo" type="checkbox"${cs.showAlgorithms ? ' checked' : ''} onchange="cuttingSettingChanged('Algo')"> Показывать названия алгоритмов</label>
      ${mat === 'pvc' ? `
      <label class="cut-check"><input id="cutReinf" type="checkbox"${cs.reinf ? ' checked' : ''} onchange="cuttingSettingChanged('Reinf')"${dis}> Армирование (сталь в профиле ПВХ)</label>
      ${cs.reinf ? `<div class="cut-settings"><label>Армирование короче, мм с каждой стороны
          <input id="cutReinfOffset" type="number" min="0" step="5" value="${cs.reinfOffset}" onchange="cuttingSettingChanged('ReinfOffset')"${dis}>
        </label></div>` : ''}` : ''}`;
  if(S.projects.length === 0){
    body.innerHTML = settingsHtml + `<div class="cut-empty">Нет ни одного проекта.<br>Сначала создайте проект с элементами.</div>`;
    return;
  }
  const selectHtml = `<button type="button" class="cut-project-select" onclick="openCutProjectPicker()"${dis}>
      <span>${project ? ('№' + escapeHtml(String(project.number != null ? project.number : project.id)) + ' · ' + escapeHtml(project.name)) : 'Выберите проект'}</span>
      <span class="chevron">⌄</span>
    </button>`;
  if(!project || project.elements.length === 0){
    body.innerHTML = settingsHtml + selectHtml + `<div class="cut-empty">В проекте нет элементов.</div>`;
    return;
  }
  const groups = extractCuttingGroups(project);
  if(groups.length === 0){
    body.innerHTML = settingsHtml + selectHtml + `<div class="cut-empty">В элементах проекта нет деталей для раскроя.</div>`;
    return;
  }
  const matUnit = cs.unitLength[mat];
  const unitSelect = (g: CutGroup) => {
    const cur = cutUnitFor(mat, g.role);
    const opts = [...new Set([matUnit, ...CUT_STOCK_CHOICES, cur])].sort((a, b) => a - b);
    return `<select class="cut-unit" onchange="cuttingRoleUnitChanged('${g.role}','${mat}',this.value)"${dis}>
        ${opts.map(u => `<option value="${u}"${u === cur ? ' selected' : ''}>хлыст ${u} мм${u === matUnit ? ' (как у материала)' : ''}</option>`).join('')}
      </select>`;
  };
  const btnText = cuttingBusy
    ? `Считаю… ${cuttingProgress ? (cuttingProgress.done + 1) + ' из ' + cuttingProgress.total : ''}`
    : (cuttingResults ? 'Пересчитать раскрой' : 'Рассчитать раскрой');
  const groupsHtml = `
      <div class="cut-section-title">Группы деталей</div>
      <div class="cut-groups">
        ${groups.map(g => `
          <div class="cut-group-row">
            <div>
              <div class="cg-main"><span class="cut-swatch" style="background:${g.colorHex}"></span>${escapeHtml(g.roleLabel)}</div>
              <div class="cg-sub">${escapeHtml(g.colorName)}</div>
              ${unitSelect(g)}
            </div>
            <div class="cg-right"><div class="cut-icon cut-icon-sm">${cutIconSvg(g.role, mat)}</div><div class="cg-count">${g.totalCount} шт</div></div>
          </div>`).join('')}
      </div>
      <button class="btn-block primary" onclick="calcCutting()"${dis}>${btnText}</button>`;

  let resultsHtml = '';
  if(cuttingResults && !cuttingBusy){
    const sum = cutSummary(cuttingResults);
    const whTotal = [...cuttingWhUsage.values()].reduce((a, b) => a + b, 0);
    const locked = cuttingWhCommitted || cuttingScrapsSaved;
    resultsHtml += `
        <div class="cut-summary">
          <div class="cut-result-title">Итого по проекту</div>
          <div class="cut-result-head">
            <div class="cf"><span class="cf-label">Новых хлыстов</span><span class="cf-value">${barsText(sum.bars)}</span></div>
            <div class="cf"><span class="cf-label">Со склада</span><span class="cf-value">${sum.fromWh} шт</span></div>
            <div class="cf"><span class="cf-label">Отход</span><span class="cf-value">${sum.waste} мм</span></div>
            <div class="cf"><span class="cf-label">Деловые обрезки</span><span class="cf-value">${sum.scraps} шт</span></div>
          </div>
          <div class="cut-actions">
            <button class="btn-block ghost" onclick="shareCuttingPdf()">PDF раскроя</button>
            ${whTotal > 0 ? `<button class="btn-block success" onclick="commitWarehouseUsage()"${cuttingWhCommitted ? ' disabled' : ''}>${cuttingWhCommitted ? 'Остатки списаны со склада ✓' : 'Списать со склада (' + whTotal + ' шт)'}</button>` : ''}
            ${sum.whScraps > 0 ? `<button class="btn-block ghost" onclick="saveCuttingScraps()"${cuttingScrapsSaved ? ' disabled' : ''}>${cuttingScrapsSaved ? 'Обрезки добавлены на склад ✓' : 'Обрезки на склад (' + sum.whScraps + ' шт)'}</button>` : ''}
          </div>
          ${locked ? '<div class="cut-algo">После списания или добавления на склад варианты больше не переключаются — нажмите «Пересчитать раскрой».</div>' : ''}
        </div>`;
    if(cuttingFailed.length) resultsHtml += `
        <div class="cut-result-card cut-failed">
          <div class="cut-result-title">Группы, которые не удалось рассчитать</div>
          ${cuttingFailed.map(f => `<div class="cut-warn">${escapeHtml(f.grp.roleLabel)} · ${escapeHtml(f.grp.colorName)} — ${escapeHtml(f.why)}</div>`).join('')}
        </div>`;
    resultsHtml += cuttingResults.map((r, gi) => {
      const grp = r.grp, v = cutSelected(r);
      const warn = r.res.tooLong.length
        ? `<div class="cut-warn">Длиннее хлыста ${grp.unitLengthMm} мм и не раскроены: ${r.res.tooLong.map(x => x + ' мм').join(', ')}. Выберите хлыст длиннее.</div>` : '';
      if(!v) return `<div class="cut-result-card"><div class="cut-result-title">${escapeHtml(grp.roleLabel)} · ${escapeHtml(grp.colorName)}</div>${warn}</div>`;
      const chips = r.res.variants.length > 1 ? `
          <div class="cut-variants">
            ${r.res.variants.map((x, i) => `
              <button class="cut-var${i === r.sel ? ' on' : ''}" onclick="cutSelectVariant(${gi},${i})"${locked && i !== r.sel ? ' disabled' : ''}>
                <b>Вариант ${i + 1}</b>
                <span>${x.newBars} хл.${x.fromWh ? ' + ' + x.fromWh + ' ост.' : ''} · отход ${x.wasteMm} мм</span>
              </button>`).join('')}
          </div>` : '';
      let n = 0;
      const colors = cutColorMap(v);
      const rows = cutPatterns(v).map(({ p, n:cnt }) => {
        const from = n + 1; n += cnt;
        const num = cnt > 1 ? `#${from}–${n}` : `#${from}`;
        return `
            <div class="cut-stock-row${p.scrap ? ' cut-stock-row--wh' : ''}">
              <div class="cut-stock-label">${num} · ${p.len} мм${cnt > 1 ? ` <b>× ${cnt}</b>` : ''}${p.scrap ? `<span class="cut-wh-tag">склад №${p.scrap.id}</span>` : ''}</div>
              ${cutBarHtml(p, colors)}
            </div>`;
      }).join('');
      return `
        <div class="cut-result-card">
          <div class="cut-result-top">
            <div class="cut-result-title"><span class="cut-swatch" style="background:${grp.colorHex}"></span>${escapeHtml(grp.roleLabel)} · ${escapeHtml(grp.colorName)}</div>
            <div class="cut-icon">${cutIconSvg(grp.role, mat)}</div>
          </div>
          ${warn}${chips}
          ${r.res.partial ? '<div class="cut-warn">Лимит времени — упрощённый результат</div>' : ''}
          ${v.newBars <= v.lb ? '<div class="cut-badge">✓ Минимально возможное число хлыстов</div>'
            : (r.res.proven && r.sel === 0 && !v.fromWh ? '<div class="cut-badge">✓ Меньше хлыстов не бывает — проверено перебором</div>' : '')}
          ${cs.showAlgorithms ? `<div class="cut-algo"><b>${escapeHtml(v.name)}</b> — ${escapeHtml(v.desc)}</div>` : ''}
          <div class="cut-result-head">
            <div class="cf"><span class="cf-label">Новых хлыстов</span><span class="cf-value">${v.newBars ? grp.unitLengthMm + ' × ' + v.newBars + ' шт' : 'не нужны'}</span></div>
            <div class="cf"><span class="cf-label">Со склада</span><span class="cf-value">${v.fromWh} шт</span></div>
            <div class="cf"><span class="cf-label">Использование</span><span class="cf-value">${cutFmt(v.effPct)}%</span></div>
            <div class="cf"><span class="cf-label">Отход</span><span class="cf-value">${v.wasteMm} мм · ${cutFmt(v.wastePct)}%</span></div>
            <div class="cf"><span class="cf-label">Деловые обрезки</span><span class="cf-value">${v.newScraps} шт${v.newScraps ? ' · ~' + v.newScrapsAvg + ' мм' : ''}</span></div>
            <div class="cf"><span class="cf-label">Резов</span><span class="cf-value">${v.cutsN}</span></div>
          </div>
          ${rows}
        </div>`;
    }).join('');
  }
  body.innerHTML = settingsHtml + selectHtml + groupsHtml + resultsHtml;
}

// ---------- PDF раскроя ----------
export function shareCuttingPdf(): void {
  if(!cuttingResults || !cuttingResults.length){ showToast('Сначала рассчитайте раскрой'); return; }
  if(pdfState.busy) return;
  openPdfOptions('other', () => { void buildAndShareCuttingPdf(); });
}
async function buildAndShareCuttingPdf(): Promise<void> {
  const project = S.projects.find(p => p.id === cuttingProjectId);
  if(!project || !cuttingResults || !cuttingResults.length) return;
  if(pdfState.busy) return;
  pdfState.busy = true;
  showToast('Готовлю PDF…');
  try{
    const blob = new Blob([pdfFromJpegs(await buildCuttingPdfPages(project, cuttingResults))], { type:'application/pdf' });
    await deliverFile(blob, 'Раскрой — ' + safeFileName(project.name, 'Проект') + '.pdf', 'Раскрой — ' + project.name);
  }catch(err){
    console.error(err);
    showToast('Не удалось создать PDF');
  }finally{
    pdfState.busy = false;
  }
}
// сечение профиля как <img> для canvas; null — нет картинки
function cutIconImage(role: string, mat: Mat): Promise<HTMLImageElement | null> {
  const svg = cutIconSvg(role, mat);
  if(!svg) return Promise.resolve(null);
  return new Promise(res => {
    const img = new Image();
    img.onload = () => res(img.naturalWidth && img.naturalHeight ? img : null);
    img.onerror = () => res(null);
    const ic = roleIcon(role, mat)!;
    const w = 600, h = Math.max(1, Math.round(600 * ic.h / ic.w));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace('<svg ', `<svg width="${w}" height="${h}" `));
  });
}
async function buildCuttingPdfPages(project: Project, results: CutGroupResult[]): Promise<JpegPage[]> {
  const X0 = PDF_M, X1 = PDF_PW - PDF_M, BOTTOM = PDF_PH - PDF_M, W = X1 - X0;
  const jpegs: JpegPage[] = [];
  let pg: PdfPage | null = null, y = 0, pageNo = 0;
  const ctx = () => pg!.ctx;
  const flush = async () => { if(pg){ jpegs.push(await pdfCanvasJpeg(pg.c)); pg.c.width = pg.c.height = 0; } };
  const newPage = async () => {
    await flush();
    pg = pdfNewPage(); pageNo++;
    pdfText(ctx(), pdfT('cutHeader') + ' · ' + project.name, X0, 78, 26, { color:PDF_GREY, maxW:820 });
    pdfText(ctx(), pdfT('page') + ' ' + pageNo, X1, 78, 26, { color:PDF_GREY, align:'right' });
    ctx().fillStyle = PDF_LINE; ctx().fillRect(X0, 96, W, 2);
    y = 150;
  };
  const need = async (h: number) => { if(!pg || y + h > BOTTOM) await newPage(); };
  const bar = (p: CutPlan, top: number, colors: Map<number, string>) => {
    const c = ctx(), H = 46, sc = W / p.len;
    let x = X0;
    c.lineWidth = 2;
    const seg = (len: number, fill: string, label: string, color: string) => {
      const w = len * sc;
      c.fillStyle = fill; c.fillRect(x, top, w, H);
      c.strokeStyle = '#ffffff'; c.strokeRect(x, top, w, H);
      c.font = '400 20px ' + PDF_FONT;
      if(label && c.measureText(label).width + 8 < w) pdfText(c, label, x + w / 2, top + H / 2 + 7, 20, { align:'center', color });
      x += w;
    };
    p.cuts.forEach(len => seg(len, colors.get(len) || '#cfdcf5', String(len), '#14213d'));
    if(p.left > 0) seg(p.left, p.usable ? '#e6ebf3' : '#f3f4f6', String(p.left), PDF_GREY);
    c.strokeStyle = PDF_DIM; c.lineWidth = 2; c.strokeRect(X0, top, W, H);
  };
  await newPage();
  const mm = pdfT('mm'), pcs = pdfT('pcs');
  pdfText(ctx(), pdfT('cutTitle'), X0, y, 44, { bold:true });
  y += 50;
  const num = project.number != null ? project.number : project.id;
  pdfText(ctx(), `${pdfT('projectNo')} ${num} · ${pdfT('kerf')} ${S.cutting.kerf} ${mm} · ${pdfT('minScrap')} ${S.cutting.minRemnant} ${mm} · ${new Date().toLocaleDateString('ru-RU')}`, X0, y, 24, { color:PDF_GREY, maxW:W });
  y += 50;
  const sum = cutSummary(results);
  const bars = Object.keys(sum.bars).map(Number).sort((a, b) => a - b).map(l => `${l} ${mm} × ${sum.bars[l]}`).join(', ') || '—';
  pdfText(ctx(), `${pdfT('newBars')}: ${bars}`, X0, y, 26, { bold:true, maxW:W }); y += 38;
  pdfText(ctx(), `${pdfT('fromWh')}: ${sum.fromWh} ${pcs} · ${pdfT('waste')}: ${sum.waste} ${mm} · ${pdfT('scraps')}: ${sum.scraps} ${pcs} · ${pdfT('cuts')}: ${sum.cuts}`, X0, y, 24, { color:PDF_GREY, maxW:W });
  y += 60;
  for(const r of results){
    const v = cutSelected(r);
    if(!v) continue;
    await need(170);
    const icon = await cutIconImage(r.grp.role, projectMat(project));
    if(icon){   // сечение профиля справа от названия группы, высота 64
      const iw = Math.min(260, 64 * icon.naturalWidth / icon.naturalHeight), ih = iw * icon.naturalHeight / icon.naturalWidth;
      ctx().drawImage(icon, X1 - iw, y - 12 - ih / 2, iw, ih);
    }
    const c = ctx();
    c.fillStyle = r.grp.colorHex || '#ffffff';
    c.beginPath(); c.arc(X0 + 11, y - 10, 11, 0, Math.PI * 2); c.fill();
    c.strokeStyle = PDF_LINE; c.lineWidth = 2; c.stroke();
    const label = pdfRole(r.grp.role, CUT_ROLE_LABEL[r.grp.role] || r.grp.role) + r.grp.roleLabel.slice((CUT_ROLE_LABEL[r.grp.role] || r.grp.role).length);
    pdfText(c, `${label} · ${r.grp.colorName}`, X0 + 34, y, 30, { bold:true, maxW:W - 320 });
    y += 40;
    pdfText(c, `${pdfT('bar')} ${r.grp.unitLengthMm} ${mm} × ${v.newBars}${v.fromWh ? ' + ' + pdfT('fromWhLow') + ' ' + v.fromWh : ''} · ${pdfT('usage')} ${cutFmt(v.effPct)}% · ${pdfT('waste')} ${v.wasteMm} ${mm} · ${pdfT('scrapsShort')} ${v.newScraps}`, X0, y, 22, { color:PDF_GREY, maxW:W - 280 });
    y += 26;
    if(r.res.tooLong.length){
      pdfText(c, `${pdfT('notCut')}: ${r.res.tooLong.join(', ')} ${mm}`, X0, y + 18, 22, { color:'#b45309', maxW:W });
      y += 30;
    }
    y += 14;
    let n = 0;
    const colors = cutColorMap(v);
    for(const { p, n:cnt } of cutPatterns(v)){
      await need(100);
      const from = n + 1; n += cnt;
      pdfText(ctx(), `${cnt > 1 ? '#' + from + '–' + n : '#' + from} · ${p.len} ${mm}${cnt > 1 ? ' × ' + cnt : ''}${p.scrap ? ' · ' + pdfT('whRemnant') + p.scrap.id : ''}`, X0, y + 22, 22, { color:PDF_INK, maxW:W });
      bar(p, y + 34, colors);
      y += 100;
    }
    y += 26;
  }
  await flush();
  return jpegs;
}
