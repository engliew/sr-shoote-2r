'use strict';

module.exports = {
  port: Number(process.env.PORT) || 3000,
  // 15 Hz is plenty for this arcade game and cuts network/JSON cost ~25%
  tickRate: 15,
  roundDurationSec: 60,
  countdownSec: 3,
  maxPlayers: 4,
  world: {
    width: 390,
    height: 700,
    floorY: 620,
    gunY: 600,
    controlBarHeight: 72,
  },
  defaults: {
    bulletSpeed: 400,
    // 1s between shots
    fireRate: 1,
    fireIntervalMs: 1000,
    maxBulletsPerPlayer: 2,
    spawnRate: 0.5,
    maxSaucers: 18,
    bulletRadius: 6,
    saucerRadius: 32,
  },
  playerColors: ['#3b82f6', '#ef4444', '#22c55e', '#eab308'],
  playerNames: ['Blue', 'Red', 'Green', 'Gold'],
};
