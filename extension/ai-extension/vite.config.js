import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';
import copy from 'rollup-plugin-copy';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    copy({
      targets: [
        { src: 'public/contentscript_new.js', dest: 'dist', rename: 'contentscript_new.js' },
        { src: 'public/background.js', dest: 'dist' },
        { src: 'public/chatbotUI.js', dest: 'dist' },
        { src: 'public/popup.html', dest: 'dist' },
        { src: 'public/manifest.json', dest: 'dist' },
        { src: 'public/css/*', dest: 'dist/css' },
        { src: 'public/images', dest: 'dist' }
      ],
      hook: 'writeBundle' // Run this after the bundle is written
    })
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve( 'index.html'),
        popup: resolve( 'public/popup.html'),
        popupScript: resolve( 'public/popup.js'),
        firebase: resolve( 'src/firebase.js'),
      },
      output: {
        entryFileNames: '[name].js', // Keep original names
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
      external: []
    },
  },
});
