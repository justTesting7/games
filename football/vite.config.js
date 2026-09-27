import { defineConfig, loadEnv } from 'vite';

// The AI side thinks with Jev (TypeSafe System One). The browser posts to
// /api/jev and the dev server forwards it with the key, so the key stays in
// .env and never reaches the client bundle.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
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
  return { server: { proxy }, preview: { proxy } };
});
