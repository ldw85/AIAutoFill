import { defineConfig } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.json';

export default defineConfig({
  plugins: [
    svelte({
      preprocess: vitePreprocess(),
    }),
    crx({ manifest }),
  ],
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: true,
  },
});
