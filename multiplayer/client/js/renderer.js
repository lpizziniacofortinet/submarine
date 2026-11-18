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
      this.mapInitialized = false;
      this.followSub = true;
      this.prevSnapshot = null;
      this.currSnapshot = null;
      this.snapshotArrivalMs = 0;
      this.snapshotIntervalMs = 100;
      this.periscopeZoom = 1;
      this.periscopeFovDeg = 60;
      this.periscopeBearingOffset = 0;

      // Offscreen Sonar Waterfall buffer
      this.wfBuffer = document.createElement('canvas');
      this.wfBuffer.width = 720;
      this.wfBuffer.height = 300;
      this.wfCtx = this.wfBuffer.getContext('2d');
      this.wfCtx.fillStyle = '#020704';
      this.wfCtx.fillRect(0, 0, 720, 300);
    }

    initLeafletMap() {
      if (this.mapInitialized || typeof L === 'undefined') return;
      const el = document.getElementById('tactical-leaflet-map');
      if (!el) return;
      this.leafletMap = L.map(el, {
        center: [37.18, 15.50],
        zoom: 10,
        zoomControl: false,
        attributionControl: false
      });
      // ESRI World Ocean Basemap (Real NOAA/GEBCO Bathymetry Contours, no API key required)
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 14
      }).addTo(this.leafletMap);
      // OpenSeaMap Nautical Seamarks & Harbors
      L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
        maxZoom: 16,
        opacity: 0.78
      }).addTo(this.leafletMap);
      const tilePane = this.leafletMap.getPane('tilePane');
      if (tilePane) tilePane.classList.add('bathymetry-filter');
      this.mapInitialized = true;
    }

    pushSnapshot(snapshot, snapshotHz = 10) {
      this.prevSnapshot = this.currSnapshot;
      this.currSnapshot = snapshot;
      this.snapshotArrivalMs = performance.now();
      this.snapshotIntervalMs = 1000 / Math.max(1, snapshotHz);
      this.stepWaterfall(snapshot);

      if (this.leafletMap && this.followSub && !this.prevSnapshot) {
        this.leafletMap.setView([snapshot.ownSub.lat, snapshot.ownSub.lon], 10);
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
      if (station === 'tactical') {
        this.renderTacticalOverlay(selectedContactId);
      } else if (station === 'sonar') {
        this.renderSonarStation(selectedContactId);
      } else if (station === 'weapons') {
        this.renderFireControlScope(selectedContactId);
      } else if (station === 'maneuvering') {
        this.renderSvpCanvas();
      } else if (station === 'periscope') {
        this.renderPeriscope();
      }
    }

    renderTacticalOverlay(selectedContactId) {
      const canvas = document.getElementById('tactical-overlay-canvas');
      if (!canvas || !this.leafletMap) return;
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth || 720;
        canvas.height = canvas.clientHeight || 420;
      }
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const interp = this.getInterpolatedState();
      if (!interp || !this.currSnapshot) return;

      const subPt = this.leafletMap.latLngToContainerPoint([interp.subLat, interp.subLon]);

      // Range rings (5 NM, 10 NM)
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

      // Contacts (bearing rays when passive, resolved markers when ranged)
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

      // Decoys & Weapons
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

      // Own Submarine
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
        return;
      }

      const tonals = sel.category === 'MERCHANT' ? [32, 64, 128] : sel.category === 'WARSHIP' ? [75, 150, 260] : [52, 104, 185];
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

    renderFireControlScope(selectedContactId) {
      const canvas = document.getElementById('fc-scope-canvas');
      if (!canvas) return;
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth || 520;
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

      const interp = this.getInterpolatedState();
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

    setPeriscopeZoom(direction) {
      this.periscopeZoom = Math.max(1, Math.min(4, this.periscopeZoom + direction * 0.5));
      const label = document.getElementById('periscope-zoom-label');
      if (label) label.textContent = `MAG ${this.periscopeZoom.toFixed(1)}×`;
      const fov = document.getElementById('periscope-fov');
      if (fov) fov.textContent = `${(this.periscopeFovDeg / this.periscopeZoom).toFixed(0)}°`;
    }

    slewPeriscope(direction) {
      this.periscopeBearingOffset = ((this.periscopeBearingOffset + direction * 5 + 540) % 360) - 180;
      const heading = this.currSnapshot ? this.currSnapshot.ownSub.headingDeg : 90;
      const azimuth = (heading + this.periscopeBearingOffset + 360) % 360;
      const label = document.getElementById('periscope-azimuth');
      if (label) label.textContent = `${Math.round(azimuth).toString().padStart(3, '0')}°`;
    }

    centerPeriscope() {
      this.periscopeBearingOffset = 0;
      const heading = this.currSnapshot ? this.currSnapshot.ownSub.headingDeg : 90;
      const label = document.getElementById('periscope-azimuth');
      if (label) label.textContent = `${Math.round(heading).toString().padStart(3, '0')}°`;
    }

    renderPeriscope() {
      const canvas = document.getElementById('periscope-canvas');
      if (!canvas) return;
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = Math.max(1, canvas.clientWidth || 900);
        canvas.height = Math.max(1, canvas.clientHeight || 480);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const snap = this.currSnapshot;
      const sub = snap ? snap.ownSub : { headingDeg: 90, depthM: 0 };
      const env = snap ? snap.environment : { seaState: 2, windSpeedKts: 0 };
      const seaState = Number(env.seaState) || 0;
      const time = performance.now() * 0.00012;
      const horizonY = Math.round(h * (0.535 + Math.min(0.035, seaState * 0.004)));

      // Sky and haze: intentionally procedural, cosmetic presentation only.
      const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
      sky.addColorStop(0, '#172b37');
      sky.addColorStop(0.55, '#45616a');
      sky.addColorStop(1, '#a3aaa0');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, horizonY);

      const haze = ctx.createLinearGradient(0, horizonY - h * 0.12, 0, horizonY + h * 0.08);
      haze.addColorStop(0, 'rgba(185,196,184,0)');
      haze.addColorStop(0.55, 'rgba(193,202,190,0.36)');
      haze.addColorStop(1, 'rgba(173,190,185,0)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, horizonY - h * 0.12, w, h * 0.2);

      const water = ctx.createLinearGradient(0, horizonY, 0, h);
      water.addColorStop(0, '#536b6b');
      water.addColorStop(0.18, '#28464e');
      water.addColorStop(1, '#081b27');
      ctx.fillStyle = water;
      ctx.fillRect(0, horizonY, w, h - horizonY);

      // Stable, low-amplitude wavelets; no synthetic sensor returns.
      const waveCount = Math.max(14, Math.floor(h / 15));
      for (let i = 0; i < waveCount; i++) {
        const yBase = horizonY + 12 + i * ((h - horizonY - 24) / waveCount);
        const alpha = 0.035 + 0.055 * (i / waveCount);
        const span = w * (0.18 + (i % 5) * 0.09);
        const phase = time * (0.7 + i * 0.017) + i * 1.7;
        ctx.strokeStyle = `rgba(190,211,202,${alpha.toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= span; x += 8) {
          const y = yBase + Math.sin(x * (0.012 + i * 0.00012) + phase) * (1 + i / waveCount * 2.2);
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Fine azimuth tape.
      const fov = this.periscopeFovDeg / this.periscopeZoom;
      ctx.fillStyle = 'rgba(4,13,18,0.46)';
      ctx.fillRect(0, 0, w, 42);
      const heading = ((Number(sub.headingDeg) || 0) + this.periscopeBearingOffset + 360) % 360;
      const first = Math.floor((heading - fov / 2) / 5) * 5;
      const last = Math.ceil((heading + fov / 2) / 5) * 5;
      ctx.font = '10px Consolas, monospace';
      ctx.textAlign = 'center';
      for (let bearing = first; bearing <= last; bearing += 5) {
        const relative = ((bearing - heading + 540) % 360) - 180;
        const x = w / 2 + (relative / fov) * w;
        if (x < -4 || x > w + 4) continue;
        const major = ((bearing % 10) + 10) % 10 === 0;
        ctx.strokeStyle = major ? 'rgba(219,239,230,.78)' : 'rgba(193,218,213,.38)';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, major ? 15 : 9);
        ctx.stroke();
        if (major) {
          ctx.fillStyle = 'rgba(230,241,232,.88)';
          ctx.fillText(String((bearing + 360) % 360).padStart(3, '0'), x, 28);
        }
      }

      // Reticle, stadia and center index.
      ctx.save();
      ctx.strokeStyle = 'rgba(209,237,222,0.64)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w * 0.5, 48); ctx.lineTo(w * 0.5, h - 28);
      ctx.moveTo(18, horizonY); ctx.lineTo(w - 18, horizonY);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(w * 0.5, h * 0.52, Math.min(w, h) * 0.055, 0, Math.PI * 2); ctx.stroke();
      for (let i = -5; i <= 5; i++) {
        const y = h * 0.52 + i * 18;
        const tick = i === 0 ? 15 : 7;
        ctx.beginPath(); ctx.moveTo(w * 0.5 - tick, y); ctx.lineTo(w * 0.5 + tick, y); ctx.stroke();
      }
      ctx.restore();

      // Amber cues are server-ranged surface tracks only, never inferred optical detections.
      const surfaceTracks = snap ? (snap.contacts || []).filter((c) =>
        c.ranged && c.rangeNm !== null && c.rangeNm !== undefined &&
        c.depthM !== null && c.depthM !== undefined && c.depthM <= 2.0 &&
        ['MERCHANT', 'WARSHIP', 'SURFACE'].includes(String(c.category).toUpperCase())
      ) : [];
      let inFovCount = 0;
      for (const track of surfaceTracks) {
        const relative = ((track.bearingDeg - heading + 540) % 360) - 180;
        if (Math.abs(relative) > fov / 2) continue;
        inFovCount++;
        const x = w / 2 + (relative / fov) * w;
        const y = horizonY - 18;
        ctx.strokeStyle = 'rgba(235,190,119,.95)';
        ctx.fillStyle = 'rgba(245,199,128,.95)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x, 42); ctx.lineTo(x, y - 10); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x, y - 7); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 6, y); ctx.closePath();
        ctx.fill();
        ctx.font = '10px Consolas, monospace';
        ctx.textAlign = x > w * 0.78 ? 'right' : 'left';
        const labelX = x > w * 0.78 ? x - 10 : x + 10;
        ctx.fillText(`${track.id} · ${Number(track.rangeNm).toFixed(1)} NM`, labelX, y - 10);
      }

      // Scope edge vignette and lower glass tint.
      const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.18, w / 2, h / 2, Math.max(w, h) * 0.68);
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(0,7,12,0.58)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);

      ctx.textAlign = 'left';
      ctx.font = '9px Consolas, monospace';
      ctx.fillStyle = 'rgba(231,194,137,.92)';
      const cueText = snap
        ? (inFovCount > 0 ? `SERVER-RANGED SURFACE TRACK CUES: ${inFovCount}` : 'NO RANGED SURFACE TRACK CUES IN CURRENT FOV')
        : 'AWAITING AUTHORITATIVE WORLD SNAPSHOT';
      ctx.fillText(cueText, 14, h - 16);

      const azimuthLabel = document.getElementById('periscope-azimuth');
      if (azimuthLabel) azimuthLabel.textContent = `${Math.round(heading).toString().padStart(3, '0')}°`;
      const fovLabel = document.getElementById('periscope-fov');
      if (fovLabel) fovLabel.textContent = `${fov.toFixed(0)}°`;
      const zoomLabel = document.getElementById('periscope-zoom-label');
      if (zoomLabel) zoomLabel.textContent = `MAG ${this.periscopeZoom.toFixed(1)}×`;
    }

    renderSvpCanvas() {
      const canvas = document.getElementById('svp-canvas');
      if (!canvas) return;
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth || 500;
        canvas.height = canvas.clientHeight || 380;
      }
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
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
      ctx.font = '11px Courier New';
      ctx.fillText(`THERMOCLINE LAYER: ${env.thermoclineM}m`, 12, layerY - 6);

      const subY = (Math.min(400, subDepth) / 400) * h;
      ctx.strokeStyle = '#00e5ff';
      ctx.beginPath(); ctx.moveTo(0, subY); ctx.lineTo(w, subY); ctx.stroke();
      ctx.fillStyle = '#00e5ff';
      ctx.fillText(`OWN KEEL DEPTH: ${subDepth.toFixed(0)}m`, 12, subY + 14);
    }
  }

  root.MultiStationRenderer = MultiStationRenderer;
})(window);
