import { defineConfig } from 'vite';

export default defineConfig({
  // 設定 base: './' 確保在 GitHub Pages 子路徑 (/moon_surveyor/) 與本機皆能正常運作
  base: './',
});
