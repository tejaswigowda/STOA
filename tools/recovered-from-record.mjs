#!/usr/bin/env node
// Build recovered.json from a SEG record by provenance alone (recovery work order F3).
//
//   node tools/recovered-from-record.mjs <scene.json | record.json> [--out recovered.json]
//   node tools/recovered-from-record.mjs <a.json> <b.json> ... --key key.json [--out recovered.json]
//
// A glTF importer makes one mesh per primitive, so a flattened asset with several materials is cut
// as several meshes, each with a record whose parents number that mesh's own triangles. Give the
// records in primitive order with the flatten key.json: record i is offset by group i's first triangle.
//
// The record's `parents` say, for every output triangle of every part, which input
// triangle it was cut from, so there is nothing to match and no tolerance. This tool
// has no geometry in it on purpose: a record without `parents` (SEG before 1.5.0) is
// refused rather than approximated, because an approximate mapping would make the
// scorer partly a measurement of the adapter.
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

export const MIN_SEG_VERSION = [1, 5, 0];

const atLeast = (v, min) => {
  const a = String(v ?? "0").split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== min[i]) return (a[i] || 0) > min[i];
  return true;
};

/** The segmentation record: a scene JSON (the group carrying userData.segmentation) or the record itself. */
export function findRecord(json) {
  if (json?.parents && json?.parts && json?.seg_version) return json;
  const found = [];
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (o.userData?.segmentation) found.push(o.userData.segmentation);
    for (const v of Array.isArray(o) ? o : Object.values(o)) walk(v);
  };
  walk(json);
  if (found.length !== 1) throw new Error(`expected exactly one segmentation record, found ${found.length}`);
  return found[0];
}

export function recoveredFromRecord(record, offset = 0) {
  if (!atLeast(record.seg_version, MIN_SEG_VERSION)) {
    throw new Error(`record is from SEG ${record.seg_version}; parent triangles need ${MIN_SEG_VERSION.join(".")} or later. Re-run the cut instead of reconstructing it from geometry`);
  }
  if (!record.parents) throw new Error("record has no parents");
  const names = Object.keys(record.parts);
  if (JSON.stringify(Object.keys(record.parents)) !== JSON.stringify(names)) throw new Error("parents and parts do not name the same parts");
  return {
    seg_version: record.seg_version,
    method: record.method,
    source_sha256: record.source?.sha256 ?? null,
    parts: names.map((name) => {
      const triangles = record.parents[name];
      if (!Array.isArray(triangles) || triangles.length !== record.parts[name]) {
        throw new Error(`part "${name}": ${triangles?.length ?? "no"} parents for ${record.parts[name]} triangles`);
      }
      return { id: name, name, triangles: offset ? triangles.map((t) => t + offset) : triangles };
    }),
  };
}

/** Several records, one per primitive of a flattened asset, as one recovered.json; `groups` is key.flattened.groups. */
export function recoveredFromRecords(records, groups) {
  if (records.length !== groups.length) throw new Error(`${records.length} records for ${groups.length} primitives of the flattened mesh`);
  const parts = [];
  const seen = new Set();
  records.forEach((rec, i) => {
    const r = recoveredFromRecord(rec, groups[i].triangleStart);
    for (const p of r.parts) {
      if (seen.has(p.id)) throw new Error(`part name "${p.id}" is used by two records`);
      seen.add(p.id);
      parts.push(p);
    }
  });
  const first = recoveredFromRecord(records[0]);
  return { seg_version: first.seg_version, method: first.method, source_sha256: null, parts };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: "string" }, key: { type: "string" } } });
  if (!positionals.length || (positionals.length > 1 && !values.key)) {
    console.error("usage: recovered-from-record.mjs <scene.json|record.json> [--out recovered.json]\n       recovered-from-record.mjs <a.json> <b.json> ... --key key.json [--out recovered.json]");
    process.exit(2);
  }
  const records = await Promise.all(positionals.map(async (f) => findRecord(JSON.parse(await readFile(f, "utf8")))));
  const rec = values.key
    ? recoveredFromRecords(records, JSON.parse(await readFile(values.key, "utf8")).flattened.groups)
    : recoveredFromRecord(records[0]);
  const text = JSON.stringify(rec) + "\n";
  if (values.out) await writeFile(values.out, text);
  else process.stdout.write(text);
}
