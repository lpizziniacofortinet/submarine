(function () {
  'use strict';

  const defaultWs = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host || '127.0.0.1:9000'}/ws`;
  const wsInput = document.getElementById('input-ws-url');
  wsInput.value = defaultWs;

  const renderer = new window.TacticalCanvasRenderer('tactical-canvas');
  const waterfall = new window.SonarWaterfallRenderer('sonar-waterfall-canvas');
  let snapshotHz = 10;

  function logEvent(text, level = 'info') {
    const logEl = document.getElementById('event-log');
    const row = document.createElement('div');
    const ts = new Date().toLocaleTimeString();
    row.style.color = level === 'err' ? 'var(--red)' : level === 'ok' ? 'var(--green)' : 'var(--cyan)';
    row.textContent = `[${ts}] ${text}`;
    logEl.prepend(row);
    while (logEl.children.length > 50) logEl.removeChild(logEl.lastChild);
  }

  function updateSnapshotUI(snap) {
    document.getElementById('val-world-id').textContent = snap.worldId;
    document.getElementById('val-tick').textContent = snap.serverTick;
    document.getElementById('val-sim-time').textContent = `${snap.simTimeSec.toFixed(1)} s`;
    document.getElementById('val-snap-seq').textContent = snap.snapshotSeq;
    document.getElementById('val-last-snap').textContent = new Date().toLocaleTimeString();

    const sub = snap.ownSub;
    document.getElementById('sub-pos').textContent = `${sub.lat.toFixed(4)}°N, ${sub.lon.toFixed(4)}°E`;
    document.getElementById('sub-hdg').textContent = `${sub.headingDeg.toFixed(1)}° / ${sub.orderedHeadingDeg.toFixed(0)}°`;
    document.getElementById('sub-spd').textContent = `${sub.speedKts.toFixed(1)} / ${sub.orderedSpeedKts.toFixed(1)} KT`;
    document.getElementById('sub-dep').textContent = `${sub.depthM.toFixed(1)} / ${sub.orderedDepthM.toFixed(0)} m`;
    document.getElementById('sub-hull').textContent = `${sub.hullIntegrityPct.toFixed(0)}%`;
    document.getElementById('sub-torps').textContent = `${sub.torpedoesRemaining} TORP / ${sub.decoysRemaining} ADC`;
    document.getElementById('val-towed').textContent = `TOWED ARRAY: ${sub.towedArrayDeployed ? 'DEPLOYED' : 'RETRACTED'}`;

    const env = snap.environment;
    document.getElementById('val-env').textContent =
      `SEA STATE ${env.seaState} | LAYER ${env.thermoclineM}m | SEABED ${env.waterDepthM}m`;

    const listEl = document.getElementById('contacts-list');
    const contacts = snap.contacts || [];
    document.getElementById('contact-count').textContent = contacts.length;
    listEl.innerHTML = '';
    if (contacts.length === 0) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = 'No client-visible contacts.';
      listEl.appendChild(li);
    } else {
      for (const c of contacts) {
        const li = document.createElement('li');
        li.className = c.allegiance === 'HOSTILE' ? 'hostile' : 'neutral';
        const rangeText = c.ranged && c.rangeNm !== null ? `${c.rangeNm.toFixed(1)} NM` : `PASSIVE (TMA ${c.tmaQualityPct}%)`;
        li.textContent = `${c.id} | ${c.designation} | BRG ${c.bearingDeg.toFixed(0)}° | ${rangeText} | SNR +${c.snrDb.toFixed(1)} dB`;
        listEl.appendChild(li);
      }
    }
  }

  const net = new window.TacticalNetworkClient({
    onStatusChange(status) {
      const pill = document.getElementById('conn-pill');
      pill.textContent = status;
      pill.className = `pill ${status === 'CONNECTED' ? 'online' : status === 'CONNECTING' ? 'connecting' : 'offline'}`;
      document.getElementById('btn-connect').disabled = status !== 'DISCONNECTED';
      document.getElementById('btn-disconnect').disabled = status === 'DISCONNECTED';
    },
    onLatency(rttMs) {
      document.getElementById('val-latency').textContent = `${Math.round(rttMs)} ms`;
    },
    onError(errMsg) {
      logEvent(`ERROR: ${errMsg}`, 'err');
    },
    onMessage(msg) {
      if (msg.type === 'WELCOME') {
        snapshotHz = msg.payload.snapshotHz || 10;
        document.getElementById('val-role').textContent = msg.payload.assignedRole || 'COMMANDER';
        document.getElementById('val-session-id').textContent = msg.payload.sessionId.slice(0, 8);
        logEvent(
          `${msg.payload.reconnected ? 'Reconnected' : 'Connected'} as ${msg.payload.assignedRole} to ${msg.payload.worldId} (${msg.payload.simHz}Hz sim / ${snapshotHz}Hz snap)`,
          'ok'
        );
      } else if (msg.type === 'WORLD_SNAPSHOT') {
        renderer.pushSnapshot(msg.payload, snapshotHz);
        waterfall.step(msg.payload);
        updateSnapshotUI(msg.payload);
      } else if (msg.type === 'WORLD_EVENT') {
        logEvent(`[${msg.payload.category}] ${msg.payload.message}`, 'info');
      } else if (msg.type === 'COMMAND_RESULT') {
        const ack = document.getElementById('cmd-ack');
        ack.textContent = `#${msg.sequence} ${msg.payload.accepted ? 'ACCEPTED' : 'REJECTED'}: ${msg.payload.message}`;
        ack.className = `cmd-ack ${msg.payload.accepted ? '' : 'err'}`;
        logEvent(ack.textContent, msg.payload.accepted ? 'ok' : 'err');
      } else if (msg.type === 'ERROR') {
        logEvent(`SERVER ERROR [${msg.payload.code}]: ${msg.payload.message}`, 'err');
      }
    }
  });

  document.getElementById('btn-connect').addEventListener('click', () => {
    net.connect(
      wsInput.value.trim(),
      document.getElementById('input-callsign').value.trim(),
      document.getElementById('select-role').value,
      document.getElementById('input-room-id').value.trim(),
      document.getElementById('select-vessel').value
    );
  });
  document.getElementById('btn-disconnect').addEventListener('click', () => net.disconnect());

  document.getElementById('btn-set-heading').addEventListener('click', () => {
    net.sendCommand('SET_HEADING', Number(document.getElementById('order-heading').value));
  });
  document.getElementById('btn-set-speed').addEventListener('click', () => {
    net.sendCommand('SET_SPEED', Number(document.getElementById('order-speed').value));
  });
  document.getElementById('btn-set-depth').addEventListener('click', () => {
    net.sendCommand('SET_DEPTH', Number(document.getElementById('order-depth').value));
  });
  document.getElementById('btn-fire-torp').addEventListener('click', () => {
    net.sendCommand('FIRE_TUBE', Number(document.getElementById('order-torp-brg').value));
  });
  document.getElementById('btn-active-ping').addEventListener('click', () => {
    net.sendCommand('ACTIVE_PING', 1);
  });
  document.getElementById('btn-toggle-array').addEventListener('click', () => {
    net.sendCommand('TOGGLE_TOWED_ARRAY', 1);
  });
  document.getElementById('btn-deploy-decoy').addEventListener('click', () => {
    net.sendCommand('DEPLOY_DECOY', 1);
  });

  function renderLoop() {
    renderer.render();
    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);
})();
