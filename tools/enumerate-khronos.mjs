#!/usr/bin/env node
// Triage (work order Part 2): enumerate every .glb and .gltf under
// KhronosGroupArchives/glTF-Sample-Models/2.0, record the facts, bucket each
// asset. Output is deterministic so a re-run diffs cleanly.
//
//   node tools/enumerate-khronos.mjs [--commit <sha>] [--out triage/khronos-2.0.json]
//
// Models that only ship as .gltf (FlightHelmet) are packed to .glb in memory;
// mesh/material/primitive/node counts are compared before and after.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  assertPackPreserved, classify, fetchBytes, idFromSha256, mapLimit, packToGlb, parseGlb, sha256, summarise, tierGroundTruth,
} from "./lib.mjs";

const REPO = "KhronosGroupArchives/glTF-Sample-Models";
const ROOT = "2.0/";
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const outPath = opt("out", "triage/khronos-2.0.json");
const cacheDir = ".cache/khronos";
const featureTests = new Set(JSON.parse(await readFile("triage/feature-tests.json", "utf8")).featureTests);

const api = async (p) => {
  const headers = { "user-agent": "stoa-tools", accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${REPO}/${p}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${p}: ${res.status}`);
  return res.json();
};

const commit = opt("commit") ?? (await api("commits/main")).sha;
const tree = await api(`git/trees/${commit}?recursive=1`);
if (tree.truncated) throw new Error("tree truncated; enumerate per directory instead");
const rawUrl = (p) => `https://raw.githubusercontent.com/${REPO}/${commit}/${p.split("/").map(encodeURIComponent).join("/")}`;

// Content-addressed on the git blob sha, so the cache never goes stale.
const blobSha = new Map(tree.tree.map((e) => [e.path, e.sha]));
async function get(p) {
  const key = path.join(cacheDir, blobSha.get(p) ?? sha256(p));
  if (existsSync(key)) return readFile(key);
  const bytes = await fetchBytes(rawUrl(p));
  await mkdir(cacheDir, { recursive: true });
  await writeFile(key, bytes);
  return bytes;
}

const files = tree.tree
  .filter((e) => e.type === "blob" && e.path.startsWith(ROOT) && /\.(glb|gltf)$/i.test(e.path))
  .map((e) => {
    const [, model, variant] = e.path.split("/");
    return { path: e.path, model, variant, ext: e.path.split(".").pop().toLowerCase() };
  })
  .sort((a, b) => a.path.localeCompare(b.path));

// One canonical source per model: a .glb if one exists, otherwise a .gltf to pack.
const rank = (f) => (f.ext === "glb" && f.variant === "glTF-Binary" ? 0 : f.ext === "glb" ? 1
  : f.variant === "glTF" ? 2 : f.variant === "glTF-Embedded" ? 3 : 4);
const canonical = new Map();
for (const f of files) {
  const cur = canonical.get(f.model);
  if (!cur || rank(f) < rank(cur)) canonical.set(f.model, f);
}

async function analyse(f) {
  const bytes = await get(f.path);
  const row = { model: f.model, variant: f.variant, path: f.path, format: f.ext, canonical: canonical.get(f.model) === f,
    bytes: bytes.length, sha256: sha256(bytes) };
  row.id = idFromSha256(row.sha256);
  const json = f.ext === "glb" ? parseGlb(bytes).json : JSON.parse(bytes.toString("utf8"));
  const facts = summarise(json);
  Object.assign(row, { facts: { ...facts, partNames: undefined, partNameCount: facts.partNames.length } });
  Object.assign(row, classify(facts));
  row.partNames = facts.partNames;
  if (row.bucket === "ground-truth") Object.assign(row, tierGroundTruth(facts.partNames, f.model, featureTests));

  if (row.canonical && f.ext === "gltf") {
    const dir = path.posix.dirname(f.path);
    const packed = await packToGlb(json, (uri) => get(`${dir}/${uri}`));
    const after = summarise(parseGlb(packed.glb).json);
    assertPackPreserved(facts, after);
    row.packed = { sha256: sha256(packed.glb), bytes: packed.glb.length, checked: "meshes,materials,primitives,nodes,triangles,partNames" };
  }
  return row;
}

const rows = await mapLimit(files, 8, async (f) => {
  try {
    return await analyse(f);
  } catch (e) {
    return { model: f.model, variant: f.variant, path: f.path, format: f.ext, canonical: canonical.get(f.model) === f, error: e.message };
  }
});

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const assets = rows.sort((a, b) => cmp(a.path, b.path));
const canon = assets.filter((r) => r.canonical);
const count = (xs, key) => xs.reduce((a, r) => ((a[key(r)] = (a[key(r)] ?? 0) + 1), a), {});
const out = {
  source: { repo: REPO, commit, directory: ROOT },
  summary: {
    files: assets.length,
    models: canon.length,
    errors: assets.filter((r) => r.error).length,
    canonical_by_bucket: Object.fromEntries(Object.entries(count(canon.filter((r) => !r.error), (r) => r.bucket)).sort()),
    refusals_by_reason: Object.fromEntries(Object.entries(count(canon.filter((r) => r.reason), (r) => r.reason)).sort()),
    ground_truth_tiers: Object.fromEntries(Object.entries(count(canon.filter((r) => r.tier), (r) => r.tier)).sort()),
    tier_a_parts: canon.filter((r) => r.tier === "A").reduce((a, r) => a + r.parts, 0),
    gltf_only_packed: canon.filter((r) => r.packed).map((r) => r.model),
  },
  assets,
};
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out.summary, null, 2));
console.log(`wrote ${outPath}`);
if (out.summary.errors) process.exitCode = 1;
