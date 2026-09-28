/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);
/** Carpeta de un paquete instalado (algunos, como onnxruntime-web, no exportan package.json). */
const pkgDir = (name: string) => {
  const local = fileURLToPath(new URL(`./node_modules/${name}`, import.meta.url));
  return existsSync(local) ? local : dirname(require.resolve(name));
};

/**
 * Motores de lectura servidos por la propia app (sin CDN): worker y núcleo WebAssembly de Tesseract, modelo español
 * (best_int) y binario de ONNX Runtime Web. Se copian de node_modules al construir y se sirven igual en desarrollo.
 */
function ocrRuntimeFiles(): Record<string, string> {
  const tess = pkgDir('tesseract.js');
  const core = pkgDir('tesseract.js-core');
  const spa = pkgDir('@tesseract.js-data/spa');
  const ort = pkgDir('onnxruntime-web');
  const files: Record<string, string> = {
    'ocr-runtime/tesseract/worker.min.js': join(tess, 'dist/worker.min.js'),
    'ocr-runtime/tessdata/spa.traineddata.gz': join(spa, '4.0.0_best_int/spa.traineddata.gz'),
    'ocr-runtime/ort/ort-wasm-simd-threaded.wasm': join(ort, 'dist/ort-wasm-simd-threaded.wasm'),
  };
  for (const v of ['lstm', 'simd-lstm', 'relaxedsimd-lstm']) files[`ocr-runtime/tesseract/core/tesseract-core-${v}.wasm.js`] = join(core, `tesseract-core-${v}.wasm.js`);
  return files;
}

function ocrRuntime(): Plugin {
  const files = ocrRuntimeFiles();
  const types: Record<string, string> = { js: 'text/javascript', wasm: 'application/wasm', gz: 'application/gzip' };
  return {
    name: 'escandallo-ocr-runtime',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
        const src = files[path];
        if (!src || !existsSync(src)) return next();
        res.setHeader('Content-Type', types[path.split('.').pop() ?? ''] ?? 'application/octet-stream');
        res.setHeader('Content-Length', String(statSync(src).size));
        createReadStream(src).pipe(res);
      });
    },
    generateBundle() {
      for (const [fileName, src] of Object.entries(files)) this.emitFile({ type: 'asset', fileName, source: readFileSync(src) });
    },
  };
}

// Rutas relativas (base './') + HashRouter: la app funciona desplegada en cualquier subruta
// (GitHub Pages, Netlify, un servidor estático…) sin configuración extra.
export default defineConfig({
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    react(),
    tailwindcss(),
    ocrRuntime(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.svg', 'icons/*.png'],
      manifest: {
        name: 'Escandallo Pro — Food cost inteligente',
        short_name: 'Escandallo Pro',
        description:
          'Sube tus facturas, fotografía la carta y obtén escandallos, food cost y mermas por plato en minutos.',
        lang: 'es',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0b0f14',
        theme_color: '#ff5a1f',
        categories: ['business', 'food', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Subir facturas', url: './#/facturas?nuevo=1' },
          { name: 'Fotografiar carta', url: './#/carta?nuevo=1' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,mjs,wasm}'],
        // Modelos de lectura (PaddleOCR, ~13 MB): se descargan y cachean aparte sólo al leer la primera foto
        globIgnores: ['ocr-models/**', 'ocr-runtime/**', 'samples/**'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Motores de lectura y modelos servidos por la app: se cachean al usarse por primera vez (uso sin conexión)
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/(ocr-runtime|ocr-models)\//.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ocr-runtime',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Modelos de idioma y worker de Tesseract (OCR offline tras la primera descarga)
            urlPattern: ({ url }) =>
              url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'tessdata.projectnaptha.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'ocr-assets',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
