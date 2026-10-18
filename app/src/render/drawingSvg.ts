// Чертёж элемента для PDF — без DOM, поэтому им пользуются и приложение (features/pdf.ts), и сервер API (server/).
import type { Layout, TreeNode } from '../types.ts';
import { CONTOUR_COLOR, PROFILE_STROKE, buildSillSvg, buildSvg } from './svg.ts';
import { pdfT } from '../features/pdfI18n.ts';

// Подоконник выступает за viewBox; <img> обрезает по нему — расширяем viewBox и картинку на те же отступы.
// padX нужен, чтобы сместить картинку при drawImage.
export function drawingSvg(out: Layout, pxW: number, pxH: number, lineW: number): { svg: string; w: number; h: number; padX: number } {
  const style = `<style>[stroke="${PROFILE_STROKE}"]{stroke:${CONTOUR_COLOR};stroke-width:${lineW}px;vector-effect:non-scaling-stroke}</style>`;
  const isSill = out.elType === 'sill';
  let svg = (isSill ? buildSillSvg(out.W, out.H, out.color) : buildSvg(out.W, out.H, out))
    .replace(/<style>[\s\S]*?<\/style>/, style)
    .replace(/ data-nid="\d+"/g, '')
    .replace(/ onclick="selectNode\(\d+\)"/g, '')
    .replace(/ style="cursor:pointer"/g, '');
  if(isSill) return { svg: svg.replace('width="100%" height="100%"', `width="${pxW}" height="${pxH}"`), w:pxW, h:pxH, padX:0 };
  const frameT = out.frameT || 0, mx = frameT * 0.8, mb = frameT * 0.9;
  const scale = pxW / out.W;
  const padX = Math.round(mx * scale), padB = Math.round(mb * scale);
  const w = pxW + padX * 2, h = pxH + padB;
  svg = svg
    .replace(`viewBox="0 0 ${out.W} ${out.H}"`, `viewBox="${-mx} 0 ${out.W + mx * 2} ${out.H + mb}"`)
    .replace('width="100%" height="100%"', `width="${w}" height="${h}"`);
  return { svg, w, h, padX };
}

// подпись створки: «поворотная, петли слева», «глухое стекло»…
export function leafDesc(node: TreeNode): string {
  const o = node.opening;
  if(!o){
    if(node.fill === 'panelV') return pdfT('panelV');
    if(node.fill === 'panelH') return pdfT('panelH');
    return pdfT('fixedGlass');
  }
  const side = o.hinge === 'left' ? pdfT('left') : pdfT('right');
  switch(o.type){
    case 'Turn':       return pdfT('turn') + side;
    case 'Tilt':       return pdfT('tilt');
    case 'TiltTurn':   return pdfT('tiltTurn') + side;
    case 'Door':       return pdfT('door') + side;
    case 'Sliding':    return pdfT('slidingLeaf') + side;
    case 'FixSliding': return pdfT('fix');
  }
  return pdfT('sash');
}
