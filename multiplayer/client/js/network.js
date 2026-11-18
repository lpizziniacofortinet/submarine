(function (root) {
  'use strict';

  class TacticalNetworkClient {
    constructor(callbacks) {
      this.callbacks = callbacks || {};
      this.ws = null;
      this.wsUrl = '';
      this.clientName = 'CONN-ALPHA';
      this.sessionId = null;
      this.cmdSeq = 1;
      this.manualClose = false;
      this.pingTimer = null;
      this.reconnectTimer = null;
    }

    connect(wsUrl, clientName) {
      this.manualClose = false;
      this.wsUrl = wsUrl;
      this.clientName = clientName || 'CONN-ALPHA';
      this._clearTimers();

      if (this.ws) {
        try { this.ws.close(); } catch (_) {}
      }

      this._setStatus('CONNECTING');
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        ws.send(root.MultiplayerProtocol.buildHello(this.clientName, this.sessionId));
        this.pingTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(root.MultiplayerProtocol.buildPing(performance.now()));
          }
        }, 2000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = root.MultiplayerProtocol.parseServerMessage(event.data);
          if (msg.type === 'WELCOME') {
            this.sessionId = msg.payload.sessionId;
            this._setStatus('CONNECTED');
          } else if (msg.type === 'PONG') {
            const rtt = Math.max(0, performance.now() - msg.payload.clientTimeMs);
            if (this.callbacks.onLatency) this.callbacks.onLatency(rtt);
          }
          if (this.callbacks.onMessage) this.callbacks.onMessage(msg);
        } catch (err) {
          if (this.callbacks.onError) this.callbacks.onError(err.message);
        }
      };

      ws.onclose = () => {
        this._clearTimers();
        this._setStatus('DISCONNECTED');
        if (!this.manualClose) {
          this.reconnectTimer = setTimeout(() => this.connect(this.wsUrl, this.clientName), 2500);
        }
      };

      ws.onerror = () => {
        if (this.callbacks.onError) this.callbacks.onError('WebSocket transport error');
      };
    }

    disconnect() {
      this.manualClose = true;
      this._clearTimers();
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this._setStatus('DISCONNECTED');
    }

    sendCommand(command, value) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
      const seq = this.cmdSeq++;
      this.ws.send(root.MultiplayerProtocol.buildCommand(seq, command, value));
      return true;
    }

    _setStatus(status) {
      if (this.callbacks.onStatusChange) this.callbacks.onStatusChange(status);
    }

    _clearTimers() {
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    }
  }

  root.TacticalNetworkClient = TacticalNetworkClient;
})(window);
