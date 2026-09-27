const JEV = 'https://api.typesafe.ai/v1/systemone';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/jev' && request.method === 'POST') return proxyJev(request, env);
    return env.ASSETS.fetch(request);
  },
};

async function proxyJev(request, env) {
  const key = env.JEV_API_KEY;
  // Secrets stay on the worker they were set on. Relic Isle already has the key.
  if (!key && env.SHOOTER) {
    const body = await request.arrayBuffer();
    return env.SHOOTER.fetch(new Request('https://relic-isle/api/jev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }));
  }
  if (!key) return Response.json({ error: 'Jev key missing' }, { status: 503 });
  const res = await fetch(JEV, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: await request.arrayBuffer(),
  });
  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
  });
}
