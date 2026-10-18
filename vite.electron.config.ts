import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

// 把素材库主进程代码（electron/materials/*.ts 和它用到的 src/materials）打成一个 electron/materials.cjs，
// main.cjs 直接 require。其余主进程代码保持手写 .cjs。
export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'electron/materials/index.ts',
    outDir: 'electron',
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    rollupOptions: {
      external: ['electron', ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
      output: { format: 'cjs', entryFileNames: 'materials.cjs' },
    },
  },
});
