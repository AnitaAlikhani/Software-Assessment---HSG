import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rolldownOptions: {
        // Two pages: the app, and the voice check for the team (voice-lab.html), which shares
        // the app's styles but none of its screens.
        input: {
          main: path.resolve(__dirname, 'index.html'),
          'voice-lab': path.resolve(__dirname, 'voice-lab.html'),
        },
      },
    },
    server: {
      // DISABLE_HMR=true switches live reload and file watching off, for a hosted editor that
      // restarts the page itself. Without the variable both stay on.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
