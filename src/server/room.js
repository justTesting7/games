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
  async boot() {
    if (this.booted) return;
    this.booted = true;
    this.players = new Map();
    this.round = (await this.ctx.storage.get('round')) || { state: 'waiting', ends: 0 };
    this.map = (await this.ctx.storage.get('map')) || '';
    this.nextSlot = 0;
    const saved = (await this.ctx.storage.get('players')) || {};
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (a.id) this.adopt(ws, { ...saved[a.id], ...a });
    }
  }

  async persist() {
    await this.ctx.storage.put('round', this.round);
    if (this.map) await this.ctx.storage.put('map', this.map);
    const pack = {};
    for (const p of this.players.values()) {
      pack[p.id] = {
        id: p.id, name: p.name, color: p.color, roster: p.roster, slot: p.slot,
        hp: p.hp, alive: p.alive, ready: p.ready, p: p.p, yaw: p.yaw, w: p.w, drone: p.drone,
      };
    }
    await this.ctx.storage.put('players', pack);
  }

  adopt(ws, a) {
    const p = {
      id: a.id,
      ws,
      name: a.name || 'player',
      color: a.color || '#f3dcb0',
      roster: ROSTERS.has(a.roster) ? a.roster : 'adventurer',
      slot: Number.isFinite(a.slot) ? a.slot : this.nextSlot++,
      hp: Number.isFinite(a.hp) ? a.hp : HP,
      alive: a.alive !== false,
      ready: !!a.ready,
      p: Array.isArray(a.p) ? a.p : [0, 2, 0],
      yaw: a.yaw || 0,
      w: WEAPONS.has(a.w) ? a.w : 'pistols',
      drone: a.drone || null,
    };
    this.nextSlot = Math.max(this.nextSlot, p.slot + 1);
    this.players.set(p.id, p);
    return p;
  }

  snap(p) {
    return {
      id: p.id, name: p.name, color: p.color, roster: p.roster, slot: p.slot,
      p: p.p, yaw: p.yaw, hp: p.hp, alive: p.alive, w: p.w, drone: p.drone || undefined,
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
    await this.boot();
    await this.ensureFight();
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
    const p = this.adopt(server, { id });
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
    await this.persist();
    await this.tryStart();
    return new Response(null, { status: 101, webSocket: client });
  }

  playerOf(ws) {
    const a = ws.deserializeAttachment() || {};
    return this.players.get(a.id) || [...this.players.values()].find((p) => p.ws === ws);
  }

  async webSocketMessage(ws, message) {
    await this.boot();
    const mine = this.playerOf(ws);
    if (!mine) return;
    let msg;
    try { msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)); }
    catch { return; }
    await this.ensureFight();

    if (msg.t === 'hello') {
      mine.name = str(msg.name, 24) || mine.name;
      mine.color = hex(msg.color) || mine.color;
      if (ROSTERS.has(msg.roster)) mine.roster = msg.roster;
      if (!this.map && typeof msg.map === 'string') this.map = msg.map.slice(0, 16);
      ws.serializeAttachment({ id: mine.id, slot: mine.slot, name: mine.name, color: mine.color, roster: mine.roster });
      this.broadcast(ws, { t: 'peer', ...this.snap(mine) });
      if (this.map) this.send(ws, { t: 'map', id: this.map });
      await this.persist();
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
        await this.applyHit(mine, this.players.get(msg.hid), !!msg.head, WEAPONS.has(msg.w) ? msg.w : mine.w, msg.d);
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
        await this.applyHit(mine, vic, false, h.w === 'drone' ? 'drone' : 'grenade', h.dir, k);
      }
      return;
    }

    if (msg.t === 'drone') {
      if (this.round.state !== 'fight' || !mine.alive) return;
      await this.onDrone(mine, ws, msg);
      return;
    }

    if (msg.t === 'ready') {
      mine.ready = true;
      await this.persist();
      await this.tryStart();
    }
  }

  async onDrone(mine, ws, msg) {
    const act = str(msg.a, 8);
    const p = Array.isArray(msg.p) ? msg.p.slice(0, 3).map(num) : null;
    if (act === 'go' || act === 'pose') {
      if (!p) return;
      mine.drone = { p, yaw: num(msg.yaw), pitch: num(msg.pitch) };
      this.broadcast(ws, { t: 'drone', a: act, id: mine.id, p, yaw: mine.drone.yaw, pitch: mine.drone.pitch });
      return;
    }
    if (act === 'boom') {
      mine.drone = null;
      this.broadcast(ws, { t: 'drone', a: 'boom', id: mine.id, p, reason: str(msg.reason, 12) });
      return;
    }
    if (act === 'down') {
      const owner = this.players.get(str(msg.id, 8)) || mine;
      owner.drone = null;
      this.broadcast(null, {
        t: 'drone', a: 'down', id: owner.id, aid: mine.id, p, dir: Array.isArray(msg.dir) ? msg.dir.slice(0, 3).map(num) : undefined,
      });
    }
  }

  async applyHit(atk, vic, head, w, dir, scale = 1) {
    const splash = w === 'grenade' || w === 'drone';
    if (!vic.alive || (atk.id === vic.id && !splash)) return;
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
    if (dead) await this.checkWin();
    else await this.persist();
  }

  async tryStart() {
    if (this.players.size < 2) return;
    if (this.round.state === 'fight' || this.round.state === 'countdown') return;
    if (![...this.players.values()].some((p) => p.ready)) return;
    for (const p of this.players.values()) {
      p.hp = HP;
      p.alive = true;
      p.ready = false;
      p.drone = null;
    }
    this.round = { state: 'countdown', ends: Date.now() + 3000 };
    this.broadcast(null, {
      t: 'round',
      state: 'countdown',
      ends: this.round.ends,
      slots: Object.fromEntries([...this.players.values()].map((p) => [p.id, p.slot])),
      peers: [...this.players.values()].map((p) => this.snap(p)),
    });
    await this.persist();
    await this.ctx.storage.setAlarm(this.round.ends);
  }

  async ensureFight() {
    if (this.round.state !== 'countdown' || Date.now() < this.round.ends) return;
    this.round = { state: 'fight', ends: 0 };
    this.broadcast(null, { t: 'round', state: 'fight' });
    await this.persist();
  }

  async alarm() {
    await this.boot();
    await this.ensureFight();
  }

  async checkWin() {
    if (this.round.state !== 'fight' || this.players.size < 2) return;
    const live = [...this.players.values()].filter((p) => p.alive);
    if (live.length > 1) return;
    this.round = { state: 'over', winner: live[0]?.id || null };
    this.broadcast(null, { t: 'round', state: 'over', winner: this.round.winner });
    await this.persist();
  }

  async webSocketClose(ws) {
    await this.boot();
    const mine = this.playerOf(ws);
    if (!mine) return;
    this.players.delete(mine.id);
    this.broadcast(null, { t: 'leave', id: mine.id });
    if (this.players.size < 2 && this.round.state !== 'waiting') {
      this.round = { state: 'waiting', ends: 0 };
      this.broadcast(null, { t: 'round', state: 'waiting' });
    } else {
      await this.checkWin();
    }
    await this.persist();
  }
}
