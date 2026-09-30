import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// El panel vive en app/ y se compila a servidor/public (lo sirve Express).
export default defineConfig({
  root: 'app',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'IEMEC · Panel de la clínica',
        short_name: 'IEMEC',
        lang: 'es',
        start_url: '/',
        display: 'standalone',
        background_color: '#0b2b2a',
        theme_color: '#123f3e',
        icons: [{ src: '/icono.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,woff2}'], navigateFallbackDenylist: [/^\/api\//, /^\/c\//, /^\/r\//, /^\/webhooks\//] },
    }),
  ],
  build: { outDir: '../servidor/public', emptyOutDir: true },
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:3004', '/c/': 'http://localhost:3004', '/r/': 'http://localhost:3004' },
  },
});
