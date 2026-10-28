#!/usr/bin/env node
// Generates index/objects.json and index/buckets.json from the committed tree.
// Never edit those files by hand; CI regenerates them and fails on any diff.
//
//   node tools/build-index.mjs            write the index
//   node tools/build-index.mjs --check    fail if the committed index differs
//   node tools/build-index.mjs --worktree read uncommitted records too
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadRecords, parseRecords } from "./records.mjs";

const args = new Set(process.argv.slice(2));
const OBJECTS = "index/objects.json";
const BUCKETS = "index/buckets.json";

// The one place that maps a record onto an index row. Field names follow the
// record schema in STOA_SCHEMA_WORKORDER.md; adjust here if that differs.
export function indexRow(path, rec) {
  const planParts = Array.isArray(rec.plan?.parts) ? rec.plan.parts : null;
  const parts = rec.parts === null || rec.status === "refused" ? null
    : Array.isArray(rec.parts) ? rec.parts.length
    : typeof rec.parts === "number" ? rec.parts
    : planParts ? planParts.length : null;
  const classes = Array.isArray(rec.classes) ? rec.classes
    : planParts ? [...new Set(planParts.map((p) => p.name).filter(Boolean))] : [];
  const verification = rec.verification ?? {};
  return {
    id: rec.id,
    path,
    title: rec.title ?? rec.source?.name?.replace(/\.[^.]+$/, "") ?? rec.id,
    source: { name: rec.source?.name ?? null, licence: rec.source?.licence ?? rec.licence?.name ?? rec.licence ?? null },
    parts,
    classes,
    status: rec.status ?? verification.status ?? null,
    reviews: Array.isArray(verification.reviews) ? verification.reviews.length : 0,
    ground_truth: rec.ground_truth === true,
  };
}

export function buildIndex(records) {
  const rows = parseRecords(records)
    .map(({ path, record }) => indexRow(path, record))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ids = new Set();
  for (const r of rows) {
    if (ids.has(r.id)) throw new Error(`duplicate id ${r.id}`);
    ids.add(r.id);
  }
  const buckets = {};
  for (const r of rows) buckets[r.id.slice(0, 2)] = (buckets[r.id.slice(0, 2)] ?? 0) + 1;
  return { objects: rows, buckets };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { objects, buckets } = buildIndex(loadRecords({ worktree: args.has("--worktree") }));
  const files = { [OBJECTS]: JSON.stringify(objects, null, 2) + "\n", [BUCKETS]: JSON.stringify(buckets, null, 2) + "\n" };

  const over = Object.entries(buckets).filter(([, n]) => n > 800);
  if (over.length) console.warn(`migration trigger: buckets over 800 entries: ${over.map(([b, n]) => `${b}=${n}`).join(", ")}`);

  if (args.has("--check")) {
    let bad = false;
    for (const [file, want] of Object.entries(files)) {
      const have = await readFile(file, "utf8").catch(() => null);
      if (have !== want) {
        console.error(`${file} is out of date; run: node tools/build-index.mjs`);
        bad = true;
      }
    }
    if (bad) process.exit(1);
    console.log(`index OK (${objects.length} records)`);
  } else {
    await mkdir("index", { recursive: true });
    for (const [file, text] of Object.entries(files)) await writeFile(file, text);
    console.log(`wrote ${OBJECTS} (${objects.length} records) and ${BUCKETS}`);
  }
}
