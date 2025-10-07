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
        { src: 'public/*', dest: 'dist' },
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
        background: resolve( 'public/background.js'),
        contentscript: resolve( 'public/contentscript.js'),
        chatbotUI: resolve( 'public/chatbotUI.js'),
      },
      output: {
        entryFileNames: '[name].js', // Keep original names
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
