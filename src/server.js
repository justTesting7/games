import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';

const ONE_MB = 1024 * 1024;
const CHUNK_SIZE = 16 * 1024;

export function createApp() {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/download', (_req, res) => {
    const file = crypto.randomBytes(ONE_MB);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    for (let offset = 0; offset < file.length; offset += CHUNK_SIZE) {
      const chunk = file.subarray(offset, offset + CHUNK_SIZE);
      res.write(`data: ${chunk.toString('base64')}\n\n`);
    }

    const checksum = crypto.createHash('sha256').update(file).digest('hex');
    res.write(
      `event: done\ndata: ${JSON.stringify({ bytes: file.length, sha256: checksum })}\n\n`,
    );
    res.end();
  });

  return app;
}

export function startServer(port = 0) {
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      resolve({ server, port: server.address().port });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  startServer(port).then(({ port: boundPort }) => {
    console.log(`SSE download server listening on http://localhost:${boundPort}`);
  });
}
