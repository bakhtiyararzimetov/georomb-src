// Цепочки размеров и правка размеров (порт e.c() / t.a() старого Android-проекта).
import { DEFAULT_H, DEFAULT_W } from '../state.ts';
import type { NodeRef, Rect, TreeNode, WinElement } from '../types.ts';
import { profileFor } from '../data/profiles.ts';
import { getCurrentProject } from '../storage.ts';
import { showToast } from '../ui/dom.ts';
import { computeLayout, parseMm } from './layout.ts';
import { findNode } from './tree.ts';
import { INVALID_ELEMENT_MSG, MIN_CELL } from './history.ts';

export interface DimSeg { size: number; nid: number; index: number; refs: NodeRef[]; off: number; }
export interface ChainCtx { innerRect: (nid: number) => Rect | null; }

// список ссылок {nid,index} ↔ строка "nid:index,nid:index" (передаётся одним аргументом в onclick)
export function encodeNodeRefs(list: NodeRef[] | null | undefined): string {
  return (list || []).map(r => r.nid + ':' + r.index).join(',');
}
export function decodeNodeRefs(str: string | null | undefined): NodeRef[] {
  if(!str) return [];
  return String(str).split(',').filter(Boolean).map(pair => {
    const parts = pair.split(':');
    return { nid:parseInt(parts[0], 10), index:parseInt(parts[1], 10) };
  });
}

// Общая цепочка по оси: все импосты окна по координате, одна цепочка на ось. Один импост, идущий через
// несколько строк/колонок, — несколько узлов дерева; они группируются по позиции (допуск 0,5 мм) в один сегмент.
// ctx — заходить ли в переплёт створки (экран элемента); без ctx (PDF) переплёт не разворачивается.
export function globalChain(root: TreeNode | null | undefined, axis: 'x' | 'y', ctx: ChainCtx | null, total: number): DimSeg[] {
  const cuts: { pos: number; node: TreeNode; index: number }[] = [];
  const walk = (node: TreeNode | null | undefined, pos: number, len: number): void => {
    if(!node) return;
    if(node.kind === 'leaf'){
      if(ctx && node.inner){
        const ir = ctx.innerRect(node.nid);
        if(ir) walk(node.inner, axis === 'x' ? ir.x : ir.y, axis === 'x' ? ir.w : ir.h);
      }
      return;
    }
    if(node.kind !== 'branch' || !node.sizes) return;
    const sizes = node.sizes;
    const along = (axis === 'x') ? (node.dir === 'v') : (node.dir === 'h');
    let p = pos;
    node.children!.forEach((c, i) => {
      walk(c, along ? p : pos, along ? sizes[i] : len);
      if(along){
        p += sizes[i];
        if(i < node.children!.length - 1) cuts.push({ pos:p, node, index:i });
      }
    });
  };
  walk(root, 0, total);
  cuts.sort((a, b) => a.pos - b.pos);
  const groups: { pos: number; items: typeof cuts }[] = [];
  cuts.forEach(c => {
    if(c.pos <= 0.5 || c.pos >= total - 0.5) return;
    const last = groups[groups.length - 1];
    if(last && c.pos - last.pos <= 0.5) last.items.push(c);
    else groups.push({ pos:c.pos, items:[c] });
  });
  if(!groups.length) return [];
  const sizeOf = (c: (typeof cuts)[number], idx: number) => c.node.sizes![idx];
  const segs: DimSeg[] = [];
  // Высота (как в старом проекте, ось Y вверх): сегмент ниже импоста ссылается на ячейку ПОД ним (index + 1),
  // самый верхний — на ячейку над первым импостом.
  if(axis === 'y'){
    const g0 = groups[0];
    const topRefs = g0.items.map(c => ({ nid:c.node.nid, index:c.index }));
    segs.push({ size:g0.pos, nid:topRefs[0].nid, index:topRefs[0].index, refs:topRefs,
                off:g0.pos - sizeOf(g0.items[0], g0.items[0].index) });
    groups.forEach((g, k) => {
      const end = (k < groups.length - 1) ? groups[k + 1].pos : total;
      const seg = end - g.pos;
      const refs = g.items.map(c => ({ nid:c.node.nid, index:c.index + 1 }));
      segs.push({ size:seg, nid:refs[0].nid, index:refs[0].index, refs, off:seg - sizeOf(g.items[0], g.items[0].index + 1) });
    });
    return segs;
  }
  let prev = 0;
  groups.forEach(g => {
    const seg = g.pos - prev;
    const refs = g.items.map(c => ({ nid:c.node.nid, index:c.index }));
    segs.push({ size:seg, nid:refs[0].nid, index:refs[0].index, refs, off:seg - sizeOf(g.items[0], g.items[0].index) });
    prev = g.pos;
  });
  const lastGroup = groups[groups.length - 1], lseg = total - lastGroup.pos;
  const lastRefs = lastGroup.items.map(c => ({ nid:c.node.nid, index:c.index + 1 }));
  segs.push({ size:lseg, nid:lastRefs[0].nid, index:lastRefs[0].index, refs:lastRefs,
              off:lseg - sizeOf(lastGroup.items[0], lastGroup.items[0].index + 1) });
  return segs;
}

// Правка размера ячейки: сумма родителя не меняется, разницу забирает ОДНА соседняя ячейка за сдвигаемым
// импостом (по ширине — справа, у крайнего — слева; по высоте — выше, у верхнего — ниже).
export function setNodeSize(parent: TreeNode, index: number, value: number): boolean {
  if(!(value >= MIN_CELL)){
    showToast(INVALID_ELEMENT_MSG);
    return false;
  }
  const sizes = parent.sizes!;
  const n = sizes.length;
  const delta = value - sizes[index];
  if(delta !== 0 && n > 1){
    const absorber = (parent.dir === 'h')
      ? (index > 0 ? index - 1 : index + 1)
      : (index < n - 1 ? index + 1 : index - 1);
    const next = sizes[absorber] - delta;
    if(!(next >= MIN_CELL)){
      showToast(INVALID_ELEMENT_MSG);
      return false;
    }
    sizes[absorber] = next;
  }
  sizes[index] = value;
  return true;
}

// Сегмент, за которым стоят несколько узлов (один импост в нескольких строках): все сдвигаются на одну и ту же
// величину; если хотя бы один не принял — откат всех (правка не бывает наполовину синхронизированной).
export function setNodeSizeSynced(e: WinElement, nodes: NodeRef[], value: number): boolean {
  const targets = (nodes || [])
    .map(item => ({ item, node:findNode(e.root, item.nid) }))
    .filter((t): t is { item: NodeRef; node: TreeNode } => !!t.node && Array.isArray(t.node.sizes) && t.node.sizes[t.item.index] !== undefined);
  if(!targets.length) return false;
  const delta = value - targets[0].node.sizes![targets[0].item.index];
  const backups = targets.map(t => t.node.sizes!.slice());
  for(let i = 0; i < targets.length; i++){
    const { item, node } = targets[i];
    if(!setNodeSize(node, item.index, node.sizes![item.index] + delta)){
      for(let j = 0; j < i; j++) targets[j].node.sizes = backups[j];
      return false;
    }
  }
  return true;
}

// Прибавить delta к крайней ячейке вдоль оси (ширина — правый столбец, высота — ВЕРХНИЙ ряд, как в старом проекте).
// dry — только проверить, что ни одна ячейка не станет меньше MIN_CELL.
function growLast(node: TreeNode | null | undefined, axis: 'x' | 'y', delta: number, dry: boolean): boolean {
  if(!node) return true;
  if(node.kind === 'leaf') return node.inner ? growLast(node.inner, axis, delta, dry) : true;
  const children = node.children!;
  const cuts = (axis === 'x') ? (node.dir === 'v') : (node.dir === 'h');
  if(!cuts) return children.every(c => growLast(c, axis, delta, dry));
  if(!node.sizes || node.sizes.length !== children.length) return true;
  const i = (axis === 'x') ? children.length - 1 : 0;
  const next = node.sizes[i] + delta;
  if(next < MIN_CELL) return false;
  if(!growLast(children[i], axis, delta, dry)) return false;
  if(!dry) node.sizes[i] = next;
  return true;
}
// Правка общей ширины/высоты: меняется только крайняя ячейка вдоль оси
export function setElementSize(e: WinElement, which: 'width' | 'height', value: number): boolean {
  if(e.type === 'sill'){ e[which] = String(value); return true; }
  computeLayout(e, profileFor(getCurrentProject()));   // sizes всех узлов актуальны
  const old = parseMm(e[which]) || (which === 'width' ? DEFAULT_W : DEFAULT_H);
  const axis = (which === 'width') ? 'x' : 'y';
  const delta = value - old;
  if(!growLast(e.root, axis, delta, true)){
    showToast(INVALID_ELEMENT_MSG);
    return false;
  }
  growLast(e.root, axis, delta, false);
  e[which] = String(value);
  return true;
}
