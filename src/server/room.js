import { DurableObject } from 'cloudflare:workers';

const HP = 100;
const DAMAGE = {
  pistols: { body: 9, head: 30 },
  rifle: { body: 80, head: 200 },
  grenade: { body: 120, head: 120 },
  drone: { body: 150, head: 150 },
};
const ROSTERS = new Set(['adventurer', 'redpolo', 'greytee', 'checkers', 'denim', 'linen']);
const WEAPONS = new Set(['pistols', 'rifle', 'grenade', 'drone']);

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const hex = (v) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : '');

export class GameRoom extends DurableObject {
  boot() {
    if (this.booted) return;
    this.booted = true;
    this.players = new Map();
    this.round = { state: 'waiting', ends: 0 };
    this.map = '';
    this.nextSlot = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (a.id) this.adopt(ws, a);
    }
  }

  adopt(ws, a) {
    const p = {
      id: a.id,
      ws,
      name: a.name || 'player',
      color: a.color || '#f3dcb0',
      roster: ROSTERS.has(a.roster) ? a.roster : 'adventurer',
      slot: a.slot ?? this.nextSlot++,
      hp: HP,
      alive: true,
      ready: false,
      p: [0, 2, 0],
      yaw: 0,
      w: 'pistols',
    };
    this.nextSlot = Math.max(this.nextSlot, p.slot + 1);
    this.players.set(p.id, p);
    return p;
  }

  snap(p) {
    return {
      id: p.id, name: p.name, color: p.color, roster: p.roster, slot: p.slot,
      p: p.p, yaw: p.yaw, hp: p.hp, alive: p.alive, w: p.w,
    };
  }

  send(ws, payload) {
    try { ws.send(JSON.stringify(payload)); } catch { /* closed */ }
  }

  broadcast(except, payload) {
    const data = JSON.stringify(payload);
    for (const p of this.players.values()) {
      if (p.ws !== except) {
        try { p.ws.send(data); } catch { /* closed */ }
      }
    }
  }

  async fetch(request) {
    this.boot();
    if (request.headers.get('Upgrade') !== 'websocket') {
      return Response.json({
        room: this.ctx.id.toString(),
        peers: this.players.size,
        round: this.round.state,
      });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const id = crypto.randomUUID().slice(0, 8);
    const p = this.adopt(server, { id, slot: this.nextSlot });
    server.serializeAttachment({ id, slot: p.slot, name: p.name, color: p.color, roster: p.roster });
    this.broadcast(server, { t: 'join', ...this.snap(p) });
    this.send(server, {
      t: 'hello',
      id,
      slot: p.slot,
      map: this.map,
      round: this.round,
      peers: [...this.players.values()].filter((o) => o.id !== id).map((o) => this.snap(o)),
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  playerOf(ws) {
    const a = ws.deserializeAttachment() || {};
    return this.players.get(a.id) || [...this.players.values()].find((p) => p.ws === ws);
  }

  async webSocketMessage(ws, message) {
    this.boot();
    const mine = this.playerOf(ws);
    if (!mine) return;
    let msg;
    try { msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)); }
    catch { return; }

    if (msg.t === 'hello') {
      mine.name = str(msg.name, 24) || mine.name;
      mine.color = hex(msg.color) || mine.color;
      if (ROSTERS.has(msg.roster)) mine.roster = msg.roster;
      if (!this.map && typeof msg.map === 'string') this.map = msg.map.slice(0, 16);
      ws.serializeAttachment({ id: mine.id, slot: mine.slot, name: mine.name, color: mine.color, roster: mine.roster });
      this.broadcast(ws, { t: 'peer', ...this.snap(mine) });
      if (this.map) this.send(ws, { t: 'map', id: this.map });
      return;
    }

    if (msg.t === 'pose' && Array.isArray(msg.p) && msg.p.length === 3) {
      mine.p = [num(msg.p[0]), num(msg.p[1]), num(msg.p[2])];
      mine.yaw = num(msg.yaw);
      mine.spd = num(msg.spd);
      mine.g = !!msg.g;
      mine.cr = num(msg.cr);
      mine.aim = !!msg.aim;
      if (WEAPONS.has(msg.w)) mine.w = msg.w;
      this.broadcast(ws, {
        t: 'pose', id: mine.id, p: mine.p, yaw: mine.yaw, pitch: num(msg.pitch),
        spd: mine.spd, g: mine.g, cr: mine.cr, aim: mine.aim, w: mine.w,
      });
      return;
    }

    if (msg.t === 'shot') {
      if (this.round.state !== 'fight' || !mine.alive) return;
      this.broadcast(ws, { t: 'shot', id: mine.id, o: msg.o, d: msg.d, w: WEAPONS.has(msg.w) ? msg.w : mine.w });
      if (typeof msg.hid === 'string' && this.players.has(msg.hid)) {
        this.applyHit(mine, this.players.get(msg.hid), !!msg.head, WEAPONS.has(msg.w) ? msg.w : mine.w, msg.d);
      }
      return;
    }

    if (msg.t === 'nade' && Array.isArray(msg.o) && Array.isArray(msg.v)) {
      if (this.round.state !== 'fight' || !mine.alive) return;
      this.broadcast(ws, { t: 'nade', id: mine.id, o: msg.o.map(num), v: msg.v.map(num) });
      return;
    }

    if (msg.t === 'blast' && Array.isArray(msg.hits)) {
      if (this.round.state !== 'fight' || !mine.alive) return;
      for (const h of msg.hits) {
        const vic = this.players.get(h.id);
        if (!vic || !vic.alive) continue;
        const k = Math.max(0, Math.min(1, num(h.k)));
        if (k < 0.04) continue;
        this.applyHit(mine, vic, false, h.w === 'drone' ? 'drone' : 'grenade', h.dir, k);
      }
      return;
    }

    if (msg.t === 'ready') {
      mine.ready = true;
      this.tryStart();
    }
  }

  applyHit(atk, vic, head, w, dir, scale = 1) {
    if (!vic.alive || atk.id === vic.id) return;
    const dx = atk.p[0] - vic.p[0], dy = atk.p[1] - vic.p[1], dz = atk.p[2] - vic.p[2];
    if (Math.hypot(dx, dy, dz) > 220) return;
    const def = DAMAGE[w] || DAMAGE.pistols;
    const amt = Math.round((head ? def.head : def.body) * scale);
    if (amt <= 0) return;
    vic.hp = head ? 0 : Math.max(0, vic.hp - amt);
    const dead = vic.hp <= 0;
    if (dead) vic.alive = false;
    this.broadcast(null, {
      t: dead ? 'kill' : 'hit',
      vid: vic.id, aid: atk.id, amt, head: !!head, w, dir, hp: vic.hp,
    });
    if (dead) this.checkWin();
  }

  tryStart() {
    if (this.players.size < 2) return;
    if (this.round.state === 'fight' || this.round.state === 'countdown') return;
    if (![...this.players.values()].some((p) => p.ready)) return;
    for (const p of this.players.values()) {
      p.hp = HP;
      p.alive = true;
      p.ready = false;
    }
    this.round = { state: 'countdown', ends: Date.now() + 3000 };
    this.broadcast(null, {
      t: 'round',
      state: 'countdown',
      ends: this.round.ends,
      slots: Object.fromEntries([...this.players.values()].map((p) => [p.id, p.slot])),
    });
    this.ctx.setAlarm(this.round.ends);
  }

  async alarm() {
    this.boot();
    if (this.round.state === 'countdown' && Date.now() >= this.round.ends - 20) {
      this.round = { state: 'fight', ends: 0 };
      this.broadcast(null, { t: 'round', state: 'fight' });
    }
  }

  checkWin() {
    if (this.round.state !== 'fight' || this.players.size < 2) return;
    const live = [...this.players.values()].filter((p) => p.alive);
    if (live.length > 1) return;
    this.round = { state: 'over', winner: live[0]?.id || null };
    this.broadcast(null, { t: 'round', state: 'over', winner: this.round.winner });
  }

  async webSocketClose(ws) {
    this.boot();
    const mine = this.playerOf(ws);
    if (!mine) return;
    this.players.delete(mine.id);
    this.broadcast(null, { t: 'leave', id: mine.id });
    if (this.players.size < 2 && this.round.state !== 'waiting') {
      this.round = { state: 'waiting', ends: 0 };
      this.broadcast(null, { t: 'round', state: 'waiting' });
    } else {
      this.checkWin();
    }
  }
}
