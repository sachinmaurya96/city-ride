import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import playgamaBridge from '@playgama/bridge/vite';

// Relative base so the build works from any nested hosting path (Playgama iframe, sub-folders).
// `--mode playgama` bundles the Bridge runtime locally (no external CDN dependency hidden from the size budget).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'playgama' ? [playgamaBridge({ mode: 'local' })] : [])],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.npm_package_version ?? '0.1.0') },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: 0,
  },
  server: { host: false },
}));
