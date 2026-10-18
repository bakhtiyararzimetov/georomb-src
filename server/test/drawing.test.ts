// Чертёж GeoRomb из app/src должен собираться в Node — без браузера, canvas и localStorage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Project, WinElement } from '../../app/src/types.ts';
import { layoutForDrawing } from '../../app/src/model/layout.ts';
import { isElementValid } from '../../app/src/model/history.ts';
import { drawingSvg, leafDesc } from '../../app/src/render/drawingSvg.ts';

function twoPartWindow(): WinElement {
  return {
    id: 1, type: 'casement', width: 1500, height: 1200, qty: 1, color: null, history: [], redo: [],
    root: { nid: 1, kind: 'branch', dir: 'v', sizes: null, children: [
      { nid: 2, kind: 'leaf', fill: 'glass', opening: { type: 'Turn', hinge: 'left' } },
      { nid: 3, kind: 'leaf', fill: 'glass', opening: null }
    ] }
  };
}

test('drawingSvg рисует окно в Node с заданным размером картинки', () => {
  const out = layoutForDrawing(twoPartWindow(), null);
  const d = drawingSvg(out, 600, 480, 2);
  assert.match(d.svg, /^<svg/);
  assert.ok(d.svg.includes(`width="${d.w}" height="${d.h}"`));
  assert.ok(d.w > 600 && d.padX > 0, 'подоконный отступ расширяет картинку');
  assert.ok(!d.svg.includes('onclick'), 'обработчики редактора вырезаны');
});

test('leafDesc подписывает створки как в PDF приложения', () => {
  assert.equal(leafDesc({ nid: 1, kind: 'leaf', opening: { type: 'Turn', hinge: 'left' } }), 'поворотная, петли слева');
  assert.equal(leafDesc({ nid: 1, kind: 'leaf', fill: 'glass', opening: null }), 'глухое стекло');
});

test('isElementValid принимает проект явно (профиль алюминия, а не текущего проекта)', () => {
  const alu: Project = { id: 1, name: 'A', date: '', type: 'alu', elements: [] };
  assert.equal(isElementValid(twoPartWindow(), alu), true);
  const bad = twoPartWindow();
  bad.root!.sizes = [0, 1500];
  assert.equal(isElementValid(bad, alu), false);
});
