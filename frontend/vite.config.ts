import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

declare const process: { env: Record<string, string | undefined>; cwd(): string };

// Only the endpoints the dashboard uses are forwarded (list, detail, report); anything else gets a 404.
const PROXIED_PATHS = [/^\/api\/cases\/?$/, /^\/api\/cases\/[^/]+\/?$/, /^\/api\/cases\/[^/]+\/report\/?$/];

// Requests to /api are proxied to the backend, so the browser stays same-origin and needs no CORS.
function apiProxy(target: string): Record<string, ProxyOptions> {
  return {
    '/api': {
      target,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
      bypass: (req) => (PROXIED_PATHS.some((p) => p.test((req.url ?? '').split('?')[0])) ? undefined : false),
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const proxy = apiProxy(env.MULERADAR_API_URL || 'http://127.0.0.1:8000');
  return {
    plugins: [react()],
    server: { port: 5173, host: true, proxy },
    preview: { port: 4173, host: true, proxy },
  };
});
