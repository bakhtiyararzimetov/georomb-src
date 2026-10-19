// Смета проекта: ввод скидки и аванса.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installStorage } from './helpers.ts';
installStorage();
installDom();
const { S } = await import('../src/state.ts');
const { clonePriceDefaults } = await import('../src/model/pricing.ts');
const ui = await import('../src/features/priceScreens.ts');
import type { Project } from '../src/types.ts';

let p: Project;
beforeEach(() => {
  S.prices = clonePriceDefaults();
  p = { id: 1, name: 'T', date: '', type: 'pvc', elements: [] };
  S.projects = [p]; S.currentProjectId = 1;
});

test('parseMoney: пробелы, запятая, точка как разделитель тысяч; мусор и минус — 0', () => {
  assert.deepEqual(['1 000,50', '1.000,50', '1,5', '2500', '-5', 'abc', ''].map(ui.parseMoney), [1000.5, 1000.5, 1.5, 2500, 0, 0, 0]);
});

test('смена единиц скидки обнуляет её — 5000 ₸ не превращаются в 100%', () => {
  ui.setEstimateDiscount('5000');
  assert.deepEqual(p.discount, { mode: 'sum', value: 5000 });
  ui.setEstimateDiscountMode('pct');
  assert.deepEqual(p.discount, { mode: 'pct', value: 0 });
  ui.setEstimateDiscount('7');
  assert.deepEqual(p.discount, { mode: 'pct', value: 7 });
  ui.setEstimateDiscount('');
  assert.deepEqual(p.discount, { mode: 'pct', value: 0 }, 'пустое поле — 0, но выбранные единицы остаются');
  ui.setEstimateDiscount('250');
  assert.equal(p.discount!.value, 100, 'процент не больше 100');
});
