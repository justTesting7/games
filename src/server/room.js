import { DurableObject } from 'cloudflare:workers';

const HP = 100;
const AWAY_MS = 60_000;
const REMATCH_MS = 4000;
const DAMAGE = {
  pistols: { body: 9, head: 30 },
  rifle: { body: 80, head: 200 },
  grenade: { body: 120, head: 120 },
  drone: { body: 150, head: 150 },
  car: { body: 200, head: 200 },
};
const ROSTERS = new Set(['adventurer', 'redpolo', 'greytee', 'checkers', 'denim', 'linen']);
const WEAPONS = new Set(['pistols', 'rifle', 'grenade', 'drone']);
const MAPS = new Set(['island', 'city', 'garden']);
const clampMin = (v) => {
  const n = Math.round(num(v));
  return Number.isFinite(n) ? Math.max(2, Math.min(12, n)) : 2;
};

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const hex = (v) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : '');

export class GameRoom extends DurableObject {
  async boot() {
    if (this.booted) return;
    this.booted = true;
    this.players = new Map();
    this.round = (await this.ctx.storage.get('round')) || { state: 'waiting', ends: 0 };
    this.settings = (await this.ctx.storage.get('settings')) || { map: '', time: null, min: 2 };
    this.settings.min = clampMin(this.settings.min);
    this.map = this.settings.map || (await this.ctx.storage.get('map')) || '';
    this.hostId = (await this.ctx.storage.get('hostId')) || '';
    this.nextSlot = 0;
    this.fleet = Array.from({ length: 8 }, () => null);
    this.seats = Array(8).fill(null);
    const saved = (await this.ctx.storage.get('players')) || {};
    for (const [id, rec] of Object.entries(saved)) {
      this.adopt(null, { ...rec, id, away: true, awayAt: rec.awayAt || Date.now() });
    }
    if (this.hostId && !this.players.has(this.hostId)) this.hostId = this.firstSeat()?.id || '';
  }

  firstSeat() {
    return [...this.players.values()].find((p) => !p.away) || [...this.players.values()][0] || null;
  }

  seated() {
    return this.players.size;
  }

  async persist() {
    await this.ctx.storage.put('round', this.round);
    await this.ctx.storage.put('settings', { map: this.map, time: this.settings.time ?? null, min: this.minPlayers() });
    if (this.map) await this.ctx.storage.put('map', this.map);
    if (this.hostId) await this.ctx.storage.put('hostId', this.hostId);
    const pack = {};
    for (const p of this.players.values()) {
      pack[p.id] = {
        id: p.id, name: p.name, color: p.color, roster: p.roster, slot: p.slot,
        hp: p.hp, alive: p.alive, ready: p.ready, p: p.p, yaw: p.yaw, w: p.w, drone: p.drone,
        away: !!p.away, awayAt: p.awayAt || 0,
      };
    }
    await this.ctx.storage.put('players', pack);
  }

  adopt(ws, a) {
    const p = {
      id: a.id,
      ws: ws || null,
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
      car: Number.isFinite(a.car) ? a.car : null,
      away: !!a.away && !ws,
      awayAt: a.awayAt || 0,
    };
    this.nextSlot = Math.max(this.nextSlot, p.slot + 1);
    this.players.set(p.id, p);
    return p;
  }

  snap(p) {
    return {
      id: p.id, name: p.name, color: p.color, roster: p.roster, slot: p.slot,
      p: p.p, yaw: p.yaw, hp: p.hp, alive: p.alive, w: p.w, drone: p.drone || undefined,
      car: Number.isFinite(p.car) ? p.car : undefined,
      away: !!p.away,
    };
  }

  send(ws, payload) {
    if (!ws) return;
    try { ws.send(JSON.stringify(payload)); } catch { /* closed */ }
  }

  broadcast(except, payload) {
    const data = JSON.stringify(payload);
    for (const p of this.players.values()) {
      if (!p.ws || p.ws === except) continue;
      try { p.ws.send(data); } catch { /* closed */ }
    }
  }

  minPlayers() {
    return clampMin(this.settings.min);
  }

  packSettings() {
    return { map: this.map, time: this.settings.time, min: this.minPlayers() };
  }

  packFleet() {
    return this.fleet.map((c, i) => (c ? { i, ...c } : null)).filter(Boolean);
  }

  freeSeat(id) {
    if (!this.seats) return;
    for (let i = 0; i < this.seats.length; i++) {
      if (this.seats[i] === id) this.seats[i] = null;
    }
  }

  takeHostSettings(msg) {
    if (MAPS.has(msg.map)) this.map = msg.map;
    if (Number.isFinite(+msg.time)) this.settings.time = Math.max(0, Math.min(1, +msg.time));
    if (msg.min != null && Number.isFinite(+msg.min)) this.settings.min = clampMin(msg.min);
  }

  settingsPayload() {
    return { t: 'settings', ...this.packSettings(), hostId: this.hostId };
  }

  async fetch(request) {
    await this.boot();
    await this.ensureFight();
    await this.ensureRematch();
    await this.sweepAway();
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') !== 'websocket') {
      return Response.json({
        room: this.ctx.id.toString(),
        peers: this.players.size,
        round: this.round.state,
        hostId: this.hostId,
        settings: this.packSettings(),
      });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Regular accept(), not ctx.acceptWebSocket(). Hibernation bills every
    // incoming pose as a Durable Object request; a match at 15 Hz burns the
    // free daily quota in about an hour. Gameplay sockets stay awake instead.
    server.accept();
    server.addEventListener('message', (event) => {
      this.webSocketMessage(server, event.data).catch(() => {});
    });
    server.addEventListener('close', () => {
      this.webSocketClose(server).catch(() => {});
    });
    server.addEventListener('error', () => {
      this.webSocketClose(server).catch(() => {});
    });
    const resume = str(url.searchParams.get('resume'), 8);
    const existing = resume && this.players.get(resume);
    if (existing) {
      existing.ws = server;
      existing.away = false;
      existing.awayAt = 0;
      this.broadcast(server, { t: 'back', id: existing.id });
      this.send(server, {
        t: 'hello',
        id: existing.id,
        slot: existing.slot,
        map: this.map,
        host: existing.id === this.hostId,
        hostId: this.hostId,
        settings: this.packSettings(),
        round: this.round,
        cars: this.packFleet(),
        peers: [...this.players.values()].filter((o) => o.id !== existing.id).map((o) => this.snap(o)),
      });
      await this.persist();
      return new Response(null, { status: 101, webSocket: client });
    }
    const id = crypto.randomUUID().slice(0, 8);
    const p = this.adopt(server, { id });
    if (!this.hostId || !this.players.has(this.hostId)) this.hostId = id;
    this.broadcast(server, { t: 'join', ...this.snap(p) });
    this.send(server, {
      t: 'hello',
      id,
      slot: p.slot,
      map: this.map,
      host: id === this.hostId,
      hostId: this.hostId,
      settings: this.packSettings(),
      round: this.round,
      cars: this.packFleet(),
      peers: [...this.players.values()].filter((o) => o.id !== id).map((o) => this.snap(o)),
    });
    await this.persist();
    await this.tryStart();
    return new Response(null, { status: 101, webSocket: client });
  }

  playerOf(ws) {
    return [...this.players.values()].find((p) => p.ws === ws);
  }

  isHost(p) {
    return !!p && p.id === this.hostId;
  }

  async webSocketMessage(ws, message) {
    await this.boot();
    const mine = this.playerOf(ws);
    if (!mine) return;
    mine.away = false;
    let msg;
    try { msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)); }
    catch { return; }
    await this.ensureFight();
    await this.ensureRematch();

    if (msg.t === 'hello') {
      mine.name = str(msg.name, 24) || mine.name;
      mine.color = hex(msg.color) || mine.color;
      if (ROSTERS.has(msg.roster)) mine.roster = msg.roster;
      if (this.isHost(mine) && this.round.state !== 'fight' && this.round.state !== 'countdown') {
        this.takeHostSettings(msg);
      }
      this.broadcast(ws, { t: 'peer', ...this.snap(mine) });
      this.send(ws, this.settingsPayload());
      this.broadcast(null, this.settingsPayload());
      await this.persist();
      return;
    }

    if (msg.t === 'settings') {
      if (!this.isHost(mine) || this.round.state === 'fight' || this.round.state === 'countdown') return;
      this.takeHostSettings(msg);
      this.broadcast(null, this.settingsPayload());
      await this.persist();
      await this.tryStart();
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
      if (msg.car === null) mine.car = null;
      else if (Number.isFinite(+msg.car)) mine.car = Math.max(0, Math.min(7, Math.round(+msg.car)));
      this.broadcast(ws, {
        t: 'pose', id: mine.id, p: mine.p, yaw: mine.yaw, pitch: num(msg.pitch),
        spd: mine.spd, g: mine.g, cr: mine.cr, aim: mine.aim, w: mine.w,
        alive: mine.alive, hp: mine.hp,
        car: Number.isFinite(mine.car) ? mine.car : null,
      });
      return;
    }

    if (msg.t === 'shot') {
      if (this.round.state !== 'fight' || !mine.alive) return;
      const o = Array.isArray(msg.o) ? msg.o.slice(0, 3).map(num) : [mine.p[0], mine.p[1] + 1.4, mine.p[2]];
      const d = Array.isArray(msg.d) ? msg.d.slice(0, 3).map(num) : [Math.sin(mine.yaw || 0), 0, Math.cos(mine.yaw || 0)];
      this.broadcast(ws, { t: 'shot', id: mine.id, n: num(msg.n), o, d, w: WEAPONS.has(msg.w) ? msg.w : mine.w });
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

    if (msg.t === 'car') {
      await this.onCar(mine, ws, msg);
      return;
    }

    if (msg.t === 'runover' && typeof msg.hid === 'string') {
      if (this.round.state !== 'fight' || !mine.alive) return;
      const vic = this.players.get(msg.hid);
      if (!vic || !vic.alive) return;
      await this.applyHit(mine, vic, false, 'car', msg.dir);
      return;
    }

    if (msg.t === 'ready') {
      mine.ready = true;
      await this.persist();
      await this.tryStart();
    }
  }

  async onCar(mine, ws, msg) {
    const i = Math.round(num(msg.i));
    if (i < 0 || i > 7) return;
    const act = str(msg.a, 8);
    const p = Array.isArray(msg.p) ? msg.p.slice(0, 3).map(num) : mine.p;
    const yaw = num(msg.yaw);
    const spd = num(msg.spd);
    if (act === 'in') {
      if (this.seats[i] && this.seats[i] !== mine.id) return;
      this.freeSeat(mine.id);
      this.seats[i] = mine.id;
      mine.car = i;
    } else if (act === 'out') {
      if (this.seats[i] === mine.id) this.seats[i] = null;
      if (mine.car === i) mine.car = null;
    } else if (act === 'pose') {
      if (this.seats[i] !== mine.id) return;
    } else {
      return;
    }
    this.fleet[i] = { p, yaw, spd: act === 'out' ? 0 : spd };
    this.broadcast(ws, { t: 'car', a: act, id: mine.id, i, p, yaw, spd: this.fleet[i].spd });
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

  async tryStart({ rematch = false } = {}) {
    if (this.players.size < this.minPlayers()) {
      if (rematch || this.round.state === 'over') {
        this.round = { state: 'waiting', ends: 0 };
        this.broadcast(null, { t: 'round', state: 'waiting' });
        await this.persist();
      }
      return;
    }
    if (this.round.state === 'fight' || this.round.state === 'countdown') return;
    if (this.round.state === 'over' && !rematch) return;
    if (!rematch && ![...this.players.values()].some((p) => p.ready && !p.away)) return;
    for (const p of this.players.values()) {
      p.hp = HP;
      p.alive = true;
      p.ready = false;
      p.drone = null;
      p.car = null;
    }
    this.fleet = Array.from({ length: 8 }, () => null);
    this.seats = Array(8).fill(null);
    this.round = { state: 'countdown', ends: Date.now() + 3000 };
    this.broadcast(null, {
      t: 'round',
      state: 'countdown',
      ends: this.round.ends,
      slots: Object.fromEntries([...this.players.values()].map((p) => [p.id, p.slot])),
      peers: [...this.players.values()].map((p) => this.snap(p)),
      cars: [],
    });
    await this.persist();
    await this.armAlarm(this.round.ends);
  }

  async ensureFight() {
    if (this.round.state !== 'countdown' || Date.now() < this.round.ends) return;
    this.round = { state: 'fight', ends: 0 };
    this.broadcast(null, { t: 'round', state: 'fight' });
    await this.persist();
  }

  async ensureRematch() {
    if (this.round.state !== 'over' || !this.round.rematchAt) return;
    if (Date.now() < this.round.rematchAt) return;
    await this.tryStart({ rematch: true });
  }

  async armAlarm(at) {
    const next = await this.nextAlarm(at);
    if (next) await this.ctx.storage.setAlarm(next);
  }

  async nextAlarm(extra) {
    let next = extra || 0;
    if (this.round.state === 'countdown' && this.round.ends) next = next ? Math.min(next, this.round.ends) : this.round.ends;
    if (this.round.state === 'over' && this.round.rematchAt) next = next ? Math.min(next, this.round.rematchAt) : this.round.rematchAt;
    for (const p of this.players.values()) {
      if (!p.away || !p.awayAt) continue;
      const until = p.awayAt + AWAY_MS;
      next = next ? Math.min(next, until) : until;
    }
    return next || 0;
  }

  async alarm() {
    await this.boot();
    await this.ensureFight();
    await this.ensureRematch();
    await this.sweepAway();
    await this.armAlarm();
  }

  async sweepAway() {
    const now = Date.now();
    const expired = [...this.players.values()].filter((p) => p.away && p.awayAt && now >= p.awayAt + AWAY_MS);
    for (const p of expired) await this.drop(p);
  }

  async drop(p) {
    this.freeSeat(p.id);
    this.players.delete(p.id);
    this.broadcast(null, { t: 'leave', id: p.id });
    if (p.id === this.hostId) {
      this.hostId = this.firstSeat()?.id || '';
      if (this.hostId) this.broadcast(null, this.settingsPayload());
    }
    if (this.players.size === 0) {
      this.hostId = '';
      this.map = '';
      this.settings = { map: '', time: null, min: 2 };
      this.round = { state: 'waiting', ends: 0 };
    } else if (this.players.size < 2 && this.round.state !== 'waiting') {
      this.round = { state: 'waiting', ends: 0 };
      this.broadcast(null, { t: 'round', state: 'waiting' });
    } else {
      await this.checkWin();
    }
    await this.persist();
  }

  async checkWin() {
    if (this.round.state !== 'fight' || this.players.size < 2) return;
    const live = [...this.players.values()].filter((p) => p.alive);
    if (live.length > 1) return;
    this.round = { state: 'over', winner: live[0]?.id || null, rematchAt: Date.now() + REMATCH_MS };
    this.broadcast(null, { t: 'round', state: 'over', winner: this.round.winner, rematchAt: this.round.rematchAt });
    await this.persist();
    await this.armAlarm(this.round.rematchAt);
  }

  async webSocketClose(ws) {
    await this.boot();
    const mine = this.playerOf(ws);
    if (!mine || (mine.ws && mine.ws !== ws)) return;
    mine.ws = null;
    mine.away = true;
    mine.awayAt = Date.now();
    this.broadcast(null, { t: 'away', id: mine.id, until: mine.awayAt + AWAY_MS });
    await this.persist();
    await this.armAlarm(mine.awayAt + AWAY_MS);
  }
}
