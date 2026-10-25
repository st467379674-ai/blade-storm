export class Net {
  constructor() {
    this.ws = null;
    this.joined = false;
    this.closedByUser = false;
    this.seq = 0;
    this.pingTimer = null;
    this.onWelcome = null;
    this.onState = null;
    this.onError = null;
    this.onClose = null;
    this.onPing = null;
  }

  connect(name, mode = 'create', roomCode = '') {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws`;
    this.ws = new WebSocket(url);
    this.joined = false;
    this.closedByUser = false;

    this.ws.addEventListener('open', () => {
      if (mode === 'join') {
        this.send({ type: 'join', name, roomCode });
      } else if (mode === 'quick') {
        this.send({ type: 'join', name });
      } else {
        this.send({ type: 'create', name });
      }
      this.pingTimer = window.setInterval(() => this.ping(), 3000);
      this.ping();
    });

    this.ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'welcome') {
        this.joined = true;
        this.onWelcome?.(msg);
      } else if (msg.type === 'state') {
        this.onState?.(msg);
      } else if (msg.type === 'pong') {
        const rtt = performance.now() - msg.t;
        this.onPing?.(Math.max(0, Math.round(rtt)));
      } else if (msg.type === 'error') {
        this.onError?.(msg.message || '连接失败');
      }
    });

    this.ws.addEventListener('error', () => {
      this.onError?.('无法连接擂台，请确认服务器已启动');
    });

    this.ws.addEventListener('close', (event) => {
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      this.onClose?.({ code: event.code, reason: event.reason, manual: this.closedByUser });
    });
  }

  ping() {
    this.send({ type: 'ping', t: performance.now() });
  }

  sendInput(mx, mz, dash) {
    this.send({ type: 'input', seq: ++this.seq, mx, mz, dash });
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  close() {
    this.closedByUser = true;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.ws?.close(1000, 'bye');
  }
}
