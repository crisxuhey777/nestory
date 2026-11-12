import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 本地后端（backend/server.py）默认监听 127.0.0.1:8000。
// 开发与预览都把 /api 代理过去，前端只写相对路径，避免 CORS 与硬编码端口。
const backend = {
  '/api': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: false,
  },
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    strictPort: true,
    // OneDrive 同步目录下 fs.watch 偶发 EBUSY，改用轮询更稳定
    watch: { usePolling: true, interval: 350 },
    proxy: backend,
  },
  preview: { port: 5179, strictPort: true, proxy: backend },
})
