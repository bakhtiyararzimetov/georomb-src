// Дерево делений элемента: импосты, створки, переплёты (логика из DesignActivity старого проекта).
import { S } from '../state.ts';
import type { Dir, TreeNode, WinElement } from '../types.ts';
import { SLIDING_TEMPLATES } from '../data/profiles.ts';

export function newLeaf(): TreeNode {
  return { nid: S.nextNodeId++, kind:'leaf', fill:'glass', opening:null };
}
// любой новый элемент (створный и раздвижной) — пустая рама с одним стеклом
export function ensureRoot(e: WinElement): TreeNode {
  if(!e.root) e.root = newLeaf();
  return e.root;
}
// деление глухого листа: все части — обычное стекло (деление створки идёт через node.inner)
export function splitNode(node: TreeNode, dir: Dir, count: number): TreeNode {
  const kids: TreeNode[] = [];
  for(let i = 0; i < count; i++) kids.push(newLeaf());
  node.kind = 'branch';
  node.dir = dir;
  node.children = kids;
  node.sizes = null;       // null => поровну
  delete node.fill;
  delete node.opening;
  return kids[0];
}
export function findNode(node: TreeNode | null | undefined, nid: number): TreeNode | null {
  if(!node) return null;
  if(node.nid === nid) return node;
  if(node.kind === 'leaf') return node.inner ? findNode(node.inner, nid) : null;   // переплёт внутри створки
  for(const c of node.children!){
    const r = findNode(c, nid);
    if(r) return r;
  }
  return null;
}
export function findParent(node: TreeNode | null | undefined, nid: number, parent?: TreeNode): TreeNode | null {
  if(!node) return null;
  if(node.nid === nid) return parent || null;
  if(node.kind === 'leaf') return node.inner ? findParent(node.inner, nid, node) : null;
  for(const c of node.children!){
    const r = findParent(c, nid, node);
    if(r) return r;
  }
  return null;
}
export function firstLeaf(node: TreeNode): TreeNode {
  if(node.kind === 'leaf') return node;
  return firstLeaf(node.children![0]);
}
// створка, внутри переплёта которой лежит узел nid; null, если узел не во внутреннем дереве
export function findSashOwner(node: TreeNode | null | undefined, nid: number): TreeNode | null {
  if(!node) return null;
  if(node.kind === 'leaf') return (node.inner && findNode(node.inner, nid)) ? node : null;
  for(const c of node.children!){
    const r = findSashOwner(c, nid);
    if(r) return r;
  }
  return null;
}
export function maxNodeId(node: TreeNode | null | undefined): number {
  if(!node) return 0;
  let m = node.nid || 0;
  if(node.children) node.children.forEach(c => { m = Math.max(m, maxNodeId(c)); });
  if(node.inner) m = Math.max(m, maxNodeId(node.inner));
  return m;
}
/** Новые nid всем узлам (копии элемента/проекта не должны повторять nid оригинала). */
export function renumberTree(node: TreeNode | null | undefined): void {
  if(!node) return;
  node.nid = S.nextNodeId++;
  if(node.children) node.children.forEach(renumberTree);
  if(node.inner) renumberTree(node.inner);
}

// Все импосты одного направления в одной области — одна цепочка: вложенная ветка того же направления
// разворачивается в родителя (квоты — пропорционально). Вызывается после layoutNode. true — дерево изменилось.
export function flattenSameDir(node: TreeNode | null | undefined): boolean {
  if(!node) return false;
  if(node.kind === 'leaf') return node.inner ? flattenSameDir(node.inner) : false;
  let changed = false;
  const children = node.children!;
  children.forEach(c => { if(flattenSameDir(c)) changed = true; });
  if(node.dividers || !Array.isArray(node.sizes) || node.sizes.length !== children.length) return changed;
  const sizes = node.sizes;
  for(let i = 0; i < children.length; i++){
    const c = children[i];
    if(c.kind !== 'branch' || c.dir !== node.dir || c.dividers) continue;
    if(!Array.isArray(c.sizes) || c.sizes.length !== c.children!.length) continue;
    const sum = c.sizes.reduce((a, b) => a + b, 0) || 1;
    const parts = c.sizes.map(x => x * sizes[i] / sum);
    children.splice(i, 1, ...c.children!);
    sizes.splice(i, 1, ...parts);
    i += c.children!.length - 1;
    changed = true;
  }
  return changed;
}

// применить шаблон раздвижной ко всему элементу: очистить дерево, разбить по 'v' на N частей, проставить opening
export function applySlidingTemplate(e: WinElement, tag: string): void {
  const t = SLIDING_TEMPLATES[tag];
  if(!t) return;
  const root = newLeaf();
  splitNode(root, 'v', t.cells.length);
  root.dividers = t.dividers.slice();
  root.children!.forEach((c, i) => { c.opening = Object.assign({}, t.cells[i]); });
  e.root = root;
  e.slidingTemplate = tag;
}

export function isElementEmpty(e: WinElement | null | undefined): boolean {
  const r = e && e.root;
  return !r || (r.kind === 'leaf' && !r.opening && !r.inner && (!r.fill || r.fill === 'glass'));
}
