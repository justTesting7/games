import { DurableObject } from 'cloudflare:workers';

export class GameRoom extends DurableObject {
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return Response.json({
        room: this.ctx.id.toString(),
        peers: this.ctx.getWebSockets().length,
      });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const id = crypto.randomUUID().slice(0, 8);
    server.serializeAttachment({ id, name: 'player' });
    this.broadcast(server, { t: 'join', id });
    server.send(JSON.stringify({
      t: 'hello',
      id,
      peers: this.ctx.getWebSockets().filter((ws) => ws !== server).map((ws) => ws.deserializeAttachment()),
    }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let msg;
    try { msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)); }
    catch { return; }
    const mine = ws.deserializeAttachment() || {};
    if (msg.t === 'hello' && typeof msg.name === 'string') {
      mine.name = msg.name.slice(0, 24);
      ws.serializeAttachment(mine);
    }
    this.broadcast(ws, { ...msg, id: mine.id, name: mine.name });
  }

  async webSocketClose(ws) {
    const mine = ws.deserializeAttachment() || {};
    this.broadcast(ws, { t: 'leave', id: mine.id });
  }

  broadcast(except, payload) {
    const data = JSON.stringify(payload);
    for (const peer of this.ctx.getWebSockets()) {
      if (peer !== except) peer.send(data);
    }
  }
}
