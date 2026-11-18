(function (root) {
  'use strict';

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpAngleDeg(a, b, t) {
    const diff = ((b - a + 540) % 360) - 180;
    return (a + diff * t + 360) % 360;
  }

  class TacticalCanvasRenderer {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId);
      this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
      this.prevSnapshot = null;
      this.currSnapshot = null;
      this.snapshotArrivalMs = 0;
      this.snapshotIntervalMs = 100;
    }

    pushSnapshot(snapshot, snapshotHz = 10) {
      this.prevSnapshot = this.currSnapshot;
      this.currSnapshot = snapshot;
      this.snapshotArrivalMs = performance.now();
      this.snapshotIntervalMs = 1000 / Math.max(1, snapshotHz);
    }

    render() {
      if (!this.ctx || !this.canvas) return;
      const ctx = this.ctx;
      const w = this.canvas.width;
      const h = this.canvas.height;

      ctx.fillStyle = '#020604';
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const pxPerNm = 22;

      // Range rings (2, 5, 10 NM)
      ctx.strokeStyle = '#123322';
      ctx.lineWidth = 1;
      for (const nm of [2, 5, 10]) {
        ctx.beginPath();
        ctx.arc(cx, cy, nm * pxPerNm, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#3b7555';
        ctx.font = '10px Courier New';
        ctx.fillText(`${nm} NM`, cx + 4, cy - nm * pxPerNm + 12);
      }

      // Crosshairs
      ctx.beginPath();
      ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
      ctx.moveTo(0, cy); ctx.lineTo(w, cy);
      ctx.stroke();

      if (!this.currSnapshot) {
        ctx.fillStyle = '#5a8c6b';
        ctx.font = '13px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText('CONNECT TO SERVER TO RECEIVE AUTHORITATIVE WORLD SNAPSHOTS', cx, cy - 10);
        ctx.textAlign = 'start';
        return;
      }

      const alpha = this.prevSnapshot
        ? Math.min(1, Math.max(0, (performance.now() - this.snapshotArrivalMs) / this.snapshotIntervalMs))
        : 1;

      const s0 = this.prevSnapshot ? this.prevSnapshot.ownSub : this.currSnapshot.ownSub;
      const s1 = this.currSnapshot.ownSub;
      const subLat = lerp(s0.lat, s1.lat, alpha);
      const subLon = lerp(s0.lon, s1.lon, alpha);
      const subHdg = lerpAngleDeg(s0.headingDeg, s1.headingDeg, alpha);
      const cosLat = Math.max(0.2, Math.cos((subLat * Math.PI) / 180));

      // Draw server-visible contacts (bearing-only rays when passive, exact markers when ranged)
      for (const c1 of this.currSnapshot.contacts || []) {
        const color = c1.allegiance === 'HOSTILE' ? '#ff3b3b' : c1.allegiance === 'NEUTRAL' ? '#00ff66' : '#ffb000';
        ctx.strokeStyle = color;
        ctx.fillStyle = color;

        if (!c1.ranged || c1.lat === null || c1.lon === null) {
          const brgRad = (c1.bearingDeg * Math.PI) / 180;
          const rayLenPx = 11 * pxPerNm;
          ctx.save();
          ctx.setLineDash([6, 5]);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.sin(brgRad) * rayLenPx, cy - Math.cos(brgRad) * rayLenPx);
          ctx.stroke();
          ctx.restore();

          const lx = cx + Math.sin(brgRad) * (7.2 * pxPerNm);
          const ly = cy - Math.cos(brgRad) * (7.2 * pxPerNm);
          ctx.font = '10px Courier New';
          ctx.fillText(`${c1.id} BRG ${c1.bearingDeg.toFixed(0)}° (${c1.snrDb.toFixed(0)}dB)`, lx + 4, ly);
          continue;
        }

        const c0 = this.prevSnapshot
          ? (this.prevSnapshot.contacts || []).find((c) => c.id === c1.id && c.ranged && c.lat !== null) || c1
          : c1;
        const cLat = lerp(c0.lat, c1.lat, alpha);
        const cLon = lerp(c0.lon, c1.lon, alpha);
        const cHdg = lerpAngleDeg(c0.headingDeg ?? c1.headingDeg ?? 0, c1.headingDeg ?? 0, alpha);

        const dxNm = (cLon - subLon) * 60 * cosLat;
        const dyNm = (cLat - subLat) * 60;
        const px = cx + dxNm * pxPerNm;
        const py = cy - dyNm * pxPerNm;

        ctx.lineWidth = 1.5;
        ctx.strokeRect(px - 5, py - 5, 10, 10);
        const rad = (cHdg * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.sin(rad) * 20, py - Math.cos(rad) * 20);
        ctx.stroke();

        ctx.font = '10px Courier New';
        ctx.fillText(`${c1.id} (${c1.rangeNm.toFixed(1)}NM)`, px + 8, py - 4);
      }

      // Draw active MK-48 ADCAP torpedoes
      for (const w1 of this.currSnapshot.weapons || []) {
        const w0 = this.prevSnapshot
          ? (this.prevSnapshot.weapons || []).find((w) => w.id === w1.id) || w1
          : w1;
        const wLat = lerp(w0.lat, w1.lat, alpha);
        const wLon = lerp(w0.lon, w1.lon, alpha);
        const dxNm = (wLon - subLon) * 60 * cosLat;
        const dyNm = (wLat - subLat) * 60;
        const px = cx + dxNm * pxPerNm;
        const py = cy - dyNm * pxPerNm;
        const rad = (w1.headingDeg * Math.PI) / 180;

        ctx.strokeStyle = '#00ff66';
        ctx.fillStyle = '#00ff66';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.sin(rad) * 14, py - Math.cos(rad) * 14);
        ctx.stroke();
        ctx.font = '10px Courier New';
        ctx.fillText(w1.id, px + 6, py + 3);
      }

      // Draw own submarine at center
      const subRad = (subHdg * Math.PI) / 180;
      ctx.strokeStyle = '#00e5ff';
      ctx.fillStyle = '#00e5ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(subRad) * 32, cy - Math.cos(subRad) * 32);
      ctx.stroke();
    }
  }

  root.TacticalCanvasRenderer = TacticalCanvasRenderer;
})(window);
