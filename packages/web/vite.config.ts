import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DAEMON_URL = process.env['SPRINTSTER_DAEMON_URL'] ?? 'http://127.0.0.1:3939';

export default defineConfig({
  plugins: [react()],
  // Not 'assets': the daemon mounts the blob endpoint at /assets/:hash.
  build: { assetsDir: '_app' },
  server: {
    proxy: {
      '/api': {
        target: DAEMON_URL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
