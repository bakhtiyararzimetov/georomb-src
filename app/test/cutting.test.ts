// Экран «Раскрой»: группы деталей и остатки склада между группами.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installStorage } from './helpers.ts';
installStorage(); installDom();
const { S } = await import('../src/state.ts');
const { clonePriceDefaults } = await import('../src/model/pricing.ts');
const { extractCuttingGroups, loadCuttingSettings } = await import('../src/features/cutting.ts');
const { cutOptimize } = await import('../src/model/cutOptimizer.ts');
import type { Project, WinElement } from '../src/types.ts';

S.prices = clonePriceDefaults();
S.cutting = loadCuttingSettings();
const el = (id: number, color: string | null, o: Partial<WinElement> = {}): WinElement =>
  ({ id, type: 'casement', width: 1500, height: 1200, qty: 1, color, history: [], redo: [], ...o });

test('группы: qty умножает детали, подоконник-элемент — длина = ширина', () => {
  const p: Project = { id: 1, name: '', date: '', type: 'pvc', elements: [el(1, 'ral9016', { qty: 2 }), el(2, null, { type: 'sill', width: 1700, height: 250 })] };
  const g = extractCuttingGroups(p);
  const frame = g.find(x => x.role === 'frame' && x.colorCode === 'ral9016')!;
  assert.equal(frame.totalCount, 8);
  assert.deepEqual(frame.pieces, [{ lengthMm: 1506, count: 4 }, { lengthMm: 1206, count: 4 }]);
  const sill = g.find(x => x.role === 'sill')!;
  assert.deepEqual(sill.pieces, [{ lengthMm: 1700, count: 1 }]);
});

test('один остаток склада не предлагается двум группам раскроя', () => {
  // цвет из другого материала (например, из импортированного бэкапа: cleanElement не сверяет код с материалом)
  const p: Project = { id: 1, name: '', date: '', type: 'pvc', elements: [el(1, null), el(2, 'ral9016a')] };
  const frames = extractCuttingGroups(p).filter(g => g.role === 'frame');
  assert.equal(frames.length, 1, 'неизвестный код цвета — та же группа «Без цвета»');
  // так cutScrapsFor выбирает остатки: role === grp.role && norm(color) === norm(grp.colorName)
  const remnant = { id: 9, material: 'pvc', role: 'frame', color: 'Без цвета', lengthMm: 1600, qty: 1 };
  const offered = frames.filter(g => remnant.role === g.role && remnant.color.toLowerCase() === g.colorName.toLowerCase());
  const used = offered.map(g => {
    const flat = g.pieces.flatMap(pc => Array(pc.count).fill(pc.lengthMm) as number[]);
    return cutOptimize(flat, 6000, { k: 5, minScrap: 140, trimMax: 80 }, [{ id: 9, uid: '9.0', len: 1600 }], 0)
      .variants[0].plans.some(pl => pl.scrap && pl.scrap.uid === '9.0');
  }).filter(Boolean).length;
  assert.ok(used <= 1, 'единственный остаток 1600 мм запланирован в ' + used + ' группах');
});
