// Экспорт / импорт проектов (резервная копия). Формат файла прежний ("window-projects-backup", version 1),
// поэтому старые бэкапы импортируются, а новые открываются старой версией приложения.
// Импортируемому файлу не доверяем: каждое поле проверяется и пересобирается.
import { S } from '../state.ts';
import type { Divider, OpeningType, PriceSettings, Project, TreeNode, WinElement, Edge, WorkKey } from '../types.ts';
import { $, $input, escapeHtml, showToast } from '../ui/dom.ts';
import { GLASS_TYPES } from '../data/glass.ts';
import { SLIDING_TEMPLATES } from '../data/profiles.ts';
import { PRICE_DEFAULTS, SILL_WIDTHS, calcElement, clonePriceDefaults, isWasteMode, persistPriceSettings } from '../model/pricing.ts';
import { deliverFile } from '../platform/share.ts';
import { onDataChanged, saveProjects, withoutHistory } from '../storage.ts';
import { nativePlugins } from '../platform/capacitor.ts';
import { ID_ALPHABET } from '../../../shared/license.ts';
import { BACKUP_DIR, backupsNewestFirst, createAutoBackup, createBackupTarget, projectFingerprint, type FolderApi } from './autoBackup.ts';
import { openConfirm } from '../ui/dialogs.ts';
import { adoptBackupCode, isUnlocked, onUnlock, storedLicenseCode } from './license.ts';
import { rerenderList } from './projects.ts';
import { catalogSaveOff } from './catalog.ts';
import { WH_NO_COLOR, WarehouseMatcher, saveWarehouse, whNormalizeRemnant, wh } from './warehouse.ts';
import { cuttingSettingsAreUntouched, normalizeCuttingSettings, saveCuttingSettings } from './cutting.ts';

const BACKUP_FORMAT = 'window-projects-backup';

// ids — необязательный список проектов; без него — все
function buildBackup(ids?: number[]) {
  const src = Array.isArray(ids) ? S.projects.filter(p => ids.includes(p.id)) : S.projects;
  const clean = JSON.parse(JSON.stringify(src, withoutHistory)) as Project[];
  return { format:BACKUP_FORMAT, version:1, exportedAt:new Date().toISOString(), projects:clean, priceSettings:S.prices,
           catalogOff:[...S.catalogOff],
           warehouse:{ kerfThickness:wh.matcher.kerfThickness, remnants:S.warehouseRemnants },
           cuttingSettings:S.cutting,
           // только в полной копии (автокопия, «все проекты»): выборочный экспорт отправляют клиентам и коллегам.
           // Код привязан к ID устройства, после переустановки ID тот же (license.ts)
           ...(Array.isArray(ids) ? {} : { licenseCode:storedLicenseCode() }) };
}

// ===== Автокопия в «Documents/GeoRomb» (переживает удаление приложения) =====
export const BACKUP_PATH_HINT = 'Documents → ' + BACKUP_DIR;
const BACKUP_TAG_KEY = 'iwd.backupTag.v1', BACKUP_DECLINED_KEY = 'iwd.backupDeclined.v1';
const declinedFlag = {
  get: (): boolean => { try{ return localStorage.getItem(BACKUP_DECLINED_KEY) === '1'; }catch{ return false; } },
  set: (): void => { try{ localStorage.setItem(BACKUP_DECLINED_KEY, '1'); }catch{ /* без сохранения */ } }
};
function backupTag(): string {
  let t: string | null = null;
  try{ t = localStorage.getItem(BACKUP_TAG_KEY); }catch{ /* нет хранилища */ }
  if(!t || !/^[A-Z2-9]{4}$/.test(t)){
    const r = new Uint8Array(4);
    crypto.getRandomValues(r);
    t = Array.from(r, x => ID_ALPHABET[x % ID_ALPHABET.length]).join('');
    try{ localStorage.setItem(BACKUP_TAG_KEY, t); }catch{ /* без сохранения */ }
  }
  return t;
}
// Выбранная папка копий (FolderAccess): если есть — копии пишутся туда, иначе — в Documents/GeoRomb
const FOLDER_ASKED_KEY = 'iwd.backupFolderAsked.v1';
let target: ReturnType<typeof createBackupTarget> | null = null;
let autoBackup: { schedule(): void; flush(): Promise<boolean> } | null = null;
let picking = false;                                     // системный выбор папки уже открыт (двойное нажатие)
const folderApi = (): FolderApi | null => nativePlugins()?.FolderAccess || null;
const folderName = (): string | null => target ? target.folder() : null;

function showBackupPlace(): void {
  const f = folderName();
  const where = f ? 'папка «' + f + '»' : 'папка ' + BACKUP_PATH_HINT;
  const sub = document.getElementById('exportRowSub');
  if(sub) sub.textContent = 'Сохранить в файл. Автокопия: ' + where;
  const isub = document.getElementById('importRowSub');
  if(isub) isub.textContent = f ? 'Из файла (автокопии — в папке «' + f + '»)' : 'Из файла или автокопии: ' + BACKUP_PATH_HINT + ', самый новый файл';
  const fsub = document.getElementById('folderRowSub');
  if(fsub) fsub.textContent = f ? 'Сейчас: «' + f + '». Нажмите, чтобы выбрать другую' : 'Не выбрана — копии в ' + BACKUP_PATH_HINT;
  const hint = document.getElementById('licenseRestoreHint');
  if(hint){
    hint.textContent = folderApi()
      ? 'Переустановили приложение? Нажмите и выберите папку с копиями (GeoRomb) — приложение само возьмёт самую свежую.'
      : 'Переустановили приложение? Копия проектов лежит в памяти телефона: ' + BACKUP_PATH_HINT + ' — выберите самый новый файл.';
    hint.hidden = false;
  }
}

/** Только в нативном приложении: копия через 3 с после изменений и сразу при сворачивании. */
export function initAutoBackup(): void {
  const plugins = nativePlugins();
  if(!plugins || !plugins.Filesystem) return;
  const fa = folderApi();
  target = createBackupTarget(plugins.Filesystem, fa, f => {
    showToast('Папка «' + f + '» недоступна — копия сохранена в ' + BACKUP_PATH_HINT + '. Выберите папку заново: Настройки → Папка для копий', 7000);
  });
  const ab = createAutoBackup({
    fs: target.fs, tag: backupTag(), getJson: () => JSON.stringify(buildBackup(), null, 1),
    canRun: isUnlocked,                                  // не поверх экрана активации
    declined: { get: () => !folderName() && declinedFlag.get(), set: declinedFlag.set },
    beforeAsk: () => showToast('Разрешите доступ к памяти — туда сохраняется копия проектов', 4000)
  });
  autoBackup = ab;
  onDataChanged(ab.schedule);
  onUnlock(() => { void ab.flush(); void target!.ready.then(offerBackupFolder); });
  if(plugins.App) plugins.App.addListener('pause', () => { void ab.flush(); });
  const row = document.getElementById('folderRow');
  if(row && fa) row.hidden = false;
  showBackupPlace();
  void target.ready.then(showBackupPlace);
  ab.schedule();                                         // первая копия сразу после запуска
}

// один раз после активации: предложить отдельную папку (её видно в памяти телефона, и после переустановки
// проекты возвращаются выбором этой папки)
function offerBackupFolder(): void {
  if(!folderApi() || folderName()) return;
  try{ if(localStorage.getItem(FOLDER_ASKED_KEY)) return; localStorage.setItem(FOLDER_ASKED_KEY, '1'); }catch{ return; }
  setTimeout(() => {
    if(folderName()) return;
    openConfirm('Где хранить копию проектов? Выберите или создайте папку GeoRomb в памяти телефона — она останется, даже если удалить приложение.',
      () => { void chooseBackupFolder(); }, 'Выбрать папку');
  }, 800);
}

// системный выбор папки; null — отменили или выбор уже открыт
async function pickFolder(fa: FolderApi): Promise<string | null> {
  if(picking) return null;
  picking = true;
  try{
    const name = (await fa.pick()).name || 'GeoRomb';
    if(target) target.setFolder(name);
    showBackupPlace();
    return name;
  }catch{ return null; }
  finally{ picking = false; }
}

/** Выбор папки для копий (настройки или предложение после активации). */
export async function chooseBackupFolder(): Promise<void> {
  const fa = folderApi();
  if(!fa) return;
  const name = await pickFolder(fa);
  if(!name) return;
  if(autoBackup){ autoBackup.schedule(); void autoBackup.flush(); }
  showToast('Копии проектов сохраняются в папку «' + name + '»');
}

const looksLikeBackup = (text: string): boolean => {
  try{ const d = JSON.parse(text) as Raw | null; return !!d && d.format === BACKUP_FORMAT && Array.isArray(d.projects); }
  catch{ return false; }
};

/** «Восстановить из копии»: выбрать папку с копиями — импортируется самая свежая целая. Без плагина — выбор файла. */
export async function restoreFromCopy(): Promise<void> {
  const fa = folderApi();
  if(!fa){ importProjects(); return; }
  const name = await pickFolder(fa);
  if(!name) return;
  try{
    const files = backupsNewestFirst((await fa.list()).files);
    if(!files.length){
      showToast('В папке «' + name + '» нет копий GeoRomb (файлы georomb-backup-…). Выберите папку GeoRomb или Documents → GeoRomb', 6000);
      return;
    }
    // свежая копия могла оборваться (приложение закрыли во время записи) — берём первую целую
    for(const f of files){
      let text: string;
      try{ text = (await fa.read({ name: f })).data; }catch(err){ console.error(err); continue; }
      if(looksLikeBackup(text)){ await importBackupText(text); return; }
    }
    showToast('Копии в папке «' + name + '» повреждены — восстановить не получилось');
  }catch(err){
    console.error(err);
    showToast('Не удалось прочитать копию из папки «' + name + '»');
  }
}

async function exportProjects(ids?: number[]): Promise<void> {
  const n = Array.isArray(ids) ? ids.length : S.projects.length;
  if(n === 0){ showToast('Нет проектов для экспорта'); return; }
  try{
    const blob = new Blob([JSON.stringify(buildBackup(ids), null, 1)], { type:'application/json' });
    const d = new Date(), z = (x: number) => String(x).padStart(2, '0');
    const name = 'projects-' + d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + '.json';
    const how = await deliverFile(blob, name, 'Проекты');
    if(how === 'download') showToast('Файл сохранён: ' + name);
  }catch(err){
    console.error(err);
    showToast('Не удалось сохранить файл');
  }
}

// ===== Выбор проектов перед экспортом =====
let exportSelected = new Set<number>();
export function openExportPicker(): void {
  if(S.projects.length === 0){ showToast('Нет проектов для экспорта'); return; }
  exportSelected = new Set();
  renderExportPicker();
  $('exportPickBackdrop').classList.add('open');
}
function renderExportPicker(): void {
  $('exportPickList').innerHTML = S.projects.map(p => `
      <button class="color-opt${exportSelected.has(p.id) ? ' selected' : ''}" onclick="toggleExportSelect(${p.id})">
        <span class="avatar" style="width:34px;height:34px;font-size:var(--fs-sm)">${escapeHtml(String(p.number != null ? p.number : p.id))}</span>
        <span>${escapeHtml(p.name)}</span>
        <span class="check">✓</span>
      </button>`).join('');
  const confirmBtn = $('exportPickConfirm') as HTMLButtonElement;
  confirmBtn.textContent = 'Экспортировать (' + exportSelected.size + ')';
  confirmBtn.disabled = exportSelected.size === 0;
  $('exportPickAllBtn').textContent = (exportSelected.size === S.projects.length) ? 'Снять все' : 'Выбрать все';
}
export function toggleExportSelect(id: number): void {
  if(exportSelected.has(id)) exportSelected.delete(id); else exportSelected.add(id);
  renderExportPicker();
}
export function exportPickToggleAll(): void {
  exportSelected = (exportSelected.size === S.projects.length) ? new Set() : new Set(S.projects.map(p => p.id));
  renderExportPicker();
}
export function closeExportPicker(): void { $('exportPickBackdrop').classList.remove('open'); }
export async function confirmExportSelected(): Promise<void> {
  if(exportSelected.size === 0) return;
  const ids = [...exportSelected];
  closeExportPicker();
  await exportProjects(ids);
}

// --- проверка и пересборка данных файла ---
const IMPORT_MAX_PROJECTS = 5000, IMPORT_MAX_ELEMENTS = 500, IMPORT_MAX_NODES = 300, IMPORT_MAX_DEPTH = 12;
// импостов в одной цепочке: витрина может быть из многих полей (инструмент MV1, flattenSameDir) — лишь бы узлов ≤ IMPORT_MAX_NODES
const IMPORT_MAX_CHILDREN = 100;
const safeText = (v: unknown, max: number, def?: string): string => {
  // убираем только то, из чего собирается разметка, и управляющие символы (кроме переносов строк и табуляции); & и кавычки — обычные символы названий («ООО "Окна & Двери"»),
  // при выводе их экранирует escapeHtml
  const t = (typeof v === 'string' || typeof v === 'number') ? String(v).replace(/[<>`\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '';
  return t || (def || '');
};
const safeNum = (v: unknown, min: number, max: number): number | null => { const n = Number(v); return (isFinite(n) && n >= min && n <= max) ? n : null; };
type Raw = Record<string, unknown>;

function cleanNode(n: unknown, depth: number, counter: { n: number }): TreeNode {
  const src = n as Raw | null;
  if(!src || typeof src !== 'object' || depth > IMPORT_MAX_DEPTH || ++counter.n > IMPORT_MAX_NODES) throw new Error('bad node');
  const out: TreeNode = { nid: S.nextNodeId++, kind:'leaf' };
  if(src.kind === 'branch'){
    const children = src.children;
    if(!Array.isArray(children) || children.length < 2 || children.length > IMPORT_MAX_CHILDREN) throw new Error('bad branch');
    out.kind = 'branch';
    out.dir = (src.dir === 'h') ? 'h' : 'v';
    out.children = children.map(c => cleanNode(c, depth + 1, counter));
    const sizes = src.sizes;
    out.sizes = (Array.isArray(sizes) && sizes.length === children.length && sizes.every(x => safeNum(x, 0.001, 100000) !== null))
                ? sizes.map(Number) : null;
  }else{
    out.fill = (src.fill === 'panelV' || src.fill === 'panelH') ? src.fill : 'glass';
    out.opening = null;
    const op = src.opening as Raw | null | undefined;
    if(op && typeof op === 'object'){
      const t = op.type as OpeningType;
      if(['Turn','Tilt','TiltTurn','Door','Sliding','FixSliding'].includes(t)){
        out.opening = { type:t };
        if(['left','right','bottom'].includes(op.hinge as string)) out.opening.hinge = op.hinge as Edge;
      }
    }
    if(src.inner) out.inner = cleanNode(src.inner, depth + 1, counter);
  }
  if(Array.isArray(src.dividers)) out.dividers = src.dividers.filter((x): x is Divider => x === 'cap' || x === 'adapter');
  return out;
}
function cleanElement(e: unknown, project: Project): WinElement | null {
  const src = e as Raw | null;
  if(!src || typeof src !== 'object') return null;
  const type = (src.type === 'sliding' || src.type === 'casement' || src.type === 'sill') ? src.type : null;
  const width = safeNum(src.width, 1, 100000), height = safeNum(src.height, 1, 100000), qty = safeNum(src.qty, 0.001, 100000);
  if(!type || width === null || height === null || qty === null) return null;
  const el: WinElement = { id: S.nextElemId++, type, width, height, qty, color: null, history: [], redo: [] };
  const col = safeText(src.color, 40);
  if(col && /^[A-Za-z0-9_-]+$/.test(col)) el.color = col;     // код каталога (ral9016, oak_golden…)
  const gl = safeText(src.glass, 20);
  if(gl && GLASS_TYPES.some(g => g.code === gl)) el.glass = gl;
  if(typeof src.slidingTemplate === 'string' && SLIDING_TEMPLATES[src.slidingTemplate]) el.slidingTemplate = src.slidingTemplate;
  if(src.net === true) el.net = true;
  // подоконник под окном (длина в метрах, ширина полки в см)
  if(src.sill === true && type !== 'sill'){            // у отдельного подоконника своего нет
    const len = safeNum(src.sillLen, 0.001, 100), w = safeNum(src.sillWidth, 1, 200);
    if(len !== null){ el.sill = true; el.sillLen = len; el.sillWidth = (w !== null && SILL_WIDTHS.includes(w)) ? w : 20; }
  }
  try{
    if(src.root) el.root = cleanNode(src.root, 0, { n:0 });
    calcElement(el, project);                 // расчёт должен пройти без ошибок — иначе элемент не берём
  }catch{ return null; }
  return el;
}
function cleanPrices(src: unknown): PriceSettings {
  const out = clonePriceDefaults();
  const s = src as Partial<PriceSettings> | null;
  if(!s || typeof s !== 'object') return out;
  const n = (v: unknown) => { const x = Number(v); return (isFinite(x) && x >= 0 && x <= 1e9) ? x : 0; };
  (['pvc','alu'] as const).forEach(m => {
    (Object.keys(out.profile[m]) as (keyof PriceSettings['profile']['pvc'])[]).forEach(k => { out.profile[m][k] = n(s.profile && s.profile[m] && s.profile[m][k]); });
  });
  (Object.keys(out.accessory) as (keyof PriceSettings['accessory'])[]).forEach(k => { out.accessory[k] = n(s.accessory && s.accessory[k]); });
  (['pvc','alu'] as const).forEach(k => { out.panel[k] = n(s.panel && s.panel[k]); });
  out.glass = n(s.glass);
  if(s.sill && typeof s.sill === 'object') SILL_WIDTHS.forEach(w => { out.sill[w] = n((s.sill as Record<number, unknown>)[w]); });
  out.reinf = n(s.reinf);
  out.net = n(s.net);
  if(s.waste && typeof s.waste === 'object'){
    if(isWasteMode(s.waste.mode)) out.waste.mode = s.waste.mode;
    out.waste.percent = Math.min(100, n(s.waste.percent));
  }
  out.tax = Math.min(100, n(s.tax));
  out.currency = safeText(s.currency, 8, PRICE_DEFAULTS.currency);
  out.decimals = Math.min(4, Math.floor(n(s.decimals)));
  if(s.glassByType && typeof s.glassByType === 'object')
    GLASS_TYPES.forEach(g => { const v = n((s.glassByType as Record<string, unknown>)[g.code]); if(v > 0) out.glassByType[g.code] = v; });
  out.bead = n(s.bead);
  out.seal = n(s.seal);
  if(s.colorPct && typeof s.colorPct === 'object'){
    out.colorPct.colored = Math.min(100, n(s.colorPct.colored));
    out.colorPct.laminated = Math.min(100, n(s.colorPct.laminated));
  }
  if(s.works && typeof s.works === 'object') WORK_KEYS.forEach(k => { out.works[k] = n((s.works as Record<string, unknown>)[k]); });
  return out;
}
const WORK_KEYS: WorkKey[] = ['install', 'dismantle', 'slopes', 'delivery'];
// смета проекта: скидка, аванс, включённые работы — только известные поля и разумные значения
function cleanEstimateFields(src: Raw, project: Project): void {
  const d = src.discount as Raw | undefined;
  if(d && typeof d === 'object' && (d.mode === 'sum' || d.mode === 'pct')){
    const v = safeNum(d.value, 0, d.mode === 'pct' ? 100 : 1e12);
    if(v !== null) project.discount = { mode: d.mode, value: v };
  }
  const adv = safeNum(src.advance, 0, 1e12);
  if(adv !== null && src.advance !== undefined && src.advance !== null) project.advance = adv;
  const w = src.works as Raw | undefined;
  if(w && typeof w === 'object'){
    const on: Partial<Record<WorkKey, boolean>> = {};
    WORK_KEYS.forEach(k => { if(w[k] === true) on[k] = true; });
    if(Object.keys(on).length) project.works = on;
  }
}
function pricesAreUntouched(): boolean {
  const s = S.prices, zero = (o: object) => Object.values(o).every(v => !v);
  return zero(s.profile.pvc) && zero(s.profile.alu) && zero(s.accessory) && zero(s.panel) && !s.glass && !s.tax
      && !s.reinf && !s.net && zero(s.glassByType) && !s.bead && !s.seal && zero(s.colorPct) && zero(s.works);
}

export function importProjects(): void { $input('importFile').click(); }
export async function importProjectsFromFile(input: HTMLInputElement): Promise<void> {
  const file = input.files && input.files[0];
  input.value = '';                                     // чтобы тот же файл можно было выбрать снова
  if(!file) return;
  if(file.size > 30 * 1024 * 1024){ showToast('Файл слишком большой'); return; }
  let text: string;
  try{ text = await file.text(); }catch(err){ console.error(err); showToast('Не удалось прочитать файл'); return; }
  await importBackupText(text);
}
/** Импорт содержимого файла копии (выбранного вручную или найденного в папке копий). */
async function importBackupText(text: string): Promise<void> {
  try{
    if(text.length > 30 * 1024 * 1024){ showToast('Файл слишком большой'); return; }
    const data = JSON.parse(text) as Raw | null;
    if(!data || data.format !== BACKUP_FORMAT || !Array.isArray(data.projects)){ showToast('Это не файл резервной копии проектов'); return; }

    const before = { projects: S.projects, nextId: S.nextId, nextElemId: S.nextElemId, nextNodeId: S.nextNodeId };   // для отката
    const used = new Set(S.projects.map(p => Number(p.number)));
    const have = new Set(S.projects.map(projectFingerprint));   // повторный импорт той же копии не дублирует проекты
    let added = 0, skipped = 0, dups = 0;
    const fresh: Project[] = [];
    const overLimit = Math.max(0, (data.projects as unknown[]).length - IMPORT_MAX_PROJECTS);
    (data.projects as unknown[]).slice(0, IMPORT_MAX_PROJECTS).forEach(raw => {
      const src = raw as Raw | null;
      if(!src || typeof src !== 'object') return;
      let number = Number(src.number);
      if(!(Number.isInteger(number) && number > 0 && number < 1e9) || used.has(number)) number = Math.max(0, ...used) + 1;
      used.add(number);
      const project: Project = {
        id: S.nextId++, number,
        name: safeText(src.name, 200, 'Проект ' + number),
        date: safeText(src.date, 40, 'Сегодня'),
        type: (src.type === 'alu') ? 'alu' : 'pvc',
        phone: safeText(src.phone, 60), address: safeText(src.address, 200), description: safeText(src.description, 1000),
        elements: []
      };
      const dc = safeText(src.defaultColor, 40);
      if(dc) project.defaultColor = dc;
      const dg = safeText(src.defaultGlass, 40);
      if(dg && GLASS_TYPES.some(g => g.code === dg)) project.defaultGlass = dg;
      cleanEstimateFields(src, project);
      (Array.isArray(src.elements) ? src.elements.slice(0, IMPORT_MAX_ELEMENTS) : []).forEach(e => {
        const el = cleanElement(e, project);
        if(el) project.elements.push(el); else skipped++;
      });
      const fp = projectFingerprint(project);
      if(have.has(fp)){ dups++; return; }
      have.add(fp);
      fresh.push(project);
      added++;
    });
    if(added === 0 && !dups){ showToast('В файле нет проектов'); return; }
    S.projects = fresh.concat(S.projects);               // импортированные — сверху
    // сначала проекты: не сохранились (память заполнена) — возвращаем всё как было, цены и склад не трогаем
    if(!saveProjects(true)){
      Object.assign(S, before);
      rerenderList();
      showToast('Проекты не сохранены: память телефона заполнена. Удалите старые проекты и повторите импорт.', 6000);
      return;
    }
    let msg = '';
    if(data.priceSettings && pricesAreUntouched()){
      S.prices = cleanPrices(data.priceSettings);
      persistPriceSettings();
      msg = ' Цены загружены.';
    }
    // отключённые цвета — только если на этом устройстве ничего ещё не отключали
    if(Array.isArray(data.catalogOff) && S.catalogOff.size === 0){
      const off = data.catalogOff.filter((x): x is string => typeof x === 'string').slice(0, 2000);
      if(off.length){ S.catalogOff = new Set(off); catalogSaveOff(); }
    }
    // склад — только если на этом устройстве он ещё пуст
    const whData = data.warehouse as Raw | undefined;
    if(whData && typeof whData === 'object' && Array.isArray(whData.remnants) && S.warehouseRemnants.length === 0){
      const kerf = Number(whData.kerfThickness) > 0 ? Number(whData.kerfThickness) : 5;
      const cleanRemnants = (whData.remnants as unknown[]).slice(0, 2000).flatMap(raw => {
        const r = raw as Raw | null;
        if(!r || typeof r !== 'object') return [];
        const color = safeText(r.color, 60) || WH_NO_COLOR;
        const lengthMm = safeNum(r.lengthMm, 1, 100000), qty = safeNum(r.qty, 1, 100000);
        if(lengthMm === null || qty === null) return [];
        return [whNormalizeRemnant({ id: S.whNextId++, material: r.material === 'alu' ? 'alu' : 'pvc', role: String(r.role || ''), color,
                                     lengthMm: Math.round(lengthMm), qty: Math.round(qty) })];
      });
      if(cleanRemnants.length){
        S.warehouseRemnants = cleanRemnants;
        wh.matcher = new WarehouseMatcher(kerf);
        saveWarehouse();
        msg += ' Склад загружен.';
      }
    }
    // настройки раскроя — только если ещё не менялись
    if(data.cuttingSettings && typeof data.cuttingSettings === 'object' && cuttingSettingsAreUntouched()){
      S.cutting = normalizeCuttingSettings(data.cuttingSettings);
      saveCuttingSettings(S.cutting);
      msg += ' Настройки раскроя загружены.';
    }
    rerenderList();
    if(await adoptBackupCode(data.licenseCode)) msg += ' Активация восстановлена.';
    if(overLimit) msg += ' Пропущено проектов сверх ' + IMPORT_MAX_PROJECTS + ': ' + overLimit + '.';
    showToast('Импортировано проектов: ' + added + (skipped ? ' (пропущено элементов: ' + skipped + ')' : '')
      + (dups ? ', уже были: ' + dups : '') + '.' + msg);
  }catch(err){
    console.error(err);
    showToast('Не удалось прочитать файл');
  }
}
