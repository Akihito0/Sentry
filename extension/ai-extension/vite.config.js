import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',      // put build files in dist/
    emptyOutDir: true    // clear dist/ before each build
  }
})