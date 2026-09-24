// Same-origin WebSocket to the Cloudflare Durable Object room.
// Vite has no /ws, so localhost stays offline unless you run `npm run cf:dev`.
export class Net {
  constructor() {
    this.ws = null;
    this.status = 'off';
    this.error = '';
    this.room = 'lobby';
    this.id = '';
    this.peers = 0;
  }

  get enabled() {
    return !/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || location.port === '8787';
  }

  connect(room = 'lobby') {
    if (!this.enabled) return;
    this.room = room;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws?room=${encodeURIComponent(room)}`;
    this.status = 'connecting';
    this.error = '';
    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this.status = 'error';
      this.error = 'open';
      return;
    }
    this.ws.onopen = () => {
      this.status = 'online';
      this.ws.send(JSON.stringify({ t: 'hello', name: 'You' }));
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
        this.peers = Array.isArray(msg.peers) ? msg.peers.length : 0;
      }
      if (msg.t === 'join') this.peers += 1;
      if (msg.t === 'leave') this.peers = Math.max(0, this.peers - 1);
    };
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
