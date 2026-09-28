import { GameRoom } from './room.js';

export { GameRoom };

const JEV = 'https://api.typesafe.ai/v1/systemone';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/shootout') {
      return Response.redirect(new URL('/shootout/', request.url), 308);
    }
    if (url.pathname === '/ws' || url.pathname.startsWith('/ws/')) {
      const room = url.searchParams.get('room') || 'lobby';
      const id = env.ROOM.idFromName(room);
      return env.ROOM.get(id).fetch(request);
    }
    if (url.pathname === '/api/jev' && request.method === 'POST') {
      return proxyJev(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

async function proxyJev(request, env) {
  const key = env.JEV_API_KEY;
  if (!key) return Response.json({ error: 'Jev key missing' }, { status: 503 });
  const body = await request.arrayBuffer();
  const res = await fetch(JEV, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body,
  });
  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
  });
}
