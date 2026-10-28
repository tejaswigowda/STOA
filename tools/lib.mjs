import { createHash } from "node:crypto";

export const ID_LEN = 16;

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The id is the first 16 hex chars of the source asset's sha256. */
export const idFromSha256 = (hex) => hex.slice(0, ID_LEN);
export const idFromBytes = (bytes) => idFromSha256(sha256(bytes));

/** `<id>` or `<id>-2` for a competing re-segmentation. */
export const ID_RE = /^[0-9a-f]{16}(-[0-9]+)?$/;

/** Hash part of an id, without any `-N` re-segmentation suffix. */
export const baseId = (id) => id.slice(0, ID_LEN);

export const bucketOf = (id) => id.slice(0, 2);
export const recordPath = (id) => `objects/${bucketOf(id)}/${id}.json`;

// ---------------------------------------------------------------- glTF / GLB

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export function parseGlb(buf) {
  if (buf.length < 20 || buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error("not a GLB");
  let json = null;
  let bin = null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(data.toString("utf8"));
    else if (type === CHUNK_BIN && !bin) bin = data;
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { json, bin };
}

export function buildGlb(json, bin) {
  const pad = (b, byte) => {
    const n = (4 - (b.length % 4)) % 4;
    return n ? Buffer.concat([b, Buffer.alloc(n, byte)]) : b;
  };
  const j = pad(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const b = bin?.length ? pad(bin, 0) : null;
  const total = 12 + 8 + j.length + (b ? 8 + b.length : 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const chunk = (type, data) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, chunk(CHUNK_JSON, j), ...(b ? [chunk(CHUNK_BIN, b)] : [])]);
}

const MODE_TRIANGLES = 4;

function primitiveTriangles(json, prim) {
  const mode = prim.mode ?? MODE_TRIANGLES;
  if (mode < MODE_TRIANGLES) return 0;
  const count =
    prim.indices !== undefined
      ? json.accessors?.[prim.indices]?.count
      : json.accessors?.[prim.attributes?.POSITION]?.count;
  if (!count) return 0;
  if (mode === MODE_TRIANGLES) return Math.floor(count / 3);
  return Math.max(0, count - 2); // strip or fan
}

const hasBaseColourTexture = (m) =>
  m?.pbrMetallicRoughness?.baseColorTexture !== undefined ||
  m?.extensions?.KHR_materials_pbrSpecularGlossiness?.diffuseTexture !== undefined;

/** Facts about a glTF JSON document. Needs no binary data. */
export function summarise(json) {
  const meshes = json.meshes ?? [];
  const materials = json.materials ?? [];
  const prims = meshes.flatMap((m) => m.primitives ?? []);
  const named = new Set(
    [
      ...meshes.map((m) => m.name),
      ...(json.nodes ?? []).filter((n) => n.mesh !== undefined).map((n) => n.name),
    ].filter((n) => typeof n === "string" && n.trim() !== ""),
  );
  return {
    meshes: meshes.length,
    materials: materials.length,
    primitives: prims.length,
    nodes: json.nodes?.length ?? 0,
    skinned: (json.skins?.length ?? 0) > 0,
    morphTargets:
      prims.some((p) => (p.targets?.length ?? 0) > 0) ||
      meshes.some((m) => (m.weights?.length ?? 0) > 0),
    hasUVs: prims.some((p) => p.attributes?.TEXCOORD_0 !== undefined),
    hasBaseColourTexture: materials.some(hasBaseColourTexture),
    triangles: prims.reduce((a, p) => a + primitiveTriangles(json, p), 0),
    partNames: [...named].sort(),
  };
}

/**
 * refused:      skinned or morph targets
 * ground-truth: >1 mesh or material AND part names
 * hard:         the production case, UVs + base colour, otherwise undecomposed
 * no-evidence:  no UVs, no base-colour texture, or flat colour
 */
export function classify(s) {
  if (s.skinned) return { bucket: "refused", reason: "skinned" };
  if (s.morphTargets) return { bucket: "refused", reason: "morph-targets" };
  if ((s.meshes > 1 || s.materials > 1) && s.partNames.length > 1) return { bucket: "ground-truth" };
  if (s.hasUVs && s.hasBaseColourTexture) return { bucket: "hard" };
  return { bucket: "no-evidence" };
}

// ------------------------------------------------------------------- packing

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", ktx2: "image/ktx2" };

/**
 * Pack a .gltf (external or embedded buffers/images) into one .glb.
 * `load(uri)` returns the bytes of a relative uri. Deterministic.
 */
export async function packToGlb(json, load) {
  const src = structuredClone(json);
  const read = async (uri) => {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(uri);
    if (m) {
      const bytes = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
      return { bytes, mime: m[1] };
    }
    return { bytes: Buffer.from(await load(decodeURI(uri))), mime: null };
  };

  const parts = [];
  let size = 0;
  const append = (bytes) => {
    const at = size;
    parts.push(bytes);
    size += bytes.length;
    const padN = (4 - (size % 4)) % 4;
    if (padN) {
      parts.push(Buffer.alloc(padN));
      size += padN;
    }
    return at;
  };

  const bufferBase = [];
  for (const b of src.buffers ?? []) {
    if (b.uri === undefined) throw new Error("buffer without uri in a .gltf");
    bufferBase.push(append((await read(b.uri)).bytes));
  }
  for (const bv of src.bufferViews ?? []) {
    bv.byteOffset = (bv.byteOffset ?? 0) + bufferBase[bv.buffer];
    bv.buffer = 0;
  }
  for (const img of src.images ?? []) {
    if (img.uri === undefined) continue;
    const { bytes, mime } = await read(img.uri);
    const ext = img.uri.split(/[?#]/)[0].split(".").pop().toLowerCase();
    const byteOffset = append(bytes);
    (src.bufferViews ??= []).push({ buffer: 0, byteOffset, byteLength: bytes.length });
    img.bufferView = src.bufferViews.length - 1;
    img.mimeType = img.mimeType ?? mime ?? MIME[ext];
    if (!img.mimeType) throw new Error(`cannot determine mime type for image ${img.uri.slice(0, 40)}`);
    delete img.uri;
  }
  const bin = Buffer.concat(parts);
  src.buffers = [{ byteLength: bin.length }];
  return { glb: buildGlb(src, bin), json: src };
}

/** Counts a packer must not change. Throws on any difference. */
export function assertPackPreserved(before, after) {
  for (const k of ["meshes", "materials", "primitives", "nodes", "triangles"]) {
    if (before[k] !== after[k]) throw new Error(`pack changed ${k}: ${before[k]} -> ${after[k]}`);
  }
  if (JSON.stringify(before.partNames) !== JSON.stringify(after.partNames)) {
    throw new Error("pack changed part names");
  }
}

// ------------------------------------------------------------------- network

export async function fetchBytes(url, { retries = 3 } = {}) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw new Error(`GET ${url}: ${last.message}`);
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
