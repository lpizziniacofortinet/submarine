/**
 * ============================================================================
 * ZERO-DEPENDENCY GLB (glTF 2.0 BINARY) LOADER & VERTEX-COLOR BAKER
 * Parses standard .glb 3D models, traverses node transforms, bakes embedded
 * baseColorTexture UVs into per-vertex RGB colors, and normalizes meshes to
 * unit [-0.5, +0.5] bounds aligned with +Z forward / +Y up for WebGL 1.
 * ============================================================================
 */
(function (root) {
  'use strict';

  const GLB_MAGIC = 0x46546C67; // 'glTF'
  const CHUNK_JSON = 0x4E4F534A;
  const CHUNK_BIN = 0x004E4942;

  function mat4Identity() {
    return [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ];
  }

  function mat4Multiply(a, b) {
    const out = new Array(16);
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return out;
  }

  function mat4FromTRS(t, r, s) {
    const x = r[0], y = r[1], z = r[2], w = r[3];
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = s[0], sy = s[1], sz = s[2];
    return [
      (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
      (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
      (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
      t[0], t[1], t[2], 1
    ];
  }

  function transformPoint(m, x, y, z) {
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14]
    ];
  }

  function transformNormal(m, x, y, z) {
    const nx = m[0] * x + m[4] * y + m[8] * z;
    const ny = m[1] * x + m[5] * y + m[9] * z;
    const nz = m[2] * x + m[6] * y + m[10] * z;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  }

  function getAccessorReader(gltf, binBuffer, accessorIndex) {
    if (accessorIndex === undefined || accessorIndex === null) return null;
    const acc = gltf.accessors[accessorIndex];
    const bv = gltf.bufferViews[acc.bufferView];
    const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const numComp = acc.type === 'SCALAR' ? 1 : acc.type === 'VEC2' ? 2 : acc.type === 'VEC3' ? 3 : 4;
    const compSize =
      acc.componentType === 5126 ? 4 :
      acc.componentType === 5125 ? 4 :
      acc.componentType === 5123 ? 2 :
      acc.componentType === 5122 ? 2 : 1;
    const stride = bv.byteStride || (numComp * compSize);
    const dv = new DataView(binBuffer, byteOffset);

    return {
      count: acc.count,
      read(i) {
        const base = i * stride;
        const out = new Array(numComp);
        for (let k = 0; k < numComp; k++) {
          const off = base + k * compSize;
          if (acc.componentType === 5126) out[k] = dv.getFloat32(off, true);
          else if (acc.componentType === 5125) out[k] = dv.getUint32(off, true);
          else if (acc.componentType === 5123) out[k] = dv.getUint16(off, true);
          else if (acc.componentType === 5122) out[k] = dv.getInt16(off, true);
          else if (acc.componentType === 5121) out[k] = dv.getUint8(off);
          else out[k] = dv.getInt8(off);
        }
        return out;
      }
    };
  }

  async function decodeImageData(gltf, binBuffer, imageIndex) {
    if (imageIndex === undefined || imageIndex === null || typeof document === 'undefined') return null;
    const imgDef = (gltf.images || [])[imageIndex];
    if (!imgDef || imgDef.bufferView === undefined) return null;

    const bv = gltf.bufferViews[imgDef.bufferView];
    const slice = new Uint8Array(binBuffer, bv.byteOffset || 0, bv.byteLength);
    const blob = new Blob([slice], { type: imgDef.mimeType || 'image/png' });
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });
      const maxDim = 512;
      const w = Math.min(maxDim, img.width || 256);
      const h = Math.min(maxDim, img.height || 256);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      return { width: w, height: h, data };
    } catch (_) {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function sampleTexture(texData, u, v, baseFactor) {
    if (!texData) {
      return [
        baseFactor ? baseFactor[0] : 0.45,
        baseFactor ? baseFactor[1] : 0.48,
        baseFactor ? baseFactor[2] : 0.50
      ];
    }
    const uu = u - Math.floor(u);
    const vv = v - Math.floor(v);
    const px = Math.min(texData.width - 1, Math.max(0, Math.floor(uu * texData.width)));
    const py = Math.min(texData.height - 1, Math.max(0, Math.floor(vv * texData.height)));
    const idx = (py * texData.width + px) * 4;
    const r = (texData.data[idx] / 255) * (baseFactor ? baseFactor[0] : 1);
    const g = (texData.data[idx + 1] / 255) * (baseFactor ? baseFactor[1] : 1);
    const b = (texData.data[idx + 2] / 255) * (baseFactor ? baseFactor[2] : 1);
    return [r, g, b];
  }

  async function parseGLB(arrayBuffer, options = {}) {
    const dv = new DataView(arrayBuffer);
    if (dv.byteLength < 20 || dv.getUint32(0, true) !== GLB_MAGIC) {
      throw new Error('Invalid GLB header');
    }

    let offset = 12;
    let gltf = null;
    let binBuffer = null;

    while (offset + 8 <= dv.byteLength) {
      const chunkLen = dv.getUint32(offset, true);
      const chunkType = dv.getUint32(offset + 4, true);
      offset += 8;
      if (chunkType === CHUNK_JSON) {
        const jsonBytes = new Uint8Array(arrayBuffer, offset, chunkLen);
        gltf = JSON.parse(new TextDecoder().decode(jsonBytes));
      } else if (chunkType === CHUNK_BIN) {
        binBuffer = arrayBuffer.slice(offset, offset + chunkLen);
      }
      offset += chunkLen;
    }

    if (!gltf || !binBuffer) {
      throw new Error('Incomplete GLB chunks');
    }

    // Decode all embedded textures once
    const decodedImages = {};
    for (let i = 0; i < (gltf.images || []).length; i++) {
      decodedImages[i] = await decodeImageData(gltf, binBuffer, i);
    }

    const rawPositions = [];
    const rawNormals = [];
    const rawColors = [];

    function visitNode(nodeIdx, parentMat) {
      const node = (gltf.nodes || [])[nodeIdx];
      if (!node) return;
      let localMat = mat4Identity();
      if (Array.isArray(node.matrix) && node.matrix.length === 16) {
        localMat = node.matrix;
      } else if (node.translation || node.rotation || node.scale) {
        localMat = mat4FromTRS(
          node.translation || [0, 0, 0],
          node.rotation || [0, 0, 0, 1],
          node.scale || [1, 1, 1]
        );
      }
      const worldMat = mat4Multiply(parentMat, localMat);

      if (node.mesh !== undefined) {
        const mesh = gltf.meshes[node.mesh];
        for (const prim of mesh.primitives || []) {
          if (prim.mode !== undefined && prim.mode !== 4) continue; // TRIANGLES only
          const posReader = getAccessorReader(gltf, binBuffer, prim.attributes.POSITION);
          if (!posReader) continue;
          const normReader = getAccessorReader(gltf, binBuffer, prim.attributes.NORMAL);
          const uvReader = getAccessorReader(gltf, binBuffer, prim.attributes.TEXCOORD_0);
          const colReader = getAccessorReader(gltf, binBuffer, prim.attributes.COLOR_0);
          const idxReader = getAccessorReader(gltf, binBuffer, prim.indices);

          const mat = prim.material !== undefined ? (gltf.materials || [])[prim.material] : null;
          const pbr = mat ? mat.pbrMetallicRoughness : null;
          const baseFactor = pbr && pbr.baseColorFactor ? pbr.baseColorFactor : [1, 1, 1, 1];
          let texData = null;
          if (pbr && pbr.baseColorTexture && gltf.textures) {
            const tex = gltf.textures[pbr.baseColorTexture.index];
            if (tex && tex.source !== undefined) texData = decodedImages[tex.source] || null;
          }

          const triCount = idxReader ? Math.floor(idxReader.count / 3) : Math.floor(posReader.count / 3);
          for (let t = 0; t < triCount; t++) {
            const i0 = idxReader ? idxReader.read(t * 3)[0] : t * 3;
            const i1 = idxReader ? idxReader.read(t * 3 + 1)[0] : t * 3 + 1;
            const i2 = idxReader ? idxReader.read(t * 3 + 2)[0] : t * 3 + 2;
            const indices = [i0, i1, i2];

            const p0 = posReader.read(i0);
            const p1 = posReader.read(i1);
            const p2 = posReader.read(i2);
            const wp0 = transformPoint(worldMat, p0[0], p0[1], p0[2]);
            const wp1 = transformPoint(worldMat, p1[0], p1[1], p1[2]);
            const wp2 = transformPoint(worldMat, p2[0], p2[1], p2[2]);

            // Fallback face normal if NORMAL accessor missing
            const ux = wp1[0] - wp0[0], uy = wp1[1] - wp0[1], uz = wp1[2] - wp0[2];
            const vx = wp2[0] - wp0[0], vy = wp2[1] - wp0[1], vz = wp2[2] - wp0[2];
            const fnx = uy * vz - uz * vy, fny = uz * vx - ux * vz, fnz = ux * vy - uy * vx;
            const flen = Math.hypot(fnx, fny, fnz) || 1;

            const wps = [wp0, wp1, wp2];
            for (let k = 0; k < 3; k++) {
              const vi = indices[k];
              rawPositions.push(wps[k][0], wps[k][1], wps[k][2]);

              if (normReader) {
                const n = normReader.read(vi);
                const wn = transformNormal(worldMat, n[0], n[1], n[2]);
                rawNormals.push(wn[0], wn[1], wn[2]);
              } else {
                rawNormals.push(fnx / flen, fny / flen, fnz / flen);
              }

              let c;
              if (texData && uvReader) {
                const uv = uvReader.read(vi);
                c = sampleTexture(texData, uv[0], uv[1], baseFactor);
              } else if (colReader) {
                const vc = colReader.read(vi);
                c = [vc[0] * baseFactor[0], vc[1] * baseFactor[1], vc[2] * baseFactor[2]];
              } else {
                c = [baseFactor[0] * 0.55, baseFactor[1] * 0.58, baseFactor[2] * 0.60];
              }
              rawColors.push(c[0], c[1], c[2]);
            }
          }
        }
      }

      for (const childIdx of node.children || []) {
        visitNode(childIdx, worldMat);
      }
    }

    const sceneIdx = gltf.scene !== undefined ? gltf.scene : 0;
    const scene = (gltf.scenes || [])[sceneIdx];
    const rootNodes = scene && scene.nodes ? scene.nodes : [0];
    for (const rIdx of rootNodes) {
      visitNode(rIdx, mat4Identity());
    }

    // Compute bounds and normalize to [-0.5, +0.5] along each axis, aligning longest horizontal axis to +Z
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < rawPositions.length; i += 3) {
      const x = rawPositions[i], y = rawPositions[i + 1], z = rawPositions[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const spanZ = maxZ - minZ || 1;
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;

    const swapXZ = options.alignLongestToZ !== false && spanX > spanZ * 1.15;
    const flipZ = Boolean(options.flipZ);
    const sx = swapXZ ? spanZ : spanX;
    const sz = swapXZ ? spanX : spanZ;

    const positions = new Float32Array(rawPositions.length);
    const normals = new Float32Array(rawNormals.length);
    const colors = new Float32Array(rawColors);

    for (let i = 0; i < rawPositions.length; i += 3) {
      let lx = rawPositions[i] - cx;
      const ly = rawPositions[i + 1] - cy;
      let lz = rawPositions[i + 2] - cz;

      let nx = rawNormals[i];
      const ny = rawNormals[i + 1];
      let nz = rawNormals[i + 2];

      if (swapXZ) {
        const tx = lx; lx = lz; lz = -tx;
        const tnx = nx; nx = nz; nz = -tnx;
      }
      if (flipZ) {
        lx = -lx; lz = -lz;
        nx = -nx; nz = -nz;
      }

      positions[i] = lx / sx;
      positions[i + 1] = ly / spanY;
      positions[i + 2] = lz / sz;
      normals[i] = nx;
      normals[i + 1] = ny;
      normals[i + 2] = nz;
    }

    return {
      positions,
      normals,
      colors,
      vertexCount: positions.length / 3
    };
  }

  class GLBModelLibrary {
    constructor() {
      this.models = new Map();
      this.loading = new Map();
      this.manifest = {
        'ohio-submarine': { url: 'assets/models/ohio-submarine.glb', alignLongestToZ: true },
        'typhoon-submarine': { url: 'assets/models/typhoon-submarine.glb', alignLongestToZ: true },
        'helicopter': { url: 'assets/models/helicopter.glb', alignLongestToZ: true },
        'buoy': { url: 'assets/models/buoy.glb', alignLongestToZ: false }
      };
    }

    async loadModel(key) {
      if (this.models.has(key)) return this.models.get(key);
      if (this.loading.has(key)) return this.loading.get(key);

      const entry = this.manifest[key];
      if (!entry || typeof fetch !== 'function') return null;

      const promise = (async () => {
        try {
          const res = await fetch(entry.url);
          if (!res.ok) return null;
          const buf = await res.arrayBuffer();
          const mesh = await parseGLB(buf, entry);
          this.models.set(key, mesh);
          return mesh;
        } catch (err) {
          console.warn(`GLB model load failed (${key}):`, err);
          return null;
        } finally {
          this.loading.delete(key);
        }
      })();

      this.loading.set(key, promise);
      return promise;
    }

    preloadAll() {
      Object.keys(this.manifest).forEach((key) => this.loadModel(key));
    }

    getModel(key) {
      return this.models.get(key) || null;
    }
  }

  const library = new GLBModelLibrary();
  if (typeof window !== 'undefined') {
    window.GLBModelLibrary = library;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GLBModelLibrary, parseGLB };
  }
})(typeof window !== 'undefined' ? window : globalThis);
