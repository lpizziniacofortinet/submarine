/**
 * ============================================================================
 * MAIN SIMULATION CONTROLLER & AN/BYG-1 COMBAT CONTROL INTEGRATION
 * Coordinates simulation loop, stations, tubes, VLS, wire guidance, and UI.
 * ============================================================================
 */

class CombatLogger {
  constructor() {
    this.entries = [];
  }

  log(station, message, cssClass = 'conn') {
    const clockEl = document.getElementById('hud-clock');
    const timeStr = clockEl ? clockEl.textContent : '04:15:00Z';
    const container = document.getElementById('combat-log');
    if (container) {
      const row = document.createElement('div');
      row.className = 'log-entry';
      row.innerHTML = `
        <span class="log-time">[${timeStr}]</span>
        <span class="log-station ${cssClass}">${station}:</span>
        <span>${message}</span>
      `;
      container.prepend(row);

      while (container.children.length > 60) {
        container.removeChild(container.lastChild);
      }
    }

    this.showPopup(station, message, cssClass, timeStr);
  }

  showPopup(station, message, cssClass = 'conn', timeStr = '') {
    const stack = document.getElementById('tactical-alert-stack');
    if (!stack) return;

    const popup = document.createElement('div');
    const styleVariant = cssClass === 'alert' ? 'urgent' : cssClass === 'weps' ? 'amber' : '';
    popup.className = `tactical-popup ${styleVariant}`;

    popup.innerHTML = `
      <div class="tactical-popup-header">
        <span>[${timeStr}] // ${station} DISPATCH</span>
        <button class="tactical-popup-close" title="Close Message">X</button>
      </div>
      <div>${message}</div>
    `;

    const closeBtn = popup.querySelector('.tactical-popup-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (window.SubAudio) window.SubAudio.playConsoleBeep(960, 0.03);
        popup.remove();
      });
    }

    stack.prepend(popup);

    // Keep at most 4 popups on screen at once so old ones don't clutter
    while (stack.children.length > 4) {
      stack.removeChild(stack.lastChild);
    }
  }
}

window.GameLogger = new CombatLogger();

class SubmarineWorld {
  constructor() {
    this.SAVE_KEY = 'ssn774_med_save_v1';
    this.ownSub = window.SubPhysics;
    this.reactor = window.ReactorPlant;
    this.currentMission = null;

    this.simTimeSec = 4 * 3600 + 15 * 60; // 04:15:00Z
    this.timeCompression = 1;
    this.activeStation = 'tactical';

    this.contacts = [];
    this.weapons = [];
    this.decoys = [];
    this.selectedContactId = null;
    this.weaponSerial = 1;
    this.torpedoAlarmAcknowledged = false;

    this.currentSeafloorM = 1420;
    this.currentThermoclineM = 88;
    this.lastHostilePingTime = -999;
    this.torpedoMagazine = 16;

    // 4x 533mm Torpedo Tubes
    this.torpedoTubes = [
      { index: 1, state: 'READY', timer: 0, weapon: 'MK-48 ADCAP' },
      { index: 2, state: 'READY', timer: 0, weapon: 'MK-48 ADCAP' },
      { index: 3, state: 'DRY', timer: 0, weapon: 'MK-48 ADCAP' },
      { index: 4, state: 'DRY', timer: 0, weapon: 'MK-48 ADCAP' }
    ];

    // 6x Virginia Payload Module VLS Tubes (Harpoon Block II / Tomahawk TASM)
    this.vlsTubes = [
      { index: 1, state: 'READY', weapon: 'UGM-84 HARPOON' },
      { index: 2, state: 'READY', weapon: 'UGM-84 HARPOON' },
      { index: 3, state: 'READY', weapon: 'UGM-84 HARPOON' },
      { index: 4, state: 'READY', weapon: 'UGM-109E TOMAHAWK' },
      { index: 5, state: 'READY', weapon: 'UGM-109E TOMAHAWK' },
      { index: 6, state: 'READY', weapon: 'UGM-109E TOMAHAWK' }
    ];

    this.simulationClock = new window.SimulationClock({ fixedStepSec: 1 / 30, maxFrameDeltaSec: 0.25, maxSubSteps: 8 });
    this.waterfallTimer = 0;
    this.uiRefreshTimer = 0;
    this.autoSaveTimer = 0;
    this.dynamicEncounterTimer = 75; // Seconds until next random biological / AIS vessel check
    this.gameOver = false;
  }

  init() {
    this.populateMissionModal();
    this.populateOniDatabaseUI();
    this.bindUIEvents();

    // Check if a saved Mediterranean patrol exists in localStorage
    const hasSave = this.checkSavedGameBanner();
    if (hasSave) {
      this.loadSavedGameState(true);
    } else {
      const initialMission = window.MissionGenerator.generateMission('AUGUSTA_SIGONELLA', 'RANDOM');
      this.loadMission(initialMission);
    }

    window.Stations.initLeafletMap(this);
    if (window.Stations.leafletMap) {
      window.Stations.leafletMap.setView([this.ownSub.lat, this.ownSub.lon], 10);
    }

    let lastTimestamp = performance.now();
    const loop = (now) => {
      const rawDt = Math.max(0, (now - lastTimestamp) / 1000.0);
      lastTimestamp = now;
      const compression = Math.max(0, this.timeCompression);

      // Keep the wall-clock stall limit independent from time compression.
      // At 10x, a normal 30 FPS frame represents ~0.333s of simulation time;
      // the clock must be allowed enough fixed substeps to process it instead
      // of clamping it to the 1x 0.25s budget and silently losing simulation time.
      if (compression > 0) {
        this.simulationClock.maxFrameDeltaSec = 0.25 * compression;
        this.simulationClock.maxSubSteps = Math.max(
          1,
          Math.ceil(this.simulationClock.maxFrameDeltaSec / this.simulationClock.fixedStepSec)
        );
        this.simulationClock.advance(rawDt * compression, (fixedDt) => {
          this.stepSimulation(fixedDt, fixedDt / compression);
        });
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  checkSavedGameBanner() {
    const statusEl = document.getElementById('save-status-text');
    const resumeBtn = document.getElementById('btn-load-saved-patrol');
    try {
      const raw = localStorage.getItem(this.SAVE_KEY);
      if (!raw) {
        if (statusEl) statusEl.textContent = 'No saved patrol found yet. Select a NATO Mediterranean Base below to begin.';
        if (resumeBtn) resumeBtn.disabled = true;
        return false;
      }
      const data = JSON.parse(raw);
      if (statusEl && data.currentMission) {
        statusEl.innerHTML = `SAVED PATROL READY: <strong style="color:var(--crt-amber)">${data.currentMission.title}</strong> | Pos: ${window.Bathymetry.formatLatLon(data.ownSub.lat, data.ownSub.lon)} | Saved: ${data.savedAtStr || 'Recent'}`;
      }
      if (resumeBtn) resumeBtn.disabled = false;
      return true;
    } catch (e) {
      return false;
    }
  }

  saveGameState(silent = false) {
    if (!this.currentMission || this.gameOver) return;
    try {
      const state = {
        version: 3,
        savedAtStr: new Date().toLocaleTimeString(),
        simTimeSec: this.simTimeSec,
        currentMission: this.currentMission,
        selectedContactId: this.selectedContactId,
        weaponSerial: this.weaponSerial,
        torpedoMagazine: this.torpedoMagazine,
        torpedoTubes: this.torpedoTubes,
        vlsTubes: this.vlsTubes,
        // Persist every enumerable runtime field so a resumed patrol restores
        // helm, ballast, mast, damage, acoustic and other subsystem states too.
        ownSub: { ...this.ownSub },
        reactor: { ...this.reactor },
        contacts: this.contacts.map((c) => c.serialize()),
        weapons: this.weapons.filter((w) => !w.exploded).map((w) => w.serialize()),
        decoys: this.decoys.map((decoy) => ({ ...decoy }))
      };

      localStorage.setItem(this.SAVE_KEY, JSON.stringify(state));
      this.checkSavedGameBanner();
      if (!silent) {
        window.GameLogger.log('CONN', `Patrol state saved (${this.currentMission.code} at ${window.Bathymetry.formatLatLon(this.ownSub.lat, this.ownSub.lon)}).`, 'conn');
      }
    } catch (e) {
      console.warn('Save failed:', e);
    }
  }

  loadSavedGameState(silent = false) {
    try {
      const raw = localStorage.getItem(this.SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !data.currentMission) return false;

      const s = data.ownSub;
      if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon) ||
          !Number.isFinite(s.heading) || !Number.isFinite(s.depthM)) {
        return false;
      }

      this.currentMission = data.currentMission;
      this.simTimeSec = data.simTimeSec ?? 4 * 3600;
      this.selectedContactId = data.selectedContactId ?? null;
      this.weaponSerial = data.weaponSerial ?? 1;
      this.torpedoMagazine = data.torpedoMagazine !== undefined ? data.torpedoMagazine : 16;
      if (data.torpedoTubes) this.torpedoTubes = data.torpedoTubes;
      if (data.vlsTubes) this.vlsTubes = data.vlsTubes;

      // Restore own submarine state (older v2 saves remain supported).
      this.ownSub.reset(s.lat, s.lon, s.heading, s.depthM);
      Object.assign(this.ownSub, s);
      this.ownSub.damageControl = new window.DamageControlSystem(s.damageControl);
      document.getElementById('input-order-hdg').value = Math.round(this.ownSub.orderedHeading);
      document.getElementById('input-order-depth').value = Math.round(this.ownSub.orderedDepthM);
      document.getElementById('cm-count').textContent = this.ownSub.decoysRemaining;

      // Restore S9G Reactor state
      if (data.reactor) {
        Object.assign(this.reactor, data.reactor);
      }

      // Restore contacts & active weapons
      this.contacts = (data.contacts || []).map((cfg, idx) => new window.ContactEntity(idx + 1, cfg));
      this.weapons = (data.weapons || []).map((wcfg) => new window.WeaponEntity(wcfg));
      this.decoys = Array.isArray(data.decoys) ? data.decoys.map((decoy) => ({ ...decoy })) : [];
      this.gameOver = false;

      if (window.Stations.leafletMap) {
        window.Stations.leafletMap.setView([this.ownSub.lat, this.ownSub.lon], 10);
      }

      document.getElementById('tac-mission-code').textContent = this.currentMission.code;
      const briefEl = document.getElementById('briefing-content');
      if (briefEl) briefEl.innerHTML = this.currentMission.briefingHtml;

      this.renderObjectivesList();
      this.renderTubesUI();
      this.renderWireControlUI();
      this.updateContactsTableUI();

      if (!silent) {
        window.GameLogger.log('CONN', `Resumed saved Mediterranean patrol: ${this.currentMission.title}.`, 'conn');
      }
      return true;
    } catch (e) {
      console.warn('Load failed:', e);
      return false;
    }
  }

  exportSaveJson() {
    this.saveGameState(true);
    const raw = localStorage.getItem(this.SAVE_KEY);
    if (!raw) return;
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(this.currentMission ? this.currentMission.code : 'ssn774_patrol').toLowerCase()}_save.json`;
    a.click();
    URL.revokeObjectURL(url);
    window.GameLogger.log('CONN', 'Exported patrol save file (.json).', 'conn');
  }

  loadMission(mission) {
    this.currentMission = mission;
    this.gameOver = false;
    this.weapons = [];
    this.decoys = [];
    this.selectedContactId = null;
    this.torpedoAlarmAcknowledged = false;
    this.torpedoMagazine = 16;

    this.reactor.reset();
    this.ownSub.reset(mission.startLat, mission.startLon, mission.startHeading, mission.startDepth);

    document.getElementById('input-order-hdg').value = mission.startHeading;
    document.getElementById('input-order-depth').value = mission.startDepth;

    this.torpedoTubes = [
      { index: 1, state: 'READY', timer: 0, weapon: 'MK-48 ADCAP' },
      { index: 2, state: 'READY', timer: 0, weapon: 'MK-48 ADCAP' },
      { index: 3, state: 'DRY', timer: 0, weapon: 'MK-48 ADCAP' },
      { index: 4, state: 'DRY', timer: 0, weapon: 'MK-48 ADCAP' }
    ];
    this.vlsTubes.forEach((v) => (v.state = 'READY'));

    this.contacts = mission.contacts.map((cfg, idx) => new window.ContactEntity(idx + 1, cfg));

    if (window.Stations.leafletMap) {
      window.Stations.leafletMap.setView([this.ownSub.lat, this.ownSub.lon], 10);
    }

    document.getElementById('tac-mission-code').textContent = mission.code;
    const briefEl = document.getElementById('briefing-content');
    if (briefEl) briefEl.innerHTML = mission.briefingHtml;

    this.renderObjectivesList();
    this.renderTubesUI();
    this.renderWireControlUI();

    this.saveGameState(true);
    window.GameLogger.log('CONN', `Departing ${mission.baseName}: ${mission.title}. Rig ship for ultra-quiet.`, 'conn');
    window.Bathymetry.probeOnlineBathymetry(this.ownSub.lat, this.ownSub.lon);
  }

  getSelectedContact() {
    return this.contacts.find((c) => c.id === this.selectedContactId) || null;
  }

  selectContact(contactId) {
    this.selectedContactId = contactId;
    const c = this.getSelectedContact();
    if (c) {
      // Auto-populate Fire Control launch bearing to target's intercept lead
      const leadHdg = this.computeInterceptHeading(c);
      document.getElementById('input-weps-hdg').value = leadHdg;
      document.getElementById('input-weps-depth').value = c.depthM <= 5 ? 8 : Math.round(c.depthM);
      window.Stations.scopeBearing = Math.round(c.lastTrueBrg);
      document.getElementById('scope-brg-val').textContent = `${window.Stations.scopeBearing.toString().padStart(3, '0')}° TRUE`;
    }
    this.updateContactsTableUI();
  }

  computeInterceptHeading(contact) {
    if (!contact) return Math.round(this.ownSub.heading);
    const torpSpd = Number(document.getElementById('select-weps-speed').value) || 40;
    const angleDiffRad = ((contact.estHeading - contact.lastTrueBrg) * Math.PI) / 180;
    const sinLead = (contact.estSpeedKts / Math.max(15, torpSpd)) * Math.sin(angleDiffRad);
    const clampedSin = Math.max(-0.85, Math.min(0.85, sinLead));
    const leadDeg = (Math.asin(clampedSin) * 180) / Math.PI;
    return Math.round((contact.lastTrueBrg + leadDeg + 360) % 360);
  }

  stepSimulation(dt, rawDt) {
    if (this.gameOver) return;

    this.simTimeSec += dt;

    // 1. Query Bathymetry & Thermocline at current Lat/Lon
    this.currentSeafloorM = window.Bathymetry.getSeafloorDepthMeters(this.ownSub.lat, this.ownSub.lon);
    this.currentThermoclineM = window.Bathymetry.getThermoclineDepth(this.ownSub.lat, this.ownSub.lon);

    // 2. Step S9G Nuclear Reactor & Steam Plant
    const rxOut = this.reactor.update(dt, this.ownSub.orderedSpeedKts, this.ownSub.depthM);
    rxOut.effectiveOrderedSpeedKts *= 0.55 + 0.45 * (this.ownSub.damageControl.getSystemHealth('reactor') / 100);

    // 3. Step Submarine Hydrodynamics, Ballast & Own Acoustics
    this.ownSub.update(dt, rxOut, this.currentSeafloorM, this.currentThermoclineM);
    this.ownSub.updateDamageControl(dt);

    // Update WebAudio continuous telemetry (including Hydrophone target blade beats & torpedo whine)
    if (window.SubAudio) {
      const activeTorps = this.weapons.filter((w) => !w.exploded && w.type === 'TORPEDO').length;
      window.SubAudio.updateContinuousTelemetry(
        this.ownSub.isCavitating,
        this.reactor.pumpMode,
        this.ownSub.speedKts,
        this.reactor.status === 'SCRAMMED',
        this.getSelectedContact(),
        activeTorps,
        rawDt
      );
    }

    // Check Hull Integrity loss
    if (this.ownSub.hullIntegrityPct <= 0) {
      this.gameOver = true;
      document.body.classList.add('red-alert');
      window.GameLogger.log('ALERT', 'CATASTROPHIC HULL IMPLOSION! USS VIRGINIA LOST WITH ALL HANDS.', 'alert');
      return;
    }

    // 4. Step Torpedo Tube Flooding / Reloading Timers
    let tubesChanged = false;
    for (const tube of this.torpedoTubes) {
      if (tube.timer > 0) {
        tube.timer = Math.max(0, tube.timer - dt);
        if (tube.timer === 0) {
          if (tube.state === 'FLOODING') {
            tube.state = 'READY';
            window.GameLogger.log('WEPS', `Tube ${tube.index} flooded, equalized, outer shutter door OPEN. Ready to fire!`, 'weps');
          } else if (tube.state === 'RELOADING') {
            tube.state = 'DRY';
            window.GameLogger.log('WEPS', `Tube ${tube.index} reloaded with MK-48 Mod 7 ADCAP (Dry).`, 'weps');
          }
          tubesChanged = true;
        }
      }
    }
    if (tubesChanged) this.renderTubesUI();

    // 5. Step Contacts & TMA
    for (const c of this.contacts) {
      c.update(dt, this.ownSub, this.currentThermoclineM, this);
    }

    // Auto-select first detected contact if none selected
    if (!this.selectedContactId) {
      const firstDet = this.contacts.find((c) => c.detected && !c.sunk);
      if (firstDet) this.selectContact(firstDet.id);
    }

    // 6. Step Active Weapons (Torpedoes & Missiles)
    for (const w of this.weapons) {
      w.update(dt, this.ownSub, this.contacts, this.decoys, this.currentThermoclineM, this);
    }

    // 7. Step Decoys (expire after 95 seconds)
    for (let i = this.decoys.length - 1; i >= 0; i--) {
      this.decoys[i].ttl -= dt;
      if (this.decoys[i].ttl <= 0) {
        this.decoys.splice(i, 1);
      }
    }

    // 8. Step Sonar Waterfall scanline every 0.12s
    this.waterfallTimer += rawDt;
    if (this.waterfallTimer >= 0.12) {
      this.waterfallTimer = 0;
      window.Stations.stepSonarWaterfall(this);
    }

    // 9. Render Active Station Canvas & HUD
    this.renderActiveStation();

    this.uiRefreshTimer += rawDt;
    if (this.uiRefreshTimer >= 0.25) {
      this.uiRefreshTimer = 0;
      this.updateTopHudAndSidebar();
    }

    // 10. Auto-save patrol state every 15 seconds
    this.autoSaveTimer += rawDt;
    if (this.autoSaveTimer >= 15.0) {
      this.autoSaveTimer = 0;
      this.saveGameState(true);
    }

    // 11. Dynamic Mediterranean Biological Encounters (Whales/Dolphins) & Real AIS Traffic
    this.dynamicEncounterTimer -= dt;
    if (this.dynamicEncounterTimer <= 0) {
      this.dynamicEncounterTimer = 85 + Math.random() * 60;
      const activeCount = this.contacts.filter((c) => !c.sunk).length;
      if (activeCount < 11) {
        const isBio = Math.random() < 0.55;
        const cfg = isBio
          ? window.MissionGenerator.createDynamicBiologicConfig(this.ownSub.lat, this.ownSub.lon)
          : window.MissionGenerator.createDynamicAisVesselConfig(this.ownSub.lat, this.ownSub.lon);
        const newIdx = this.contacts.length + 1;
        const newContact = new window.ContactEntity(newIdx, cfg);
        this.contacts.push(newContact);
      }
    }
  }

  renderActiveStation() {
    if (this.activeStation === 'tactical') {
      window.Stations.renderTacticalOverlay(this);
    } else if (this.activeStation === 'sonar') {
      window.Stations.renderSonarStation(this);
    } else if (this.activeStation === 'weapons') {
      window.Stations.renderFireControlScope(this);
    } else if (this.activeStation === 'maneuvering') {
      window.Stations.renderManeuveringStation(this);
    } else if (this.activeStation === 'reactor') {
      window.Stations.renderReactorSchematic(this);
    } else if (this.activeStation === 'periscope') {
      window.Stations.renderPeriscopeStation(this);
    }
  }

  /**
   * Active Sonar Ping (3.5 kHz AN/BQQ-10 Spherical Array)
   * Gives immediate 98% TMA Range/Bearing on all contacts within 18 NM,
   * but broadcasts a massive +55 dB acoustic transient that alerts all enemies!
   */
  triggerActiveSonarPing() {
    this.ownSub.addAcousticTransient(55);
    const echoRanges = [];

    for (const c of this.contacts) {
      if (c.sunk) continue;
      const dNm = window.Bathymetry.distanceNm(this.ownSub.lat, this.ownSub.lon, c.lat, c.lon);
      if (dNm <= 18.0) {
        echoRanges.push(dNm);
        c.detected = true;
        c.tmaQualityPct = Math.max(c.tmaQualityPct, 96);
        c.estRangeNm = dNm;
        c.estHeading = Math.round(c.heading);
        c.estSpeedKts = Math.round(c.speedKts);

        // Alert hostile ships/subs to player's exact bearing!
        if (c.profile.allegiance === 'HOSTILE') {
          c.alertedBearing = window.Bathymetry.bearingDeg(c.lat, c.lon, this.ownSub.lat, this.ownSub.lon);
          c.aiState = 'ATTACK';
        }
      }
    }

    if (window.SubAudio) window.SubAudio.playActivePing(echoRanges);
    window.GameLogger.log(
      'SONAR',
      `Transmitting 3.5 kHz Active Ping! ${echoRanges.length} acoustic echo returns received. TMA updated to 96%!`,
      'sonar'
    );
    this.updateContactsTableUI();
  }

  /**
   * Flood & Open Outer Door on Torpedo Tube (1-4)
   */
  floodTorpedoTube(tubeIndex) {
    const tube = this.torpedoTubes.find((t) => t.index === tubeIndex);
    if (!tube || tube.state !== 'DRY') return;
    tube.state = 'FLOODING';
    tube.timer = 4.0;
    this.ownSub.addAcousticTransient(12);
    if (window.SubAudio) {
      window.SubAudio.playPneumaticHiss(0.8);
    }
    window.GameLogger.log('WEPS', `Flooding Torpedo Tube ${tubeIndex} and opening outer shutter door...`, 'weps');
    this.renderTubesUI();
  }

  /**
   * Fire MK-48 Mod 7 CBASS ADCAP Heavyweight Torpedo from a READY tube
   */
  fireTorpedoTube(tubeIndex) {
    const tube = this.torpedoTubes.find((t) => t.index === tubeIndex);
    if (!tube) return;
    if (tube.state === 'DRY') {
      this.floodTorpedoTube(tubeIndex);
      return;
    }
    if (tube.state !== 'READY') return;

    const launchHdg = Number(document.getElementById('input-weps-hdg').value) || Math.round(this.ownSub.heading);
    const runDepth = Number(document.getElementById('input-weps-depth').value) || 40;
    const enableYds = Number(document.getElementById('input-weps-enable').value) || 1500;
    const speedKts = Number(document.getElementById('select-weps-speed').value) || 40;
    const seekerMode = document.getElementById('select-weps-homing').value || 'ACTIVE_PASSIVE';
    const searchPattern = document.getElementById('select-weps-pattern').value || 'SNAKE';

    const torp = new window.WeaponEntity({
      id: `MK48-${this.weaponSerial++}`,
      name: 'MK-48 ADCAP',
      type: 'TORPEDO',
      isPlayer: true,
      tubeIndex,
      lat: this.ownSub.lat,
      lon: this.ownSub.lon,
      depthM: this.ownSub.depthM,
      orderedDepthM: runDepth,
      heading: this.ownSub.heading,
      orderedHeading: launchHdg,
      speedKts,
      enableDistanceYds: enableYds,
      seekerMode,
      searchPattern
    });

    this.weapons.push(torp);
    this.ownSub.addAcousticTransient(32);
    if (window.SubAudio) {
      window.SubAudio.playTubeLaunch();
    }

    if (this.torpedoMagazine > 0) {
      this.torpedoMagazine--;
      tube.state = 'RELOADING';
      tube.timer = 18.0;
    } else {
      tube.state = 'EMPTY';
    }

    window.GameLogger.log(
      'WEPS',
      `Tube ${tubeIndex} FIRED (${torp.id})! Gyro ${launchHdg.toString().padStart(3, '0')}°, Depth ${runDepth}m, Speed ${speedKts} KT, Wire Guidance ONLINE.`,
      'weps'
    );

    this.renderTubesUI();
    this.renderWireControlUI();
  }

  /**
   * Launch Encapsulated Harpoon or Tomahawk Anti-Ship Missile from VLS Tube
   */
  fireVlsMissile(vlsIndex) {
    const vls = this.vlsTubes.find((v) => v.index === vlsIndex);
    if (!vls || vls.state !== 'READY') return;

    if (this.ownSub.depthM > 45) {
      window.GameLogger.log('WEPS', `Cannot launch VLS Missile at ${Math.round(this.ownSub.depthM)}m! Ascend to <= 45m launch depth.`, 'alert');
      return;
    }
    if (Math.abs(this.ownSub.speedKts) > 13) {
      window.GameLogger.log('WEPS', `Cannot launch VLS Missile at ${this.ownSub.speedKts.toFixed(1)} KT! Slow to <= 12 knots.`, 'alert');
      return;
    }

    const sel = this.getSelectedContact();
    const launchHdg = sel ? Math.round(sel.lastTrueBrg) : Number(document.getElementById('input-weps-hdg').value) || Math.round(this.ownSub.heading);

    const missile = new window.WeaponEntity({
      id: `VLS-${this.weaponSerial++}`,
      name: vls.weapon,
      type: 'MISSILE',
      isPlayer: true,
      tubeIndex: vlsIndex,
      lat: this.ownSub.lat,
      lon: this.ownSub.lon,
      depthM: 0,
      orderedDepthM: 0,
      heading: launchHdg,
      orderedHeading: launchHdg,
      speedKts: 480, // Mach 0.8 sea-skimmer
      enableDistanceYds: 2000,
      seekerMode: 'ACTIVE',
      searchPattern: 'STRAIGHT'
    });

    this.weapons.push(missile);
    vls.state = 'EMPTY';
    this.ownSub.addAcousticTransient(40);
    if (window.SubAudio) {
      window.SubAudio.playMissileLaunch();
    }

    window.GameLogger.log(
      'WEPS',
      `VLS Tube ${vlsIndex} Broached! ${vls.weapon} (${missile.id}) booster ignited on bearing ${launchHdg.toString().padStart(3, '0')}° at 480 knots!`,
      'weps'
    );

    this.renderTubesUI();
  }

  /**
   * Enemy Submarine / Frigate fires a Yu-6 or Yu-7 Torpedo at USS Virginia
   */
  fireHostileTorpedo(shooter, bearingToPlayer, estPlayerDepth) {
    const activeHostileTorpedoes = this.weapons.filter(
      (weapon) => !weapon.isPlayer && weapon.type === 'TORPEDO' && !weapon.exploded
    ).length;
    if (activeHostileTorpedoes >= 2) return false;

    const newThreat = activeHostileTorpedoes === 0;
    const wepName = shooter.profile.category === 'SUBMARINE' ? 'YU-6 HEAVY TORPEDO' : 'YU-7 ASW TORPEDO';
    const launchBearing = (bearingToPlayer + (Math.random() - 0.5) * 2.4 + 360) % 360;
    const targetDepthEstimate = Math.max(15, estPlayerDepth + (Math.random() - 0.5) * 12);
    const torp = new window.WeaponEntity({
      id: `HOSTILE-T${this.weaponSerial++}`,
      name: wepName,
      type: 'TORPEDO',
      isPlayer: false,
      lat: shooter.lat,
      lon: shooter.lon,
      depthM: shooter.depthM <= 5 ? 35 : shooter.depthM,
      orderedDepthM: targetDepthEstimate,
      heading: launchBearing,
      orderedHeading: launchBearing,
      speedKts: 45,
      enableDistanceYds: 900,
      seekerMode: 'ACTIVE_PASSIVE',
      searchPattern: 'SNAKE'
    });

    this.weapons.push(torp);
    if (newThreat) {
      this.torpedoAlarmAcknowledged = false;
      if (window.SubAudio) window.SubAudio.playAlarm('TORPEDO');
    }
    window.GameLogger.log(
      'SONAR',
      `CONN, SONAR! TORPEDO IN THE WATER! Single hostile weapon launched by ${shooter.designation}, bearing ${Math.round((launchBearing + 180) % 360).toString().padStart(3, '0')}°!`,
      'alert'
    );
    return true;
  }

  spawnDecoy(lat, lon, depthM, isPlayer, ownerName) {
    this.decoys.push({
      lat,
      lon,
      depthM,
      isPlayer,
      ttl: 90
    });
    if (isPlayer) {
      window.GameLogger.log('WEPS', `ADC Mk 3 Acoustic Decoy Noisemaker deployed at ${Math.round(depthM)}m!`, 'weps');
    } else {
      window.GameLogger.log('SONAR', `Conn, Sonar: ${ownerName} deployed an acoustic noisemaker decoy!`, 'sonar');
    }
  }

  onContactSunk(contact) {
    this.renderObjectivesList();
    this.saveGameState(true);

    if (contact.profile.allegiance === 'FRIENDLY') {
      window.GameLogger.log(
        'ALERT',
        `NATO BLUE-ON-BLUE CATASTROPHE! You sank an Allied NATO warship (${contact.trueName})!`,
        'alert'
      );
    } else if (contact.profile.allegiance === 'NEUTRAL') {
      window.GameLogger.log(
        'ALERT',
        `COURT-MARTIAL WARNING: You sank a NEUTRAL Mediterranean AIS vessel (${contact.trueName})! Verify DEMON signatures before firing!`,
        'alert'
      );
    } else if (contact.profile.allegiance === 'BIOLOGIC') {
      window.GameLogger.log(
        'ALERT',
        `ENVIRONMENTAL VIOLATION: You torpedoed a marine mammal pod (${contact.trueName})! Check 0-blade biological signatures on DEMON!`,
        'alert'
      );
    }

    // Check if all primary mission objectives are complete
    const allComplete = this.currentMission.objectives.every((obj) => {
      const sunkMatching = this.contacts.filter((c) => c.sunk && c.profile.id === obj.targetProfile).length;
      return sunkMatching >= obj.requiredKills;
    });

    if (allComplete) {
      window.GameLogger.log(
        'CONN',
        `MISSION ACCOMPLISHED! All primary Non-NATO targets neutralized in ${this.currentMission.title}! Click [NATO BASE / MISSION] for new orders.`,
        'conn'
      );
    }
  }

  updateTopHudAndSidebar() {
    const sub = this.ownSub;
    const rx = this.reactor;

    // Clock
    const hrs = Math.floor(this.simTimeSec / 3600) % 24;
    const mins = Math.floor((this.simTimeSec % 3600) / 60);
    const secs = Math.floor(this.simTimeSec % 60);
    document.getElementById('hud-clock').textContent =
      `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}Z`;

    // Hull & Battery
    const hullEl = document.getElementById('hud-hull');
    hullEl.textContent = `${Math.round(sub.hullIntegrityPct)}%`;
    hullEl.className = 'metric-val ' + (sub.hullIntegrityPct < 50 ? 'red' : '');

    const batEl = document.getElementById('hud-battery');
    batEl.textContent = `${Math.round(rx.batteryPct)}%`;
    batEl.className = 'metric-val ' + (rx.batteryPct < 35 ? 'amber' : '');

    // Lat/Lon & Thermocline
    document.getElementById('hud-latlon').textContent =
      `${window.Bathymetry.formatLatLon(sub.lat, sub.lon)} (${this.currentMission.region})`;
    document.getElementById('hud-thermocline').textContent =
      this.currentThermoclineM ? `THERMAL LAYER: ${this.currentThermoclineM}m` : 'SHALLOW WATER (NO LAYER)';

    // Heading, Speed, Depth, Seafloor
    document.getElementById('hud-hdg').textContent =
      `${Math.round(sub.heading).toString().padStart(3, '0')}° (${Math.round(sub.orderedHeading).toString().padStart(3, '0')}°)`;
    document.getElementById('hud-spd').textContent =
      `${sub.speedKts.toFixed(1)} KT (${sub.orderedSpeedKts} KT)`;
    document.getElementById('hud-depth').textContent =
      `${Math.round(sub.depthM)}m (${Math.round(sub.orderedDepthM)}m)`;
    document.getElementById('hud-seafloor').textContent = `${this.currentSeafloorM}m`;

    const pitchSign = sub.pitchDeg >= 0 ? '+' : '';
    document.getElementById('hud-pitch').textContent = `${pitchSign}${sub.pitchDeg.toFixed(1)}°`;

    const noiseEl = document.getElementById('hud-noise');
    noiseEl.textContent = `${sub.radiatedNoiseDb} dB (CAV ${sub.cavitationSpeedKts}KT)`;
    noiseEl.className = 'metric-val ' + (sub.isCavitating ? 'red' : '');

    // Reactor HUD
    const rxStatEl = document.getElementById('hud-rx-status');
    rxStatEl.textContent = rx.status === 'SCRAMMED' ? 'SCRAMMED // BATTERY' : `CRITICAL // ${rx.pumpMode}`;
    rxStatEl.style.color = rx.status === 'SCRAMMED' ? 'var(--crt-red)' : 'var(--crt-green)';
    document.getElementById('hud-rx-power').textContent = `${rx.neutronFluxPct.toFixed(1)}%`;
    document.getElementById('hud-rx-temp').textContent = `${Math.round(rx.tAvgC)}°C / ${rx.primaryPressurePsi}`;

    // Master Warning Annunciators
    document.getElementById('ann-cavitating').className =
      'annunciator ' + (sub.isCavitating ? 'crit-active' : '');
    document.getElementById('ann-thermocline').className =
      'annunciator ' + (this.currentThermoclineM && sub.depthM > this.currentThermoclineM ? 'warn-active' : '');
    document.getElementById('ann-esm').className =
      'annunciator ' + (sub.esmMastRaised && sub.depthM <= 20 ? 'warn-active' : '');
    document.getElementById('ann-active-sonar').className =
      'annunciator ' + (this.simTimeSec - this.lastHostilePingTime < 8 ? 'crit-active' : '');

    const hostileTorpInWater = this.weapons.some(
      (weapon) => !weapon.isPlayer && weapon.type === 'TORPEDO' && !weapon.exploded
    );
    if (!hostileTorpInWater) this.torpedoAlarmAcknowledged = false;
    const torpedoAnnunciator = document.getElementById('ann-torpedo');
    torpedoAnnunciator.className = 'annunciator ' + (hostileTorpInWater ? 'crit-active' : '');
    torpedoAnnunciator.setAttribute('aria-pressed', String(this.torpedoAlarmAcknowledged));
    torpedoAnnunciator.title = hostileTorpInWater
      ? (this.torpedoAlarmAcknowledged ? 'Audible klaxon silenced; visual warning remains active' : 'Click to silence the torpedo klaxon')
      : 'No hostile torpedo currently in the water';
    document.body.classList.toggle('red-alert', hostileTorpInWater);

    document.getElementById('ann-depth').className =
      'annunciator ' + (sub.depthM > sub.testDepthM ? 'crit-active' : '');
    document.getElementById('ann-scram').className =
      'annunciator ' + (rx.status === 'SCRAMMED' ? 'crit-active' : '');

    // Sidebar Cavitation status
    const cavWarn = document.getElementById('sidebar-cav-warn');
    if (cavWarn) {
      cavWarn.textContent = sub.isCavitating ? 'CAVITATING!' : `QUIET (<${sub.cavitationSpeedKts}KT)`;
      cavWarn.style.color = sub.isCavitating ? 'var(--crt-red)' : 'var(--crt-green)';
    }

    // Update Environment Panel in Tactical View
    document.getElementById('bathy-source-badge').textContent = window.Bathymetry.onlineStatus;
    document.getElementById('env-water-depth').textContent = `${this.currentSeafloorM} m`;
    document.getElementById('env-clearance').textContent = `${Math.max(0, Math.round(this.currentSeafloorM - sub.depthM))} m`;
    document.getElementById('env-layer-depth').textContent = this.currentThermoclineM ? `${this.currentThermoclineM} m` : 'NONE';
    const svp = window.Bathymetry.getAcousticProfileAtDepth(sub.depthM, this.currentThermoclineM);
    document.getElementById('env-sound-vel').textContent = `${svp.soundSpeed} m/s (${svp.tempC}°C)`;
    document.getElementById('env-towed-status').textContent = sub.towedArrayDamaged
      ? 'SHEARED / INOP'
      : (sub.towedArrayDeployed ? 'STREAMED (800m)' : 'RETRACTED');

    // Update Station-Specific Live Readouts
    this.updateContactsTableUI();
    this.updateSonarAndWeaponsReadouts();
    this.updateManeuveringAndReactorReadouts();
    this.renderDamageControlUI();
    this.renderWireControlUI();
  }

  renderDamageControlUI() {
    const dc = this.ownSub.damageControl;
    if (!dc) return;
    const statusClass = (health) => health <= 40 ? 'dc-status-critical' : health <= 75 ? 'dc-status-warn' : 'dc-status-good';
    for (const [zone, compartment] of Object.entries(dc.compartments)) {
      const el = document.querySelector(`[data-dc-zone="${zone}"]`);
      if (!el) continue;
      const health = Math.round(compartment.integrityPct);
      el.classList.remove('dc-status-good', 'dc-status-warn', 'dc-status-critical');
      el.classList.add(statusClass(health));
      el.querySelector('[data-dc-integrity]').textContent = `${health}%`;
      el.querySelector('[data-dc-integrity-bar]').style.width = `${health}%`;
      const flood = Math.round(compartment.floodingPct);
      el.querySelector('[data-dc-flooding]').textContent = flood > 0 ? `FLOOD ${flood}%` : 'DRY';
      el.querySelector('[data-dc-flooding]').style.color = flood > 40 ? 'var(--crt-red)' : flood > 0 ? 'var(--crt-amber)' : 'var(--crt-cyan)';
    }

    const hull = Math.round(this.ownSub.hullIntegrityPct);
    document.getElementById('dc-hull-integrity').textContent = `${hull}%`;
    document.getElementById('dc-hull-bar').style.width = `${hull}%`;
    document.getElementById('dc-flooding-total').textContent = `${Math.round(dc.totalFloodingPct)}%`;
    document.getElementById('dc-flooding-bar').style.width = `${dc.totalFloodingPct}%`;
    const overall = document.getElementById('dc-overall-status');
    overall.textContent = hull <= 40 ? 'HULL: CRITICAL' : hull <= 75 ? 'HULL: DAMAGED' : 'HULL: NOMINAL';
    overall.className = statusClass(hull);

    for (const row of document.querySelectorAll('[data-dc-system]')) {
      const health = Math.round(dc.getSystemHealth(row.dataset.dcSystem));
      const value = row.querySelector('strong');
      value.textContent = `${health}%`;
      value.className = statusClass(health);
    }
    const pumpState = document.getElementById('dc-pump-state');
    const pumpButton = document.getElementById('btn-dc-pump');
    pumpState.textContent = dc.pumping ? 'PUMPS RUNNING' : 'PUMPS STANDBY';
    pumpState.className = dc.pumping ? 'dc-status-good' : '';
    pumpButton.textContent = dc.pumping ? 'STOP DEWATERING PUMPS' : 'START DEWATERING PUMPS';
    pumpButton.classList.toggle('active', dc.pumping);
  }

  updateContactsTableUI() {
    const tbody = document.getElementById('contacts-table-body');
    if (!tbody) return;

    const detectedContacts = this.contacts.filter((c) => c.detected && !c.sunk);
    document.getElementById('contact-count-badge').textContent = `${detectedContacts.length} TRACKS`;

    tbody.innerHTML = '';
    for (const c of detectedContacts) {
      const tr = document.createElement('tr');
      if (this.selectedContactId === c.id) tr.className = 'selected';

      const prof = c.classifiedAs ? window.ACOUSTIC_PROFILES[c.classifiedAs] : null;
      const classLabel = prof ? prof.shortName : 'UNKNOWN';
      const brgStr = Math.round(c.lastTrueBrg).toString().padStart(3, '0') + '°';
      const rngStr = c.tmaQualityPct >= 20 ? `${c.estRangeNm.toFixed(1)}NM` : '--.-';
      const col = !prof
        ? 'var(--crt-amber)'
        : prof.allegiance === 'HOSTILE'
        ? 'var(--crt-red)'
        : prof.allegiance === 'FRIENDLY'
        ? 'var(--crt-cyan)'
        : prof.allegiance === 'BIOLOGIC'
        ? '#a8ff60'
        : 'var(--crt-green)';

      tr.innerHTML = `
        <td>${c.id}</td>
        <td style="color:${col}">${classLabel}</td>
        <td>${brgStr}</td>
        <td>${rngStr}</td>
        <td>${Math.round(c.tmaQualityPct)}%</td>
      `;
      tr.addEventListener('click', () => this.selectContact(c.id));
      tbody.appendChild(tr);
    }

    // Selected Target Quick Box
    const sel = this.getSelectedContact();
    const qId = document.getElementById('quick-tgt-id');
    const qDet = document.getElementById('quick-tgt-details');
    if (sel && sel.detected && !sel.sunk) {
      const prof = sel.classifiedAs ? window.ACOUSTIC_PROFILES[sel.classifiedAs] : null;
      qId.textContent = `${sel.designation} (${prof ? prof.shortName : 'UNCLASSIFIED'})`;
      qDet.innerHTML = `
        BRG: <strong>${Math.round(sel.lastTrueBrg).toString().padStart(3, '0')}°</strong> |
        EST RNG: <strong>${sel.estRangeNm.toFixed(1)} NM</strong> |
        CRS/SPD: <strong>${sel.estHeading}° / ${sel.estSpeedKts} KT</strong> |
        DEPTH: <strong>${Math.round(sel.depthM)}m</strong>
      `;
    } else {
      qId.textContent = 'NONE';
      qDet.textContent = 'Select a contact on the map, waterfall, or table.';
    }
  }

  updateSonarAndWeaponsReadouts() {
    const sel = this.getSelectedContact();
    if (sel && sel.detected && !sel.sunk) {
      const prof = sel.classifiedAs ? window.ACOUSTIC_PROFILES[sel.classifiedAs] : null;
      document.getElementById('tma-track-id').textContent = sel.id;
      document.getElementById('tma-desig').textContent = sel.designation;
      document.getElementById('tma-class').textContent = prof ? prof.name : 'UNCLASSIFIED (USE DEMON)';
      document.getElementById('tma-brg').textContent =
        `${sel.lastTrueBrg.toFixed(1)}° (${sel.bearingRateDegMin >= 0 ? '+' : ''}${sel.bearingRateDegMin.toFixed(1)}°/m)`;
      document.getElementById('tma-quality').textContent =
        `${Math.round(sel.tmaQualityPct)}% (${sel.tmaQualityPct >= 75 ? 'FIRING SOLUTION' : 'TRACKING'})`;
      document.getElementById('tma-quality-bar').style.width = `${sel.tmaQualityPct}%`;
      document.getElementById('tma-range').textContent =
        `${sel.estRangeNm.toFixed(2)} NM (${Math.round(sel.estRangeNm * 2025.37)} yds)`;
      document.getElementById('tma-crs-spd').textContent = `${sel.estHeading.toString().padStart(3, '0')}° / ${sel.estSpeedKts} KT`;
      document.getElementById('tma-depth').textContent = `${Math.round(sel.depthM)} m`;
      document.getElementById('tma-snr').textContent = `${sel.snrDb >= 0 ? '+' : ''}${sel.snrDb} dB`;

      // Fire Control Solution Panel
      document.getElementById('fc-selected-target').textContent = `TARGET: ${sel.designation}`;
      document.getElementById('fc-tgt-name').textContent = prof ? prof.shortName : sel.designation;
      document.getElementById('fc-tgt-qual').textContent = `${Math.round(sel.tmaQualityPct)}%`;
      document.getElementById('fc-tgt-brg').textContent = `${Math.round(sel.lastTrueBrg).toString().padStart(3, '0')}°`;
      const leadHdg = this.computeInterceptHeading(sel);
      document.getElementById('fc-lead-hdg').textContent = `${leadHdg.toString().padStart(3, '0')}°`;
      document.getElementById('fc-tgt-rng').textContent = `${sel.estRangeNm.toFixed(1)} NM`;
      const torpSpd = Number(document.getElementById('select-weps-speed').value) || 40;
      const runSec = Math.round((sel.estRangeNm / torpSpd) * 3600);
      document.getElementById('fc-run-time').textContent =
        `${Math.floor(runSec / 60)}m ${(runSec % 60).toString().padStart(2, '0')}s`;
    }

    // Active weapons list on Tactical screen
    const activeWeps = this.weapons.filter((w) => !w.exploded);
    const tacWepEl = document.getElementById('tac-active-weapons-list');
    if (tacWepEl) {
      if (activeWeps.length === 0) {
        tacWepEl.innerHTML = 'NO WEAPONS IN WATER / AIR';
      } else {
        tacWepEl.innerHTML = activeWeps
          .map(
            (w) =>
              `<div style="color:${w.isPlayer ? 'var(--crt-amber)' : 'var(--crt-red)'}">` +
              `<strong>${w.id}</strong>: HDG ${Math.round(w.heading).toString().padStart(3, '0')}° | ${w.speedKts}KT | ${w.seekerActive ? 'HOMING' : 'TRANSIT'}</div>`
          )
          .join('');
      }
    }
  }

  updateManeuveringAndReactorReadouts() {
    const sub = this.ownSub;
    const rx = this.reactor;

    // Maneuvering Station
    document.getElementById('val-bow-planes').textContent = `${sub.bowPlanesDeg.toFixed(1)}°`;
    document.getElementById('val-stern-planes').textContent = `${sub.sternPlanesDeg.toFixed(1)}°`;
    document.getElementById('val-rudder').textContent = `${sub.rudderDeg.toFixed(1)}°`;
    if (sub.autoDepth) {
      document.getElementById('slider-bow-planes').value = sub.bowPlanesDeg;
      document.getElementById('slider-stern-planes').value = sub.sternPlanesDeg;
    }
    if (!sub.manualRudder) {
      document.getElementById('slider-rudder').value = sub.rudderDeg;
    }

    document.getElementById('mbt-fill-pct').textContent =
      `${sub.mbtFillPct.toFixed(1)}% (${sub.mbtFillPct > 95 ? 'SUBMERGED' : 'POSITIVELY BUOYANT'})`;
    document.getElementById('mbt-fill-bar').style.width = `${sub.mbtFillPct}%`;
    document.getElementById('mbt-vent-state').textContent = sub.mbtVentsOpen ? 'OPEN (FLOODING)' : 'CLOSED';
    document.getElementById('hp-air-psi').textContent =
      `${Math.round(sub.hpAirPsi)} PSI (${Math.round((sub.hpAirPsi / 4500) * 100)}%)`;
    document.getElementById('hp-air-bar').style.width = `${(sub.hpAirPsi / 4500) * 100}%`;
    document.getElementById('trim-aux-tons').textContent = `${sub.auxTrimTons >= 0 ? '+' : ''}${sub.auxTrimTons.toFixed(1)} TONS`;

    // Reactor Station
    document.getElementById('rx-rod-pct').textContent = `${rx.rodPositionPct.toFixed(1)}%`;
    if (rx.autoRegulator) {
      document.getElementById('slider-control-rods').value = rx.rodPositionPct;
    }
    document.getElementById('rx-val-flux').textContent =
      `${rx.neutronFluxPct.toFixed(1)}% (${((rx.neutronFluxPct / 100) * rx.ratedThermalMW).toFixed(1)} MWt)`;
    document.getElementById('rx-val-tavg').textContent = `${rx.tAvgC.toFixed(1)} °C`;
    document.getElementById('rx-val-thot').textContent = `${Math.round(rx.tHotC)}°C / ${Math.round(rx.tColdC)}°C`;
    document.getElementById('rx-val-press').textContent = `${rx.primaryPressurePsi} PSI`;
    document.getElementById('rx-val-steam').textContent = `${Math.round(rx.steamPressurePsi)} PSI`;
    document.getElementById('rx-val-rpm').textContent = `${Math.round(rx.shaftRpm)} RPM`;
    document.getElementById('rx-val-elec').textContent =
      rx.electricalOutputMWe > 0 ? `${rx.electricalOutputMWe.toFixed(1)} MWe (ONLINE)` : '0.0 MWe (ON BATTERY)';
    document.getElementById('rx-val-diesel').textContent = rx.dieselRunning ? 'RUNNING (SNORKELING)' : 'STANDBY';
  }

  renderObjectivesList() {
    const el = document.getElementById('tac-objectives-list');
    if (!el) return;
    el.innerHTML = this.currentMission.objectives
      .map((obj) => {
        const kills = this.contacts.filter((c) => c.sunk && c.profile.id === obj.targetProfile).length;
        const done = kills >= obj.requiredKills;
        return `<div style="color:${done ? 'var(--crt-green)' : 'var(--crt-amber)'}">[${done ? '✔' : ' '}] ${obj.text}</div>`;
      })
      .join('');
  }

  renderTubesUI() {
    document.getElementById('weps-reload-stock').textContent = `MAGAZINE: ${this.torpedoMagazine} REM`;
    const container = document.getElementById('torpedo-tubes-container');
    if (container) {
      container.innerHTML = '';
      for (const t of this.torpedoTubes) {
        const div = document.createElement('div');
        div.className = 'tube-row';
        const badgeClass =
          t.state === 'READY'
            ? 'ready'
            : t.state === 'FLOODING'
            ? 'flooded'
            : t.state === 'RELOADING'
            ? 'firing'
            : 'dry';
        const statusText =
          t.timer > 0 ? `${t.state} (${Math.ceil(t.timer)}s)` : t.state;

        div.innerHTML = `
          <div class="tube-header">
            <span>TUBE ${t.index}: ${t.weapon}</span>
            <span class="tube-status-badge ${badgeClass}">${statusText}</span>
          </div>
          <div style="display:flex; gap:4px;">
            <button class="mil-btn" style="flex:1" data-flood="${t.index}" ${t.state !== 'DRY' ? 'disabled' : ''}>FLOOD &amp; OPEN</button>
            <button class="mil-btn danger" style="flex:1" data-fire="${t.index}" ${t.state !== 'READY' ? 'disabled' : ''}>FIRE TUBE ${t.index}</button>
          </div>
        `;
        container.appendChild(div);
      }

      container.querySelectorAll('[data-flood]').forEach((btn) => {
        btn.addEventListener('click', () => this.floodTorpedoTube(Number(btn.dataset.flood)));
      });
      container.querySelectorAll('[data-fire]').forEach((btn) => {
        btn.addEventListener('click', () => this.fireTorpedoTube(Number(btn.dataset.fire)));
      });
    }

    // VLS Tubes UI
    const vlsContainer = document.getElementById('vls-tubes-container');
    if (vlsContainer) {
      vlsContainer.innerHTML = '';
      const grid = document.createElement('div');
      grid.className = 'grid-2';
      for (const v of this.vlsTubes) {
        const btn = document.createElement('button');
        btn.className = 'mil-btn ' + (v.state === 'READY' ? 'amber' : '');
        btn.disabled = v.state !== 'READY';
        btn.textContent = `VLS ${v.index}: ${v.state === 'READY' ? v.weapon.replace('UGM-84 ', '').replace('UGM-109E ', '') : 'EMPTY'}`;
        btn.addEventListener('click', () => this.fireVlsMissile(v.index));
        grid.appendChild(btn);
      }
      vlsContainer.appendChild(grid);
    }
  }

  renderWireControlUI() {
    const panel = document.getElementById('wire-control-panel');
    if (!panel) return;
    const wiredTorps = this.weapons.filter((w) => w.isPlayer && w.type === 'TORPEDO' && !w.exploded);
    document.getElementById('wire-active-count').textContent = `${wiredTorps.filter((w) => w.wireConnected).length} ACTIVE`;

    if (wiredTorps.length === 0) {
      panel.innerHTML = `<div style="color:var(--text-muted); text-align:center; padding-top:30px;">NO TORPEDOES CURRENTLY IN WATER</div>`;
      return;
    }

    panel.innerHTML = '';
    for (const w of wiredTorps) {
      const box = document.createElement('div');
      box.className = 'tube-row';
      box.innerHTML = `
        <div class="tube-header">
          <span style="color:var(--crt-amber)">${w.id} (TUBE ${w.tubeIndex})</span>
          <span style="color:${w.wireConnected ? 'var(--crt-green)' : 'var(--crt-red)'}">
            ${w.wireConnected ? 'WIRE ONLINE' : 'WIRE PARTED'} | ${w.seekerActive ? (w.lockedTarget ? 'LOCKED!' : 'SEEKER ON') : `ENBL IN ${Math.max(0, Math.round(w.enableDistanceYds - w.runDistanceYds))}y`}
          </span>
        </div>
        <div style="font-size:10px; display:flex; justify-content:space-between;">
          <span>HDG: ${Math.round(w.heading).toString().padStart(3, '0')}° | DEPTH: ${Math.round(w.depthM)}m | SPD: ${w.speedKts} KT</span>
          <span>RUN: ${Math.round(w.runDistanceYds)} yds</span>
        </div>
        ${
          w.wireConnected
            ? `<div style="display:flex; gap:3px; margin-top:2px;">
                <button class="mil-btn" data-wturn="${w.id}" data-deg="-20">L 20°</button>
                <button class="mil-btn" data-wturn="${w.id}" data-deg="20">R 20°</button>
                <button class="mil-btn" data-wdepth="${w.id}" data-d="15">SURF 15m</button>
                <button class="mil-btn" data-wdepth="${w.id}" data-d="165">DEEP 165m</button>
                <button class="mil-btn amber" data-wact="${w.id}">ENABLE NOW</button>
              </div>`
            : ''
        }
      `;
      panel.appendChild(box);
    }

    panel.querySelectorAll('[data-wturn]').forEach((b) => {
      b.addEventListener('click', () => {
        const torp = this.weapons.find((x) => x.id === b.dataset.wturn);
        if (torp && torp.wireConnected) {
          torp.orderedHeading = (torp.orderedHeading + Number(b.dataset.deg) + 360) % 360;
        }
      });
    });
    panel.querySelectorAll('[data-wdepth]').forEach((b) => {
      b.addEventListener('click', () => {
        const torp = this.weapons.find((x) => x.id === b.dataset.wdepth);
        if (torp && torp.wireConnected) {
          torp.orderedDepthM = Number(b.dataset.d);
        }
      });
    });
    panel.querySelectorAll('[data-wact]').forEach((b) => {
      b.addEventListener('click', () => {
        const torp = this.weapons.find((x) => x.id === b.dataset.wact);
        if (torp && torp.wireConnected) {
          torp.seekerActive = true;
          torp.speedKts = 52;
        }
      });
    });
  }

  populateMissionModal() {
    const baseSel = document.getElementById('select-nato-base');
    const baseDesc = document.getElementById('base-description-text');
    if (!baseSel) return;

    baseSel.innerHTML = '';
    window.NATO_BASES.forEach((b) => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = `${b.name} — [${b.country}]`;
      baseSel.appendChild(opt);
    });

    const updateBaseInfo = () => {
      const b = window.NATO_BASES.find((x) => x.id === baseSel.value) || window.NATO_BASES[0];
      if (baseDesc && b) {
        baseDesc.textContent = `${b.description} (${window.Bathymetry.formatLatLon(b.lat, b.lon)})`;
      }
    };
    baseSel.addEventListener('change', updateBaseInfo);
    updateBaseInfo();
  }

  populateOniDatabaseUI() {
    const sel = document.getElementById('select-classify-profile');
    const dbMini = document.getElementById('oni-db-mini');
    if (!sel || !dbMini) return;

    sel.innerHTML = '';
    dbMini.innerHTML = '';

    Object.values(window.ACOUSTIC_PROFILES).forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      const bladeTag = p.category === 'BIOLOGIC' ? 'BIO' : `${p.blades}B`;
      opt.textContent = `${p.name} [${bladeTag} | ${p.tonalHz.join('/')}Hz]`;
      sel.appendChild(opt);

      const row = document.createElement('div');
      row.style.borderBottom = '1px dotted #14291b';
      row.style.padding = '3px 0';
      const col =
        p.allegiance === 'HOSTILE'
          ? 'var(--crt-red)'
          : p.allegiance === 'FRIENDLY'
          ? 'var(--crt-cyan)'
          : p.allegiance === 'BIOLOGIC'
          ? '#a8ff60'
          : 'var(--crt-green)';
      row.innerHTML = `
        <strong style="color:${col}">${p.shortName}</strong>:
        <span style="color:var(--crt-cyan)">${p.tonalHz.join(', ')} Hz</span> (${p.category === 'BIOLOGIC' ? 'Biologic' : p.blades + '-Blade'})
      `;
      dbMini.appendChild(row);
    });
  }

  switchStation(stationName) {
    this.activeStation = stationName;
    document.querySelectorAll('.station-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.station === stationName);
    });
    document.querySelectorAll('.station-screen').forEach((scr) => {
      scr.classList.toggle('active', scr.id === `screen-${stationName}`);
    });
    if (stationName === 'tactical' && window.Stations.leafletMap) {
      setTimeout(() => window.Stations.leafletMap.invalidateSize(), 50);
    }
  }

  bindUIEvents() {
    // Station Tabs
    document.querySelectorAll('.station-tab').forEach((btn) => {
      btn.addEventListener('click', () => this.switchStation(btn.dataset.station));
    });

    // Damage Control station
    document.getElementById('btn-dc-pump').addEventListener('click', () => {
      const dc = this.ownSub.damageControl;
      dc.setPumping(!dc.pumping);
      this.renderDamageControlUI();
      window.GameLogger.log('ENG', dc.pumping ? 'Compartment dewatering pumps engaged.' : 'Compartment dewatering pumps secured.', 'conn');
    });

    // Time Compression & Audio
    const torpedoAnnunciator = document.getElementById('ann-torpedo');
    torpedoAnnunciator.addEventListener('click', () => {
      const threatActive = this.weapons.some(
        (weapon) => !weapon.isPlayer && weapon.type === 'TORPEDO' && !weapon.exploded
      );
      if (!threatActive || this.torpedoAlarmAcknowledged) return;
      this.torpedoAlarmAcknowledged = true;
      if (window.SubAudio) window.SubAudio.stopAlarm('TORPEDO');
      torpedoAnnunciator.setAttribute('aria-pressed', 'true');
      torpedoAnnunciator.title = 'Audible klaxon silenced; visual warning remains active';
      window.GameLogger.log('CONN', 'Torpedo klaxon acknowledged and silenced. Visual warning remains active.', 'conn');
    });

    const setTimeRate = (rate) => {
      this.timeCompression = rate;
      document.getElementById('hud-sim-rate').textContent = `${rate}x SPEED`;
    };
    document.getElementById('btn-time-1x').addEventListener('click', () => setTimeRate(1));
    document.getElementById('btn-time-2x').addEventListener('click', () => setTimeRate(2));
    document.getElementById('btn-time-5x').addEventListener('click', () => setTimeRate(5));
    document.getElementById('btn-time-10x').addEventListener('click', () => setTimeRate(10));

    // Play crisp 90s CRT console beep on any button or tab click
    document.addEventListener('click', (e) => {
      if (e.target.closest('.mil-btn') || e.target.closest('.station-tab')) {
        if (window.SubAudio) window.SubAudio.playConsoleBeep(1180, 0.035);
      }
    });

    // Map Controls
    document.getElementById('btn-map-follow').addEventListener('click', (e) => {
      window.Stations.followSub = !window.Stations.followSub;
      e.target.classList.toggle('active', window.Stations.followSub);
    });
    document.getElementById('btn-map-waypoint').addEventListener('click', (e) => {
      window.Stations.waypointMode = !window.Stations.waypointMode;
      e.target.classList.toggle('active', window.Stations.waypointMode);
    });
    document.getElementById('btn-map-bathy-probe').addEventListener('click', (e) => {
      window.Stations.bathyProbeMode = !window.Stations.bathyProbeMode;
      e.target.classList.toggle('active', window.Stations.bathyProbeMode);
    });
    document.getElementById('btn-map-layer-ocean').addEventListener('click', () => window.Stations.setMapLayer('OCEAN'));
    document.getElementById('btn-map-layer-dark').addEventListener('click', () => window.Stations.setMapLayer('DARK'));
    document.getElementById('btn-ping-active-quick').addEventListener('click', () => this.triggerActiveSonarPing());

    // Helm & Conn Sidebar Orders
    const applyOrderHdg = (deg) => {
      const norm = ((Math.round(deg) % 360) + 360) % 360;
      this.ownSub.orderedHeading = norm;
      this.ownSub.manualRudder = false;
      this.ownSub.waypoint = null;
      document.getElementById('input-order-hdg').value = norm;
    };
    document.getElementById('input-order-hdg').addEventListener('change', (e) => applyOrderHdg(Number(e.target.value)));
    document.getElementById('btn-hdg-l15').addEventListener('click', () => applyOrderHdg(this.ownSub.orderedHeading - 15));
    document.getElementById('btn-hdg-r15').addEventListener('click', () => applyOrderHdg(this.ownSub.orderedHeading + 15));

    const applyOrderDepth = (d) => {
      const clamped = Math.max(0, Math.min(650, Math.round(d)));
      if (clamped > this.ownSub.depthM + 15) {
        if (window.SubAudio) window.SubAudio.playDiveKlaxon();
        window.GameLogger.log('CONN', `DIVE! DIVE! Make your depth ${clamped} meters.`, 'conn');
      } else if (clamped < this.ownSub.depthM - 15) {
        window.GameLogger.log('CONN', `Helm: Make your depth ${clamped} meters.`, 'conn');
      }
      this.ownSub.orderedDepthM = clamped;
      this.ownSub.autoDepth = true;
      document.getElementById('input-order-depth').value = clamped;
    };
    document.getElementById('input-order-depth').addEventListener('change', (e) => applyOrderDepth(Number(e.target.value)));
    document.getElementById('btn-depth-pd').addEventListener('click', () => applyOrderDepth(18));
    document.getElementById('btn-depth-layer').addEventListener('click', () => {
      const layer = this.currentThermoclineM || 115;
      applyOrderDepth(this.ownSub.depthM < layer ? layer + 35 : Math.max(40, layer - 35));
    });
    document.getElementById('btn-depth-deep').addEventListener('click', () => applyOrderDepth(300));

    // Engine Telegraph Buttons
    document.querySelectorAll('.telegraph-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.telegraph-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const spd = Number(btn.dataset.spd);
        this.ownSub.orderedSpeedKts = spd;
        window.SubAudio.init();
      });
    });

    // Quick Fire Buttons in Right Sidebar
    document.getElementById('btn-quick-fire-torp').addEventListener('click', () => {
      const sel = this.getSelectedContact();
      if (sel) {
        document.getElementById('input-weps-hdg').value = this.computeInterceptHeading(sel);
        document.getElementById('input-weps-depth').value = sel.depthM <= 5 ? 8 : Math.round(sel.depthM);
      }
      const readyTube = this.torpedoTubes.find((t) => t.state === 'READY');
      if (readyTube) {
        this.fireTorpedoTube(readyTube.index);
      } else {
        const dryTube = this.torpedoTubes.find((t) => t.state === 'DRY');
        if (dryTube) this.floodTorpedoTube(dryTube.index);
      }
    });

    document.getElementById('btn-quick-fire-missile').addEventListener('click', () => {
      const readyVls = this.vlsTubes.find((v) => v.state === 'READY');
      if (readyVls) this.fireVlsMissile(readyVls.index);
    });

    // Sonar Station Controls
    document.getElementById('btn-sonar-ping').addEventListener('click', () => this.triggerActiveSonarPing());
    document.getElementById('btn-towed-array').addEventListener('click', (e) => {
      if (this.ownSub.towedArrayDamaged) return;
      this.ownSub.towedArrayDeployed = !this.ownSub.towedArrayDeployed;
      e.target.classList.toggle('active', this.ownSub.towedArrayDeployed);
      e.target.textContent = `TB-29A TOWED ARRAY: ${this.ownSub.towedArrayDeployed ? 'DEPLOYED' : 'RETRACTED'}`;
    });

    // Waterfall Click to Select Contact
    const wfCanvas = document.getElementById('sonar-waterfall-canvas');
    wfCanvas.addEventListener('mousemove', (e) => {
      const rect = wfCanvas.getBoundingClientRect();
      const brg = Math.round(((e.clientX - rect.left) / rect.width) * 360) % 360;
      document.getElementById('sonar-cursor-brg').textContent = `BRG: ${brg.toString().padStart(3, '0')}°`;
    });
    wfCanvas.addEventListener('click', (e) => {
      const rect = wfCanvas.getBoundingClientRect();
      const clickBrg = ((e.clientX - rect.left) / rect.width) * 360;
      let best = null;
      let minDiff = 15;
      for (const c of this.contacts) {
        if (!c.detected || c.sunk) continue;
        const diff = Math.abs(((c.lastTrueBrg - clickBrg + 540) % 360) - 180);
        if (diff < minDiff) {
          minDiff = diff;
          best = c;
        }
      }
      if (best) this.selectContact(best.id);
    });

    // Classification Controls
    document.getElementById('btn-confirm-classify').addEventListener('click', () => {
      const sel = this.getSelectedContact();
      if (!sel) return;
      const chosenId = document.getElementById('select-classify-profile').value;
      sel.classifiedAs = chosenId;
      const prof = window.ACOUSTIC_PROFILES[chosenId];
      window.GameLogger.log('SONAR', `Contact ${sel.designation} classified as ${prof.name}.`, 'sonar');
      this.updateContactsTableUI();
    });

    document.getElementById('btn-auto-classify').addEventListener('click', () => {
      const sel = this.getSelectedContact();
      if (!sel) return;
      sel.classifiedAs = sel.profile.id;
      document.getElementById('select-classify-profile').value = sel.profile.id;
      window.GameLogger.log(
        'SONAR',
        `Sonar Supervisor matched DEMON blade rate (${sel.profile.blades} blades, ${sel.profile.tonalHz.join('/')} Hz): ${sel.designation} is ${sel.profile.name}!`,
        'sonar'
      );
      this.updateContactsTableUI();
    });

    // Weapons Station Controls
    document.getElementById('btn-weps-sync-lead').addEventListener('click', () => {
      const sel = this.getSelectedContact();
      if (sel) document.getElementById('input-weps-hdg').value = this.computeInterceptHeading(sel);
    });
    document.getElementById('btn-weps-depth-surf').addEventListener('click', () => {
      document.getElementById('input-weps-depth').value = 8;
    });
    document.getElementById('btn-weps-depth-deep').addEventListener('click', () => {
      document.getElementById('input-weps-depth').value = (this.currentThermoclineM || 115) + 45;
    });
    document.getElementById('btn-fc-zoom').addEventListener('click', (e) => {
      window.Stations.fcZoomNm = window.Stations.fcZoomNm === 10 ? 20 : window.Stations.fcZoomNm === 20 ? 5 : 10;
      e.target.textContent = `${window.Stations.fcZoomNm} NM`;
    });

    // Countermeasures & Evasive Knuckle
    document.getElementById('btn-launch-decoy').addEventListener('click', () => {
      if (this.ownSub.decoysRemaining > 0) {
        this.ownSub.decoysRemaining--;
        document.getElementById('cm-count').textContent = this.ownSub.decoysRemaining;
        this.spawnDecoy(this.ownSub.lat, this.ownSub.lon, this.ownSub.depthM, true, 'USS VIRGINIA');
      }
    });
    document.getElementById('btn-evasive-knuckle').addEventListener('click', () => {
      applyOrderHdg(this.ownSub.heading + 110);
      this.ownSub.orderedSpeedKts = 32;
      if (this.ownSub.decoysRemaining > 0) {
        this.ownSub.decoysRemaining--;
        document.getElementById('cm-count').textContent = this.ownSub.decoysRemaining;
        this.spawnDecoy(this.ownSub.lat, this.ownSub.lon, this.ownSub.depthM, true, 'USS VIRGINIA');
      }
      window.GameLogger.log('CONN', 'Executing Evasive Knuckle! Hard rudder, Ahead Flank, launching noisemaker!', 'alert');
    });

    // Maneuvering & Trim Controls
    document.getElementById('slider-bow-planes').addEventListener('input', (e) => {
      this.ownSub.autoDepth = false;
      this.ownSub.bowPlanesDeg = Number(e.target.value);
      document.getElementById('btn-auto-depth').classList.remove('active');
      document.getElementById('btn-manual-planes').classList.add('active');
    });
    document.getElementById('slider-stern-planes').addEventListener('input', (e) => {
      this.ownSub.autoDepth = false;
      this.ownSub.sternPlanesDeg = Number(e.target.value);
      document.getElementById('btn-auto-depth').classList.remove('active');
      document.getElementById('btn-manual-planes').classList.add('active');
    });
    document.getElementById('slider-rudder').addEventListener('input', (e) => {
      this.ownSub.manualRudder = true;
      this.ownSub.rudderDeg = Number(e.target.value);
    });
    document.getElementById('btn-auto-depth').addEventListener('click', () => {
      this.ownSub.autoDepth = true;
      document.getElementById('btn-auto-depth').classList.add('active');
      document.getElementById('btn-manual-planes').classList.remove('active');
    });
    document.getElementById('btn-manual-planes').addEventListener('click', () => {
      this.ownSub.autoDepth = false;
      document.getElementById('btn-auto-depth').classList.remove('active');
      document.getElementById('btn-manual-planes').classList.add('active');
    });
    document.getElementById('btn-zero-helm').addEventListener('click', () => {
      this.ownSub.bowPlanesDeg = 0;
      this.ownSub.sternPlanesDeg = 0;
      this.ownSub.rudderDeg = 0;
      this.ownSub.manualRudder = false;
    });

    // Ballast & Blow Controls
    document.getElementById('btn-mbt-vent').addEventListener('click', () => {
      this.ownSub.mbtVentsOpen = true;
      this.ownSub.mbtBlowState = 'OFF';
      if (window.SubAudio) window.SubAudio.playPneumaticHiss(0.9);
      window.GameLogger.log('CONN', 'Opening Main Ballast Tank vents! Flooding MBTs.', 'conn');
    });
    document.getElementById('btn-mbt-blow').addEventListener('click', () => {
      this.ownSub.mbtVentsOpen = false;
      this.ownSub.mbtBlowState = this.ownSub.mbtBlowState === 'NORMAL' ? 'OFF' : 'NORMAL';
      if (window.SubAudio && this.ownSub.mbtBlowState === 'NORMAL') window.SubAudio.playPneumaticHiss(1.4);
      window.GameLogger.log('CONN', `Main Ballast Tank normal blow: ${this.ownSub.mbtBlowState}.`, 'conn');
    });
    document.getElementById('btn-emergency-blow').addEventListener('click', () => {
      this.ownSub.mbtVentsOpen = false;
      this.ownSub.mbtBlowState = 'EMERGENCY';
      this.ownSub.orderedDepthM = 0;
      if (window.SubAudio) {
        window.SubAudio.playAlarm('BLOW');
        window.SubAudio.playPneumaticHiss(2.5);
      }
      window.GameLogger.log('CONN', 'EMERGENCY MAIN BALLAST TANK BLOW! Dumping 4500 PSI High-Pressure Air to surface!', 'alert');
    });

    document.getElementById('btn-trim-flood').addEventListener('click', () => {
      this.ownSub.autoNeutralTrim = false;
      this.ownSub.auxTrimTons = Math.min(30, this.ownSub.auxTrimTons + 2.0);
      document.getElementById('btn-trim-neutral').classList.remove('active');
    });
    document.getElementById('btn-trim-pump').addEventListener('click', () => {
      this.ownSub.autoNeutralTrim = false;
      this.ownSub.auxTrimTons = Math.max(-30, this.ownSub.auxTrimTons - 2.0);
      document.getElementById('btn-trim-neutral').classList.remove('active');
    });
    document.getElementById('btn-trim-neutral').addEventListener('click', (e) => {
      this.ownSub.autoNeutralTrim = true;
      e.target.classList.add('active');
    });
    document.getElementById('btn-hp-compressor').addEventListener('click', (e) => {
      if (this.ownSub.depthM > 20) {
        window.GameLogger.log('ENG', 'Cannot run HP Air Compressor below 20m depth.', 'eng');
        return;
      }
      this.ownSub.hpCompressorOn = !this.ownSub.hpCompressorOn;
      e.target.classList.toggle('active', this.ownSub.hpCompressorOn);
    });

    // Reactor Station Controls
    document.getElementById('slider-control-rods').addEventListener('input', (e) => {
      if (this.reactor.status === 'SCRAMMED') return;
      this.reactor.autoRegulator = false;
      this.reactor.rodPositionPct = Number(e.target.value);
      document.getElementById('btn-rx-auto').classList.remove('active');
      document.getElementById('btn-rx-manual').classList.add('active');
    });
    document.getElementById('btn-rx-auto').addEventListener('click', () => {
      this.reactor.autoRegulator = true;
      document.getElementById('btn-rx-auto').classList.add('active');
      document.getElementById('btn-rx-manual').classList.remove('active');
    });
    document.getElementById('btn-rx-manual').addEventListener('click', () => {
      this.reactor.autoRegulator = false;
      document.getElementById('btn-rx-auto').classList.remove('active');
      document.getElementById('btn-rx-manual').classList.add('active');
    });

    const setPumpMode = (mode, btnId) => {
      this.reactor.pumpMode = mode;
      ['btn-pump-nat', 'btn-pump-slow', 'btn-pump-fast'].forEach((id) => {
        document.getElementById(id).classList.toggle('active', id === btnId);
      });
      window.GameLogger.log('ENG', `Main Coolant Pumps set to ${mode}.`, 'eng');
    };
    document.getElementById('btn-pump-nat').addEventListener('click', () => setPumpMode('NAT_CIRC', 'btn-pump-nat'));
    document.getElementById('btn-pump-slow').addEventListener('click', () => setPumpMode('SLOW', 'btn-pump-slow'));
    document.getElementById('btn-pump-fast').addEventListener('click', () => setPumpMode('FAST', 'btn-pump-fast'));

    document.getElementById('btn-diesel-toggle').addEventListener('click', (e) => {
      if (this.ownSub.depthM > 20) {
        window.GameLogger.log('ENG', 'Cannot start Emergency Diesel Generator below 20m Snorkel Depth!', 'alert');
        return;
      }
      this.reactor.dieselRunning = !this.reactor.dieselRunning;
      e.target.classList.toggle('active', this.reactor.dieselRunning);
    });
    document.getElementById('btn-rx-restart').addEventListener('click', () => this.reactor.attemptRestart());
    document.getElementById('btn-rx-scram').addEventListener('click', () => this.reactor.triggerScram('MANUAL OPERATOR BUTTON'));

    // Periscope, Radar & ESM Controls
    document.getElementById('btn-scope-raise').addEventListener('click', (e) => {
      if (this.ownSub.depthM > 20.5) {
        window.GameLogger.log('CONN', 'Cannot raise Photonics Mast below 20m Periscope Depth!', 'alert');
        return;
      }
      this.ownSub.periscopeRaised = !this.ownSub.periscopeRaised;
      e.target.classList.toggle('active', this.ownSub.periscopeRaised);
      e.target.textContent = this.ownSub.periscopeRaised ? 'MAST: RAISED' : 'RAISE MAST';
    });
    document.getElementById('btn-scope-ir').addEventListener('click', (e) => {
      window.Stations.scopeThermal = !window.Stations.scopeThermal;
      e.target.classList.toggle('active', window.Stations.scopeThermal);
      e.target.textContent = window.Stations.scopeThermal ? 'FLIR: ON' : 'FLIR: OFF';
    });
    document.getElementById('btn-scope-zoom').addEventListener('click', (e) => {
      window.Stations.scopeZoom = window.Stations.scopeZoom === 1.5 ? 4.0 : 1.5;
      e.target.textContent = `ZOOM ${window.Stations.scopeZoom.toFixed(1)}×`;
    });
    document.getElementById('btn-scope-weather').addEventListener('click', (e) => {
      e.target.textContent = 'METEO: ' + window.Stations.cycleScopeWeather();
    });
    document.getElementById('btn-scope-left').addEventListener('click', () => {
      window.Stations.scopeBearing = (window.Stations.scopeBearing - 10 + 360) % 360;
      document.getElementById('scope-brg-val').textContent = `${window.Stations.scopeBearing.toString().padStart(3, '0')}° TRUE`;
    });
    document.getElementById('btn-scope-right').addEventListener('click', () => {
      window.Stations.scopeBearing = (window.Stations.scopeBearing + 10) % 360;
      document.getElementById('scope-brg-val').textContent = `${window.Stations.scopeBearing.toString().padStart(3, '0')}° TRUE`;
    });
    document.getElementById('btn-scope-lock-tgt').addEventListener('click', () => {
      const sel = this.getSelectedContact();
      if (sel) {
        window.Stations.scopeBearing = Math.round(sel.lastTrueBrg);
        document.getElementById('scope-brg-val').textContent = `${window.Stations.scopeBearing.toString().padStart(3, '0')}° TRUE`;
      }
    });

    document.getElementById('btn-mast-esm').addEventListener('click', (e) => {
      if (this.ownSub.depthM > 20.5) {
        window.GameLogger.log('CONN', 'Ascend to <= 20m to raise AN/BLQ-10 ESM Mast.', 'alert');
        return;
      }
      this.ownSub.esmMastRaised = !this.ownSub.esmMastRaised;
      e.target.classList.toggle('active', this.ownSub.esmMastRaised);
      e.target.textContent = `ESM MAST: ${this.ownSub.esmMastRaised ? 'RAISED' : 'DOWN'}`;

      const esmLog = document.getElementById('esm-intercept-list');
      if (this.ownSub.esmMastRaised && esmLog) {
        const surfTargets = this.contacts.filter((c) => !c.sunk && c.depthM <= 2);
        esmLog.innerHTML = surfTargets
          .map((c) => {
            const brg = Math.round(window.Bathymetry.bearingDeg(this.ownSub.lat, this.ownSub.lon, c.lat, c.lon));
            return `<div style="color:var(--crt-amber)">BRG ${brg.toString().padStart(3, '0')}°: ${c.profile.radarName}</div>`;
          })
          .join('');
      }
    });

    document.getElementById('btn-mast-radar').addEventListener('click', (e) => {
      if (this.ownSub.depthM > 20.5) {
        window.GameLogger.log('CONN', 'Ascend to <= 20m to transmit on AN/BPS-16 Surface Search Radar.', 'alert');
        return;
      }
      this.ownSub.radarTxActive = !this.ownSub.radarTxActive;
      e.target.classList.toggle('active', this.ownSub.radarTxActive);
      e.target.textContent = `RADAR TX: ${this.ownSub.radarTxActive ? 'ACTIVE' : 'STBY'}`;
    });

    // NATO Base, Procedural Mission Generator & Save/Load Modal
    const modal = document.getElementById('briefing-modal');
    document.getElementById('btn-open-briefing').addEventListener('click', () => {
      this.checkSavedGameBanner();
      modal.style.display = 'flex';
    });
    document.getElementById('btn-close-briefing').addEventListener('click', () => (modal.style.display = 'none'));

    document.getElementById('btn-start-mission').addEventListener('click', () => {
      const baseId = document.getElementById('select-nato-base').value || 'AUGUSTA_SIGONELLA';
      const mType = document.getElementById('select-mission-type').value || 'RANDOM';
      const newMission = window.MissionGenerator.generateMission(baseId, mType);
      this.loadMission(newMission);
      modal.style.display = 'none';
    });

    const loadBtn = document.getElementById('btn-load-saved-patrol');
    if (loadBtn) {
      loadBtn.addEventListener('click', () => {
        if (this.loadSavedGameState(false)) {
          modal.style.display = 'none';
        }
      });
    }

    const saveNowBtn = document.getElementById('btn-save-now');
    if (saveNowBtn) {
      saveNowBtn.addEventListener('click', () => this.saveGameState(false));
    }

    const quickSaveBtn = document.getElementById('btn-quick-save');
    if (quickSaveBtn) {
      quickSaveBtn.addEventListener('click', () => this.saveGameState(false));
    }

    const exportBtn = document.getElementById('btn-export-save');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportSaveJson());
    }

    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === 'F1') { e.preventDefault(); this.switchStation('tactical'); }
      if (e.key === 'F2') { e.preventDefault(); this.switchStation('sonar'); }
      if (e.key === 'F3') { e.preventDefault(); this.switchStation('weapons'); }
      if (e.key === 'F4') { e.preventDefault(); this.switchStation('maneuvering'); }
      if (e.key === 'F5') { e.preventDefault(); this.switchStation('reactor'); }
      if (e.key === 'F6') { e.preventDefault(); this.switchStation('periscope'); }
      if (e.key === 'F7') { e.preventDefault(); this.switchStation('damage-control'); }
      if (e.key === 'Escape') { modal.style.display = 'none'; }
      if (e.key === 'a' || e.key === 'A') applyOrderHdg(this.ownSub.orderedHeading - 5);
      if (e.key === 'd' || e.key === 'D') applyOrderHdg(this.ownSub.orderedHeading + 5);
      if (e.key === 'w' || e.key === 'W') applyOrderDepth(this.ownSub.orderedDepthM - 10);
      if (e.key === 's' || e.key === 'S') applyOrderDepth(this.ownSub.orderedDepthM + 10);
      if (e.key === 'p' || e.key === 'P') this.triggerActiveSonarPing();
      if (e.key === 'c' || e.key === 'C') document.getElementById('btn-launch-decoy').click();
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.World = new SubmarineWorld();
  window.World.init();
});
