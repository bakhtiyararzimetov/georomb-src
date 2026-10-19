// Вывод полей проекта через innerHTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installStorage } from './helpers.ts';
installStorage();
const dom = installDom();
const { S } = await import('../src/state.ts');
const { clonePriceDefaults } = await import('../src/model/pricing.ts');
const projects = await import('../src/features/projects.ts');
import type { Project } from '../src/types.ts';

const PAYLOAD = '<img src=x onerror=alert(1)>';
S.prices = clonePriceDefaults();

test('имя проекта экранируется в списке проектов', () => {
  S.projects = [{ id: 1, number: 1, name: PAYLOAD, date: '1 мая', type: 'pvc', elements: [] } as Project];
  projects.render('');
  assert.ok(!dom.el('list').innerHTML.includes('<img'));
});

test('дата проекта экранируется в списке проектов', () => {
  S.projects = [{ id: 1, number: 1, name: 'x', date: PAYLOAD, type: 'pvc', elements: [] } as Project];
  projects.render('');
  assert.ok(!dom.el('list').innerHTML.includes('<img'), dom.el('list').innerHTML);
});

test('размеры/количество элемента экранируются на экране проекта', () => {
  const p = { id: 1, number: 1, name: 'x', date: '', type: 'pvc', elements: [
    { id: 1, type: 'casement', width: PAYLOAD, height: 1200, qty: 1, color: null, history: [], redo: [] }] } as unknown as Project;
  S.projects = [p]; S.currentProjectId = 1;
  projects.renderCanvas();
  assert.ok(!dom.el('projectCanvas').innerHTML.includes('<img'), 'innerHTML содержит разметку из width');
});
