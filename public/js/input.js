(function (global) {
  function createInput(aimPad, shootBtn, world) {
    const state = {
      x: world.width / 2,
      angle: 0,
      shooting: false,
      active: false,
    };

    let pointerId = null;
    const knob = document.getElementById('aim-knob');
    const track = aimPad.querySelector('.aim-track') || aimPad;

    function clamp(v, min, max) {
      return Math.max(min, Math.min(max, v));
    }

    function syncKnobFromAngle() {
      if (!knob) return;
      // angle −90…90 → left 0%…right 100% of track
      const t = (state.angle + 90) / 180;
      knob.style.left = `${clamp(t, 0, 1) * 100}%`;
    }

    function updateFromLocal(clientX) {
      const rect = track.getBoundingClientRect();
      const t = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      // left = −90°, center = 0°, right = +90°
      state.angle = clamp(t * 180 - 90, -90, 90);
      syncKnobFromAngle();
    }

    function onDown(e) {
      e.preventDefault();
      pointerId = e.pointerId;
      aimPad.setPointerCapture(pointerId);
      state.active = true;
      updateFromLocal(e.clientX);
    }

    function onMove(e) {
      if (pointerId !== e.pointerId) return;
      e.preventDefault();
      updateFromLocal(e.clientX);
    }

    function onUp(e) {
      if (pointerId !== e.pointerId) return;
      pointerId = null;
      state.active = false;
      // keep slider where released (aim stays)
    }

    aimPad.addEventListener('pointerdown', onDown);
    aimPad.addEventListener('pointermove', onMove);
    aimPad.addEventListener('pointerup', onUp);
    aimPad.addEventListener('pointercancel', onUp);

    function shootStart(e) {
      e.preventDefault();
      state.shooting = true;
      shootBtn.classList.add('pressed');
    }
    function shootEnd(e) {
      e.preventDefault();
      state.shooting = false;
      shootBtn.classList.remove('pressed');
    }

    shootBtn.addEventListener('pointerdown', shootStart);
    shootBtn.addEventListener('pointerup', shootEnd);
    shootBtn.addEventListener('pointerleave', shootEnd);
    shootBtn.addEventListener('pointercancel', shootEnd);

    const keys = new Set();
    function typingInField(el) {
      if (!el) return false;
      const tag = (el.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || el.isContentEditable;
    }
    window.addEventListener('keydown', (e) => {
      if (typingInField(e.target)) return;
      keys.add(e.key.toLowerCase());
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        state.shooting = true;
        shootBtn.classList.add('pressed');
      }
    });
    window.addEventListener('keyup', (e) => {
      if (typingInField(e.target)) return;
      keys.delete(e.key.toLowerCase());
      if (e.key === ' ' || e.key === 'Spacebar') {
        state.shooting = false;
        shootBtn.classList.remove('pressed');
      }
    });

    function tickKeyboard(dt) {
      if (keys.has('a') || keys.has('arrowleft') || keys.has('q')) state.angle -= 120 * dt;
      if (keys.has('d') || keys.has('arrowright') || keys.has('e')) state.angle += 120 * dt;
      if (keys.has('w') || keys.has('arrowup')) state.angle *= Math.max(0, 1 - 2 * dt);
      state.angle = clamp(state.angle, -90, 90);
      syncKnobFromAngle();
    }

    syncKnobFromAngle();

    return {
      state,
      tickKeyboard,
      setWorld(w) {
        world = w;
      },
      setFixedX(x) {
        state.x = x;
      },
      setAngle(angle) {
        state.angle = clamp(angle, -90, 90);
        syncKnobFromAngle();
      },
      setPos(x, angle) {
        state.x = x;
        state.angle = clamp(angle, -90, 90);
        syncKnobFromAngle();
      },
    };
  }

  global.SRInput = { createInput };
})(window);
