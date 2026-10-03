import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'REACT_APP_');
  const apiUrl = process.env.REACT_APP_API_URL || env.REACT_APP_API_URL || '/api';
  if (process.env.REQUIRE_PUBLIC_API_URL === 'true') {
    let parsed;
    try { parsed = new URL(apiUrl); } catch { throw new Error('A public HTTPS REACT_APP_API_URL is required for separate client hosting'); }
    if (parsed.protocol !== 'https:' || ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(parsed.hostname)) throw new Error('REACT_APP_API_URL must use a public HTTPS host');
  }
  return {
    plugins: [react()],
    define: { 'process.env.REACT_APP_API_URL': JSON.stringify(apiUrl) },
    server: { port: 3000, proxy: Object.fromEntries(['/api', '/portal-api', '/platform-api'].map(prefix => [prefix, 'http://127.0.0.1:5000'])) },
    build: { outDir: 'build', emptyOutDir: true, rollupOptions: { output: { manualChunks: {
      charts: ['chart.js', 'react-chartjs-2'], motion: ['framer-motion'],
    } } } },
    test: { globals: true, environment: 'jsdom', setupFiles: ['./src/setupTests.js'], include: ['src/**/*.test.{js,jsx}'] },
  };
});
