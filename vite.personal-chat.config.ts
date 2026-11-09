import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()], publicDir: false, define: { __APP_VERSION__: JSON.stringify('personal') },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: 'dist-personal-chat', rollupOptions: { input: 'personal-chat.html' } },
});
