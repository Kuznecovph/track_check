import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Сборка клиентского приложения; serverless-функции Netlify собирает сам (esbuild)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Относительная база: сборка работает и в корне домена (Netlify),
  // и в подпапке проекта GitHub Pages (https://user.github.io/repo/)
  base: './',
  resolve: {
    alias: {
      // У пакета jsmediatags сломано поле "browser" в package.json
      // (указывает на отсутствующий dist/jsmediatags.js). Явно берём
      // существующий UMD-билд, предназначенный для браузера.
      jsmediatags: 'jsmediatags/dist/jsmediatags.min.js',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
