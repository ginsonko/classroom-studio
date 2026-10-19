import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react()],
  base: './',
  // export.html：后台把 AI 写的 Markdown 排版成 PDF / Word / PPT 时用的隐藏页面
  build: { rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), export: resolve(import.meta.dirname, 'export.html') } } },
});
