#!/usr/bin/env node
// How much of the answer is handed over by material names? (a leakage diagnostic for the ceiling test)
//
//   node tools/material-overlap.mjs [--out results/material-name-overlap.json]
//
// In `--mode materials` the importer keeps each material's name, and authors often name materials after
// the parts that use them. For every Tier A part this asks: does its authored name (index stripped)
// share a word with the name of its own material? Words are split on case, digits and punctuation;
// words shorter than 4 letters are ignored.
//
// It also asks, for all 49 ground-truth models, how many original parts the material boundary hands over
// exactly: parts whose triangles are precisely one material's mesh. Those are recovered by the importer
// before SEG does anything, so they say nothing about SEG (the ceiling, made concrete).
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { flatten } from "./flatten.mjs";
import { loadCanonicalGlb } from "./khronos.mjs";
import { parseGlb, stripIndex } from "./lib.mjs";

const words = (s) =>
  new Set((s ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4));

export function overlap(partName, materialNames) {
  const a = words(stripIndex(partName ?? ""));
  return materialNames.some((m) => [...words(m)].some((w) => a.has(w)));
}

const { values } = parseArgs({ options: { out: { type: "string", default: "results/material-name-overlap.json" } } });
const triage = JSON.parse(await readFile("triage/khronos-2.0.json", "utf8"));
const gt = triage.assets.filter((a) => a.canonical && a.bucket === "ground-truth").sort((a, b) => a.model.localeCompare(b.model));
const out = {
  note: "overlap: share of Tier A parts whose authored name (index stripped) shares a word of 4+ letters with the name of the part's own material (an upper bound: a shared object word such as 'lantern' counts). exact_by_material: share of original parts that are exactly one whole material mesh, which the importer hands over before SEG runs.",
  models: {}, total: {},
};
const tot = { parts: 0, exact: 0, a_parts: 0, a_overlap: 0, a_exact: 0 };
for (const row of gt) {
  const { glb } = await loadCanonicalGlb(triage, row.model);
  const names = parseGlb(glb).json.materials?.map((m) => m.name) ?? [];
  const { key } = flatten(glb, { mode: "materials" });
  const groupOf = new Map(key.flattened.groups.map((g, i) => [`${g.triangleStart}:${g.triangleCount}`, i]));
  const sorted = (p) => [...p.triangles].sort((a, b) => a - b);
  const wholeGroup = (p) => {
    const t = sorted(p);
    return groupOf.has(`${t[0]}:${t.length}`) && t[t.length - 1] === t[0] + t.length - 1;
  };
  const n = key.parts.length;
  const exact = key.parts.filter(wholeGroup).length;
  const entry = { tier: row.tier, parts: n, exact_by_material: exact, exact_share: exact / n, exact_parts: key.parts.filter(wholeGroup).map((p) => p.index) };
  tot.parts += n; tot.exact += exact;
  if (row.tier === "A") {
    const h = key.parts.filter((p) => overlap(p.name, p.materials.filter((m) => m >= 0).map((m) => names[m]))).length;
    Object.assign(entry, { overlapping: h, overlap_share: h / n, material_names_given: names.filter(Boolean).length });
    tot.a_parts += n; tot.a_overlap += h; tot.a_exact += exact;
  }
  out.models[row.model] = entry;
}
out.total = { parts: tot.parts, exact_by_material: tot.exact, exact_share: tot.exact / tot.parts, tier_a: { parts: tot.a_parts, overlapping: tot.a_overlap, overlap_share: tot.a_overlap / tot.a_parts, exact_by_material: tot.a_exact, exact_share: tot.a_exact / tot.a_parts } };
await writeFile(values.out, JSON.stringify(out, null, 2) + "\n");
for (const [m, v] of Object.entries(out.models)) console.log(m.padEnd(30), v.tier, `exact ${v.exact_by_material}/${v.parts}`, v.overlapping !== undefined ? `name-overlap ${v.overlapping}/${v.parts}` : "");
console.log(JSON.stringify(out.total));
