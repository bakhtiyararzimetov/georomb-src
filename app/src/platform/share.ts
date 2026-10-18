// Отправка файла/текста: 1) нативное «Поделиться» (Capacitor); 2) navigator.share; 3) скачивание.
import { nativePlugins } from './capacitor.ts';

export type DeliverResult = 'native' | 'share' | 'download' | 'cancel' | 'unsupported';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
const isCancel = (err: unknown) => !!err && /cancel/i.test(String((err as Error).message || err));

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

export async function deliverFile(blob: Blob, name: string, title: string): Promise<DeliverResult> {
  try{
    const plugins = nativePlugins();
    if(plugins && plugins.Filesystem && plugins.Share){
      const saved = await plugins.Filesystem.writeFile({ path:name, data:await blobToBase64(blob), directory:'CACHE' });
      await plugins.Share.share({ title, url:saved.uri, dialogTitle:title });
      return 'native';
    }
  }catch(err){
    if(isCancel(err)) return 'cancel';                 // пользователь закрыл меню
    console.error(err);                                // иначе пробуем браузерные способы
  }
  try{
    const file = new File([blob], name, { type:blob.type });
    if(navigator.canShare && navigator.canShare({ files:[file] })){
      try{ await navigator.share({ files:[file], title }); return 'share'; }
      catch(err){ if(err && (err as Error).name === 'AbortError') return 'cancel'; }
    }
  }catch{ /* File недоступен — скачиваем */ }
  downloadBlob(blob, name);
  return 'download';
}

export async function deliverText(text: string, title: string): Promise<DeliverResult> {
  try{
    const plugins = nativePlugins();
    if(plugins && plugins.Share){
      await plugins.Share.share({ title, text, dialogTitle:title });
      return 'native';
    }
  }catch(err){
    if(isCancel(err)) return 'cancel';
    console.error(err);
  }
  if(navigator.share){
    try{ await navigator.share({ title, text }); return 'share'; }
    catch(err){ if(err && (err as Error).name === 'AbortError') return 'cancel'; }
  }
  return 'unsupported';
}
