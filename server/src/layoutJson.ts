// ?format=json: те же расчёты, что и для чертежа, но координатами (мм, начало — левый верхний угол рамы).
import type { Fill, Opening, Project, Rect } from '../../app/src/types.ts';
import { profileFor } from '../../app/src/data/profiles.ts';
import { computeLayout } from '../../app/src/model/layout.ts';

export interface RectJson { x: number; y: number; w: number; h: number; }
export interface LeafJson extends RectJson { fill: Fill; opening: Opening | null; }
export interface ElementJson {
  index: number; type: string; width: number; height: number; qty: number;
  frame: number;            // толщина рамы, мм
  leaves: LeafJson[];       // проёмы (стекло, панель, створка) в раме
  mullions: RectJson[];     // импосты
}
export interface LayoutJson { name: string; elements: ElementJson[]; }

const r1 = (v: number) => Math.round(v * 10) / 10;
const rect = (r: Rect): RectJson => ({ x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h) });

export function projectLayoutJson(project: Project): LayoutJson {
  const profile = profileFor(project);
  return {
    name: project.name,
    elements: project.elements.map((e, i) => {
      if(e.type === 'sill'){                               // отдельный подоконник: полка, без рамы и стекла
        return { index: i + 1, type: e.type, width: Number(e.width), height: Number(e.height), qty: Number(e.qty) || 1,
                 frame: 0, leaves: [], mullions: [] };
      }
      const out = computeLayout(e, profile);
      return {
        index: i + 1, type: e.type, width: out.W, height: out.H, qty: Number(e.qty) || 1,
        frame: out.frameT,
        leaves: out.leaves.map(l => ({ ...rect(l.cell || l.rect), fill: l.node.fill || 'glass', opening: l.node.opening || null })),
        mullions: out.allMullions.map(rect)
      };
    })
  };
}
