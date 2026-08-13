import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:4750' },
  },
  build: {
    outDir: 'dist',
    // كل الأصول تُضمَّن محليًا — لا CDN ولا موارد خارجية
    assetsInlineLimit: 0,
  },
});
