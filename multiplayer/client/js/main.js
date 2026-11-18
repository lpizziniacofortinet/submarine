(function () {
  'use strict';

  const defaultWs = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host || '127.0.0.1:9000'}/ws`;
  const wsInput = document.getElementById('input-ws-url');
  wsInput.value = defaultWs;

  const renderer = new window.MultiStationRenderer();
  let activeStation = 'tactical';
  let selectedContactId = null;
  let lastSnapshot = null;
  let snapshotHz = 10;

  function logEvent(text, level = 'info') {
    const logEl = document.getElementById('event-log');
    const row = document.createElement('div');
    const ts = new Date().toLocaleTimeString();
    row.style.color = level === 'err' ? 'var(--crt-red)' : level === 'ok' ? 'var(--crt-green)' : 'var(--crt-cyan)';
    row.textContent = `[${ts}] ${text}`;
    logEl.prepend(row);
    while (logEl.children.length > 60) logEl.removeChild(logEl.lastChild);
  }

  function switchStation(station) {
    activeStation = station;
    document.querySelectorAll('.station-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.station === station);
    });
    document.querySelectorAll('.station-screen').forEach((scr) => {
      scr.classList.toggle('active', scr.id === `screen-${station}`);
    });
    if (station === 'tactical' && renderer.leafletMap) {
      setTimeout(() => renderer.leafletMap.invalidateSize(), 40);
    }
    renderer.renderActiveStation(activeStation, selectedContactId);
  }

  function updateUI(snap) {
    lastSnapshot = snap;
    const sub = snap.ownSub;
    const env = snap.environment;

    document.getElementById('val-world-id').textContent = snap.worldId;
    document.getElementById('dmg-world').textContent = snap.worldId;
    document.getElementById('hud-hdg').textContent = `${Math.round(sub.headingDeg).toString().padStart(3, '0')}°`;
    document.getElementById('hud-spd').textContent = `${sub.speedKts.toFixed(1)} KT`;
    document.getElementById('hud-dep').textContent = `${sub.depthM.toFixed(0)} m`;
    document.getElementById('hud-seabed').textContent = `${env.waterDepthM.toFixed(0)} m`;
    document.getElementById('hud-hull').textContent = `${sub.hullIntegrityPct.toFixed(0)}%`;
    document.getElementById('dmg-hull').textContent = `${sub.hullIntegrityPct.toFixed(0)}%`;
    const hullFill = document.getElementById('status-hull-fill');
    if (hullFill) hullFill.style.width = `${Math.max(0, Math.min(100, sub.hullIntegrityPct))}%`;
    document.getElementById('hud-sim-time').textContent = `${snap.simTimeSec.toFixed(1)} s`;
    document.getElementById('val-snap-seq').textContent = `SEQ ${snap.snapshotSeq}`;
    document.getElementById('val-last-snap').textContent = new Date().toLocaleTimeString();

    document.getElementById('sub-pos').textContent = `${sub.lat.toFixed(4)}°N ${sub.lon.toFixed(4)}°E`;
    document.getElementById('sub-torps').textContent = `${sub.torpedoesRemaining} / ${sub.decoysRemaining}`;
    document.getElementById('weps-torp-count').textContent = sub.torpedoesRemaining;
    document.getElementById('weps-decoy-count').textContent = sub.decoysRemaining;

    const cav = Math.abs(sub.speedKts) > 16 && sub.depthM < 80;
    const hostileTorp = (snap.weapons || []).some((w) => w.ownerId !== sub.id);
    document.getElementById('ann-cavitating').className = `annunciator ${cav ? 'crit-active' : ''}`;
    document.getElementById('ann-thermocline').className = `annunciator ${sub.depthM > env.thermoclineM ? 'warn-active' : ''}`;
    document.getElementById('ann-ping').className = `annunciator ${sub.activePingCooldownSec > 5 ? 'warn-active' : ''}`;
    document.getElementById('ann-torpedo').className = `annunciator ${hostileTorp ? 'crit-active' : ''}`;
    document.getElementById('ann-hull').className = `annunciator ${sub.hullIntegrityPct <= 50 ? 'crit-active' : ''}`;

    const cavLbl = document.getElementById('sidebar-cav-warn');
    cavLbl.textContent = cav ? 'CAVITATING!' : 'QUIET';
    cavLbl.style.color = cav ? 'var(--crt-red)' : 'var(--crt-green)';

    document.getElementById('val-env').textContent = `SEA ${env.seaState} | LAYER ${env.thermoclineM}m | SEABED ${env.waterDepthM}m`;
    document.getElementById('env-sea-state').textContent = `SS-${env.seaState}`;
    document.getElementById('env-wind').textContent = `${env.windSpeedKts} KT @ ${env.windDirDeg}°`;
    document.getElementById('env-layer').textContent = `${env.thermoclineM} m`;
    document.getElementById('env-seabed').textContent = `${env.waterDepthM} m`;
    document.getElementById('env-clearance').textContent = `${Math.max(0, Math.round(env.waterDepthM - sub.depthM))} m`;
    document.getElementById('env-towed').textContent = sub.towedArrayDeployed ? 'STREAMED (22 KT CAP)' : 'RETRACTED';
    document.getElementById('svp-layer-label').textContent = `LAYER ${env.thermoclineM}m`;

    const arrBtn = document.getElementById('btn-toggle-array');
    arrBtn.classList.toggle('active', sub.towedArrayDeployed);
    arrBtn.textContent = `TB-29A ARRAY: ${sub.towedArrayDeployed ? 'DEPLOYED' : 'RETRACTED'}`;

    const contacts = snap.contacts || [];
    document.getElementById('contact-count').textContent = contacts.length;
    const tbody = document.getElementById('contacts-table-body');
    if (contacts.length === 0) {
      if (tbody.dataset.empty !== '1') {
        tbody.innerHTML = '<tr><td colspan="4" class="muted">No tracks detected.</td></tr>';
        tbody.dataset.empty = '1';
      }
    } else {
      const idsKey = contacts.map((c) => c.id).join(',');
      if (tbody.dataset.idsKey !== idsKey) {
        tbody.dataset.empty = '0';
        tbody.dataset.idsKey = idsKey;
        tbody.innerHTML = '';
        for (const c of contacts) {
          const tr = document.createElement('tr');
          tr.dataset.contactId = c.id;
          tr.innerHTML = '<td></td><td></td><td></td><td></td>';
          tr.addEventListener('click', () => {
            selectedContactId = selectedContactId === c.id ? null : c.id;
            if (lastSnapshot) updateUI(lastSnapshot);
            renderer.renderActiveStation(activeStation, selectedContactId);
          });
          tbody.appendChild(tr);
        }
      }
      for (const c of contacts) {
        const tr = tbody.querySelector(`tr[data-contact-id="${c.id}"]`);
        if (!tr) continue;
        tr.classList.toggle('selected', c.id === selectedContactId);
        const rngTxt = c.ranged && c.rangeNm !== null ? `${c.rangeNm.toFixed(1)}NM` : `TMA ${c.tmaQualityPct}%`;
        const cells = tr.children;
        cells[0].textContent = c.id;
        cells[1].textContent = c.category;
        cells[2].textContent = `${c.bearingDeg.toFixed(0)}°`;
        cells[3].textContent = rngTxt;
      }
    }

    const sel = contacts.find((c) => c.id === selectedContactId) || null;
    document.getElementById('sonar-spectrum-target').textContent = sel ? `ANALYZING ${sel.id}` : 'NO TRACK SELECTED';
    document.getElementById('tma-track-id').textContent = sel ? sel.id : '--';
    document.getElementById('tma-desig').textContent = sel ? sel.designation : '--';
    document.getElementById('tma-brg').textContent = sel ? `${sel.bearingDeg.toFixed(1)}°` : '--';
    document.getElementById('tma-snr').textContent = sel ? `+${sel.snrDb.toFixed(1)} dB` : '--';
    document.getElementById('tma-quality').textContent = sel ? `${sel.tmaQualityPct}%` : '--';
    document.getElementById('tma-range').textContent = sel && sel.ranged && sel.rangeNm !== null ? `${sel.rangeNm.toFixed(2)} NM` : 'PASSIVE BRG ONLY';
    document.getElementById('tma-crs-spd').textContent = sel && sel.ranged ? `${Math.round(sel.headingDeg)}° / ${sel.speedKts.toFixed(0)} KT` : '-- / --';
    document.getElementById('fc-selected-target').textContent = sel ? `${sel.id} (${sel.bearingDeg.toFixed(0)}°)` : 'NO TARGET';
  }

  let latestTick = 0;
  let latestRtt = '--';

  const net = new window.TacticalNetworkClient({
    onStatusChange(status) {
      const pill = document.getElementById('conn-pill');
      pill.textContent = status === 'CONNECTED' ? 'ONLINE' : status;
      const connectionClass = status === 'CONNECTED' ? 'online' : status === 'CONNECTING' ? 'connecting' : 'offline';
      pill.className = `pill ${connectionClass}`;
      const indicator = document.querySelector('.state-indicator');
      if (indicator) indicator.className = `state-indicator ${connectionClass}`;
      const telemetryLink = document.getElementById('telemetry-live');
      const telemetryLabel = document.getElementById('telemetry-link-label');
      if (telemetryLink) telemetryLink.className = `telemetry-live ${connectionClass}`;
      if (telemetryLabel) telemetryLabel.textContent = status === 'CONNECTED' ? 'LIVE SERVER FEED' : status === 'CONNECTING' ? 'ESTABLISHING LINK' : 'AWAITING SERVER';
      document.getElementById('btn-connect').disabled = status !== 'DISCONNECTED';
      document.getElementById('btn-disconnect').disabled = status === 'DISCONNECTED';
    },
    onLatency(rttMs) {
      latestRtt = `${Math.round(rttMs)}`;
      document.getElementById('val-latency').textContent = `${latestRtt} ms`;
      document.getElementById('hud-tick-rtt').textContent = `${latestTick} / ${latestRtt} ms`;
    },
    onError(errMsg) {
      logEvent(`ERROR: ${errMsg}`, 'err');
    },
    onMessage(msg) {
      if (msg.type === 'WELCOME') {
        snapshotHz = msg.payload.snapshotHz || 10;
        document.getElementById('hud-vessel').textContent = `${msg.payload.vesselId} (${msg.payload.assignedRole})`;
        document.getElementById('val-session-id').textContent = msg.payload.sessionId;
        logEvent(`${msg.payload.reconnected ? 'Reconnected' : 'Connected'} ${msg.payload.vesselId} [${msg.payload.assignedRole}] @ ${msg.payload.worldId}`, 'ok');
      } else if (msg.type === 'WORLD_SNAPSHOT') {
        latestTick = msg.payload.serverTick;
        document.getElementById('hud-tick-rtt').textContent = `${latestTick} / ${latestRtt} ms`;
        renderer.pushSnapshot(msg.payload, snapshotHz);
        updateUI(msg.payload);
      } else if (msg.type === 'WORLD_EVENT') {
        logEvent(`[${msg.payload.category}] ${msg.payload.message}`, msg.payload.category === 'ALERT' ? 'err' : 'info');
        if (msg.payload.message.includes('TORPEDO IN THE WATER')) window.MultiplayerAudio.playTorpedoAlert();
      } else if (msg.type === 'COMMAND_RESULT') {
        const ack = document.getElementById('cmd-ack');
        ack.textContent = `#${msg.sequence} ${msg.payload.accepted ? 'ACK' : 'REJ'}: ${msg.payload.message}`;
        ack.className = `cmd-ack ${msg.payload.accepted ? '' : 'err'}`;
        window.MultiplayerAudio.playBeep(msg.payload.accepted ? 960 : 320, 0.05);
      } else if (msg.type === 'ERROR') {
        logEvent(`SERVER ERROR [${msg.payload.code}]: ${msg.payload.message}`, 'err');
      }
    }
  });

  renderer.initLeafletMap();

  document.querySelectorAll('.station-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchStation(btn.dataset.station));
  });

  document.getElementById('btn-audio-toggle').addEventListener('click', (e) => {
    const on = window.MultiplayerAudio.toggle();
    const audioState = e.currentTarget.querySelector('.audio-state');
    if (audioState) audioState.textContent = on ? 'ON' : 'OFF';
    e.currentTarget.classList.toggle('active', on);
  });

  document.getElementById('btn-connect').addEventListener('click', () => {
    if (!window.MultiplayerAudio.enabled) {
      window.MultiplayerAudio.enable();
      const audioBtn = document.getElementById('btn-audio-toggle');
      const audioState = audioBtn.querySelector('.audio-state');
      if (audioState) audioState.textContent = 'ON';
      audioBtn.classList.add('active');
    }
    net.connect(
      wsInput.value.trim(),
      document.getElementById('input-callsign').value.trim(),
      document.getElementById('select-role').value,
      document.getElementById('input-room-id').value.trim(),
      document.getElementById('select-vessel').value
    );
  });
  document.getElementById('btn-disconnect').addEventListener('click', () => net.disconnect());

  document.getElementById('btn-set-heading').addEventListener('click', () => net.sendCommand('SET_HEADING', Number(document.getElementById('order-heading').value)));
  document.getElementById('btn-set-speed').addEventListener('click', () => net.sendCommand('SET_SPEED', Number(document.getElementById('order-speed').value)));
  document.getElementById('btn-set-depth').addEventListener('click', () => net.sendCommand('SET_DEPTH', Number(document.getElementById('order-depth').value)));
  document.getElementById('btn-active-ping').addEventListener('click', () => {
    if (net.sendCommand('ACTIVE_PING', 1)) window.MultiplayerAudio.playActivePing();
  });
  document.getElementById('btn-toggle-array').addEventListener('click', () => net.sendCommand('TOGGLE_TOWED_ARRAY', 1));
  document.getElementById('btn-deploy-decoy').addEventListener('click', () => net.sendCommand('DEPLOY_DECOY', 1));
  document.getElementById('btn-fire-torp').addEventListener('click', () => net.sendCommand('FIRE_TUBE', Number(document.getElementById('order-torp-brg').value)));
  document.getElementById('btn-sync-torp-brg').addEventListener('click', () => {
    if (!lastSnapshot) return;
    const sel = (lastSnapshot.contacts || []).find((c) => c.id === selectedContactId);
    if (sel) document.getElementById('order-torp-brg').value = Math.round(sel.bearingDeg);
  });

  document.getElementById('btn-sonar-clear-track').addEventListener('click', () => {
    selectedContactId = null;
    if (lastSnapshot) updateUI(lastSnapshot);
    renderer.renderActiveStation(activeStation, selectedContactId);
  });

  const wfCanvas = document.getElementById('sonar-waterfall-canvas');
  wfCanvas.addEventListener('mousemove', (e) => {
    const rect = wfCanvas.getBoundingClientRect();
    if (!rect.width) return;
    const brg = Math.round(((e.clientX - rect.left) / rect.width) * 360) % 360;
    document.getElementById('sonar-cursor-brg').textContent = `BRG: ${brg.toString().padStart(3, '0')}°`;
  });
  wfCanvas.addEventListener('click', (e) => {
    if (!lastSnapshot) return;
    const rect = wfCanvas.getBoundingClientRect();
    if (!rect.width) return;
    const clickBrg = ((e.clientX - rect.left) / rect.width) * 360;
    let best = null;
    let minDiff = 15;
    for (const c of lastSnapshot.contacts || []) {
      const diff = Math.abs(((c.bearingDeg - clickBrg + 540) % 360) - 180);
      if (diff < minDiff) {
        minDiff = diff;
        best = c;
      }
    }
    if (best) {
      selectedContactId = selectedContactId === best.id ? null : best.id;
      updateUI(lastSnapshot);
      renderer.renderActiveStation(activeStation, selectedContactId);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F1') { e.preventDefault(); switchStation('tactical'); }
    if (e.key === 'F2') { e.preventDefault(); switchStation('sonar'); }
    if (e.key === 'F3') { e.preventDefault(); switchStation('weapons'); }
    if (e.key === 'F4') { e.preventDefault(); switchStation('maneuvering'); }
    if (e.key === 'F5') { e.preventDefault(); switchStation('damage'); }
  });

  let lastFrameMs = performance.now();
  function loop(now) {
    const dt = Math.min(0.1, Math.max(0.001, (now - lastFrameMs) / 1000));
    lastFrameMs = now;
    if (lastSnapshot) {
      window.MultiplayerAudio.updateTelemetry(lastSnapshot, selectedContactId, activeStation, dt);
    }
    renderer.renderActiveStation(activeStation, selectedContactId);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
