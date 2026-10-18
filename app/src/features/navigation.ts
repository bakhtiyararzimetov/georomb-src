// Вкладки нижней панели, кнопка «Назад» Android (Capacitor), жест «назад» от края экрана.
import { $, isOpen, vibrate } from '../ui/dom.ts';
import { closeColorPicker, closeConfirm, closeSummary } from '../ui/dialogs.ts';
import { nativePlugins } from '../platform/capacitor.ts';
import { closeNewProject, closeProjectMenu, closeProjectScreen } from './projects.ts';
import { closeEditElement, closeElementForm, closeElementMenu } from './elementForm.ts';
import { closeDimSheet, closeElementView } from './elementView.ts';
import { close3DView } from './view3d.ts';
import { closeCatalogProjectPicker, closeColorSetting } from './catalog.ts';
import { closeCutHelp, closeCutProjectPicker } from './cutting.ts';
import { closeWhAdd, closeWhPickPiece, closeWhPickProject, closeWhPicker, closeWhSearch } from './warehouse.ts';
import { closePriceEstimate, closePriceSetting } from './priceScreens.ts';
import { closeExportPicker } from './backup.ts';
import { pcmClose, pecmClose } from './menus.ts';
import { closeAbout } from './about.ts';
import { closeGlassScreen } from './glassList.ts';
import { closePdfOptions } from './pdfI18n.ts';

export type TabName = 'settings' | 'catalog' | 'cutting' | 'warehouse';
const TAB_SCREENS: Record<TabName, string> = {
  settings:'settingsScreen', catalog:'catalogScreen', cutting:'cuttingScreen', warehouse:'warehouseScreen'
};
const NAV: Record<TabName | 'projects', string> = {
  projects:'navProjects', catalog:'navCatalog', settings:'navSettings', cutting:'navCutting', warehouse:'navWarehouse'
};

// переключение вкладок — мгновенно: на момент смены отключаем transition у экранов-вкладок
function tabNoAnim(): void {
  const els = Object.values(TAB_SCREENS).map(id => $(id));
  els.forEach(el => el.classList.add('no-anim'));
  void els[0].offsetWidth;
  setTimeout(() => els.forEach(el => el.classList.remove('no-anim')), 80);
}
export function setActiveTab(name: TabName | 'projects'): void {
  (Object.keys(NAV) as (TabName | 'projects')[]).forEach(k => $(NAV[k]).classList.toggle('active', k === name));
}
/** Открыть вкладку (остальные закрываются); null — вернуться к списку проектов. */
export function showTab(name: TabName | null): void {
  tabNoAnim();
  (Object.keys(TAB_SCREENS) as TabName[]).forEach(k => $(TAB_SCREENS[k]).classList.toggle('open', k === name));
  setActiveTab(name || 'projects');
}
export function openSettings(): void { showTab('settings'); }
export function closeSettings(): void { showTab(null); }

// Порядок «Назад»: 1) верхняя шторка/диалог; 2) верхний экран (от вложенных к корневым);
// 3) на списке проектов — свернуть приложение. fromGesture — жест от края: на корне ничего не делаем.
export function handleHardwareBack(fromGesture?: boolean): void {
  const overlays: [string, () => void][] = [
    ['cutHelpBackdrop', closeCutHelp],
    ['whPickerBackdrop', closeWhPicker],
    ['whAddBackdrop', closeWhAdd],
    ['whSearchBackdrop', closeWhSearch],
    ['whPickPieceBackdrop', closeWhPickPiece],
    ['whPickProjectBackdrop', closeWhPickProject],
    ['colorPickBackdrop', closeColorPicker],
    ['dimBackdrop', closeDimSheet],
    ['editElementBackdrop', closeEditElement],
    ['confirmBackdrop', closeConfirm],
    ['summaryBackdrop', closeSummary],
    ['exportPickBackdrop', closeExportPicker],
    ['catalogProjectBackdrop', closeCatalogProjectPicker],
    ['projectMenuBackdrop', closeProjectMenu],
    ['elementMenuBackdrop', closeElementMenu],
    ['pcmBackdrop', pcmClose],
    ['pecmBackdrop', pecmClose],
    ['cutProjectBackdrop', closeCutProjectPicker],
    ['aboutBackdrop', closeAbout],
    ['pdfOptBackdrop', closePdfOptions],
  ];
  for(const [id, close] of overlays){ if(isOpen(id)){ close(); return; } }
  const screens: [string, () => void][] = [
    ['view3dScreen', close3DView],
    ['newProjectScreen', closeNewProject],
    ['elementScreen', closeElementForm],
    ['elementViewScreen', closeElementView],
    ['glassScreen', closeGlassScreen],
    ['projectScreen', closeProjectScreen],
    ['priceEstimateScreen', closePriceEstimate],
    ['priceSettingScreen', closePriceSetting],
    ['colorSettingScreen', closeColorSetting],
    ['cuttingScreen', () => showTab(null)],
    ['warehouseScreen', () => showTab(null)],
    ['catalogScreen', () => showTab(null)],
    ['settingsScreen', closeSettings],
  ];
  for(const [id, close] of screens){ if(isOpen(id)){ close(); return; } }
  if(fromGesture === true) return;
  // корневой экран — сворачиваем приложение (не закрываем процесс резко)
  try{
    const app = nativePlugins()?.App;
    if(app && app.minimizeApp) void app.minimizeApp();
    else if(app && app.exitApp) void app.exitApp();
  }catch(err){ console.error(err); }
}
export function initHardwareBack(): void {
  try{
    const app = nativePlugins()?.App;
    if(app) app.addListener('backButton', () => handleHardwareBack());
  }catch(err){ console.error(err); }
}

// Жест «назад» от края (как Android 13+): кружок со стрелкой, после ~90 px «готов» (ореол, вибрация).
export function initBackGesture(): void {
  const EDGE = 24, FULL = 90;
  const bubble = document.createElement('div');
  bubble.className = 'back-bubble';
  bubble.innerHTML = '<span class="bb-halo"></span><span class="bb-dot"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  document.body.appendChild(bubble);
  const canGoBack = () => !!document.querySelector('.screen.open, .sheet-backdrop.open, .popup-menu-backdrop.open, [id$="Backdrop"].open');
  let st: { x0: number; y0: number; right: boolean; active: boolean; ready: boolean } | null = null;
  const place = (x: number, y: number) => {
    if(!st) return;
    const d = Math.abs(x - st.x0), p = Math.min(1, d / FULL);
    const off = -64 + p * 80;                        // кружок выезжает из-за края до 16 px внутрь
    bubble.style.top = Math.max(8, Math.min(window.innerHeight - 72, y - 32)) + 'px';
    bubble.style.left = st.right ? 'auto' : off + 'px';
    bubble.style.right = st.right ? off + 'px' : 'auto';
    bubble.style.setProperty('--bb-p', p.toFixed(3));
    const ready = p >= 1;
    if(ready && !st.ready) vibrate(10);
    st.ready = ready;
    bubble.classList.toggle('ready', ready);
  };
  const hide = () => { bubble.classList.remove('show', 'ready'); st = null; };
  document.addEventListener('touchstart', ev => {
    if(ev.touches.length !== 1){ if(st) hide(); return; }
    const t = ev.touches[0], w = window.innerWidth;
    const right = t.clientX >= w - EDGE;
    if(!(t.clientX <= EDGE || right) || !canGoBack()) return;
    st = { x0:t.clientX, y0:t.clientY, right, active:false, ready:false };
  }, { passive:true });
  document.addEventListener('touchmove', ev => {
    if(!st) return;
    const t = ev.touches[0], dx = st.right ? st.x0 - t.clientX : t.clientX - st.x0, dy = Math.abs(t.clientY - st.y0);
    if(!st.active){
      if(dy > 12 && dy > dx){ st = null; return; }   // вертикальная прокрутка, не жест
      if(dx < 8) return;
      st.active = true; bubble.classList.add('show');
    }
    ev.preventDefault();
    place(t.clientX, t.clientY);
  }, { passive:false });
  document.addEventListener('touchend', () => {
    if(!st) return;
    const go = st.active && st.ready;
    hide();
    if(go) handleHardwareBack(true);
  });
  document.addEventListener('touchcancel', () => { if(st) hide(); });
}

// «+ Новый проект» прячется на вкладках — дубль CSS :has() для старых WebView
export function initTabFabHide(): void {
  const ids = Object.values(TAB_SCREENS);
  const upd = () => document.body.classList.toggle('tab-open', ids.some(id => isOpen(id)));
  const mo = new MutationObserver(upd);
  ids.forEach(id => { const el = document.getElementById(id); if(el) mo.observe(el, { attributes:true, attributeFilter:['class'] }); });
  upd();
}
