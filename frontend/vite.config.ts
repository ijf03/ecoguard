import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const target = env.VITE_API_PROXY || 'http://127.0.0.1:3001';
  if (target !== 'http://127.0.0.1:3001' && !/^https:\/\/[a-z0-9]+\.execute-api\.us-east-1\.amazonaws\.com\/?$/.test(target)) throw new Error('Use the local API or an explicit us-east-1 API Gateway HTTPS endpoint.');
  return {
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': { target, changeOrigin: true } } },
};
});
