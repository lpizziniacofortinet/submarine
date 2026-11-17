/**
 * Lightweight real-time 3D environment for the photonics periscope and external camera.
 * No engine or build step: WebGL 1, fed by the live simulation and its geographic data.
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
    'void main() {',
    '  vec4 worldPosition = vec4(aPosition, 1.0);',
    '  gl_Position = uViewProjection * worldPosition;',
    '  vColor = aColor;',
    '  vNormal = normalize(aNormal);',
    '  vDistance = distance(aPosition, uCameraPosition);',
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
    'void main() {',
    '  float diffuse = max(dot(normalize(vNormal), normalize(uLightDirection)), 0.0);',
    '  vec3 lit = vColor * (0.52 + diffuse * 0.48);',
    '  float gray = dot(lit, vec3(0.299, 0.587, 0.114));',
    '  lit = mix(lit, vec3(gray * 1.18), uThermal);',
    '  float fog = smoothstep(uFogNear, uFogFar, vDistance);',
    '  lit = mix(lit, uFogColor, fog);',
    '  gl_FragColor = vec4(lit, uAlpha);',
    '}'
  ].join('\n');

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const radians = (degrees) => degrees * Math.PI / 180;

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

  function addBox(out, cx, cy, cz, sx, sy, sz, yaw, color) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const point = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const x = sx / 2, y = sy / 2, z = sz / 2;
    const p000 = point(-x, -y, -z), p100 = point(x, -y, -z);
    const p110 = point(x, y, -z), p010 = point(-x, y, -z);
    const p001 = point(-x, -y, z), p101 = point(x, -y, z);
    const p111 = point(x, y, z), p011 = point(-x, y, z);
    addQuad(out, p000, p100, p110, p010, color);
    addQuad(out, p101, p001, p011, p111, color);
    addQuad(out, p001, p000, p010, p011, color);
    addQuad(out, p100, p101, p111, p110, color);
    addQuad(out, p010, p110, p111, p011, color);
    addQuad(out, p001, p101, p100, p000, color);
  }

  function addVessel(out, x, y, z, heading, length, beam, kind, tint) {
    const yaw = radians(heading);
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const point = (lx, ly, lz) => [x + lx * cos + lz * sin, y + ly, z - lx * sin + lz * cos];
    const sections = [
      { z: -length * 0.50, w: beam * 0.10, top: 0.15, bottom: -2.6 },
      { z: -length * 0.32, w: beam * 0.42, top: 0.30, bottom: -4.4 },
      { z: length * 0.18, w: beam * 0.50, top: 0.30, bottom: -4.4 },
      { z: length * 0.47, w: beam * 0.18, top: 0.12, bottom: -2.6 },
      { z: length * 0.50, w: beam * 0.04, top: 0.05, bottom: -1.5 }
    ];
    const hull = tint || [0.16, 0.22, 0.25];
    const deck = [hull[0] * 1.28, hull[1] * 1.27, hull[2] * 1.22];

    for (let i = 0; i < sections.length - 1; i++) {
      const a = sections[i], b = sections[i + 1];
      addQuad(out, point(-a.w, a.top, a.z), point(-b.w, b.top, b.z),
        point(-b.w, b.bottom, b.z), point(-a.w, a.bottom, a.z), hull);
      addQuad(out, point(b.w, b.top, b.z), point(a.w, a.top, a.z),
        point(a.w, a.bottom, a.z), point(b.w, b.bottom, b.z), hull);
      addQuad(out, point(-a.w, a.bottom, a.z), point(-b.w, b.bottom, b.z),
        point(b.w, b.bottom, b.z), point(a.w, a.bottom, a.z), [0.07, 0.11, 0.14]);
      addQuad(out, point(-a.w, a.top, a.z), point(a.w, a.top, a.z),
        point(b.w, b.top, b.z), point(-b.w, b.top, b.z), deck);
    }

    if (kind === 'submarine') {
      addBox(out, x, y + 2.1, z - length * 0.04, beam * 0.22, 3.8, length * 0.20,
        yaw, [0.19, 0.25, 0.28]);
      addBox(out, x, y + 4.7, z - length * 0.05, beam * 0.13, 2.0, length * 0.07,
        yaw, [0.24, 0.30, 0.32]);
    } else {
      const bridgeZ = -length * 0.04;
      addBox(out, x, y + 2.2, z + bridgeZ, beam * 0.38, 3.3, length * 0.18,
        yaw, [0.48, 0.52, 0.50]);
      addBox(out, x, y + 4.7, z + bridgeZ + length * 0.015, beam * 0.12, 2.0, length * 0.035,
        yaw, [0.24, 0.31, 0.33]);
      addBox(out, x, y + 3.7, z + length * 0.19, beam * 0.12, 1.8, length * 0.045,
        yaw, [0.35, 0.40, 0.40]);
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
      this.terrainKey = '';
      this.lastRenderTime = 0;
      this.orbitYaw = 145;
      this.orbitPitch = 34;
      this.orbitDistance = 240;
      this.dragState = null;
      this.uniforms = {};
      this.attributes = {};
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
        if (this.mode !== 'outside') return;
        this.dragState = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
        this.canvas.setPointerCapture(event.pointerId);
      });
      this.canvas.addEventListener('pointermove', (event) => {
        if (!this.dragState || this.dragState.pointerId !== event.pointerId) return;
        this.orbitYaw = (this.orbitYaw + (event.clientX - this.dragState.x) * 0.45 + 360) % 360;
        this.orbitPitch = clamp(this.orbitPitch + (this.dragState.y - event.clientY) * 0.35, 8, 78);
        this.dragState.x = event.clientX;
        this.dragState.y = event.clientY;
      });
      const stopDrag = () => { this.dragState = null; };
      this.canvas.addEventListener('pointerup', stopDrag);
      this.canvas.addEventListener('pointercancel', stopDrag);
      this.canvas.addEventListener('wheel', (event) => {
        if (this.mode !== 'outside') return;
        event.preventDefault();
        this.orbitDistance = clamp(this.orbitDistance + Math.sign(event.deltaY) * 24, 90, 520);
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
      if (systemReadout) systemReadout.textContent = this.mode === 'outside' ? 'DRAG ORBIT / WHEEL ZOOM' : 'EO / STABILIZED';
      const bearingLabel = this.canvas && this.canvas.parentElement.parentElement.querySelector('.scope-bearing-readout span');
      if (bearingLabel) bearingLabel.textContent = this.mode === 'outside' ? 'EXTERNAL CAMERA' : 'TRUE BEARING';
    }

    geographicOffset(sub, lat, lon) {
      const east = (lon - sub.lon) * 111320 * Math.cos(radians(sub.lat));
      const north = (lat - sub.lat) * 110574;
      return [east, north];
    }

    terrainKeyFor(sub) {
      return [sub.lat.toFixed(3), sub.lon.toFixed(3)].join(':');
    }

    buildTerrain(sub) {
      const out = makeMesh();
      const gridX = 48, gridZ = 54;
      const step = 500;
      const startX = -12000, startZ = -7000;
      const nodes = [];

      for (let iz = 0; iz <= gridZ; iz++) {
        const row = [];
        for (let ix = 0; ix <= gridX; ix++) {
          const east = startX + ix * step;
          const north = startZ + iz * step;
          const rangeKm = Math.hypot(east, north) / 1000;
          const bearing = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
          const point = window.CoastlineModel && window.CoastlineModel.destinationPoint
            ? window.CoastlineModel.destinationPoint(sub.lat, sub.lon, bearing, rangeKm)
            : { lat: sub.lat + north / 110574, lon: sub.lon + east / (111320 * Math.cos(radians(sub.lat))) };
          const land = window.CoastlineModel && window.CoastlineModel.isLand
            ? window.CoastlineModel.isLand(point.lat, point.lon)
            : false;
          let elevation = 0;
          if (land) {
            elevation = window.CoastlineModel.estimateFallbackElevation
              ? window.CoastlineModel.estimateFallbackElevation(point.lat, point.lon)
              : 90;
          }
          row.push({ x: east, z: north, y: land ? clamp(elevation * 0.32, 18, 650) : 0, land });
        }
        nodes.push(row);
      }

      const terrainColor = (height) => {
        if (height > 380) return [0.57, 0.57, 0.52];
        if (height > 190) return [0.42, 0.45, 0.37];
        if (height > 70) return [0.40, 0.43, 0.34];
        return [0.59, 0.55, 0.43];
      };

      for (let iz = 0; iz < gridZ; iz++) {
        for (let ix = 0; ix < gridX; ix++) {
          const a = nodes[iz][ix], b = nodes[iz][ix + 1];
          const c = nodes[iz + 1][ix + 1], d = nodes[iz + 1][ix];
          if (a.land && b.land && c.land) {
            addTriangle(out, [a.x, a.y, a.z], [b.x, b.y, b.z], [c.x, c.y, c.z],
              terrainColor(a.y), terrainColor(b.y), terrainColor(c.y));
          }
          if (a.land && c.land && d.land) {
            addTriangle(out, [a.x, a.y, a.z], [c.x, c.y, c.z], [d.x, d.y, d.z],
              terrainColor(a.y), terrainColor(c.y), terrainColor(d.y));
          }
        }
      }
      return new Float32Array(out);
    }

    buildWater(timeSeconds) {
      const out = makeMesh();
      const nx = 48, nz = 64;
      const minX = -30000, maxX = 30000, minZ = -24000, maxZ = 36000;
      const wave = (x, z) =>
        0.78 * Math.sin(x * 0.0011 + timeSeconds * 0.78) +
        0.48 * Math.sin(z * 0.00083 - timeSeconds * 0.58) +
        0.22 * Math.sin((x + z) * 0.00165 + timeSeconds * 0.93);
      const nodes = [];
      for (let iz = 0; iz <= nz; iz++) {
        const row = [];
        for (let ix = 0; ix <= nx; ix++) {
          const x = minX + (maxX - minX) * ix / nx;
          const z = minZ + (maxZ - minZ) * iz / nz;
          const y = wave(x, z);
          const nxv = -0.00086 * Math.cos(x * 0.0011 + timeSeconds * 0.78)
            - 0.00036 * Math.cos((x + z) * 0.00165 + timeSeconds * 0.93);
          const nzv = -0.00040 * Math.cos(z * 0.00083 - timeSeconds * 0.58)
            - 0.00036 * Math.cos((x + z) * 0.00165 + timeSeconds * 0.93);
          row.push({ x, y, z, normal: normalize([nxv, 1, nzv]) });
        }
        nodes.push(row);
      }
      const base = [0.035, 0.25, 0.34];
      const highlight = [0.10, 0.39, 0.47];
      const push = (a, b, c) => {
        const triangle = [a, b, c];
        triangle.forEach((p) => {
          const waveLight = clamp(0.5 + p.normal[0] * 1.5 + p.normal[2] * 1.2, 0, 1);
          const col = base.map((v, index) => v + (highlight[index] - v) * waveLight);
          out.push(p.x, p.y, p.z, col[0], col[1], col[2],
            p.normal[0], p.normal[1], p.normal[2]);
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
      if (this.mode === 'outside') {
        const subY = -Math.max(0, sub.depthM) + 4.5;
        addVessel(out, 0, subY, 0, sub.heading, 116, 10.5, 'submarine', [0.12, 0.17, 0.19]);
        if (sub.periscopeRaised && sub.depthM <= 20.5) {
          const mastTop = 5.5;
          const mastBottom = subY + 6.5;
          addBox(out, 0, (mastTop + mastBottom) / 2, 0, 0.35, Math.max(0.5, mastTop - mastBottom), 0.35,
            radians(sub.heading), [0.23, 0.29, 0.31]);
        }
      }

      const maxRangeMeters = this.mode === 'periscope' ? 22000 : 32000;
      for (const contact of world.contacts || []) {
        if (contact.sunk) continue;
        const offset = this.geographicOffset(sub, contact.lat, contact.lon);
        const range = Math.hypot(offset[0], offset[1]);
        if (range > maxRangeMeters) continue;
        if (this.mode === 'periscope' && contact.depthM > 5) continue;

        const isSubmarine = contact.profile && contact.profile.category === 'SUBMARINE';
        const shipLength = isSubmarine ? 105 : (contact.profile && contact.profile.category === 'MILITARY' ? 145 : 118);
        const beam = isSubmarine ? 9.5 : 19;
        const y = contact.depthM > 5 ? -contact.depthM + 4.5 : 0;
        const hullColor = contact.profile && contact.profile.allegiance === 'HOSTILE'
          ? [0.19, 0.22, 0.24]
          : [0.34, 0.39, 0.39];
        addVessel(out, offset[0], y, offset[1], contact.heading, shipLength, beam,
          isSubmarine ? 'submarine' : 'surface', hullColor);
      }

      return new Float32Array(out);
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

      const pixelRatio = Math.min(1.6, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * pixelRatio));
      const height = Math.max(1, Math.round(rect.height * pixelRatio));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      gl.viewport(0, 0, width, height);

      const hours = ((world.simTimeSec || 0) / 3600) % 24;
      const daylight = clamp(0.12 + 0.88 * Math.sin((hours - 5.5) / 13 * Math.PI), 0.08, 1);
      const skyTop = [0.025 + daylight * 0.39, 0.06 + daylight * 0.48, 0.11 + daylight * 0.48];
      const skyBottom = [0.11 + daylight * 0.58, 0.19 + daylight * 0.58, 0.25 + daylight * 0.52];
      const skyCss = 'linear-gradient(180deg, rgb(' +
        Math.round(skyTop[0] * 255) + ',' + Math.round(skyTop[1] * 255) + ',' + Math.round(skyTop[2] * 255) + ') 0%, rgb(' +
        Math.round(skyBottom[0] * 255) + ',' + Math.round(skyBottom[1] * 255) + ',' + Math.round(skyBottom[2] * 255) + ') 48%, #0b566e 50%, #06364b 100%)';
      this.canvas.style.background = skyCss;

      const raised = Boolean(sub.periscopeRaised && sub.depthM <= 20.5);
      const thermal = Boolean(stations && stations.scopeThermal);
      const zoom = stations && stations.scopeZoom ? stations.scopeZoom : 1.5;
      const visibilityKm = Math.max(1, Number(stations && stations.scopeVisibilityKm) || 55);
      const fogNear = visibilityKm * 180;
      const fogFar = visibilityKm * 1000;
      let eye, target, fov;
      if (this.mode === 'outside') {
        const orbit = radians(sub.heading + this.orbitYaw);
        const pitch = radians(this.orbitPitch);
        const targetY = -Math.max(0, sub.depthM) + 4.5;
        const horizontal = this.orbitDistance * Math.cos(pitch);
        eye = [
          -Math.sin(orbit) * horizontal,
          targetY + this.orbitDistance * Math.sin(pitch),
          -Math.cos(orbit) * horizontal
        ];
        target = [0, targetY, 0];
        fov = radians(52);
      } else {
        const bearing = radians(stations ? stations.scopeBearing : sub.heading);
        // With the mast retracted, look upward through the water from the real hull depth.
        const pitch = raised ? -0.018 : 0.30;
        const cameraY = raised ? 5.1 : -Math.max(0, sub.depthM) + 2;
        eye = [0, cameraY, 0];
        target = [Math.sin(bearing) * 1000, cameraY + pitch * 1000, Math.cos(bearing) * 1000];
        fov = radians(48 / zoom);
        if (!raised) this.canvas.style.background = 'linear-gradient(180deg, #061d2b 0%, #0a3143 55%, #03111b 100%)';
      }

      const view = lookAt(eye, target, [0, 1, 0]);
      const projection = perspective(fov, width / height, 0.8, 70000);
      const viewProjection = multiply(projection, view);
      const fog = this.mode === 'outside' ? [0.36, 0.53, 0.60] : [0.48, 0.62, 0.67];
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.depthMask(true);

      const terrainKey = this.terrainKeyFor(sub);
      if (!this.terrainCache || terrainKey !== this.terrainKey) {
        this.terrainCache = this.buildTerrain(sub);
        this.terrainKey = terrainKey;
      }
      const objects = this.buildSceneObjects(world);
      const water = this.buildWater((world.simTimeSec || 0) * 0.11);

      if (this.mode === 'periscope') {
        this.draw(water, viewProjection, eye, {
          fog, fogNear, fogFar, alpha: raised ? 1 : 0.38, thermal
        });
        this.draw(this.terrainCache, viewProjection, eye, {
          fog, fogNear, fogFar, alpha: 1, thermal
        });
        this.draw(objects, viewProjection, eye, {
          fog, fogNear, fogFar, alpha: 1, thermal
        });
      } else {
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

      const liveMark = this.canvas.parentElement.querySelector('.scope-live-mark');
      if (liveMark) {
        liveMark.style.display = this.mode === 'periscope' && !raised ? 'none' : 'flex';
        liveMark.lastChild.textContent = this.mode === 'outside' ? ' EXTERNAL CAMERA' : (thermal ? ' FLIR SENSOR' : ' EO SENSOR');
      }
      const reticle = this.canvas.parentElement.querySelector('.scope-3d-reticle');
      if (reticle) reticle.style.display = this.mode === 'periscope' && raised ? 'block' : 'none';
      const scopeStatus = document.getElementById('scope-terrain-status');
      if (scopeStatus) {
        if (this.mode === 'outside') {
          scopeStatus.textContent = '3D WORLD: LIVE GEO / CONTACT DATA';
        } else {
          scopeStatus.textContent = raised
            ? '3D TERRAIN: LOCAL LANDMASK / RELIEF MODEL'
            : 'MAST RETRACTED: SUBSURFACE VIEW';
        }
        scopeStatus.dataset.state = 'ready';
      }
    }
  }

  window.Periscope3D = new Periscope3DRenderer();
})();
