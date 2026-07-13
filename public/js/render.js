(function (global) {
  const faceCache = new Map();
  // Night skyline — Kuala Lumpur / KLCC Petronas Twin Towers
  const skyPhoto = new Image();
  skyPhoto.src = '/assets/bg/night-sky.jpg?v=5';

  function loadFace(face) {
    if (!face) return null;
    if (faceCache.has(face)) return faceCache.get(face);
    const img = new Image();
    img.src = `/assets/faces/${face}`;
    faceCache.set(face, img);
    return img;
  }

  function createRenderer(canvas) {
    // Prefer plain 2d context — some Safari builds return a broken ctx with exotic flags
    let ctx = canvas.getContext('2d');
    if (!ctx) ctx = canvas.getContext('2d', { alpha: true });
    let dpr = 1;
    let viewW = 390;
    let viewH = 700;
    let shake = 0;
    const floatTexts = [];
    const particles = [];
    // Cached world-space background (sky photo is expensive to scale every frame)
    let bgCache = null;
    let bgCacheKey = '';

    function resize(world) {
      const wrap = canvas.parentElement;
      const cssW = wrap.clientWidth || 1;
      const cssH = wrap.clientHeight || 1;
      // Cap DPR — 3x retina costs a lot for little gain in this game
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      viewW = world.width;
      viewH = world.height;
      bgCache = null;
      bgCacheKey = '';
    }

    function ensureBgCache(w) {
      const key = `${w.width}x${w.height}x${w.floorY}|${skyPhoto.complete && skyPhoto.naturalWidth}`;
      if (bgCache && bgCacheKey === key) return bgCache;
      bgCacheKey = key;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.floor(w.width));
      c.height = Math.max(1, Math.floor(w.height));
      const bctx = c.getContext('2d');
      const skyH = w.floorY;

      if (skyPhoto.complete && skyPhoto.naturalWidth) {
        const iw = skyPhoto.naturalWidth;
        const ih = skyPhoto.naturalHeight;
        // Cover sky band; bias so skyline/towers sit near the floor (horizon)
        const sc = Math.max(w.width / iw, skyH / ih);
        const dw = iw * sc;
        const dh = ih * sc;
        const dx = (w.width - dw) / 2;
        const dy = Math.min(0, skyH - dh * 0.92);
        bctx.drawImage(skyPhoto, dx, dy, dw, dh);
        // Soft night wash so saucers stay readable over the city lights
        const wash = bctx.createLinearGradient(0, 0, 0, skyH);
        wash.addColorStop(0, 'rgba(2,6,23,0.45)');
        wash.addColorStop(0.55, 'rgba(2,6,23,0.12)');
        wash.addColorStop(1, 'rgba(2,6,23,0.4)');
        bctx.fillStyle = wash;
        bctx.fillRect(0, 0, w.width, skyH);
      } else {
        const g = bctx.createLinearGradient(0, 0, 0, skyH);
        g.addColorStop(0, '#020617');
        g.addColorStop(1, '#1e1b4b');
        bctx.fillStyle = g;
        bctx.fillRect(0, 0, w.width, skyH);
      }

      const ground = bctx.createLinearGradient(0, w.floorY, 0, w.height);
      ground.addColorStop(0, '#1c1917');
      ground.addColorStop(1, '#0c0a09');
      bctx.fillStyle = ground;
      bctx.fillRect(0, w.floorY, w.width, w.height - w.floorY);
      bctx.fillStyle = '#292524';
      bctx.fillRect(0, w.floorY, w.width, 6);
      bgCache = c;
      return c;
    }

    // Rebuild bg cache when photo finishes loading
    skyPhoto.addEventListener('load', () => {
      bgCache = null;
      bgCacheKey = '';
    });

    function addHitFx(x, y, points, color) {
      floatTexts.push({
        x,
        y,
        text: `+${points}`,
        color: color || '#fde68a',
        life: 0.85,
      });
      shake = Math.min(0.7, shake + 0.25);

      // Lighter splash (was 28+ particles)
      for (let i = 0; i < 10; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 90 + Math.random() * 160;
        particles.push({
          kind: 'splash',
          x,
          y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 30,
          life: 0.28 + Math.random() * 0.25,
          maxLife: 0.55,
          color: i % 2 === 0 ? '#e0f2fe' : '#38bdf8',
          r: 2 + Math.random() * 3,
          g: 0.55,
        });
      }
      particles.push({
        kind: 'ring',
        x,
        y,
        vx: 0,
        vy: 0,
        life: 0.28,
        maxLife: 0.28,
        color: 'rgba(125,211,252,0.7)',
        r: 6,
        g: 1,
      });
    }

    function addShotFx(x, y) {
      // single mist puff
      particles.push({
        kind: 'mist',
        x,
        y,
        vx: (Math.random() - 0.5) * 20,
        vy: -20 - Math.random() * 20,
        life: 0.12,
        maxLife: 0.12,
        color: '#bae6fd',
        r: 2,
        g: 0.5,
      });
    }

    function updateFx(dt) {
      shake = Math.max(0, shake - dt * 2.5);
      for (let i = floatTexts.length - 1; i >= 0; i--) {
        const f = floatTexts[i];
        f.life -= dt;
        f.y -= 40 * dt;
        if (f.life <= 0) floatTexts.splice(i, 1);
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.kind === 'ring') {
          p.r += dt * 90;
        } else {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += (p.kind === 'splash' ? 380 : 160) * dt;
          p.vx *= 1 - dt * 1.2;
        }
        if (p.life <= 0) particles.splice(i, 1);
      }
      // hard cap particles
      if (particles.length > 60) particles.splice(0, particles.length - 60);
    }

    function draw(state, localPlayerId) {
      if (!state) return;
      // Fallback world if a slim packet ever omits it
      const w = state.world || {
        width: viewW || 390,
        height: viewH || 700,
        floorY: 620,
        gunY: 600,
      };
      const cssW = canvas.clientWidth || 1;
      const cssH = canvas.clientHeight || 1;
      const scale = Math.min(cssW / w.width, cssH / w.height);
      const ox = (cssW - w.width * scale) / 2;
      const oy = (cssH - w.height * scale) / 2;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      ctx.save();
      if (shake > 0.02) {
        ctx.translate(ox + (Math.random() - 0.5) * shake * 6, oy + (Math.random() - 0.5) * shake * 6);
      } else {
        ctx.translate(ox, oy);
      }
      ctx.scale(scale, scale);

      // cached sky+floor
      ctx.drawImage(ensureBgCache(w), 0, 0);

      drawSaucers(ctx, state.saucers || []);
      drawBullets(ctx, state.bullets || []);
      drawPlayers(ctx, state.players || [], w, localPlayerId);
      drawParticles(ctx, particles);
      drawFloatTexts(ctx, floatTexts);

      ctx.restore();
    }

    function drawPlayers(ctx, players, w, localPlayerId) {
      for (const p of players) {
        const isLocal = p.id === localPlayerId;
        drawGun(ctx, p, w.gunY, isLocal);
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = p.color;
        ctx.fillText(String(p.score), p.x, w.gunY + 28);
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(232,238,252,0.75)';
        ctx.fillText(p.name, p.x, w.gunY + 42);
      }
    }

    function drawGun(ctx, p, gunY, isLocal) {
      // Shadow under shooter (not rotated)
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(p.x, gunY + 14, 20, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(p.x, gunY);
      ctx.rotate((p.angle * Math.PI) / 180);

      // Local aim guide
      if (isLocal) {
        ctx.strokeStyle = 'rgba(125,211,252,0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(0, -44);
        ctx.lineTo(0, -120);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // --- Water gun (angled up = barrel toward -Y) ---
      // Water tank (round bottle on back)
      const tankGrad = ctx.createRadialGradient(-2, 4, 2, 0, 6, 14);
      tankGrad.addColorStop(0, '#7dd3fc');
      tankGrad.addColorStop(0.45, p.color);
      tankGrad.addColorStop(1, '#0c4a6e');
      ctx.fillStyle = tankGrad;
      ctx.beginPath();
      ctx.ellipse(0, 8, 13, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // water level shine in tank
      ctx.fillStyle = 'rgba(224,242,254,0.45)';
      ctx.beginPath();
      ctx.ellipse(-3, 5, 5, 4, -0.4, 0, Math.PI * 2);
      ctx.fill();

      // Grip / handle
      ctx.fillStyle = '#1e293b';
      roundRect(ctx, -5, -2, 10, 16, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // trigger
      ctx.fillStyle = '#64748b';
      ctx.beginPath();
      ctx.moveTo(4, 2);
      ctx.lineTo(9, 6);
      ctx.lineTo(4, 10);
      ctx.closePath();
      ctx.fill();

      // Pump / body (player color)
      ctx.fillStyle = p.color;
      roundRect(ctx, -7, -18, 14, 16, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Long blue barrel
      const barrel = ctx.createLinearGradient(-5, 0, 5, 0);
      barrel.addColorStop(0, '#0c4a6e');
      barrel.addColorStop(0.4, '#0284c7');
      barrel.addColorStop(0.7, '#38bdf8');
      barrel.addColorStop(1, '#0369a1');
      ctx.fillStyle = barrel;
      roundRect(ctx, -4.5, -40, 9, 24, 3);
      ctx.fill();
      // barrel rings
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      for (const by of [-36, -28, -22]) {
        ctx.beginPath();
        ctx.moveTo(-4.5, by);
        ctx.lineTo(4.5, by);
        ctx.stroke();
      }

      // Nozzle tip (flared)
      ctx.fillStyle = '#0ea5e9';
      ctx.beginPath();
      ctx.moveTo(-7, -40);
      ctx.lineTo(0, -48);
      ctx.lineTo(7, -40);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e0f2fe';
      ctx.beginPath();
      ctx.arc(0, -46, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Drip / mist at nozzle when shooting
      if (p.shooting) {
        ctx.fillStyle = 'rgba(125,211,252,0.55)';
        ctx.beginPath();
        ctx.moveTo(0, -48);
        ctx.lineTo(-6, -58);
        ctx.lineTo(6, -58);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(224,242,254,0.7)';
        ctx.beginPath();
        ctx.arc(-3, -54, 2, 0, Math.PI * 2);
        ctx.arc(3, -56, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    function drawBullets(ctx, bullets) {
      for (const b of bullets) {
        const ang = Math.atan2(b.vy || -1, b.vx || 0);
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(ang + Math.PI / 2);

        // soft water glow
        const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, b.r * 3.2);
        glow.addColorStop(0, 'rgba(186, 230, 253, 0.55)');
        glow.addColorStop(1, 'rgba(14, 165, 233, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.ellipse(0, 4, b.r * 1.6, b.r * 3.2, 0, 0, Math.PI * 2);
        ctx.fill();

        // teardrop / water slug
        ctx.beginPath();
        ctx.moveTo(0, -b.r * 2.4);
        ctx.bezierCurveTo(b.r * 1.1, -b.r * 1.2, b.r * 1.15, b.r * 0.8, 0, b.r * 1.6);
        ctx.bezierCurveTo(-b.r * 1.15, b.r * 0.8, -b.r * 1.1, -b.r * 1.2, 0, -b.r * 2.4);
        ctx.closePath();
        const body = ctx.createLinearGradient(-b.r, 0, b.r, 0);
        body.addColorStop(0, 'rgba(14, 165, 233, 0.85)');
        body.addColorStop(0.45, 'rgba(224, 242, 254, 0.98)');
        body.addColorStop(1, 'rgba(56, 189, 248, 0.9)');
        ctx.fillStyle = body;
        ctx.fill();

        // highlight
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.ellipse(-b.r * 0.25, -b.r * 0.6, b.r * 0.28, b.r * 0.7, -0.3, 0, Math.PI * 2);
        ctx.fill();

        // trailing mist droplets
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#7dd3fc';
        ctx.beginPath();
        ctx.arc(0, b.r * 2.4, b.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(b.r * 0.35, b.r * 3.1, b.r * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.restore();
      }
    }

    /**
     * UFO design ported from games/sr-shooter (classic disc + glass dome + face icon).
     */
    function drawSaucers(ctx, saucers) {
      for (const s of saucers) {
        const x = s.x;
        const y = s.y;
        const r = s.r || 28;
        const isFalling = s.state === 'dying';
        const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
        const spin = s.spin || 0;

        ctx.save();
        ctx.translate(x, y);
        if (isFalling) ctx.rotate(s.rot || 0);

        // tractor / thruster beam under ship (when alive)
        if (!isFalling) {
          const beamGrad = ctx.createLinearGradient(0, 6, 0, r * 1.6);
          beamGrad.addColorStop(0, 'rgba(120,220,255,0.22)');
          beamGrad.addColorStop(0.5, 'rgba(80,180,255,0.08)');
          beamGrad.addColorStop(1, 'rgba(60,140,255,0)');
          ctx.fillStyle = beamGrad;
          ctx.beginPath();
          ctx.moveTo(-r * 0.35, 6);
          ctx.lineTo(r * 0.35, 6);
          ctx.lineTo(r * 0.7, r * 1.4);
          ctx.lineTo(-r * 0.7, r * 1.4);
          ctx.closePath();
          ctx.fill();
        }

        // soft glow under disc
        const glowGrad = ctx.createRadialGradient(0, 4, 0, 0, 4, r * 1.1);
        glowGrad.addColorStop(0, 'rgba(80,200,255,0.35)');
        glowGrad.addColorStop(0.6, 'rgba(60,160,255,0.12)');
        glowGrad.addColorStop(1, 'rgba(40,120,255,0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.ellipse(0, 6, r * 1.05, r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();

        // metallic saucer disc
        const discGrad = ctx.createLinearGradient(-r, 0, r, 0);
        discGrad.addColorStop(0, '#4a5a6a');
        discGrad.addColorStop(0.25, '#7a8a9a');
        discGrad.addColorStop(0.5, '#b0c0d0');
        discGrad.addColorStop(0.75, '#7a8a9a');
        discGrad.addColorStop(1, '#4a5a6a');
        ctx.fillStyle = discGrad;
        ctx.beginPath();
        ctx.ellipse(0, 8, r, r * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(200,230,255,0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(0, 8, r, r * 0.35, 0, 0, Math.PI * 2);
        ctx.stroke();

        // rim lights (spinning)
        const rimY = 8;
        const lightCount = 8;
        for (let i = 0; i < lightCount; i++) {
          const angle = (i / lightCount) * Math.PI * 2 + spin;
          const lx = Math.cos(angle) * r * 0.82;
          const ly = rimY + Math.sin(angle) * r * 0.22;
          const pulse = 0.55 + Math.sin(t * 4 + i * 1.3) * 0.35;
          const hue = i % 2 === 0 ? [255, 220, 80] : [80, 220, 255];
          // no shadowBlur — very expensive on mobile Canvas
          ctx.fillStyle = `rgba(${hue[0]},${hue[1]},${hue[2]},${Math.min(1, pulse + 0.15)})`;
          ctx.beginPath();
          ctx.ellipse(lx, ly, 3.5, 2, angle, 0, Math.PI * 2);
          ctx.fill();
        }

        // glass dome (half-bubble)
        const domeRx = r * 0.55;
        const domeRy = r * 0.4;
        const domeY = -4;

        const domeGrad = ctx.createRadialGradient(-domeRx * 0.3, domeY - domeRy * 0.5, 0, 0, domeY, domeRx);
        domeGrad.addColorStop(0, 'rgba(200,240,255,0.75)');
        domeGrad.addColorStop(0.45, 'rgba(120,190,255,0.45)');
        domeGrad.addColorStop(1, 'rgba(60,120,200,0.25)');
        ctx.fillStyle = domeGrad;
        ctx.beginPath();
        ctx.ellipse(0, domeY, domeRx, domeRy, 0, Math.PI, 0);
        ctx.fill();

        // dome highlight
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.ellipse(-domeRx * 0.25, domeY - domeRy * 0.35, domeRx * 0.18, domeRy * 0.12, -0.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(220,240,255,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, domeY, domeRx, domeRy, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, domeY + domeRy * 0.15, domeRx * 0.85, domeRy * 0.55, 0, 0, Math.PI);
        ctx.stroke();

        // face / icon inside dome
        const faceSize = r * 0.42;
        const faceY = -6;
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, faceY, faceSize, 0, Math.PI * 2);
        ctx.clip();
        const img = loadFace(s.face);
        if (img && img.complete && img.naturalWidth) {
          ctx.drawImage(img, -faceSize, faceY - faceSize, faceSize * 2, faceSize * 2);
        } else {
          ctx.fillStyle = hashColor(s.name);
          ctx.fillRect(-faceSize, faceY - faceSize, faceSize * 2, faceSize * 2);
          ctx.fillStyle = '#0f172a';
          ctx.font = `bold ${Math.floor(faceSize * 1.1)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText((s.name || '?').slice(0, 1).toUpperCase(), 0, faceY);
        }
        ctx.restore();

        ctx.strokeStyle = 'rgba(180,220,255,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, faceY, faceSize + r * 0.02, 0, Math.PI * 2);
        ctx.stroke();

        // Points on top — close to dome
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        const ptsText = String(s.points);
        const ptsW = ctx.measureText(ptsText).width + 12;
        const ptsY = -r * 0.72 - 10;
        ctx.fillStyle = 'rgba(10,20,40,0.7)';
        roundRect(ctx, -ptsW / 2, ptsY, ptsW, 14, 5);
        ctx.fill();
        ctx.strokeStyle = 'rgba(120,200,255,0.35)';
        ctx.lineWidth = 1;
        roundRect(ctx, -ptsW / 2, ptsY, ptsW, 14, 5);
        ctx.stroke();
        ctx.fillStyle = '#7ee8ff';
        ctx.fillText(ptsText, 0, ptsY + 10);

        // Name at bottom — close to disc
        ctx.font = 'bold 9px sans-serif';
        const name = String(s.name || '');
        const nameW = ctx.measureText(name).width + 12;
        const nameY = r * 0.58 + 8;
        ctx.fillStyle = 'rgba(10,20,40,0.7)';
        roundRect(ctx, -nameW / 2, nameY, nameW, 14, 5);
        ctx.fill();
        ctx.strokeStyle = 'rgba(120,200,255,0.35)';
        ctx.lineWidth = 1;
        roundRect(ctx, -nameW / 2, nameY, nameW, 14, 5);
        ctx.stroke();
        ctx.fillStyle = 'white';
        ctx.fillText(name, 0, nameY + 10);

        ctx.restore();
      }
    }

    function drawParticles(ctx, list) {
      for (const p of list) {
        const t = Math.max(0, p.life / (p.maxLife || 0.5));
        if (p.kind === 'ring') {
          ctx.globalAlpha = t * 0.55;
          ctx.strokeStyle = '#7dd3fc';
          ctx.lineWidth = 2.5 * t;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.stroke();
          continue;
        }
        ctx.globalAlpha = Math.max(0, t) * (p.g || 0.8);
        if (p.kind === 'splash' || p.kind === 'mist') {
          // water droplet shape
          ctx.save();
          ctx.translate(p.x, p.y);
          const ang = Math.atan2(p.vy, p.vx);
          ctx.rotate(ang + Math.PI / 2);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(0, -p.r * 1.4);
          ctx.bezierCurveTo(p.r, -p.r * 0.4, p.r * 0.85, p.r, 0, p.r * 1.2);
          ctx.bezierCurveTo(-p.r * 0.85, p.r, -p.r, -p.r * 0.4, 0, -p.r * 1.4);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.beginPath();
          ctx.ellipse(-p.r * 0.2, -p.r * 0.3, p.r * 0.25, p.r * 0.45, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    function drawFloatTexts(ctx, list) {
      for (const f of list) {
        ctx.globalAlpha = Math.max(0, f.life);
        ctx.font = 'bold 18px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = f.color;
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 3;
        ctx.strokeText(f.text, f.x, f.y);
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;
    }

    function roundRect(ctx, x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }

    function hashColor(str) {
      let h = 0;
      for (let i = 0; i < (str || '').length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
      const hue = Math.abs(h) % 360;
      return `hsl(${hue} 70% 65%)`;
    }

    return {
      resize,
      draw,
      updateFx,
      addHitFx,
      addShotFx,
    };
  }

  global.SRRender = { createRenderer };
})(window);
