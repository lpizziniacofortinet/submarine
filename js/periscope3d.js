/**
 * ============================================================================
 * REAL-TIME 3D WEBGL PERISCOPE & EXTERNAL SUBMARINE ENVIRONMENT (ENHANCED)
 * Pure WebGL 1 (zero external engines).
 * Features:
 * - True Right-Handed Geographic Coordinate System (+X East, +Y Up, -Z North)
 * - High-Resolution 360° Polar Terrain (144 azimuths × 28 rings) with Smooth
 *   Phong Vertex Normals, Live 2D Copernicus DEM Elevation Grid + FBM Ridges,
 *   and Underwater Bathymetry Seabed
 * - Live Real-World Satellite Imagery Texture Atlas (ESRI World Imagery tiles)
 *   draped onto 3D Mediterranean coastlines + procedural cliff/rock/vegetation
 *   detail shader
 * - Camera-Centered Radial LOD Ocean Surface (2.5m to 55km) with Multi-Wave
 *   Gerstner Swells, Per-Pixel Capillary Wave Normals, Schlick Fresnel Sky
 *   Reflection, Solar Specular Glitter Path, and Whitecap Foam
 * - Distance-Compensated 3D Ships, Submarines, Kelvin Wakes, Whales,
 *   Torpedoes, Missiles, and NATO Naval Base Harbors
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
    'varying vec3 vWorldPos;',
    'varying float vDistance;',
    'void main() {',
    '  vec4 worldPosition = vec4(aPosition, 1.0);',
    '  gl_Position = uViewProjection * worldPosition;',
    '  vColor = aColor;',
    '  vNormal = normalize(aNormal);',
    '  vWorldPos = aPosition;',
    '  vDistance = distance(aPosition, uCameraPosition);',
    '}'
  ].join('\n');

  const FRAGMENT_SHADER = [
    'precision highp float;',
    'uniform vec3 uLightDirection;',
    'uniform vec3 uCameraPosition;',
    'uniform vec3 uFogColor;',
    'uniform vec3 uSkyZenithColor;',
    'uniform vec3 uSkyHorizonColor;',
    'uniform float uFogNear;',
    'uniform float uFogFar;',
    'uniform float uAlpha;',
    'uniform float uThermal;',
    'uniform float uTime;',
    'uniform float uCloudCover;',
    'uniform float uRainIntensity;',
    'uniform float uDaylight;',
    'uniform float uStormFlash;',
    'uniform vec2 uWindVector;',
    'uniform int uMaterialType;', // 0 = Vessel/Object, 1 = Ocean Water, 2 = Land Terrain, 3 = Seabed, 4 = 3D Sky Dome
    'uniform sampler2D uSatelliteTex;',
    'uniform float uSatLoaded;',
    'uniform vec4 uSatBoundsMeters;', // [minEastM, minNorthM, maxEastM, maxNorthM]
    'varying vec3 vColor;',
    'varying vec3 vNormal;',
    'varying vec3 vWorldPos;',
    'varying float vDistance;',
    '',
    '// Fast procedural hash & 2D value noise for rock/cliff/water micro-detail',
    'float hash21(vec2 p) {',
    '  p = fract(p * vec2(123.34, 456.21));',
    '  p += dot(p, p + 45.32);',
    '  return fract(p.x * p.y);',
    '}',
    'float noise2D(vec2 p) {',
    '  vec2 i = floor(p);',
    '  vec2 f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  float a = hash21(i);',
    '  float b = hash21(i + vec2(1.0, 0.0));',
    '  float c = hash21(i + vec2(0.0, 1.0));',
    '  float d = hash21(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
    '}',
    'float fbm2D(vec2 p) {',
    '  float v = 0.0;',
    '  v += 0.50 * noise2D(p); p *= 2.03;',
    '  v += 0.25 * noise2D(p); p *= 2.01;',
    '  v += 0.125 * noise2D(p); p *= 2.02;',
    '  v += 0.0625 * noise2D(p);',
    '  return v;',
    '}',
    '',
    'void main() {',
    '  vec3 L = normalize(uLightDirection);',
    '  vec3 V = normalize(uCameraPosition - vWorldPos);',
    '  vec3 N = normalize(vNormal);',
    '  vec3 lit = vColor;',
    '',
    '  if (uMaterialType == 4) {',
    '    // ---- 3D ATMOSPHERIC SKY DOME (Rayleigh/Mie Scattering, Sun Disc, FBM Clouds & Stars) ----',
    '    vec3 dir = normalize(vWorldPos - uCameraPosition);',
    '    float elev = clamp(dir.y, 0.0, 1.0);',
    '    vec3 skyCol = mix(uSkyHorizonColor, uSkyZenithColor, pow(elev, 0.52));',
    '',
    '    // Solar disc & Mie scattering corona',
    '    float sunDot = max(dot(dir, L), 0.0);',
    '    float sunAtten = (1.0 - uCloudCover * 0.85) * smoothstep(0.05, 0.45, uDaylight);',
    '    float mieGlow = pow(sunDot, 10.0) * 0.38 * sunAtten;',
    '    float sunCore = smoothstep(0.99935, 0.99975, sunDot) * 2.2 * sunAtten;',
    '    float sunHalo = pow(sunDot, 96.0) * 0.75 * sunAtten;',
    '    vec3 sunTint = mix(vec3(1.0, 0.65, 0.35), vec3(1.0, 0.96, 0.86), clamp(L.y * 2.5, 0.0, 1.0));',
    '    skyCol += sunTint * (mieGlow + sunHalo + sunCore);',
    '',
    '    // Night stars visible when daylight is low and sky is clear',
    '    if (uDaylight < 0.35 && elev > 0.06) {',
    '      float starField = hash21(floor(dir.xz / max(0.08, elev) * 190.0));',
    '      float starMask = smoothstep(0.9965, 0.9995, starField) * (1.0 - uCloudCover * 0.92) * smoothstep(0.35, 0.10, uDaylight);',
    '      skyCol += vec3(0.85, 0.92, 1.0) * starMask * 1.1;',
    '    }',
    '',
    '    // Procedural Animated Volumetric-Style Cloud Deck',
    '    if (elev > 0.012 && uCloudCover > 0.04) {',
    '      vec2 cloudPlane = dir.xz / max(0.085, elev + 0.06);',
    '      vec2 windShift = uWindVector * (uTime * 0.035);',
    '      float c1 = fbm2D(cloudPlane * 0.42 + windShift);',
    '      float c2 = fbm2D(cloudPlane * 1.05 - windShift * 0.45 + vec2(3.1, 7.4));',
    '      float density = c1 * 0.72 + c2 * 0.28;',
    '      float threshold = mix(0.76, 0.24, uCloudCover);',
    '      float cloudAlpha = smoothstep(threshold, threshold + 0.26, density) * smoothstep(0.012, 0.14, elev);',
    '',
    '      // Cloud lighting: silver sunlit tops vs dark storm bases',
    '      vec3 cloudLit = mix(vec3(0.92, 0.94, 0.97), vec3(0.99, 0.88, 0.75), mieGlow * 1.2) * (0.35 + 0.65 * uDaylight);',
    '      vec3 cloudShadow = mix(vec3(0.45, 0.52, 0.58), vec3(0.16, 0.19, 0.23), clamp(uCloudCover * 0.7 + uRainIntensity * 0.4, 0.0, 1.0)) * (0.35 + 0.65 * uDaylight);',
    '      float shadeFactor = clamp((c2 - 0.3) * 1.6 + sunDot * 0.35, 0.0, 1.0);',
    '      vec3 cloudCol = mix(cloudShadow, cloudLit, shadeFactor);',
    '      // Distant thunderstorm lightning glow inside clouds',
    '      cloudCol += vec3(0.78, 0.86, 1.0) * uStormFlash * (1.0 - shadeFactor * 0.5);',
    '      skyCol = mix(skyCol, cloudCol, clamp(cloudAlpha * (0.78 + uCloudCover * 0.22), 0.0, 0.96));',
    '    }',
    '',
    '    if (uThermal > 0.5) {',
    '      float luma = dot(skyCol, vec3(0.299, 0.587, 0.114));',
    '      skyCol = vec3(luma * 0.85, luma * 0.92, luma * 0.85);',
    '    }',
    '    gl_FragColor = vec4(skyCol, 1.0);',
    '    return;',
    '  }',
    '',
    '  if (uMaterialType == 1) {',
    '    // ---- OCEAN SURFACE SHADER (Per-Pixel Wave Normals, Fresnel, Sun Glitter & Whitecaps) ----',
    '    vec2 wp = vWorldPos.xz;',
    '    float distAtten = clamp(1.0 - vDistance / 18000.0, 0.08, 1.0);',
    '    float w1 = sin(wp.x * 0.19 + wp.y * 0.11 + uTime * 2.1);',
    '    float w2 = cos(wp.x * 0.07 - wp.y * 0.23 - uTime * 1.65);',
    '    float w3 = sin((wp.x - wp.y) * 0.43 + uTime * 3.1);',
    '    float w4 = (noise2D(wp * 0.08 + vec2(uTime * 0.45, -uTime * 0.35)) - 0.5) * 2.0;',
    '    vec3 detailN = vec3(',
    '      (w1 * 0.038 + w2 * 0.028 + w3 * 0.018 + w4 * 0.032) * distAtten,',
    '      1.0,',
    '      (w1 * 0.024 - w2 * 0.042 - w3 * 0.019 + w4 * 0.032) * distAtten',
    '    );',
    '    N = normalize(vec3(N.x + detailN.x, N.y, N.z + detailN.z));',
    '',
    '    // Schlick Fresnel reflection between deep Mediterranean water and sky dome',
    '    float NoV = max(dot(N, V), 0.02);',
    '    float fresnel = clamp(0.04 + 0.92 * pow(1.0 - NoV, 4.2), 0.0, 0.94);',
    '    vec3 R = reflect(-V, N);',
    '    float skyGrad = clamp(R.y * 2.2, 0.0, 1.0);',
    '    vec3 reflectedSky = mix(uSkyHorizonColor, uSkyZenithColor, skyGrad);',
    '',
    '    // Deep sea color + subsurface turquoise scatter in wave crests',
    '    float crest = clamp((vWorldPos.y + 0.8) * 0.42, 0.0, 1.0);',
    '    vec3 deepSea = vec3(0.022, 0.145, 0.235);',
    '    vec3 shallowCrest = vec3(0.065, 0.33, 0.42);',
    '    vec3 waterBody = mix(deepSea, shallowCrest, crest * 0.72);',
    '    lit = mix(waterBody, reflectedSky, fresnel);',
    '',
    '    // Solar specular glitter path across wave facets',
    '    vec3 H = normalize(L + V);',
    '    float specCore = pow(max(dot(N, H), 0.0), 160.0);',
    '    float specShimmer = pow(max(dot(N, H), 0.0), 28.0) * 0.22;',
    '    lit += vec3(1.0, 0.93, 0.78) * (specCore * 1.45 + specShimmer);',
    '',
    '    // Whitecap foam on steep wave crests',
    '    float foamNoise = fbm2D(wp * 0.045 + vec2(uTime * 0.12, uTime * 0.08));',
    '    float whitecap = smoothstep(0.72, 1.28, vWorldPos.y + foamNoise * 0.65) * distAtten;',
    '    lit = mix(lit, vec3(0.86, 0.93, 0.95), clamp(whitecap * 0.65, 0.0, 0.75));',
    '',
    '  } else if (uMaterialType == 2) {',
    '    // ---- REAL-WORLD SATELLITE + PROCEDURAL DETAIL TERRAIN SHADER ----',
    '    vec2 wp = vWorldPos.xz;',
    '    float rockNoise = fbm2D(wp * 0.0035);',
    '    float detailNoise = fbm2D(wp * 0.028);',
    '    float strata = sin(vWorldPos.y * 0.14 + rockNoise * 6.0) * 0.5 + 0.5;',
    '',
    '    // Perturb terrain normal with procedural rock/ridge micro-bump',
    '    vec3 bump = vec3((detailNoise - 0.5) * 0.22, 0.0, (rockNoise - 0.5) * 0.22);',
    '    N = normalize(N + bump);',
    '',
    '    // Base procedural Mediterranean biome palette (beach -> maquis scrub -> limestone cliff -> alpine peak)',
    '    float slope = 1.0 - clamp(N.y, 0.0, 1.0);',
    '    vec3 beachSand = vec3(0.72, 0.65, 0.49);',
    '    vec3 maquisGreen = mix(vec3(0.24, 0.34, 0.19), vec3(0.38, 0.44, 0.27), rockNoise);',
    '    vec3 limestoneCliff = mix(vec3(0.52, 0.49, 0.43), vec3(0.66, 0.62, 0.55), strata);',
    '    vec3 highPeak = mix(vec3(0.56, 0.55, 0.53), vec3(0.84, 0.85, 0.87), smoothstep(420.0, 780.0, vWorldPos.y));',
    '',
    '    vec3 procColor = mix(maquisGreen, limestoneCliff, smoothstep(0.22, 0.58, slope));',
    '    procColor = mix(beachSand, procColor, smoothstep(2.0, 22.0, vWorldPos.y));',
    '    procColor = mix(procColor, highPeak, smoothstep(260.0, 520.0, vWorldPos.y));',
    '    procColor *= (0.82 + 0.36 * detailNoise);',
    '',
    '    // Sample live ESRI World Imagery Satellite Texture if loaded and within bounds',
    '    if (uSatLoaded > 0.5) {',
    '      float eastM = vWorldPos.x;',
    '      float northM = -vWorldPos.z;',
    '      vec2 uv = vec2(',
    '        (eastM - uSatBoundsMeters.x) / max(1.0, uSatBoundsMeters.z - uSatBoundsMeters.x),',
    '        (uSatBoundsMeters.w - northM) / max(1.0, uSatBoundsMeters.w - uSatBoundsMeters.y)',
    '      );',
    '      if (uv.x >= 0.01 && uv.x <= 0.99 && uv.y >= 0.01 && uv.y <= 0.99) {',
    '        vec3 satCol = texture2D(uSatelliteTex, uv).rgb;',
    '        // Enhance satellite contrast & blend with procedural cliff/rock detail',
    '        satCol = pow(satCol * 1.12, vec3(1.08));',
    '        procColor = mix(procColor, satCol * (0.80 + 0.40 * detailNoise), 0.68);',
    '        // Keep steep cliffs rocky',
    '        procColor = mix(procColor, limestoneCliff, smoothstep(0.45, 0.78, slope) * 0.55);',
    '      }',
    '    }',
    '',
    '    // Wet dark shoreline band & white surf line near y = 0..4m',
    '    float surfBand = smoothstep(4.5, 0.2, abs(vWorldPos.y - 1.2));',
    '    procColor = mix(procColor, vec3(0.82, 0.88, 0.90), surfBand * 0.45);',
    '',
    '    float diffuse = max(dot(N, L), 0.0);',
    '    float hemi = 0.5 + 0.5 * N.y;',
    '    lit = procColor * (0.32 + hemi * 0.24 + diffuse * 0.62);',
    '',
    '  } else {',
    '    // ---- VESSEL, SUBMARINE & SEABED SHADER ----',
    '    float diffuse = max(dot(N, L), 0.0);',
    '    float hemi = 0.5 + 0.5 * N.y;',
    '    lit = vColor * (0.38 + hemi * 0.24 + diffuse * 0.52);',
    '  }',
    '',
    '  // FLIR White-Hot Thermal Sensor Post-Process',
    '  if (uThermal > 0.5) {',
    '    float luma = dot(lit, vec3(0.299, 0.587, 0.114));',
    '    float heatBoost = (uMaterialType == 0 && vWorldPos.y > -2.0) ? 0.26 : (uMaterialType == 2 ? 0.08 : -0.05);',
    '    float heat = clamp(luma * 1.28 + heatBoost, 0.04, 1.0);',
    '    lit = vec3(heat * 0.90, heat * 0.98, heat * 0.88);',
    '  }',
    '',
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

  function addSmoothTriangle(out, a, b, c, normA, normB, normC, colorA, colorB, colorC) {
    const verts = [a, b, c];
    const norms = [normA, normB, normC];
    const cols = [colorA, colorB, colorC];
    for (let i = 0; i < 3; i++) {
      out.push(verts[i][0], verts[i][1], verts[i][2]);
      out.push(cols[i][0], cols[i][1], cols[i][2]);
      out.push(norms[i][0], norms[i][1], norms[i][2]);
    }
  }

  function addQuad(out, a, b, c, d, color) {
    addTriangle(out, a, b, c, color, color, color);
    addTriangle(out, a, c, d, color, color, color);
  }

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
   * Multi-Octave Fractional Brownian Motion (FBM) for realistic Mediterranean mountain ridges
   */
  function terrainRidgeFBM(lat, lon) {
    let x = lon * 55.0;
    let y = lat * 55.0;
    let val = 0.0;
    let amp = 0.5;
    for (let i = 0; i < 4; i++) {
      const s = Math.sin(x * 1.7 + y * 1.1) * Math.cos(x * 0.9 - y * 1.6);
      // Ridged multifractal crease
      val += (1.0 - Math.abs(s)) * amp;
      x = x * 2.13 + 17.4;
      y = y * 2.07 - 11.8;
      amp *= 0.5;
    }
    return val;
  }

  /**
   * 3D Gerstner / Trochoidal Wave Surface Evaluator scaled by real wind speed (kts)
   */
  function evaluateSeaWave(x, z, t, windSpeedKts = 8) {
    const seaScale = clamp(0.35 + (windSpeedKts / 12.0) * 0.75, 0.25, 2.45);
    const p1 = x * 0.018 + z * 0.011 + t * 1.35;
    const p2 = -x * 0.012 + z * 0.022 + t * 1.05;
    const p3 = x * 0.039 - z * 0.031 + t * 1.95;
    const p4 = (x + z) * 0.075 - t * 2.65;

    const y = (
      0.58 * Math.sin(p1) +
      0.42 * Math.sin(p2) +
      0.24 * Math.sin(p3) +
      0.12 * Math.sin(p4)
    ) * seaScale;

    const dydx = (
      0.58 * 0.018 * Math.cos(p1) -
      0.42 * 0.012 * Math.cos(p2) +
      0.24 * 0.039 * Math.cos(p3) +
      0.12 * 0.075 * Math.cos(p4)
    ) * seaScale;
    const dydz = (
      0.58 * 0.011 * Math.cos(p1) +
      0.42 * 0.022 * Math.cos(p2) -
      0.24 * 0.031 * Math.cos(p3) +
      0.12 * 0.075 * Math.cos(p4)
    ) * seaScale;

    return {
      y,
      normal: normalize([-dydx * 2.4, 1.0, -dydz * 2.4])
    };
  }

  function addVessel(out, x, y, z, headingDeg, length, beam, heightScale, kind, tint, speedKts = 10) {
    const yaw = radians(headingDeg);
    const pt = (lx, ly, lz) => localToWorld(x, y, z, lx, ly, lz, yaw);

    if (kind === 'biologic') {
      const whaleColor = [0.14, 0.19, 0.22];
      addBox(out, x, y + 0.6, z, beam * 0.45, 2.2 * heightScale, length * 0.55, yaw, whaleColor);
      if (y >= -6) {
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
      const sailCenter = pt(0, freeboard + 3.4 * heightScale, length * 0.08);
      addBox(out, sailCenter[0], sailCenter[1], sailCenter[2], beam * 0.24, 6.2 * heightScale, length * 0.18, yaw, [0.18, 0.24, 0.27]);
      const planesCenter = pt(0, freeboard + 2.8 * heightScale, length * 0.10);
      addBox(out, planesCenter[0], planesCenter[1], planesCenter[2], beam * 0.72, 0.45 * heightScale, length * 0.04, yaw, [0.22, 0.28, 0.31]);
      const finCenter = pt(0, freeboard + 2.2 * heightScale, -length * 0.44);
      addBox(out, finCenter[0], finCenter[1], finCenter[2], beam * 0.08, 4.4 * heightScale, length * 0.07, yaw, [0.16, 0.22, 0.25]);
    } else if (kind === 'merchant') {
      const aftBridge = pt(0, freeboard + 5.5 * heightScale, -length * 0.28);
      addBox(out, aftBridge[0], aftBridge[1], aftBridge[2], beam * 0.72, 9.5 * heightScale, length * 0.14, yaw, [0.76, 0.79, 0.80]);
      const cargo1 = pt(0, freeboard + 3.2 * heightScale, length * 0.04);
      addBox(out, cargo1[0], cargo1[1], cargo1[2], beam * 0.78, 5.2 * heightScale, length * 0.36, yaw, [0.58, 0.28, 0.22]);
    } else {
      const bridge = pt(0, freeboard + 4.4 * heightScale, length * 0.06);
      addBox(out, bridge[0], bridge[1], bridge[2], beam * 0.62, 7.2 * heightScale, length * 0.22, yaw, [0.46, 0.52, 0.54]);
      const mast = pt(0, freeboard + 10.2 * heightScale, length * 0.08);
      addBox(out, mast[0], mast[1], mast[2], beam * 0.22, 6.8 * heightScale, length * 0.06, yaw, [0.35, 0.42, 0.45]);
      const aftHangar = pt(0, freeboard + 3.2 * heightScale, -length * 0.20);
      addBox(out, aftHangar[0], aftHangar[1], aftHangar[2], beam * 0.56, 5.0 * heightScale, length * 0.18, yaw, [0.40, 0.46, 0.48]);
      const gun = pt(0, freeboard + 1.8 * heightScale, length * 0.28);
      addBox(out, gun[0], gun[1], gun[2], beam * 0.26, 2.6 * heightScale, length * 0.06, yaw, [0.32, 0.38, 0.40]);
    }

    if (y >= -4 && speedKts > 1.5) {
      const wakeLen = clamp(length * (0.8 + speedKts * 0.08), 60, 480);
      const wakeColor = [0.82, 0.91, 0.94];
      const bowPt = pt(0, 0.85, length * 0.51);
      const portBowWake = pt(-beam * 1.15, 0.75, -length * 0.15);
      const stbdBowWake = pt(beam * 1.15, 0.75, -length * 0.15);
      addTriangle(out, bowPt, pt(-beam * 0.35, 0.8, length * 0.25), portBowWake, wakeColor, wakeColor, [0.25, 0.48, 0.55]);
      addTriangle(out, bowPt, stbdBowWake, pt(beam * 0.35, 0.8, length * 0.25), wakeColor, [0.25, 0.48, 0.55], wakeColor);

      const sternL = pt(-beam * 0.28, 0.75, -length * 0.48);
      const sternR = pt(beam * 0.28, 0.75, -length * 0.48);
      const wakeAftL = pt(-beam * 1.45, 0.65, -length * 0.50 - wakeLen);
      const wakeAftR = pt(beam * 1.45, 0.65, -length * 0.50 - wakeLen);
      addQuad(out, sternL, sternR, wakeAftR, wakeAftL, [0.62, 0.78, 0.82]);
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
      this.scopePitchDeg = 0.0;
      this.dragState = null;
      this.uniforms = {};
      this.attributes = {};

      // Live Satellite Imagery Texture Atlas State
      this.satelliteTex = null;
      this.satAtlasKey = '';
      this.satLoaded = false;
      this.satBoundsMeters = new Float32Array([-40000, -40000, 40000, 40000]);
      this.satOriginLatLon = null;

      // Projected 2D HUD markers & center LOS rangefinder output
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
        this.initSatelliteTexture();
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
        skyZenithColor: gl.getUniformLocation(this.program, 'uSkyZenithColor'),
        skyHorizonColor: gl.getUniformLocation(this.program, 'uSkyHorizonColor'),
        fogNear: gl.getUniformLocation(this.program, 'uFogNear'),
        fogFar: gl.getUniformLocation(this.program, 'uFogFar'),
        alpha: gl.getUniformLocation(this.program, 'uAlpha'),
        thermal: gl.getUniformLocation(this.program, 'uThermal'),
        time: gl.getUniformLocation(this.program, 'uTime'),
        cloudCover: gl.getUniformLocation(this.program, 'uCloudCover'),
        rainIntensity: gl.getUniformLocation(this.program, 'uRainIntensity'),
        daylight: gl.getUniformLocation(this.program, 'uDaylight'),
        stormFlash: gl.getUniformLocation(this.program, 'uStormFlash'),
        windVector: gl.getUniformLocation(this.program, 'uWindVector'),
        materialType: gl.getUniformLocation(this.program, 'uMaterialType'),
        satelliteTex: gl.getUniformLocation(this.program, 'uSatelliteTex'),
        satLoaded: gl.getUniformLocation(this.program, 'uSatLoaded'),
        satBoundsMeters: gl.getUniformLocation(this.program, 'uSatBoundsMeters')
      };
      this.buffer = gl.createBuffer();
    }

    initSatelliteTexture() {
      const gl = this.gl;
      this.satelliteTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.satelliteTex);
      // 1x1 placeholder pixel until satellite tile atlas loads
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([92, 108, 74, 255])
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    /**
     * Dynamically fetches a 3×3 grid of real-world ESRI World Imagery satellite tiles
     * around the submarine's current coordinates and uploads the composite atlas to WebGL.
     */
    updateSatelliteAtlas(sub) {
      const zoom = 10;
      const n = Math.pow(2, zoom);
      const centerTileX = Math.floor(((sub.lon + 180) / 360) * n);
      const latRad = radians(sub.lat);
      const centerTileY = Math.floor(
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
      );
      const key = `${zoom}:${centerTileX}:${centerTileY}`;

      if (this.satAtlasKey === key) {
        // Recompute bounds in meters relative to current sub position
        if (this.satOriginLatLon) {
          const [minEast, maxNorthNeg] = this.geographicOffset(sub, this.satOriginLatLon.maxLat, this.satOriginLatLon.minLon);
          const [maxEast, minNorthNeg] = this.geographicOffset(sub, this.satOriginLatLon.minLat, this.satOriginLatLon.maxLon);
          this.satBoundsMeters[0] = minEast;
          this.satBoundsMeters[1] = -minNorthNeg;
          this.satBoundsMeters[2] = maxEast;
          this.satBoundsMeters[3] = -maxNorthNeg;
        }
        return;
      }

      this.satAtlasKey = key;
      const tileToLon = (tx) => (tx / n) * 360 - 180;
      const tileToLat = (ty) => {
        const a = Math.PI - (2 * Math.PI * ty) / n;
        return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(a) - Math.exp(-a)));
      };

      const minLon = tileToLon(centerTileX - 1);
      const maxLon = tileToLon(centerTileX + 2);
      const maxLat = tileToLat(centerTileY - 1);
      const minLat = tileToLat(centerTileY + 2);
      this.satOriginLatLon = { minLon, maxLon, minLat, maxLat };

      const atlasCanvas = document.createElement('canvas');
      atlasCanvas.width = 768;
      atlasCanvas.height = 768;
      const ctx = atlasCanvas.getContext('2d');
      let loadedCount = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = centerTileX + dx;
          const ty = centerTileY + dy;
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            if (this.satAtlasKey !== key || !this.gl) return;
            ctx.drawImage(img, (dx + 1) * 256, (dy + 1) * 256, 256, 256);
            loadedCount++;
            if (loadedCount >= 4) {
              const gl = this.gl;
              gl.bindTexture(gl.TEXTURE_2D, this.satelliteTex);
              gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
              this.satLoaded = true;
            }
          };
          img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
        }
      }
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

    geographicOffset(sub, lat, lon) {
      const eastMeters = (lon - sub.lon) * 111320 * Math.cos(radians(sub.lat));
      const northMeters = (lat - sub.lat) * 110574;
      return [eastMeters, -northMeters];
    }

    terrainKeyFor(sub, coastlineStatus) {
      return [sub.lat.toFixed(3), sub.lon.toFixed(3), coastlineStatus || 'IDLE'].join(':');
    }

    /**
     * Builds a High-Resolution 360° Polar Terrain Mesh (144 azimuths × 26 rings)
     * with Smooth Phong Vertex Normals, FBM Mountain Ridges, and Underwater Bathymetry.
     */
    buildPolarWorldMeshes(sub, coastlineProfile) {
      const landOut = makeMesh();
      const seabedOut = makeMesh();

      const azimuthSteps = 144; // 2.5° angular resolution around full 360° horizon
      const ringsKm = [
        0.06, 0.16, 0.32, 0.58, 0.95, 1.45, 2.1, 3.0, 4.1, 5.5,
        7.2, 9.3, 12.0, 15.2, 19.0, 23.5, 29.0, 35.5, 43.0, 52.0,
        62.0, 74.0, 88.0, 104.0
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

          const demSample = coastlineProfile && window.CoastlineModel
            ? window.CoastlineModel.sample(coastlineProfile, bearingDeg)
            : null;
          const demLandHere = Boolean(
            demSample &&
            demSample.hasLand &&
            demSample.rangeKm > 0.3 &&
            rKm >= demSample.rangeKm * 0.90 &&
            rKm <= Math.max(demSample.rangeKm * 2.1, demSample.rangeKm + 24)
          );

          const isLand = isLandMask || seafloorM === 0 || demLandHere;
          let y = 0;

          if (isLand) {
            let elevM = window.CoastlineModel && window.CoastlineModel.estimateFallbackElevation
              ? window.CoastlineModel.estimateFallbackElevation(pt.lat, pt.lon)
              : 115;
            if (demLandHere && demSample.elevationM > elevM) {
              // Smooth envelope peaking near the DEM horizon sample distance
              const distFromPeak = Math.abs(rKm - demSample.rangeKm);
              const env = Math.exp(-(distFromPeak * distFromPeak) / (2 * 64.0));
              elevM = Math.max(elevM, demSample.elevationM * (0.45 + 0.55 * env));
            }
            const fbm = terrainRidgeFBM(pt.lat, pt.lon);
            const detailedElev = elevM * (0.62 + 0.68 * fbm);
            const rawHeight = Math.max(3.5, detailedElev * 0.46 - curvatureDropM * 0.32);
            y = clamp(rawHeight, 3.0, 1250);
          } else {
            y = -clamp(seafloorM * 0.42, 10, 560);
          }

          row.push({ x, y, z, isLand, seafloorM, normal: [0, 1, 0] });
        }
        grid.push(row);
      }

      // Compute Smooth Phong Vertex Normals across the Polar Terrain Grid
      for (let ir = 1; ir < ringsKm.length - 1; ir++) {
        for (let ia = 0; ia < azimuthSteps; ia++) {
          const prevA = (ia - 1 + azimuthSteps) % azimuthSteps;
          const nextA = (ia + 1) % azimuthSteps;
          const nR1 = grid[ir - 1][ia];
          const nR2 = grid[ir + 1][ia];
          const nA1 = grid[ir][prevA];
          const nA2 = grid[ir][nextA];

          const vRad = [nR2.x - nR1.x, (nR2.y - nR1.y) * 1.6, nR2.z - nR1.z];
          const vTan = [nA2.x - nA1.x, (nA2.y - nA1.y) * 1.6, nA2.z - nA1.z];
          const n = normalize(cross(vTan, vRad));
          if (n[1] < 0) {
            n[0] = -n[0];
            n[1] = -n[1];
            n[2] = -n[2];
          }
          grid[ir][ia].normal = n;
        }
        grid[ir][azimuthSteps].normal = grid[ir][0].normal;
      }

      const dummyCol = [0.45, 0.48, 0.36];
      const seabedColor = (y) => {
        const d = Math.abs(y);
        if (d < 45) return [0.16, 0.38, 0.39];
        if (d < 160) return [0.09, 0.24, 0.30];
        return [0.05, 0.13, 0.19];
      };

      for (let ir = 0; ir < ringsKm.length - 1; ir++) {
        for (let ia = 0; ia < azimuthSteps; ia++) {
          const a = grid[ir][ia];
          const b = grid[ir][ia + 1];
          const c = grid[ir + 1][ia + 1];
          const d = grid[ir + 1][ia];

          // Seabed mesh
          const seaY = (n) => (n.isLand ? 1.5 : n.y);
          addSmoothTriangle(
            seabedOut,
            [a.x, seaY(a), a.z], [b.x, seaY(b), b.z], [c.x, seaY(c), c.z],
            a.normal, b.normal, c.normal,
            seabedColor(a.y), seabedColor(b.y), seabedColor(c.y)
          );
          addSmoothTriangle(
            seabedOut,
            [a.x, seaY(a), a.z], [c.x, seaY(c), c.z], [d.x, seaY(d), d.z],
            a.normal, c.normal, d.normal,
            seabedColor(a.y), seabedColor(c.y), seabedColor(d.y)
          );

          // Coastal & Mountain Land Mesh with Smooth Normals
          if (a.isLand || b.isLand || c.isLand) {
            const pa = [a.x, a.isLand ? a.y : -2.0, a.z];
            const pb = [b.x, b.isLand ? b.y : -2.0, b.z];
            const pc = [c.x, c.isLand ? c.y : -2.0, c.z];
            addSmoothTriangle(landOut, pa, pb, pc, a.normal, b.normal, c.normal, dummyCol, dummyCol, dummyCol);
          }
          if (a.isLand || c.isLand || d.isLand) {
            const pa = [a.x, a.isLand ? a.y : -2.0, a.z];
            const pc = [c.x, c.isLand ? c.y : -2.0, c.z];
            const pd = [d.x, d.isLand ? d.y : -2.0, d.z];
            addSmoothTriangle(landOut, pa, pc, pd, a.normal, c.normal, d.normal, dummyCol, dummyCol, dummyCol);
          }
        }
      }

      return {
        landMesh: new Float32Array(landOut),
        seabedMesh: new Float32Array(seabedOut)
      };
    }

    /**
     * Builds a 3D Sky Dome Hemisphere (radius 86,000m) for atmospheric scattering,
     * 3D sun disc, stars, and animated FBM clouds.
     */
    buildSkyDome() {
      const out = makeMesh();
      const radius = 86000;
      const azSteps = 48;
      const elSteps = 14;
      const grid = [];

      for (let ie = 0; ie <= elSteps; ie++) {
        // Extend slightly below horizon (-4°) so sea edge never gaps
        const elRad = radians(-4 + (94 * ie) / elSteps);
        const y = Math.sin(elRad) * radius;
        const rHoriz = Math.cos(elRad) * radius;
        const row = [];
        for (let ia = 0; ia <= azSteps; ia++) {
          const azRad = (ia / azSteps) * Math.PI * 2;
          row.push([Math.sin(azRad) * rHoriz, y, -Math.cos(azRad) * rHoriz]);
        }
        grid.push(row);
      }

      const dummyCol = [0.5, 0.7, 0.9];
      const dummyNorm = [0, 1, 0];
      for (let ie = 0; ie < elSteps; ie++) {
        for (let ia = 0; ia < azSteps; ia++) {
          const a = grid[ie][ia];
          const b = grid[ie][ia + 1];
          const c = grid[ie + 1][ia + 1];
          const d = grid[ie + 1][ia];
          addSmoothTriangle(out, a, b, c, dummyNorm, dummyNorm, dummyNorm, dummyCol, dummyCol, dummyCol);
          addSmoothTriangle(out, a, c, d, dummyNorm, dummyNorm, dummyNorm, dummyCol, dummyCol, dummyCol);
        }
      }
      return new Float32Array(out);
    }

    /**
     * Builds a Camera-Centered Radial LOD Ocean Mesh (from 2.5m to 52,000m)
     * with real 3D Trochoidal/Gerstner Wave Swells near the periscope lens.
     */
    buildWater(timeSeconds, windSpeedKts = 8) {
      const out = makeMesh();
      const azimuthSteps = 96;
      const ringsM = [
        0, 3, 7, 13, 22, 35, 52, 75, 108, 150, 210, 290, 400, 550,
        760, 1050, 1450, 2000, 2800, 3900, 5400, 7500, 10500,
        14500, 20000, 28000, 38000, 52000
      ];

      const grid = [];
      for (let ir = 0; ir < ringsM.length; ir++) {
        const r = ringsM[ir];
        // Dampen vertical displacement amplitude in the far distance to prevent horizon aliasing
        const swellAtten = clamp(1.0 - r / 12000, 0.05, 1.0);
        const row = [];

        for (let ia = 0; ia <= azimuthSteps; ia++) {
          const rad = ((ia % azimuthSteps) / azimuthSteps) * Math.PI * 2;
          const x = Math.sin(rad) * r;
          const z = -Math.cos(rad) * r;
          const w = evaluateSeaWave(x, z, timeSeconds, windSpeedKts);
          row.push({
            x,
            y: w.y * swellAtten,
            z,
            normal: [w.normal[0] * swellAtten, w.normal[1], w.normal[2] * swellAtten]
          });
        }
        grid.push(row);
      }

      const dummyCol = [0.06, 0.28, 0.38];
      for (let ir = 0; ir < ringsM.length - 1; ir++) {
        for (let ia = 0; ia < azimuthSteps; ia++) {
          const a = grid[ir][ia];
          const b = grid[ir][ia + 1];
          const c = grid[ir + 1][ia + 1];
          const d = grid[ir + 1][ia];

          addSmoothTriangle(
            out,
            [a.x, a.y, a.z], [b.x, b.y, b.z], [c.x, c.y, c.z],
            a.normal, b.normal, c.normal,
            dummyCol, dummyCol, dummyCol
          );
          addSmoothTriangle(
            out,
            [a.x, a.y, a.z], [c.x, c.y, c.z], [d.x, d.y, d.z],
            a.normal, c.normal, d.normal,
            dummyCol, dummyCol, dummyCol
          );
        }
      }
      return new Float32Array(out);
    }

    buildSceneObjects(world, timeSeconds) {
      const out = makeMesh();
      const sub = world.ownSub;

      if (this.mode === 'outside') {
        const subY = -Math.max(0, sub.depthM) + 4.5;
        addVessel(out, 0, subY, 0, sub.heading, 115, 10.4, 1.0, 'submarine', [0.13, 0.19, 0.22], sub.speedKts);

        if (sub.periscopeRaised && sub.depthM <= 20.5) {
          const mastTop = 5.5;
          const mastBottom = subY + 6.0;
          addBox(
            out, 0, (mastTop + mastBottom) / 2, 8, 0.35,
            Math.max(0.5, mastTop - mastBottom), 0.35, radians(sub.heading), [0.32, 0.39, 0.42]
          );
        }
      }

      if (window.NATO_BASES) {
        for (const base of window.NATO_BASES) {
          const [bx, bz] = this.geographicOffset(sub, base.lat, base.lon);
          const distM = Math.hypot(bx, bz);
          if (distM < 32000) {
            const s = clamp(1 + Math.sqrt(distM / 1000) * 0.4, 1, 3.2);
            addBox(out, bx, 6 * s, bz, 48 * s, 12 * s, 18 * s, 0, [0.52, 0.54, 0.50]);
            addBox(out, bx, 22 * s, bz, 8 * s, 28 * s, 8 * s, 0, [0.85, 0.85, 0.82]);
            addBox(out, bx, 38 * s, bz, 10 * s, 6 * s, 10 * s, 0, [0.98, 0.78, 0.22]);
          }
        }
      }

      const maxRangeMeters = this.mode === 'periscope' ? 28000 : 36000;
      for (const contact of world.contacts || []) {
        if (contact.sunk) continue;
        const [cx, cz] = this.geographicOffset(sub, contact.lat, contact.lon);
        const rangeM = Math.hypot(cx, cz);
        if (rangeM > maxRangeMeters) continue;

        const isSub = contact.profile && contact.profile.category === 'SUBMARINE';
        const isBio = contact.profile && contact.profile.category === 'BIOLOGIC';
        const isMerchant = contact.profile && contact.profile.category === 'MERCHANT';

        if (this.mode === 'periscope' && sub.periscopeRaised && contact.depthM > 16 && !isBio) continue;

        const rangeKm = rangeM / 1000;
        const visualScale = this.mode === 'periscope'
          ? clamp(1.0 + 0.68 * Math.sqrt(rangeKm), 1.0, 4.6)
          : clamp(1.0 + 0.35 * Math.sqrt(rangeKm), 1.0, 2.8);

        const baseLen = isBio ? 28 : isSub ? 106 : isMerchant ? 165 : 142;
        const baseBeam = isBio ? 7 : isSub ? 10 : isMerchant ? 24 : 18;
        // Surface vessels heave slightly with the local sea swell
        const waveAtShip = contact.depthM <= 5 ? evaluateSeaWave(cx, cz, timeSeconds).y * 0.45 : 0;
        const y = contact.depthM > 5 ? -contact.depthM + 4.0 : waveAtShip;

        let hullColor = [0.30, 0.36, 0.39];
        if (contact.profile) {
          if (contact.profile.allegiance === 'HOSTILE') hullColor = [0.22, 0.25, 0.28];
          else if (contact.profile.allegiance === 'FRIENDLY') hullColor = [0.24, 0.38, 0.44];
          else if (isMerchant) hullColor = [0.36, 0.24, 0.20];
        }

        const kind = isBio ? 'biologic' : isSub ? 'submarine' : isMerchant ? 'merchant' : 'surface';
        addVessel(
          out, cx, y, cz, contact.heading,
          baseLen * visualScale, baseBeam * visualScale, visualScale,
          kind, hullColor, contact.speedKts
        );
      }

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
          const plume = localToWorld(wx, wy, wz, 0, 0, -14 * wScale, wYaw);
          addBox(out, plume[0], plume[1], plume[2], 4.5 * wScale, 4.5 * wScale, 18 * wScale, wYaw, [0.98, 0.58, 0.16]);
        } else {
          const torpColor = wep.isPlayer ? [0.18, 0.78, 0.42] : [0.88, 0.24, 0.22];
          addBox(out, wx, wy, wz, 1.8 * wScale, 1.8 * wScale, 12 * wScale, wYaw, torpColor);
          const wake = localToWorld(wx, wy, wz, 0, 0, -16 * wScale, wYaw);
          addBox(out, wake[0], wake[1], wake[2], 3.2 * wScale, 2.0 * wScale, 22 * wScale, wYaw, [0.75, 0.88, 0.92]);
        }
      }

      return new Float32Array(out);
    }

    computeSceneProjections(world, stations, viewProjection, cssWidth, cssHeight) {
      const sub = world.ownSub;
      const markers = [];
      const scopeBearing = stations ? stations.scopeBearing : sub.heading;

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

      if (window.Bathymetry && Array.isArray(window.Bathymetry.features)) {
        for (const f of window.Bathymetry.features) {
          const rangeNm = window.Bathymetry.distanceNm(sub.lat, sub.lon, f.lat, f.lon);
          if (rangeNm > 38 || rangeNm < 0.3) continue;
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

      const coastlineProfile = stations && stations.coastlineModel ? stations.coastlineModel.profile : null;
      const centerRay = coastlineProfile && window.CoastlineModel
        ? window.CoastlineModel.sample(coastlineProfile, scopeBearing)
        : null;

      this.lastSceneMarkers = markers;
      this.lastCenterRayInfo = {
        bearing: scopeBearing,
        lockedContact: centerLockedContact,
        landRay: centerRay && centerRay.hasLand ? centerRay : null,
        horizonNm: 4.7,
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
      const sunDir = options.sunDirection || [-0.38, 0.78, 0.48];
      gl.uniform3f(this.uniforms.lightDirection, sunDir[0], sunDir[1], sunDir[2]);
      gl.uniform3f(this.uniforms.fogColor, options.fog[0], options.fog[1], options.fog[2]);
      gl.uniform3f(this.uniforms.skyZenithColor, options.skyZenith[0], options.skyZenith[1], options.skyZenith[2]);
      gl.uniform3f(this.uniforms.skyHorizonColor, options.skyHorizon[0], options.skyHorizon[1], options.skyHorizon[2]);
      gl.uniform1f(this.uniforms.fogNear, options.fogNear);
      gl.uniform1f(this.uniforms.fogFar, options.fogFar);
      gl.uniform1f(this.uniforms.alpha, options.alpha);
      gl.uniform1f(this.uniforms.thermal, options.thermal ? 1 : 0);
      gl.uniform1f(this.uniforms.time, options.time || 0);
      gl.uniform1f(this.uniforms.cloudCover, options.cloudCover !== undefined ? options.cloudCover : 0.2);
      gl.uniform1f(this.uniforms.rainIntensity, options.rainIntensity || 0);
      gl.uniform1f(this.uniforms.daylight, options.daylight !== undefined ? options.daylight : 0.9);
      gl.uniform1f(this.uniforms.stormFlash, options.stormFlash || 0);
      const windVec = options.windVector || [0.7, -0.7];
      gl.uniform2f(this.uniforms.windVector, windVec[0], windVec[1]);
      gl.uniform1i(this.uniforms.materialType, options.materialType || 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.satelliteTex);
      gl.uniform1i(this.uniforms.satelliteTex, 0);
      gl.uniform1f(this.uniforms.satLoaded, this.satLoaded ? 1.0 : 0.0);
      gl.uniform4fv(this.uniforms.satBoundsMeters, this.satBoundsMeters);

      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 9);
    }

    render(world, stations) {
      if (!this.ready || !world || !world.ownSub) return;
      const gl = this.gl;
      const sub = world.ownSub;
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      if (stations && stations.coastlineModel) {
        stations.coastlineModel.updatePosition(sub.lat, sub.lon);
      }
      this.updateSatelliteAtlas(sub);

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

      const simTime = world.simTimeSec || 0;
      const weather = (stations && stations.currentWeather) || {
        isLive: false,
        cloudCover: 0.2,
        windSpeedKts: 8.0,
        windDirDeg: 135,
        visibilityKm: 45.0,
        rainMm: 0.0,
        weatherCode: 0,
        isDay: 1
      };

      // Use real-world day/night if LIVE weather is active, otherwise use simulation clock
      const realNow = new Date();
      const utcHours = weather.isLive
        ? (realNow.getUTCHours() + realNow.getUTCMinutes() / 60 + sub.lon / 15.0 + 24) % 24
        : (simTime / 3600) % 24;

      const sunElAngle = ((utcHours - 6.0) / 12.0) * Math.PI;
      const sunY = Math.sin(sunElAngle);
      const sunAz = radians(105 + utcHours * 11.5);
      const sunDirection = normalize([
        Math.sin(sunAz) * Math.cos(Math.max(-0.2, sunElAngle)),
        Math.max(0.06, sunY),
        -Math.cos(sunAz) * Math.cos(Math.max(-0.2, sunElAngle))
      ]);

      let daylight = clamp(0.10 + 0.90 * Math.max(0, sunY), 0.08, 1.0);
      if (weather.isLive && weather.isDay === 0) {
        daylight = 0.09;
      }

      const cloudCover = clamp(weather.cloudCover || 0, 0, 1);
      const rainIntensity = clamp((weather.rainMm || 0) / 6.0, 0, 1);
      const windSpeedKts = weather.windSpeedKts || 8;
      const windRad = radians(weather.windDirDeg || 130);
      const windVector = [Math.sin(windRad), -Math.cos(windRad)];

      // Occasional distant lightning flash during thunderstorms (WMO >= 95)
      const isThunder = (weather.weatherCode || 0) >= 95;
      const stormFlash = isThunder && Math.sin(simTime * 3.7) * Math.sin(simTime * 11.3) > 0.94 ? 0.85 : 0.0;

      // Sky Zenith & Horizon colors blend smoothly from clear Mediterranean blue -> overcast grey -> storm slate -> night
      const clearZenith = [0.03 + daylight * 0.16, 0.08 + daylight * 0.36, 0.16 + daylight * 0.64];
      const clearHorizon = [0.14 + daylight * 0.54, 0.24 + daylight * 0.56, 0.32 + daylight * 0.52];
      const overcastZenith = [0.09 + daylight * 0.36, 0.11 + daylight * 0.39, 0.14 + daylight * 0.42];
      const overcastHorizon = [0.16 + daylight * 0.46, 0.19 + daylight * 0.48, 0.22 + daylight * 0.49];

      const overcastMix = clamp(cloudCover * 0.78 + rainIntensity * 0.35, 0, 1);
      const skyTop = clearZenith.map((v, i) => v * (1 - overcastMix) + overcastZenith[i] * overcastMix + stormFlash * 0.2);
      const skyBottom = clearHorizon.map((v, i) => v * (1 - overcastMix) + overcastHorizon[i] * overcastMix + stormFlash * 0.25);

      const raised = Boolean(sub.periscopeRaised && sub.depthM <= 20.5);
      const thermal = Boolean(stations && stations.scopeThermal);
      const zoom = stations && stations.scopeZoom ? stations.scopeZoom : 1.5;
      const visibilityKm = Math.max(2.5, Number(weather.visibilityKm) || 45);
      const fogNear = visibilityKm * 210;
      const fogFar = visibilityKm * 1350;

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
        const mastWaveHeave = raised ? evaluateSeaWave(0, 0, simTime * 0.55, windSpeedKts).y * 0.25 : 0;
        const pitchRad = radians((raised ? -0.5 : 12.0) + this.scopePitchDeg);
        const cameraY = raised ? 5.2 + mastWaveHeave : -Math.max(0, sub.depthM) + 2.5;
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
      const projection = perspective(fov, width / height, 1.0, 110000);
      const viewProjection = multiply(projection, view);
      this.lastViewProjection = viewProjection;

      const fog = thermal
        ? [0.62, 0.68, 0.65]
        : [skyBottom[0] * 0.94, skyBottom[1] * 0.95, skyBottom[2] * 0.96];

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.depthMask(true);

      if (!this.skyDomeCache) {
        this.skyDomeCache = this.buildSkyDome();
      }
      const terrainKey = this.terrainKeyFor(sub, coastlineStatus);
      if (!this.terrainCache || !this.seabedCache || terrainKey !== this.terrainKey) {
        const meshes = this.buildPolarWorldMeshes(sub, coastlineProfile);
        this.terrainCache = meshes.landMesh;
        this.seabedCache = meshes.seabedMesh;
        this.terrainKey = terrainKey;
      }

      const waveTime = simTime * 0.55;
      const objects = this.buildSceneObjects(world, waveTime);
      const water = this.buildWater(waveTime, windSpeedKts);

      const commonOpts = {
        fog,
        sunDirection,
        skyZenith: skyTop,
        skyHorizon: skyBottom,
        fogNear,
        fogFar,
        thermal,
        time: waveTime,
        cloudCover,
        rainIntensity,
        daylight,
        stormFlash,
        windVector
      };

      if (this.mode === 'periscope') {
        if (raised) {
          gl.depthMask(false);
          this.draw(this.skyDomeCache, viewProjection, eye, {
            ...commonOpts, alpha: 1, materialType: 4
          });
          gl.depthMask(true);
        } else {
          this.draw(this.seabedCache, viewProjection, eye, {
            ...commonOpts, fog: [0.04, 0.14, 0.20], fogNear: 200, fogFar: 12000, alpha: 1, materialType: 3
          });
        }
        this.draw(water, viewProjection, eye, {
          ...commonOpts, alpha: raised ? 0.98 : 0.45, materialType: 1
        });
        this.draw(this.terrainCache, viewProjection, eye, {
          ...commonOpts, alpha: 1, materialType: 2
        });
        this.draw(objects, viewProjection, eye, {
          ...commonOpts, alpha: 1, materialType: 0
        });
      } else {
        gl.depthMask(false);
        this.draw(this.skyDomeCache, viewProjection, eye, {
          ...commonOpts, alpha: 1, thermal: false, materialType: 4
        });
        gl.depthMask(true);

        this.draw(this.seabedCache, viewProjection, eye, {
          ...commonOpts, fog: [0.06, 0.20, 0.28], fogNear: 400, fogFar: 28000, alpha: 1, thermal: false, materialType: 3
        });
        this.draw(this.terrainCache, viewProjection, eye, {
          ...commonOpts, alpha: 1, thermal: false, materialType: 2
        });
        this.draw(objects, viewProjection, eye, {
          ...commonOpts, alpha: 1, thermal: false, materialType: 0
        });
        gl.depthMask(false);
        this.draw(water, viewProjection, eye, {
          ...commonOpts, alpha: 0.58, thermal: false, materialType: 1
        });
        gl.depthMask(true);
      }

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
        const satBadge = this.satLoaded ? ' + ESRI SATELLITE TEX' : '';
        if (this.mode === 'outside') {
          scopeStatus.textContent = `3D WORLD: SEABED ${world.currentSeafloorM || '--'}m${satBadge}`;
        } else {
          scopeStatus.textContent = raised
            ? `3D TERRAIN: ${coastlineStatus === 'READY' || coastlineStatus === 'CACHED' ? 'DEM + SATELLITE RELIEF' : '360° RELIEF' + satBadge}`
            : 'MAST RETRACTED: SUBSURFACE VIEW';
        }
        scopeStatus.dataset.state = 'ready';
      }
    }
  }

  window.Periscope3D = new Periscope3DRenderer();
})();
