'use strict';

const config = require('../config');
const {
  createBullet,
  createSaucer,
  createFloorBlob,
  clampAngle,
} = require('./entities');

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

class Simulation {
  constructor() {
    this.world = { ...config.world };
    this.settings = { ...config.defaults };
    this.phase = 'lobby'; // lobby | countdown | playing | results
    this.timeLeft = config.roundDurationSec;
    this.countdown = 0;
    this.tick = 0;
    this.players = new Map(); // id -> player
    this.bullets = [];
    this.saucers = [];
    this.blobs = [];
    this.events = [];
    this.spawnAcc = 0;
    this.results = null;
    this.winner = null;
    this._seatDefaults();
  }

  _seatDefaults() {
    this.seatSlots = [];
    for (let i = 0; i < config.maxPlayers; i++) {
      const spacing = this.world.width / (config.maxPlayers + 1);
      this.seatSlots.push({
        seat: i,
        color: config.playerColors[i],
        name: config.playerNames[i],
        defaultX: spacing * (i + 1),
      });
    }
  }

  _emptyHits() {
    return {}; // targetKey -> { name, points, qty, total }
  }

  resetMatchKeepPlayers() {
    this.bullets = [];
    this.saucers = [];
    this.blobs = [];
    this.events = [];
    this.spawnAcc = 0;
    this.results = null;
    this.winner = null;
    this.timeLeft = config.roundDurationSec;
    this.countdown = 0;
    for (const p of this.players.values()) {
      p.score = 0;
      p.fireCooldown = 0;
      p.shooting = false;
      p.angle = 0;
      p.hits = this._emptyHits();
      const slot = this.seatSlots[p.seat];
      if (slot) p.x = slot.defaultX;
    }
  }

  fullReset() {
    this.phase = 'lobby';
    this.resetMatchKeepPlayers();
  }

  applySettings(partial = {}) {
    if (partial.bulletSpeed != null) {
      this.settings.bulletSpeed = clamp(Number(partial.bulletSpeed), 120, 1200);
    }
    if (partial.fireRate != null) {
      // allow fractional rates (e.g. 1.25 = 800ms)
      this.settings.fireRate = clamp(Number(partial.fireRate), 0.5, 20);
    }
    if (partial.fireIntervalMs != null) {
      const ms = clamp(Number(partial.fireIntervalMs), 50, 5000);
      this.settings.fireIntervalMs = ms;
      this.settings.fireRate = 1000 / ms;
    }
    if (partial.spawnRate != null) {
      this.settings.spawnRate = clamp(Number(partial.spawnRate), 0.2, 4);
    }
    if (partial.maxSaucers != null) {
      this.settings.maxSaucers = clamp(Number(partial.maxSaucers), 4, 40);
    }
  }

  addPlayer(preferredName) {
    if (this.players.size >= config.maxPlayers) return null;
    const used = new Set([...this.players.values()].map((p) => p.seat));
    let seat = -1;
    for (let i = 0; i < config.maxPlayers; i++) {
      if (!used.has(i)) {
        seat = i;
        break;
      }
    }
    if (seat < 0) return null;
    const slot = this.seatSlots[seat];
    const id = `p_${seat}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e3)}`;
    const player = {
      id,
      seat,
      color: slot.color,
      name: (preferredName && String(preferredName).slice(0, 16)) || slot.name,
      x: slot.defaultX,
      angle: 0,
      score: 0,
      shooting: false,
      fireCooldown: 0,
      connected: true,
      hits: this._emptyHits(),
    };
    this.players.set(id, player);
    return player;
  }

  removePlayer(id) {
    this.players.delete(id);
    this.bullets = this.bullets.filter((b) => b.ownerId !== id);
  }

  setInput(id, input = {}) {
    const p = this.players.get(id);
    if (!p) return;
    const slot = this.seatSlots[p.seat];
    if (slot) p.x = slot.defaultX;
    if (input.angle != null && Number.isFinite(Number(input.angle))) {
      p.angle = clampAngle(Number(input.angle));
    }
    if (typeof input.shooting === 'boolean') {
      p.shooting = input.shooting;
    }
  }

  startCountdown() {
    if (this.players.size < 1) return false;
    this.resetMatchKeepPlayers();
    this.phase = 'countdown';
    this.countdown = config.countdownSec;
    this.events.push({ type: 'countdown', value: this.countdown });
    return true;
  }

  endRound() {
    if (this.phase !== 'playing' && this.phase !== 'countdown') return;
    this.phase = 'results';
    this.results = this._ranking();
    this.winner = this.results.length ? this.results[0] : null;
    // ties: mark all top score as co-winners in winner payload
    if (this.winner && this.results.length > 1) {
      const top = this.winner.score;
      const tied = this.results.filter((r) => r.score === top);
      if (tied.length > 1) {
        this.winner = {
          ...this.winner,
          tie: true,
          names: tied.map((t) => t.name),
          ids: tied.map((t) => t.id),
        };
      }
    }
    this.events.push({
      type: 'roundEnd',
      ranking: this.results,
      winner: this.winner,
    });
  }

  _recordHit(player, saucer) {
    if (!player.hits) player.hits = this._emptyHits();
    const key = saucer.personId || saucer.name;
    if (!player.hits[key]) {
      player.hits[key] = {
        name: saucer.name,
        points: saucer.points,
        qty: 0,
        total: 0,
      };
    }
    player.hits[key].qty += 1;
    player.hits[key].total += saucer.points;
    player.hits[key].points = saucer.points; // per-unit value
    player.score += saucer.points;
  }

  _hitsList(player) {
    if (!player.hits) return [];
    return Object.values(player.hits).sort(
      (a, b) => b.total - a.total || b.qty - a.qty || a.name.localeCompare(b.name)
    );
  }

  _ranking() {
    return [...this.players.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        seat: p.seat,
        score: p.score,
        hits: this._hitsList(p),
      }))
      .sort((a, b) => b.score - a.score || a.seat - b.seat);
  }

  /** 4 fixed seat columns for admin UI */
  playerColumns() {
    const bySeat = new Map([...this.players.values()].map((p) => [p.seat, p]));
    const cols = [];
    for (let seat = 0; seat < config.maxPlayers; seat++) {
      const p = bySeat.get(seat);
      if (!p) {
        cols.push({
          seat,
          empty: true,
          name: `Seat ${seat + 1}`,
          color: config.playerColors[seat],
          score: 0,
          hits: [],
        });
        continue;
      }
      cols.push({
        seat,
        empty: false,
        id: p.id,
        name: p.name,
        color: p.color,
        score: p.score,
        hits: this._hitsList(p),
      });
    }
    return cols;
  }

  step(dt) {
    this.tick += 1;
    this.events = [];

    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = 'playing';
        this.timeLeft = config.roundDurationSec;
        this.events.push({ type: 'roundStart' });
      }
      this._updateDyingOnly(dt);
      return;
    }

    if (this.phase !== 'playing') {
      this._updateDyingOnly(dt);
      return;
    }

    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.endRound();
      return;
    }

    this._fireGuns(dt);
    this._updateBullets(dt);
    this._spawnSaucers(dt);
    this._updateSaucers(dt);
    this._collide();
  }

  _fireGuns(dt) {
    const intervalMs = this.settings.fireIntervalMs || 1000;
    const interval = intervalMs / 1000;
    const maxBullets = this.settings.maxBulletsPerPlayer || 2;
    for (const p of this.players.values()) {
      p.fireCooldown = Math.max(0, p.fireCooldown - dt);
      if (!p.shooting || p.fireCooldown > 0) continue;
      const live = this.bullets.filter((b) => b.ownerId === p.id).length;
      if (live >= maxBullets) continue;
      const muzzleX = p.x;
      const muzzleY = this.world.gunY - 18;
      this.bullets.push(
        createBullet(
          p.id,
          muzzleX,
          muzzleY,
          p.angle,
          this.settings.bulletSpeed,
          this.settings.bulletRadius
        )
      );
      p.fireCooldown = interval;
      this.events.push({ type: 'shot', playerId: p.id, x: muzzleX, y: muzzleY });
    }
  }

  _updateBullets(dt) {
    const w = this.world;
    const next = [];
    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) continue;
      if (b.x < -20 || b.x > w.width + 20 || b.y < -20 || b.y > w.floorY + 10) continue;
      next.push(b);
    }
    this.bullets = next;
  }

  _spawnSaucers(dt) {
    this.spawnAcc += dt * this.settings.spawnRate;
    while (
      this.spawnAcc >= 1 &&
      this.saucers.filter((s) => s.state === 'alive').length < this.settings.maxSaucers
    ) {
      this.spawnAcc -= 1;
      this.saucers.push(createSaucer(this.world, this.settings));
    }
    if (this.spawnAcc > 3) this.spawnAcc = 3;
  }

  _updateSaucers(dt) {
    const next = [];
    for (const s of this.saucers) {
      if (s.state === 'alive') {
        const res = s.path.step(dt);
        s.x = res.x;
        s.y = res.y;
        // spin phase for 3D rim animation (radians)
        s.spin = (s.spin || 0) + dt * 4.2;
        s.rot = 0; // body stays level while flying
        if (!res.out) next.push(s);
        continue;
      }
      if (s.state === 'dying') {
        s.dieT += dt;
        const t = s.dieT;
        s.x = s.dieX + Math.sin(t * s.dieSpin) * (40 * Math.exp(-t * 1.2));
        s.y = s.dieY + t * t * 280 + t * 40;
        // tumble / rotate while falling (slow spin)
        s.rot = (s.rot || 0) + s.dieSpin * dt * 1.05;
        s.spin = (s.spin || 0) + dt * 3.2;
        // remove when off floor — no floor blob
        if (s.y >= this.world.floorY + 20) {
          continue;
        }
        next.push(s);
      }
    }
    this.saucers = next;
  }

  _updateDyingOnly(dt) {
    this._updateSaucers(dt);
  }

  _collide() {
    if (!this.bullets.length || !this.saucers.length) return;
    const remainingBullets = [];
    for (const b of this.bullets) {
      let hit = false;
      for (const s of this.saucers) {
        if (s.state !== 'alive') continue;
        const r = b.r + s.r * 0.85;
        if (dist2(b.x, b.y, s.x, s.y) <= r * r) {
          hit = true;
          s.state = 'dying';
          s.dieT = 0;
          s.dieX = s.x;
          s.dieY = s.y;
          s.killerId = b.ownerId;
          const p = this.players.get(b.ownerId);
          if (p) this._recordHit(p, s);
          this.events.push({
            type: 'hit',
            saucerId: s.id,
            playerId: b.ownerId,
            x: s.x,
            y: s.y,
            points: s.points,
            name: s.name,
          });
          break;
        }
      }
      if (!hit) remainingBullets.push(b);
    }
    this.bullets = remainingBullets;
  }

  /**
   * @param {{ full?: boolean }} [opts]
   * full=false (default): slim packet for players — no hit tables / columns every tick
   * full=true: include hits + columns (admin / results)
   */
  snapshot(opts = {}) {
    const full = !!opts.full || this.phase === 'results';
    const players = [...this.players.values()].map((p) => {
      const row = {
        id: p.id,
        seat: p.seat,
        name: p.name,
        color: p.color,
        x: round2(p.x),
        angle: round2(p.angle),
        score: p.score,
        shooting: p.shooting,
      };
      if (full) row.hits = this._hitsList(p);
      return row;
    });

    const snap = {
      type: 'state',
      t: this.tick,
      phase: this.phase,
      timeLeft: round2(this.timeLeft),
      countdown: round2(Math.max(0, this.countdown)),
      // world is tiny and required by the renderer every frame
      world: {
        width: this.world.width,
        height: this.world.height,
        floorY: this.world.floorY,
        gunY: this.world.gunY,
      },
      players,
      saucers: this.saucers.map((s) => ({
        id: s.id,
        x: round2(s.x),
        y: round2(s.y),
        r: s.r,
        rot: round2(s.rot || 0),
        spin: round2(s.spin || 0),
        name: s.name,
        points: s.points,
        face: s.face,
        state: s.state,
      })),
      bullets: this.bullets.map((b) => ({
        id: b.id,
        x: round2(b.x),
        y: round2(b.y),
        r: b.r,
        ownerId: b.ownerId,
        vx: round2(b.vx),
        vy: round2(b.vy),
      })),
      events: this.events,
      results: this.phase === 'results' ? this.results : null,
      winner: this.phase === 'results' ? this.winner : null,
    };

    if (full) {
      snap.columns = this.playerColumns();
      snap.settings = {
        bulletSpeed: this.settings.bulletSpeed,
        fireRate: this.settings.fireRate,
        fireIntervalMs: this.settings.fireIntervalMs || 1000,
        spawnRate: this.settings.spawnRate,
      };
    }

    return snap;
  }

  lobbyPayload() {
    return {
      type: 'lobby',
      phase: this.phase,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        seat: p.seat,
        name: p.name,
        color: p.color,
        score: p.score,
      })),
      maxPlayers: config.maxPlayers,
      settings: { ...this.settings },
      columns: this.playerColumns(),
    };
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { Simulation };
