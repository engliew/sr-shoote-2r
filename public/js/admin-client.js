(function () {
  const statusEl = document.getElementById('conn-status');
  const phaseEl = document.getElementById('phase');
  const timerEl = document.getElementById('timer');
  // phase/timer may be visually hidden; still update for debugging
  const lanEl = document.getElementById('lan-urls');
  const msgEl = document.getElementById('msg');
  const targetsBody = document.getElementById('targets-body');
  const columnsEl = document.getElementById('player-columns');
  const columnsTitle = document.getElementById('columns-title');
  const winnerBanner = document.getElementById('winner-banner');
  const gameHud = document.getElementById('admin-game-hud');
  const gameCanvas = document.getElementById('admin-game');

  const bulletSpeed = document.getElementById('bulletSpeed');
  const fireRate = document.getElementById('fireRate');
  const spawnRate = document.getElementById('spawnRate');
  const bulletSpeedVal = document.getElementById('bulletSpeedVal');
  const fireRateVal = document.getElementById('fireRateVal');
  const spawnRateVal = document.getElementById('spawnRateVal');

  let connected = false;
  let latestState = null;
  let world = { width: 390, height: 700, floorY: 620, gunY: 600 };
  let lastFrame = performance.now();
  let lastColumnsKey = '';
  let lastColumnsAt = 0;

  const renderer = SRRender.createRenderer(gameCanvas);

  function settingsPayload() {
    const fireIntervalMs = Number(fireRate.value) || 1000;
    return {
      bulletSpeed: Number(bulletSpeed.value),
      fireIntervalMs,
      fireRate: 1000 / fireIntervalMs,
      spawnRate: Number(spawnRate.value),
    };
  }

  function syncLabels() {
    bulletSpeedVal.textContent = bulletSpeed.value;
    fireRateVal.textContent = fireRate.value;
    spawnRateVal.textContent = Number(spawnRate.value).toFixed(1);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const net = SRNet.createNet({
    onOpen() {
      connected = true;
      statusEl.innerHTML = '<span class="status-dot ok"></span>Connected';
      net.send({ type: 'join', role: 'admin' });
    },
    onClose() {
      connected = false;
      statusEl.innerHTML = '<span class="status-dot"></span>Disconnected — retrying…';
    },
    onMessage(msg) {
      if (msg.type === 'welcome') {
        if (msg.settings) applySettingsToUi(msg.settings);
        if (msg.targets) renderTargets(msg.targets);
      }
      if (msg.type === 'hello' && msg.config && msg.config.world) {
        world = msg.config.world;
        renderer.resize(world);
      }
      if (msg.type === 'targets') {
        renderTargets(msg.targets || []);
      }
      if (msg.type === 'settings' && msg.settings) {
        applySettingsToUi(msg.settings);
      }
      if (msg.type === 'lobby') {
        if (phaseEl) phaseEl.textContent = msg.phase || 'lobby';
        if (msg.columns) renderColumns(msg.columns, msg.phase);
      }
      if (msg.type === 'state') {
        latestState = msg;
        if (msg.world) world = msg.world;

        if (phaseEl) phaseEl.textContent = msg.phase;
        if (timerEl) {
          if (msg.phase === 'playing') timerEl.textContent = `${Math.ceil(msg.timeLeft)}s`;
          else if (msg.phase === 'countdown') timerEl.textContent = `Countdown ${Math.ceil(msg.countdown)}`;
          else if (msg.phase === 'results') timerEl.textContent = 'Results';
          else timerEl.textContent = '—';
        }

        if (msg.columns) renderColumns(msg.columns, msg.phase);
        if (msg.settings) applySettingsToUi(msg.settings);
        renderWinner(msg.phase, msg.winner);
        updateGameHud(msg);

        for (const ev of msg.events || []) {
          if (ev.type === 'hit') {
            const me = (msg.players || []).find((p) => p.id === ev.playerId);
            renderer.addHitFx(ev.x, ev.y, ev.points, me ? me.color : '#fde68a');
          } else if (ev.type === 'shot') {
            renderer.addShotFx(ev.x, ev.y);
          }
        }
      }
      if (msg.type === 'error') {
        msgEl.textContent = msg.message || 'Error';
      }
    },
  });

  function updateGameHud(msg) {
    if (!gameHud) return;
    const nPlayers = (msg.players || []).length;
    const nSaucers = (msg.saucers || []).filter((s) => s.state === 'alive').length;
    let line = `${String(msg.phase || '—').toUpperCase()}`;
    if (msg.phase === 'playing') line += ` · ${Math.ceil(msg.timeLeft)}s`;
    if (msg.phase === 'countdown') line += ` · ${Math.ceil(msg.countdown)}`;
    line += ` · ${nPlayers} players · ${nSaucers} saucers`;
    if (msg.phase === 'results' && msg.winner) {
      line += msg.winner.tie
        ? ` · Tie: ${(msg.winner.names || []).join(', ')}`
        : ` · Winner: ${msg.winner.name} (${msg.winner.score})`;
    }
    gameHud.textContent = line;
  }

  function applySettingsToUi(s) {
    if (s.bulletSpeed != null) bulletSpeed.value = s.bulletSpeed;
    if (s.fireIntervalMs != null) fireRate.value = s.fireIntervalMs;
    else if (s.fireRate != null) fireRate.value = Math.round(1000 / Math.max(0.25, s.fireRate));
    if (s.spawnRate != null) spawnRate.value = s.spawnRate;
    syncLabels();
  }

  function renderTargets(targets) {
    if (!targets.length) {
      targetsBody.innerHTML = '<div class="targets-empty">No targets yet — add one above.</div>';
      return;
    }
    targetsBody.innerHTML = targets
      .map(
        (t) => `
      <div class="target-chip">
        <span class="target-chip-name" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>
        <span class="target-chip-pts">${t.points}</span>
        <button type="button" class="btn-remove" data-id="${escapeHtml(t.id)}" aria-label="Remove">×</button>
      </div>`
      )
      .join('');

    targetsBody.querySelectorAll('.btn-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (!id) return;
        net.send({ type: 'admin', action: 'removeTarget', id });
      });
    });
  }

  function renderColumns(columns, phase) {
    const isResults = phase === 'results';
    if (columnsTitle) {
      columnsTitle.textContent = '';
      columnsTitle.style.display = 'none';
    }

    // Throttle DOM rebuilds (full hit tables are heavy at 15Hz)
    const key = JSON.stringify({
      phase,
      cols: (columns || []).map((c) => [c.seat, c.name, c.score, c.empty, (c.hits || []).length, c.score]),
    });
    const now = performance.now();
    if (key === lastColumnsKey && !isResults && now - lastColumnsAt < 200) return;
    // still update more often if scores change (key includes score)
    lastColumnsKey = key;
    lastColumnsAt = now;

    columnsEl.innerHTML = (columns || [])
      .map((col) => {
        const hits = col.hits || [];
        let body;
        if (col.empty) {
          body = `<p class="col-empty">Empty seat</p>`;
        } else if (!hits.length) {
          body = `<p class="col-empty">${isResults ? 'No hits' : 'Waiting for hits…'}</p>`;
        } else if (isResults) {
          body = `
            <table class="hit-table">
              <thead><tr><th>Target</th><th>Qty</th><th>Pts</th></tr></thead>
              <tbody>
                ${hits
                  .map(
                    (h) =>
                      `<tr><td>${escapeHtml(h.name)}</td><td>${h.qty}</td><td>${h.total}</td></tr>`
                  )
                  .join('')}
              </tbody>
            </table>`;
        } else {
          body = `
            <ul class="hit-list">
              ${hits
                .map(
                  (h) =>
                    `<li><span>${escapeHtml(h.name)}${h.qty > 1 ? ` ×${h.qty}` : ''}</span><span class="pts">+${h.total}</span></li>`
                )
                .join('')}
            </ul>`;
        }

        return `
          <div class="player-col" style="--col:${col.color}">
            <div class="player-col-head">
              <span class="swatch" style="background:${col.color}"></span>
              <strong>${escapeHtml(col.name)}</strong>
              <span class="player-col-score">${col.empty ? '—' : col.score}</span>
            </div>
            ${body}
          </div>`;
      })
      .join('');
  }

  function renderWinner(phase, winner) {
    if (phase !== 'results' || !winner) {
      winnerBanner.classList.add('hidden');
      winnerBanner.innerHTML = '';
      return;
    }
    winnerBanner.classList.remove('hidden');
    if (winner.tie && winner.names && winner.names.length > 1) {
      winnerBanner.innerHTML = `
        <div class="winner-title">It's a tie!</div>
        <div class="winner-name">${winner.names.map(escapeHtml).join(' · ')}</div>
        <div class="winner-score">${winner.score} points</div>`;
    } else {
      winnerBanner.innerHTML = `
        <div class="winner-title">Winner</div>
        <div class="winner-name" style="color:${winner.color || '#fde68a'}">${escapeHtml(winner.name)}</div>
        <div class="winner-score">${winner.score} points</div>`;
    }
  }

  function pushSettings() {
    syncLabels();
    if (!connected) return;
    net.send({ type: 'admin', action: 'settings', settings: settingsPayload() });
  }

  bulletSpeed.addEventListener('input', pushSettings);
  fireRate.addEventListener('input', pushSettings);
  spawnRate.addEventListener('input', pushSettings);

  document.getElementById('btn-start').addEventListener('click', () => {
    msgEl.textContent = '';
    net.send({ type: 'admin', action: 'start', settings: settingsPayload() });
  });
  document.getElementById('btn-end').addEventListener('click', () => {
    net.send({ type: 'admin', action: 'end' });
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    net.send({ type: 'admin', action: 'reset' });
    winnerBanner.classList.add('hidden');
  });

  const faceInput = document.getElementById('target-face');
  const faceLabel = document.getElementById('target-face-label');
  if (faceInput && faceLabel) {
    faceInput.addEventListener('change', () => {
      const f = faceInput.files && faceInput.files[0];
      if (!f) {
        faceLabel.textContent = 'PNG face';
        return;
      }
      if (f.type !== 'image/png' && !/\.png$/i.test(f.name)) {
        msgEl.textContent = 'Face must be a PNG file';
        faceInput.value = '';
        faceLabel.textContent = 'PNG face';
        return;
      }
      faceLabel.textContent = f.name.length > 14 ? `${f.name.slice(0, 12)}…` : f.name;
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
  }

  document.getElementById('btn-add-target').addEventListener('click', async () => {
    const name = document.getElementById('target-name').value.trim();
    const points = Number(document.getElementById('target-points').value) || 10;
    if (!name) {
      msgEl.textContent = 'Enter a target name';
      return;
    }
    msgEl.textContent = '';
    const btn = document.getElementById('btn-add-target');
    btn.disabled = true;
    try {
      let faceBase64 = '';
      let faceOriginalName = '';
      const f = faceInput && faceInput.files && faceInput.files[0];
      if (f) {
        if (f.type !== 'image/png' && !/\.png$/i.test(f.name)) {
          throw new Error('Face must be a PNG file');
        }
        faceBase64 = await readFileAsDataUrl(f);
        faceOriginalName = f.name;
      }
      const res = await fetch('/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          points,
          faceBase64,
          faceOriginalName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to add target');
      if (data.targets) renderTargets(data.targets);
      document.getElementById('target-name').value = '';
      if (faceInput) faceInput.value = '';
      if (faceLabel) faceLabel.textContent = 'PNG face';
    } catch (err) {
      msgEl.textContent = err.message || 'Failed to add target';
    } finally {
      btn.disabled = false;
    }
  });

  fetch('/api/info')
    .then((r) => r.json())
    .then((info) => {
      const urls = info.joinUrls || info.lanUrls || [];
      if (!urls.length) {
        lanEl.textContent = 'No join URL configured — set PUBLIC_URL on the server.';
        return;
      }
      lanEl.innerHTML = urls
        .map((u) => {
          const href = String(u).replace(/"/g, '');
          return `<div class="mono"><a href="${href}" target="_blank" rel="noopener" style="color:#7dd3fc">${href}</a></div>`;
        })
        .join('');
    })
    .catch(() => {
      lanEl.textContent = 'Could not load join URL.';
    });

  renderColumns(
    [0, 1, 2, 3].map((seat) => ({
      seat,
      empty: true,
      name: `Seat ${seat + 1}`,
      color: ['#3b82f6', '#ef4444', '#22c55e', '#eab308'][seat],
      score: 0,
      hits: [],
    })),
    'lobby'
  );

  function loop(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    renderer.updateFx(dt);
    if (latestState) {
      renderer.draw(latestState, null);
    } else {
      renderer.draw(
        {
          world,
          players: [],
          saucers: [],
          bullets: [],
          blobs: [],
        },
        null
      );
    }
    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', () => renderer.resize(world));
  // Initial size after layout
  requestAnimationFrame(() => {
    renderer.resize(world);
    requestAnimationFrame(loop);
  });

  syncLabels();
  net.connect();
})();
