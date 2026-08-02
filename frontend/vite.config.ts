import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  server: {
    port: 38081,
    open: true,
  },
  build: {
    outDir: '../backend/public',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        gallery: resolve(__dirname, 'gallery.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
          if (/src[\\/](components|services|utils|sdk|layout)[\\/]/.test(id)) return 'shared';
        },
      },
    },
  },
});
