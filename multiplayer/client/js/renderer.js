(function (root) {
  'use strict';

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpAngleDeg(a, b, t) {
    const diff = ((b - a + 540) % 360) - 180;
    return (a + diff * t + 360) % 360;
  }

  class MultiStationRenderer {
    constructor() {
      this.leafletMap = null;
      this.oceanLayer = null;
      this.darkLayer = null;
      this.mapInitialized = false;
      this.followSub = true;
      this.waypointMode = false;
      this.prevSnapshot = null;
      this.currSnapshot = null;
      this.snapshotArrivalMs = 0;
      this.snapshotIntervalMs = 100;
      this.radarSweepDeg = 0;

      this.wfBuffer = document.createElement('canvas');
      this.wfBuffer.width = 720;
      this.wfBuffer.height = 300;
      this.wfCtx = this.wfBuffer.getContext('2d');
      this.wfCtx.fillStyle = '#020704';
      this.wfCtx.fillRect(0, 0, 720, 300);

      this.periscope3d = root.ThreePeriscopeEngine ? new root.ThreePeriscopeEngine() : null;
    }

    initLeafletMap(onMapCourseOrder) {
      if (this.mapInitialized || typeof L === 'undefined') return;
      const el = document.getElementById('leaflet-map');
      if (!el) return;
      this.leafletMap = L.map(el, {
        center: [37.18, 15.50],
        zoom: 10,
        zoomControl: false,
        attributionControl: false
      });

      this.oceanLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 14 }
      );
      this.darkLayer = L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        { maxZoom: 16 }
      );
      this.seamarkLayer = L.tileLayer(
        'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
        { maxZoom: 16, opacity: 0.78 }
      );

      this.oceanLayer.addTo(this.leafletMap);
      this.seamarkLayer.addTo(this.leafletMap);
      const tilePane = this.leafletMap.getPane('tilePane');
      if (tilePane) tilePane.classList.add('bathymetry-filter');

      this.leafletMap.on('mousemove', (e) => {
        const readout = document.getElementById('map-cursor-readout');
        if (!readout || !this.currSnapshot) return;
        const sub = this.currSnapshot.ownSub;
        const dLat = (e.latlng.lat - sub.lat) * 60;
        const dLon = (e.latlng.lng - sub.lon) * 60 * Math.cos((sub.lat * Math.PI) / 180);
        const rng = Math.hypot(dLat, dLon);
        const brg = ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360;
        readout.textContent = `CURSOR: ${e.latlng.lat.toFixed(3)}°N ${e.latlng.lng.toFixed(3)}°E | BRG: ${Math.round(brg).toString().padStart(3, '0')}° | RNG: ${rng.toFixed(1)} NM | AUTH SERVER PICTURE`;
      });

      this.leafletMap.on('click', (e) => {
        if (!this.waypointMode || !this.currSnapshot || !onMapCourseOrder) return;
        const sub = this.currSnapshot.ownSub;
        const dLat = (e.latlng.lat - sub.lat) * 60;
        const dLon = (e.latlng.lng - sub.lon) * 60 * Math.cos((sub.lat * Math.PI) / 180);
        const brg = Math.round(((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360);
        onMapCourseOrder(brg);
      });

      this.mapInitialized = true;
    }

    setMapLayer(mode) {
      if (!this.leafletMap) return;
      const tilePane = this.leafletMap.getPane('tilePane');
      if (mode === 'ocean') {
        if (this.leafletMap.hasLayer(this.darkLayer)) this.leafletMap.removeLayer(this.darkLayer);
        if (!this.leafletMap.hasLayer(this.oceanLayer)) this.oceanLayer.addTo(this.leafletMap);
        if (tilePane) tilePane.classList.add('bathymetry-filter');
      } else {
        if (this.leafletMap.hasLayer(this.oceanLayer)) this.leafletMap.removeLayer(this.oceanLayer);
        if (!this.leafletMap.hasLayer(this.darkLayer)) this.darkLayer.addTo(this.leafletMap);
        if (tilePane) tilePane.classList.remove('bathymetry-filter');
      }
    }

    pushSnapshot(snapshot, snapshotHz = 10) {
      const first = !this.currSnapshot;
      this.prevSnapshot = this.currSnapshot;
      this.currSnapshot = snapshot;
      this.snapshotArrivalMs = performance.now();
      this.snapshotIntervalMs = 1000 / Math.max(1, snapshotHz);
      this.stepWaterfall(snapshot);

      if (this.leafletMap && (first || this.followSub)) {
        this.leafletMap.panTo([snapshot.ownSub.lat, snapshot.ownSub.lon], { animate: false });
      }
    }

    getInterpolatedState() {
      if (!this.currSnapshot) return null;
      const alpha = this.prevSnapshot
        ? Math.min(1, Math.max(0, (performance.now() - this.snapshotArrivalMs) / this.snapshotIntervalMs))
        : 1;
      const s0 = this.prevSnapshot ? this.prevSnapshot.ownSub : this.currSnapshot.ownSub;
      const s1 = this.currSnapshot.ownSub;
      return {
        alpha,
        subLat: lerp(s0.lat, s1.lat, alpha),
        subLon: lerp(s0.lon, s1.lon, alpha),
        subHdg: lerpAngleDeg(s0.headingDeg, s1.headingDeg, alpha)
      };
    }

    renderActiveStation(station, selectedContactId) {
      const interp = this.getInterpolatedState();
      if (station === 'tactical') {
        this.renderTacticalOverlay(selectedContactId, interp);
      } else if (station === 'sonar') {
        this.renderSonarStation(selectedContactId);
      } else if (station === 'weapons') {
        this.renderFireControlScope(selectedContactId, interp);
      } else if (station === 'maneuvering') {
        this.renderManeuveringStation();
      } else if (station === 'reactor') {
        this.renderReactorSchematic();
      } else if (station === 'periscope') {
        if (this.periscope3d) {
          this.periscope3d.render(this.currSnapshot, interp, selectedContactId);
        }
        this.renderRadarEsmCanvas(selectedContactId);
      }
    }

    renderTacticalOverlay(selectedContactId, interp) {
      const canvas = document.getElementById('tactical-overlay-canvas');
      if (!canvas || !this.leafletMap) return;
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth || 720;
        canvas.height = canvas.clientHeight || 420;
      }
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!interp || !this.currSnapshot) return;

      const subPt = this.leafletMap.latLngToContainerPoint([interp.subLat, interp.subLon]);
      const metersPerPx =
        (40075016.686 * Math.cos((interp.subLat * Math.PI) / 180)) /
        (256 * Math.pow(2, this.leafletMap.getZoom()));

      for (const nm of [5, 10]) {
        const rPx = (nm * 1852) / metersPerPx;
        ctx.strokeStyle = 'rgba(0, 255, 102, 0.22)';
        ctx.beginPath();
        ctx.arc(subPt.x, subPt.y, rPx, 0, Math.PI * 2);
        ctx.stroke();
      }

      for (const c of this.currSnapshot.contacts || []) {
        const isSel = c.id === selectedContactId;
        const col = isSel ? '#ffb000' : c.allegiance === 'HOSTILE' ? '#ff3b3b' : '#00ff66';
        ctx.strokeStyle = col;
        ctx.fillStyle = col;

        if (!c.ranged || c.lat === null || c.lon === null) {
          const rad = (c.bearingDeg * Math.PI) / 180;
          const len = (10 * 1852) / metersPerPx;
          ctx.save();
          ctx.setLineDash([6, 5]);
          ctx.beginPath();
          ctx.moveTo(subPt.x, subPt.y);
          ctx.lineTo(subPt.x + Math.sin(rad) * len, subPt.y - Math.cos(rad) * len);
          ctx.stroke();
          ctx.restore();
          ctx.font = '10px Courier New';
          ctx.fillText(
            `${c.id} BRG ${c.bearingDeg.toFixed(0)}°`,
            subPt.x + Math.sin(rad) * Math.min(len * 0.65, 160) + 4,
            subPt.y - Math.cos(rad) * Math.min(len * 0.65, 160)
          );
        } else {
          const pt = this.leafletMap.latLngToContainerPoint([c.lat, c.lon]);
          ctx.strokeRect(pt.x - 5, pt.y - 5, 10, 10);
          const hRad = ((c.headingDeg || 0) * Math.PI) / 180;
          ctx.beginPath();
          ctx.moveTo(pt.x, pt.y);
          ctx.lineTo(pt.x + Math.sin(hRad) * 18, pt.y - Math.cos(hRad) * 18);
          ctx.stroke();
          ctx.font = '10px Courier New';
          ctx.fillText(`${c.id} (${c.rangeNm.toFixed(1)}NM)`, pt.x + 8, pt.y - 4);
        }
      }

      for (const d of this.currSnapshot.decoys || []) {
        const pt = this.leafletMap.latLngToContainerPoint([d.lat, d.lon]);
        ctx.strokeStyle = '#ffb000';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const w of this.currSnapshot.weapons || []) {
        const pt = this.leafletMap.latLngToContainerPoint([w.lat, w.lon]);
        ctx.fillStyle = w.ownerId === this.currSnapshot.ownSub.id ? '#00ff66' : '#ff3b3b';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '9px Courier New';
        ctx.fillText(w.id, pt.x + 6, pt.y + 3);
      }

      const subRad = (interp.subHdg * Math.PI) / 180;
      ctx.fillStyle = '#00e5ff';
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(subPt.x, subPt.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(subPt.x, subPt.y);
      ctx.lineTo(subPt.x + Math.sin(subRad) * 26, subPt.y - Math.cos(subRad) * 26);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    stepWaterfall(snapshot) {
      const w = this.wfBuffer.width;
      const h = this.wfBuffer.height;
      const ctx = this.wfCtx;
      ctx.drawImage(this.wfBuffer, 0, 0, w, h - 1, 0, 1, w, h - 1);
      const img = ctx.createImageData(w, 1);
      const data = img.data;
      const sub = snapshot.ownSub;
      const contacts = snapshot.contacts || [];

      for (let x = 0; x < w; x++) {
        const brg = (x / w) * 360;
        const rel = (brg - sub.headingDeg + 360) % 360;
        const inBaffles = !sub.towedArrayDeployed && rel >= 150 && rel <= 210;
        let intensity = inBaffles ? Math.random() * 10 : 14 + Math.random() * 24;
        for (const c of contacts) {
          const diff = Math.abs(((brg - c.bearingDeg + 540) % 360) - 180);
          if (diff < 3.2) {
            intensity += Math.exp(-(diff * diff) / 1.8) * Math.min(220, Math.max(45, (c.snrDb + 8) * 8));
          }
        }
        const v = Math.min(255, Math.floor(intensity));
        const idx = x * 4;
        data[idx] = Math.floor(v * 0.15);
        data[idx + 1] = v;
        data[idx + 2] = Math.floor(v * 0.35);
        data[idx + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }

    renderSonarStation(selectedContactId) {
      const wf = document.getElementById('sonar-waterfall-canvas');
      if (wf) {
        if (wf.width !== wf.clientWidth || wf.height !== wf.clientHeight) {
          wf.width = wf.clientWidth || 720;
          wf.height = wf.clientHeight || 300;
        }
        const ctx = wf.getContext('2d');
        const w = wf.width;
        const h = wf.height;
        ctx.fillStyle = '#040a06';
        ctx.fillRect(0, 0, w, 26);
        if (w > 0 && h > 26) ctx.drawImage(this.wfBuffer, 0, 26, w, h - 26);
        ctx.strokeStyle = '#1e422b';
        ctx.fillStyle = '#00ff66';
        ctx.font = '10px Courier New';
        for (let deg = 0; deg < 360; deg += 30) {
          const x = (deg / 360) * w;
          ctx.beginPath();
          ctx.moveTo(x, 16);
          ctx.lineTo(x, h);
          ctx.stroke();
          ctx.fillText(deg.toString().padStart(3, '0') + '°', x + 3, 12);
        }
        if (this.currSnapshot) {
          for (const c of this.currSnapshot.contacts || []) {
            const x = (c.bearingDeg / 360) * w;
            ctx.fillStyle = c.id === selectedContactId ? '#ffb000' : '#00e5ff';
            ctx.fillText(`▼${c.id}`, x - 14, 24);
          }
        }
      }
      this.renderDemonCanvas(selectedContactId);
      this.renderTmaMini(selectedContactId);
    }

    renderDemonCanvas(selectedContactId) {
      const canvas = document.getElementById('sonar-demon-canvas');
      if (!canvas) return;
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth || 450;
        canvas.height = canvas.clientHeight || 150;
      }
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = '#030805';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#12291a';
      for (let hz = 50; hz < 400; hz += 50) {
        const x = (hz / 400) * w;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        ctx.fillStyle = '#5a8c6b';
        ctx.font = '9px Courier New';
        ctx.fillText(`${hz}Hz`, x + 2, h - 4);
      }

      const sel = this.currSnapshot
        ? (this.currSnapshot.contacts || []).find((c) => c.id === selectedContactId)
        : null;
      if (!sel) {
        ctx.fillStyle = '#5a8c6b';
        ctx.font = '11px Courier New';
        ctx.fillText('SELECT A SONAR TRACK TO INSPECT NARROWBAND TONALS', 20, h / 2);
        document.getElementById('demon-tonals').textContent = '-- Hz';
        document.getElementById('demon-blades').textContent = '--';
        document.getElementById('demon-plant').textContent = '--';
        return;
      }

      const isMerchant = sel.category === 'MERCHANT';
      const isWarship = sel.category === 'WARSHIP';
      const tonals = isMerchant ? [32, 64, 128] : isWarship ? [75, 150, 260] : [52, 104, 185];
      document.getElementById('demon-tonals').textContent = tonals.join(' / ') + ' Hz';
      document.getElementById('demon-blades').textContent = isMerchant ? '4-BLADE SCREW' : isWarship ? '5-BLADE SCREW' : '7-BLADE PUMPJET';
      document.getElementById('demon-plant').textContent = isMerchant ? '2-STROKE DIESEL' : isWarship ? 'COGAG TURBINE' : 'PWR NUCLEAR';

      ctx.strokeStyle = '#00ff66';
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const hz = (x / w) * 400;
        let amp = 10 + Math.random() * 8;
        for (const p of tonals) {
          const d = Math.abs(hz - p);
          if (d < 8) amp += Math.exp(-(d * d) / 6) * (h * 0.65);
        }
        const y = h - 18 - Math.min(h - 24, amp);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    renderTmaMini(selectedContactId) {
      const canvas = document.getElementById('tma-mini-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      ctx.fillStyle = '#020604';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#12291a';
      [35, 70].forEach((r) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); });

      const sel = this.currSnapshot
        ? (this.currSnapshot.contacts || []).find((c) => c.id === selectedContactId)
        : null;
      if (!sel) return;

      const rad = (sel.bearingDeg * Math.PI) / 180;
      ctx.strokeStyle = '#ffb000';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(rad) * 85, cy - Math.cos(rad) * 85);
      ctx.stroke();

      ctx.fillStyle = '#00e5ff';
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    renderFireControlScope(selectedContactId, interp) {
      const canvas = document.getElementById('fc-scope-canvas');
      if (!canvas) return;
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth || 420;
        canvas.height = canvas.clientHeight || 420;
      }
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const pxPerNm = Math.min(w, h) / 26;

      ctx.fillStyle = '#020604';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#123322';
      for (const nm of [3, 6, 12]) {
        ctx.beginPath();
        ctx.arc(cx, cy, nm * pxPerNm, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (!interp || !this.currSnapshot) return;
      const cosLat = Math.max(0.2, Math.cos((interp.subLat * Math.PI) / 180));

      for (const c of this.currSnapshot.contacts || []) {
        const col = c.id === selectedContactId ? '#ffb000' : c.allegiance === 'HOSTILE' ? '#ff3b3b' : '#00ff66';
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        if (!c.ranged || c.lat === null || c.lon === null) {
          const rad = (c.bearingDeg * Math.PI) / 180;
          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.sin(rad) * 12 * pxPerNm, cy - Math.cos(rad) * 12 * pxPerNm);
          ctx.stroke();
          ctx.restore();
        } else {
          const px = cx + (c.lon - interp.subLon) * 60 * cosLat * pxPerNm;
          const py = cy - (c.lat - interp.subLat) * 60 * pxPerNm;
          ctx.strokeRect(px - 5, py - 5, 10, 10);
          ctx.font = '10px Courier New';
          ctx.fillText(c.id, px + 7, py - 3);
        }
      }

      for (const wep of this.currSnapshot.weapons || []) {
        const px = cx + (wep.lon - interp.subLon) * 60 * cosLat * pxPerNm;
        const py = cy - (wep.lat - interp.subLat) * 60 * pxPerNm;
        ctx.fillStyle = '#00ff66';
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#00e5ff';
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    renderManeuveringStation() {
      const prof = document.getElementById('maneuvering-profile-canvas');
      if (prof && this.currSnapshot) {
        const ctx = prof.getContext('2d');
        const w = prof.width;
        const h = prof.height;
        ctx.fillStyle = '#030805';
        ctx.fillRect(0, 0, w, h);
        const sub = this.currSnapshot.ownSub;
        const env = this.currSnapshot.environment;
        const layerY = (env.thermoclineM / 400) * h;
        ctx.strokeStyle = '#ffb000';
        ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(0, layerY); ctx.lineTo(w, layerY); ctx.stroke();
        ctx.setLineDash([]);
        const subY = (Math.min(390, sub.depthM) / 400) * h;
        ctx.fillStyle = '#00e5ff';
        ctx.fillRect(w / 2 - 35, subY - 6, 70, 12);
        ctx.font = '11px Courier New';
        ctx.fillText(`${sub.name} @ ${sub.depthM.toFixed(0)}m (ORD ${sub.orderedDepthM.toFixed(0)}m)`, 14, 20);
      }

      const svp = document.getElementById('svp-canvas');
      if (svp) {
        if (svp.width !== svp.clientWidth || svp.height !== svp.clientHeight) {
          svp.width = svp.clientWidth || 300;
          svp.height = svp.clientHeight || 300;
        }
        const ctx = svp.getContext('2d');
        const w = svp.width;
        const h = svp.height;
        ctx.fillStyle = '#030805';
        ctx.fillRect(0, 0, w, h);
        const env = this.currSnapshot ? this.currSnapshot.environment : { thermoclineM: 85 };
        const subDepth = this.currSnapshot ? this.currSnapshot.ownSub.depthM : 45;
        const layerY = (env.thermoclineM / 400) * h;
        ctx.strokeStyle = '#ffb000';
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(0, layerY); ctx.lineTo(w, layerY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffb000';
        ctx.font = '10px Courier New';
        ctx.fillText(`THERMOCLINE LAYER: ${env.thermoclineM}m`, 10, layerY - 6);

        // Draw SVP velocity curve
        ctx.strokeStyle = '#00ff66';
        ctx.beginPath();
        ctx.moveTo(w * 0.65, 0);
        ctx.lineTo(w * 0.78, layerY);
        ctx.lineTo(w * 0.35, layerY + 55);
        ctx.lineTo(w * 0.58, h);
        ctx.stroke();

        const subY = (Math.min(400, subDepth) / 400) * h;
        ctx.strokeStyle = '#00e5ff';
        ctx.beginPath(); ctx.moveTo(0, subY); ctx.lineTo(w, subY); ctx.stroke();
      }
    }

    renderReactorSchematic() {
      const canvas = document.getElementById('reactor-schematic-canvas');
      if (!canvas) return;
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth || 520;
        canvas.height = canvas.clientHeight || 380;
      }
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = '#030805';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#00ff66';
      ctx.lineWidth = 2;
      ctx.strokeRect(40, 70, 110, 170);
      ctx.fillStyle = '#ffb000';
      ctx.font = 'bold 12px Courier New';
      ctx.fillText('S9G REACTOR', 52, 95);
      ctx.fillStyle = '#00e5ff';
      ctx.fillRect(195, 70, 95, 170);
      ctx.fillStyle = '#030805';
      ctx.fillText('STEAM GEN', 208, 155);
      ctx.strokeStyle = '#00ff66';
      ctx.strokeRect(335, 95, 130, 120);
      ctx.fillStyle = '#00ff66';
      ctx.fillText('MAIN TURBINE', 352, 155);
    }

    renderRadarEsmCanvas(selectedContactId) {
      const canvas = document.getElementById('radar-esm-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const rMax = Math.min(cx, cy) - 16;

      ctx.fillStyle = '#030805';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#143824';
      [0.33, 0.66, 1.0].forEach((f) => {
        ctx.beginPath(); ctx.arc(cx, cy, rMax * f, 0, Math.PI * 2); ctx.stroke();
      });

      this.radarSweepDeg = (this.radarSweepDeg + 2.4) % 360;
      const sRad = (this.radarSweepDeg * Math.PI) / 180;
      ctx.strokeStyle = 'rgba(0, 255, 102, 0.55)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(sRad) * rMax, cy - Math.cos(sRad) * rMax);
      ctx.stroke();

      if (!this.currSnapshot) return;
      for (const c of this.currSnapshot.contacts || []) {
        const bRad = (c.bearingDeg * Math.PI) / 180;
        const col = c.id === selectedContactId ? '#ffb000' : c.allegiance === 'HOSTILE' ? '#ff3b3b' : '#00e5ff';
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        const sx = cx + Math.sin(bRad) * (rMax - 4);
        const sy = cy - Math.cos(bRad) * (rMax - 4);
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '9px Courier New';
        ctx.fillText(c.id, sx - 12, sy - 7);
      }
    }
  }

  root.MultiStationRenderer = MultiStationRenderer;
})(window);
