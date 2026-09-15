import { defineConfig } from 'vite';
import { fighterApi } from './server/api.js';

export default defineConfig({
  plugins: [fighterApi()],
  server: {
    port: 5179,
    host: '127.0.0.1',
    strictPort: true,
    fs: { allow: ['..', '.'] },
  },
  build: { target: 'es2022' },
});
