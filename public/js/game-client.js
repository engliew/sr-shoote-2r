(function () {
  const overlay = document.getElementById('overlay');
  const overlayBody = document.getElementById('overlay-body');
  const hudLeft = document.getElementById('hud-left');
  const hudRight = document.getElementById('hud-right');
  const canvas = document.getElementById('game');
  const aimPad = document.getElementById('aim-pad');
  const shootBtn = document.getElementById('shoot-btn');

  let world = { width: 390, height: 700, floorY: 620, gunY: 600 };
  let playerId = null;
  let playerMeta = null;
  let fixedX = world.width / 2;
  let latestState = null;
  let lobby = null;
  let connected = false;
  let joined = false;
  let lastInputSent = 0;
  let lastFrame = performance.now();
  /** boot | join | lobby | countdown | playing | results */
  let uiPhase = 'boot';
  let lastCountdownShown = null;
  let lastHudKey = '';
  let lastHudAt = 0;

  const renderer = SRRender.createRenderer(canvas);
  const input = SRInput.createInput(aimPad, shootBtn, world);

  function resetLocalSession(keepName) {
    const name = keepName && playerMeta ? playerMeta.name : '';
    playerId = null;
    playerMeta = keepName && name ? { name } : null;
    joined = false;
    fixedX = world.width / 2;
    // keep latestState for spectator draw, but do not apply its phase UI while !joined
    lobby = null;
    uiPhase = 'join';
    lastCountdownShown = null;
    input.setAngle(0);
    return name;
  }

  function ensureJoinScreen(prefillName) {
    if (uiPhase !== 'join' || !overlayBody.querySelector('#name')) {
      showJoin(prefillName != null ? prefillName : (playerMeta && playerMeta.name) || '');
    } else {
      overlay.classList.remove('hidden');
    }
  }

  const net = SRNet.createNet({
    onOpen() {
      connected = true;
      updateHud();
      // Fresh connection: always offer name entry unless already joined this session
      if (joined && playerMeta && playerMeta.name) {
        net.send({ type: 'join', role: 'player', name: playerMeta.name });
      } else {
        joined = false;
        playerId = null;
        ensureJoinScreen(playerMeta && playerMeta.name);
      }
    },
    onClose() {
      connected = false;
      // Drop seat on disconnect so refresh can re-enter name
      if (joined) {
        resetLocalSession(true);
      }
      ensureJoinScreen(playerMeta && playerMeta.name);
      updateHud();
    },
    onMessage(msg) {
      switch (msg.type) {
        case 'welcome':
          if (msg.role === 'player') {
            playerId = msg.playerId;
            playerMeta = msg;
            joined = true;
            if (msg.world) {
              world = msg.world;
              input.setWorld(world);
            }
            fixedX = msg.x != null ? msg.x : world.width / 2;
            input.setFixedX(fixedX);
            input.setAngle(0);
            renderer.resize(world);
            // Show current phase after join (lobby / mid-round / results)
            if (latestState && latestState.phase) {
              applyPhaseUi(latestState.phase, latestState);
            } else {
              applyPhaseUi('lobby', { players: [], phase: 'lobby' });
            }
          }
          break;
        case 'left':
          resetLocalSession(true);
          ensureJoinScreen(playerMeta && playerMeta.name);
          updateHud();
          break;
        case 'lobby':
          lobby = msg;
          if (joined) {
            if (msg.phase === 'lobby') applyPhaseUi('lobby', msg);
          } else {
            ensureJoinScreen(playerMeta && playerMeta.name);
          }
          updateHud();
          break;
        case 'state':
          latestState = msg;
          if (joined) handleEvents(msg.events || []);

          // Not in a seat → name form only (never steal join UI with results/play overlays)
          if (!joined) {
            ensureJoinScreen(playerMeta && playerMeta.name);
            updateHud();
            break;
          }

          // Seat gone (kicked / left race / server reset seats)
          if (playerId && msg.players && !msg.players.some((p) => p.id === playerId)) {
            resetLocalSession(true);
            ensureJoinScreen(playerMeta && playerMeta.name);
            updateHud();
            break;
          }

          applyPhaseUi(msg.phase, msg);
          updateHud();
          break;
        case 'error':
          flashError(msg.message);
          break;
        default:
          break;
      }
    },
  });

  function applyPhaseUi(phase, msg) {
    if (!phase || !joined) return;

    if (phase === 'countdown') {
      const n = Math.max(1, Math.ceil((msg && msg.countdown) || 0));
      if (uiPhase !== 'countdown' || lastCountdownShown !== n) {
        lastCountdownShown = n;
        uiPhase = 'countdown';
        showCountdown(n);
      }
      return;
    }

    if (phase === 'playing') {
      if (uiPhase !== 'playing') {
        uiPhase = 'playing';
        lastCountdownShown = null;
        hideOverlay();
      }
      return;
    }

    if (phase === 'results') {
      if (uiPhase !== 'results') {
        uiPhase = 'results';
        lastCountdownShown = null;
        showResults(msg.results || msg.ranking, msg.winner);
      }
      return;
    }

    if (phase === 'lobby') {
      lastCountdownShown = null;
      if (uiPhase !== 'lobby') uiPhase = 'lobby';
      showLobby({
        players: (msg && msg.players) || (lobby && lobby.players) || [],
        phase: 'lobby',
      });
    }
  }

  function setOverlayMode(mode) {
    // mode: 'full' | 'popup'
    overlay.classList.remove('hidden');
    if (mode === 'popup') overlay.classList.add('overlay-popup');
    else overlay.classList.remove('overlay-popup');
  }

  function showJoin(prefillName) {
    uiPhase = 'join';
    joined = false;
    playerId = null;
    setOverlayMode('full');
    const pref = prefillName || '';
    overlayBody.innerHTML = `
      <div class="panel">
        <h1>SR Shooter 2</h1>
        <p>Water-gun saucer hunt · 60s rounds · shared arena</p>
        <label for="name">Your name</label>
        <input id="name" type="text" maxlength="16" placeholder="Player" autocomplete="off"
          enterkeyhint="go" value="${escapeHtml(pref)}" />
        <button class="btn" id="join-btn" type="button">Join game</button>
        <p style="margin-top:12px;margin-bottom:0;font-size:12px">
          Aim with the slider · Hold Shoot<br/>
          Desktop: A/D aim · Space shoot
        </p>
      </div>`;
    const nameInput = document.getElementById('name');
    const joinBtn = document.getElementById('join-btn');
    // Defer focus so mobile keyboard works after refresh
    setTimeout(() => {
      try {
        nameInput.focus();
        nameInput.select();
      } catch (_) {}
    }, 50);

    const doJoin = () => {
      if (!connected) {
        flashError('Not connected — wait a moment and try again');
        return;
      }
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      joinBtn.disabled = true;
      joinBtn.textContent = 'Joining…';
      net.send({ type: 'join', role: 'player', name });
      // Re-enable after a beat if error/no welcome
      setTimeout(() => {
        if (!joined && joinBtn) {
          joinBtn.disabled = false;
          joinBtn.textContent = 'Join game';
        }
      }, 2000);
    };
    joinBtn.addEventListener('click', doJoin);
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doJoin();
      }
    });
  }

  function showLobby(msg) {
    if (!joined) {
      ensureJoinScreen();
      return;
    }
    const players = (msg && msg.players) || [];
    const listHtml = players.length
      ? players
          .map(
            (p) =>
              `<li><span><span class="swatch" style="background:${p.color}"></span>${escapeHtml(
                p.name
              )}${p.id === playerId ? ' (you)' : ''}</span><span>Seat ${p.seat + 1}</span></li>`
          )
          .join('')
      : '<li>No players yet</li>';

    const existingList = overlayBody.querySelector('#lobby-player-list');
    if (uiPhase === 'lobby' && existingList) {
      existingList.innerHTML = listHtml;
      setOverlayMode('full');
      return;
    }

    uiPhase = 'lobby';
    setOverlayMode('full');
    overlayBody.innerHTML = `
      <div class="panel">
        <h1>Lobby</h1>
        <p>Waiting for organiser to start the next round…</p>
        <ul class="player-list" id="lobby-player-list">
          ${listHtml}
        </ul>
        <button class="btn secondary" id="leave-btn" type="button">Leave / change name</button>
        <p style="margin:10px 0 0;font-size:12px">Organiser starts the round from <strong>/admin.html</strong>.</p>
      </div>`;
    document.getElementById('leave-btn').addEventListener('click', () => {
      net.send({ type: 'leave' });
      const name = resetLocalSession(true);
      ensureJoinScreen(name);
      updateHud();
    });
  }

  function showCountdown(value) {
    const n = Math.max(1, Math.ceil(value || 0));
    setOverlayMode('full');
    overlayBody.innerHTML = `<div class="panel"><div class="big-countdown">${n}</div><p style="text-align:center;margin:0">Get ready!</p></div>`;
  }

  function showResults(ranking, winner) {
    // Prefer full ranking with hits; fall back to live player columns from last state
    let list = ranking || [];
    if ((!list.length || !list.some((p) => p.hits && p.hits.length)) && latestState) {
      if (latestState.results && latestState.results.length) list = latestState.results;
      else if (latestState.players && latestState.players.length) {
        list = [...latestState.players]
          .map((p) => ({
            id: p.id,
            name: p.name,
            color: p.color,
            seat: p.seat,
            score: p.score,
            hits: p.hits || [],
          }))
          .sort((a, b) => b.score - a.score || (a.seat || 0) - (b.seat || 0));
      }
    }

    let winnerHtml = '';
    if (winner) {
      if (winner.tie && winner.names && winner.names.length > 1) {
        winnerHtml = `
          <div class="winner-banner">
            <div class="winner-title">It's a tie!</div>
            <div class="winner-name">${winner.names.map(escapeHtml).join(' · ')}</div>
            <div class="winner-score">${winner.score} points</div>
          </div>`;
      } else {
        const youWon = winner.id === playerId || (winner.ids && winner.ids.includes(playerId));
        winnerHtml = `
          <div class="winner-banner">
            <div class="winner-title">${youWon ? 'You win!' : 'Winner'}</div>
            <div class="winner-name" style="color:${winner.color || '#fde68a'}">${escapeHtml(winner.name)}</div>
            <div class="winner-score">${winner.score} points</div>
          </div>`;
      }
    }

    const playerCards = list
      .map((p, i) => {
        const hits = p.hits || [];
        const hitsHtml = hits.length
          ? `<ul class="results-hits">
              ${hits
                .map(
                  (h) =>
                    `<li><span>${escapeHtml(h.name)}${h.qty > 1 ? ` ×${h.qty}` : ''}</span><span class="hit-pts">${h.total}</span></li>`
                )
                .join('')}
            </ul>`
          : `<p class="results-no-hits">No hits</p>`;
        return `
          <div class="results-player-card" style="--col:${p.color || '#38bdf8'}">
            <div class="results-player-head">
              <span>${i + 1}. <span class="swatch" style="background:${p.color}"></span>${escapeHtml(p.name)}${
                p.id === playerId ? ' (you)' : ''
              }</span>
              <strong>${p.score}</strong>
            </div>
            ${hitsHtml}
          </div>`;
      })
      .join('');

    // Compact bottom popup — game stays visible behind
    setOverlayMode('popup');
    overlayBody.innerHTML = `
      <div class="panel panel-popup panel-popup-hits">
        <h1>Time's up!</h1>
        ${winnerHtml}
        <div class="results-hits-grid">
          ${playerCards || '<p class="results-no-hits">No scores</p>'}
        </div>
        <p>Waiting for next round…</p>
        <button class="btn secondary" id="leave-results-btn" type="button">Leave / change name</button>
      </div>`;
    document.getElementById('leave-results-btn').addEventListener('click', () => {
      net.send({ type: 'leave' });
      const name = resetLocalSession(true);
      ensureJoinScreen(name);
      updateHud();
    });
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
    overlay.classList.remove('overlay-popup');
  }

  function flashError(message) {
    setOverlayMode('full');
    const prev = uiPhase;
    const wasJoined = joined;
    overlayBody.innerHTML = `
      <div class="panel">
        <h1>Oops</h1>
        <p>${escapeHtml(message || 'Error')}</p>
        <button class="btn" id="err-ok" type="button">OK</button>
      </div>`;
    document.getElementById('err-ok').onclick = () => {
      // After errors (e.g. lobby full), always allow name entry again
      if (!wasJoined || /full|join|connect/i.test(message || '')) {
        resetLocalSession(true);
        ensureJoinScreen(playerMeta && playerMeta.name);
      } else if (prev === 'results' && latestState && latestState.phase === 'results') {
        uiPhase = 'results';
        showResults(latestState.results, latestState.winner);
      } else if (latestState && wasJoined) {
        applyPhaseUi(latestState.phase, latestState);
      } else {
        ensureJoinScreen();
      }
    };
  }

  function handleEvents(events) {
    for (const ev of events) {
      if (ev.type === 'hit') {
        const me = ((latestState && latestState.players) || []).find((p) => p.id === ev.playerId);
        renderer.addHitFx(ev.x, ev.y, ev.points, me ? me.color : '#fde68a');
      } else if (ev.type === 'shot') {
        renderer.addShotFx(ev.x, ev.y);
      }
    }
  }

  function updateHud(force) {
    const phase = joined
      ? (latestState && latestState.phase) || (lobby && lobby.phase) || 'lobby'
      : 'join';
    const timeLeft = latestState ? latestState.timeLeft : 60;
    const me =
      joined && latestState && latestState.players
        ? latestState.players.find((p) => p.id === playerId)
        : null;

    let timerText = '—';
    if (phase === 'playing') timerText = `${Math.ceil(timeLeft)}s`;
    else if (phase === 'countdown') timerText = 'Get ready';
    else if (phase === 'results') timerText = 'Finished';
    else if (phase === 'lobby') timerText = 'Lobby';

    const scoreBit = me
      ? `You: ${me.score}`
      : joined
        ? (playerMeta && playerMeta.name) || 'Player'
        : 'Enter name';
    const key = `${connected}|${phase}|${timerText}|${scoreBit}`;
    const now = performance.now();
    // Avoid rewriting HUD DOM 15×/sec — only when values change (or forced)
    if (!force && key === lastHudKey && now - lastHudAt < 250) return;
    lastHudKey = key;
    lastHudAt = now;

    hudLeft.innerHTML = `
      <div class="hud-card">
        <div><span class="status-dot ${connected ? 'ok' : ''}"></span>${connected ? 'Connected' : 'Reconnecting…'}</div>
        <div><strong>${formatPhase(phase)}</strong></div>
      </div>`;

    hudRight.innerHTML = `
      <div class="hud-card" style="text-align:right">
        <div>${timerText}</div>
        <div>${
          me
            ? `You: <strong>${me.score}</strong>`
            : joined
              ? escapeHtml((playerMeta && playerMeta.name) || 'Player')
              : 'Enter name'
        }</div>
      </div>`;
  }

  function formatPhase(phase) {
    if (phase === 'playing') return 'FIGHT';
    if (phase === 'countdown') return 'COUNTDOWN';
    if (phase === 'results') return 'RESULTS';
    if (phase === 'lobby') return 'LOBBY';
    return 'JOIN';
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    input.tickKeyboard(dt);
    renderer.updateFx(dt);
    input.setFixedX(fixedX);

    if (joined && connected && now - lastInputSent > 33) {
      lastInputSent = now;
      const s = input.state;
      net.send({
        type: 'input',
        angle: s.angle,
        shooting: s.shooting && latestState && latestState.phase === 'playing',
      });
    }

    // Always attach local world so renderer never skips a frame
    const baseState = latestState
      ? { ...latestState, world: latestState.world || world }
      : { world, players: [], saucers: [], bullets: [] };

    if (joined && playerId && baseState.players) {
      const meServer = baseState.players.find((p) => p.id === playerId);
      if (meServer) fixedX = meServer.x;
      renderer.draw(
        {
          ...baseState,
          players: baseState.players.map((p) =>
            p.id === playerId ? { ...p, x: fixedX, angle: input.state.angle } : p
          ),
        },
        playerId
      );
    } else {
      renderer.draw(baseState, null);
    }

    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', () => renderer.resize(world));
  renderer.resize(world);
  // Always start at name entry on load / refresh
  showJoin();
  net.connect();
  requestAnimationFrame(loop);

  document.addEventListener(
    'touchmove',
    (e) => {
      const t = e.target;
      if (t && t.closest) {
        if (t.closest('#overlay')) return;
        if (t.closest('input, textarea, select, button, label')) return;
      }
      e.preventDefault();
    },
    { passive: false }
  );

  window.addEventListener(
    'keydown',
    (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') e.stopPropagation();
    },
    true
  );
})();
