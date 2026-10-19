// История отмены и правка элемента через форму.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installStorage } from './helpers.ts';
installStorage();
const dom = installDom(
  { editElemWidth: '150', editElemHeight: '1200', editElemQty: '1' },
  { editElemType: 'casement', editElemSill: 'no', editElemNet: 'no' });
const { S } = await import('../src/state.ts');
const { clonePriceDefaults } = await import('../src/model/pricing.ts');
const { beginChange, finishChange, isElementValid } = await import('../src/model/history.ts');
const { splitNode, ensureRoot } = await import('../src/model/tree.ts');
const { loadCuttingSettings } = await import('../src/features/cutting.ts');
const { saveEditElement } = await import('../src/features/elementForm.ts');
const { undoElement, redoElement } = await import('../src/features/elementView.ts');
import type { Project, WinElement } from '../src/types.ts';

let e: WinElement, p: Project;
beforeEach(() => {
  S.prices = clonePriceDefaults();
  S.cutting = loadCuttingSettings();
  e = { id: 1, type: 'casement', width: 1500, height: 1200, qty: 1, color: null, history: [], redo: [] };
  p = { id: 1, name: 'T', date: '', type: 'pvc', elements: [e] };
  S.projects = [p];
  S.currentProjectId = 1;
  S.currentElementIndex = 0;
});

function splitAsTool(): void {
  const tok = beginChange(e);
  splitNode(ensureRoot(e), 'v', 3);
  e.root!.children!.forEach(c => { c.opening = { type: 'Turn', hinge: 'left' }; });
  assert.equal(finishChange(e, tok), true);
}

test('отмена/возврат: снимок до деления и обратно', () => {
  splitAsTool();
  assert.equal(e.history.length, 1);
  undoElement();
  assert.equal(e.root!.kind, 'leaf');
  redoElement();
  assert.equal(e.root!.kind, 'branch');
  assert.equal(e.root!.children!.length, 3);
});

test('недопустимое изменение откатывается и не попадает в историю', () => {
  splitAsTool();
  const tok = beginChange(e);
  e.root!.sizes = [1, 1, 1498];                // ячейки по 1 мм — стекла нет
  assert.equal(finishChange(e, tok), false);
  assert.equal(e.history.length, 1);
  assert.equal(dom.toast(), 'Текущий элемент недопустимый');
  assert.equal(isElementValid(e, p), true);
});

test('форма правки не даёт сохранить размер, при котором элемент недопустим', () => {
  splitAsTool();
  S.editingElementId = e.id;
  dom.el('editElemWidth').value = '150';
  saveEditElement();
  assert.equal(isElementValid(e, p), true, 'сохранено недопустимое окно шириной ' + e.width);
  assert.equal(Number(e.width), 1500, 'ширина откатилась');
  assert.equal(dom.toast(), 'Текущий элемент недопустимый');
});

test('правка ширины в форме — обычный шаг истории: «Отменить» возвращает ширину, деление остаётся', () => {
  splitAsTool();                                   // история: снимок 1500 мм без деления
  S.editingElementId = e.id;
  dom.el('editElemWidth').value = '2000';
  saveEditElement();
  assert.equal(Number(e.width), 2000);
  undoElement();                                   // последнее действие — ширина
  assert.equal(Number(e.width), 1500);
  assert.equal(e.root!.kind, 'branch', 'деление на месте');
  redoElement();
  assert.equal(Number(e.width), 2000, '«Вернуть» возвращает правку формы');
  assert.equal(e.root!.kind, 'branch');
});

test('правка ширины в форме сохраняет заданные размеры ячеек',
  { todo: 'Важно: форма меняет width, а computeLayout пропорционально пересчитывает ВСЕ квоты (на экране элемента меняется только крайняя ячейка)' }, () => {
  splitAsTool();
  e.root!.sizes = [600, 450, 450];
  S.editingElementId = e.id;
  dom.el('editElemWidth').value = '1600';
  saveEditElement();
  // любая отрисовка/смета пересчитывает квоты
  isElementValid(e, p);
  assert.equal(Math.round(e.root!.sizes![0]), 600, 'первая ячейка стала ' + e.root!.sizes![0]);
});
