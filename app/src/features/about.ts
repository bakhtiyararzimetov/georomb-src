// «О приложении»: версия и контакты разработчика.
import { $ } from '../ui/dom.ts';

// версия приложения — меняйте при каждом выпуске (её же показывает package.json)
export const APP_VERSION = '1.01';
// контакты: Telegram — ник без @, WhatsApp — номер без «+»
export const CONTACT = { tg:'Bakhtiyar124', wa:'77479453926' };

export function initAbout(): void {
  $('aboutVer').textContent = 'Версия ' + APP_VERSION;
  $('aboutRowSub').textContent = 'Версия ' + APP_VERSION + ' · ошибки и идеи';
  const msg = encodeURIComponent('Здравствуйте! Пишу по поводу приложения: ');
  ($('aboutTg') as HTMLAnchorElement).href = 'https://t.me/' + CONTACT.tg + '?text=' + msg;
  ($('aboutWa') as HTMLAnchorElement).href = 'https://wa.me/' + CONTACT.wa + '?text=' + msg;
}
export function openAbout(): void { $('aboutBackdrop').classList.add('open'); }
export function closeAbout(): void { $('aboutBackdrop').classList.remove('open'); }
