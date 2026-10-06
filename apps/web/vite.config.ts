import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    host: true,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: false } },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
