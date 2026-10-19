// Мелкие помощники DOM: поиск элементов, экранирование, тост, разбор чисел.

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
export const $input = (id: string): HTMLInputElement => $<HTMLInputElement>(id);
export const $select = (id: string): HTMLSelectElement => $<HTMLSelectElement>(id);

export function isOpen(id: string): boolean {
  const el = document.getElementById(id);
  return !!el && el.classList.contains('open');
}
export function setOpen(id: string, open: boolean): void {
  $(id).classList.toggle('open', open);
}

/** Для текста и для атрибутов: & < > " ' (кавычки в названиях клиентов разрешены — «ООО "Окна"»). */
export function escapeHtml(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export const escapeAttr = escapeHtml;

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** ms — сколько держать тост (по умолчанию 2 с). */
export function showToast(msg: string, ms = 2000): void {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// строгий разбор размера/количества: число > 0, запятая допустима; иначе NaN
export function parseSize(str: unknown): number {
  const v = Number(String(str).trim().replace(',', '.'));
  return (isFinite(v) && v > 0) ? v : NaN;
}

export function vibrate(ms: number): void {
  if(navigator.vibrate){ try{ navigator.vibrate(ms); }catch{ /* не поддерживается */ } }
}

/** Копирование текста: Clipboard API, а если его нет — через скрытую textarea. */
export async function copyText(text: string): Promise<boolean> {
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){ await navigator.clipboard.writeText(text); return true; }
  }catch{ /* пробуем запасной способ */ }
  try{
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed; top:0; left:0; opacity:0;';
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }catch{
    return false;
  }
}
