import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'REACT_APP_');
  return {
    plugins: [react()],
    define: { 'process.env.REACT_APP_API_URL': JSON.stringify(process.env.REACT_APP_API_URL || env.REACT_APP_API_URL || '') },
    server: { port: 3000 },
    build: { outDir: 'build', emptyOutDir: true, rollupOptions: { output: { manualChunks: {
      charts: ['chart.js', 'react-chartjs-2'], motion: ['framer-motion'],
    } } } },
    test: { globals: true, environment: 'jsdom', setupFiles: ['./src/setupTests.js'], include: ['src/**/*.test.{js,jsx}'] },
  };
});
