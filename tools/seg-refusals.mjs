#!/usr/bin/env node
// Ask SEG, not a reimplementation of its rules, which floor assets it would refuse (work order B).
//
//   node tools/seg-refusals.mjs [--out triage/seg-refusals.json]
//
// Imports each refused / no-evidence asset through the real editor and calls SEG.wouldRefuse on every
// mesh it makes. An asset is refused when SEG would refuse any of its meshes. The answer is filed with
// the SEG version that gave it, so the floor stays auditable as SEG grows.
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadCanonicalGlb } from "./khronos.mjs";
import * as browser from "./seg-browser.mjs";

const { values } = parseArgs({ options: { out: { type: "string", default: "triage/seg-refusals.json" } } });
const triage = JSON.parse(await readFile("triage/khronos-2.0.json", "utf8"));
const rows = triage.assets.filter((a) => a.canonical && ["refused", "no-evidence"].includes(a.bucket));
const shared = await browser.launchBrowser();
const models = {};
let segVersion = null;
try {
  for (const row of rows) {
    const h = await browser.openEditor({ browser: shared });
    try {
      const { glb } = await loadCanonicalGlb(triage, row.model);
      const meshes = await browser.importGlb(h, glb, `${row.model}.glb`);
      const per = [];
      for (const m of meshes) per.push(await browser.wouldRefuse(h, m.index));
      const refusals = per.filter(Boolean);
      segVersion ??= refusals[0]?.seg_version ?? (await h.page.evaluate(() => window.__core.SEG_VERSION));
      models[row.model] = {
        meshes: meshes.length,
        refused: refusals.length ? { reason: refusals[0].reason, detail: refusals[0].detail, meshes_refused: refusals.length } : null,
      };
    } catch (e) {
      models[row.model] = { meshes: 0, refused: { reason: "import-failed", detail: String(e.message).split("\n")[0].slice(0, 200), meshes_refused: 0 } };
    } finally {
      await h.close();
    }
    const r = models[row.model];
    console.log(`${row.model.padEnd(28)} ${r.refused ? `REFUSED ${r.refused.reason}` : "accepted"} (${r.meshes} meshes)`);
  }
} finally {
  await shared.close();
}
await writeFile(values.out, JSON.stringify({ seg_version: segVersion, source: "SEG.wouldRefuse, no plan: what is wrong with the mesh itself", models }, null, 2) + "\n");
console.log(`wrote ${values.out} (SEG ${segVersion})`);
