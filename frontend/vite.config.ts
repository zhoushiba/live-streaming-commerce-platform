import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * 开发期把 /api、/media、/uploads 与 Socket.IO 全部代理到 NestJS（3000），
 * 这样前端不需要处理 CORS，也不用硬编码后端地址；生产环境由 nginx 承担同样的转发。
 *
 * 注意：Socket.IO 的 HTTP 握手走的是 `/socket.io/` 路径（namespace `/ws` 在 payload 里），
 * 所以代理规则必须写 `/socket.io` 而不是 `/ws`。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/media': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/socket.io': { target: 'http://127.0.0.1:3000', changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia', 'axios'],
          player: ['hls.js', 'flv.js'],
          ui: ['element-plus'],
        },
      },
    },
  },
});
