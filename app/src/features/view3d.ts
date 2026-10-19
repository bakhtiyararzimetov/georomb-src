// 3D-вид элемента (по схеме romchi: Model3DGenerator + transformProfileForFrame + Window3DRenderer).
// По раскладке чертежа (настоящий профиль, мм) сечение профиля вытягивается вдоль сторон, углы — под 45°.
// Стекло — прозрачные листы стеклопакета, ручки/петли — простые тела в цвет рамы.
import { DEFAULT_W, DEFAULT_SILL_DEPTH } from '../state.ts';
import type { Edge, Project, Rect, TreeNode, WinElement } from '../types.ts';
import { $, showToast } from '../ui/dom.ts';
import { elementColorHex } from '../data/colors.ts';
import { findGlass, glassAlpha } from '../data/glass.ts';
import { profileFor, sashBand, sashProfile } from '../data/profiles.ts';
import { computeLayout, insetRect, parseMm } from '../model/layout.ts';
import { HINGE_T, OPPOSITE_EDGE, edgePoint, handleAnchor, tintHex } from '../render/svg.ts';
import { currentElement, getCurrentProject } from '../storage.ts';

type V3 = [number, number, number];
type Col = number[];                         // [r,g,b,a] или [r,g,b,a,волокна]
type Sec = [number, number][];               // сечение: [u — от наружной кромки внутрь, z — глубина]
interface Mesh { p: number[]; n: number[]; c: number[]; g: number[]; l: number[]; lc: number[]; }
interface Buf { p: WebGLBuffer; n: WebGLBuffer; c: WebGLBuffer; g: WebGLBuffer; count: number; }
type GroupKind = 'static' | 'slide' | 'turn' | 'tilt' | 'tiltturn';
interface Group {
  mesh: Mesh | null; glass: Mesh | null; kind: GroupKind;
  slide?: number; edge?: Edge; pivot?: V3; tiltPivot?: V3;
  buf?: Buf | null; gbuf?: Buf | null; lbuf?: Buf | null;
}
interface Model { groups: Group[]; W: number; H: number; D: number; }

const V3D_DEPTH = { pvc:70, alu:60 } as const;   // глубина рамы, мм
const v3d = {
  gl: null as WebGLRenderingContext | null, prog: null as WebGLProgram | null,
  loc: null as null | Record<'aPos' | 'aNor' | 'aCol' | 'aGrain', number> & Record<'uMVP' | 'uModel' | 'uLight' | 'uCam' | 'uGlass' | 'uFlat', WebGLUniformLocation | null>,
  groups: [] as Group[], rotX:10, rotY:-24, zoom:1, open:0, tilt:0, target:{ open:0, tilt:0 },
  raf:0, size:1, center:[0, 0, 0] as V3, hasTurn:false, hasTilt:false, hasSlide:false,
  pointers:new Map<number, [number, number]>(), pinch0:0, zoom0:1
};

function v3dRgb(hex: string): number[] {
  const h = String(hex || '#ffffff').replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, 'f');
  return [0, 2, 4].map(i => parseInt(f.substr(i, 2), 16) / 255);
}
const v3dMesh = (): Mesh => ({ p:[], n:[], c:[], g:[], l:[], lc:[] });
// текстура дерева: 5-й элемент цвета — направление волокон (1 — вдоль x, 2 — вдоль y)
const V3D_WOOD = new Set(['oak_golden', 'oak_rustic', 'mahogany', 'walnut', 'wenge', 'teak', 'ash']);
function v3dGrain(col: Col, dir: number): Col { return col.length > 4 ? col.slice(0, 4).concat(dir) : col; }
// контурные рёбра: темнее цвета детали (у почти чёрных — светлее)
function v3dEdgeCol(col: Col): Col {
  const lum = 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2];
  if(lum < 0.16) return [lum + 0.2, lum + 0.2, lum + 0.21, 1];
  return col.slice(0, 3).map(v => v * (lum < 0.35 ? 0.6 : 0.55)).concat(1);
}
function v3dLine(m: Mesh, a: V3, b: V3, col: Col): void {
  m.l.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  m.lc.push(col[0], col[1], col[2], col[3], col[0], col[1], col[2], col[3]);
}
function v3dTri(m: Mesh, a: V3, b: V3, c: V3, col: Col): void {
  const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2], vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
  let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  [a, b, c].forEach(v => { m.p.push(v[0], v[1], v[2]); m.n.push(nx, ny, nz); m.c.push(col[0], col[1], col[2], col[3]); m.g.push(col[4] || 0); });
}
function v3dQuad(m: Mesh, a: V3, b: V3, c: V3, d: V3, col: Col): void { v3dTri(m, a, b, c, col); v3dTri(m, a, c, d, col); }
// мир: x вправо, y вверх (у чертежа y вниз), z к зрителю
function v3dW(H: number, x: number, y: number, z: number): V3 { return [x, H - y, z]; }

// рамка с миттером по прямоугольнику r
function v3dBand(m: Mesh, H: number, r: Rect, sec: Sec, col: Col): void {
  const ec = v3dEdgeCol(col);
  const sides: { L: number; pt: (s: number, u: number) => [number, number] }[] = [
    { L:r.w, pt:(s, u) => [r.x + s, r.y + u] },
    { L:r.w, pt:(s, u) => [r.x + s, r.y + r.h - u] },
    { L:r.h, pt:(s, u) => [r.x + u, r.y + s] },
    { L:r.h, pt:(s, u) => [r.x + r.w - u, r.y + s] }
  ];
  sides.forEach((sd, si) => {
    const sc = v3dGrain(col, si < 2 ? 1 : 2);
    for(let i = 0; i < sec.length; i++){
      const [u1, z1] = sec[i], [u2, z2] = sec[(i + 1) % sec.length];
      const a0 = sd.pt(u1, u1), a1 = sd.pt(sd.L - u1, u1), b0 = sd.pt(u2, u2), b1 = sd.pt(sd.L - u2, u2);
      v3dQuad(m, v3dW(H, a0[0], a0[1], z1), v3dW(H, a1[0], a1[1], z1), v3dW(H, b1[0], b1[1], z2), v3dW(H, b0[0], b0[1], z2), sc);
      v3dLine(m, v3dW(H, a0[0], a0[1], z1), v3dW(H, a1[0], a1[1], z1), ec);
      v3dLine(m, v3dW(H, a0[0], a0[1], z1), v3dW(H, b0[0], b0[1], z2), ec);
    }
  });
}
// прямой брусок по длинной стороне r, торцы закрыты
function v3dBar(m: Mesh, H: number, r: Rect, sec: Sec, col: Col): void {
  const ec = v3dEdgeCol(col);
  const vert = r.h >= r.w, t = vert ? r.w : r.h, L = vert ? r.h : r.w;
  col = v3dGrain(col, vert ? 2 : 1);
  const pt = (s: number, u: number): [number, number] => vert ? [r.x + u * r.w / t, r.y + s] : [r.x + s, r.y + u * r.h / t];
  for(let i = 0; i < sec.length; i++){
    const [u1, z1] = sec[i], [u2, z2] = sec[(i + 1) % sec.length];
    const a0 = pt(0, u1), a1 = pt(L, u1), b0 = pt(0, u2), b1 = pt(L, u2);
    v3dQuad(m, v3dW(H, a0[0], a0[1], z1), v3dW(H, a1[0], a1[1], z1), v3dW(H, b1[0], b1[1], z2), v3dW(H, b0[0], b0[1], z2), col);
    v3dLine(m, v3dW(H, a0[0], a0[1], z1), v3dW(H, a1[0], a1[1], z1), ec);
    v3dLine(m, v3dW(H, a0[0], a0[1], z1), v3dW(H, b0[0], b0[1], z2), ec);
    v3dLine(m, v3dW(H, a1[0], a1[1], z1), v3dW(H, b1[0], b1[1], z2), ec);
  }
  [0, L].forEach(s => {
    const p0 = pt(s, sec[0][0]);
    for(let i = 1; i < sec.length - 1; i++){
      const p1 = pt(s, sec[i][0]), p2 = pt(s, sec[i + 1][0]);
      v3dTri(m, v3dW(H, p0[0], p0[1], sec[0][1]), v3dW(H, p1[0], p1[1], sec[i][1]), v3dW(H, p2[0], p2[1], sec[i + 1][1]), col);
    }
  });
}
function v3dBox(m: Mesh, H: number, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, col: Col): void {
  const P = (x: number, y: number, z: number) => v3dW(H, x, y, z);
  v3dQuad(m, P(x0,y0,z1), P(x1,y0,z1), P(x1,y1,z1), P(x0,y1,z1), col);
  v3dQuad(m, P(x0,y0,z0), P(x0,y1,z0), P(x1,y1,z0), P(x1,y0,z0), col);
  v3dQuad(m, P(x0,y0,z0), P(x1,y0,z0), P(x1,y0,z1), P(x0,y0,z1), col);
  v3dQuad(m, P(x0,y1,z0), P(x0,y1,z1), P(x1,y1,z1), P(x1,y1,z0), col);
  v3dQuad(m, P(x0,y0,z0), P(x0,y0,z1), P(x0,y1,z1), P(x0,y1,z0), col);
  v3dQuad(m, P(x1,y0,z0), P(x1,y1,z0), P(x1,y1,z1), P(x1,y0,z1), col);
  const ec = v3dEdgeCol(col);
  const pts: [number, number][] = [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
  pts.forEach(([x, y], i, a) => {
    const [nx, ny] = a[(i + 1) % 4];
    v3dLine(m, P(x,y,z1), P(nx,ny,z1), ec); v3dLine(m, P(x,y,z0), P(nx,ny,z0), ec); v3dLine(m, P(x,y,z0), P(x,y,z1), ec);
  });
}
function v3dCyl(m: Mesh, H: number, cx: number, cy: number, cz: number, rad: number, len: number, vertical: boolean, col: Col): void {
  const N = 12;
  for(let i = 0; i < N; i++){
    const a1 = i / N * Math.PI * 2, a2 = (i + 1) / N * Math.PI * 2;
    const o1: [number, number] = [Math.cos(a1) * rad, Math.sin(a1) * rad], o2: [number, number] = [Math.cos(a2) * rad, Math.sin(a2) * rad];
    const P = (o: [number, number], s: number) => vertical ? v3dW(H, cx + o[0], cy + s, cz + o[1]) : v3dW(H, cx + s, cy + o[0], cz + o[1]);
    v3dQuad(m, P(o1, -len/2), P(o2, -len/2), P(o2, len/2), P(o1, len/2), col);
    v3dTri(m, P([0,0], -len/2), P(o2, -len/2), P(o1, -len/2), col);
    v3dTri(m, P([0,0], len/2), P(o1, len/2), P(o2, len/2), col);
  }
}

// сечения, мм (z: 0 — улица, D — лицо рамы со стороны комнаты)
const v3dSecFrame = (t: number, D: number): Sec => [[0,0],[t,0],[t,D-5],[t-3,D],[3,D],[0,D-3]];
const v3dSecMullion = (t: number, z0: number, z1: number): Sec => [[0,z0],[t,z0],[t,z1-5],[t-3,z1],[3,z1],[0,z1-5]];
const v3dSecSash = (t: number, z0: number, z1: number): Sec => [[0,z0],[t,z0],[t,z1-6],[t-4,z1],[4,z1],[0,z1-4]];
const v3dSecBead = (b: number, zf: number): Sec => [[0,zf-16],[b,zf-16],[b,zf-11],[3,zf],[0,zf]];

function v3dBuild(e: WinElement, project: Project | undefined): Model {
  const out = computeLayout(e, profileFor(project));
  const prof = out.profile, W = out.W, H = out.H;
  const D = V3D_DEPTH[prof.mat] || 70;
  const hex = elementColorHex(e, project) || '#ffffff';
  const col: Col = v3dRgb(hex).concat(V3D_WOOD.has(e.color || '') ? [1, 1] : [1]);
  const hw: Col = v3dRgb(tintHex('#d9d9d9', hex)).concat(1);
  const g = findGlass(e.glass), gc = v3dRgb(g.matte ? '#eef2f4' : g.tint);
  const gA = g.matte ? 0.82 : Math.max(0.16, Math.min(0.5, glassAlpha(g) * 0.9));
  const glassCol: Col = gc.concat(gA);
  const groups: Group[] = [];
  const base: Group = { mesh:v3dMesh(), glass:v3dMesh(), kind:'static' };
  groups.push(base);
  v3d.hasTurn = v3d.hasTilt = v3d.hasSlide = false;

  v3dBand(base.mesh!, H, { x:0, y:0, w:W, h:H }, v3dSecFrame(out.frameT, D), col);
  out.mullions.forEach(mu => { if(mu.w > 0.5 && mu.h > 0.5) v3dBar(base.mesh!, H, mu, v3dSecMullion(Math.min(mu.w, mu.h), 0, D), col); });

  // ячейка: штапик + стеклопакет (два листа) или панель; zf — лицо штапика
  const cellFill = (grp: Group, node: TreeNode, cell: Rect, zf: number) => {
    const b = prof.bead;
    v3dBand(grp.mesh!, H, cell, v3dSecBead(b, zf), col);
    const gi = insetRect(cell, b - 4);
    if(node.fill === 'panelV' || node.fill === 'panelH'){
      const p = insetRect(cell, b), vert = node.fill === 'panelV', slat = prof.panelSlat || 100;
      const dim = vert ? p.w : p.h, n = Math.max(1, Math.ceil((dim - 0.5) / slat));
      const pc = col.map((v, i) => i < 3 ? v * 0.97 : v);
      for(let i = 0; i < n; i++){
        const a = i * slat, w = Math.min(slat, dim - a);
        const r = vert ? { x:p.x + a, y:p.y, w, h:p.h } : { x:p.x, y:p.y + a, w:p.w, h:w };
        const sec: Sec = [[0,zf-30],[w,zf-30],[w,zf-20],[w-3,zf-16],[3,zf-16],[0,zf-20]];
        v3dBar(grp.mesh!, H, r, sec, pc);
      }
      return;
    }
    [zf - 18, zf - 40].forEach(z => {
      const P = (x: number, y: number) => v3dW(H, x, y, z);
      v3dQuad(grp.glass!, P(gi.x, gi.y), P(gi.x + gi.w, gi.y), P(gi.x + gi.w, gi.y + gi.h), P(gi.x, gi.y + gi.h), glassCol);
    });
    // дистанционная рамка стеклопакета
    v3dBand(grp.mesh!, H, gi, [[0, zf-38],[7, zf-38],[7, zf-20],[0, zf-20]], [0.55, 0.57, 0.6, 1]);
  };

  out.leaves.forEach(l => {
    const n = l.node, r = l.rect, op = n.opening;
    if(!op || (op.type === 'FixSliding' && !out.slidingMat)){ cellFill(base, n, r, D - 2); return; }
    if(out.slidingMat){
      const moving = op.type === 'Sliding';
      const z0 = moving ? D * 0.5 + 2 : 6, z1 = moving ? D - 2 : D * 0.5 - 2;
      const grp: Group = moving ? { mesh:v3dMesh(), glass:v3dMesh(), kind:'slide', slide:(op.hinge === 'left' ? 1 : -1) * r.w * 0.55 } : base;
      const t = sashProfile(prof, op);
      v3dBand(grp.mesh!, H, r, v3dSecSash(t, z0, z1), col);
      cellFill(grp, n, insetRect(r, t), z1 - 2);
      if(moving){
        const hx = op.hinge === 'left' ? r.x + t * 0.5 : r.x + r.w - t * 0.5;
        v3dBox(grp.mesh!, H, hx - 6, r.y + r.h * 0.45, hx + 6, r.y + r.h * 0.55, z1, z1 + 10, hw);
        groups.push(grp); v3d.hasSlide = true;
      }
      return;
    }
    // створная: полоса створки выступает перед рамой на 10 мм
    const t = sashBand(prof, op), z0 = D - 26, z1 = D + 10;
    const kind: GroupKind = op.type === 'Tilt' ? 'tilt' : (op.type === 'TiltTurn' ? 'tiltturn' : 'turn');
    const edge: Edge = op.type === 'Tilt' ? 'bottom' : (op.hinge as Edge);
    const piv: V3 = edge === 'left' ? [r.x, 0, z1] : edge === 'right' ? [r.x + r.w, 0, z1] : edge === 'top' ? [0, H - r.y, z1] : [0, H - (r.y + r.h), z1];
    const grp: Group = { mesh:v3dMesh(), glass:v3dMesh(), kind, edge, pivot:piv, tiltPivot:[0, H - (r.y + r.h), z1] };
    v3dBand(grp.mesh!, H, r, v3dSecSash(t, z0, z1), col);
    if(l.inner){
      l.inner.mullions.forEach(mu => { if(mu.w > 0.5 && mu.h > 0.5) v3dBar(grp.mesh!, H, mu, v3dSecMullion(Math.min(mu.w, mu.h), z0, z1 - 2), col); });
      l.inner.leaves.forEach(il => cellFill(grp, il.node, il.rect, z1 - 2));
    }else cellFill(grp, n, insetRect(r, t), z1 - 2);

    // ручка: основание + рычаг (дверь — накладка + горизонтальный рычаг)
    const [hx, hy] = handleAnchor(r, edge, t / 2);
    const opp = OPPOSITE_EDGE[edge];
    const vertEdge = opp === 'left' || opp === 'right';
    const m = grp.mesh!;
    if(op.type === 'Door'){
      v3dBox(m, H, hx - 16, hy - 120, hx + 16, hy + 110, z1, z1 + 8, hw);
      const dir = opp === 'left' ? 1 : -1;
      v3dBox(m, H, Math.min(hx, hx + dir * 140), hy - 60, Math.max(hx, hx + dir * 140), hy - 44, z1 + 30, z1 + 44, hw);
      v3dBox(m, H, hx - 8, hy - 60, hx + 8, hy - 44, z1 + 8, z1 + 30, hw);
    }else if(vertEdge){
      v3dBox(m, H, hx - 16, hy - 40, hx + 16, hy + 40, z1, z1 + 10, hw);
      v3dBox(m, H, hx - 9, hy - 10, hx + 9, hy + 130, z1 + 14, z1 + 28, hw);
      v3dBox(m, H, hx - 7, hy - 10, hx + 7, hy + 4, z1 + 10, z1 + 16, hw);
    }else{
      v3dBox(m, H, hx - 40, hy - 16, hx + 40, hy + 16, z1, z1 + 10, hw);
      v3dBox(m, H, hx - 10, hy - 9, hx + 130, hy + 9, z1 + 14, z1 + 28, hw);
    }
    groups.push(grp);
    if(kind === 'tilt') v3d.hasTilt = true; else v3d.hasTurn = true;
    if(kind === 'tiltturn') v3d.hasTilt = true;

    // петли — на раме (не поворачиваются)
    const ts = op.type === 'Door' ? [HINGE_T[0], 0.5, HINGE_T[1]] : HINGE_T;
    const len = op.type === 'Door' ? 110 : 60;
    ts.forEach(tt => {
      const [px, py] = edgePoint(r, edge, tt);
      v3dCyl(base.mesh!, H, px, py, z1 + 2, 7, len, edge === 'left' || edge === 'right', hw);
    });
  });

  // подоконник: плита под рамой, выступает в комнату
  if(out.hasSill){
    const ov = 50, dep = Math.max(120, Math.min(400, (parseFloat(String(e.sillWidth)) || 20) * 10));
    v3dBox(base.mesh!, H, -ov, H, W + ov, H + 22, -10, D + dep, col);
  }
  return { groups, W, H, D };
}
function v3dBuildSill(e: WinElement, project: Project | undefined): Model {
  const W = parseMm(e.width) || DEFAULT_W, dep = parseMm(e.height) || DEFAULT_SILL_DEPTH;
  const col: Col = v3dRgb(elementColorHex(e, project) || '#ffffff').concat(V3D_WOOD.has(e.color || '') ? [1, 1] : [1]);
  const base: Group = { mesh:v3dMesh(), glass:v3dMesh(), kind:'static' };
  v3dBox(base.mesh!, 22, 0, 0, W, 22, 0, dep, col);
  return { groups:[base], W, H:22, D:dep };
}

// ---- матрицы 4×4 (column-major, как в WebGL) ----
type M = number[];
const M4 = {
  id(): M { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; },
  mul(a: M, b: M): M { const o = new Array<number>(16); for(let c = 0; c < 4; c++) for(let r = 0; r < 4; r++){ let s = 0; for(let k = 0; k < 4; k++) s += a[k*4+r] * b[c*4+k]; o[c*4+r] = s; } return o; },
  tr(x: number, y: number, z: number): M { const m = M4.id(); m[12] = x; m[13] = y; m[14] = z; return m; },
  sc(s: number): M { const m = M4.id(); m[0] = m[5] = m[10] = s; return m; },
  rx(a: number): M { const c = Math.cos(a), s = Math.sin(a); return [1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]; },
  ry(a: number): M { const c = Math.cos(a), s = Math.sin(a); return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]; },
  persp(fov: number, asp: number, n: number, f: number): M { const t = 1 / Math.tan(fov / 2); return [t/asp,0,0,0, 0,t,0,0, 0,0,(f+n)/(n-f),-1, 0,0,2*f*n/(n-f),0]; },
  about(p: V3, R: M): M { return M4.mul(M4.tr(p[0], p[1], p[2]), M4.mul(R, M4.tr(-p[0], -p[1], -p[2]))); }
};

const V3D_VS = `attribute vec3 aPos; attribute vec3 aNor; attribute vec4 aCol; attribute float aGrain;
uniform mat4 uMVP; uniform mat4 uModel;
varying vec3 vN; varying vec4 vC; varying vec3 vP; varying vec3 vL; varying float vG;
void main(){ vec4 wp = uModel * vec4(aPos, 1.0); vP = wp.xyz; vN = (uModel * vec4(aNor, 0.0)).xyz; vC = aCol; vL = aPos; vG = aGrain; gl_Position = uMVP * vec4(aPos, 1.0); }`;
// свет как в Window3DRenderer romchi: sRGB→linear, ambient, |N·L|, Blinn-Phong, linear→sRGB; дерево — шумом
const V3D_FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec3 uLight; uniform vec3 uCam; uniform float uGlass; uniform float uFlat;
varying vec3 vN; varying vec4 vC; varying vec3 vP; varying vec3 vL; varying float vG;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float wood(vec2 q){
  float warp = noise(vec2(q.x * 0.0035, q.y * 0.03)) * 2.2 + noise(vec2(q.x * 0.012, q.y * 0.1)) * 0.6;
  float r = fract(q.y * 0.07 + warp);
  float ring = smoothstep(0.0, 0.18, r) * (1.0 - smoothstep(0.55, 1.0, r));
  float fibre = noise(vec2(q.x * 0.05, q.y * 1.6));
  return ring * 0.65 + fibre * 0.35;
}
void main(){
  if(uFlat > 0.5){ gl_FragColor = vC; return; }
  vec3 n = normalize(vN); vec3 l = normalize(uLight - vP); vec3 v = normalize(uCam - vP);
  float diff = abs(dot(n, l));
  float spec = pow(max(abs(dot(n, normalize(l + v))), 0.0), 24.0);
  vec3 base = pow(vC.rgb, vec3(2.2));
  if(vG > 0.5){
    vec2 q = vG < 1.5 ? vec2(vL.x, vL.y + vL.z * 0.7) : vec2(vL.y, vL.x + vL.z * 0.7);
    base *= 0.72 + 0.5 * wood(q);
  }
  vec3 c = base * (0.5 + 0.6 * diff) + vec3(spec * (0.10 + 0.35 * uGlass));
  gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), vC.a + spec * 0.25 * uGlass);
}`;

function v3dInitGl(canvas: HTMLCanvasElement): WebGLRenderingContext | null {
  const gl = canvas.getContext('webgl', { antialias:true, alpha:true, premultipliedAlpha:false, preserveDrawingBuffer:true });
  if(!gl) return null;
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, V3D_VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, V3D_FS)); gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
  v3d.prog = p;
  v3d.loc = { aPos:gl.getAttribLocation(p, 'aPos'), aNor:gl.getAttribLocation(p, 'aNor'), aCol:gl.getAttribLocation(p, 'aCol'), aGrain:gl.getAttribLocation(p, 'aGrain'),
              uMVP:gl.getUniformLocation(p, 'uMVP'), uModel:gl.getUniformLocation(p, 'uModel'), uLight:gl.getUniformLocation(p, 'uLight'),
              uCam:gl.getUniformLocation(p, 'uCam'), uGlass:gl.getUniformLocation(p, 'uGlass'), uFlat:gl.getUniformLocation(p, 'uFlat') };
  return gl;
}
function v3dUpload(gl: WebGLRenderingContext, mesh: { p: number[]; n: number[]; c: number[]; g?: number[] }): Buf | null {
  if(!mesh.p.length) return null;
  const mk = (arr: number[]) => { const b = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW); return b; };
  return { p:mk(mesh.p), n:mk(mesh.n), c:mk(mesh.c), g:mk(mesh.g && mesh.g.length ? mesh.g : new Array<number>(mesh.p.length / 3).fill(0)), count:mesh.p.length / 3 };
}
function v3dFree(): void {
  const gl = v3d.gl;
  if(!gl) return;
  v3d.groups.forEach(g => [g.buf, g.gbuf, g.lbuf].forEach(b => { if(b){ gl.deleteBuffer(b.p); gl.deleteBuffer(b.n); gl.deleteBuffer(b.c); gl.deleteBuffer(b.g); } }));
  v3d.groups = [];
}
// матрица группы: поворот створки вокруг линии петель / сдвиг раздвижной
function v3dGroupMatrix(g: Group): M {
  const ease = (x: number) => x < 0.5 ? 2*x*x : 1 - Math.pow(-2*x + 2, 2) / 2;
  const o = ease(v3d.open), t = ease(v3d.tilt);
  if(g.kind === 'slide') return M4.tr((g.slide || 0) * o, 0, 0);
  const turnA = 70 * Math.PI / 180 * o, tiltA = 11 * Math.PI / 180 * t;
  const turn = (): M => {
    if(g.edge === 'left')  return M4.about(g.pivot!, M4.ry(-turnA));
    if(g.edge === 'right') return M4.about(g.pivot!, M4.ry(turnA));
    if(g.edge === 'top')   return M4.about(g.pivot!, M4.rx(-turnA));
    return M4.about(g.pivot!, M4.rx(turnA));
  };
  if(g.kind === 'turn') return turn();
  if(g.kind === 'tilt') return M4.about(g.pivot!, M4.rx(Math.max(turnA * 11 / 70, tiltA)));
  if(g.kind === 'tiltturn') return t > 0.001 && o < 0.001 ? M4.about(g.tiltPivot!, M4.rx(tiltA)) : turn();
  return M4.id();
}
function v3dDraw(): void {
  const gl = v3d.gl, cv = document.getElementById('v3dCanvas') as HTMLCanvasElement | null;
  const L = v3d.loc;
  if(!gl || !cv || !L) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
  if(cv.width !== w || cv.height !== h){ cv.width = w; cv.height = h; }
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.useProgram(v3d.prog);
  const asp = w / h, fov = 34 * Math.PI / 180;
  const fit = 1.08 / Math.tan(fov / 2) * Math.max(1, 1 / asp);
  const camZ = fit / v3d.zoom;
  const proj = M4.persp(fov, asp, 0.05, 50);
  const view = M4.tr(0, 0, -camZ);
  const world = M4.mul(M4.rx(v3d.rotX * Math.PI / 180), M4.mul(M4.ry(v3d.rotY * Math.PI / 180),
                M4.mul(M4.sc(2 / v3d.size), M4.tr(-v3d.center[0], -v3d.center[1], -v3d.center[2]))));
  gl.uniform3f(L.uLight, 1.6, 2.4, camZ + 1.5);
  gl.uniform3f(L.uCam, 0, 0, camZ);
  const bind = (b: Buf) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, b.p); gl.enableVertexAttribArray(L.aPos); gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.n); gl.enableVertexAttribArray(L.aNor); gl.vertexAttribPointer(L.aNor, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.c); gl.enableVertexAttribArray(L.aCol); gl.vertexAttribPointer(L.aCol, 4, gl.FLOAT, false, 0, 0);
    if(L.aGrain >= 0){ gl.bindBuffer(gl.ARRAY_BUFFER, b.g); gl.enableVertexAttribArray(L.aGrain); gl.vertexAttribPointer(L.aGrain, 1, gl.FLOAT, false, 0, 0); }
  };
  const pass = (glass: boolean, lines?: boolean) => {
    v3d.groups.forEach(g => {
      const b = lines ? g.lbuf : glass ? g.gbuf : g.buf;
      if(!b) return;
      const model = M4.mul(world, v3dGroupMatrix(g));
      gl.uniformMatrix4fv(L.uModel, false, new Float32Array(model));
      gl.uniformMatrix4fv(L.uMVP, false, new Float32Array(M4.mul(proj, M4.mul(view, model))));
      gl.uniform1f(L.uGlass, glass ? 1 : 0);
      gl.uniform1f(L.uFlat, lines ? 1 : 0);
      bind(b); gl.drawArrays(lines ? gl.LINES : gl.TRIANGLES, 0, b.count);
    });
  };
  gl.disable(gl.BLEND); gl.depthMask(true);
  gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);   // грани чуть дальше — контуры не мерцают
  pass(false);
  gl.disable(gl.POLYGON_OFFSET_FILL);
  pass(false, true);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
  pass(true);
  gl.depthMask(true);
}
function v3dTick(): void {
  v3d.raf = 0;
  const step = 0.06;
  let moving = false;
  (['open', 'tilt'] as const).forEach(k => {
    const d = v3d.target[k] - v3d[k];
    if(Math.abs(d) > 0.001){ v3d[k] += Math.sign(d) * Math.min(Math.abs(d), step); moving = true; }
    else v3d[k] = v3d.target[k];
  });
  v3dDraw();
  if(moving) v3dRequest();
}
function v3dRequest(): void { if(!v3d.raf) v3d.raf = requestAnimationFrame(v3dTick); }

export function open3DView(): void {
  const e = currentElement(), project = getCurrentProject();
  if(!e) return;
  const scr = $('view3dScreen');
  $('v3dTitle').textContent = '3D · ' + e.width + ' × ' + e.height;
  scr.classList.add('open');
  const cv = $('v3dCanvas') as HTMLCanvasElement;
  if(!v3d.gl){ v3d.gl = v3dInitGl(cv); v3dBindInput(cv); }
  const gl = v3d.gl;
  if(!gl){ showToast('3D не поддерживается на этом устройстве'); scr.classList.remove('open'); return; }
  v3dFree();
  const model = e.type === 'sill' ? v3dBuildSill(e, project) : v3dBuild(e, project);
  if(e.type === 'sill') v3d.hasTurn = v3d.hasTilt = v3d.hasSlide = false;
  v3d.size = Math.max(model.W, model.H) * 1.12;
  v3d.center = [model.W / 2, model.H / 2, model.D / 2];
  v3d.groups = model.groups.map(g => {
    const mesh = g.mesh!, glass = g.glass!;
    return Object.assign(g, { buf:v3dUpload(gl, mesh), gbuf:v3dUpload(gl, glass),
      lbuf:v3dUpload(gl, { p:mesh.l, n:mesh.l.map(() => 0), c:mesh.lc }), mesh:null, glass:null });
  });
  v3d.open = v3d.tilt = v3d.target.open = v3d.target.tilt = 0;
  v3dResetView(true);
  v3dUpdateButtons();
  requestAnimationFrame(() => v3dDraw());
}
export function close3DView(): void {
  $('view3dScreen').classList.remove('open');
  v3dFree();
}
export function v3dResetView(silent?: boolean): void {
  v3d.rotX = 10; v3d.rotY = -24; v3d.zoom = 1;
  if(!silent) v3dRequest();
}
export function v3dToggle(kind: 'open' | 'tilt'): void {
  if(kind === 'open'){ v3d.target.open = v3d.target.open > 0.5 ? 0 : 1; v3d.target.tilt = 0; }
  else { v3d.target.tilt = v3d.target.tilt > 0.5 ? 0 : 1; v3d.target.open = 0; }
  v3dUpdateButtons(); v3dRequest();
}
function v3dUpdateButtons(): void {
  const bo = $('v3dOpenBtn'), bt = $('v3dTiltBtn');
  bo.style.display = (v3d.hasTurn || v3d.hasSlide || (v3d.hasTilt && !v3d.hasTurn)) ? '' : 'none';
  bo.textContent = v3d.target.open > 0.5 ? 'Закрыть' : 'Открыть';
  bt.style.display = (v3d.hasTilt && v3d.hasTurn) ? '' : 'none';
  bt.textContent = v3d.target.tilt > 0.5 ? 'Закрыть' : 'Проветривание';
}
// один палец — вращение, два — масштаб; колесо — масштаб; двойной тап — исходный вид
function v3dBindInput(cv: HTMLCanvasElement): void {
  let last: [number, number] | null = null, lastTap = 0;
  cv.addEventListener('pointerdown', ev => {
    cv.setPointerCapture(ev.pointerId);
    v3d.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if(v3d.pointers.size === 2){ const [a, b] = [...v3d.pointers.values()]; v3d.pinch0 = Math.hypot(a[0]-b[0], a[1]-b[1]); v3d.zoom0 = v3d.zoom; }
    last = [ev.clientX, ev.clientY];
    const now = Date.now(); if(now - lastTap < 300 && v3d.pointers.size === 1) v3dResetView(); lastTap = now;
  });
  cv.addEventListener('pointermove', ev => {
    if(!v3d.pointers.has(ev.pointerId)) return;
    v3d.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if(v3d.pointers.size >= 2){
      const [a, b] = [...v3d.pointers.values()];
      const d = Math.hypot(a[0]-b[0], a[1]-b[1]);
      if(v3d.pinch0 > 0) v3d.zoom = Math.max(0.5, Math.min(4, v3d.zoom0 * d / v3d.pinch0));
    }else if(last){
      v3d.rotY += (ev.clientX - last[0]) * 0.45;
      v3d.rotX = Math.max(-85, Math.min(85, v3d.rotX + (ev.clientY - last[1]) * 0.45));
      last = [ev.clientX, ev.clientY];
    }
    v3dRequest();
  });
  const up = (ev: PointerEvent) => {
    v3d.pointers.delete(ev.pointerId);
    if(v3d.pointers.size < 2) v3d.pinch0 = 0;
    const r = [...v3d.pointers.values()][0];
    last = r ? [r[0], r[1]] : null;
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', ev => { ev.preventDefault(); v3d.zoom = Math.max(0.5, Math.min(4, v3d.zoom * Math.exp(-ev.deltaY * 0.0015))); v3dRequest(); }, { passive:false });
  window.addEventListener('resize', () => { if($('view3dScreen').classList.contains('open')) v3dRequest(); });
}
