import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  root: path.join(__dirname, 'src/renderer'),
  publicDir: false, 
  build: {
    outDir: path.join(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome100', // Electron uses Chromium
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: path.join(__dirname, 'src/renderer/index.html'),
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
    },
  },
  server: {
    port: 5173,
  }
});
