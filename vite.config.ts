import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react()],
  base: './',
  // export.html：后台把 AI 写的 Markdown 排版成 PDF / Word / PPT 时用的隐藏页面
  // office.html：没有 Office / WPS 可用时（macOS）把 PPT / Word 课件排版成页面的隐藏页面
  build: { rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), export: resolve(import.meta.dirname, 'export.html'), office: resolve(import.meta.dirname, 'office.html') } } },
});
