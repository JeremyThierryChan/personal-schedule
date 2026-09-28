// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// 本地开发用 "/"，GitHub Actions 构建时用 "/personal--schedule/"
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  site: 'https://jeremythierrychan.github.io',
  base,
  vite: {
    plugins: [tailwindcss()],
  },
});
