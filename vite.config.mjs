import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const client = (p) => fileURLToPath(new URL(`./client/${p}`, import.meta.url));
const SERVER = `http://localhost:${process.env.PORT || 3000}`;

// In dev, mirror the Express route guard's entry redirect so "/" isn't a 404.
const rootRedirect = {
  name: 'cinesync-root-redirect',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/' || req.url === '/index.html') {
        res.statusCode = 302;
        res.setHeader('Location', '/setup.html');
        return res.end();
      }
      next();
    });
  }
};

export default defineConfig({
  root: client(''),
  plugins: [react(), rootRedirect],
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        setup: client('setup.html'),
        watch: client('watch.html')
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': SERVER,
      '/video': SERVER,
      '/media': SERVER,
      '/ws': { target: SERVER, ws: true }
    }
  },
  test: {
    root: client(''),
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    setupFiles: ['src/test/setup.js']
  }
});
