// Сборка PDF: каждая страница — SVG из page.ts, растеризованный resvg (шрифт DejaVu Sans, кириллица),
// и вставленный на лист A4 через pdf-lib. Как в приложении: страница — картинка на весь лист.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { PDFDocument } from 'pdf-lib';
import type { Project } from '../../app/src/types.ts';
import { PAGE_FONT, PAGE_W, elementPageSvg } from './page.ts';

const A4W = 595.28, A4H = 841.89;
const fontDir = join(dirname(createRequire(import.meta.url).resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const FONT = {
  fontFiles: [join(fontDir, 'DejaVuSans.ttf'), join(fontDir, 'DejaVuSans-Bold.ttf')],
  loadSystemFonts: false,
  defaultFontFamily: PAGE_FONT
};

/** Страница в PNG (1240 px по ширине = A4 при 150 dpi). */
export function renderPagePng(svg: string): Uint8Array {
  return new Resvg(svg, { fitTo: { mode: 'width', value: PAGE_W }, font: FONT, background: '#ffffff' }).render().asPng();
}

/**
 * Проект → PDF: одна страница A4 на элемент.
 * Сюда можно подставить другую отрисовку — серверу (app.ts) важна только сигнатура.
 */
export async function drawWindowAndMakePdf(project: Project): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(project.name);
  doc.setCreator('GeoRomb');
  for(let i = 0; i < project.elements.length; i++){
    const png = await doc.embedPng(renderPagePng(elementPageSvg(project, i)));
    doc.addPage([A4W, A4H]).drawImage(png, { x: 0, y: 0, width: A4W, height: A4H });
  }
  return doc.save();
}
