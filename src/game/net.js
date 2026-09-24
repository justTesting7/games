// Same-origin WebSocket to the Cloudflare Durable Object room.
// Vite has no /ws, so localhost stays offline unless you run `npm run cf:dev`.
export class Net {
  constructor() {
    this.ws = null;
    this.status = 'off';
    this.error = '';
    this.room = new URLSearchParams(location.search).get('room') || 'lobby';
    this.id = '';
    this.slot = 0;
    this.inbox = [];
    this.identity = null;
  }

  get enabled() {
    return !/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || location.port === '8787';
  }

  get peers() {
    return 0;
  }

  connect(identity) {
    if (!this.enabled) return;
    this.identity = identity || this.identity;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws?room=${encodeURIComponent(this.room)}`;
    this.status = 'connecting';
    this.error = '';
    try {
      this.ws = new WebSocket(url);
    } catch {
      this.status = 'error';
      this.error = 'open';
      return;
    }
    this.ws.onopen = () => {
      this.status = 'online';
      if (this.identity) this.send({ t: 'hello', ...this.identity });
    };
    this.ws.onclose = () => {
      this.status = 'off';
      this.ws = null;
    };
    this.ws.onerror = () => {
      this.status = 'error';
      this.error = 'socket';
    };
    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'hello' && msg.id) {
        this.id = msg.id;
        this.slot = msg.slot || 0;
      }
      this.inbox.push(msg);
    };
  }

  take() {
    const q = this.inbox;
    this.inbox = [];
    return q;
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
