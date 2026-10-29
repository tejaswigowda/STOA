#!/usr/bin/env node
// Structural recovery scoring (recovery work order, part C1). Mechanical, no judge.
//
//   node tools/score.mjs --dir .cache/flatten/materials/Lantern --recovered recovered.json [--out results/recovery.jsonl]
//
// recovered.json:
//   { "seg_version": "...", "parts": [ { "id": "...", "name": "Truck_Wheels" | null, "triangles": [flattened triangle indices] } ] }
//
// A recovered part lists the flattened triangles it covers. SEG subdivides along
// painted boundaries, so map each output triangle back to its parent triangle.
//
// Naming (C2) needs a judge: matched Tier A pairs are emitted with `verdict: null`
// and both names, so a judge only has to fill it in (same | grain | wrong).
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { sha256 } from "./lib.mjs";
import { flattenedTriangles, measure } from "./flatten.mjs";

export const IOU_THRESHOLD = 0.5;

export const triangleAreas = (glb) => flattenedTriangles(glb).map((t) => measure([t]).area);

/**
 * Per original part: best IoU over area against the recovered parts, and the
 * reverse (per recovered part, best IoU against the originals).
 */
export function scoreStructure(parts, areas, recovered) {
  const owner = new Int32Array(areas.length).fill(-1);
  recovered.forEach((r, ri) => {
    for (const t of r.triangles) {
      if (!(t >= 0 && t < areas.length)) throw new Error(`recovered part ${r.id}: triangle ${t} out of range`);
      if (owner[t] !== -1) throw new Error(`recovered parts overlap at triangle ${t} (${recovered[owner[t]].id}, ${r.id})`);
      owner[t] = ri;
    }
  });
  const sum = (tris) => tris.reduce((a, t) => a + areas[t], 0);
  const recArea = recovered.map((r) => sum(r.triangles));

  const originalOwner = new Int32Array(areas.length).fill(-1);
  parts.forEach((p, pi) => p.triangles.forEach((t) => (originalOwner[t] = pi)));
  const partArea = parts.map((p) => sum(p.triangles));

  const bestMatch = (tris, ownerOf, ownArea, otherArea) => {
    const inter = new Map();
    for (const t of tris) if (ownerOf[t] >= 0) inter.set(ownerOf[t], (inter.get(ownerOf[t]) ?? 0) + areas[t]);
    let best = { iou: 0, index: -1 };
    for (const [i, a] of inter) {
      const iou = a / (ownArea + otherArea[i] - a);
      if (iou > best.iou) best = { iou, index: i };
    }
    return best;
  };

  const forward = parts.map((p, pi) => {
    const b = bestMatch(p.triangles, owner, partArea[pi], recArea);
    return { part: pi, area: partArea[pi], best_iou: b.iou, recovered: b.index };
  });
  const reverse = recovered.map((r, ri) => {
    const b = bestMatch(r.triangles, originalOwner, recArea[ri], partArea);
    return { recovered: ri, area: recArea[ri], best_iou: b.iou, part: b.index };
  });

  const n = forward.length;
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
      ...base, kind: "original", part: f.part, name: parts[f.part].name, area: f.area, best_iou: f.best_iou,
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
  const result = scoreStructure(key.parts, triangleAreas(glb), rec.parts);
  const rows = toRecords({ meta, model: key.model, id: key.id, tier: row?.tier ?? null, mode: key.mode, parts: key.parts, recovered: rec.parts, result });
  if (values.out) {
    await mkdir(path.dirname(values.out), { recursive: true });
    await appendFile(values.out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  console.log(JSON.stringify({ model: key.model, mode: key.mode, ...result.summary }, null, 2));
}
