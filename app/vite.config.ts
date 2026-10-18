import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// base: './' — относительные пути: Capacitor (webDir) и GitHub Pages открывают сборку из любой папки
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // es2017: синтаксис как в исходном файле — работает и в старых WebView (Android 7–9 без обновлений, Chrome 61+)
    target: 'es2017',
    cssTarget: 'chrome61'
  }
});
