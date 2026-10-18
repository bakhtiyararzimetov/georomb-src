// Мост к нативным плагинам Capacitor (Filesystem, Share, App). Глобальный window.Capacitor внедряет
// нативная оболочка; в обычном браузере его нет — тогда работают браузерные запасные пути.

interface CapPlugins {
  Filesystem?: { writeFile(o: { path: string; data: string; directory: string }): Promise<{ uri: string }> };
  Share?: { share(o: { title?: string; text?: string; url?: string; dialogTitle?: string }): Promise<unknown> };
  App?: {
    minimizeApp?(): Promise<void>;
    exitApp?(): Promise<void>;
    addListener(ev: 'backButton', cb: () => void): unknown;
  };
}
interface CapacitorGlobal { isNativePlatform?(): boolean; Plugins?: CapPlugins; }

declare global {
  interface Window { Capacitor?: CapacitorGlobal; }
}

/** Плагины, только если приложение запущено нативно. */
export function nativePlugins(): CapPlugins | null {
  const cap = window.Capacitor;
  if(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() && cap.Plugins) return cap.Plugins;
  return null;
}
