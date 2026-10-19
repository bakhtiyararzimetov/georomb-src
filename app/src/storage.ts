// Сохранение проектов в localStorage. Ключ не меняется — иначе пользователи потеряют проекты.
import { S } from './state.ts';
import type { Project } from './types.ts';
import { maxNodeId } from './model/tree.ts';
import { showToast } from './ui/dom.ts';

export const PROJECTS_STORAGE_KEY = 'iwd.projects.v1';
/** Сюда откладываются повреждённые данные перед тем, как приложение начнёт с чистого листа. */
export const PROJECTS_CORRUPT_KEY = 'iwd.projects.corrupt.v1';
/** Последняя (самая свежая) поломка — если первая уже занята. */
export const PROJECTS_CORRUPT_LAST_KEY = 'iwd.projects.corruptLast.v1';

// история отмены (history / redo) не сохраняется — она нужна только в течение сессии
export const withoutHistory = (k: string, v: unknown): unknown => (k === 'history' || k === 'redo') ? undefined : v;

// подписчик на любые сохранения данных (автокопия в «Документы», features/backup.ts)
let changeListener: (() => void) | null = null;
export function onDataChanged(cb: () => void): void { changeListener = cb; }
export function notifyDataChanged(): void {
  try{ if(changeListener) changeListener(); }catch{ /* копия не должна мешать сохранению */ }
}

let lastSaveWarn = 0;
/** false — не сохранилось (память переполнена или недоступна); пользователь об этом узнаёт. */
export function saveProjects(silent = false): boolean {
  let ok = true;
  try{
    localStorage.setItem(PROJECTS_STORAGE_KEY,
      JSON.stringify({ projects: S.projects, nextId: S.nextId, nextElemId: S.nextElemId }, withoutHistory));
  }catch{
    ok = false;
    // не на каждое нажатие: одно предупреждение в 10 с
    if(!silent && Date.now() - lastSaveWarn > 10_000){
      lastSaveWarn = Date.now();
      try{ showToast('Не удалось сохранить: память телефона заполнена. Удалите старые проекты или сделайте экспорт.', 5000); }catch{ /* нет DOM */ }
    }
  }
  notifyDataChanged();
  return ok;
}
function keepCorrupt(raw: string): void {
  // две копии: первая поломка (её не затираем) и последняя — в ней самые свежие данные
  try{
    const first = localStorage.getItem(PROJECTS_CORRUPT_KEY);
    if(first === null) localStorage.setItem(PROJECTS_CORRUPT_KEY, raw);
    else if(first !== raw) localStorage.setItem(PROJECTS_CORRUPT_LAST_KEY, raw);
  }catch{ /* без копии */ }
}

export function loadProjects(): void {
  let raw: string | null = null;
  try{
    raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if(raw){
      const d = JSON.parse(raw) as { projects?: unknown; nextId?: unknown; nextElemId?: unknown };
      if(d && Array.isArray(d.projects)){
        // одна битая запись не должна стоить остальных проектов: берём все объекты, без id — даём новый
        const list = d.projects.filter((p: unknown): p is Project => !!p && typeof p === 'object' && !Array.isArray(p));
        if(list.length !== d.projects.length) keepCorrupt(raw);
        let next = list.reduce((m, p) => Number.isFinite(p.id) ? Math.max(m, p.id + 1) : m, 1);
        list.forEach(p => { if(!Number.isFinite(p.id)) p.id = next++; });
        S.projects = list;
        if(Number.isFinite(d.nextId))     S.nextId = d.nextId as number;
        if(Number.isFinite(d.nextElemId)) S.nextElemId = d.nextElemId as number;
      }else keepCorrupt(raw);
    }
  }catch{
    // повреждённые данные — начинаем с проектов по умолчанию, но сырую копию сохраняем для восстановления
    if(raw) keepCorrupt(raw);
  }
  try{
    const usedNumbers = new Set(S.projects.map(p => Number(p.number)).filter(n => Number.isFinite(n)));
    S.projects.forEach(p => {
      if(!Array.isArray(p.elements)) p.elements = [];
      p.elements = p.elements.filter(e => e && typeof e === 'object');
      if(p.number == null){                                                   // проекты без номера: номер = id, если он свободен
        p.number = usedNumbers.has(p.id) ? Math.max(0, ...usedNumbers) + 1 : p.id;
        usedNumbers.add(p.number);
      }
      if(typeof p.name !== 'string' || !p.name.trim()) p.name = 'Проект ' + p.number;
      if(typeof p.date !== 'string') p.date = '';
      (['phone', 'address', 'description'] as const).forEach(k => { if(typeof p[k] !== 'string') p[k] = ''; });
      p.elements.forEach(e => {
        e.history = []; e.redo = [];
        if(e.type === 'sill' && e.sill){ e.sill = false; e.sillLen = 0; e.sillWidth = 0; }   // у отдельного подоконника своего нет
        if(Number.isFinite(e.id)) S.nextElemId = Math.max(S.nextElemId, e.id + 1);
        S.nextNodeId = Math.max(S.nextNodeId, maxNodeId(e.root) + 1);         // новые узлы не должны повторять nid загруженных
      });
      S.nextId = Math.max(S.nextId, p.id + 1);
    });
  }catch{ /* частично повреждённые данные — оставляем как есть */ }
}

export function getCurrentProject(): Project | undefined {
  const p = S.projects.find(x => x.id === S.currentProjectId);
  if(p && !p.elements) p.elements = [];
  return p;
}
export function currentElement() {
  const project = getCurrentProject();
  return project ? project.elements[S.currentElementIndex] : null;
}
export function nextFreeNumber(): number {
  return S.projects.reduce((m, p) => Math.max(m, Number(p.number) || 0), 0) + 1;
}
