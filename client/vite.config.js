import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs separately; proxy /api so the client can use relative URLs.
// In production the client is either served by the API (same origin) or built with VITE_API_URL.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_DEV_API_TARGET || 'http://localhost:4000', changeOrigin: true },
    },
  },
});
