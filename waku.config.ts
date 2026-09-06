import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'waku/config';

export default defineConfig({
  srcDir: 'src/app',
  vite: {
    resolve: { tsconfigPaths: true },
    plugins: [
      tailwindcss(),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
    ],
  },
});
