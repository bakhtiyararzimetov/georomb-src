// Меню по долгому нажатию: на карточке проекта (главный экран) и на карточке элемента (экран проекта).
// Защита от «хвоста» нажатия: меню появляется под пальцем, отпускание не должно сразу нажать пункт.
import { S } from '../state.ts';
import { $, showToast, vibrate } from '../ui/dom.ts';
import { openConfirm } from '../ui/dialogs.ts';
import { getCurrentProject, saveProjects } from '../storage.ts';
import { DELETE_PROJECT_TEXT, copyProject, deleteProject, openProjectForm, openProjectSummaryFor, renderCanvas } from './projects.ts';
import { copyCurrentElement, openElementSummary, startEditElement } from './elementForm.ts';

const HOLD_MS = 500;    // сколько держать палец
const MOVE_TOL = 10;    // сдвиг в px, после которого это уже прокрутка
let pcmProjectId: number | null = null;
let pecmElementId: number | null = null;
let pressTimer: ReturnType<typeof setTimeout> | null = null, pressStart: { x: number; y: number } | null = null, pressFired = false;
let pointerDown = false;   // сейчас есть касание
let guard = false;         // меню открыто, а открывший его палец ещё не отпущен
let guardUntil = 0;        // и ещё немного после отпускания
const blocked = () => guard || Date.now() < guardUntil;
function armGuard(): void { if(pointerDown) guard = true; else guardUntil = Date.now() + 350; }

// ===== меню проекта =====
function pcmOpen(id: number): void {
  if(pcmProjectId !== null) return;
  if(!S.projects.some(p => p.id === id)) return;
  pcmProjectId = id;
  armGuard();
  $('pcmMenu').scrollTop = 0;
  $('pcmBackdrop').classList.add('open');
  vibrate(12);
}
export function pcmClose(): void {
  pcmProjectId = null;
  $('pcmBackdrop').classList.remove('open');
}
export function pcmBackdropClick(ev: Event): void {
  if(ev.target !== ev.currentTarget) return;   // нажали на пункт меню
  if(blocked()) return;
  pcmClose();
}
export function pcmAction(action: string): void {
  if(blocked()) return;
  const id = pcmProjectId;
  pcmClose();
  const project = S.projects.find(p => p.id === id);
  if(!project || id === null) return;
  switch(action){
    case 'edit': openProjectForm(project); break;
    case 'copy': copyProject(id); break;
    case 'delete':
      openConfirm(DELETE_PROJECT_TEXT, () => { deleteProject(id); showToast('Проект удалён'); });
      break;
    case 'summary': openProjectSummaryFor(project); break;
  }
}

// ===== меню элемента =====
function pecmOpen(elId: number): void {
  if(pecmElementId !== null || pcmProjectId !== null) return;
  const project = getCurrentProject();
  if(!project || !project.elements.some(e => e.id === elId)) return;
  pecmElementId = elId;
  armGuard();
  $('pecmMenu').scrollTop = 0;
  $('pecmBackdrop').classList.add('open');
  vibrate(12);
}
export function pecmClose(): void {
  pecmElementId = null;
  $('pecmBackdrop').classList.remove('open');
}
export function pecmBackdropClick(ev: Event): void {
  if(ev.target !== ev.currentTarget) return;
  if(blocked()) return;
  pecmClose();
}
export function pecmAction(action: string): void {
  if(blocked()) return;
  const elId = pecmElementId;
  pecmClose();
  const project = getCurrentProject();
  if(!project) return;
  const idx = project.elements.findIndex(e => e.id === elId);
  if(idx === -1) return;
  switch(action){
    case 'edit': S.currentElementIndex = idx; startEditElement(); break;   // функции работают с «текущим элементом»
    case 'delete':
      openConfirm('Удалить элемент ' + (idx + 1) + '?', () => {
        const i = project.elements.findIndex(e => e.id === elId);   // ищем по id: порядок мог измениться
        if(i === -1) return;
        project.elements.splice(i, 1);
        saveProjects();
        renderCanvas();
        showToast('Элемент удалён');
      });
      break;
    case 'copy': S.currentElementIndex = idx; copyCurrentElement(); break;
    case 'summary': S.currentElementIndex = idx; openElementSummary(); break;
  }
}

// id берём из onclick карточки (разметку списков не трогаем)
function bindLongPress(box: HTMLElement, cardSel: string, idRe: RegExp, open: (id: number) => void): void {
  const cardOf = (t: EventTarget | null) => (t instanceof Element) ? t.closest(cardSel) : null;
  const idOf = (card: Element) => { const m = idRe.exec(card.getAttribute('onclick') || ''); return m ? Number(m[1]) : null; };
  const cancelPress = () => { if(pressTimer) clearTimeout(pressTimer); pressTimer = null; pressStart = null; };
  box.addEventListener('pointerdown', ev => {
    pressFired = false;
    if(ev.pointerType === 'mouse' && ev.button !== 0) return;
    const card = cardOf(ev.target);
    if(!card) return;
    const id = idOf(card);
    if(id === null) return;
    cancelPress();
    pressStart = { x:ev.clientX, y:ev.clientY };
    pressTimer = setTimeout(() => { pressTimer = null; pressFired = true; open(id); }, HOLD_MS);
  });
  box.addEventListener('pointermove', ev => {
    if(!pressStart) return;
    if(Math.abs(ev.clientX - pressStart.x) > MOVE_TOL || Math.abs(ev.clientY - pressStart.y) > MOVE_TOL) cancelPress();
  });
  // после долгого нажатия отпускание не должно открывать саму карточку
  box.addEventListener('click', ev => { if(pressFired){ ev.stopPropagation(); ev.preventDefault(); } }, true);
  // правая кнопка мыши и системное долгое нажатие Android — то же меню
  box.addEventListener('contextmenu', ev => {
    const card = cardOf(ev.target);
    if(!card) return;
    ev.preventDefault();
    const id = idOf(card);
    if(id !== null){ pressFired = true; open(id); }
  });
}

export function initLongPressMenus(): void {
  bindLongPress($('list'), '.project-card', /openProject\((\d+)\)/, pcmOpen);
  bindLongPress($('projectCanvas'), '.elem-card', /openElementView\((\d+)\)/, pecmOpen);
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  (['pointerup', 'pointercancel'] as const).forEach(type => document.addEventListener(type, () => {
    pointerDown = false;
    if(guard){ guard = false; guardUntil = Date.now() + 350; }
    if(pressTimer) clearTimeout(pressTimer);
    pressTimer = null; pressStart = null;
    if(pressFired) setTimeout(() => { pressFired = false; }, 400);
  }));
  document.addEventListener('keydown', ev => {
    if(ev.key !== 'Escape') return;
    if(pcmProjectId !== null) pcmClose();
    if(pecmElementId !== null) pecmClose();
  });
}
