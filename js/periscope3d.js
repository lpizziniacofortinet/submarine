/**
 * ============================================================================
 * REAL-TIME 3D WEBGL PERISCOPE & EXTERNAL SUBMARINE ENVIRONMENT
 * Pure WebGL 1 (zero external engines).
 * Features:
 * - True Right-Handed Geographic Coordinate System (+X East, +Y Up, -Z North)
 * - 360° Polar Multi-Ring 3D Terrain, Coastal Cliffs, Copernicus DEM Horizon
 *   Relief, and Underwater Bathymetry Seabed
 * - Distance-Compensated 3D Ships, Submarines, Kelvin Wakes, Whales,
 *   Torpedoes, Missiles, and NATO Naval Base Harbors
 * - Exact 3D-to-2D Screen Projection for HUD Target Brackets, Landmarks,
 *   and Center Reticle Line-of-Sight (LOS) Stadimeter Rangefinder
 * ============================================================================
 */
(function () {
  'use strict';

  const VERTEX_SHADER = [
    'attribute vec3 aPosition;',
    'attribute vec3 aColor;',
    'attribute vec3 aNormal;',
    'uniform mat4 uViewProjection;',
    'uniform vec3 uCameraPosition;',
    'varying vec3 vColor;',
    'varying vec3 vNormal;',
    'varying float vDistance;',
    'varying float vWorldY;',
    'void main() {',
    '  vec4 worldPosition = vec4(aPosition, 1.0);',
    '  gl_Position = uViewProjection * worldPosition;',
    '  vColor = aColor;',
    '  vNormal = normalize(aNormal);',
    '  vDistance = distance(aPosition, uCameraPosition);',
    '  vWorldY = aPosition.y;',
    '}'
  ].join('\n');

  const FRAGMENT_SHADER = [
    'precision mediump float;',
    'uniform vec3 uLightDirection;',
    'uniform vec3 uFogColor;',
    'uniform float uFogNear;',
    'uniform float uFogFar;',
    'uniform float uAlpha;',
    'uniform float uThermal;',
    'varying vec3 vColor;',
    'varying vec3 vNormal;',
    'varying float vDistance;',
    'varying float vWorldY;',
    'void main() {',
    '  vec3 n = normalize(vNormal);',
    '  float diffuse = max(dot(n, normalize(uLightDirection)), 0.0);',
    '  float hemi = 0.5 + 0.5 * n.y;',
    '  vec3 lit = vColor * (0.38 + hemi * 0.24 + diffuse * 0.48);',
    '  if (uThermal > 0.5) {',
    '    float luma = dot(lit, vec3(0.299, 0.587, 0.114));',
    '    float heat = clamp(luma * 1.35 + (vWorldY > 0.2 ? 0.12 : 0.0), 0.0, 1.0);',
    '    lit = vec3(heat * 0.92, heat * 0.98, heat * 0.90);',
    '  }',
    '  float fog = smoothstep(uFogNear, uFogFar, vDistance);',
    '  lit = mix(lit, uFogColor, fog);',
    '  gl_FragColor = vec4(lit, uAlpha);',
    '}'
  ].join('\n');

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const radians = (degrees) => (degrees * Math.PI) / 180;

  function normalize(v) {
    const length = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
  }

  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    const range = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (near + far) * range, -1,
      0, 0, near * far * 2 * range, 0
    ]);
  }

  function lookAt(eye, target, up) {
    const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
    const x = normalize(cross(up, z));
    const y = cross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
    ]);
  }

  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        out[col * 4 + row] =
          a[row] * b[col * 4] +
          a[4 + row] * b[col * 4 + 1] +
          a[8 + row] * b[col * 4 + 2] +
          a[12 + row] * b[col * 4 + 3];
      }
    }
    return out;
  }

  /**
   * Projects a 3D world point [x, y, z] through a 4x4 column-major viewProjection matrix
   * into normalized screen coordinates and pixel coordinates.
   */
  function projectWorldToScreen(point, vp, screenW, screenH) {
    const x = point[0], y = point[1], z = point[2];
    const clipX = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
    const clipY = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
    const clipZ = vp[2] * x + vp[6] * y + vp[10] * z + vp[14];
    const clipW = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];

    if (clipW <= 0.1) return null;
    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;
    const ndcZ = clipZ / clipW;
    const inFrustum = ndcX >= -1.15 && ndcX <= 1.15 && ndcY >= -1.15 && ndcY <= 1.15 && ndcZ >= -1.0 && ndcZ <= 1.0;

    return {
      x: (ndcX * 0.5 + 0.5) * screenW,
      y: (0.5 - ndcY * 0.5) * screenH,
      ndcX,
      ndcY,
      inFrustum
    };
  }

  function makeMesh() {
    return [];
  }

  function addTriangle(out, a, b, c, colorA, colorB, colorC) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = normalize(cross(ab, ac));
    const colors = [colorA || colorB || colorC, colorB || colorA || colorC, colorC || colorA || colorB];
    [a, b, c].forEach((point, index) => {
      out.push(point[0], point[1], point[2]);
      out.push(colors[index][0], colors[index][1], colors[index][2]);
      out.push(normal[0], normal[1], normal[2]);
    });
  }

  function addQuad(out, a, b, c, d, color) {
    addTriangle(out, a, b, c, color, color, color);
    addTriangle(out, a, c, d, color, color, color);
  }

  /**
   * Right-handed local-to-world transform for a vessel on compass heading `headingDeg`:
   * +lx = Starboard (Right), +ly = Up, +lz = Bow (Forward)
   * Forward vector = [sin(hdg), 0, -cos(hdg)]
   * Starboard vector = [cos(hdg), 0, sin(hdg)]
   */
  function localToWorld(cx, cy, cz, lx, ly, lz, headingRad) {
    const sinH = Math.sin(headingRad);
    const cosH = Math.cos(headingRad);
    return [
      cx + lx * cosH + lz * sinH,
      cy + ly,
      cz + lx * sinH - lz * cosH
    ];
  }

  function addBox(out, cx, cy, cz, sx, sy, sz, headingRad, color) {
    const x = sx / 2, y = sy / 2, z = sz / 2;
    const pt = (lx, ly, lz) => localToWorld(cx, cy, cz, lx, ly, lz, headingRad);
    const p000 = pt(-x, -y, -z), p100 = pt(x, -y, -z);
    const p110 = pt(x, y, -z), p010 = pt(-x, y, -z);
    const p001 = pt(-x, -y, z), p101 = pt(x, -y, z);
    const p111 = pt(x, y, z), p011 = pt(-x, y, z);
    addQuad(out, p000, p100, p110, p010, color);
    addQuad(out, p101, p001, p011, p111, color);
    addQuad(out, p001, p000, p010, p011, color);
    addQuad(out, p100, p101, p111, p110, color);
    addQuad(out, p010, p110, p111, p011, color);
    addQuad(out, p001, p101, p100, p000, color);
  }

  /**
   * Builds a 3D Vessel, Submarine, Merchant Ship, or Whale Pod with wakes
   */
  function addVessel(out, x, y, z, headingDeg, length, beam, heightScale, kind, tint, speedKts = 10) {
    const yaw = radians(headingDeg);
    const pt = (lx, ly, lz) => localToWorld(x, y, z, lx, ly, lz, yaw);

    if (kind === 'biologic') {
      // Whale pod backs + vertical blow spout
      const whaleColor = [0.14, 0.19, 0.22];
      addBox(out, x, y + 0.6, z, beam * 0.45, 2.2 * heightScale, length * 0.55, yaw, whaleColor);
      if (y >= -6) {
        // Misty blow spout above surface
        addBox(out, x, 3.8 * heightScale, z + length * 0.15, 1.8 * heightScale, 7.5 * heightScale, 1.8 * heightScale, yaw, [0.82, 0.90, 0.92]);
      }
      return;
    }

    const freeboard = (kind === 'submarine' ? 2.2 : 5.2) * heightScale;
    const draft = (kind === 'submarine' ? 4.8 : 4.2) * heightScale;

    const sections = [
      { z: -length * 0.50, w: beam * 0.14, top: freeboard * 0.75, bottom: -draft * 0.65 },
      { z: -length * 0.30, w: beam * 0.46, top: freeboard * 0.92, bottom: -draft },
      { z: length * 0.20, w: beam * 0.50, top: freeboard, bottom: -draft },
      { z: length * 0.44, w: beam * 0.20, top: freeboard * 0.95, bottom: -draft * 0.65 },
      { z: length * 0.50, w: beam * 0.03, top: freeboard * 1.05, bottom: -draft * 0.30 }
    ];

    const hull = tint || [0.22, 0.29, 0.33];
    const deck = [
      clamp(hull[0] * 1.25, 0, 1),
      clamp(hull[1] * 1.25, 0, 1),
      clamp(hull[2] * 1.22, 0, 1)
    ];

    for (let i = 0; i < sections.length - 1; i++) {
      const a = sections[i], b = sections[i + 1];
      addQuad(out, pt(-a.w, a.top, a.z), pt(-b.w, b.top, b.z), pt(-b.w, b.bottom, b.z), pt(-a.w, a.bottom, a.z), hull);
      addQuad(out, pt(b.w, b.top, b.z), pt(a.w, a.top, a.z), pt(a.w, a.bottom, a.z), pt(b.w, b.bottom, b.z), hull);
      addQuad(out, pt(-a.w, a.bottom, a.z), pt(-b.w, b.bottom, b.z), pt(b.w, b.bottom, b.z), pt(a.w, a.bottom, a.z), [0.06, 0.10, 0.13]);
      addQuad(out, pt(-a.w, a.top, a.z), pt(a.w, a.top, a.z), pt(b.w, b.top, b.z), pt(-b.w, b.top, b.z), deck);
    }

    if (kind === 'submarine') {
      // Conning tower sail + bow planes + stern rudder fin
      const sailCenter = pt(0, freeboard + 3.4 * heightScale, length * 0.08);
      addBox(out, sailCenter[0], sailCenter[1], sailCenter[2], beam * 0.24, 6.2 * heightScale, length * 0.18, yaw, [0.18, 0.24, 0.27]);
      const planesCenter = pt(0, freeboard + 2.8 * heightScale, length * 0.10);
      addBox(out, planesCenter[0], planesCenter[1], planesCenter[2], beam * 0.72, 0.45 * heightScale, length * 0.04, yaw, [0.22, 0.28, 0.31]);
      const finCenter = pt(0, freeboard + 2.2 * heightScale, -length * 0.44);
      addBox(out, finCenter[0], finCenter[1], finCenter[2], beam * 0.08, 4.4 * heightScale, length * 0.07, yaw, [0.16, 0.22, 0.25]);
    } else if (kind === 'merchant') {
      // Commercial Container / Tanker: high aft bridge house + forward cargo blocks
      const aftBridge = pt(0, freeboard + 5.5 * heightScale, -length * 0.28);
      addBox(out, aftBridge[0], aftBridge[1], aftBridge[2], beam * 0.72, 9.5 * heightScale, length * 0.14, yaw, [0.76, 0.79, 0.80]);
      const cargo1 = pt(0, freeboard + 3.2 * heightScale, length * 0.04);
      addBox(out, cargo1[0], cargo1[1], cargo1[2], beam * 0.78, 5.2 * heightScale, length * 0.36, yaw, [0.58, 0.28, 0.22]);
    } else {
      // Surface Warship: stepped stealth bridge, radar tower, forward gun turret & aft helo hanger
      const bridge = pt(0, freeboard + 4.4 * heightScale, length * 0.06);
      addBox(out, bridge[0], bridge[1], bridge[2], beam * 0.62, 7.2 * heightScale, length * 0.22, yaw, [0.46, 0.52, 0.54]);
      const mast = pt(0, freeboard + 10.2 * heightScale, length * 0.08);
      addBox(out, mast[0], mast[1], mast[2], beam * 0.22, 6.8 * heightScale, length * 0.06, yaw, [0.35, 0.42, 0.45]);
      const aftHangar = pt(0, freeboard + 3.2 * heightScale, -length * 0.20);
      addBox(out, aftHangar[0], aftHangar[1], aftHangar[2], beam * 0.56, 5.0 * heightScale, length * 0.18, yaw, [0.40, 0.46, 0.48]);
      const gun = pt(0, freeboard + 1.8 * heightScale, length * 0.28);
      addBox(out, gun[0], gun[1], gun[2], beam * 0.26, 2.6 * heightScale, length * 0.06, yaw, [0.32, 0.38, 0.40]);
    }

    // White Foam Bow Wave & V-Shaped Kelvin Stern Wake on Water Surface
    if (y >= -4 && speedKts > 1.5) {
      const wakeLen = clamp(length * (0.8 + speedKts * 0.08), 60, 480);
      const wakeColor = [0.78, 0.88, 0.90];
      const bowPt = pt(0, 0.65, length * 0.51);
      const portBowWake = pt(-beam * 1.15, 0.55, -length * 0.15);
      const stbdBowWake = pt(beam * 1.15, 0.55, -length * 0.15);
      addTriangle(out, bowPt, pt(-beam * 0.35, 0.6, length * 0.25), portBowWake, wakeColor, wakeColor, [0.25, 0.48, 0.55]);
      addTriangle(out, bowPt, stbdBowWake, pt(beam * 0.35, 0.6, length * 0.25), wakeColor, [0.25, 0.48, 0.55], wakeColor);

      // Stern wake ribbon
      const sternL = pt(-beam * 0.28, 0.55, -length * 0.48);
      const sternR = pt(beam * 0.28, 0.55, -length * 0.48);
      const wakeAftL = pt(-beam * 1.45, 0.45, -length * 0.50 - wakeLen);
      const wakeAftR = pt(beam * 1.45, 0.45, -length * 0.50 - wakeLen);
      addQuad(out, sternL, sternR, wakeAftR, wakeAftL, [0.55, 0.72, 0.76]);
    }
  }

  class Periscope3DRenderer {
    constructor() {
      this.canvas = document.getElementById('periscope-3d-canvas');
      this.gl = null;
      this.program = null;
      this.ready = false;
      this.mode = 'periscope';
      this.terrainCache = null;
      this.seabedCache = null;
      this.terrainKey = '';
      this.orbitYaw = 145;
      this.orbitPitch = 26;
      this.orbitDistance = 230;
      this.scopePitchDeg = 0.0; // Vertical look angle in periscope mode (-10° to +18°)
      this.dragState = null;
      this.uniforms = {};
      this.attributes = {};

      // Projected 2D HUD markers & center LOS rangefinder output consumed by stations.js
      this.lastSceneMarkers = [];
      this.lastCenterRayInfo = null;
      this.lastViewProjection = null;

      if (!this.canvas) return;

      try {
        this.gl = this.canvas.getContext('webgl', {
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance'
        }) || this.canvas.getContext('experimental-webgl');
        if (!this.gl) return;
        this.program = this.createProgram();
        this.initializeLocations();
        this.gl.enable(this.gl.DEPTH_TEST);
        this.gl.depthFunc(this.gl.LEQUAL);
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        this.gl.clearColor(0, 0, 0, 0);
        this.ready = true;
        this.bindCameraControls();
        const consoleEl = this.canvas.closest('.scope-console');
        if (consoleEl) consoleEl.classList.add('scope-3d-active');
      } catch (error) {
        console.warn('Periscope 3D initialization failed; retaining the 2D optical display.', error);
        this.ready = false;
      }
    }

    compileShader(type, source) {
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(error || 'WebGL shader compilation failed');
      }
      return shader;
    }

    createProgram() {
      const gl = this.gl;
      const program = gl.createProgram();
      gl.attachShader(program, this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER));
      gl.attachShader(program, this.compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || 'WebGL program link failed');
      }
      gl.useProgram(program);
      return program;
    }

    initializeLocations() {
      const gl = this.gl;
      gl.useProgram(this.program);
      this.attributes = {
        position: gl.getAttribLocation(this.program, 'aPosition'),
        color: gl.getAttribLocation(this.program, 'aColor'),
        normal: gl.getAttribLocation(this.program, 'aNormal')
      };
      this.uniforms = {
        viewProjection: gl.getUniformLocation(this.program, 'uViewProjection'),
        cameraPosition: gl.getUniformLocation(this.program, 'uCameraPosition'),
        lightDirection: gl.getUniformLocation(this.program, 'uLightDirection'),
        fogColor: gl.getUniformLocation(this.program, 'uFogColor'),
        fogNear: gl.getUniformLocation(this.program, 'uFogNear'),
        fogFar: gl.getUniformLocation(this.program, 'uFogFar'),
        alpha: gl.getUniformLocation(this.program, 'uAlpha'),
        thermal: gl.getUniformLocation(this.program, 'uThermal')
      };
      this.buffer = gl.createBuffer();
    }

    bindCameraControls() {
      this.canvas.addEventListener('pointerdown', (event) => {
        this.dragState = {
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
          moved: false
        };
        this.canvas.setPointerCapture(event.pointerId);
      });

      this.canvas.addEventListener('pointermove', (event) => {
        if (!this.dragState || this.dragState.pointerId !== event.pointerId) return;
        const dx = event.clientX - this.dragState.x;
        const dy = event.clientY - this.dragState.y;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this.dragState.moved = true;

        if (this.mode === 'outside') {
          this.orbitYaw = (this.orbitYaw + dx * 0.45 + 360) % 360;
          this.orbitPitch = clamp(this.orbitPitch - dy * 0.35, 6, 80);
        } else if (window.Stations) {
          // Slew periscope bearing horizontally & adjust look elevation vertically
          const zoom = window.Stations.scopeZoom || 1.5;
          window.Stations.scopeBearing = (window.Stations.scopeBearing - dx * (0.18 / Math.sqrt(zoom)) + 360) % 360;
          this.scopePitchDeg = clamp(this.scopePitchDeg + dy * 0.08, -10, 18);
          const brgEl = document.getElementById('scope-brg-val');
          if (brgEl) {
            brgEl.textContent = `${Math.round(window.Stations.scopeBearing).toString().padStart(3, '0')}° T`;
          }
        }
        this.dragState.x = event.clientX;
        this.dragState.y = event.clientY;
      });

      const stopDrag = (event) => {
        if (this.dragState && !this.dragState.moved && window.World) {
          // Click on a 3D projected contact marker to select it!
          const rect = this.canvas.getBoundingClientRect();
          const cx = event.clientX - rect.left;
          const cy = event.clientY - rect.top;
          let bestContact = null;
          let bestDist = 36;
          for (const m of this.lastSceneMarkers) {
            if (m.kind === 'contact' && m.inFrustum) {
              const d = Math.hypot(m.x - cx, m.y - cy);
              if (d < bestDist) {
                bestDist = d;
                bestContact = m.contact;
              }
            }
          }
          if (bestContact) {
            window.World.selectContact(bestContact.id);
          }
        }
        this.dragState = null;
      };
      this.canvas.addEventListener('pointerup', stopDrag);
      this.canvas.addEventListener('pointercancel', () => { this.dragState = null; });

      this.canvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        if (this.mode === 'outside') {
          this.orbitDistance = clamp(this.orbitDistance + Math.sign(event.deltaY) * 24, 75, 680);
        } else if (window.Stations) {
          const zooms = [1.5, 3.0, 6.0, 12.0];
          const curIdx = zooms.findIndex((z) => Math.abs(z - window.Stations.scopeZoom) < 0.2);
          const nextIdx = clamp((curIdx === -1 ? 0 : curIdx) + (event.deltaY < 0 ? 1 : -1), 0, zooms.length - 1);
          window.Stations.scopeZoom = zooms[nextIdx];
          const zoomBtn = document.getElementById('btn-scope-zoom');
          if (zoomBtn) zoomBtn.textContent = `ZOOM ${window.Stations.scopeZoom}×`;
        }
      }, { passive: false });
    }

    setMode(mode) {
      if (!this.ready) {
        const status = document.getElementById('scope-terrain-status');
        if (status) status.textContent = 'WEBGL UNAVAILABLE — 2D OPTICAL FALLBACK';
        return;
      }
      this.mode = mode === 'outside' ? 'outside' : 'periscope';
      const periscopeButton = document.getElementById('btn-scope-view-periscope');
      const outsideButton = document.getElementById('btn-scope-view-outside');
      if (periscopeButton) periscopeButton.classList.toggle('active', this.mode === 'periscope');
      if (outsideButton) outsideButton.classList.toggle('active', this.mode === 'outside');
      const liveMark = this.canvas && this.canvas.parentElement.querySelector('.scope-live-mark');
      if (liveMark) {
        liveMark.style.display = 'flex';
        liveMark.lastChild.textContent = this.mode === 'outside' ? ' EXTERNAL CAMERA' : ' EO SENSOR';
      }
      const systemReadout = this.canvas && this.canvas.parentElement.parentElement.querySelector('.scope-system-readout strong');
      if (systemReadout) systemReadout.textContent = this.mode === 'outside' ? 'DRAG ORBIT / WHEEL ZOOM' : 'DRAG SLEW / WHEEL ZOOM';
      const bearingLabel = this.canvas && this.canvas.parentElement.parentElement.querySelector('.scope-bearing-readout span');
      if (bearingLabel) bearingLabel.textContent = this.mode === 'outside' ? 'EXTERNAL CAMERA' : 'TRUE BEARING';
    }

    /**
     * Converts geographic (lat, lon) into Right-Handed 3D world meters [x, z]
     * where +X = East (meters) and -Z = North (meters).
     */
    geographicOffset(sub, lat, lon) {
      const eastMeters = (lon - sub.lon) * 111320 * Math.cos(radians(sub.lat));
      const northMeters = (lat - sub.lat) * 110574;
      return [eastMeters, -northMeters];
    }

    terrainKeyFor(sub, coastlineStatus) {
      return [sub.lat.toFixed(3), sub.lon.toFixed(3), coastlineStatus || 'IDLE'].join(':');
    }

    /**
     * Builds a 360° Polar Multi-Ring 3D Terrain & Underwater Bathymetry Mesh
     * out to 95 km, fusing the local Mediterranean landmask, bathymetric trenches/shoals,
     * and the live Copernicus DEM horizon profile.
     */
    buildPolarWorldMeshes(sub, coastlineProfile) {
      const landOut = makeMesh();
      const seabedOut = makeMesh();

      const azimuthSteps = 72; // Every 5 degrees around the compass
      const ringsKm = [
        0.08, 0.22, 0.45, 0.85, 1.4, 2.2, 3.3, 4.8, 6.8,
        9.5, 13.0, 17.5, 23.0, 30.0, 39.0, 50.0, 64.0, 80.0, 96.0
      ];
      const effectiveRadiusM = 6371008.8 / (1 - 0.13);

      const grid = [];
      for (let ir = 0; ir < ringsKm.length; ir++) {
        const rKm = ringsKm[ir];
        const rMeters = rKm * 1000;
        const curvatureDropM = (rMeters * rMeters) / (2 * effectiveRadiusM);
        const row = [];

        for (let ia = 0; ia <= azimuthSteps; ia++) {
          const bearingDeg = (ia % azimuthSteps) * (360 / azimuthSteps);
          const brgRad = radians(bearingDeg);
          const x = Math.sin(brgRad) * rMeters;
          const z = -Math.cos(brgRad) * rMeters;

          const pt = window.CoastlineModel && window.CoastlineModel.destinationPoint
            ? window.CoastlineModel.destinationPoint(sub.lat, sub.lon, bearingDeg, rKm)
            : {
                lat: sub.lat + (Math.cos(brgRad) * rMeters) / 110574,
                lon: sub.lon + (Math.sin(brgRad) * rMeters) / (111320 * Math.cos(radians(sub.lat)))
              };

          const isLandMask = window.CoastlineModel && window.CoastlineModel.isLand
            ? window.CoastlineModel.isLand(pt.lat, pt.lon)
            : false;
          const seafloorM = window.Bathymetry
            ? window.Bathymetry.getSeafloorDepthMeters(pt.lat, pt.lon)
            : 800;

          // Check live Copernicus DEM / Coastline horizon profile along this azimuth
          const demSample = coastlineProfile && window.CoastlineModel
            ? window.CoastlineModel.sample(coastlineProfile, bearingDeg)
            : null;
          const demLandHere = Boolean(
            demSample &&
            demSample.hasLand &&
            demSample.rangeKm > 0.3 &&
            rKm >= demSample.rangeKm * 0.92 &&
            rKm <= Math.max(demSample.rangeKm * 1.85, demSample.rangeKm + 18)
          );

          const isLand = isLandMask || seafloorM === 0 || demLandHere;
          let y = 0;

          if (isLand) {
            let elevM = window.CoastlineModel && window.CoastlineModel.estimateFallbackElevation
              ? window.CoastlineModel.estimateFallbackElevation(pt.lat, pt.lon)
              : 110;
            if (demLandHere && demSample.elevationM > elevM) {
              elevM = demSample.elevationM;
            }
            // Add realistic coastal mountain ridge rugosity
            const ridge =
              Math.sin(pt.lat * 85 + pt.lon * 62) * 35 +
              Math.cos(pt.lat * 210 - pt.lon * 190) * 18;
            const rawHeight = Math.max(8, (elevM + ridge) * 0.45 - curvatureDropM * 0.35);
            y = clamp(rawHeight, 4, 1100);
          } else {
            // Underwater bathymetry seabed depth
            y = -clamp(seafloorM * 0.42, 10, 560);
          }

          row.push({ x, y, z, isLand, seafloorM });
        }
        grid.push(row);
      }

      const landColor = (y) => {
        if (y > 460) return [0.64, 0.63, 0.59]; // High rocky/snowy mountain peak (Mt. Etna / Crete)
        if (y > 220) return [0.44, 0.46, 0.38]; // Highland garrigue & limestone
        if (y > 65) return [0.33, 0.42, 0.29];  // Mediterranean pine & olive hills
        return [0.58, 0.52, 0.39];              // Coastal sandstone cliffs & beach
      };

      const seabedColor = (y) => {
        const d = Math.abs(y);
        if (d < 45) return [0.16, 0.38, 0.39];  // Shallow bank / shoal
        if (d < 160) return [0.09, 0.24, 0.30]; // Continental shelf slope
        return [0.05, 0.13, 0.19];              // Abyssal plain / trench
      };

      for (let ir = 0; ir < ringsKm.length - 1; ir++) {
        for (let ia = 0; ia < azimuthSteps; ia++) {
          const a = grid[ir][ia];
          const b = grid[ir][ia + 1];
          const c = grid[ir + 1][ia + 1];
          const d = grid[ir + 1][ia];

          // Draw underwater seabed quad
          const seaY = (n) => (n.isLand ? 2.0 : n.y);
          addTriangle(
            seabedOut,
            [a.x, seaY(a), a.z],
            [b.x, seaY(b), b.z],
            [c.x, seaY(c), c.z],
            seabedColor(a.y),
            seabedColor(b.y),
            seabedColor(c.y)
          );
          addTriangle(
            seabedOut,
            [a.x, seaY(a), a.z],
            [c.x, seaY(c), c.z],
            [d.x, seaY(d), d.z],
            seabedColor(a.y),
            seabedColor(c.y),
            seabedColor(d.y)
          );

          // Draw above-water coastal & mountain terrain whenever ANY vertex is land
          if (a.isLand || b.isLand || c.isLand) {
            const pa = [a.x, a.isLand ? a.y : -1.5, a.z];
            const pb = [b.x, b.isLand ? b.y : -1.5, b.z];
            const pc = [c.x, c.isLand ? c.y : -1.5, c.z];
            addTriangle(landOut, pa, pb, pc, landColor(pa[1]), landColor(pb[1]), landColor(pc[1]));
          }
          if (a.isLand || c.isLand || d.isLand) {
            const pa = [a.x, a.isLand ? a.y : -1.5, a.z];
            const pc = [c.x, c.isLand ? c.y : -1.5, c.z];
            const pd = [d.x, d.isLand ? d.y : -1.5, d.z];
            addTriangle(landOut, pa, pc, pd, landColor(pa[1]), landColor(pc[1]), landColor(pd[1]));
          }
        }
      }

      return {
        landMesh: new Float32Array(landOut),
        seabedMesh: new Float32Array(seabedOut)
      };
    }

    buildWater(timeSeconds) {
      const out = makeMesh();
      const nx = 44, nz = 44;
      const minX = -32000, maxX = 32000, minZ = -32000, maxZ = 32000;
      const wave = (x, z) =>
        0.72 * Math.sin(x * 0.0012 + timeSeconds * 0.85) +
        0.46 * Math.sin(z * 0.0009 - timeSeconds * 0.62) +
        0.24 * Math.sin((x - z) * 0.0015 + timeSeconds * 0.95);

      const nodes = [];
      for (let iz = 0; iz <= nz; iz++) {
        const row = [];
        for (let ix = 0; ix <= nx; ix++) {
          const x = minX + ((maxX - minX) * ix) / nx;
          const z = minZ + ((maxZ - minZ) * iz) / nz;
          const y = wave(x, z);
          const nxv = -0.0009 * Math.cos(x * 0.0012 + timeSeconds * 0.85);
          const nzv = -0.0005 * Math.cos(z * 0.0009 - timeSeconds * 0.62);
          row.push({ x, y, z, normal: normalize([nxv, 1, nzv]) });
        }
        nodes.push(row);
      }

      const base = [0.04, 0.24, 0.34];
      const highlight = [0.12, 0.42, 0.51];
      const push = (a, b, c) => {
        [a, b, c].forEach((p) => {
          const waveLight = clamp(0.5 + p.normal[0] * 1.6 + p.normal[2] * 1.3, 0, 1);
          const col = base.map((v, i) => v + (highlight[i] - v) * waveLight);
          out.push(p.x, p.y, p.z, col[0], col[1], col[2], p.normal[0], p.normal[1], p.normal[2]);
        });
      };

      for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
          const a = nodes[iz][ix], b = nodes[iz][ix + 1];
          const c = nodes[iz + 1][ix + 1], d = nodes[iz + 1][ix];
          push(a, b, c);
          push(a, c, d);
        }
      }
      return new Float32Array(out);
    }

    buildSceneObjects(world) {
      const out = makeMesh();
      const sub = world.ownSub;

      // 1. Own Submarine in External 3D Camera Mode
      if (this.mode === 'outside') {
        const subY = -Math.max(0, sub.depthM) + 4.5;
        addVessel(out, 0, subY, 0, sub.heading, 115, 10.4, 1.0, 'submarine', [0.13, 0.19, 0.22], sub.speedKts);

        if (sub.periscopeRaised && sub.depthM <= 20.5) {
          const mastTop = 5.5;
          const mastBottom = subY + 6.0;
          addBox(
            out,
            0,
            (mastTop + mastBottom) / 2,
            8,
            0.35,
            Math.max(0.5, mastTop - mastBottom),
            0.35,
            radians(sub.heading),
            [0.32, 0.39, 0.42]
          );
        }
      }

      // 2. Nearby NATO Naval Base 3D Harbor Pier & Lighthouse Beacon
      if (window.NATO_BASES) {
        for (const base of window.NATO_BASES) {
          const [bx, bz] = this.geographicOffset(sub, base.lat, base.lon);
          const distM = Math.hypot(bx, bz);
          if (distM < 32000) {
            const s = clamp(1 + Math.sqrt(distM / 1000) * 0.4, 1, 3.2);
            addBox(out, bx, 6 * s, bz, 48 * s, 12 * s, 18 * s, 0, [0.52, 0.54, 0.50]);
            addBox(out, bx, 22 * s, bz, 8 * s, 28 * s, 8 * s, 0, [0.85, 0.85, 0.82]);
            addBox(out, bx, 38 * s, bz, 10 * s, 6 * s, 10 * s, 0, [0.98, 0.78, 0.22]); // Lighthouse lamp
          }
        }
      }

      // 3. Contacts (Warships, Submarines, Merchants, Biologics) with Distance-Compensated Visual Scale
      const maxRangeMeters = this.mode === 'periscope' ? 28000 : 36000;
      for (const contact of world.contacts || []) {
        if (contact.sunk) continue;
        const [cx, cz] = this.geographicOffset(sub, contact.lat, contact.lon);
        const rangeM = Math.hypot(cx, cz);
        if (rangeM > maxRangeMeters) continue;

        const isSub = contact.profile && contact.profile.category === 'SUBMARINE';
        const isBio = contact.profile && contact.profile.category === 'BIOLOGIC';
        const isMerchant = contact.profile && contact.profile.category === 'MERCHANT';

        // In periscope mode above water, only show surface contacts or shallow/surfacing subs & whales
        if (this.mode === 'periscope' && sub.periscopeRaised && contact.depthM > 16 && !isBio) continue;

        // Visual magnification boost at distance so ships on the horizon are clearly recognizable
        const rangeKm = rangeM / 1000;
        const visualScale = this.mode === 'periscope'
          ? clamp(1.0 + 0.68 * Math.sqrt(rangeKm), 1.0, 4.6)
          : clamp(1.0 + 0.35 * Math.sqrt(rangeKm), 1.0, 2.8);

        const baseLen = isBio ? 28 : isSub ? 106 : isMerchant ? 165 : 142;
        const baseBeam = isBio ? 7 : isSub ? 10 : isMerchant ? 24 : 18;
        const y = contact.depthM > 5 ? -contact.depthM + 4.0 : 0;

        let hullColor = [0.30, 0.36, 0.39];
        if (contact.profile) {
          if (contact.profile.allegiance === 'HOSTILE') hullColor = [0.22, 0.25, 0.28];
          else if (contact.profile.allegiance === 'FRIENDLY') hullColor = [0.24, 0.38, 0.44];
          else if (isMerchant) hullColor = [0.36, 0.24, 0.20];
        }

        const kind = isBio ? 'biologic' : isSub ? 'submarine' : isMerchant ? 'merchant' : 'surface';
        addVessel(
          out,
          cx,
          y,
          cz,
          contact.heading,
          baseLen * visualScale,
          baseBeam * visualScale,
          visualScale,
          kind,
          hullColor,
          contact.speedKts
        );
      }

      // 4. Active Torpedoes & Sea-Skimming Missiles
      for (const wep of world.weapons || []) {
        if (wep.exploded) continue;
        const [wx, wz] = this.geographicOffset(sub, wep.lat, wep.lon);
        const rangeM = Math.hypot(wx, wz);
        if (rangeM > 28000) continue;
        const wy = wep.type === 'MISSILE' ? 14.0 : -Math.max(2, wep.depthM);
        const wYaw = radians(wep.heading);
        const wScale = clamp(1 + Math.sqrt(rangeM / 1000) * 0.5, 1.2, 3.5);

        if (wep.type === 'MISSILE') {
          addBox(out, wx, wy, wz, 2.2 * wScale, 2.2 * wScale, 14 * wScale, wYaw, [0.88, 0.88, 0.88]);
          // Rocket booster exhaust plume
          const plume = localToWorld(wx, wy, wz, 0, 0, -14 * wScale, wYaw);
          addBox(out, plume[0], plume[1], plume[2], 4.5 * wScale, 4.5 * wScale, 18 * wScale, wYaw, [0.98, 0.58, 0.16]);
        } else {
          const torpColor = wep.isPlayer ? [0.18, 0.78, 0.42] : [0.88, 0.24, 0.22];
          addBox(out, wx, wy, wz, 1.8 * wScale, 1.8 * wScale, 12 * wScale, wYaw, torpColor);
          // White cavitation wake trail behind torpedo
          const wake = localToWorld(wx, wy, wz, 0, 0, -16 * wScale, wYaw);
          addBox(out, wake[0], wake[1], wake[2], 3.2 * wScale, 2.0 * wScale, 22 * wScale, wYaw, [0.75, 0.88, 0.92]);
        }
      }

      return new Float32Array(out);
    }

    /**
     * Computes 2D screen projections for all visible contacts, landmarks, NATO bases,
     * and the center crosshair Line-of-Sight (LOS) rangefinder.
     */
    computeSceneProjections(world, stations, viewProjection, cssWidth, cssHeight) {
      const sub = world.ownSub;
      const markers = [];
      const scopeBearing = stations ? stations.scopeBearing : sub.heading;

      // 1. Project Contacts
      let centerLockedContact = null;
      let minCenterAngleDiff = 3.2;

      for (const contact of world.contacts || []) {
        if (contact.sunk) continue;
        if (this.mode === 'periscope' && sub.periscopeRaised && contact.depthM > 16 &&
            (!contact.profile || contact.profile.category !== 'BIOLOGIC')) {
          continue;
        }

        const [cx, cz] = this.geographicOffset(sub, contact.lat, contact.lon);
        const rangeNm = window.Bathymetry.distanceNm(sub.lat, sub.lon, contact.lat, contact.lon);
        if (rangeNm > 15.5) continue;

        const bearing = window.Bathymetry.bearingDeg(sub.lat, sub.lon, contact.lat, contact.lon);
        const cy = contact.depthM > 5 ? -contact.depthM + 6 : 8;
        const proj = projectWorldToScreen([cx, cy, cz], viewProjection, cssWidth, cssHeight);
        if (proj && proj.inFrustum) {
          markers.push({
            kind: 'contact',
            contact,
            x: proj.x,
            y: proj.y,
            rangeNm,
            bearing
          });
        }

        const angleDiff = Math.abs(((bearing - scopeBearing + 540) % 360) - 180);
        if (angleDiff < minCenterAngleDiff) {
          minCenterAngleDiff = angleDiff;
          centerLockedContact = { contact, rangeNm, bearing };
        }
      }

      // 2. Project Named Geographic Features (Islands, Mountains, Shoals)
      if (window.Bathymetry && Array.isArray(window.Bathymetry.features)) {
        for (const f of window.Bathymetry.features) {
          const rangeNm = window.Bathymetry.distanceNm(sub.lat, sub.lon, f.lat, f.lon);
          if (rangeNm > 38 || rangeNm < 0.3) continue;
          // In periscope mode, show islands/mountains (peakM > 0) and shallow banks (peakM > -120)
          if (this.mode === 'periscope' && f.peakM < -120) continue;

          const [fx, fz] = this.geographicOffset(sub, f.lat, f.lon);
          const fy = f.peakM > 0 ? clamp(f.peakM * 0.35, 25, 650) : 4;
          const proj = projectWorldToScreen([fx, fy, fz], viewProjection, cssWidth, cssHeight);
          if (proj && proj.inFrustum) {
            markers.push({
              kind: 'landmark',
              name: f.name,
              peakM: f.peakM,
              isShoal: f.peakM < 0,
              x: proj.x,
              y: proj.y,
              rangeNm,
              bearing: window.Bathymetry.bearingDeg(sub.lat, sub.lon, f.lat, f.lon)
            });
          }
        }
      }

      // 3. Project Nearby NATO Naval Bases
      if (window.NATO_BASES) {
        for (const base of window.NATO_BASES) {
          const rangeNm = window.Bathymetry.distanceNm(sub.lat, sub.lon, base.lat, base.lon);
          if (rangeNm > 24) continue;
          const [bx, bz] = this.geographicOffset(sub, base.lat, base.lon);
          const proj = projectWorldToScreen([bx, 28, bz], viewProjection, cssWidth, cssHeight);
          if (proj && proj.inFrustum) {
            markers.push({
              kind: 'base',
              name: base.name.split('(')[0].trim(),
              x: proj.x,
              y: proj.y,
              rangeNm,
              bearing: window.Bathymetry.bearingDeg(sub.lat, sub.lon, base.lat, base.lon)
            });
          }
        }
      }

      // 4. Compute Center Reticle Line-of-Sight (LOS) Rangefinder Info
      const coastlineProfile = stations && stations.coastlineModel ? stations.coastlineModel.profile : null;
      const centerRay = coastlineProfile && window.CoastlineModel
        ? window.CoastlineModel.sample(coastlineProfile, scopeBearing)
        : null;

      this.lastSceneMarkers = markers;
      this.lastCenterRayInfo = {
        bearing: scopeBearing,
        lockedContact: centerLockedContact,
        landRay: centerRay && centerRay.hasLand ? centerRay : null,
        horizonNm: 4.7, // Optical horizon from 4.8m photonics mast height
        seafloorM: world.currentSeafloorM || 1000
      };
    }

    draw(vertices, viewProjection, camera, options) {
      if (!vertices || !vertices.length) return;
      const gl = this.gl;
      gl.useProgram(this.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
      const stride = 9 * 4;
      gl.enableVertexAttribArray(this.attributes.position);
      gl.enableVertexAttribArray(this.attributes.color);
      gl.enableVertexAttribArray(this.attributes.normal);
      gl.vertexAttribPointer(this.attributes.position, 3, gl.FLOAT, false, stride, 0);
      gl.vertexAttribPointer(this.attributes.color, 3, gl.FLOAT, false, stride, 3 * 4);
      gl.vertexAttribPointer(this.attributes.normal, 3, gl.FLOAT, false, stride, 6 * 4);
      gl.uniformMatrix4fv(this.uniforms.viewProjection, false, viewProjection);
      gl.uniform3fv(this.uniforms.cameraPosition, camera);
      gl.uniform3f(this.uniforms.lightDirection, -0.35, 0.82, 0.44);
      gl.uniform3f(this.uniforms.fogColor, options.fog[0], options.fog[1], options.fog[2]);
      gl.uniform1f(this.uniforms.fogNear, options.fogNear);
      gl.uniform1f(this.uniforms.fogFar, options.fogFar);
      gl.uniform1f(this.uniforms.alpha, options.alpha);
      gl.uniform1f(this.uniforms.thermal, options.thermal ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 9);
    }

    render(world, stations) {
      if (!this.ready || !world || !world.ownSub) return;
      const gl = this.gl;
      const sub = world.ownSub;
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      // Always keep CoastlineModel updated so 3D terrain gets live DEM/landmask rays
      if (stations && stations.coastlineModel) {
        stations.coastlineModel.updatePosition(sub.lat, sub.lon);
      }
      const coastlineProfile = stations && stations.coastlineModel ? stations.coastlineModel.profile : null;
      const coastlineStatus = stations && stations.coastlineModel ? stations.coastlineModel.status : 'IDLE';

      const pixelRatio = Math.min(1.6, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * pixelRatio));
      const height = Math.max(1, Math.round(rect.height * pixelRatio));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      gl.viewport(0, 0, width, height);

      const hours = ((world.simTimeSec || 0) / 3600) % 24;
      const daylight = clamp(0.14 + 0.86 * Math.sin(((hours - 5.5) / 13) * Math.PI), 0.10, 1);
      const skyTop = [0.03 + daylight * 0.36, 0.07 + daylight * 0.46, 0.12 + daylight * 0.48];
      const skyBottom = [0.12 + daylight * 0.56, 0.20 + daylight * 0.56, 0.26 + daylight * 0.52];
      const skyCss =
        'linear-gradient(180deg, rgb(' +
        Math.round(skyTop[0] * 255) + ',' +
        Math.round(skyTop[1] * 255) + ',' +
        Math.round(skyTop[2] * 255) + ') 0%, rgb(' +
        Math.round(skyBottom[0] * 255) + ',' +
        Math.round(skyBottom[1] * 255) + ',' +
        Math.round(skyBottom[2] * 255) + ') 48%, #0b566e 50%, #06364b 100%)';
      this.canvas.style.background = skyCss;

      const raised = Boolean(sub.periscopeRaised && sub.depthM <= 20.5);
      const thermal = Boolean(stations && stations.scopeThermal);
      const zoom = stations && stations.scopeZoom ? stations.scopeZoom : 1.5;
      const visibilityKm = Math.max(4, Number(stations && stations.scopeVisibilityKm) || 55);
      const fogNear = visibilityKm * 220;
      const fogFar = visibilityKm * 1450;

      let eye, target, fov;
      if (this.mode === 'outside') {
        const orbit = radians(sub.heading + this.orbitYaw);
        const pitch = radians(this.orbitPitch);
        const targetY = -Math.max(0, sub.depthM) + 4.5;
        const horizontal = this.orbitDistance * Math.cos(pitch);
        eye = [
          Math.sin(orbit) * horizontal,
          targetY + this.orbitDistance * Math.sin(pitch),
          -Math.cos(orbit) * horizontal
        ];
        target = [0, targetY, 0];
        fov = radians(52);
      } else {
        const bearingRad = radians(stations ? stations.scopeBearing : sub.heading);
        const pitchRad = radians((raised ? -0.6 : 12.0) + this.scopePitchDeg);
        const cameraY = raised ? 5.2 : -Math.max(0, sub.depthM) + 2.5;
        eye = [0, cameraY, 0];
        target = [
          Math.sin(bearingRad) * Math.cos(pitchRad) * 1000,
          cameraY + Math.sin(pitchRad) * 1000,
          -Math.cos(bearingRad) * Math.cos(pitchRad) * 1000
        ];
        fov = radians(48 / zoom);
        if (!raised) {
          this.canvas.style.background = 'linear-gradient(180deg, #061d2b 0%, #0a3143 55%, #03111b 100%)';
        }
      }

      const view = lookAt(eye, target, [0, 1, 0]);
      const projection = perspective(fov, width / height, 1.0, 98000);
      const viewProjection = multiply(projection, view);
      this.lastViewProjection = viewProjection;

      const fog = thermal
        ? [0.62, 0.68, 0.65]
        : this.mode === 'outside'
        ? [0.28, 0.46, 0.54]
        : [0.46, 0.60, 0.66];

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.depthMask(true);

      const terrainKey = this.terrainKeyFor(sub, coastlineStatus);
      if (!this.terrainCache || !this.seabedCache || terrainKey !== this.terrainKey) {
        const meshes = this.buildPolarWorldMeshes(sub, coastlineProfile);
        this.terrainCache = meshes.landMesh;
        this.seabedCache = meshes.seabedMesh;
        this.terrainKey = terrainKey;
      }

      const objects = this.buildSceneObjects(world);
      const water = this.buildWater((world.simTimeSec || 0) * 0.12);

      if (this.mode === 'periscope') {
        if (!raised) {
          this.draw(this.seabedCache, viewProjection, eye, {
            fog: [0.04, 0.14, 0.20], fogNear: 200, fogFar: 12000, alpha: 1, thermal
          });
        }
        this.draw(water, viewProjection, eye, {
          fog, fogNear, fogFar, alpha: raised ? 0.96 : 0.42, thermal
        });
        this.draw(this.terrainCache, viewProjection, eye, {
          fog, fogNear, fogFar, alpha: 1, thermal
        });
        this.draw(objects, viewProjection, eye, {
          fog, fogNear, fogFar, alpha: 1, thermal
        });
      } else {
        // External 3D Camera: draw seabed, coastal terrain, submarine/contacts, then translucent water
        this.draw(this.seabedCache, viewProjection, eye, {
          fog: [0.06, 0.20, 0.28], fogNear: 400, fogFar: 28000, alpha: 1, thermal: false
        });
        this.draw(this.terrainCache, viewProjection, eye, {
          fog, fogNear, fogFar, alpha: 1, thermal: false
        });
        this.draw(objects, viewProjection, eye, {
          fog, fogNear, fogFar, alpha: 1, thermal: false
        });
        gl.depthMask(false);
        this.draw(water, viewProjection, eye, {
          fog, fogNear, fogFar, alpha: 0.46, thermal: false
        });
        gl.depthMask(true);
      }

      // Compute 3D-to-2D screen projections for the HUD overlay canvas
      this.computeSceneProjections(world, stations, viewProjection, rect.width, rect.height);

      const liveMark = this.canvas.parentElement.querySelector('.scope-live-mark');
      if (liveMark) {
        liveMark.style.display = this.mode === 'periscope' && !raised ? 'none' : 'flex';
        liveMark.lastChild.textContent =
          this.mode === 'outside' ? ' EXTERNAL 3D CAMERA' : thermal ? ' 3D FLIR SENSOR' : ' 3D EO SENSOR';
      }
      const reticle = this.canvas.parentElement.querySelector('.scope-3d-reticle');
      if (reticle) reticle.style.display = this.mode === 'periscope' && raised ? 'block' : 'none';
      const scopeStatus = document.getElementById('scope-terrain-status');
      if (scopeStatus) {
        if (this.mode === 'outside') {
          scopeStatus.textContent = `3D WORLD: SEABED ${world.currentSeafloorM || '--'}m / LIVE CONTACTS`;
        } else {
          scopeStatus.textContent = raised
            ? `3D TERRAIN: ${coastlineStatus === 'READY' || coastlineStatus === 'CACHED' ? 'COPERNICUS DEM + LANDMASK' : '360° MEDITERRANEAN RELIEF'}`
            : 'MAST RETRACTED: SUBSURFACE VIEW';
        }
        scopeStatus.dataset.state = 'ready';
      }
    }
  }

  window.Periscope3D = new Periscope3DRenderer();
})();
