#!/usr/bin/env node
// Flatten a multi-part asset into the single mesh SEG would be given, keeping
// the original decomposition as an answer key (recovery work order, part B).
//
//   node tools/flatten.mjs <model|file.glb> [--mode materials|single] [--out <dir>]
//   node tools/flatten.mjs --all [--mode materials]       every ground-truth model
//
//   materials  one mesh, one primitive per material  (the ceiling test)
//   single     one mesh, one primitive, one material (needs one material; no atlasing)
//
// Writes flattened.glb and key.json. key.json locates every original part by
// triangle index into the flattened mesh, so scoring needs no matching.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildGlb, idFromBytes, parseGlb, sha256 } from "./lib.mjs";
import { loadCanonicalGlb } from "./khronos.mjs";

export const FLATTEN_VERSION = 1;
export const AREA_TOLERANCE = 1e-6;

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
// componentType -> [bytes, DataView getter, normalisation divisor]
const COMPONENT = {
  5120: [1, "getInt8", 127], 5121: [1, "getUint8", 255], 5122: [2, "getInt16", 32767],
  5123: [2, "getUint16", 65535], 5125: [4, "getUint32", 0], 5126: [4, "getFloat32", 0],
};
const KEPT = ["NORMAL", "TEXCOORD_0", "TEXCOORD_1", "COLOR_0"];
const UNUSED_AFTER_FLATTEN = new Set([
  "KHR_draco_mesh_compression", "KHR_mesh_quantization", "EXT_meshopt_compression", "KHR_materials_variants",
  "KHR_lights_punctual", "KHR_animation_pointer",
]);

// ------------------------------------------------------------------ accessors

/** Decoded accessor as { count, size, data: Float64Array }; honours stride, normalized and sparse. */
export function readAccessor(json, bin, index) {
  const acc = json.accessors[index];
  const size = COMPONENTS[acc.type];
  if (!size) throw new Error(`accessor ${index}: unsupported type ${acc.type}`);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const read = (type, at, normalized) => {
    const [bytes, getter, div] = COMPONENT[type];
    const v = bytes === 1 ? dv[getter](at) : dv[getter](at, true);
    return normalized && div ? Math.max(v / div, -1) : v;
  };
  const bytes = COMPONENT[acc.componentType][0];
  const data = new Float64Array(acc.count * size);

  if (acc.bufferView !== undefined) {
    const bv = json.bufferViews[acc.bufferView];
    const stride = bv.byteStride || size * bytes;
    const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    for (let i = 0; i < acc.count; i++) for (let c = 0; c < size; c++) data[i * size + c] = read(acc.componentType, base + i * stride + c * bytes, acc.normalized);
  }
  if (acc.sparse) {
    const { count, indices, values } = acc.sparse;
    const iBase = (json.bufferViews[indices.bufferView].byteOffset ?? 0) + (indices.byteOffset ?? 0);
    const vBase = (json.bufferViews[values.bufferView].byteOffset ?? 0) + (values.byteOffset ?? 0);
    const iBytes = COMPONENT[indices.componentType][0];
    for (let i = 0; i < count; i++) {
      const target = read(indices.componentType, iBase + i * iBytes, false);
      for (let c = 0; c < size; c++) data[target * size + c] = read(acc.componentType, vBase + (i * size + c) * bytes, acc.normalized);
    }
  }
  return { count: acc.count, size, data };
}

// ------------------------------------------------------------------ transforms

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function localMatrix(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/** Cofactor of the upper 3x3 (transforms normals correctly); `flip` when the determinant is negative. */
function normalMatrix(m) {
  const [a, b, c, , d, e, f, , g, h, i] = m;
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const cof = [
    e * i - f * h, f * g - d * i, d * h - e * g,
    c * h - b * i, a * i - c * g, b * g - a * h,
    b * f - c * e, c * d - a * f, a * e - b * d,
  ];
  return { cof, flip: det < 0 };
}

const point = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

/** One entry per mesh instance reachable from the default scene. */
export function collectInstances(json) {
  const out = [];
  const visit = (idx, parent, ancestors) => {
    if (ancestors.has(idx)) throw new Error(`node ${idx}: cycle`);
    const n = json.nodes[idx];
    if (n.extensions?.EXT_mesh_gpu_instancing) throw new Error(`node ${idx}: EXT_mesh_gpu_instancing is not supported`);
    const world = mul(parent, localMatrix(n));
    if (n.mesh !== undefined) out.push({ node: idx, nodeName: n.name ?? null, mesh: n.mesh, meshName: json.meshes[n.mesh].name ?? null, world });
    for (const child of n.children ?? []) visit(child, world, new Set([...ancestors, idx]));
  };
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene ? scene.nodes ?? [] : json.nodes.map((_, i) => i).filter((i) => !json.nodes.some((n) => n.children?.includes(i)));
  for (const root of roots) visit(root, IDENTITY, new Set());
  return out;
}

function assertSupported(json) {
  if (json.skins?.length) throw new Error("skinned: refused");
  for (const m of json.meshes ?? []) {
    if (m.weights?.length) throw new Error("morph targets: refused");
    for (const p of m.primitives) {
      if (p.targets?.length) throw new Error("morph targets: refused");
      if (p.extensions?.KHR_draco_mesh_compression || p.extensions?.EXT_meshopt_compression) throw new Error("compressed geometry is not supported");
    }
  }
}

/** Triangle list (flat vertex indices) of a primitive; null when it has no triangles. */
function primitiveTriangleIndices(json, bin, prim) {
  const mode = prim.mode ?? 4;
  if (mode < 4) return null;
  const vertexCount = json.accessors[prim.attributes.POSITION].count;
  const seq = prim.indices !== undefined ? Array.from(readAccessor(json, bin, prim.indices).data) : Array.from({ length: vertexCount }, (_, i) => i);
  const tris = [];
  if (mode === 4) for (let i = 0; i + 2 < seq.length; i += 3) tris.push(seq[i], seq[i + 1], seq[i + 2]);
  else if (mode === 5) for (let i = 0; i + 2 < seq.length; i++) tris.push(...(i % 2 ? [seq[i + 1], seq[i], seq[i + 2]] : [seq[i], seq[i + 1], seq[i + 2]]));
  else for (let i = 1; i + 1 < seq.length; i++) tris.push(seq[0], seq[i], seq[i + 1]);
  return tris;
}

// -------------------------------------------------------------------- measure

/** Triangle count, surface area and bounding box of triangles given as position triples. */
export function measure(triangles) {
  let area = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const tri of triangles) {
    for (const p of tri) for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k]; }
    const [a, b, c] = tri;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    area += 0.5 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
  }
  return { triangles: triangles.length, area, bbox: triangles.length ? { min, max } : null };
}

/** World-space triangles of the source asset, as position triples. */
export function sourceTriangles(json, bin) {
  const tris = [];
  for (const inst of collectInstances(json)) {
    for (const prim of json.meshes[inst.mesh].primitives) {
      const idx = primitiveTriangleIndices(json, bin, prim);
      if (!idx) continue;
      const pos = readAccessor(json, bin, prim.attributes.POSITION).data;
      const at = (i) => point(inst.world, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      for (let t = 0; t < idx.length; t += 3) tris.push([at(idx[t]), at(idx[t + 1]), at(idx[t + 2])]);
    }
  }
  return tris;
}

/** Triangles of a flattened glb, in triangle-index order. */
export function flattenedTriangles(glb) {
  const { json, bin } = parseGlb(glb);
  const tris = [];
  for (const prim of json.meshes[0].primitives) {
    const idx = readAccessor(json, bin, prim.indices).data;
    const pos = readAccessor(json, bin, prim.attributes.POSITION).data;
    const at = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    for (let t = 0; t < idx.length; t += 3) tris.push([at(idx[t]), at(idx[t + 1]), at(idx[t + 2])]);
  }
  return tris;
}

export function compareMeasures(before, after) {
  const span = before.bbox ? Math.max(...before.bbox.max.map((v, k) => v - before.bbox.min[k]), 1e-12) : 1;
  const bboxErr = before.bbox
    ? Math.max(...before.bbox.min.map((v, k) => Math.abs(v - after.bbox.min[k])), ...before.bbox.max.map((v, k) => Math.abs(v - after.bbox.max[k]))) / span
    : 0;
  const areaErr = before.area ? Math.abs(before.area - after.area) / before.area : 0;
  return {
    triangles_equal: before.triangles === after.triangles,
    area_relative_error: areaErr,
    bbox_relative_error: bboxErr,
    // the output is float32, so area and box are bounded by a tolerance; triangle count is exact
    passed: before.triangles === after.triangles && areaErr <= AREA_TOLERANCE && bboxErr <= AREA_TOLERANCE,
  };
}

// -------------------------------------------------------------------- flatten

export function flatten(glb, { mode = "materials" } = {}) {
  if (mode !== "materials" && mode !== "single") throw new Error(`unknown mode "${mode}"`);
  const { json, bin } = parseGlb(glb);
  if (!bin) throw new Error("asset has no binary chunk");
  assertSupported(json);

  const instances = collectInstances(json);
  const usedMaterials = new Set();
  for (const inst of instances) for (const p of json.meshes[inst.mesh].primitives) if ((p.mode ?? 4) >= 4) usedMaterials.add(p.material ?? -1);
  if (mode === "single" && usedMaterials.size > 1) {
    throw new Error(`--mode=single needs one material, asset uses ${usedMaterials.size}; atlasing is out of scope`);
  }

  const groups = new Map();
  const dropped = [];
  const parts = instances.map((inst, i) => ({
    index: i, name: inst.nodeName ?? inst.meshName, nodeName: inst.nodeName, meshName: inst.meshName,
    node: inst.node, mesh: inst.mesh, materials: [], triangles: [],
  }));
  instances.forEach((inst, partIdx) => {
    const { cof, flip } = normalMatrix(inst.world);
    json.meshes[inst.mesh].primitives.forEach((prim, primIdx) => {
      const tris = primitiveTriangleIndices(json, bin, prim);
      if (!tris) {
        dropped.push({ part: partIdx, primitive: primIdx, reason: `mode ${prim.mode} has no triangles` });
        return;
      }
      const material = prim.material ?? -1;
      if (!parts[partIdx].materials.includes(material)) parts[partIdx].materials.push(material);
      const key = mode === "single" ? "all" : material;
      if (!groups.has(key)) groups.set(key, { material: mode === "single" ? [...usedMaterials][0] : material, prims: [] });
      const attrs = {};
      for (const name of KEPT) if (prim.attributes[name] !== undefined) attrs[name] = readAccessor(json, bin, prim.attributes[name]);
      groups.get(key).prims.push({ part: partIdx, world: inst.world, cof, flip, tris, pos: readAccessor(json, bin, prim.attributes.POSITION), attrs });
    });
  });

  const blobs = [];
  let binSize = 0;
  const addBlob = (view) => {
    const bytes = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
    const at = binSize;
    blobs.push(bytes);
    binSize += bytes.length;
    const pad = (4 - (binSize % 4)) % 4;
    if (pad) { blobs.push(Buffer.alloc(pad)); binSize += pad; }
    return { at, length: bytes.length };
  };
  const out = { asset: { version: "2.0", generator: `stoa flatten v${FLATTEN_VERSION}` }, bufferViews: [], accessors: [], meshes: [{ name: "flattened", primitives: [] }] };
  const addView = (blob, target) => out.bufferViews.push({ buffer: 0, byteOffset: blob.at, byteLength: blob.length, ...(target ? { target } : {}) }) - 1;
  const addAccessor = (data, componentType, type, count, target, extra = {}) =>
    out.accessors.push({ bufferView: addView(addBlob(data), target), componentType, count, type, ...extra }) - 1;

  const ordered = [...groups.entries()].sort(([a], [b]) => (a === "all" ? 0 : a) - (b === "all" ? 0 : b));
  const groupInfo = [];
  let triOffset = 0;
  for (const [, g] of ordered) {
    // An attribute survives only if every contributing primitive has it; nothing is invented.
    const names = KEPT.filter((n) => g.prims.every((p) => p.attrs[n]?.size === g.prims[0].attrs[n]?.size && p.attrs[n]));
    const vertexTotal = g.prims.reduce((a, p) => a + p.pos.count, 0);
    const positions = new Float32Array(vertexTotal * 3);
    const extra = Object.fromEntries(names.map((n) => [n, new Float32Array(vertexTotal * g.prims[0].attrs[n].size)]));
    const indices = [];
    let base = 0;
    for (const p of g.prims) {
      for (let v = 0; v < p.pos.count; v++) {
        positions.set(point(p.world, p.pos.data[v * 3], p.pos.data[v * 3 + 1], p.pos.data[v * 3 + 2]), (base + v) * 3);
        for (const n of names) {
          const s = p.attrs[n].size;
          const src = p.attrs[n].data.subarray(v * s, v * s + s);
          if (n === "NORMAL") {
            const [x, y, z] = src;
            const nx = p.cof[0] * x + p.cof[3] * y + p.cof[6] * z;
            const ny = p.cof[1] * x + p.cof[4] * y + p.cof[7] * z;
            const nz = p.cof[2] * x + p.cof[5] * y + p.cof[8] * z;
            const len = Math.hypot(nx, ny, nz) || 1;
            extra[n].set([nx / len, ny / len, nz / len], (base + v) * 3);
          } else extra[n].set(src, (base + v) * s);
        }
      }
      for (let t = 0; t < p.tris.length; t += 3) {
        const [a, b, c] = [p.tris[t] + base, p.tris[t + 1] + base, p.tris[t + 2] + base];
        indices.push(a, p.flip ? c : b, p.flip ? b : c);
        parts[p.part].triangles.push(triOffset + indices.length / 3 - 1);
      }
      base += p.pos.count;
    }
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) { min[i % 3] = Math.min(min[i % 3], positions[i]); max[i % 3] = Math.max(max[i % 3], positions[i]); }
    const attributes = { POSITION: addAccessor(positions, 5126, "VEC3", vertexTotal, 34962, { min, max }) };
    for (const n of names) attributes[n] = addAccessor(extra[n], 5126, `VEC${g.prims[0].attrs[n].size}`, vertexTotal, 34962);
    const prim = { attributes, indices: addAccessor(new Uint32Array(indices), 5125, "SCALAR", indices.length, 34963), mode: 4 };
    if (g.material >= 0) prim.material = g.material;
    out.meshes[0].primitives.push(prim);
    groupInfo.push({ material: g.material >= 0 ? g.material : null, triangleStart: triOffset, triangleCount: indices.length / 3, attributes: Object.keys(attributes) });
    triOffset += indices.length / 3;
  }

  // Materials, textures and their image bytes are carried over untouched.
  for (const k of ["materials", "textures", "samplers"]) if (json[k]) out[k] = structuredClone(json[k]);
  if (json.images) {
    out.images = structuredClone(json.images);
    for (const img of out.images) {
      const bv = json.bufferViews[img.bufferView];
      img.bufferView = addView(addBlob(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)));
    }
  }
  const used = (json.extensionsUsed ?? []).filter((e) => !UNUSED_AFTER_FLATTEN.has(e));
  if (used.length) out.extensionsUsed = used;
  const required = (json.extensionsRequired ?? []).filter((e) => !UNUSED_AFTER_FLATTEN.has(e));
  if (required.length) out.extensionsRequired = required;
  out.nodes = [{ name: "flattened", mesh: 0 }];
  out.scenes = [{ nodes: [0] }];
  out.scene = 0;
  const binary = Buffer.concat(blobs);
  out.buffers = [{ byteLength: binary.length }];
  const flattened = buildGlb(out, binary);

  // R2: flattening must not be a source of error.
  const before = measure(sourceTriangles(json, bin));
  const flatTris = flattenedTriangles(flattened);
  const after = measure(flatTris);
  const gate = compareMeasures(before, after);

  // R3: every original part is located by triangle index, and the parts partition the mesh.
  const seen = new Uint8Array(after.triangles);
  for (const p of parts) {
    const m = measure(p.triangles.map((i) => flatTris[i]));
    p.area = m.area;
    p.bbox = m.bbox;
    for (const t of p.triangles) seen[t]++;
  }
  if (!seen.every((c) => c === 1)) throw new Error("R3: parts do not partition the flattened triangles");

  return {
    glb: flattened,
    key: {
      flatten_version: FLATTEN_VERSION,
      mode,
      flattened: { sha256: sha256(flattened), triangles: after.triangles, area: after.area, bbox: after.bbox, groups: groupInfo },
      source_measure: { triangles: before.triangles, area: before.area, bbox: before.bbox },
      gate,
      dropped,
      parts,
    },
  };
}

// ------------------------------------------------------------------------ CLI

async function runOne(triage, model, mode, outRoot) {
  let glb, id, label = model;
  if (model.endsWith(".glb")) {
    glb = await readFile(model);
    id = idFromBytes(glb);
    label = path.basename(model, ".glb");
  } else {
    ({ glb } = await loadCanonicalGlb(triage, model));
    id = triage.assets.find((a) => a.model === model && a.canonical).id;
  }
  const { glb: flat, key } = flatten(glb, { mode });
  const dir = path.join(outRoot, mode, label);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "flattened.glb"), flat);
  await writeFile(path.join(dir, "key.json"), JSON.stringify({ model: label, id, ...key }, null, 1) + "\n");
  return key;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { mode: { type: "string", default: "materials" }, out: { type: "string", default: ".cache/flatten" }, all: { type: "boolean", default: false } },
  });
  const triage = JSON.parse(await readFile("triage/khronos-2.0.json", "utf8"));
  const models = values.all ? triage.assets.filter((a) => a.canonical && a.bucket === "ground-truth").map((a) => a.model) : positionals;
  if (!models.length) {
    console.error("usage: flatten.mjs <model|file.glb> [--mode materials|single] | --all");
    process.exit(2);
  }
  let failed = 0;
  for (const m of models) {
    try {
      const key = await runOne(triage, m, values.mode, values.out);
      const g = key.gate;
      if (!g.passed) failed++;
      console.log(`${g.passed ? "ok  " : "FAIL"} ${m.padEnd(30)} tris=${key.flattened.triangles} parts=${key.parts.length} groups=${key.flattened.groups.length} area_err=${g.area_relative_error.toExponential(1)} bbox_err=${g.bbox_relative_error.toExponential(1)}${key.dropped.length ? ` dropped=${key.dropped.length}` : ""}`);
    } catch (e) {
      failed++;
      console.log(`ERR  ${m.padEnd(30)} ${e.message}`);
    }
  }
  if (failed) process.exitCode = 1;
}
