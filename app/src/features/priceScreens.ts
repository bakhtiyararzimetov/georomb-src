// Экраны «Расчёт стоимости» (смета проекта) и «Ценовое урегулирование» (настройка цен).
import { S } from '../state.ts';
import type { Mat, PriceSettings } from '../types.ts';
import { $, escapeAttr, escapeHtml } from '../ui/dom.ts';
import {
  ACC_PARTS, PROFILE_PARTS, SILL_WIDTHS, WASTE_MODES, calcProject, fmtMoney, fmtNum, isWasteMode, persistPriceSettings
} from '../model/pricing.ts';
import { getCurrentProject } from '../storage.ts';

let priceOpenRows: Record<number, boolean> = {};
let priceElementsOpen = false;   // раскрыт ли блок «По элементам»

export function openPriceEstimate(): void {
  if(!getCurrentProject()) return;
  priceOpenRows = {};
  renderPriceEstimate();
  $('priceEstimateScreen').classList.add('open');
}
export function closePriceEstimate(): void { $('priceEstimateScreen').classList.remove('open'); }
export function togglePriceDetail(i: number): void {
  priceOpenRows[i] = !priceOpenRows[i];
  renderPriceEstimate();
}
export function setPriceElementsOpen(open: boolean): void { priceElementsOpen = open; }

export function renderPriceEstimate(): void {
  const project = getCurrentProject();
  const body = $('priceEstimateBody');
  if(!project) return;
  if(project.elements.length === 0){
    body.innerHTML = `<div class="empty">Нечего считать.<br>Сначала добавьте элементы в проект.</div>`;
    return;
  }
  const res = calcProject(project);
  const rows = project.elements.map((e, i) => {
    const c = res.items[i];
    const panelLine = c.g.panelArea > 0
      ? `<div><span>Панель, ${fmtNum(c.g.panelArea)} м²</span><b>${fmtMoney(c.panelCost)}</b></div>` : '';
    const sillLine = (c.g.sillLen || 0) > 0
      ? `<div><span>Подоконник, ${fmtNum(c.g.sillLen)} м × ${c.g.sillWidth} см</span><b>${fmtMoney(c.sillCost)}</b></div>` : '';
    const netLine = c.g.netArea > 0
      ? `<div><span>Москитная сетка, ${c.g.nets.length} шт · ${fmtNum(c.g.netArea)} м²</span><b>${fmtMoney(c.netCost)}</b></div>` : '';
    const reinfLine = (c.reinfCost > 0)
      ? `<div><span>Армирование, ${fmtNum(c.g.reinfLen)} м</span><b>${fmtMoney(c.reinfCost)}</b></div>` : '';
    const detail = priceOpenRows[i] ? `
        <div class="price-detail">
          ${e.type === 'sill' ? '' : `
          <div><span>Профиль, ${fmtNum(c.g.profileLen)} м</span><b>${fmtMoney(c.profileCost)}</b></div>
          ${reinfLine}
          <div><span>Стекло, ${fmtNum(c.g.glassArea)} м²</span><b>${fmtMoney(c.glassCost)}</b></div>
          ${panelLine}${netLine}
          <div><span>Аксессуары, створок: ${c.g.sashCount}</span><b>${fmtMoney(c.accCost)}</b></div>`}
          ${sillLine}
          <div><span>Цена за 1 шт</span><b>${fmtMoney(c.unit)}</b></div>
        </div>` : '';
    return `
        <div class="price-row" onclick="togglePriceDetail(${i})">
          <div class="pc-no">${i+1}</div>
          <div class="pc-main">
            <div class="pc-name">${escapeHtml(e.width)} × ${escapeHtml(e.height)} мм · ${e.type === 'sill' ? 'подоконник' : (e.type === 'sliding' ? 'раздвижение' : 'створный')}${e.sill ? ' · с подоконником' : ''}</div>
            <div class="pc-sub">${fmtNum(c.g.area)} м² · × ${c.qty}</div>
          </div>
          <div class="pc-sum">${fmtMoney(c.roundedTotal || 0)}</div>
        </div>${detail}`;
  }).join('');

  const dec = Math.max(0, S.prices.decimals | 0);
  const estRows = res.lines.map((l, i) => `
        <div class="est-row${i % 2 ? ' zebra' : ''}">
          <span class="est-name">${escapeHtml(l.name)}</span>
          <span class="est-num">${fmtNum(l.qty, 0, 1)}</span>
          <span class="est-unit">${l.unit}</span>
          <span class="est-sum">${fmtNum(l.sum, 0, dec)}</span>
        </div>`).join('');

  const noPrices = !(res.subtotal > 0) ? `
      <div class="price-hint">
        <div>Цены ещё не заданы — поэтому везде 0. Укажите цены профилей, стекла и аксессуаров.</div>
        <button class="btn primary" onclick="openPriceSetting()">Указать цены</button>
      </div>` : '';
  body.innerHTML = noPrices + `
      <div class="section-label">Смета</div>
      <div class="est-table">
        <div class="est-head">
          <span>Название</span><span class="est-num">Кол-во</span><span>Ед.</span><span class="est-sum">Сумма</span>
        </div>
        ${estRows}
      </div>
      ${res.waste ? `<div class="price-note">Отходы по раскрою: ${res.waste.bars} хлыст(ов), ${fmtNum(res.waste.m, 1)} м в цене. Пропил ${S.cutting.kerf} мм, мин. обрезок ${S.cutting.minRemnant} мм — из настроек раскроя.</div>` : ''}
      <div class="price-total">
        <div><span>Всего</span><span>${fmtMoney(res.subtotal)}</span></div>
        <div><span class="muted">Налог (${fmtNum(res.taxRate, 0)} %)</span><span>${fmtMoney(res.tax)}</span></div>
        <div class="grand"><span>Итого (${escapeHtml(S.prices.currency)})</span><span>${fmtMoney(res.grand)}</span></div>
      </div>

      <details class="est-elements"${priceElementsOpen ? ' open' : ''} ontoggle="setPriceElementsOpen(this.open)">
        <summary>По элементам</summary>
        <div class="section-label">Элементы — справочно: округление по каждому элементу отдельно</div>
        <div class="price-table">
          <div class="price-head"><span style="flex:1">Элемент</span><span>Сумма</span></div>
          ${rows}
        </div>
        <div class="price-total">
          <div><span class="muted">Всего элементов</span><span>${fmtNum(res.totals.qty, 0)} шт</span></div>
          <div><span class="muted">Общая площадь</span><span>${fmtNum(res.totals.area)} м²</span></div>
          <div><span class="muted">Площадь стекла</span><span>${fmtNum(res.totals.glassArea, 1)} м²</span></div>
          <div><span class="muted">Длина профиля</span><span>${fmtNum(res.totals.profileLen, 1)} м</span></div>
          <div><span class="muted">Подоконник</span><span>${fmtNum(res.totals.sillLen, 2)} м</span></div>
          ${res.totals.netArea > 0 ? `<div><span class="muted">Москитная сетка</span><span>${fmtNum(res.totals.netArea)} м²</span></div>` : ''}
          ${res.totals.reinfLen > 0 ? `<div><span class="muted">Армирование</span><span>${fmtNum(res.totals.reinfLen, 1)} м</span></div>` : ''}
          <div style="margin-top:6px"><span>Сумма</span><span>${fmtMoney(res.subtotal)}</span></div>
          <div><span class="muted">Налог (${fmtNum(res.taxRate, 0)}%)</span><span>${fmtMoney(res.tax)}</span></div>
          <div class="grand"><span>Итого</span><span>${fmtMoney(res.grand)}</span></div>
        </div>
      </details>`;
}

// --- «Ценовое урегулирование» ---
export function openPriceSetting(): void {
  renderPriceSetting(S.prices);
  $('priceSettingScreen').classList.add('open');
}
export function closePriceSetting(): void { $('priceSettingScreen').classList.remove('open'); }

function priceField(path: string, label: string, value: number | string, text?: boolean, keepZero?: boolean): string {
  const shown = (!text && !keepZero && (value === 0 || value === '0')) ? '' : value;
  return `
      <div class="price-field">
        <label>${label}</label>
        <input type="text" ${text ? '' : 'inputmode="decimal"'} data-pk="${path}" value="${escapeAttr(shown)}">
      </div>`;
}
function renderPriceSetting(s: PriceSettings): void {
  const matBlock = (mat: Mat, title: string) => `
      <div class="price-group">
        <div class="price-title">${title} ( m )</div>
        ${PROFILE_PARTS.map(([k, label]) => priceField('profile.' + mat + '.' + k, label, s.profile[mat][k])).join('')}
      </div>`;
  $('priceSettingBody').innerHTML = `
      ${matBlock('pvc', 'НПВХ Профили')}
      ${matBlock('alu', 'Алюминиевые профили')}

      <div class="price-group">
        <div class="price-title">Аксессуары (кол.)</div>
        ${ACC_PARTS.map(([k, label]) => priceField('accessory.' + k, label, s.accessory[k])).join('')}
      </div>

      <div class="price-group">
        <div class="price-title">Стекло и Панель ( m² )</div>
        ${priceField('glass',      'Стекло',              s.glass)}
        ${priceField('panel.pvc',  'НПВХ Панель',         s.panel.pvc)}
        ${priceField('panel.alu',  'Алюминиевая панель',  s.panel.alu)}
      </div>

      <div class="price-group">
        <div class="price-title">Армирование и москитная сетка</div>
        ${priceField('reinf', 'Армирование ( m )',      s.reinf)}
        ${priceField('net',   'Москитная сетка ( m² )',  s.net)}
      </div>

      <div class="price-group">
        <div class="price-title">Отходы профиля в цене</div>
        ${WASTE_MODES.map(([mode, label, desc]) => `
        <label class="waste-opt">
          <input type="radio" name="wasteMode" value="${mode}"${s.waste.mode === mode ? ' checked' : ''}>
          <span><b>${label}</b><small>${desc}</small></span>
        </label>`).join('')}
        ${priceField('waste.percent', 'Процент отходов ( % )', s.waste.percent, false, true)}
      </div>

      <div class="price-group">
        <div class="price-title">Подоконник ( за метр, по ширине полки )</div>
        ${SILL_WIDTHS.map(w => priceField('sill.' + w, w + ' см', s.sill[w])).join('')}
      </div>

      <div class="price-group">
        <div class="price-title">Другие</div>
        ${priceField('tax',      'Налог ( % )',      s.tax)}
        ${priceField('currency', 'Валютный Символ',  s.currency, true)}
        ${priceField('decimals', 'Десятичные места', s.decimals, false, true)}
      </div>`;
}
export function savePriceSetting(): void {
  const s = JSON.parse(JSON.stringify(S.prices)) as PriceSettings;
  document.querySelectorAll<HTMLInputElement>('#priceSettingBody [data-pk]').forEach(inp => {
    const parts = (inp.dataset.pk || '').split('.');
    let o = s as unknown as Record<string, unknown>;
    for(let i = 0; i < parts.length - 1; i++) o = o[parts[i]] as Record<string, unknown>;
    const last = parts[parts.length - 1];
    o[last] = (last === 'currency') ? inp.value.trim() : (parseFloat(inp.value.replace(',', '.')) || 0);
  });
  const wm = document.querySelector<HTMLInputElement>('#priceSettingBody input[name="wasteMode"]:checked');
  if(wm && isWasteMode(wm.value)) s.waste.mode = wm.value;
  s.waste.percent = Math.min(100, Math.max(0, s.waste.percent));
  S.prices = s;
  persistPriceSettings();
  closePriceSetting();
  renderPriceEstimate();
}
