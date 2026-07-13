(function (global) {
  function createNet(handlers = {}) {
    let ws = null;
    let reconnectTimer = null;
    let closedByUser = false;

    function url() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      return `${proto}://${location.host}`;
    }

    function connect() {
      closedByUser = false;
      ws = new WebSocket(url());

      ws.addEventListener('open', () => {
        handlers.onOpen && handlers.onOpen();
      });

      ws.addEventListener('message', (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        handlers.onMessage && handlers.onMessage(msg);
      });

      ws.addEventListener('close', () => {
        handlers.onClose && handlers.onClose();
        if (!closedByUser) {
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, 1200);
        }
      });

      ws.addEventListener('error', () => {
        // close will fire after
      });
    }

    function send(obj) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
      }
    }

    function close() {
      closedByUser = true;
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    }

    return { connect, send, close };
  }

  global.SRNet = { createNet };
})(window);
