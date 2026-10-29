#!/usr/bin/env node
// Run the recovery measurement through the real editor (recovery work order "get to the number").
//
//   node tools/recovery-run.mjs identity <model> [--mode materials|single] [--wrong-offset]
//        a plan built from the answer key: every metric must be 1.0, and a wrong offset must not be (N1, N2)
//   node tools/recovery-run.mjs evidence <model> [--mode materials] [--out file]
//        what a plan author sees: SEG's report per mesh. No answer key, no authored part names
//   node tools/recovery-run.mjs check <model> --plans plans.json [--mode materials]
//        do SEG's cuts and report what it refused. Prints no scores; this is what a plan author may run
//   node tools/recovery-run.mjs run <model> --plans plans.json [--mode materials] [--out results.jsonl]
//        cut with the authored plans, build recovered.json from the records, score
//
// Needs the editor served (cd strata-editor && node server.js 5611) and playwright-core; see seg-browser.mjs.
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { flatten } from "./flatten.mjs";
import { loadCanonicalGlb, fetchPinned } from "./khronos.mjs";
import { licenceLabel, licenceSection } from "./seed-floor.mjs";
import { recoveredFromRecords } from "./recovered-from-record.mjs";
import { sha256 } from "./lib.mjs";
import { scoreStructure, toRecords, triangleAreas } from "./score.mjs";
import * as browser from "./seg-browser.mjs";

export const letters = (n) => {
  let o = "";
  do { o = String.fromCharCode(97 + (n % 26)) + o; n = Math.floor(n / 26); } while (n > 0);
  return o;
};

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "part";

/** The pinned, hashed source of the original asset (not of the flattened derivation, which is in `modifications`). */
export async function sourceFor(triage, row) {
  const { repo, commit } = triage.source;
  const readme = (await fetchPinned(triage.source, `${path.posix.dirname(path.posix.dirname(row.path))}/README.md`)).toString("utf8");
  const section = licenceSection(readme);
  let licence;
  try { licence = licenceLabel(row.model, section); } catch { licence = section?.text.slice(0, 120) ?? "see source README"; }
  return {
    url: `https://raw.githubusercontent.com/${repo}/${commit}/${row.path.split("/").map(encodeURIComponent).join("/")}`,
    page: `https://github.com/${repo}/blob/${commit}/${row.path}`,
    commit, sha256: row.sha256, bytes: row.bytes, licence, attribution: section?.text ?? "see source README",
  };
}

export async function prepare(model, mode) {
  const triage = JSON.parse(await readFile("triage/khronos-2.0.json", "utf8"));
  const { row, glb } = await loadCanonicalGlb(triage, model);
  const { glb: flat, key } = flatten(glb, { mode });
  return { triage, row, flat, key, source: await sourceFor(triage, row) };
}

/** The meshes the importer made must be the primitives of the flattened mesh, in order, or every offset is wrong. */
export function checkMeshOrder(meshes, key, areas) {
  const groups = key.flattened.groups;
  if (meshes.length !== groups.length) throw new Error(`the importer made ${meshes.length} meshes for ${groups.length} primitives`);
  meshes.forEach((m, i) => {
    if (m.triangles !== groups[i].triangleCount) throw new Error(`mesh ${i} has ${m.triangles} triangles, primitive ${i} has ${groups[i].triangleCount}: the meshes are not in primitive order`);
    // the same count is not the same mesh: compare the surface the editor loaded with the surface of that primitive's triangles
    const want = areas.slice(groups[i].triangleStart, groups[i].triangleStart + groups[i].triangleCount).reduce((a, b) => a + b, 0);
    if (Math.abs(m.area - want) > 1e-4 * Math.max(want, 1e-9)) throw new Error(`mesh ${i} has surface area ${m.area}, primitive ${i} has ${want}: the meshes are not in primitive order`);
  });
}

/** Build recovered.json from per-mesh records (null for a mesh SEG refused) and score it against the key. */
export function scoreRecords({ key, flat, records, offsetGroups }) {
  const groups = offsetGroups ?? key.flattened.groups;
  const present = records.map((r, i) => ({ r, g: groups[i] })).filter((x) => x.r);
  const recovered = present.length ? recoveredFromRecords(present.map((x) => x.r), present.map((x) => x.g)) : { parts: [] };
  const result = scoreStructure(key.parts, triangleAreas(flat), recovered.parts);
  return { recovered, result };
}

export function meta(segVersion) {
  const git = (cwd, ...a) => { try { return execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8" }).trim(); } catch { return null; } };
  const strata = process.env.STRATA_DIR ?? path.join(process.env.HOME, "Downloads/strata-editor");
  return {
    scorer_sha256: sha256(readFileSync(here("./score.mjs"))),
    flatten_sha256: sha256(readFileSync(here("./flatten.mjs"))),
    seg_version: segVersion ?? null,
    stoa_commit: git(here(".."), "rev-parse", "HEAD"),
    stoa_dirty: Boolean(git(here(".."), "status", "--porcelain", "tools")),
    strata_commit: git(strata, "rev-parse", "HEAD"),
    strata_dirty: Boolean(git(strata, "status", "--porcelain", "docs/editor/js/intelligence")),
  };
}

const FLATTEN_NOTE = (mode) => `The model was flattened to one mesh (tools/flatten.mjs, --mode ${mode}) and imported through the glTF importer, which makes one mesh per material; each mesh was cut separately.`;

// ------------------------------------------------------------------ identity

async function identity(model, mode, wrongOffset) {
  const { row, flat, key, source } = await prepare(model, mode);
  const h = await browser.openEditor();
  try {
    const meshes = await browser.importGlb(h, flat);
    checkMeshOrder(meshes, key, triangleAreas(flat));
    const owner = new Map();
    key.parts.forEach((p, pi) => p.triangles.forEach((t) => owner.set(t, pi)));
    const records = [];
    for (const [i, g] of key.flattened.groups.entries()) {
      const islands = await browser.islandsOf(h, i);
      const byPart = new Map();
      islands.forEach((tris, isl) => {
        const owners = new Set(tris.map((t) => owner.get(g.triangleStart + t)));
        if (owners.size !== 1) throw new Error(`mesh ${i}: island ${isl} straddles ${owners.size} original parts, so an identity plan does not exist`);
        const [pi] = owners;
        byPart.set(pi, [...(byPart.get(pi) ?? []), isl]);
      });
      const plan = {
        group: `${model}_Identity_${letters(i)}`, classes: ["identity"], source, modifications: [FLATTEN_NOTE(mode)],
        parts: [...byPart].map(([pi, island]) => ({ name: key.parts[pi].name, island, classes: [slug(key.parts[pi].name)] })),
      };
      records.push((await browser.cut(h, i, plan)).record);
    }
    let offsetGroups;
    if (wrongOffset) {
      // the likely real bug: the first two meshes come in the other order. Offsets stay disjoint, so only the score can notice
      offsetGroups = key.flattened.groups.map((g) => ({ ...g }));
      offsetGroups[1].triangleStart = 0;
      offsetGroups[0].triangleStart = offsetGroups[1].triangleCount;
    }
    const { result } = scoreRecords({ key, flat, records, offsetGroups });
    return { model, mode, tier: row.tier, wrongOffset: !!wrongOffset, summary: result.summary, seg_version: records[0]?.seg_version, meshes: meshes.length };
  } finally {
    await h.close();
  }
}

// -------------------------------------------------------------------- evidence

async function dumpEvidence(model, mode) {
  const { flat, key } = await prepare(model, mode);
  const h = await browser.openEditor();
  try {
    const meshes = await browser.importGlb(h, flat);
    checkMeshOrder(meshes, key, triangleAreas(flat));
    const out = { model: "(blind)", mode, meshes: [] };
    for (const m of meshes) {
      const ev = await browser.evidence(h, m.index);
      out.meshes.push({ mesh: m.index, material: m.material, triangles: m.triangles, describe: ev.describe, data: ev.data });
    }
    return out;
  } finally {
    await h.close();
  }
}

// ------------------------------------------------------------------------- run

/** Cut every mesh with its authored plan. A refusal is a result, not a crash: it is returned with its reason. */
async function cutAll(h, plans, meshes, source, mode) {
  const records = meshes.map(() => null);
  const failures = [];
  for (const entry of plans.meshes) {
    const i = entry.mesh;
    try {
      if (!meshes[i]) throw new Error(`there is no mesh ${i} (the model has ${meshes.length})`);
      let plan = entry.plan;
      if (entry.whole) {
        const islands = await browser.islandsOf(h, i);
        const classes = entry.whole.classes ?? ["part"];
        plan = { group: entry.whole.group, classes, parts: [{ name: entry.whole.name, island: islands.map((_, k) => k), classes }] };
      }
      plan = { ...plan, source, modifications: [FLATTEN_NOTE(mode), ...[].concat(plan.modifications ?? [])] };
      records[i] = (await browser.cut(h, i, plan, plan.method === "material" ? "material" : "islands")).record;
    } catch (e) {
      failures.push({ mesh: i, material: meshes[i]?.material, triangles: meshes[i]?.triangles, reason: String(e.message).split("\n")[0].slice(0, 300) });
    }
  }
  for (const m of meshes) if (!plans.meshes.some((e) => e.mesh === m.index)) failures.push({ mesh: m.index, material: m.material, triangles: m.triangles, reason: "no plan for this mesh" });
  return { records, failures };
}

/** What a plan author may run: do SEG's cuts and say what it refused. Never scores, never reads the key into the output. */
async function check(model, mode, plansFile) {
  const { flat, key, source } = await prepare(model, mode);
  const plans = JSON.parse(await readFile(plansFile, "utf8"));
  const h = await browser.openEditor();
  try {
    const meshes = await browser.importGlb(h, flat);
    checkMeshOrder(meshes, key, triangleAreas(flat));
    const { records, failures } = await cutAll(h, plans, meshes, source, mode);
    return { meshes: meshes.length, cut: records.filter(Boolean).length, parts: records.filter(Boolean).reduce((a, r) => a + Object.keys(r.parts).length, 0), refused: failures };
  } finally {
    await h.close();
  }
}

async function run(model, mode, plansFile, outFile) {
  const { row, flat, key, source } = await prepare(model, mode);
  const plans = JSON.parse(await readFile(plansFile, "utf8"));
  const h = await browser.openEditor();
  try {
    const meshes = await browser.importGlb(h, flat);
    checkMeshOrder(meshes, key, triangleAreas(flat));
    const { records, failures } = await cutAll(h, plans, meshes, source, mode);
    const { recovered, result } = scoreRecords({ key, flat, records });
    const base = {
      ...meta(records.find(Boolean)?.seg_version),
      plans_sha256: sha256(Buffer.from(JSON.stringify(plans))), recovered_sha256: sha256(Buffer.from(JSON.stringify(recovered))), flattened_sha256: key.flattened.sha256,
    };
    const rows = toRecords({ meta: base, model, id: row.id, tier: row.tier ?? null, mode, parts: key.parts, recovered: recovered.parts, result });
    for (const f of failures) rows.push({ ...base, model, id: row.id, tier: row.tier ?? null, mode, kind: "refusal", ...f });
    if (outFile) {
      await mkdir(path.dirname(outFile), { recursive: true });
      await appendFile(outFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    }
    return { model, mode, tier: row.tier, summary: result.summary, failures, rows: rows.length };
  } finally {
    await h.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { mode: { type: "string", default: "materials" }, plans: { type: "string" }, out: { type: "string" }, "wrong-offset": { type: "boolean", default: false } },
  });
  // a plan author is given a code instead of the model's name (STOA_BLIND_MAP: { "M01": "Lantern" })
  const blind = process.env.STOA_BLIND_MAP ? JSON.parse(readFileSync(process.env.STOA_BLIND_MAP, "utf8")) : {};
  const [cmd, code] = positionals;
  const model = blind[code] ?? code;
  if (cmd === "identity" && model) {
    const r = await identity(model, values.mode, values["wrong-offset"]);
    console.log(JSON.stringify(r, null, 2));
    const s = r.summary;
    const perfect = s.mean_best_iou > 1 - 1e-9 && s.recovery_rate === 1 && s.part_count_ratio === 1 && s.mean_reverse_best_iou > 1 - 1e-9;
    if (values["wrong-offset"] ? perfect : !perfect) process.exitCode = 1;
  } else if (cmd === "evidence" && model) {
    const text = JSON.stringify(await dumpEvidence(model, values.mode), null, 1) + "\n";
    if (values.out) await writeFile(values.out, text); else process.stdout.write(text);
  } else if (cmd === "check" && model && values.plans) {
    console.log(JSON.stringify(await check(model, values.mode, values.plans), null, 1));
  } else if (cmd === "run" && model && values.plans) {
    console.log(JSON.stringify(await run(model, values.mode, values.plans, values.out), null, 2));
  } else {
    console.error("usage: recovery-run.mjs identity|evidence|check|run <model> [--mode materials|single] [--plans file] [--out file] [--wrong-offset]");
    process.exit(2);
  }
}
