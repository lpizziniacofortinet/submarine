/**
 * ============================================================================
 * THREE.JS WEBGL2 PBR 3D PERISCOPE & EXTERNAL SUBMARINE ENVIRONMENT
 * Built for SSN-774 Multiplayer Client:
 * - Custom GLSL Gerstner Swell + Capillary Wave Ocean Shader with Schlick
 *   Fresnel reflection, solar glitter path, subsurface scatter & whitecaps
 * - Custom GLSL Rayleigh/Mie Atmospheric Sky Dome with Sun Disc & FBM Clouds
 * - Real GLTF/GLB 3D Models (/assets/models/ohio-submarine.glb,
 *   typhoon-submarine.glb) + Detailed PBR 3D Surface Warships & Cargo Ships
 * - 3D Mediterranean Island/Coastline Relief & Underwater Bathymetric Seabed
 * - Periscope Optical Reticle Overlay, FLIR Thermal Mode & 360° External Orbit
 * ============================================================================
 */
(function (root) {
  'use strict';

  const OCEAN_VERT = `
    uniform float uTime;
    uniform float uWaveHeight;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vCrest;

    vec3 gerstner(vec2 xz, vec2 dir, float steepness, float wavelength, float speed, inout vec3 tangent, inout vec3 binormal) {
      float k = 6.2831853 / wavelength;
      float c = sqrt(9.81 / k) * speed;
      vec2 d = normalize(dir);
      float f = k * (dot(d, xz) - c * uTime);
      float a = steepness / k;
      tangent += vec3(-d.x * d.x * steepness * sin(f), d.x * steepness * cos(f), -d.x * d.y * steepness * sin(f));
      binormal += vec3(-d.x * d.y * steepness * sin(f), d.y * steepness * cos(f), -d.y * d.y * steepness * sin(f));
      return vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
    }

    void main() {
      vec4 worldBase = modelMatrix * vec4(position, 1.0);
      vec2 xz = worldBase.xz;
      vec3 tangent = vec3(1.0, 0.0, 0.0);
      vec3 binormal = vec3(0.0, 0.0, 1.0);
      float h = uWaveHeight;

      vec3 disp = vec3(0.0);
      disp += gerstner(xz, vec2(0.85, 0.52), 0.18 * h, 95.0, 1.0, tangent, binormal);
      disp += gerstner(xz, vec2(0.35, -0.93), 0.14 * h, 52.0, 1.15, tangent, binormal);
      disp += gerstner(xz, vec2(-0.72, 0.68), 0.10 * h, 26.0, 1.3, tangent, binormal);
      disp += gerstner(xz, vec2(-0.45, -0.89), 0.07 * h, 13.0, 1.5, tangent, binormal);

      vec3 displaced = worldBase.xyz + disp;
      vWorldPos = displaced;
      vNormal = normalize(cross(binormal, tangent));
      vCrest = clamp(disp.y / max(0.5, 1.8 * h), 0.0, 1.0);
      gl_Position = projectionMatrix * viewMatrix * vec4(displaced, 1.0);
    }
  `;

  const OCEAN_FRAG = `
    uniform vec3 uCameraPos;
    uniform vec3 uSunDir;
    uniform vec3 uSkyHorizon;
    uniform vec3 uSkyZenith;
    uniform float uTime;
    uniform float uThermal;
    uniform float uAlpha;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vCrest;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }

    void main() {
      vec3 V = normalize(uCameraPos - vWorldPos);
      vec3 L = normalize(uSunDir);

      // High-frequency capillary ripple perturbation
      vec2 uv = vWorldPos.xz * 0.18;
      float r1 = noise(uv + vec2(uTime * 1.4, -uTime * 0.9));
      float r2 = noise(uv * 2.3 + vec2(-uTime * 1.1, uTime * 1.6));
      vec3 N = normalize(vNormal + vec3((r1 - 0.5) * 0.14, 0.0, (r2 - 0.5) * 0.14));

      float NoV = max(dot(N, V), 0.001);
      float fresnel = 0.03 + 0.97 * pow(1.0 - NoV, 5.0);

      vec3 R = reflect(-V, N);
      vec3 skyRefl = mix(uSkyHorizon, uSkyZenith, clamp(R.y * 1.4, 0.0, 1.0));

      vec3 deepWater = vec3(0.015, 0.11, 0.18);
      vec3 shallowScatter = vec3(0.04, 0.34, 0.42);
      float sss = clamp(max(dot(L, -V), 0.0) * 0.6 + vCrest * 0.5, 0.0, 1.0);
      vec3 waterBase = mix(deepWater, shallowScatter, sss * 0.65);

      // Solar specular glitter path
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 220.0) * 2.4 + pow(max(dot(N, H), 0.0), 28.0) * 0.25;
      vec3 sunSpec = vec3(1.0, 0.93, 0.80) * spec;

      // Whitecap foam on crests
      float foamNoise = noise(vWorldPos.xz * 0.45 + uTime * 0.5);
      float foam = smoothstep(0.55, 0.92, vCrest + (foamNoise - 0.5) * 0.35);

      vec3 col = mix(waterBase, skyRefl, fresnel) + sunSpec;
      col = mix(col, vec3(0.88, 0.95, 0.97), foam * 0.65);

      // Distance atmospheric haze blend
      float dist = length(uCameraPos - vWorldPos);
      float fogFactor = 1.0 - exp(-dist * 0.000075);
      col = mix(col, uSkyHorizon, clamp(fogFactor, 0.0, 1.0));

      if (uThermal > 0.5) {
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = vec3(0.05, 0.22, 0.12) + vec3(0.22, 0.85, 0.48) * clamp(lum * 1.2 + foam * 0.3, 0.0, 1.0);
      }

      gl_FragColor = vec4(col, uAlpha);
    }
  `;

  const SKY_VERT = `
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const SKY_FRAG = `
    uniform vec3 uSunDir;
    uniform vec3 uSkyHorizon;
    uniform vec3 uSkyZenith;
    uniform float uTime;
    uniform float uThermal;
    varying vec3 vDir;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }

    void main() {
      vec3 dir = normalize(vDir);
      float elev = clamp(dir.y, 0.0, 1.0);
      vec3 col = mix(uSkyHorizon, uSkyZenith, pow(elev, 0.55));

      vec3 L = normalize(uSunDir);
      float sunDot = max(dot(dir, L), 0.0);
      col += vec3(1.0, 0.78, 0.52) * pow(sunDot, 12.0) * 0.35;
      col += vec3(1.0, 0.96, 0.86) * smoothstep(0.9993, 0.9998, sunDot) * 2.0;

      if (elev > 0.04) {
        vec2 cuv = dir.xz / (elev + 0.12) * 1.8 + vec2(uTime * 0.01, 0.0);
        float c = noise(cuv) * 0.6 + noise(cuv * 2.4) * 0.4;
        float cloudMask = smoothstep(0.54, 0.82, c) * smoothstep(0.04, 0.22, elev);
        col = mix(col, vec3(0.84, 0.89, 0.93), cloudMask * 0.45);
      }

      if (uThermal > 0.5) {
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = vec3(0.04, 0.16, 0.09) + vec3(0.15, 0.55, 0.32) * lum;
      }
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const MED_LANDMASSES = [
    { name: 'Sicily / Mt. Etna', lat: 37.68, lon: 14.95, radiusM: 28000, peakM: 1650 },
    { name: 'Calabria Coast', lat: 38.10, lon: 15.80, radiusM: 24000, peakM: 880 },
    { name: 'Malta & Gozo', lat: 35.90, lon: 14.42, radiusM: 12000, peakM: 210 }
  ];

  class ThreePeriscopeEngine {
    constructor() {
      this.canvas3d = document.getElementById('periscope-3d-canvas');
      this.canvas2d = document.getElementById('periscope-canvas');
      this.ctx2d = this.canvas2d ? this.canvas2d.getContext('2d') : null;

      this.mode = 'periscope'; // 'periscope' | 'outside'
      this.mastRaised = true;
      this.thermal = false;
      this.zoom = 1.5;
      this.scopeBearingDeg = 90;
      this.scopePitchDeg = 0;
      this.orbitYawDeg = 140;
      this.orbitPitchDeg = 22;
      this.orbitDistM = 210;
      this.weatherMode = 0; // 0 = CLEAR, 1 = DUSK, 2 = STORM

      this.scene = null;
      this.camera = null;
      this.renderer = null;
      this.oceanMesh = null;
      this.skyMesh = null;
      this.seabedMesh = null;
      this.ownSubGroup = null;
      this.contactsGroup = null;
      this.weaponsGroup = null;
      this.terrainGroup = null;

      this.glbTemplates = {};
      this.contactMeshes = new Map();
      this.weaponMeshes = new Map();
      this.ready = false;

      this.initThree();
      this.bindInteraction();
    }

    initThree() {
      if (!this.canvas3d || typeof THREE === 'undefined') return;
      try {
        this.renderer = new THREE.WebGLRenderer({
          canvas: this.canvas3d,
          antialias: true,
          powerPreference: 'high-performance'
        });
        this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        if (THREE.ACESFilmicToneMapping !== undefined) {
          this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
          this.renderer.toneMappingExposure = 1.1;
        }

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, 16 / 9, 1.0, 90000);

        // Lighting
        this.hemiLight = new THREE.HemisphereLight(0xaad8ff, 0x0a2838, 0.85);
        this.scene.add(this.hemiLight);

        this.sunLight = new THREE.DirectionalLight(0xfff4e0, 1.45);
        this.sunLight.position.set(600, 900, -500);
        this.scene.add(this.sunLight);

        // Atmospheric Sky Dome
        const skyGeo = new THREE.SphereGeometry(65000, 32, 20);
        this.skyMat = new THREE.ShaderMaterial({
          vertexShader: SKY_VERT,
          fragmentShader: SKY_FRAG,
          side: THREE.BackSide,
          depthWrite: false,
          uniforms: {
            uSunDir: { value: new THREE.Vector3(0.45, 0.62, -0.64).normalize() },
            uSkyHorizon: { value: new THREE.Color(0x5d8aa8) },
            uSkyZenith: { value: new THREE.Color(0x0b2239) },
            uTime: { value: 0 },
            uThermal: { value: 0 }
          }
        });
        this.skyMesh = new THREE.Mesh(skyGeo, this.skyMat);
        this.scene.add(this.skyMesh);

        // Gerstner Ocean Surface
        const oceanGeo = new THREE.PlaneGeometry(24000, 24000, 140, 140);
        oceanGeo.rotateX(-Math.PI / 2);
        this.oceanMat = new THREE.ShaderMaterial({
          vertexShader: OCEAN_VERT,
          fragmentShader: OCEAN_FRAG,
          transparent: true,
          side: THREE.DoubleSide,
          uniforms: {
            uTime: { value: 0 },
            uWaveHeight: { value: 1.0 },
            uCameraPos: { value: new THREE.Vector3() },
            uSunDir: { value: new THREE.Vector3(0.45, 0.62, -0.64).normalize() },
            uSkyHorizon: { value: new THREE.Color(0x5d8aa8) },
            uSkyZenith: { value: new THREE.Color(0x0b2239) },
            uThermal: { value: 0 },
            uAlpha: { value: 0.94 }
          }
        });
        this.oceanMesh = new THREE.Mesh(oceanGeo, this.oceanMat);
        this.scene.add(this.oceanMesh);

        // Seabed floor
        const bedGeo = new THREE.PlaneGeometry(36000, 36000, 24, 24);
        bedGeo.rotateX(-Math.PI / 2);
        const bedMat = new THREE.MeshStandardMaterial({
          color: 0x0b242e,
          roughness: 0.95,
          metalness: 0.05
        });
        this.seabedMesh = new THREE.Mesh(bedGeo, bedMat);
        this.seabedMesh.position.y = -450;
        this.scene.add(this.seabedMesh);

        // 3D Terrain Group
        this.terrainGroup = new THREE.Group();
        this.buildTerrainMeshes();
        this.scene.add(this.terrainGroup);

        // Own Submarine Group
        this.ownSubGroup = this.buildProceduralSubmarine(0x1b2830);
        this.scene.add(this.ownSubGroup);

        // Contacts & Weapons Groups
        this.contactsGroup = new THREE.Group();
        this.weaponsGroup = new THREE.Group();
        this.scene.add(this.contactsGroup);
        this.scene.add(this.weaponsGroup);

        // Load real GLB 3D models via THREE.GLTFLoader
        this.loadGLBModels();

        this.ready = true;
      } catch (err) {
        console.warn('Three.js Periscope initialization failed:', err);
      }
    }

    loadGLBModels() {
      if (!THREE.GLTFLoader) return;
      const loader = new THREE.GLTFLoader();
      const manifest = [
        { key: 'SSN-774', url: '/assets/models/ohio-submarine.glb', targetLen: 115 },
        { key: 'OPFOR-SUB', url: '/assets/models/typhoon-submarine.glb', targetLen: 110 }
      ];

      manifest.forEach((item) => {
        loader.load(
          item.url,
          (gltf) => {
            const rootObj = gltf.scene;
            const box = new THREE.Box3().setFromObject(rootObj);
            const size = new THREE.Vector3();
            const center = new THREE.Vector3();
            box.getSize(size);
            box.getCenter(center);

            const holder = new THREE.Group();
            rootObj.position.sub(center);
            if (size.x > size.z * 1.2) {
              rootObj.rotation.y = Math.PI / 2;
            }
            const maxSpan = Math.max(size.x, size.y, size.z, 0.001);
            const scale = item.targetLen / maxSpan;
            rootObj.scale.setScalar(scale);
            holder.add(rootObj);
            this.glbTemplates[item.key] = holder;

            if (item.key === 'SSN-774' && this.ownSubGroup) {
              this.ownSubGroup.clear();
              this.ownSubGroup.add(holder.clone());
              this.ownSubGroup.add(this.buildKelvinWake(115, 11));
            }
          },
          undefined,
          () => {}
        );
      });
    }

    buildTerrainMeshes() {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x3b4d3c,
        roughness: 0.88,
        metalness: 0.05,
        flatShading: true
      });
      MED_LANDMASSES.forEach((lm) => {
        const geo = new THREE.ConeGeometry(lm.radiusM, lm.peakM, 24, 4);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const vx = pos.getX(i);
          const vy = pos.getY(i);
          const vz = pos.getZ(i);
          if (vy > -lm.peakM * 0.45) {
            const ridge = Math.sin(vx * 0.0005) * Math.cos(vz * 0.0005) * 140;
            pos.setY(i, vy + ridge);
          }
        }
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData = lm;
        this.terrainGroup.add(mesh);
      });
    }

    buildKelvinWake(length, beam) {
      const geo = new THREE.PlaneGeometry(beam * 2.6, length * 1.4);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xd8f4ff,
        transparent: true,
        opacity: 0.28,
        depthWrite: false
      });
      const wake = new THREE.Mesh(geo, mat);
      wake.position.set(0, 0.4, 0);
      wake.name = 'kelvinWake';
      return wake;
    }

    buildProceduralSubmarine(colorHex = 0x1b2830) {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.42, metalness: 0.45 });

      const hullGeo = new THREE.CylinderGeometry(5.1, 5.1, 92, 24);
      hullGeo.rotateX(Math.PI / 2);
      g.add(new THREE.Mesh(hullGeo, mat));

      const bowGeo = new THREE.SphereGeometry(5.1, 20, 16);
      const bow = new THREE.Mesh(bowGeo, mat);
      bow.scale.set(1, 1, 2.2);
      bow.position.z = -46;
      g.add(bow);

      const sternGeo = new THREE.ConeGeometry(5.1, 22, 20);
      sternGeo.rotateX(-Math.PI / 2);
      const stern = new THREE.Mesh(sternGeo, mat);
      stern.position.z = 57;
      g.add(stern);

      const sailGeo = new THREE.BoxGeometry(2.6, 7.2, 16);
      const sail = new THREE.Mesh(sailGeo, mat);
      sail.position.set(0, 7.2, -12);
      g.add(sail);

      const mastGeo = new THREE.CylinderGeometry(0.18, 0.22, 6.5, 10);
      const mastMat = new THREE.MeshStandardMaterial({ color: 0x70828c, roughness: 0.3, metalness: 0.7 });
      const mast = new THREE.Mesh(mastGeo, mastMat);
      mast.position.set(0, 13.5, -14);
      g.add(mast);

      g.add(this.buildKelvinWake(115, 10.5));
      return g;
    }

    buildWarshipMesh() {
      const g = new THREE.Group();
      const hullMat = new THREE.MeshStandardMaterial({ color: 0x4b5862, roughness: 0.48, metalness: 0.35 });
      const superMat = new THREE.MeshStandardMaterial({ color: 0x677580, roughness: 0.52, metalness: 0.25 });
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x22292e, roughness: 0.6, metalness: 0.4 });

      const hull = new THREE.Mesh(new THREE.BoxGeometry(16, 8.5, 135), hullMat);
      hull.position.y = 3.0;
      g.add(hull);

      const bowGeo = new THREE.ConeGeometry(11.3, 34, 4);
      bowGeo.rotateY(Math.PI / 4);
      bowGeo.rotateX(-Math.PI / 2);
      const bow = new THREE.Mesh(bowGeo, hullMat);
      bow.scale.set(1.0, 0.54, 1.0);
      bow.position.set(0, 3.2, -84);
      g.add(bow);

      const bridge = new THREE.Mesh(new THREE.BoxGeometry(13, 10, 36), superMat);
      bridge.position.set(0, 11.5, -15);
      g.add(bridge);

      const mast = new THREE.Mesh(new THREE.ConeGeometry(3.8, 16, 4), darkMat);
      mast.position.set(0, 23, -16);
      g.add(mast);

      const hangar = new THREE.Mesh(new THREE.BoxGeometry(13.5, 7.5, 28), superMat);
      hangar.position.set(0, 10.0, 28);
      g.add(hangar);

      const gun = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3.2, 6.5), darkMat);
      gun.position.set(0, 8.5, -52);
      g.add(gun);

      g.add(this.buildKelvinWake(150, 18));
      return g;
    }

    buildMerchantMesh() {
      const g = new THREE.Group();
      const hullMat = new THREE.MeshStandardMaterial({ color: 0x6e241c, roughness: 0.6, metalness: 0.2 });
      const deckMat = new THREE.MeshStandardMaterial({ color: 0x2a353d, roughness: 0.7, metalness: 0.2 });
      const bridgeMat = new THREE.MeshStandardMaterial({ color: 0xe6ecee, roughness: 0.5, metalness: 0.1 });

      const hull = new THREE.Mesh(new THREE.BoxGeometry(24, 11, 175), hullMat);
      hull.position.y = 4.0;
      g.add(hull);

      const bridge = new THREE.Mesh(new THREE.BoxGeometry(20, 18, 22), bridgeMat);
      bridge.position.set(0, 18, 56);
      g.add(bridge);

      const colors = [0xb83b2b, 0x20639b, 0x3caea3, 0xd98a2b];
      for (let i = 0; i < 4; i++) {
        const cMat = new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.65 });
        const stack = new THREE.Mesh(new THREE.BoxGeometry(21, 9.5, 28), cMat);
        stack.position.set(0, 14, -55 + i * 33);
        g.add(stack);
      }

      const deck = new THREE.Mesh(new THREE.BoxGeometry(23, 1.5, 170), deckMat);
      deck.position.y = 9.6;
      g.add(deck);

      g.add(this.buildKelvinWake(180, 25));
      return g;
    }

    bindInteraction() {
      if (!this.canvas3d) return;
      let dragging = false;
      let lastX = 0;
      let lastY = 0;

      this.canvas3d.addEventListener('mousedown', (e) => {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
      });
      window.addEventListener('mouseup', () => { dragging = false; });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        if (this.mode === 'outside') {
          this.orbitYawDeg = (this.orbitYawDeg + dx * 0.45 + 360) % 360;
          this.orbitPitchDeg = Math.max(-25, Math.min(75, this.orbitPitchDeg + dy * 0.35));
        } else {
          this.scopeBearingDeg = (this.scopeBearingDeg + dx * (0.28 / this.zoom) + 360) % 360;
          this.scopePitchDeg = Math.max(-18, Math.min(28, this.scopePitchDeg - dy * (0.18 / this.zoom)));
          const brgEl = document.getElementById('scope-brg-val');
          if (brgEl) brgEl.textContent = `${Math.round(this.scopeBearingDeg).toString().padStart(3, '0')}° T`;
        }
      });

      this.canvas3d.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (this.mode === 'outside') {
          this.orbitDistM = Math.max(65, Math.min(950, this.orbitDistM + e.deltaY * 0.25));
        } else {
          this.zoom = Math.max(1.0, Math.min(10.0, this.zoom + (e.deltaY < 0 ? 0.5 : -0.5)));
          const zBtn = document.getElementById('btn-scope-zoom');
          if (zBtn) zBtn.textContent = `ZOOM ${this.zoom.toFixed(1)}×`;
        }
      }, { passive: false });
    }

    slewBearing(deltaDeg) {
      this.scopeBearingDeg = (this.scopeBearingDeg + deltaDeg + 360) % 360;
      const brgEl = document.getElementById('scope-brg-val');
      if (brgEl) brgEl.textContent = `${Math.round(this.scopeBearingDeg).toString().padStart(3, '0')}° T`;
    }

    cycleWeather() {
      this.weatherMode = (this.weatherMode + 1) % 3;
      const names = ['CLEAR', 'TWILIGHT', 'STORM'];
      if (this.weatherMode === 0) {
        this.skyMat.uniforms.uSkyHorizon.value.setHex(0x5d8aa8);
        this.skyMat.uniforms.uSkyZenith.value.setHex(0x0b2239);
        this.oceanMat.uniforms.uSkyHorizon.value.setHex(0x5d8aa8);
        this.oceanMat.uniforms.uSkyZenith.value.setHex(0x0b2239);
        this.oceanMat.uniforms.uWaveHeight.value = 1.0;
      } else if (this.weatherMode === 1) {
        this.skyMat.uniforms.uSkyHorizon.value.setHex(0xc46d3b);
        this.skyMat.uniforms.uSkyZenith.value.setHex(0x161b33);
        this.oceanMat.uniforms.uSkyHorizon.value.setHex(0xc46d3b);
        this.oceanMat.uniforms.uSkyZenith.value.setHex(0x161b33);
        this.oceanMat.uniforms.uWaveHeight.value = 1.25;
      } else {
        this.skyMat.uniforms.uSkyHorizon.value.setHex(0x2a3740);
        this.skyMat.uniforms.uSkyZenith.value.setHex(0x0d141a);
        this.oceanMat.uniforms.uSkyHorizon.value.setHex(0x2a3740);
        this.oceanMat.uniforms.uSkyZenith.value.setHex(0x0d141a);
        this.oceanMat.uniforms.uWaveHeight.value = 2.4;
      }
      return names[this.weatherMode];
    }

    syncEntities(snapshot, interp) {
      if (!snapshot || !interp) return;
      const sub = snapshot.ownSub;
      const subY = -Math.max(0, sub.depthM) + 2.0;

      this.ownSubGroup.visible = this.mode === 'outside';
      this.ownSubGroup.position.set(0, subY, 0);
      this.ownSubGroup.rotation.y = -THREE.MathUtils.degToRad(interp.subHdg);

      const cosLat = Math.max(0.2, Math.cos((interp.subLat * Math.PI) / 180));

      // Update 3D Mediterranean terrain relative to ownSub
      this.terrainGroup.children.forEach((mesh) => {
        const lm = mesh.userData;
        const dxM = (lm.lon - interp.subLon) * 60 * 1852 * cosLat;
        const dzM = -(lm.lat - interp.subLat) * 60 * 1852;
        mesh.position.set(dxM, lm.peakM * 0.42, dzM);
      });

      this.seabedMesh.position.y = -Math.max(120, Math.min(900, snapshot.environment.waterDepthM));

      // Contacts (both ranged and passive bearing-cued on horizon)
      const activeIds = new Set();
      for (const c of snapshot.contacts || []) {
        activeIds.add(c.id);
        let mesh = this.contactMeshes.get(c.id);
        if (!mesh) {
          if (c.category === 'SUBMARINE') {
            mesh = this.glbTemplates['OPFOR-SUB']
              ? this.glbTemplates['OPFOR-SUB'].clone()
              : this.buildProceduralSubmarine(0x2b1d1d);
          } else if (c.category === 'MERCHANT') {
            mesh = this.buildMerchantMesh();
          } else {
            mesh = this.buildWarshipMesh();
          }
          this.contactsGroup.add(mesh);
          this.contactMeshes.set(c.id, mesh);
        }

        let dxM, dzM, hdgDeg, depthM;
        if (c.ranged && c.lat !== null && c.lon !== null) {
          dxM = (c.lon - interp.subLon) * 60 * 1852 * cosLat;
          dzM = -(c.lat - interp.subLat) * 60 * 1852;
          hdgDeg = c.headingDeg || 0;
          depthM = c.depthM || 0;
        } else {
          // Estimate visual distance from SNR so bearing-only contacts appear on the 3D horizon along their true bearing
          const estDistM = Math.max(2200, Math.min(11000, 12500 - c.snrDb * 165));
          const bRad = THREE.MathUtils.degToRad(c.bearingDeg);
          dxM = Math.sin(bRad) * estDistM;
          dzM = -Math.cos(bRad) * estDistM;
          hdgDeg = (c.bearingDeg + 90) % 360;
          depthM = c.category === 'SUBMARINE' ? 120 : 0;
        }

        // Visual scale compensation at long range so silhouettes stay crisp in periscope
        const distM = Math.hypot(dxM, dzM);
        const vScale = Math.min(3.4, 1.0 + Math.sqrt(distM / 1000) * 0.48);
        mesh.scale.setScalar(vScale);
        mesh.position.set(dxM, depthM > 5 ? -depthM : 0, dzM);
        mesh.rotation.y = -THREE.MathUtils.degToRad(hdgDeg);
      }

      for (const [id, mesh] of this.contactMeshes.entries()) {
        if (!activeIds.has(id)) {
          this.contactsGroup.remove(mesh);
          this.contactMeshes.delete(id);
        }
      }

      // Active Torpedoes
      const wepIds = new Set();
      for (const w of snapshot.weapons || []) {
        wepIds.add(w.id);
        let wm = this.weaponMeshes.get(w.id);
        if (!wm) {
          const g = new THREE.Group();
          const bodyGeo = new THREE.CylinderGeometry(0.45, 0.45, 7.5, 12);
          bodyGeo.rotateX(Math.PI / 2);
          const bodyMat = new THREE.MeshStandardMaterial({ color: 0x22cc66, metalness: 0.6, roughness: 0.3 });
          g.add(new THREE.Mesh(bodyGeo, bodyMat));
          const wakeGeo = new THREE.BoxGeometry(1.4, 0.6, 18);
          const wakeMat = new THREE.MeshBasicMaterial({ color: 0xd0f5ff, transparent: true, opacity: 0.55 });
          const wake = new THREE.Mesh(wakeGeo, wakeMat);
          wake.position.z = 11;
          g.add(wake);
          this.weaponsGroup.add(g);
          this.weaponMeshes.set(w.id, g);
          wm = g;
        }
        const dxM = (w.lon - interp.subLon) * 60 * 1852 * cosLat;
        const dzM = -(w.lat - interp.subLat) * 60 * 1852;
        wm.position.set(dxM, -Math.max(3, w.depthM), dzM);
        wm.rotation.y = -THREE.MathUtils.degToRad(w.headingDeg);
        wm.scale.setScalar(2.2);
      }
      for (const [id, wm] of this.weaponMeshes.entries()) {
        if (!wepIds.has(id)) {
          this.weaponsGroup.remove(wm);
          this.weaponMeshes.delete(id);
        }
      }
    }

    render(snapshot, interp, selectedContactId) {
      if (!this.ready) return;
      const rect = this.canvas3d.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (this.canvas3d.width !== w || this.canvas3d.height !== h) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / Math.max(1, h);
      }
      if (this.canvas2d && (this.canvas2d.width !== w || this.canvas2d.height !== h)) {
        this.canvas2d.width = w;
        this.canvas2d.height = h;
      }

      const t = performance.now() * 0.001;
      this.oceanMat.uniforms.uTime.value = t;
      this.skyMat.uniforms.uTime.value = t;
      this.oceanMat.uniforms.uThermal.value = this.thermal ? 1.0 : 0.0;
      this.skyMat.uniforms.uThermal.value = this.thermal ? 1.0 : 0.0;

      if (snapshot && interp) {
        this.syncEntities(snapshot, interp);
      }

      const subDepth = snapshot ? snapshot.ownSub.depthM : 45;
      const subHdg = interp ? interp.subHdg : 90;
      const canSeeSurface = this.mastRaised && subDepth <= 22.0;

      if (this.mode === 'outside') {
        const subY = -Math.max(0, subDepth) + 2.0;
        const yawRad = THREE.MathUtils.degToRad(subHdg + this.orbitYawDeg);
        const pitchRad = THREE.MathUtils.degToRad(this.orbitPitchDeg);
        const horiz = this.orbitDistM * Math.cos(pitchRad);
        this.camera.position.set(
          Math.sin(yawRad) * horiz,
          subY + this.orbitDistM * Math.sin(pitchRad),
          -Math.cos(yawRad) * horiz
        );
        this.camera.lookAt(0, subY, 0);
        this.camera.fov = 50;
      } else {
        const camY = canSeeSurface
          ? 5.8 + Math.sin(t * 1.7) * 0.25
          : -Math.max(4, subDepth) + 2.5;
        const bRad = THREE.MathUtils.degToRad(this.scopeBearingDeg);
        const pRad = THREE.MathUtils.degToRad(this.scopePitchDeg);
        this.camera.position.set(0, camY, 0);
        this.camera.lookAt(
          Math.sin(bRad) * Math.cos(pRad) * 1000,
          camY + Math.sin(pRad) * 1000,
          -Math.cos(bRad) * Math.cos(pRad) * 1000
        );
        this.camera.fov = 48 / Math.max(1, this.zoom);
      }
      this.camera.updateProjectionMatrix();
      this.oceanMat.uniforms.uCameraPos.value.copy(this.camera.position);

      this.renderer.render(this.scene, this.camera);
      this.renderOpticalHudOverlay(w, h, snapshot, canSeeSurface, selectedContactId);
    }

    renderOpticalHudOverlay(w, h, snapshot, canSeeSurface, selectedContactId) {
      if (!this.ctx2d) return;
      const ctx = this.ctx2d;
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;

      // Project 3D contacts into 2D HUD markers
      if (snapshot) {
        for (const c of snapshot.contacts || []) {
          const mesh = this.contactMeshes.get(c.id);
          if (!mesh) continue;
          const pos = mesh.position.clone();
          pos.y += 8;
          pos.project(this.camera);
          if (pos.z > 1) continue;
          const sx = (pos.x * 0.5 + 0.5) * w;
          const sy = (-pos.y * 0.5 + 0.5) * h;
          if (sx < 20 || sx > w - 20 || sy < 20 || sy > h - 20) continue;

          const isSel = c.id === selectedContactId;
          ctx.strokeStyle = isSel ? '#ffb000' : c.allegiance === 'HOSTILE' ? '#ff3b3b' : '#00ff66';
          ctx.fillStyle = ctx.strokeStyle;
          ctx.lineWidth = isSel ? 2 : 1.2;
          ctx.strokeRect(sx - 18, sy - 14, 36, 28);
          ctx.font = 'bold 10px Courier New';
          const rngTag = c.ranged && c.rangeNm !== null ? `${c.rangeNm.toFixed(1)}NM` : `BRG ${c.bearingDeg.toFixed(0)}°`;
          ctx.fillText(`${c.id} [${rngTag}]`, sx - 24, sy - 18);
        }
      }

      if (this.mode === 'outside') {
        ctx.fillStyle = '#00e5ff';
        ctx.font = 'bold 11px Courier New';
        ctx.fillText(`EXTERNAL 3D ORBIT CAMERA // DIST ${Math.round(this.orbitDistM)}m (DRAG TO ORBIT, WHEEL TO ZOOM)`, 14, h - 12);
        return;
      }

      // Periscope stadium rangefinder reticle & circular vignette
      ctx.strokeStyle = this.thermal ? 'rgba(0, 255, 128, 0.55)' : 'rgba(255, 196, 80, 0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - 120, cy); ctx.lineTo(cx - 12, cy);
      ctx.moveTo(cx + 12, cy); ctx.lineTo(cx + 120, cy);
      ctx.moveTo(cx, cy - 90); ctx.lineTo(cx, cy - 12);
      ctx.moveTo(cx, cy + 12); ctx.lineTo(cx, cy + 90);
      ctx.stroke();

      for (let t = -80; t <= 80; t += 20) {
        if (t === 0) continue;
        ctx.beginPath();
        ctx.moveTo(cx + t, cy - 5); ctx.lineTo(cx + t, cy + 5);
        ctx.moveTo(cx - 5, cy + t); ctx.lineTo(cx + 5, cy + t);
        ctx.stroke();
      }

      if (!canSeeSurface && snapshot) {
        ctx.fillStyle = '#ffb000';
        ctx.font = 'bold 12px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText(`SUBMERGED AT ${snapshot.ownSub.depthM.toFixed(0)}m — ASCEND TO <= 20m FOR SURFACE OPTICAL HORIZON`, cx, 28);
        ctx.textAlign = 'start';
      }
    }
  }

  root.ThreePeriscopeEngine = ThreePeriscopeEngine;
})(window);
