'use strict';

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Create a motion controller for a saucer.
 * side: 'top' | 'left' | 'right'
 * style: 'linear' | 'sine' | 'spiral'
 */
function createPath(world, side, style, speedScale = 1) {
  const { width, height, floorY } = world;
  // Global 20% slower movement
  const sp = speedScale * 0.8;
  const margin = 40;
  let x;
  let y;
  let vx = 0;
  let vy = 0;
  let phase = Math.random() * Math.PI * 2;
  let amp = rand(30, 90);
  let omega = rand(2.2, 4.5) * 0.8;
  let angle = 0;
  let radius = rand(20, 50);
  let radiusVel = rand(18, 55) * (Math.random() < 0.5 ? 1 : -1) * 0.8;
  let cx;
  let cy;
  let baseSpeed = rand(70, 160) * sp;

  if (side === 'top') {
    x = rand(margin, width - margin);
    y = -30;
    vx = rand(-80, 80) * sp;
    vy = rand(60, 140) * sp;
  } else if (side === 'left') {
    x = -30;
    y = rand(40, floorY * 0.55);
    vx = rand(80, 170) * sp;
    vy = rand(-40, 80) * sp;
  } else {
    x = width + 30;
    y = rand(40, floorY * 0.55);
    vx = -rand(80, 170) * sp;
    vy = rand(-40, 80) * sp;
  }

  if (style === 'spiral') {
    cx = clamp(x, margin, width - margin);
    cy = clamp(y + 80, 60, floorY * 0.45);
    if (side === 'top') {
      cx = x;
      cy = 80;
    }
    angle = Math.atan2(y - cy, x - cx);
    radius = Math.hypot(x - cx, y - cy) || radius;
    const drift = rand(20, 55) * sp;
    vx = side === 'right' ? -drift : side === 'left' ? drift : rand(-drift, drift);
    vy = rand(15, 45) * sp;
  }

  function step(dt) {
    if (style === 'linear') {
      x += vx * dt;
      y += vy * dt;
    } else if (style === 'sine') {
      x += vx * dt;
      phase += omega * dt;
      y += vy * dt + Math.sin(phase) * amp * dt * 0.35;
      // keep lateral wave on the axis perpendicular to main motion
      if (Math.abs(vx) > Math.abs(vy)) {
        y = clamp(y + Math.sin(phase) * amp * 0.015, 20, floorY - 80);
      } else {
        x = clamp(x + Math.sin(phase) * amp * 0.02, 10, width - 10);
      }
    } else {
      // spiral / orbital with drifting center
      angle += omega * dt * (vx >= 0 ? 1 : -1);
      radius += radiusVel * dt * 0.15;
      if (radius < 12 || radius > 120) radiusVel *= -1;
      cx += vx * dt * 0.35;
      cy += vy * dt * 0.35;
      x = cx + Math.cos(angle) * radius;
      y = cy + Math.sin(angle) * radius * 0.75;
    }

    // soft bounce inside playable sky
    if (x < 8) {
      x = 8;
      vx = Math.abs(vx) * 0.9;
    } else if (x > width - 8) {
      x = width - 8;
      vx = -Math.abs(vx) * 0.9;
    }
    if (y < 10) {
      y = 10;
      vy = Math.abs(vy) * 0.8;
    }

    const out =
      y > floorY + 40 ||
      x < -80 ||
      x > width + 80 ||
      y < -100;

    return { x, y, out, rot: angle || Math.atan2(vy, vx) };
  }

  return {
    get pos() {
      return { x, y };
    },
    step,
    style,
    side,
  };
}

function pickStyle() {
  const r = Math.random();
  if (r < 0.4) return 'linear';
  if (r < 0.75) return 'sine';
  return 'spiral';
}

function pickSide() {
  const r = Math.random();
  if (r < 0.34) return 'top';
  if (r < 0.67) return 'left';
  return 'right';
}

module.exports = { createPath, pickStyle, pickSide, rand, clamp };
