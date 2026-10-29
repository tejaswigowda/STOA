#!/usr/bin/env node
// Seed the floor (recovery work order E): one record for every refused and no-evidence asset in the
// triage. These records have no cut, only the source, its licence and credit, the status and the
// reason. They fix the denominator, so no rate can be quoted without what was not handled.
//
//   node tools/seed-floor.mjs [--dry-run]
//
// Writes objects/<id[0:2]>/<id>.json. The index is not touched; build-index.mjs regenerates it.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { fetchPinned } from "./khronos.mjs";
import { recordPath } from "./lib.mjs";

// Licence labels are read from each model's own README; anything not recognised is a stop, not a guess.
// `licence: null` means no grant exists to record: "donated for glTF testing" is not one, and none is inferred.
const OVERRIDES = {
  Fox: { licence: "CC0 1.0 (fox model); CC BY 4.0 (rigging and animation)" },
  BrainStem: {
    licence: "Poser Pro EULA, clause (g) of \u201cLegitimate Uses\u201d",
    licence_url: "http://producturlsupport.com/cgi-bin/cscgi.pl?f=info&p=PSXNEULA",
    licence_note: "Proprietary: owned by Smith Micro Software, Inc. The licence text is not bundled because it is not ours to redistribute.",
  },
  SuzanneMorphSparse: {
    licence: null,
    licence_note: "The source README says only \"Donated by ousttrue for glTF testing.\" That is not a grant, so no licence is recorded and none is inferred.",
  },
};

/** { licence, licence_url?, licence_note? } for a model. */
export function licenceOf(model, { raw: section }) {
  if (OVERRIDES[model]) return OVERRIDES[model];
  const cc0 = /CC0|Public domain/i.test(section);
  const by = /Creative Commons Attribution 4\.0|CC-BY 4\.0/i.test(section);
  if (cc0 !== by) return { licence: cc0 ? "CC0 1.0" : "CC BY 4.0" };
  throw new Error(`${model}: cannot tell the licence from its README (${JSON.stringify(section.slice(0, 120))}); add it to OVERRIDES`);
}

/** The label alone, for callers that need a string. */
export const licenceLabel = (model, section) => licenceOf(model, section).licence ?? "Not stated in the source README";

/** The README's "License Information" section: `raw` as written (a CC0 badge is only an image), `text` as plain text with images dropped and links reduced to their text. */
export function licenceSection(markdown) {
  const m = /##\s*Licen[sc]e[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i.exec(markdown);
  if (!m) return null;
  const text = m[1].replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
  return { raw: m[1], text };
}

const detailOf = (row) => {
  const f = row.facts;
  if (row.bucket === "refused") return row.seg_refusal?.detail ?? row.reason;
  return `UVs: ${f.hasUVs ? "yes" : "no"}; base-colour texture: ${f.hasBaseColourTexture ? "yes" : "no"}; materials: ${f.materials}`;
};

/** `segRefusals` is triage/seg-refusals.json: the SEG version that was asked, and what it said. */
export function floorRecord(triage, row, section, segRefusals) {
  const { repo, commit } = triage.source;
  const raw = (p) => `https://raw.githubusercontent.com/${repo}/${commit}/${p.split("/").map(encodeURIComponent).join("/")}`;
  const f = row.facts;
  const lic = licenceOf(row.model, section);
  const refused = row.bucket === "refused";
  if (refused && !row.seg_refusal) throw new Error(`${row.model}: refused, but SEG's answer is not in triage/seg-refusals.json`);
  return {
    id: row.id,
    id_method: row.id_method,
    title: row.model,
    status: row.bucket,
    // a refusal says which SEG said so: refused by SEG itself, or no evidence by triage with SEG not objecting
    refusal: {
      reason: refused ? row.seg_refusal.reason : row.reason,
      detail: detailOf(row),
      decided_by: refused ? "seg" : "triage",
      seg_version: refused ? row.seg_refusal.seg_version : segRefusals.seg_version,
    },
    parts: null,
    source: {
      url: raw(row.path),
      page: `https://github.com/${repo}/blob/${commit}/${row.path}`,
      commit,
      sha256: row.sha256,
      bytes: row.bytes,
      licence: lic.licence,
      ...(lic.licence_url ? { licence_url: lic.licence_url } : {}),
      ...(lic.licence_note ? { licence_note: lic.licence_note } : {}),
      attribution: section.text,
      name: path.posix.basename(row.path),
      files: row.source.files,
    },
    modifications: ["None. No segmentation was made: the asset is recorded so that the denominator is complete."],
    packaging: "none",
    verification: { status: "seeded", reviews: [] },
    triage: {
      source: `${repo}@${commit}`,
      facts: { meshes: f.meshes, materials: f.materials, primitives: f.primitives, triangles: f.triangles, hasUVs: f.hasUVs, hasBaseColourTexture: f.hasBaseColourTexture, skinned: f.skinned, morphTargets: f.morphTargets },
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
  const triage = JSON.parse(await readFile("triage/khronos-2.0.json", "utf8"));
  const segRefusals = JSON.parse(await readFile("triage/seg-refusals.json", "utf8"));
  const rows = triage.assets.filter((a) => a.canonical && (a.bucket === "refused" || a.bucket === "no-evidence"));
  const counts = {};
  const keep = new Set();
  for (const row of rows) {
    const readme = (await fetchPinned(triage.source, `${path.posix.dirname(path.posix.dirname(row.path))}/README.md`)).toString("utf8");
    const section = licenceSection(readme);
    if (!section) throw new Error(`${row.model}: README has no licence section`);
    const rec = floorRecord(triage, row, section, segRefusals);
    counts[rec.status] = (counts[rec.status] ?? 0) + 1;
    keep.add(recordPath(rec.id));
    if (!values["dry-run"]) {
      await mkdir(path.dirname(recordPath(rec.id)), { recursive: true });
      await writeFile(recordPath(rec.id), JSON.stringify(rec, null, 2) + "\n");
    }
  }
  // an asset SEG no longer refuses is not on the floor: its old record goes
  for (const dir of await readdir("objects")) {
    if (!/^[0-9a-f]{2}$/.test(dir)) continue;
    for (const f of await readdir(path.join("objects", dir))) {
      const p = `objects/${dir}/${f}`;
      if (!f.endsWith(".json") || keep.has(p)) continue;
      const rec = JSON.parse(await readFile(p, "utf8"));
      if (rec.status === "refused" || rec.status === "no-evidence") {
        console.log(`${values["dry-run"] ? "would remove" : "removing"} ${p} (${rec.title}): no longer on the floor`);
        if (!values["dry-run"]) await rm(p);
      }
    }
  }
  console.log(`${values["dry-run"] ? "would write" : "wrote"} ${rows.length} records`, counts);
}
