import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildManifest } from './scripts/asset-manifest.mjs';
import { defineConfig, loadEnv } from 'vite';

const shootout = fileURLToPath(new URL('.', import.meta.url));
const hub = fileURLToPath(new URL('../index.html', import.meta.url));
const assetsDir = fileURLToPath(new URL('./public/assets', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), '');
  const key = env.JEV_API_KEY || process.env.JEV_API_KEY;
  const proxy = {
    '/api/jev': {
      target: 'https://api.typesafe.ai',
      changeOrigin: true,
      rewrite: () => '/v1/systemone',
      configure: (p) => {
        p.on('proxyReq', (req) => {
          req.removeHeader('cookie');
          if (key) req.setHeader('Authorization', `Bearer ${key}`);
        });
      },
    },
  };
  return {
    root: shootout,
    base: '/shootout/',
    publicDir: fileURLToPath(new URL('./public', import.meta.url)),
    envDir: fileURLToPath(new URL('..', import.meta.url)),
    build: {
      outDir: fileURLToPath(new URL('../dist/shootout', import.meta.url)),
      emptyOutDir: true,
    },
    server: { proxy },
    preview: { proxy },
    plugins: [{
      name: 'games-hub',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url?.split('?')[0];
          if (url === '/' || url === '/index.html') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(readFileSync(hub));
            return;
          }
          next();
        });
      },
    }, {
      // the assets' fingerprints (see scripts/asset-manifest.mjs): live in dev, a file in the build
      name: 'asset-manifest',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.split('?')[0] !== '/shootout/assets/manifest.json') return next();
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(buildManifest(assetsDir)));
        });
      },
      writeBundle(options) {
        mkdirSync(`${options.dir}/assets`, { recursive: true });
        writeFileSync(`${options.dir}/assets/manifest.json`, JSON.stringify(buildManifest(assetsDir)));
      },
    }],
  };
});
