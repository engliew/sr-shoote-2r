'use strict';

const { createPath, pickStyle, pickSide, rand, clamp } = require('./paths');
const { pickRandomPerson } = require('./roster');

let nextId = 1;
function uid(prefix) {
  return `${prefix}_${nextId++}`;
}

function createPlayer(seat, color, name) {
  return {
    id: null, // set by room when socket joins
    seat,
    color,
    name,
    x: 0,
    angle: 0,
    score: 0,
    shooting: false,
    fireCooldown: 0,
    connected: false,
  };
}

function createBullet(ownerId, x, y, angleDeg, speed, radius) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    id: uid('b'),
    ownerId,
    x,
    y,
    vx: Math.sin(rad) * speed,
    vy: -Math.cos(rad) * speed,
    r: radius,
    life: 2.2,
  };
}

function createSaucer(world, settings) {
  const person = pickRandomPerson();
  const side = pickSide();
  const style = pickStyle();
  // Higher value targets dodge a bit faster
  const speedScale = 0.75 + Math.min(person.points, 100) / 120 + Math.random() * 0.35;
  const path = createPath(world, side, style, speedScale);
  const start = path.pos;
  return {
    id: uid('s'),
    x: start.x,
    y: start.y,
    r: settings.saucerRadius,
    rot: 0,
    spin: Math.random() * Math.PI * 2,
    name: person.name,
    points: person.points,
    face: person.face || '',
    personId: person.id,
    style,
    side,
    path,
    state: 'alive', // alive | dying | splat
    dieT: 0,
    dieX: 0,
    dieY: 0,
    // slower tumble after hit
    dieSpin: rand(1.6, 3.2) * (Math.random() < 0.5 ? 1 : -1),
    killerId: null,
  };
}

function createFloorBlob(x, y, color, name, points) {
  return {
    id: uid('blob'),
    x,
    y,
    color,
    name,
    points,
    life: 1.4,
    maxLife: 1.4,
  };
}

function clampPlayerX(x, world, seat, maxPlayers) {
  // Keep guns spread-friendly but allow free movement
  const margin = 28;
  return clamp(x, margin, world.width - margin);
}

function clampAngle(angle) {
  return clamp(angle, -90, 90);
}

module.exports = {
  createPlayer,
  createBullet,
  createSaucer,
  createFloorBlob,
  clampPlayerX,
  clampAngle,
  uid,
};
