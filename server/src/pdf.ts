// Сборка PDF: каждая страница — SVG из page.ts, растеризованный resvg (шрифт DejaVu Sans, кириллица),
// и вставленный на лист A4 через pdf-lib. Как в приложении: страница — картинка на весь лист.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { PDFDocument } from 'pdf-lib';
import type { PdfLang, Project } from '../../app/src/types.ts';
import { setPdfLang } from '../../app/src/features/pdfI18n.ts';
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
 * Проект → PDF: одна страница A4 на элемент, подписи на языке lang.
 * Сюда можно подставить другую отрисовку — серверу (app.ts) важна только сигнатура.
 */
export async function drawWindowAndMakePdf(project: Project, lang: PdfLang = 'ru'): Promise<Uint8Array> {
  // язык — общее состояние модуля: все страницы рисуются синхронно до первого await,
  // поэтому параллельный вызов в том же потоке не перепутает подписи
  setPdfLang(lang);
  const pages = project.elements.map((_, i) => renderPagePng(elementPageSvg(project, i)));
  const doc = await PDFDocument.create();
  doc.setTitle(project.name);
  doc.setCreator('GeoRomb');
  for(const page of pages){
    const png = await doc.embedPng(page);
    doc.addPage([A4W, A4H]).drawImage(png, { x: 0, y: 0, width: A4W, height: A4H });
  }
  return doc.save();
}
