// Client for Jev (TypeSafe System One). Requests go through the dev server's
// /api/jev proxy, which adds the API key. When Jev is unreachable, ask()
// resolves to null and the rivals fall back to their local heuristics.
export class Jev {
  constructor(url = '/api/jev') {
    this.url = url;
    this.retryAt = 0;
    this.stats = { requests: 0, errors: 0, latency: 0, online: null, error: '' };
  }

  async ask(state, questions) {
    if (performance.now() < this.retryAt) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const t0 = performance.now();
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'jev-latest', state, questions }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const retry = res.status === 429 || res.status === 529 ? 1500 : res.status >= 500 ? 3000 : 20000;
        return this.fail(`HTTP ${res.status}`, retry);
      }
      const json = await res.json();
      if (!json.answers) return this.fail('no answers', 3000);
      const ms = performance.now() - t0;
      const s = this.stats;
      s.requests++;
      s.latency = s.latency ? s.latency * 0.8 + ms * 0.2 : ms;
      s.online = true;
      s.error = '';
      return json.answers;
    } catch (e) {
      return this.fail(e.name === 'AbortError' ? 'timeout' : 'network', 3000);
    } finally {
      clearTimeout(timer);
    }
  }

  fail(reason, retryMs) {
    this.stats.errors++;
    this.stats.online = false;
    this.stats.error = reason;
    this.retryAt = performance.now() + retryMs;
    return null;
  }
}
