#!/usr/bin/env node
// Structural recovery scoring (recovery work order, part C1). Mechanical, no judge.
//
//   node tools/score.mjs --dir .cache/flatten/materials/Lantern --recovered recovered.json [--out results/recovery.jsonl]
//
// recovered.json (build it with tools/recovered-from-record.mjs):
//   { "seg_version": "...", "parts": [ { "id": "...", "name": "Truck_Wheels" | null, "triangles": [parent triangle per output triangle] } ] }
//
// `triangles` is SEG's `parents` for the part: one entry per output triangle, the flattened-mesh
// triangle it was cut from. SEG divides triangles along painted boundaries, so one parent can be
// spread over several parts, and over `4^n` children. Midpoint subdivision gives equal-area
// children, so a part's share of a parent is (its children of it) / (all children of it), which
// makes every area, and so every IoU, exact. Nothing is matched by position.
//
// Naming (C2) needs a judge: matched Tier A pairs are emitted with `verdict: null`, the authored
// name with its instance index stripped, and the recovered name (tools/judge.mjs).
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { hasIndex, sha256, stripIndex } from "./lib.mjs";
import { flattenedTriangles, measure } from "./flatten.mjs";

export const IOU_THRESHOLD = 0.5;

export const triangleAreas = (glb) => flattenedTriangles(glb).map((t) => measure([t]).area);

/**
 * Per original part: best IoU over area against the recovered parts, and the reverse
 * (per recovered part, best IoU against the originals).
 *
 * `recovered[i].triangles` are parent triangles with multiplicity. The children of a parent
 * triangle all have the same area, so across all parts a parent appears 4^n times, and part r
 * holds count(r, t) / total(t) of its area. Anything else is a provenance fault and throws.
 */
export function scoreStructure(parts, areas, recovered) {
  const total = new Uint32Array(areas.length);
  const firstOwner = new Int32Array(areas.length).fill(-1);
  const firstCount = new Uint32Array(areas.length);
  const more = new Map(); // parent -> [[recoveredIndex, count], ...] beyond the first owner
  const perRecovered = recovered.map((r, ri) => {
    const counts = new Map();
    for (const t of r.triangles) {
      if (!(Number.isInteger(t) && t >= 0 && t < areas.length)) throw new Error(`recovered part ${r.id}: parent ${t} is not a triangle of the flattened mesh`);
      counts.set(t, (counts.get(t) ?? 0) + 1);
      total[t]++;
    }
    for (const [t, c] of counts) {
      if (firstOwner[t] === -1) { firstOwner[t] = ri; firstCount[t] = c; }
      else { if (!more.has(t)) more.set(t, []); more.get(t).push([ri, c]); }
    }
    return counts;
  });
  for (let t = 0; t < total.length; t++) {
    let n = total[t];
    if (n === 0) continue;
    while (n % 4 === 0) n /= 4;
    if (n !== 1) throw new Error(`parent triangle ${t} was cut into ${total[t]} pieces; provenance is only exact when that is a power of 4`);
  }
  const coverage = (t) => {
    const out = firstOwner[t] === -1 ? [] : [[firstOwner[t], firstCount[t]]];
    return more.has(t) ? out.concat(more.get(t)) : out;
  };

  const recArea = perRecovered.map((counts) => {
    let a = 0;
    for (const [t, c] of counts) a += (areas[t] * c) / total[t];
    return a;
  });
  const originalOwner = new Int32Array(areas.length).fill(-1);
  parts.forEach((p, pi) => p.triangles.forEach((t) => (originalOwner[t] = pi)));
  const partArea = parts.map((p) => p.triangles.reduce((a, t) => a + areas[t], 0));

  const best = (inter, ownArea, otherArea) => {
    let b = { iou: 0, index: -1 };
    for (const [i, a] of inter) {
      const iou = Math.min(1, a / (ownArea + otherArea[i] - a)); // float noise can overshoot by 1e-15
      if (iou > b.iou) b = { iou, index: i };
    }
    return b;
  };

  const forward = parts.map((p, pi) => {
    const inter = new Map();
    for (const t of p.triangles) for (const [ri, c] of coverage(t)) inter.set(ri, (inter.get(ri) ?? 0) + (areas[t] * c) / total[t]);
    const b = best(inter, partArea[pi], recArea);
    return { part: pi, area: partArea[pi], best_iou: b.iou, recovered: b.index };
  });
  const reverse = recovered.map((r, ri) => {
    const inter = new Map();
    for (const [t, c] of perRecovered[ri]) if (originalOwner[t] >= 0) inter.set(originalOwner[t], (inter.get(originalOwner[t]) ?? 0) + (areas[t] * c) / total[t]);
    const b = best(inter, recArea[ri], partArea);
    return { recovered: ri, area: recArea[ri], best_iou: b.iou, part: b.index };
  });

  const n = forward.length;
  const surface = partArea.reduce((a, b) => a + b, 0);
  return {
    forward,
    reverse,
    summary: {
      original_parts: n,
      recovered_parts: recovered.length,
      mean_best_iou: n ? forward.reduce((a, f) => a + f.best_iou, 0) / n : 0,
      recovery_rate: n ? forward.filter((f) => f.best_iou >= IOU_THRESHOLD).length / n : 0,
      part_count_ratio: n ? recovered.length / n : 0,
      mean_reverse_best_iou: recovered.length ? reverse.reduce((a, r) => a + r.best_iou, 0) / recovered.length : 0,
      uncovered_area_share: surface ? Math.max(0, 1 - recArea.reduce((a, b) => a + b, 0) / surface) : 0,
    },
  };
}

/**
 * One JSONL record per original part, plus one per recovered part.
 * failure is one of: unmatched | below-threshold | no-name | null.
 * A part SEG declined to name (no-name) is not a part it named wrongly.
 */
export function toRecords({ meta, model, id, tier, mode, parts, recovered, result }) {
  const base = { ...meta, model, id, tier, mode };
  const rows = result.forward.map((f) => {
    const r = f.recovered >= 0 ? recovered[f.recovered] : null;
    const matched = f.best_iou >= IOU_THRESHOLD;
    const failure = !r ? "unmatched" : !matched ? "below-threshold" : r.name == null ? "no-name" : null;
    const row = {
      ...base, kind: "original", part: f.part, name: parts[f.part].name, name_stripped: stripIndex(parts[f.part].name ?? ""),
      index_bearing: hasIndex(parts[f.part].name ?? ""), area: f.area, best_iou: f.best_iou,
      recovered_id: r?.id ?? null, recovered_name: r?.name ?? null, matched, failure,
    };
    if (tier === "A" && matched && r?.name != null) row.verdict = null;
    return row;
  });
  for (const r of result.reverse) {
    rows.push({
      ...base, kind: "recovered", recovered_id: recovered[r.recovered].id, recovered_name: recovered[r.recovered].name ?? null,
      area: r.area, best_iou: r.best_iou, part: r.part >= 0 ? r.part : null, failure: r.part < 0 ? "unmatched" : null,
    });
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { dir: { type: "string" }, recovered: { type: "string" }, out: { type: "string" } } });
  if (!values.dir || !values.recovered) {
    console.error("usage: score.mjs --dir <flatten dir> --recovered <recovered.json> [--out results.jsonl]");
    process.exit(2);
  }
  const key = JSON.parse(await readFile(path.join(values.dir, "key.json"), "utf8"));
  const glb = await readFile(path.join(values.dir, "flattened.glb"));
  if (sha256(glb) !== key.flattened.sha256) throw new Error("flattened.glb does not match key.json");
  const rec = JSON.parse(await readFile(values.recovered, "utf8"));
  const triage = JSON.parse(await readFile("triage/khronos-2.0.json", "utf8"));
  const row = triage.assets.find((a) => a.canonical && a.model === key.model);

  const git = (...a) => { try { return execFileSync("git", a, { encoding: "utf8" }).trim(); } catch { return null; } };
  const here = (f) => fileURLToPath(new URL(f, import.meta.url));
  const meta = {
    scorer_sha256: sha256(await readFile(here("./score.mjs"))),
    flatten_sha256: sha256(await readFile(here("./flatten.mjs"))),
    flatten_version: key.flatten_version,
    seg_version: rec.seg_version ?? null,
    repo_commit: git("rev-parse", "HEAD"),
    repo_dirty: Boolean(git("status", "--porcelain", "tools")),
  };
  if (rec.source_sha256 && rec.source_sha256 !== key.flattened.sha256) throw new Error("recovered.json was cut from a different mesh than flattened.glb");
  const result = scoreStructure(key.parts, triangleAreas(glb), rec.parts);
  const rows = toRecords({ meta, model: key.model, id: key.id, tier: row?.tier ?? null, mode: key.mode, parts: key.parts, recovered: rec.parts, result });
  if (values.out) {
    await mkdir(path.dirname(values.out), { recursive: true });
    await appendFile(values.out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  console.log(JSON.stringify({ model: key.model, mode: key.mode, ...result.summary }, null, 2));
}
