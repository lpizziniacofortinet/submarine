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
  let latestTick = 0;
  let latestRtt = '--';

  function formatZuluTime(sec) {
    const total = Math.floor(4 * 3600 + 15 * 60 + sec) % 86400;
    const hh = Math.floor(total / 3600).toString().padStart(2, '0');
    const mm = Math.floor((total % 3600) / 60).toString().padStart(2, '0');
    const ss = (total % 60).toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}Z`;
  }

  function logEvent(text, level = 'info') {
    const logEl = document.getElementById('event-log');
    if (!logEl) return;
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

    document.getElementById('hud-clock').textContent = formatZuluTime(snap.simTimeSec);
    document.getElementById('hud-hull').textContent = `${sub.hullIntegrityPct.toFixed(0)}%`;
    document.getElementById('hud-latlon').textContent = `LAT ${sub.lat.toFixed(4)}°N | LON ${sub.lon.toFixed(4)}°E (MEDITERRANEAN)`;
    document.getElementById('hud-thermocline').textContent = `THERMAL LAYER: ${env.thermoclineM}m`;
    document.getElementById('hud-hdg').textContent = `${Math.round(sub.headingDeg).toString().padStart(3, '0')}° (${Math.round(sub.orderedHeadingDeg).toString().padStart(3, '0')}°)`;
    document.getElementById('hud-spd').textContent = `${sub.speedKts.toFixed(1)} KT (${sub.orderedSpeedKts.toFixed(0)} KT)`;
    document.getElementById('hud-depth').textContent = `${sub.depthM.toFixed(0)}m (${sub.orderedDepthM.toFixed(0)}m)`;
    document.getElementById('hud-seafloor').textContent = `${env.waterDepthM.toFixed(0)}m`;
    document.getElementById('hud-pitch').textContent = sub.towedArrayDeployed ? 'DEPLOYED' : 'RETRACTED';

    const cav = Math.abs(sub.speedKts) > 16 && sub.depthM < 80;
    const estNoise = Math.round(92 + Math.abs(sub.speedKts) * 1.4 + (cav ? 14 : 0));
    document.getElementById('hud-noise').textContent = `${estNoise} dB (${cav ? 'CAV!' : 'QUIET'})`;
    document.getElementById('hud-rx-power').textContent = snap.worldId;
    document.getElementById('hud-rx-temp').textContent = `SEQ ${snap.snapshotSeq} / ${latestRtt} ms`;
    document.getElementById('hud-sim-rate').textContent = `TICK ${snap.serverTick} // ${latestRtt} ms`;

    document.getElementById('tac-mission-code').textContent = snap.worldId;
    document.getElementById('val-world-id').textContent = snap.worldId;
    document.getElementById('dmg-world').textContent = snap.worldId;
    document.getElementById('val-snap-seq').textContent = snap.snapshotSeq;
    document.getElementById('val-last-snap').textContent = new Date().toLocaleTimeString();
    document.getElementById('dmg-hull').textContent = `${sub.hullIntegrityPct.toFixed(0)}%`;
    document.getElementById('dc-hull-integrity').textContent = `${sub.hullIntegrityPct.toFixed(0)}%`;
    document.getElementById('dc-hull-bar').style.width = `${sub.hullIntegrityPct}%`;

    document.getElementById('env-water-depth').textContent = `${env.waterDepthM} m`;
    document.getElementById('env-clearance').textContent = `${Math.max(0, Math.round(env.waterDepthM - sub.depthM))} m`;
    document.getElementById('env-layer-depth').textContent = `${env.thermoclineM} m`;
    document.getElementById('env-sea-state').textContent = `SS ${env.seaState}`;
    document.getElementById('env-sea-state-man').textContent = `SS ${env.seaState}`;
    document.getElementById('env-wind').textContent = `${env.windSpeedKts} KT @ ${env.windDirDeg}°`;
    document.getElementById('env-layer').textContent = `${env.thermoclineM} m`;
    document.getElementById('env-seabed').textContent = `${env.waterDepthM} m`;
    document.getElementById('env-towed').textContent = sub.towedArrayDeployed ? 'STREAMED (22 KT CAP)' : 'RETRACTED';
    document.getElementById('env-towed-status').textContent = sub.towedArrayDeployed ? 'STREAMED (800m)' : 'RETRACTED';
    document.getElementById('svp-layer-label').textContent = `LAYER ${env.thermoclineM}m`;

    document.getElementById('weps-torp-count').textContent = sub.torpedoesRemaining;
    document.getElementById('weps-decoy-count').textContent = sub.decoysRemaining;

    const hostileTorp = (snap.weapons || []).some((w) => w.ownerId !== sub.id);
    document.getElementById('ann-cavitating').className = `annunciator ${cav ? 'crit-active' : ''}`;
    document.getElementById('ann-thermocline').className = `annunciator ${sub.depthM > env.thermoclineM ? 'warn-active' : ''}`;
    document.getElementById('ann-active-sonar').className = `annunciator ${sub.activePingCooldownSec > 5 ? 'warn-active' : ''}`;
    document.getElementById('ann-torpedo').className = `annunciator ${hostileTorp ? 'crit-active' : ''}`;
    document.getElementById('ann-scram').className = `annunciator ${sub.hullIntegrityPct <= 50 ? 'crit-active' : ''}`;

    const cavLbl = document.getElementById('sidebar-cav-warn');
    cavLbl.textContent = cav ? 'CAVITATING!' : 'PROP QUIET';
    cavLbl.style.color = cav ? 'var(--crt-red)' : 'var(--crt-green)';

    const arrBtn = document.getElementById('btn-toggle-array');
    arrBtn.classList.toggle('active', sub.towedArrayDeployed);
    arrBtn.textContent = `TB-29A TOWED ARRAY: ${sub.towedArrayDeployed ? 'DEPLOYED' : 'RETRACTED'}`;

    // Active weapons list
    const weps = snap.weapons || [];
    document.getElementById('wire-active-count').textContent = `${weps.length} ACTIVE`;
    const wepText = weps.length
      ? weps.map((w) => `${w.id} // HDG ${w.headingDeg.toFixed(0)}° // ${w.speedKts.toFixed(0)} KT`).join(' | ')
      : 'NO ACTIVE TORPEDOES IN WATER';
    document.getElementById('wire-control-panel').textContent = wepText;
    document.getElementById('tac-active-weapons-list').textContent = wepText;

    // In-place contacts table update (preserves click listeners!)
    const contacts = snap.contacts || [];
    document.getElementById('contact-count').textContent = `${contacts.length} TRACKS`;
    const tbody = document.getElementById('contacts-table-body');
    if (contacts.length === 0) {
      if (tbody.dataset.empty !== '1') {
        tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-muted)">No tracks detected.</td></tr>';
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
          tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';
          tr.addEventListener('click', () => selectContact(c.id));
          tbody.appendChild(tr);
        }
      }
      for (const c of contacts) {
        const tr = tbody.querySelector(`tr[data-contact-id="${c.id}"]`);
        if (!tr) continue;
        tr.classList.toggle('selected', c.id === selectedContactId);
        const cells = tr.children;
        cells[0].textContent = c.id;
        cells[1].textContent = c.category;
        cells[1].style.color = c.allegiance === 'HOSTILE' ? 'var(--crt-red)' : 'var(--crt-green)';
        cells[2].textContent = `${c.bearingDeg.toFixed(0).padStart(3, '0')}°`;
        cells[3].textContent = c.ranged && c.rangeNm !== null ? `${c.rangeNm.toFixed(1)}NM` : '--.-';
        cells[4].textContent = `${c.tmaQualityPct}%`;
      }
    }

    // ESM / Periscope track cues list
    const esmList = document.getElementById('esm-intercept-list');
    if (esmList) {
      esmList.innerHTML = contacts.length
        ? contacts.map((c) => `<div>• <strong>${c.id}</strong> (${c.designation}) — BRG ${c.bearingDeg.toFixed(0)}° | SNR +${c.snrDb.toFixed(1)}dB</div>`).join('')
        : '<div style="color:var(--text-muted)">No contacts currently detected.</div>';
    }

    const sel = contacts.find((c) => c.id === selectedContactId) || null;
    document.getElementById('sonar-spectrum-target').textContent = sel ? `ANALYZING ${sel.id}` : 'NO TRACK SELECTED';
    document.getElementById('tma-track-id').textContent = sel ? sel.id : 'NO TRACK';
    document.getElementById('tma-desig').textContent = sel ? sel.designation : '--';
    document.getElementById('tma-class').textContent = sel ? sel.category : '--';
    document.getElementById('tma-brg').textContent = sel ? `${sel.bearingDeg.toFixed(1)}°` : '---°';
    document.getElementById('tma-snr').textContent = sel ? `+${sel.snrDb.toFixed(1)} dB` : '-- dB';
    document.getElementById('tma-quality').textContent = sel ? `${sel.tmaQualityPct}%` : '0%';
    document.getElementById('tma-quality-bar').style.width = sel ? `${sel.tmaQualityPct}%` : '0%';
    document.getElementById('tma-range').textContent = sel && sel.ranged && sel.rangeNm !== null ? `${sel.rangeNm.toFixed(2)} NM` : 'PASSIVE BRG ONLY';
    document.getElementById('tma-crs-spd').textContent = sel && sel.ranged ? `${Math.round(sel.headingDeg)}° / ${sel.speedKts.toFixed(0)} KT` : '---° / -- KT';

    document.getElementById('fc-selected-target').textContent = sel ? `TARGET: ${sel.id}` : 'TARGET: NONE';
    document.getElementById('fc-tgt-name').textContent = sel ? sel.designation : 'MANUAL BEARING';
    document.getElementById('fc-tgt-qual').textContent = sel ? `${sel.tmaQualityPct}%` : '--%';
    document.getElementById('fc-tgt-brg').textContent = sel ? `${sel.bearingDeg.toFixed(0).padStart(3, '0')}°` : '000°';
    document.getElementById('fc-tgt-rng').textContent = sel && sel.ranged && sel.rangeNm !== null ? `${sel.rangeNm.toFixed(1)} NM` : '--.- NM';

    document.getElementById('quick-tgt-id').textContent = sel ? `${sel.id} (${sel.category})` : 'NONE';
    document.getElementById('quick-tgt-details').textContent = sel
      ? `BRG ${sel.bearingDeg.toFixed(0)}° | SNR +${sel.snrDb.toFixed(1)} dB | TMA ${sel.tmaQualityPct}%`
      : 'Select a contact on the map, waterfall, or table.';
  }

  function selectContact(contactId) {
    selectedContactId = contactId && selectedContactId === contactId ? null : contactId;
    if (lastSnapshot) {
      const sel = (lastSnapshot.contacts || []).find((c) => c.id === selectedContactId);
      if (sel) {
        document.getElementById('order-torp-brg').value = Math.round(sel.bearingDeg);
        if (renderer.periscope3d) {
          renderer.periscope3d.scopeBearingDeg = Math.round(sel.bearingDeg);
          document.getElementById('scope-brg-val').textContent = `${renderer.periscope3d.scopeBearingDeg.toString().padStart(3, '0')}° T`;
        }
      }
      updateUI(lastSnapshot);
    }
    renderer.renderActiveStation(activeStation, selectedContactId);
  }

  const net = new window.TacticalNetworkClient({
    onStatusChange(status) {
      const pill = document.getElementById('conn-pill');
      pill.textContent = status === 'CONNECTED' ? 'ONLINE' : status;
      const col = status === 'CONNECTED' ? 'var(--crt-green)' : status === 'CONNECTING' ? 'var(--crt-amber)' : 'var(--crt-red)';
      pill.style.color = col;
      pill.style.borderColor = col;
      document.getElementById('btn-connect').disabled = status !== 'DISCONNECTED';
      document.getElementById('btn-disconnect').disabled = status === 'DISCONNECTED';
    },
    onLatency(rttMs) {
      latestRtt = `${Math.round(rttMs)}`;
      document.getElementById('val-latency').textContent = `${latestRtt} ms`;
    },
    onError(errMsg) {
      logEvent(`ERROR: ${errMsg}`, 'err');
    },
    onMessage(msg) {
      if (msg.type === 'WELCOME') {
        snapshotHz = msg.payload.snapshotHz || 10;
        document.getElementById('hud-vessel').textContent = msg.payload.vesselId === 'OPFOR-SUB' ? 'K-561 KAZAN (YASEN-M)' : 'USS VIRGINIA (SSN-774)';
        document.getElementById('hud-battery').textContent = msg.payload.assignedRole;
        document.getElementById('val-session-id').textContent = msg.payload.sessionId;
        logEvent(`${msg.payload.reconnected ? 'Reconnected' : 'Connected'} ${msg.payload.vesselId} [${msg.payload.assignedRole}] @ ${msg.payload.worldId}`, 'ok');
      } else if (msg.type === 'WORLD_SNAPSHOT') {
        latestTick = msg.payload.serverTick;
        renderer.pushSnapshot(msg.payload, snapshotHz);
        updateUI(msg.payload);
      } else if (msg.type === 'WORLD_EVENT') {
        logEvent(`[${msg.payload.category}] ${msg.payload.message}`, msg.payload.category === 'ALERT' ? 'err' : 'info');
        if (msg.payload.message.includes('TORPEDO IN THE WATER')) window.MultiplayerAudio.playTorpedoAlert();
      } else if (msg.type === 'COMMAND_RESULT') {
        const ack = document.getElementById('cmd-ack');
        ack.textContent = `#${msg.sequence} ${msg.payload.accepted ? 'ACK' : 'REJ'}: ${msg.payload.message}`;
        ack.style.color = msg.payload.accepted ? 'var(--crt-cyan)' : 'var(--crt-red)';
        window.MultiplayerAudio.playBeep(msg.payload.accepted ? 960 : 320, 0.05);
      } else if (msg.type === 'ERROR') {
        logEvent(`SERVER ERROR [${msg.payload.code}]: ${msg.payload.message}`, 'err');
      }
    }
  });

  function connectNow() {
    net.connect(
      wsInput.value.trim(),
      document.getElementById('input-callsign').value.trim(),
      document.getElementById('select-role').value,
      document.getElementById('input-room-id').value.trim(),
      document.getElementById('select-vessel').value
    );
  }

  renderer.initLeafletMap((brg) => {
    document.getElementById('order-heading').value = brg;
    net.sendCommand('SET_HEADING', brg);
  });

  // Station tabs
  document.querySelectorAll('.station-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchStation(btn.dataset.station));
  });

  // Modal & Audio controls
  const modal = document.getElementById('briefing-modal');
  document.getElementById('btn-open-briefing').addEventListener('click', () => { modal.style.display = 'flex'; });
  document.getElementById('btn-close-briefing').addEventListener('click', () => { modal.style.display = 'none'; });
  document.getElementById('btn-audio-toggle').addEventListener('click', (e) => {
    const on = window.MultiplayerAudio.toggle();
    e.target.textContent = `AUDIO: ${on ? 'ON' : 'OFF'}`;
    e.target.classList.toggle('active', on);
  });

  document.getElementById('btn-connect').addEventListener('click', () => {
    window.MultiplayerAudio.enable();
    const audioBtn = document.getElementById('btn-audio-toggle');
    audioBtn.textContent = 'AUDIO: ON';
    audioBtn.classList.add('active');
    connectNow();
    modal.style.display = 'none';
  });
  document.getElementById('btn-quick-connect').addEventListener('click', () => {
    window.MultiplayerAudio.enable();
    const audioBtn = document.getElementById('btn-audio-toggle');
    audioBtn.textContent = 'AUDIO: ON';
    audioBtn.classList.add('active');
    connectNow();
  });
  document.getElementById('btn-disconnect').addEventListener('click', () => net.disconnect());

  // Map toolbar
  document.getElementById('btn-map-follow').addEventListener('click', (e) => {
    renderer.followSub = !renderer.followSub;
    e.target.classList.toggle('active', renderer.followSub);
  });
  document.getElementById('btn-map-waypoint').addEventListener('click', (e) => {
    renderer.waypointMode = !renderer.waypointMode;
    e.target.classList.toggle('active', renderer.waypointMode);
  });
  document.getElementById('btn-map-layer-ocean').addEventListener('click', (e) => {
    renderer.setMapLayer('ocean');
    e.target.classList.add('active');
    document.getElementById('btn-map-layer-dark').classList.remove('active');
  });
  document.getElementById('btn-map-layer-dark').addEventListener('click', (e) => {
    renderer.setMapLayer('dark');
    e.target.classList.add('active');
    document.getElementById('btn-map-layer-ocean').classList.remove('active');
  });

  // Helm, Depth & Speed Orders
  document.getElementById('btn-set-heading').addEventListener('click', () => net.sendCommand('SET_HEADING', Number(document.getElementById('order-heading').value)));
  document.getElementById('btn-hdg-l15').addEventListener('click', () => {
    const h = (Number(document.getElementById('order-heading').value) + 345) % 360;
    document.getElementById('order-heading').value = h;
    net.sendCommand('SET_HEADING', h);
  });
  document.getElementById('btn-hdg-r15').addEventListener('click', () => {
    const h = (Number(document.getElementById('order-heading').value) + 15) % 360;
    document.getElementById('order-heading').value = h;
    net.sendCommand('SET_HEADING', h);
  });
  document.getElementById('btn-set-depth').addEventListener('click', () => net.sendCommand('SET_DEPTH', Number(document.getElementById('order-depth').value)));
  const setPresetDepth = (d) => {
    document.getElementById('order-depth').value = d;
    net.sendCommand('SET_DEPTH', d);
  };
  document.getElementById('btn-depth-pd').addEventListener('click', () => setPresetDepth(18));
  document.getElementById('btn-depth-deep').addEventListener('click', () => setPresetDepth(140));
  document.getElementById('btn-man-pd').addEventListener('click', () => setPresetDepth(18));
  document.getElementById('btn-man-above').addEventListener('click', () => setPresetDepth(45));
  document.getElementById('btn-man-below').addEventListener('click', () => setPresetDepth(140));
  document.getElementById('btn-man-deep').addEventListener('click', () => setPresetDepth(280));

  document.getElementById('btn-set-speed').addEventListener('click', () => net.sendCommand('SET_SPEED', Number(document.getElementById('order-speed').value)));
  document.querySelectorAll('.telegraph-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const spd = Number(btn.dataset.spd);
      document.getElementById('order-speed').value = spd;
      document.querySelectorAll('.telegraph-btn').forEach((b) => b.classList.toggle('active', b === btn));
      net.sendCommand('SET_SPEED', spd);
    });
  });

  // Sonar & Weapons
  const doActivePing = () => {
    if (net.sendCommand('ACTIVE_PING', 1)) window.MultiplayerAudio.playActivePing();
  };
  document.getElementById('btn-active-ping').addEventListener('click', doActivePing);
  document.getElementById('btn-ping-active-quick').addEventListener('click', doActivePing);
  document.getElementById('btn-quick-ping').addEventListener('click', doActivePing);
  document.getElementById('btn-toggle-array').addEventListener('click', () => net.sendCommand('TOGGLE_TOWED_ARRAY', 1));
  document.getElementById('btn-deploy-decoy').addEventListener('click', () => net.sendCommand('DEPLOY_DECOY', 1));
  document.getElementById('btn-quick-decoy').addEventListener('click', () => net.sendCommand('DEPLOY_DECOY', 1));

  const fireTorp = () => net.sendCommand('FIRE_TUBE', Number(document.getElementById('order-torp-brg').value));
  document.getElementById('btn-fire-torp').addEventListener('click', fireTorp);
  document.getElementById('btn-quick-fire-torp').addEventListener('click', fireTorp);
  document.getElementById('btn-sync-torp-brg').addEventListener('click', () => {
    if (!lastSnapshot) return;
    const sel = (lastSnapshot.contacts || []).find((c) => c.id === selectedContactId);
    if (sel) document.getElementById('order-torp-brg').value = Math.round(sel.bearingDeg);
  });

  // Waterfall mousemove & click-to-select
  document.getElementById('btn-sonar-clear-track').addEventListener('click', () => selectContact(null));
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
    if (best) selectContact(best.id);
  });

  // Station 6: Three.js 3D Periscope Controls
  document.getElementById('btn-scope-raise').addEventListener('click', (e) => {
    if (!renderer.periscope3d) return;
    renderer.periscope3d.mastRaised = !renderer.periscope3d.mastRaised;
    e.target.textContent = `MAST: ${renderer.periscope3d.mastRaised ? 'RAISED' : 'LOWERED'}`;
    e.target.classList.toggle('active', renderer.periscope3d.mastRaised);
  });
  document.getElementById('btn-scope-view-periscope').addEventListener('click', (e) => {
    if (!renderer.periscope3d) return;
    renderer.periscope3d.mode = 'periscope';
    e.target.classList.add('active');
    document.getElementById('btn-scope-view-outside').classList.remove('active');
  });
  document.getElementById('btn-scope-view-outside').addEventListener('click', (e) => {
    if (!renderer.periscope3d) return;
    renderer.periscope3d.mode = 'outside';
    e.target.classList.add('active');
    document.getElementById('btn-scope-view-periscope').classList.remove('active');
  });
  document.getElementById('btn-scope-ir').addEventListener('click', (e) => {
    if (!renderer.periscope3d) return;
    renderer.periscope3d.thermal = !renderer.periscope3d.thermal;
    e.target.textContent = `FLIR: ${renderer.periscope3d.thermal ? 'ON' : 'OFF'}`;
    e.target.classList.toggle('active', renderer.periscope3d.thermal);
  });
  document.getElementById('btn-scope-zoom').addEventListener('click', (e) => {
    if (!renderer.periscope3d) return;
    const zooms = [1.5, 4.0, 8.0];
    const idx = (zooms.indexOf(renderer.periscope3d.zoom) + 1) % zooms.length;
    renderer.periscope3d.zoom = zooms[idx];
    e.target.textContent = `ZOOM ${renderer.periscope3d.zoom.toFixed(1)}×`;
  });
  document.getElementById('btn-scope-weather').addEventListener('click', (e) => {
    if (!renderer.periscope3d) return;
    const name = renderer.periscope3d.cycleWeather();
    e.target.textContent = `METEO: ${name}`;
  });
  document.getElementById('btn-scope-left').addEventListener('click', () => renderer.periscope3d && renderer.periscope3d.slewBearing(-10));
  document.getElementById('btn-scope-right').addEventListener('click', () => renderer.periscope3d && renderer.periscope3d.slewBearing(10));
  document.getElementById('btn-scope-lock-tgt').addEventListener('click', () => {
    if (!lastSnapshot || !renderer.periscope3d) return;
    const sel = (lastSnapshot.contacts || []).find((c) => c.id === selectedContactId) || (lastSnapshot.contacts || [])[0];
    if (sel) {
      renderer.periscope3d.scopeBearingDeg = Math.round(sel.bearingDeg);
      document.getElementById('scope-brg-val').textContent = `${renderer.periscope3d.scopeBearingDeg.toString().padStart(3, '0')}° T`;
    }
  });

  // Keyboard shortcuts (F1-F7, A/D, W/S, P, C, ESC)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { modal.style.display = 'none'; }
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.key === 'F1') { e.preventDefault(); switchStation('tactical'); }
    if (e.key === 'F2') { e.preventDefault(); switchStation('sonar'); }
    if (e.key === 'F3') { e.preventDefault(); switchStation('weapons'); }
    if (e.key === 'F4') { e.preventDefault(); switchStation('maneuvering'); }
    if (e.key === 'F5') { e.preventDefault(); switchStation('reactor'); }
    if (e.key === 'F6') { e.preventDefault(); switchStation('periscope'); }
    if (e.key === 'F7') { e.preventDefault(); switchStation('damage-control'); }
    if (e.key === 'p' || e.key === 'P') doActivePing();
    if (e.key === 'c' || e.key === 'C') net.sendCommand('DEPLOY_DECOY', 1);
    if (e.key === 'a' || e.key === 'A') document.getElementById('btn-hdg-l15').click();
    if (e.key === 'd' || e.key === 'D') document.getElementById('btn-hdg-r15').click();
  });

  // Auto-connect to the authoritative Rust server on page load
  connectNow();

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
