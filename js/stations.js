/**
 * ============================================================================
 * CRT STATION RENDERERS (TACTICAL MAP, SONAR WATERFALL, WEAPONS,
 * MANEUVERING/SVP, S9G REACTOR SCHEMATIC, PERISCOPE & RADAR/ESM)
 * ============================================================================
 */

class StationRenderers {
  constructor() {
    this.leafletMap = null;
    this.oceanLayer = null;
    this.darkLayer = null;
    this.followSub = true;
    this.waypointMode = false;
    this.bathyProbeMode = false;
    this.fcZoomNm = 10;

    // Sonar Waterfall offscreen buffer
    this.waterfallBuffer = document.createElement('canvas');
    this.waterfallBuffer.width = 720;
    this.waterfallBuffer.height = 320;
    this.waterfallCtx = this.waterfallBuffer.getContext('2d');
    this.waterfallCtx.fillStyle = '#020704';
    this.waterfallCtx.fillRect(0, 0, 720, 320);

    // Periscope state
    this.scopeBearing = 90;
    this.scopeThermal = false;
    this.scopeZoom = 1.5;
    this.coastlineModel = window.CoastlineModel ? new window.CoastlineModel() : null;
    this.scopeWeatherIndex = 0;
    this.scopeWeatherModes = [
      { name: 'CLEAR', visibilityKm: 55, hazeAlpha: 0.015 },
      { name: 'HAZE', visibilityKm: 24, hazeAlpha: 0.105 },
      { name: 'FOG', visibilityKm: 7, hazeAlpha: 0.27 }
    ];
    this.scopeVisibilityKm = this.scopeWeatherModes[0].visibilityKm;
    this.scopeHazeAlpha = this.scopeWeatherModes[0].hazeAlpha;


    // Radar sweep angle
    this.radarSweepDeg = 0;
    this.animPhase = 0;
  }

  initLeafletMap(world) {
    const mapEl = document.getElementById('leaflet-map');
    if (!mapEl || this.leafletMap) return;

    this.leafletMap = L.map('leaflet-map', {
      center: [world.ownSub.lat, world.ownSub.lon],
      zoom: 10,
      zoomControl: false,
      attributionControl: false
    });

    // Layer 1: ESRI World Ocean Basemap (Real NOAA/GEBCO Bathymetry Contours)
    this.oceanLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 14 }
    );

    // Layer 2: CartoDB Dark Matter / OpenStreetMap Tactical Vector
    this.darkLayer = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { maxZoom: 16 }
    );

    // Layer 3: OpenSeaMap Real Nautical Seamarks, Harbors, TSS Lanes & Buoys
    this.seamarkLayer = L.tileLayer(
      'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
      { maxZoom: 16, opacity: 0.78 }
    );

    this.oceanLayer.addTo(this.leafletMap);
    this.seamarkLayer.addTo(this.leafletMap);
    const tilePane = this.leafletMap.getPane('tilePane');
    if (tilePane) tilePane.classList.add('bathymetry-filter');

    // Mouse move cursor readout (Lat/Lon, Bearing/Range from sub, Bathymetry depth)
    this.leafletMap.on('mousemove', (e) => {
      const lat = e.latlng.lat;
      const lon = e.latlng.lng;
      const sub = world.ownSub;
      const brg = Math.round(window.Bathymetry.bearingDeg(sub.lat, sub.lon, lat, lon))
        .toString()
        .padStart(3, '0');
      const rng = window.Bathymetry.distanceNm(sub.lat, sub.lon, lat, lon).toFixed(1);
      const estDepth = window.Bathymetry.getSeafloorDepthMeters(lat, lon);
      const readout = document.getElementById('map-cursor-readout');
      if (readout) {
        readout.textContent = `CURSOR: ${window.Bathymetry.formatLatLon(lat, lon)} | BRG: ${brg}° | RNG: ${rng} NM | SEAFLOOR: ${estDepth === 0 ? 'LAND/SHOAL' : estDepth + 'm'}`;
      }
    });

    // Click on map: Set Waypoint, Probe Online Bathymetry, or Select Contact
    this.leafletMap.on('click', async (e) => {
      const clickLat = e.latlng.lat;
      const clickLon = e.latlng.lng;

      if (this.waypointMode) {
        world.ownSub.waypoint = { lat: clickLat, lon: clickLon };
        this.waypointMode = false;
        document.getElementById('btn-map-waypoint').classList.remove('active');
        const brg = Math.round(window.Bathymetry.bearingDeg(world.ownSub.lat, world.ownSub.lon, clickLat, clickLon));
        world.ownSub.orderedHeading = brg;
        document.getElementById('input-order-hdg').value = brg;
        window.GameLogger.log('CONN', `Helm, plot new course to waypoint (${window.Bathymetry.formatLatLon(clickLat, clickLon)}), coming to ${brg.toString().padStart(3, '0')}°.`, 'conn');
        return;
      }

      if (this.bathyProbeMode) {
        this.bathyProbeMode = false;
        document.getElementById('btn-map-bathy-probe').classList.remove('active');
        const d = await window.Bathymetry.probeOnlineBathymetry(clickLat, clickLon);
        const layer = window.Bathymetry.getThermoclineDepth(clickLat, clickLon);
        window.GameLogger.log(
          'CONN',
          `XBT / Bathymetry Probe at ${window.Bathymetry.formatLatLon(clickLat, clickLon)}: Depth ${d === 0 ? 'LAND/REEF' : d + 'm'}, Thermocline ${layer ? layer + 'm' : 'NONE (Shallow)'}.`,
          'conn'
        );
        return;
      }

      // Check if user clicked near a detected contact
      let closest = null;
      let minDist = 1.5;
      for (const c of world.contacts) {
        if (!c.detected || c.sunk) continue;
        const estPos = window.Bathymetry.destinationPoint(world.ownSub.lat, world.ownSub.lon, c.lastTrueBrg, c.estRangeNm);
        const d = window.Bathymetry.distanceNm(clickLat, clickLon, estPos.lat, estPos.lon);
        if (d < minDist) {
          minDist = d;
          closest = c;
        }
      }
      if (closest) {
        world.selectContact(closest.id);
      }
    });

    this.leafletMap.on('dragstart', () => {
      this.followSub = false;
      const btn = document.getElementById('btn-map-follow');
      if (btn) btn.classList.remove('active');
    });
  }

  setMapLayer(mode) {
    if (!this.leafletMap) return;
    const tilePane = this.leafletMap.getPane('tilePane');
    if (mode === 'OCEAN') {
      if (this.leafletMap.hasLayer(this.darkLayer)) this.leafletMap.removeLayer(this.darkLayer);
      if (!this.leafletMap.hasLayer(this.oceanLayer)) this.oceanLayer.addTo(this.leafletMap);
      if (tilePane) {
        tilePane.classList.remove('crt-map-filter');
        tilePane.classList.add('bathymetry-filter');
      }
    } else {
      if (this.leafletMap.hasLayer(this.oceanLayer)) this.leafletMap.removeLayer(this.oceanLayer);
      if (!this.leafletMap.hasLayer(this.darkLayer)) this.darkLayer.addTo(this.leafletMap);
      if (tilePane) {
        tilePane.classList.remove('bathymetry-filter');
        tilePane.classList.add('crt-map-filter');
      }
    }
  }

  /**
   * Renders tactical NTDS symbols, TMA bearing lines, baffles, and torpedo wires over Leaflet map
   */
  renderTacticalOverlay(world) {
    if (!this.leafletMap) return;
    const sub = world.ownSub;

    if (this.followSub) {
      this.leafletMap.panTo([sub.lat, sub.lon], { animate: false });
    }

    const canvas = document.getElementById('tactical-overlay-canvas');
    const wrapper = document.getElementById('map-wrapper');
    if (!canvas || !wrapper) return;

    if (canvas.width !== wrapper.clientWidth || canvas.height !== wrapper.clientHeight) {
      canvas.width = wrapper.clientWidth;
      canvas.height = wrapper.clientHeight;
      this.leafletMap.invalidateSize();
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const subPt = this.leafletMap.latLngToContainerPoint([sub.lat, sub.lon]);

    // 1. Draw NATO Mediterranean Naval Bases & Key Bathymetry Features
    ctx.font = 'bold 10px Courier New';
    if (window.NATO_BASES) {
      for (const b of window.NATO_BASES) {
        const bPt = this.leafletMap.latLngToContainerPoint([b.lat, b.lon]);
        if (bPt.x < -80 || bPt.x > canvas.width + 80 || bPt.y < -80 || bPt.y > canvas.height + 80) continue;
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bPt.x - 5, bPt.y - 5, 10, 10);
        ctx.beginPath();
        ctx.moveTo(bPt.x - 8, bPt.y);
        ctx.lineTo(bPt.x + 8, bPt.y);
        ctx.moveTo(bPt.x, bPt.y - 8);
        ctx.lineTo(bPt.x, bPt.y + 8);
        ctx.stroke();
        ctx.fillStyle = '#00e5ff';
        ctx.fillText(`NATO BASE: ${b.name.split('(')[0].trim().toUpperCase()}`, bPt.x + 10, bPt.y + 3);
      }
    }

    ctx.font = '10px Courier New';
    for (const f of window.Bathymetry.features) {
      const fPt = this.leafletMap.latLngToContainerPoint([f.lat, f.lon]);
      if (fPt.x < -100 || fPt.x > canvas.width + 100 || fPt.y < -100 || fPt.y > canvas.height + 100) continue;

      if (f.peakM < 0 && f.peakM > -200) {
        ctx.strokeStyle = 'rgba(255, 176, 0, 0.35)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(fPt.x, fPt.y, 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255, 176, 0, 0.65)';
        ctx.fillText(`${f.name.toUpperCase()} (${Math.abs(f.peakM)}m)`, fPt.x + 10, fPt.y + 3);
      }
    }

    // 2. Draw Own-Ship Baffles Cone (150° to 210° relative)
    const baffleStartRad = (((sub.heading + 150) - 90) * Math.PI) / 180;
    const baffleEndRad = (((sub.heading + 210) - 90) * Math.PI) / 180;
    ctx.fillStyle = sub.towedArrayDeployed
      ? 'rgba(0, 229, 255, 0.04)'
      : 'rgba(255, 42, 42, 0.09)';
    ctx.beginPath();
    ctx.moveTo(subPt.x, subPt.y);
    ctx.arc(subPt.x, subPt.y, 85, baffleStartRad, baffleEndRad);
    ctx.closePath();
    ctx.fill();

    // 3. Draw Waypoint Line if active
    if (sub.waypoint) {
      const wpPt = this.leafletMap.latLngToContainerPoint([sub.waypoint.lat, sub.waypoint.lon]);
      ctx.strokeStyle = '#00e5ff';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(subPt.x, subPt.y);
      ctx.lineTo(wpPt.x, wpPt.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeRect(wpPt.x - 4, wpPt.y - 4, 8, 8);
      ctx.fillStyle = '#00e5ff';
      ctx.fillText('WP', wpPt.x + 7, wpPt.y + 4);
    }

    // 4. Draw Detected Contacts & TMA Bearing Lines
    for (const c of world.contacts) {
      if (!c.detected || c.sunk) continue;

      const isSelected = world.selectedContactId === c.id;
      const estPos = window.Bathymetry.destinationPoint(sub.lat, sub.lon, c.lastTrueBrg, c.estRangeNm);
      const cPt = this.leafletMap.latLngToContainerPoint([estPos.lat, estPos.lon]);

      // Bearing line of sight (LOS) strobe
      ctx.strokeStyle = isSelected ? 'rgba(255, 176, 0, 0.55)' : 'rgba(0, 255, 102, 0.25)';
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.moveTo(subPt.x, subPt.y);
      ctx.lineTo(cPt.x, cPt.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Determine NTDS Color & Shape based on Classification
      const classifiedProfile = c.classifiedAs ? window.ACOUSTIC_PROFILES[c.classifiedAs] : null;
      let color = '#ffb000'; // Unknown Amber
      if (classifiedProfile) {
        if (classifiedProfile.allegiance === 'HOSTILE') color = '#ff2a2a';
        else if (classifiedProfile.allegiance === 'FRIENDLY') color = '#00e5ff';
        else if (classifiedProfile.allegiance === 'BIOLOGIC') color = '#a8ff60';
        else color = '#00ff66';
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 2.2 : 1.5;

      // Draw NTDS Symbol
      ctx.beginPath();
      if (!classifiedProfile) {
        // Unknown Circle
        ctx.arc(cPt.x, cPt.y, 8, 0, Math.PI * 2);
      } else if (classifiedProfile.category === 'BIOLOGIC') {
        // Biologic double wave arc
        ctx.arc(cPt.x - 4, cPt.y, 4, Math.PI, 0);
        ctx.arc(cPt.x + 4, cPt.y, 4, 0, Math.PI);
      } else if (classifiedProfile.allegiance === 'FRIENDLY') {
        // NATO Friendly Surface Circle with inner cross
        ctx.arc(cPt.x, cPt.y, 9, 0, Math.PI * 2);
        ctx.moveTo(cPt.x - 5, cPt.y);
        ctx.lineTo(cPt.x + 5, cPt.y);
      } else if (classifiedProfile.category === 'SUBMARINE') {
        // Hostile Sub V-trough symbol
        ctx.moveTo(cPt.x - 8, cPt.y - 4);
        ctx.lineTo(cPt.x, cPt.y + 8);
        ctx.lineTo(cPt.x + 8, cPt.y - 4);
      } else if (classifiedProfile.allegiance === 'HOSTILE') {
        // Hostile Surface Warship Diamond
        ctx.moveTo(cPt.x, cPt.y - 9);
        ctx.lineTo(cPt.x + 9, cPt.y);
        ctx.lineTo(cPt.x, cPt.y + 9);
        ctx.lineTo(cPt.x - 9, cPt.y);
        ctx.closePath();
      } else {
        // Neutral AIS Merchant Square
        ctx.rect(cPt.x - 7, cPt.y - 7, 14, 14);
      }
      ctx.stroke();

      // Selection bracket
      if (isSelected) {
        ctx.strokeStyle = '#ffb000';
        ctx.strokeRect(cPt.x - 13, cPt.y - 13, 26, 26);
      }

      // TMA Velocity Vector
      const vecRad = ((c.estHeading - 90) * Math.PI) / 180;
      const vecLen = Math.min(35, c.estSpeedKts * 1.4);
      ctx.beginPath();
      ctx.moveTo(cPt.x, cPt.y);
      ctx.lineTo(cPt.x + Math.cos(vecRad) * vecLen, cPt.y + Math.sin(vecRad) * vecLen);
      ctx.stroke();

      // Label
      ctx.fillStyle = color;
      ctx.font = 'bold 10px Courier New';
      const label = classifiedProfile ? `${c.designation} [${classifiedProfile.shortName}]` : `${c.designation} [UNK]`;
      ctx.fillText(label, cPt.x + 12, cPt.y - 4);
      ctx.fillStyle = '#99c2a8';
      ctx.fillText(`TMA:${Math.round(c.tmaQualityPct)}% ${c.estRangeNm.toFixed(1)}NM`, cPt.x + 12, cPt.y + 8);
    }

    // 5. Draw Active Weapons (Torpedoes & Missiles) & Guidance Wires
    for (const w of world.weapons) {
      if (w.exploded) continue;
      const wPt = this.leafletMap.latLngToContainerPoint([w.lat, w.lon]);

      // Fiber-optic guidance wire back to submarine
      if (w.wireConnected) {
        ctx.strokeStyle = 'rgba(0, 255, 102, 0.55)';
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(subPt.x, subPt.y);
        ctx.lineTo(wPt.x, wPt.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Seeker cone if active
      if (w.seekerActive) {
        const coneL = (((w.heading - 35) - 90) * Math.PI) / 180;
        const coneR = (((w.heading + 35) - 90) * Math.PI) / 180;
        ctx.fillStyle = w.isPlayer ? 'rgba(255, 176, 0, 0.14)' : 'rgba(255, 42, 42, 0.18)';
        ctx.beginPath();
        ctx.moveTo(wPt.x, wPt.y);
        ctx.arc(wPt.x, wPt.y, 28, coneL, coneR);
        ctx.closePath();
        ctx.fill();
      }

      ctx.fillStyle = w.isPlayer ? '#ff55ff' : '#ff2a2a';
      ctx.beginPath();
      ctx.arc(wPt.x, wPt.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(w.id, wPt.x + 6, wPt.y + 3);
    }

    // 6. Draw Acoustic Decoys
    for (const d of world.decoys) {
      const dPt = this.leafletMap.latLngToContainerPoint([d.lat, d.lon]);
      ctx.strokeStyle = '#00e5ff';
      ctx.beginPath();
      ctx.arc(dPt.x, dPt.y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#00e5ff';
      ctx.fillText('DECOY', dPt.x + 8, dPt.y + 3);
    }

    // 7. Draw Own Submarine (USS Virginia NTDS Cyan U-shape + Heading Vector)
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(subPt.x, subPt.y, 7, 0, Math.PI);
    ctx.stroke();

    const subRad = ((sub.heading - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(subPt.x, subPt.y);
    ctx.lineTo(subPt.x + Math.cos(subRad) * 26, subPt.y + Math.sin(subRad) * 26);
    ctx.stroke();

    ctx.fillStyle = '#00e5ff';
    ctx.font = 'bold 10px Courier New';
    ctx.fillText(`SSN-774 (${Math.round(sub.depthM)}m)`, subPt.x + 10, subPt.y - 8);
  }

  /**
   * Advances the Broadband Waterfall buffer by 1 scanline and draws Sonar & TMA displays
   */
  stepSonarWaterfall(world) {
    const w = this.waterfallBuffer.width;
    const h = this.waterfallBuffer.height;
    const ctx = this.waterfallCtx;

    // Shift existing waterfall image down by 1 pixel
    ctx.drawImage(this.waterfallBuffer, 0, 0, w, h - 1, 0, 1, w, h - 1);

    // Draw new top scanline (y = 0) across 000°..359°
    const imgData = ctx.createImageData(w, 1);
    const data = imgData.data;
    const sub = world.ownSub;

    for (let x = 0; x < w; x++) {
      const brg = (x / w) * 360.0;
      const relBrg = (brg - sub.heading + 360) % 360;
      const inBaffles = !sub.towedArrayDeployed && relBrg >= 150 && relBrg <= 210;

      // Ambient ocean noise phosphor background
      let intensity = inBaffles ? Math.random() * 12 : 14 + Math.random() * 26;
      if (sub.isCavitating) intensity += Math.random() * 55;

      // Add signal peaks from contacts
      for (const c of world.contacts) {
        if (!c.detected || c.sunk) continue;
        let diff = Math.abs(((brg - c.lastTrueBrg + 540) % 360) - 180);
        if (diff < 3.2) {
          const lobe = Math.exp(-(diff * diff) / 1.8);
          const snrBoost = Math.min(220, Math.max(45, (c.snrDb + 8) * 9.5));
          intensity += lobe * snrBoost;
        }
      }

      // Add high-intensity streaks for active torpedoes in water
      for (const torp of world.weapons) {
        if (torp.exploded || torp.type !== 'TORPEDO') continue;
        const tBrg = window.Bathymetry.bearingDeg(sub.lat, sub.lon, torp.lat, torp.lon);
        let diff = Math.abs(((brg - tBrg + 540) % 360) - 180);
        if (diff < 2.5) {
          intensity += 210;
        }
      }

      const clamped = Math.min(255, Math.floor(intensity));
      const idx = x * 4;
      data[idx] = Math.floor(clamped * 0.15);     // R
      data[idx + 1] = clamped;                    // G (CRT Green Phosphor)
      data[idx + 2] = Math.floor(clamped * 0.35); // B
      data[idx + 3] = 255;
    }

    ctx.putImageData(imgData, 0, 0);
  }

  renderSonarStation(world) {
    const wfCanvas = document.getElementById('sonar-waterfall-canvas');
    if (!wfCanvas) return;

    if (wfCanvas.width !== wfCanvas.clientWidth || wfCanvas.height !== wfCanvas.clientHeight) {
      wfCanvas.width = wfCanvas.clientWidth || 720;
      wfCanvas.height = wfCanvas.clientHeight || 320;
    }

    const ctx = wfCanvas.getContext('2d');
    const w = wfCanvas.width;
    const h = wfCanvas.height;

    // Draw top compass bearing ruler (26px high) + waterfall below
    ctx.fillStyle = '#040a06';
    ctx.fillRect(0, 0, w, 28);
    ctx.drawImage(this.waterfallBuffer, 0, 28, w, h - 28);

    // Bearing ticks & labels every 30°
    ctx.strokeStyle = '#1e422b';
    ctx.fillStyle = '#00ff66';
    ctx.font = '10px Courier New';
    for (let deg = 0; deg < 360; deg += 30) {
      const x = (deg / 360) * w;
      ctx.beginPath();
      ctx.moveTo(x, 18);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillText(deg.toString().padStart(3, '0') + '°', x + 3, 13);
    }

    // Draw Contact Designators at top of Waterfall
    for (const c of world.contacts) {
      if (!c.detected || c.sunk) continue;
      const x = (c.lastTrueBrg / 360) * w;
      const isSel = world.selectedContactId === c.id;
      ctx.fillStyle = isSel ? '#ffb000' : '#00e5ff';
      ctx.fillText(`▼${c.id}`, x - 12, 25);
      if (isSel) {
        ctx.strokeStyle = 'rgba(255, 176, 0, 0.65)';
        ctx.strokeRect(x - 6, 28, 12, h - 28);
      }
    }

    // Render Narrowband LOFAR / DEMON Spectrum
    this.renderDemonSpectrum(world);
    // Render TMA Mini Plot
    this.renderTmaMiniCanvas(world);
  }

  renderDemonSpectrum(world) {
    const canvas = document.getElementById('sonar-demon-canvas');
    if (!canvas) return;
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth || 450;
      canvas.height = canvas.clientHeight || 160;
    }

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#030805';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = '#12291a';
    for (let hz = 50; hz < 400; hz += 50) {
      const x = (hz / 400) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillStyle = '#5a8c6b';
      ctx.font = '9px Courier New';
      ctx.fillText(`${hz}Hz`, x + 2, h - 4);
    }

    const sel = world.getSelectedContact();
    if (!sel || !sel.detected || sel.sunk) {
      ctx.fillStyle = '#5a8c6b';
      ctx.font = '11px Courier New';
      ctx.fillText('SELECT AN ACTIVE SONAR TRACK TO ANALYZE NARROWBAND TONALS', 24, h / 2);
      document.getElementById('demon-tonals').textContent = '-- Hz';
      document.getElementById('demon-blades').textContent = '--';
      document.getElementById('demon-plant').textContent = '--';
      return;
    }

    const tonals = sel.profile.tonalHz;
    document.getElementById('demon-tonals').textContent = tonals.join(' / ') + ' Hz';
    document.getElementById('demon-blades').textContent =
      sel.profile.category === 'BIOLOGIC' ? 'NONE (BIOLOGIC)' : `${sel.profile.blades}-BLADE SCREW`;
    document.getElementById('demon-plant').textContent = sel.profile.plantType.split(' ')[0];

    // Draw continuous spectrum trace with sharp peaks at the contact's characteristic tonals
    ctx.strokeStyle = '#00ff66';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const hz = (x / w) * 400.0;
      let amp = 12 + Math.random() * 10;

      for (const peakHz of tonals) {
        const d = Math.abs(hz - peakHz);
        if (d < 8) {
          amp += Math.exp(-(d * d) / 6.0) * (h * 0.65);
        }
      }

      const y = h - 18 - Math.min(h - 24, amp);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Label peaks
    ctx.fillStyle = '#ffb000';
    ctx.font = 'bold 10px Courier New';
    for (const peakHz of tonals) {
      const x = (peakHz / 400) * w;
      ctx.fillText(`${peakHz}Hz`, x - 14, 16);
    }
  }

  renderTmaMiniCanvas(world) {
    const canvas = document.getElementById('tma-mini-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#030805';
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;

    // Polar rings
    ctx.strokeStyle = '#12291a';
    [35, 70].forEach((r) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    });

    const sel = world.getSelectedContact();
    if (!sel || !sel.detected || sel.sunk) {
      ctx.fillStyle = '#5a8c6b';
      ctx.font = '10px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText('NO TRACK SELECTED', cx, cy + 4);
      ctx.textAlign = 'start';
      return;
    }

    const brgRad = ((sel.lastTrueBrg - 90) * Math.PI) / 180;
    const distPx = Math.min(72, sel.estRangeNm * 8.5);
    const tx = cx + Math.cos(brgRad) * distPx;
    const ty = cy + Math.sin(brgRad) * distPx;

    ctx.strokeStyle = '#00e5ff';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    ctx.fillStyle = '#ffb000';
    ctx.beginPath();
    ctx.arc(tx, ty, 4, 0, Math.PI * 2);
    ctx.fill();

    const crsRad = ((sel.estHeading - 90) * Math.PI) / 180;
    ctx.strokeStyle = '#ffb000';
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + Math.cos(crsRad) * 22, ty + Math.sin(crsRad) * 22);
    ctx.stroke();
  }

  /**
   * Renders Station 3 Fire Control Polar Scope
   */
  renderFireControlScope(world) {
    const canvas = document.getElementById('fc-polar-canvas');
    if (!canvas) return;
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth || 300;
      canvas.height = canvas.clientHeight || 360;
    }

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const maxRadius = Math.min(cx, cy) - 18;

    ctx.fillStyle = '#030805';
    ctx.fillRect(0, 0, w, h);

    // Range rings
    ctx.strokeStyle = '#15301f';
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (maxRadius * i) / 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    const sub = world.ownSub;
    const presetHdg = Number(document.getElementById('input-weps-hdg').value) || 0;
    const enableYds = Number(document.getElementById('input-weps-enable').value) || 1500;
    const enableNm = enableYds / 2025.37;

    // Draw preset gyro launch line & seeker enable point
    const gyroRad = ((presetHdg - 90) * Math.PI) / 180;
    const enablePx = Math.min(maxRadius, (enableNm / this.fcZoomNm) * maxRadius);

    ctx.strokeStyle = '#ffb000';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(gyroRad) * maxRadius, cy + Math.sin(gyroRad) * maxRadius);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw enable gate marker
    const ex = cx + Math.cos(gyroRad) * enablePx;
    const ey = cy + Math.sin(gyroRad) * enablePx;
    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(ex - 3, ey - 3, 6, 6);
    ctx.font = '9px Courier New';
    ctx.fillText('ENABLE', ex + 6, ey + 3);

    // Plot detected contacts relative to own sub
    for (const c of world.contacts) {
      if (!c.detected || c.sunk) continue;
      const rPx = Math.min(maxRadius, (c.estRangeNm / this.fcZoomNm) * maxRadius);
      const bRad = ((c.lastTrueBrg - 90) * Math.PI) / 180;
      const px = cx + Math.cos(bRad) * rPx;
      const py = cy + Math.sin(bRad) * rPx;

      ctx.strokeStyle = world.selectedContactId === c.id ? '#ffb000' : '#00ff66';
      ctx.strokeRect(px - 5, py - 5, 10, 10);
      ctx.fillStyle = '#00ff66';
      ctx.fillText(c.id, px + 7, py + 3);
    }

    // Plot active weapons
    for (const wep of world.weapons) {
      if (wep.exploded) continue;
      const dNm = window.Bathymetry.distanceNm(sub.lat, sub.lon, wep.lat, wep.lon);
      const bDeg = window.Bathymetry.bearingDeg(sub.lat, sub.lon, wep.lat, wep.lon);
      const rPx = Math.min(maxRadius, (dNm / this.fcZoomNm) * maxRadius);
      const bRad = ((bDeg - 90) * Math.PI) / 180;
      const px = cx + Math.cos(bRad) * rPx;
      const py = cy + Math.sin(bRad) * rPx;

      ctx.fillStyle = wep.isPlayer ? '#ff55ff' : '#ff2a2a';
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Renders Station 4 Maneuvering Profile & Bathythermograph SVP
   */
  renderManeuveringStation(world) {
    const profCanvas = document.getElementById('maneuvering-profile-canvas');
    if (profCanvas) {
      const ctx = profCanvas.getContext('2d');
      const w = profCanvas.width;
      const h = profCanvas.height;
      ctx.fillStyle = '#030805';
      ctx.fillRect(0, 0, w, h);

      const sub = world.ownSub;
      const maxScaleDepth = Math.max(400, Math.min(800, world.currentSeafloorM + 50));
      const depthToY = (d) => 22 + (d / maxScaleDepth) * (h - 38);

      // Sea surface line
      ctx.strokeStyle = '#00e5ff';
      ctx.beginPath();
      ctx.moveTo(0, 22);
      ctx.lineTo(w, 22);
      ctx.stroke();
      ctx.fillStyle = '#00e5ff';
      ctx.font = '10px Courier New';
      ctx.fillText('SURFACE (0m)', 6, 15);

      // Thermal Layer Band
      if (world.currentThermoclineM) {
        const ly = depthToY(world.currentThermoclineM);
        ctx.fillStyle = 'rgba(0, 229, 255, 0.12)';
        ctx.fillRect(0, ly - 4, w, 10);
        ctx.fillStyle = '#00e5ff';
        ctx.fillText(`THERMOCLINE LAYER (${world.currentThermoclineM}m)`, 6, ly - 6);
      }

      // Test Depth Line (490m)
      const ty = depthToY(sub.testDepthM);
      if (ty < h - 10) {
        ctx.strokeStyle = 'rgba(255, 42, 42, 0.5)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, ty);
        ctx.lineTo(w, ty);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ff5555';
        ctx.fillText(`TEST DEPTH (490m)`, w - 115, ty - 4);
      }

      // Seafloor Contour
      const floorY = depthToY(world.currentSeafloorM);
      ctx.fillStyle = '#1d160b';
      ctx.fillRect(0, Math.min(h - 14, floorY), w, h);
      ctx.strokeStyle = '#ffb000';
      ctx.beginPath();
      ctx.moveTo(0, Math.min(h - 14, floorY));
      ctx.lineTo(w, Math.min(h - 14, floorY));
      ctx.stroke();
      ctx.fillStyle = '#ffb000';
      ctx.fillText(`SEAFLOOR (${world.currentSeafloorM}m)`, 6, Math.min(h - 4, floorY + 11));

      // Draw Submarine Side Profile at Current Depth & Pitch Angle
      const subY = Math.min(h - 24, depthToY(sub.depthM));
      ctx.save();
      ctx.translate(w / 2, subY);
      ctx.rotate((-sub.pitchDeg * Math.PI) / 180);

      // Hull & Sail
      ctx.fillStyle = '#00ff66';
      ctx.beginPath();
      ctx.roundRect(-55, -8, 110, 16, 8);
      ctx.fill();
      ctx.fillRect(5, -20, 22, 12); // Sail

      // Label
      ctx.restore();
      ctx.fillStyle = '#00ff66';
      ctx.fillText(`KEEL: ${Math.round(sub.depthM)}m | PITCH: ${sub.pitchDeg.toFixed(1)}°`, w / 2 - 65, Math.max(36, subY - 26));
    }

    // Render Bathythermograph & Sound Velocity Profile (SVP)
    const svpCanvas = document.getElementById('bathy-svp-canvas');
    if (svpCanvas) {
      const ctx = svpCanvas.getContext('2d');
      const w = svpCanvas.width;
      const h = svpCanvas.height;
      ctx.fillStyle = '#030805';
      ctx.fillRect(0, 0, w, h);

      const layerM = world.currentThermoclineM || 115;

      // Plot Sound Speed (Cyan) and Temperature (Amber) from 0m to 450m
      ctx.strokeStyle = '#ffb000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let d = 0; d <= 450; d += 10) {
        const prof = window.Bathymetry.getAcousticProfileAtDepth(d, layerM);
        const x = ((prof.tempC - 2) / 28) * (w - 30) + 15;
        const y = (d / 450) * (h - 25) + 12;
        if (d === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.strokeStyle = '#00e5ff';
      ctx.beginPath();
      for (let d = 0; d <= 450; d += 10) {
        const prof = window.Bathymetry.getAcousticProfileAtDepth(d, layerM);
        const x = ((prof.soundSpeed - 1475) / 70) * (w - 30) + 15;
        const y = (d / 450) * (h - 25) + 12;
        if (d === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Own-ship depth line
      const ownY = Math.min(h - 10, (world.ownSub.depthM / 450) * (h - 25) + 12);
      ctx.strokeStyle = '#00ff66';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, ownY);
      ctx.lineTo(w, ownY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '10px Courier New';
      ctx.fillStyle = '#ffb000';
      ctx.fillText('TEMP (°C)', 12, h - 6);
      ctx.fillStyle = '#00e5ff';
      ctx.fillText('SOUND VEL (m/s)', w - 105, h - 6);
    }
  }

  /**
   * Renders Station 5 S9G Pressurized Water Nuclear Reactor Schematic
   */
  renderReactorSchematic(world) {
    const canvas = document.getElementById('reactor-schematic-canvas');
    if (!canvas) return;
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth || 640;
      canvas.height = canvas.clientHeight || 420;
    }

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const rx = world.reactor;
    this.animPhase = (this.animPhase + 0.06) % 1.0;

    ctx.fillStyle = '#030805';
    ctx.fillRect(0, 0, w, h);

    // 1. Reactor Pressure Vessel (RPV)
    const rpvX = 65;
    const rpvY = 95;
    const rpvW = 135;
    const rpvH = 220;

    ctx.strokeStyle = rx.status === 'SCRAMMED' ? '#ff2a2a' : '#00ff66';
    ctx.lineWidth = 2;
    ctx.strokeRect(rpvX, rpvY, rpvW, rpvH);
    ctx.fillStyle = '#0a1910';
    ctx.fillRect(rpvX + 2, rpvY + 2, rpvW - 4, rpvH - 4);

    // Nuclear Fuel Core Glow
    const glowAlpha = Math.min(0.85, 0.15 + (rx.neutronFluxPct / 100) * 0.7);
    ctx.fillStyle = rx.status === 'SCRAMMED'
      ? 'rgba(255, 60, 60, 0.2)'
      : `rgba(255, 176, 0, ${glowAlpha})`;
    ctx.fillRect(rpvX + 22, rpvY + 95, rpvW - 44, 100);

    // Control Rods (move up as withdrawn from 0..100%)
    const rodInsertPx = ((100 - rx.rodPositionPct) / 100) * 85;
    ctx.fillStyle = '#00e5ff';
    for (let i = 0; i < 4; i++) {
      const rxRod = rpvX + 30 + i * 22;
      ctx.fillRect(rxRod, rpvY + 12 + rodInsertPx, 10, 85);
    }

    ctx.fillStyle = '#00ff66';
    ctx.font = 'bold 11px Courier New';
    ctx.fillText('S9G REACTOR CORE', rpvX + 12, rpvY - 8);
    ctx.fillStyle = '#ffb000';
    ctx.fillText(`FLUX: ${rx.neutronFluxPct.toFixed(1)}%`, rpvX + 24, rpvY + 145);
    ctx.fillText(`T-AVG: ${rx.tAvgC.toFixed(1)}°C`, rpvX + 20, rpvY + 165);

    // 2. Primary Coolant Loop Piping (Hot Leg -> Steam Generator -> Coolant Pump -> Cold Leg)
    const sgX = 285;
    const sgY = 75;
    const sgW = 125;
    const sgH = 240;

    // Hot Leg Pipe (Top)
    ctx.strokeStyle = '#ff5555';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(rpvX + rpvW, rpvY + 45);
    ctx.lineTo(sgX, rpvY + 45);
    ctx.stroke();

    // Cold Leg Pipe (Bottom)
    ctx.strokeStyle = '#00e5ff';
    ctx.beginPath();
    ctx.moveTo(sgX, rpvY + 175);
    ctx.lineTo(rpvX + rpvW, rpvY + 175);
    ctx.stroke();

    // Steam Generator Vessel
    ctx.strokeStyle = '#00ff66';
    ctx.lineWidth = 2;
    ctx.strokeRect(sgX, sgY, sgW, sgH);
    ctx.fillStyle = '#00ff66';
    ctx.fillText('STEAM GENERATOR', sgX + 8, sgY - 8);
    ctx.fillStyle = '#00e5ff';
    ctx.fillText(`${Math.round(rx.steamPressurePsi)} PSI`, sgX + 32, sgY + 45);

    // Primary Coolant Pump Symbol on Cold Leg
    const pumpX = 242;
    const pumpY = rpvY + 175;
    ctx.fillStyle = '#08170e';
    ctx.beginPath();
    ctx.arc(pumpX, pumpY, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffb000';
    ctx.stroke();
    ctx.fillStyle = '#ffb000';
    ctx.font = '9px Courier New';
    ctx.fillText(rx.pumpMode, pumpX - 15, pumpY + 3);

    // 3. Secondary Steam Loop & Main Propulsion Turbine + Condenser
    const turbX = 475;
    const turbY = 105;
    const turbW = 135;
    const turbH = 95;

    // Main Steam Line
    ctx.strokeStyle = '#ffb000';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sgX + sgW, sgY + 35);
    ctx.lineTo(turbX, turbY + 25);
    ctx.stroke();

    // Turbine Box
    ctx.strokeStyle = '#00ff66';
    ctx.lineWidth = 2;
    ctx.strokeRect(turbX, turbY, turbW, turbH);
    ctx.fillStyle = '#00ff66';
    ctx.font = 'bold 11px Courier New';
    ctx.fillText('MAIN TURBINES', turbX + 18, turbY + 25);
    ctx.fillStyle = '#ffb000';
    ctx.fillText(`SHAFT: ${Math.round(rx.shaftRpm)} RPM`, turbX + 18, turbY + 48);
    ctx.fillStyle = '#00e5ff';
    ctx.fillText(`GEN: ${rx.electricalOutputMWe.toFixed(1)} MWe`, turbX + 18, turbY + 68);

    // Battery & Emergency Diesel Box
    const batY = 235;
    ctx.strokeStyle = rx.batteryPct < 30 ? '#ff2a2a' : '#00e5ff';
    ctx.strokeRect(turbX, batY, turbW, 80);
    ctx.fillStyle = '#00e5ff';
    ctx.fillText(`MAIN BATTERY: ${Math.round(rx.batteryPct)}%`, turbX + 10, batY + 25);
    ctx.fillStyle = rx.dieselRunning ? '#ffb000' : '#5a8c6b';
    ctx.fillText(`DIESEL: ${rx.dieselRunning ? 'RUNNING' : 'STANDBY'}`, turbX + 10, batY + 50);
  }

  cycleScopeWeather() {
    this.scopeWeatherIndex = (this.scopeWeatherIndex + 1) % this.scopeWeatherModes.length;
    const mode = this.scopeWeatherModes[this.scopeWeatherIndex];
    this.scopeVisibilityKm = mode.visibilityKm;
    this.scopeHazeAlpha = mode.hazeAlpha;
    return mode.name;
  }

  /**
   * Renders Station 6 Photonics Periscope & Radar/ESM PPI Scope
   */
  renderPeriscopeStation(world) {
    const scopeCanvas = document.getElementById('periscope-canvas');
    if (scopeCanvas) {
      const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const displayW = Math.max(320, scopeCanvas.clientWidth || 720);
      const displayH = Math.max(240, scopeCanvas.clientHeight || 420);

      if (scopeCanvas.width !== Math.round(displayW * pixelRatio) ||
          scopeCanvas.height !== Math.round(displayH * pixelRatio)) {
        scopeCanvas.width = Math.round(displayW * pixelRatio);
        scopeCanvas.height = Math.round(displayH * pixelRatio);
      }

      const ctx = scopeCanvas.getContext('2d');
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const w = displayW;
      const h = displayH;
      const sub = world.ownSub;
      const raised = Boolean(sub.periscopeRaised && sub.depthM <= 20.5);
      if (raised && this.coastlineModel) this.coastlineModel.updatePosition(sub.lat, sub.lon);
      const terrainProfile = this.coastlineModel ? this.coastlineModel.profile : null;
      const terrainStatus = this.coastlineModel ? this.coastlineModel.status : 'UNAVAILABLE';
      const terrainStatusEl = document.getElementById('scope-terrain-status');
      if (terrainStatusEl) {
        terrainStatusEl.textContent = raised ? 'TERRAIN DATA: ' + terrainStatus : 'TERRAIN DATA: STANDBY';
        terrainStatusEl.dataset.state = raised ? String(terrainStatus).toLowerCase() : 'standby';
      }
      const thermal = Boolean(this.scopeThermal);
      const liveMark = scopeCanvas.parentElement?.querySelector('.scope-live-mark');
      if (liveMark) {
        liveMark.style.display = raised ? 'flex' : 'none';
        liveMark.lastChild.textContent = thermal ? ' FLIR SENSOR' : ' EO SENSOR';
      }
      const zoom = this.scopeZoom || 1.5;
      const fovDeg = 48 / zoom;
      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
      const simSeconds = Number.isFinite(world.simTimeSec) ? world.simTimeSec : 0;
      const simHours = ((simSeconds / 3600) % 24 + 24) % 24;
      const clock = (() => {
        const total = Math.floor(simSeconds) % 86400;
        const hh = String(Math.floor(total / 3600)).padStart(2, '0');
        const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
        const ss = String(total % 60).padStart(2, '0');
        return `${hh}:${mm}:${ss}Z`;
      })();

      const drawText = (text, x, y, size = 10, color = '#c8d8e3', weight = 600, align = 'left') => {
        ctx.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
        ctx.textAlign = align;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        ctx.fillText(String(text), x, y);
      };

      const drawPanel = (x, y, width, height, fill = 'rgba(7, 18, 29, 0.86)') => {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, width, height);
        ctx.strokeStyle = 'rgba(142, 177, 199, 0.34)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
      };

      const drawCornerFrame = (color) => {
        const inset = 9;
        const len = 24;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(inset, inset + len); ctx.lineTo(inset, inset); ctx.lineTo(inset + len, inset);
        ctx.moveTo(w - inset - len, inset); ctx.lineTo(w - inset, inset); ctx.lineTo(w - inset, inset + len);
        ctx.moveTo(inset, h - inset - len); ctx.lineTo(inset, h - inset); ctx.lineTo(inset + len, h - inset);
        ctx.moveTo(w - inset - len, h - inset); ctx.lineTo(w - inset, h - inset); ctx.lineTo(w - inset, h - inset - len);
        ctx.stroke();
      };

      // Retracted state: a clean system slate, with a real depth interlock.
      if (!raised) {
        const bg = ctx.createLinearGradient(0, 0, w, h);
        bg.addColorStop(0, '#1b2b39');
        bg.addColorStop(0.52, '#0e1b28');
        bg.addColorStop(1, '#07111b');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = 'rgba(108, 146, 171, 0.10)';
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 34) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 0; y < h; y += 34) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        drawPanel(18, 18, w - 36, 34, 'rgba(5, 13, 21, 0.68)');
        drawText('AN/BVS-1  /  PHOTONICS SENSOR CONTROL', 31, 35, 10, '#a9c0d0', 700);
        drawText(clock, w - 31, 35, 10, '#91aabd', 600, 'right');

        const boxW = Math.min(440, w - 48);
        const boxH = 154;
        const bx = (w - boxW) / 2;
        const by = (h - boxH) / 2 - 2;
        drawPanel(bx, by, boxW, boxH, 'rgba(5, 14, 23, 0.78)');

        const gx = w / 2;
        const gy = by + 37;
        ctx.strokeStyle = sub.depthM > 20.5 ? '#d4a05d' : '#75a9bf';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(gx, gy, 13, 0, Math.PI * 2);
        ctx.moveTo(gx - 21, gy + 22); ctx.lineTo(gx + 21, gy + 22);
        ctx.moveTo(gx, gy + 14); ctx.lineTo(gx, gy + 22);
        ctx.moveTo(gx - 16, gy + 22); ctx.lineTo(gx - 16, gy + 29);
        ctx.moveTo(gx + 16, gy + 22); ctx.lineTo(gx + 16, gy + 29);
        ctx.stroke();
        ctx.fillStyle = sub.depthM > 20.5 ? '#d4a05d' : '#75a9bf';
        ctx.beginPath(); ctx.arc(gx, gy, 4, 0, Math.PI * 2); ctx.fill();

        const interlocked = sub.depthM > 20.5;
        drawText(interlocked ? 'DEPTH INTERLOCK' : 'MAST STOWED', gx, by + 83, 16,
          interlocked ? '#e2b16b' : '#d3e0e9', 700, 'center');
        drawText(
          interlocked
            ? 'MAST DEPLOYMENT INHIBITED  /  REDUCE DEPTH TO 20.0 m OR LESS'
            : 'OPTICAL CHANNEL STANDBY  /  RAISE MAST TO ACQUIRE LIVE PICTURE',
          gx, by + 109, 9, '#8da9ba', 600, 'center'
        );
        drawText(`OWN DEPTH  ${sub.depthM.toFixed(1)} m`, gx, by + 133, 10,
          interlocked ? '#e2b16b' : '#a8c1cf', 700, 'center');

        drawPanel(18, h - 37, w - 36, 22, 'rgba(5, 13, 21, 0.72)');
        drawText('EO SENSOR  /  CHANNEL OFFLINE', 30, h - 26, 9, '#8299a9', 700);
        drawText('STABILIZATION: STANDBY', w - 30, h - 26, 9, '#8299a9', 600, 'right');
        drawCornerFrame('rgba(133, 164, 185, 0.45)');
      } else {
        const daylight = clamp(Math.sin(((simHours - 6) / 12) * Math.PI), 0, 1);
        const horizonY = clamp(h * 0.47 + clamp(sub.pitchDeg || 0, -12, 12) * 2.4, h * 0.30, h * 0.65);
        const skyTop = thermal ? '#303a40' : (daylight > 0.35 ? '#6d8e9d' : '#172a3b');
        const skyBottom = thermal ? '#9aa7aa' : (daylight > 0.35 ? '#b4c0bd' : '#3b5263');
        const seaTop = thermal ? '#46545a' : (daylight > 0.35 ? '#577887' : '#233c4d');
        const seaBottom = thermal ? '#101a20' : (daylight > 0.35 ? '#15394b' : '#071724');

        const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
        sky.addColorStop(0, skyTop);
        sky.addColorStop(1, skyBottom);
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, horizonY);

        const haze = ctx.createLinearGradient(0, horizonY - 22, 0, horizonY + 24);
        haze.addColorStop(0, 'rgba(216, 226, 225, 0)');
        haze.addColorStop(0.55, thermal ? 'rgba(220, 228, 224, 0.30)' : 'rgba(210, 224, 225, 0.34)');
        haze.addColorStop(1, 'rgba(216, 226, 225, 0)');
        ctx.fillStyle = haze;
        ctx.fillRect(0, horizonY - 22, w, 46);

        if (!thermal) {
          for (let i = 0; i < 5; i++) {
            const cloudX = ((i * 197 + 90 + simSeconds * (0.18 + i * 0.015)) % (w + 180)) - 90;
            const cloudY = 28 + (i % 3) * 22 + (i % 2) * 8;
            const cloud = ctx.createRadialGradient(cloudX, cloudY, 4, cloudX, cloudY, 62 + (i % 3) * 15);
            cloud.addColorStop(0, daylight > 0.25 ? 'rgba(235, 239, 234, 0.20)' : 'rgba(147, 166, 180, 0.10)');
            cloud.addColorStop(1, 'rgba(210, 225, 232, 0)');
            ctx.fillStyle = cloud;
            ctx.fillRect(cloudX - 80, cloudY - 32, 160, 64);
          }
        }

        const sea = ctx.createLinearGradient(0, horizonY, 0, h);
        sea.addColorStop(0, seaTop);
        sea.addColorStop(1, seaBottom);
        ctx.fillStyle = sea;
        ctx.fillRect(0, horizonY, w, h - horizonY);

        // Geographic coastline silhouette from the local Copernicus DEM profile.
        // The DEM rays already include Earth curvature and a modest standard
        // optical refraction correction; the 2D renderer only projects the skyline.
        if (terrainProfile && terrainProfile.rays && terrainProfile.rays.length) {
          const seaHorizon = terrainProfile.seaHorizonAngleDeg;
          const verticalScale = 24;
          const sampleCount = Math.max(100, Math.ceil(w / 4));
          const skyline = [];
          for (let i = 0; i <= sampleCount; i++) {
            const x = (i / sampleCount) * w;
            const relativeBearing = ((i / sampleCount) - 0.5) * fovDeg;
            const bearing = (this.scopeBearing + relativeBearing + 360) % 360;
            const ray = window.CoastlineModel.sample(terrainProfile, bearing);
            const landRise = ray && ray.hasLand ? Math.max(0, ray.angleDeg - seaHorizon) : 0;
            const y = horizonY - Math.min(h * 0.34, landRise * verticalScale);
            skyline.push({ x, y, rangeKm: ray && ray.hasLand ? ray.rangeKm : 0, hasLand: Boolean(ray && ray.hasLand) });
          }

          for (let i = 0; i < skyline.length - 1; i++) {
            const a = skyline[i];
            const b = skyline[i + 1];
            if (!a.hasLand && !b.hasLand) continue;
            const rangeKm = (a.rangeKm + b.rangeKm) * 0.5;
            const haze = clamp(1 - Math.max(0, rangeKm - 8) / (this.scopeVisibilityKm * 1.35), 0.18, 0.88);
            const base = thermal ? [35, 48, 54] : [29, 48, 59];
            const fog = thermal ? [150, 163, 164] : [127, 151, 159];
            const mix = clamp(1 - haze, 0, 1);
            const color = base.map((value, channel) => Math.round(value * haze + fog[channel] * mix));
            ctx.fillStyle = 'rgba(' + color.join(',') + ',0.96)';
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.lineTo(b.x, horizonY + 18);
            ctx.lineTo(a.x, horizonY + 18);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = thermal ? 'rgba(220, 229, 223,' + (0.42 * haze + 0.12) + ')' :
              'rgba(205, 222, 226,' + (0.45 * haze + 0.10) + ')';
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }

        const wavePhase = simSeconds * 0.85;
        for (let i = 0; i < 15; i++) {
          const y = horizonY + 8 + i * i * 1.08;
          if (y > h - 35) break;
          const alpha = (thermal ? 0.10 : 0.12) + i * 0.008;
          ctx.strokeStyle = thermal
            ? `rgba(223, 232, 229, ${alpha})`
            : `rgba(195, 218, 223, ${alpha})`;
          ctx.lineWidth = i < 5 ? 0.7 : 1;
          ctx.beginPath();
          for (let x = -12; x <= w + 12; x += 12) {
            const amp = 1.0 + i * 0.10;
            const yy = y + Math.sin(x * 0.026 + wavePhase + i * 1.7) * amp
              + Math.sin(x * 0.009 - wavePhase * 0.55 + i) * amp * 0.65;
            if (x === -12) ctx.moveTo(x, yy);
            else ctx.lineTo(x, yy);
          }
          ctx.stroke();
        }

        // Simple optical attenuation presets: clear, haze and fog.
        if (this.scopeHazeAlpha > 0) {
          const weatherHaze = ctx.createLinearGradient(0, horizonY - 45, 0, h);
          weatherHaze.addColorStop(0, 'rgba(190, 204, 207, ' + (this.scopeHazeAlpha * 0.42) + ')');
          weatherHaze.addColorStop(0.48, 'rgba(190, 204, 207, ' + this.scopeHazeAlpha + ')');
          weatherHaze.addColorStop(1, 'rgba(190, 204, 207, ' + (this.scopeHazeAlpha * 0.28) + ')');
          ctx.fillStyle = weatherHaze;
          ctx.fillRect(0, horizonY - 45, w, h - horizonY + 45);
        }

        const glowX = w * (0.70 + Math.sin((this.scopeBearing * Math.PI) / 180) * 0.08);
        const glowY = horizonY - 30;
        const glow = ctx.createRadialGradient(glowX, glowY, 2, glowX, glowY, 90);
        glow.addColorStop(0, thermal ? 'rgba(230, 235, 231, 0.18)' :
          (daylight > 0.3 ? 'rgba(245, 224, 177, 0.28)' : 'rgba(170, 198, 215, 0.18)'));
        glow.addColorStop(1, 'rgba(220, 230, 235, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(glowX - 90, glowY - 90, 180, 180);

        const reflection = ctx.createLinearGradient(glowX - 30, horizonY, glowX + 30, h);
        reflection.addColorStop(0, thermal ? 'rgba(220, 230, 226, 0.16)' : 'rgba(226, 221, 196, 0.18)');
        reflection.addColorStop(1, 'rgba(220, 230, 226, 0)');
        ctx.fillStyle = reflection;
        ctx.fillRect(glowX - 30, horizonY, 60, h - horizonY);

        // Surface contacts in the optical field of view.
        const visibleContacts = [];
        for (const contact of world.contacts) {
          if (contact.sunk || contact.depthM > 5) continue;
          const bearing = window.Bathymetry.bearingDeg(sub.lat, sub.lon, contact.lat, contact.lon);
          const rangeNm = window.Bathymetry.distanceNm(sub.lat, sub.lon, contact.lat, contact.lon);
          if (rangeNm > 12.0) continue;

          const relativeBearing = ((bearing - this.scopeBearing + 540) % 360) - 180;
          if (Math.abs(relativeBearing) > fovDeg / 2) continue;

          const sx = w / 2 + (relativeBearing / (fovDeg / 2)) * (w / 2);
          const rangeScale = clamp(0.96 / Math.sqrt(Math.max(0.3, rangeNm)) * (zoom / 1.5), 0.12, 1.45);
          const aspect = 0.28 + 0.72 * Math.abs(Math.cos(((contact.heading - bearing) * Math.PI) / 180));
          const shipLength = 78 * rangeScale;
          const shipWidth = Math.max(10, shipLength * aspect);
          const shipHeight = Math.max(5, shipLength * 0.20);
          const shipY = horizonY - shipHeight * 0.74 + Math.min(5, rangeNm) * 0.7;
          const left = sx - shipWidth / 2;
          const right = sx + shipWidth / 2;
          const hullColor = thermal ? '#e7ece8' : (daylight > 0.25 ? '#263b46' : '#111f2b');
          const detailColor = thermal ? '#f7f8f3' : (daylight > 0.25 ? '#354d5a' : '#263e4c');
          const contactVisibility = clamp(1 - (rangeNm / this.scopeVisibilityKm) * 0.74, 0.18, 1);
          ctx.globalAlpha = contactVisibility;

          ctx.fillStyle = hullColor;
          ctx.beginPath();
          ctx.moveTo(left, shipY);
          ctx.lineTo(left + shipWidth * 0.13, shipY + shipHeight * 0.66);
          ctx.lineTo(right - shipWidth * 0.10, shipY + shipHeight * 0.66);
          ctx.lineTo(right, shipY + shipHeight * 0.22);
          ctx.lineTo(right - shipWidth * 0.03, shipY + shipHeight * 0.08);
          ctx.closePath();
          ctx.fill();

          const bridgeX = left + shipWidth * 0.34;
          ctx.fillStyle = detailColor;
          ctx.fillRect(bridgeX, shipY - shipHeight * 0.58, shipWidth * 0.26, shipHeight * 0.60);
          ctx.fillRect(bridgeX + shipWidth * 0.05, shipY - shipHeight * 0.76, shipWidth * 0.13, shipHeight * 0.20);
          ctx.strokeStyle = thermal ? 'rgba(255,255,255,0.9)' : 'rgba(213, 229, 232, 0.75)';
          ctx.lineWidth = Math.max(0.65, rangeScale * 0.8);
          ctx.beginPath();
          ctx.moveTo(bridgeX + shipWidth * 0.13, shipY - shipHeight * 0.76);
          ctx.lineTo(bridgeX + shipWidth * 0.13, shipY - shipHeight * 1.12);
          ctx.stroke();

          ctx.strokeStyle = thermal ? 'rgba(242,245,239,0.75)' : 'rgba(215, 231, 230, 0.58)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(left - shipWidth * 0.16, shipY + shipHeight * 0.86);
          ctx.quadraticCurveTo(sx, shipY + shipHeight * 1.18, right + shipWidth * 0.18, shipY + shipHeight * 0.76);
          ctx.stroke();

          visibleContacts.push({ contact, sx, shipY, shipHeight, rangeNm, bearing });
          ctx.globalAlpha = 1;
        }

        visibleContacts.forEach(({ contact, sx, shipY, shipHeight, rangeNm }) => {
          const label = `${contact.designation}  /  ${rangeNm.toFixed(1)} NM`;
          ctx.font = '700 9px Arial, Helvetica, sans-serif';
          const labelWidth = Math.min(150, ctx.measureText(label).width + 12);
          const lx = clamp(sx - labelWidth / 2, 12, w - labelWidth - 12);
          const ly = clamp(shipY - shipHeight * 1.12 - 17, 58, horizonY - 12);
          drawPanel(lx, ly, labelWidth, 17, 'rgba(7, 20, 31, 0.80)');
          drawText(label, lx + 6, ly + 8.5, 9, thermal ? '#f3f4ed' : '#d6e3e8', 700);
          ctx.strokeStyle = thermal ? 'rgba(236, 242, 235, 0.55)' : 'rgba(154, 211, 223, 0.62)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(sx, ly + 17);
          ctx.lineTo(sx, shipY - 2);
          ctx.stroke();
        });
        ctx.globalAlpha = 1;

        const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.18, w / 2, h / 2, Math.max(w, h) * 0.72);
        vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vignette.addColorStop(1, 'rgba(3, 10, 17, 0.48)');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, w, h);

        const glass = ctx.createLinearGradient(0, 0, w, h * 0.5);
        glass.addColorStop(0, 'rgba(210, 235, 245, 0.045)');
        glass.addColorStop(0.32, 'rgba(210, 235, 245, 0.0)');
        glass.addColorStop(1, 'rgba(210, 235, 245, 0.018)');
        ctx.fillStyle = glass;
        ctx.fillRect(0, 0, w, h);

        // Top instrument bar and azimuth tape.
        drawPanel(0, 0, w, 30, 'rgba(5, 15, 24, 0.90)');
        drawText(thermal ? 'FLIR  /  WHITE HOT' : 'EO  /  DAY-NIGHT CHANNEL', 14, 15, 10,
          thermal ? '#e6e9e2' : '#b8d0df', 700);
        drawText(`MAG ${zoom.toFixed(1)}×`, w * 0.5, 15, 10, '#e4c58f', 700, 'center');
        drawText(`AN/BVS-1     ${clock}`, w - 14, 15, 9, '#a8becc', 600, 'right');

        drawPanel(0, 30, w, 27, 'rgba(8, 20, 30, 0.70)');
        const tapeY = 44;
        const halfTicks = 6;
        for (let tick = -halfTicks; tick <= halfTicks; tick++) {
          const x = w / 2 + (tick / halfTicks) * (w * 0.40);
          const major = tick % 2 === 0;
          ctx.strokeStyle = major ? 'rgba(191, 213, 224, 0.82)' : 'rgba(160, 190, 205, 0.48)';
          ctx.lineWidth = major ? 1.1 : 0.7;
          ctx.beginPath();
          ctx.moveTo(x, tapeY - (major ? 8 : 4));
          ctx.lineTo(x, tapeY + 5);
          ctx.stroke();
          if (major) {
            const tickBearing = Math.round((this.scopeBearing + tick * (fovDeg / 12) + 360) % 360);
            drawText(String(tickBearing).padStart(3, '0'), x, 36, 8, '#b4c8d4', 600, 'center');
          }
        }
        ctx.strokeStyle = '#e3bd77';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(w / 2, 31); ctx.lineTo(w / 2, 55);
        ctx.stroke();

        // Center aiming reticle: open brackets, small center marks, no full-screen cross.
        const cx = w / 2;
        const cy = h * 0.54;
        const reticleColor = thermal ? 'rgba(244, 246, 238, 0.78)' : 'rgba(211, 229, 236, 0.80)';
        ctx.strokeStyle = reticleColor;
        ctx.lineWidth = 1;
        const rx = 19;
        const ry = 15;
        const gap = 5;
        ctx.beginPath();
        ctx.moveTo(cx - rx, cy - ry + gap); ctx.lineTo(cx - rx, cy - ry); ctx.lineTo(cx - rx + gap, cy - ry);
        ctx.moveTo(cx + rx - gap, cy - ry); ctx.lineTo(cx + rx, cy - ry); ctx.lineTo(cx + rx, cy - ry + gap);
        ctx.moveTo(cx - rx, cy + ry - gap); ctx.lineTo(cx - rx, cy + ry); ctx.lineTo(cx - rx + gap, cy + ry);
        ctx.moveTo(cx + rx - gap, cy + ry); ctx.lineTo(cx + rx, cy + ry); ctx.lineTo(cx + rx, cy + ry - gap);
        ctx.moveTo(cx - 4, cy); ctx.lineTo(cx + 4, cy);
        ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4);
        ctx.stroke();
        ctx.fillStyle = '#e8d2a0';
        ctx.beginPath(); ctx.arc(cx, cy, 1.7, 0, Math.PI * 2); ctx.fill();

        ctx.strokeStyle = 'rgba(195, 216, 225, 0.55)';
        ctx.lineWidth = 0.8;
        for (let i = 0; i <= 5; i++) {
          const y = 72 + i * ((h - 124) / 5);
          ctx.beginPath();
          ctx.moveTo(12, y); ctx.lineTo(i % 2 === 0 ? 25 : 19, y);
          ctx.stroke();
        }
        drawText('RNG', 13, 66, 7, '#9bb4c3', 700);
        drawText('STAB', w - 13, h - 48, 8, '#9bb4c3', 700, 'right');
        drawText('ON', w - 13, h - 36, 8, '#9bd4be', 700, 'right');

        drawPanel(0, h - 29, w, 29, 'rgba(5, 15, 24, 0.92)');
        drawText('MAST  EXTENDED', 14, h - 14, 9, '#a9d4c9', 700);
        drawText(`DEPTH ${sub.depthM.toFixed(1)} m`, w * 0.36, h - 14, 9, '#c5d4dc', 600, 'center');
        drawText(`OWN HDG ${String(Math.round(sub.heading || 0)).padStart(3, '0')}°`, w * 0.64, h - 14, 9, '#c5d4dc', 600, 'center');
        drawText(this.scopeWeatherModes[this.scopeWeatherIndex].name + ' / ' + this.scopeVisibilityKm + ' KM',
          w * 0.83, h - 14, 8, '#a9bfcb', 600, 'center');
        drawText(thermal ? 'IR SENSOR' : 'OPTICAL SENSOR', w - 14, h - 14, 9, '#e4c58f', 700, 'right');
        drawCornerFrame('rgba(201, 220, 231, 0.52)');
      }
    }

    // Render Radar & ESM PPI Scope
    const radCanvas = document.getElementById('radar-esm-canvas');
    if (radCanvas) {
      const ctx = radCanvas.getContext('2d');
      const w = radCanvas.width;
      const h = radCanvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const rMax = Math.min(cx, cy) - 20;
      const sub = world.ownSub;

      ctx.fillStyle = '#030805';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#14301f';
      [0.33, 0.66, 1.0].forEach((f) => {
        ctx.beginPath();
        ctx.arc(cx, cy, rMax * f, 0, Math.PI * 2);
        ctx.stroke();
      });

      if (sub.radarTxActive && sub.depthM <= 20) {
        this.radarSweepDeg = (this.radarSweepDeg + 6) % 360;
        const sRad = ((this.radarSweepDeg - 90) * Math.PI) / 180;
        ctx.strokeStyle = '#00ff66';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(sRad) * rMax, cy + Math.sin(sRad) * rMax);
        ctx.stroke();

        for (const c of world.contacts) {
          if (c.sunk || c.depthM > 3) continue;
          const dNm = window.Bathymetry.distanceNm(sub.lat, sub.lon, c.lat, c.lon);
          if (dNm > 16) continue;
          const bRad = ((window.Bathymetry.bearingDeg(sub.lat, sub.lon, c.lat, c.lon) - 90) * Math.PI) / 180;
          const px = cx + Math.cos(bRad) * ((dNm / 16) * rMax);
          const py = cy + Math.sin(bRad) * ((dNm / 16) * rMax);
          ctx.fillStyle = '#00ff66';
          ctx.fillRect(px - 3, py - 3, 6, 6);
        }
      }

      // ESM Threat Bearing Strobe on outer ring if ESM Mast is raised
      if (sub.esmMastRaised && sub.depthM <= 20) {
        for (const c of world.contacts) {
          if (c.sunk || c.depthM > 3) continue;
          const bDeg = window.Bathymetry.bearingDeg(sub.lat, sub.lon, c.lat, c.lon);
          const bRad = ((bDeg - 90) * Math.PI) / 180;
          const ex = cx + Math.cos(bRad) * (rMax + 6);
          const ey = cy + Math.sin(bRad) * (rMax + 6);
          ctx.strokeStyle = c.profile.allegiance === 'HOSTILE' ? '#ff2a2a' : '#ffb000';
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(bRad) * (rMax - 12), cy + Math.sin(bRad) * (rMax - 12));
          ctx.lineTo(ex, ey);
          ctx.stroke();
        }
      }
    }
  }
}

window.Stations = new StationRenderers();
