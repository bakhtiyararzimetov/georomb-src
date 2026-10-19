// Отрисовка: страница A4 на элемент, PDF настоящий (pdf-lib его открывает), JSON с координатами.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { parseProject } from '../src/project.ts';
import { drawWindowAndMakePdf } from '../src/pdf.ts';
import { elementPageSvg } from '../src/page.ts';
import { projectLayoutJson } from '../src/layoutJson.ts';

const example = () => parseProject(JSON.parse(readFileSync(new URL('../examples/project.json', import.meta.url), 'utf8')));

test('drawWindowAndMakePdf: PDF с одной страницей A4 на каждый элемент', async () => {
  const pdf = await drawWindowAndMakePdf(example());
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString('latin1'), '%PDF-');
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getPageCount(), 2);
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - 595.28) < 1 && Math.abs(height - 841.89) < 1, 'A4');
});

test('elementPageSvg: шапка, общий размер, размерные цепочки и створки', () => {
  const svg = elementPageSvg(example(), 0);
  assert.match(svg, /^<svg[^>]+viewBox="0 0 1240 1754"/);
  assert.ok(svg.includes('Иванов, ул. Навои 12'));
  assert.ok(svg.includes('Элемент 1'));
  assert.ok(svg.includes('1500 × 1200 мм'));
  assert.ok(svg.includes('>750<'), 'цепочка по ширине: две части по 750');
  assert.ok(svg.includes('поворотно-откидная, петли слева'));
  assert.ok(svg.includes('глухое стекло'));
});

test('elementPageSvg экранирует текст из JSON', () => {
  const p = parseProject({ name: 'A <b> & "c"', elements: [{ width: 1000, height: 1000 }] });
  const svg = elementPageSvg(p, 0);
  assert.ok(svg.includes('A &lt;b&gt; &amp; &quot;c&quot;'));
  assert.ok(!svg.includes('<b>'));
});

test('projectLayoutJson: рама, створки и импост в мм', () => {
  const j = projectLayoutJson(example());
  assert.equal(j.name, 'Иванов, ул. Навои 12');
  assert.equal(j.elements.length, 2);
  const e = j.elements[0];
  assert.deepEqual([e.index, e.type, e.width, e.height, e.qty], [1, 'casement', 1500, 1200, 2]);
  assert.ok(e.frame > 0);
  assert.equal(e.leaves.length, 2);
  assert.equal(e.mullions.length, 1);
  assert.deepEqual(e.leaves[0].opening, { type: 'TiltTurn', hinge: 'left' });
  assert.equal(e.leaves[1].opening, null);
  assert.ok(e.leaves[0].x >= e.frame && e.leaves[1].x > e.leaves[0].x);
  assert.equal(JSON.parse(JSON.stringify(j)).elements[1].leaves.length >= 1, true);
});

test('elementPageSvg: отдельный подоконник подписан как подоконник', () => {
  const svg = elementPageSvg(parseProject({ elements: [{ type: 'sill', width: 1500, height: 200 }] }), 0);
  assert.ok(svg.includes('>Подоконник<'), 'конструкция');
  assert.ok(!svg.includes('Створная'));
  assert.ok(!svg.includes('Створки') && !svg.includes('глухое стекло') && !svg.includes('Цвет окна'), 'у подоконника нет створок и стекла');
  assert.ok(svg.includes('1,50 м × 20 см'));
});

test('projectLayoutJson: отдельный подоконник — без рамы и стекла', () => {
  const j = projectLayoutJson(parseProject({ elements: [{ type: 'sill', width: 1500, height: 200 }] }));
  assert.equal(j.elements[0].frame, 0);
  assert.deepEqual([j.elements[0].leaves, j.elements[0].mullions], [[], []]);
});

test('elementPageSvg: количество 0 — 0 шт, как в приложении', () => {
  const p = parseProject({ elements: [{ width: 1000, height: 1000 }] });
  p.elements[0].qty = 0;
  assert.ok(elementPageSvg(p, 0).includes('>0 шт<'));
});
