'use strict';

const config = require('./config');
const { Simulation } = require('./game/simulation');
const { loadRoster, listTargets, addTarget, removeTarget } = require('./game/roster');

class Room {
  constructor() {
    this.sim = new Simulation();
    this.clients = new Map(); // ws -> { role, playerId }
    this.admins = new Set();
    this.tickMs = 1000 / config.tickRate;
    this._last = Date.now();
    this._timer = null;
  }

  startLoop() {
    if (this._timer) return;
    this._last = Date.now();
    this._timer = setInterval(() => this._onTick(), this.tickMs);
  }

  stopLoop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _onTick() {
    const now = Date.now();
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.1) dt = 0.1;
    this.sim.step(dt);

    // Slim packets for players; full (hits/columns) only for admins — cuts JSON + CPU a lot
    const slim = this.sim.snapshot({ full: false });
    const slimRaw = JSON.stringify(slim);

    let fullRaw = null;
    const needFull =
      this.admins.size > 0 || slim.phase === 'results' || slim.phase === 'countdown';
    if (needFull) {
      fullRaw = JSON.stringify(this.sim.snapshot({ full: true }));
    }

    for (const [ws, meta] of this.clients) {
      if (ws.readyState !== 1) continue;
      if (meta.role === 'admin') {
        ws.send(fullRaw || slimRaw);
      } else {
        // players get full only on results so scoreboard has hits
        ws.send(slim.phase === 'results' && fullRaw ? fullRaw : slimRaw);
      }
    }
  }

  send(ws, obj) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(obj));
    }
  }

  broadcast(obj, filterFn) {
    const raw = JSON.stringify(obj);
    for (const [ws, meta] of this.clients) {
      if (filterFn && !filterFn(meta, ws)) continue;
      if (ws.readyState === 1) ws.send(raw);
    }
  }

  _targetsPayload() {
    return { type: 'targets', targets: listTargets() };
  }

  broadcastTargets() {
    this.broadcast(this._targetsPayload());
  }

  handleConnect(ws) {
    this.clients.set(ws, { role: null, playerId: null });
    this.startLoop();
    this.send(ws, {
      type: 'hello',
      message: 'SR Shooter 2',
      config: {
        world: this.sim.world,
        maxPlayers: config.maxPlayers,
        roundDurationSec: config.roundDurationSec,
      },
      rosterCount: loadRoster().length,
    });
  }

  handleMessage(ws, data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'join':
        this._join(ws, msg);
        break;
      case 'leave':
        this._leave(ws);
        break;
      case 'input':
        this._input(ws, msg);
        break;
      case 'admin':
        this._admin(ws, msg);
        break;
      case 'ping':
        this.send(ws, { type: 'pong', t: msg.t || Date.now() });
        break;
      default:
        break;
    }
  }

  handleClose(ws) {
    const meta = this.clients.get(ws);
    if (!meta) return;
    if (meta.role === 'player' && meta.playerId) {
      this.sim.removePlayer(meta.playerId);
      this.broadcast(this.sim.lobbyPayload());
    }
    if (meta.role === 'admin') {
      this.admins.delete(ws);
    }
    this.clients.delete(ws);
  }

  _join(ws, msg) {
    const meta = this.clients.get(ws);
    if (!meta) return;

    if (meta.role === 'player' && meta.playerId) {
      this.sim.removePlayer(meta.playerId);
    }
    if (meta.role === 'admin') {
      this.admins.delete(ws);
    }

    const role = msg.role === 'admin' ? 'admin' : 'player';

    if (role === 'admin') {
      meta.role = 'admin';
      meta.playerId = null;
      this.admins.add(ws);
      this.send(ws, {
        type: 'welcome',
        role: 'admin',
        settings: this.sim.settings,
        phase: this.sim.phase,
        targets: listTargets(),
      });
      this.send(ws, this.sim.lobbyPayload());
      this.send(ws, this.sim.snapshot({ full: true }));
      return;
    }

    if (this.sim.players.size >= config.maxPlayers) {
      this.send(ws, { type: 'error', message: 'Lobby full (max 4 players)' });
      return;
    }

    const player = this.sim.addPlayer(msg.name);
    if (!player) {
      this.send(ws, { type: 'error', message: 'Could not join' });
      return;
    }

    meta.role = 'player';
    meta.playerId = player.id;

    this.send(ws, {
      type: 'welcome',
      role: 'player',
      playerId: player.id,
      seat: player.seat,
      color: player.color,
      name: player.name,
      x: player.x,
      world: this.sim.world,
      settings: this.sim.settings,
    });
    this.broadcast(this.sim.lobbyPayload());
  }

  _leave(ws) {
    const meta = this.clients.get(ws);
    if (!meta) return;
    if (meta.role === 'player' && meta.playerId) {
      this.sim.removePlayer(meta.playerId);
      meta.playerId = null;
      meta.role = null;
      this.broadcast(this.sim.lobbyPayload());
    }
    this.send(ws, { type: 'left' });
  }

  _input(ws, msg) {
    const meta = this.clients.get(ws);
    if (!meta || meta.role !== 'player' || !meta.playerId) return;
    this.sim.setInput(meta.playerId, {
      angle: msg.angle,
      shooting: msg.shooting,
    });
  }

  _admin(ws, msg) {
    const meta = this.clients.get(ws);
    if (!meta || meta.role !== 'admin') {
      this.send(ws, { type: 'error', message: 'Admin only' });
      return;
    }

    const action = msg.action;
    if (msg.settings) {
      this.sim.applySettings(msg.settings);
    }

    if (action === 'start') {
      // Allow starting a new round from results without a separate reset
      if (this.sim.phase === 'results') {
        this.sim.fullReset();
      }
      const ok = this.sim.startCountdown();
      if (!ok) {
        this.send(ws, { type: 'error', message: 'Need at least 1 player to start' });
      } else {
        this.broadcast(this.sim.lobbyPayload());
        this.broadcast(this.sim.snapshot());
      }
      return;
    }

    if (action === 'end') {
      this.sim.endRound();
      this.broadcast(this.sim.snapshot());
      return;
    }

    if (action === 'reset') {
      this.sim.fullReset();
      this.broadcast(this.sim.lobbyPayload());
      this.broadcast(this.sim.snapshot());
      return;
    }

    if (action === 'settings') {
      this.broadcast({
        type: 'settings',
        settings: this.sim.settings,
      });
      return;
    }

    if (action === 'addTarget') {
      const name = (msg.target && msg.target.name) || msg.name;
      const points = (msg.target && msg.target.points) != null ? msg.target.points : msg.points;
      const face = (msg.target && msg.target.face) || msg.face || '';
      if (!name || !String(name).trim()) {
        this.send(ws, { type: 'error', message: 'Target name required' });
        return;
      }
      addTarget({ name, points, face });
      this.broadcast(this._targetsPayload());
      return;
    }

    if (action === 'removeTarget') {
      const id = msg.id || (msg.target && msg.target.id);
      if (!id) {
        this.send(ws, { type: 'error', message: 'Target id required' });
        return;
      }
      const ok = removeTarget(id);
      if (!ok) {
        this.send(ws, { type: 'error', message: 'Target not found' });
        return;
      }
      this.broadcast(this._targetsPayload());
      return;
    }

    if (action === 'listTargets') {
      this.send(ws, this._targetsPayload());
    }
  }
}

module.exports = { Room };
