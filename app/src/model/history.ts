// История изменений элемента (снимки JSON) и проверка допустимости, как в старом проекте.
import type { Project, TreeNode, WinElement } from '../types.ts';
import { insetRect, computeLayout, quadOk } from './layout.ts';
import { profileFor, sashInset, sashProfile } from '../data/profiles.ts';
import { getCurrentProject, saveProjects } from '../storage.ts';
import { showToast } from '../ui/dom.ts';

export const MIN_CELL = 1;     // минимальный размер ячейки вдоль оси, мм (в старом проекте минимума нет — только стекло > 0)
export const INVALID_ELEMENT_MSG = 'Текущий элемент недопустимый';

export function resetHistory(e: WinElement | null | undefined): void { if(e){ e.history = []; e.redo = []; } }

export function snapshotElement(e: WinElement): string {
  return JSON.stringify({ width:e.width, height:e.height, root:e.root, tpl:e.slidingTemplate || null });
}
export function restoreSnapshot(e: WinElement, str: string): void {
  const s = JSON.parse(str) as { width: number | string; height: number | string; root: TreeNode | null; tpl: string | null };
  e.width = s.width; e.height = s.height; e.root = s.root; e.slidingTemplate = s.tpl || null;
}
export interface ChangeToken { snap: string; }
export function beginChange(e: WinElement): ChangeToken {
  if(!Array.isArray(e.history)) e.history = [];
  if(!Array.isArray(e.redo))    e.redo = [];
  return { snap: snapshotElement(e) };
}
// true — изменение принято; false — элемент стал недопустимым, откат к снимку и тост
export function finishChange(e: WinElement, tok: ChangeToken, skipValidation?: boolean): boolean {
  if(!skipValidation && !isElementValid(e)){
    restoreSnapshot(e, tok.snap);
    showToast(INVALID_ELEMENT_MSG);
    return false;
  }
  if(snapshotElement(e) === tok.snap) return true;   // ничего не изменилось
  e.history.push(tok.snap);
  e.redo = [];                                       // новое действие обнуляет «вернуть»
  saveProjects();
  return true;
}

// Допустимость (project — для сервера API; по умолчанию текущий проект): у каждого стекла после рамы, створки и штапика ширина и высота > 0, квоты делений ≥ MIN_CELL.
export function isElementValid(e: WinElement, project?: Project | null): boolean {
  if(e.type === 'sill'){
    const w = parseFloat(String(e.width)), h = parseFloat(String(e.height));
    return w > 0 && h > 0;
  }
  try{
    const prof = profileFor(project !== undefined ? project : getCurrentProject());
    const out = computeLayout(e, prof);
    const sliding = (e.type === 'sliding');
    const bead = prof.bead;
    const fin = (r: { x: number; y: number; w: number; h: number } | undefined) => !!r && isFinite(r.x) && isFinite(r.y) && isFinite(r.w) && isFinite(r.h);
    const glassOk = (cell: { x: number; y: number; w: number; h: number }) => { const g = insetRect(cell, bead); return fin(g) && g.w > 0 && g.h > 0; };
    const cellOk  = (c: { x: number; y: number; w: number; h: number }) => fin(c) && c.w >= MIN_CELL && c.h >= MIN_CELL;

    if(!(out.inner.w > 0 && out.inner.h > 0)) return false;
    const quotasOk = (node: TreeNode | null | undefined): boolean => {
      if(!node) return true;
      if(node.kind === 'leaf') return node.inner ? quotasOk(node.inner) : true;
      if(node.sizes && node.sizes.some(x => !(x >= MIN_CELL - 1e-6))) return false;
      return node.children!.every(quotasOk);
    };
    if(!quotasOk(e.root)) return false;

    return out.leaves.every(l => {
      const n = l.node;
      const cell = l.cell || l.rect;
      if(l.quad && !quadOk(l.quad)) return false;
      if(!cellOk(cell)) return false;
      if(!n.opening) return glassOk(cell);
      if(sliding) return glassOk(insetRect(l.rect, sashProfile(prof, n.opening)));
      if(l.inner) return l.inner.leaves.every(il => cellOk(il.rect) && glassOk(il.rect));
      return glassOk(insetRect(cell, sashInset(prof, n.opening)));
    });
  }catch{
    return false;
  }
}
