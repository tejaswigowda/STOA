#!/usr/bin/env node
// Aggregate recovery results (recovery work order, part C).
//
//   node tools/report.mjs results/recovery.jsonl [more.jsonl ...] [--mode materials] [--json]
//
// Macro is the headline: the mean of per-model scores, every model weighted equally. Micro pools
// every part and so weights by part count; on Tier A two models (VC, ABeautifulGame) are most of
// the parts, so micro describes the corpus and macro describes the method. Both are printed, with
// every per-model row, and with the index-bearing share of the naming denominator.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { VERDICTS, aggregate, mean, modelScores, residualStructure, share } from "./stats.mjs";

export { VERDICTS, aggregate, modelScores, residualStructure };

const pct = (v) => (v === null || v === undefined ? "-" : (100 * v).toFixed(1) + "%");
const num = (v) => (v === null || v === undefined ? "-" : v.toFixed(3));

export function toMarkdown(models, agg, mode, residual = null, handover = null) {
  const L = [`# Recovery results (${mode})`, ""];
  L.push("Khronos is an upper bound: hand-built, carefully unwrapped, small." + (mode === "materials" ? " `--mode materials` is the ceiling test (material boundaries are handed over), not the production case." : ""), "");
  L.push("## Structure (all models)", "", "| | models | mean best IoU | recovery rate | part-count ratio | reverse IoU |", "|---|--:|--:|--:|--:|--:|");
  const s = agg.structure;
  L.push(`| **macro** (headline) | ${s.models} | ${num(s.macro.mean_best_iou)} | ${pct(s.macro.recovery_rate)} | ${num(s.macro.part_count_ratio)} | ${num(s.macro.mean_reverse_best_iou)} |`);
  L.push(`| micro (${s.micro.parts} parts pooled) | ${s.models} | ${num(s.micro.mean_best_iou)} | ${pct(s.micro.recovery_rate)} | | |`, "");
  L.push("| model | tier | parts | mean best IoU | recovery rate | part-count ratio | reverse IoU |", "|---|:-:|--:|--:|--:|--:|--:|");
  for (const x of models) L.push(`| ${x.model} | ${x.tier ?? "-"} | ${x.structure.parts} | ${num(x.structure.mean_best_iou)} | ${pct(x.structure.recovery_rate)} | ${num(x.structure.part_count_ratio)} | ${num(x.structure.mean_reverse_best_iou)} |`);
  if (residual && handover) {
    const t = handover.total;
    L.push("", "## What the material boundary hands over", "",
      `${t.exact_by_material} of ${t.parts} original parts (${pct(t.exact_share)}) are exactly one material's mesh, so the importer recovers them before SEG runs (Tier A: ${t.tier_a.exact_by_material} of ${t.tier_a.parts}, ${pct(t.tier_a.exact_share)}). In Tier A, ${t.tier_a.overlapping} of ${t.tier_a.parts} authored part names (${pct(t.tier_a.overlap_share)}) also share a word with their material's name (an upper bound). The scores above include those parts. **On the ${residual.parts} parts the boundary does not hand over** (${residual.models} models) the structure scores are:`, "",
      "| | models | mean best IoU | recovery rate |", "|---|--:|--:|--:|",
      `| macro | ${residual.models} | ${num(residual.macro.mean_best_iou)} | ${pct(residual.macro.recovery_rate)} |`,
      `| micro (${residual.parts} parts) | ${residual.models} | ${num(residual.micro.mean_best_iou)} | ${pct(residual.micro.recovery_rate)} |`, "",
      `Tier A residual naming: ${residual.naming.parts} parts, ${residual.naming.same} same, ${residual.naming.grain} grain, ${residual.naming.wrong} wrong, ${residual.naming.abstained} abstained, ${residual.naming.unmatched_or_below} unmatched or below the IoU threshold.`);
  }
  if (agg.naming) {
    const n = agg.naming;
    L.push("", "## Naming (Tier A only)", "");
    L.push(`${n.parts} parts across ${n.models} models. Instance indices are stripped from authored names before comparison; **${n.index_bearing} of ${n.parts} parts (${pct(n.index_bearing_share)}) carry one**, so the naming score rests on what remains. The largest model is ${pct(n.largest_model_share)} of the parts.`, "");
    if (n.pending) L.push(`**${n.pending} matched pairs have no judge verdict yet; naming rates are not reported until every pair is judged.**`, "");
    else L.push("| | matched and judged same-or-grain, of all Tier A parts |", "|---|--:|", `| **macro** (headline) | ${pct(n.macro.same_or_grain_rate)} |`, `| micro | ${pct(n.micro.same_or_grain_rate)} |`, "");
    if (n.judged_pairs) {
      L.push(`Of ${n.judged_pairs} matched pairs, SEG's plan **named** the part (claimed what it is) in ${n.named_pairs} and **described** it (abstained: shape, colour, position) in ${n.descriptive_pairs}. When it named: ${n.named_same_or_grain} same-or-grain, ${n.named_wrong} wrong (${pct(n.named_pairs ? n.named_same_or_grain / n.named_pairs : null)} right). When it only described: ${n.descriptive_same_or_grain} same-or-grain. The judges ruled every abstention wrong (their rubric has no category for it); those are recorded here as abstained.`, "");
    }
    L.push("| model | parts | index-bearing | same | grain | wrong | abstained | unmatched | below-threshold | no-name | pending |", "|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
    for (const x of models.filter((y) => y.naming)) {
      const k = x.naming;
      L.push(`| ${x.model} | ${k.parts} | ${k.index_bearing} (${pct(k.index_bearing_share)}) | ${k.same} | ${k.grain} | ${k.wrong} | ${k.abstained} | ${k.unmatched} | ${k["below-threshold"]} | ${k["no-name"]} | ${k.pending} |`);
    }
  }
  return L.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { mode: { type: "string", default: "materials" }, json: { type: "boolean", default: false }, handover: { type: "string" }, site: { type: "boolean", default: false }, check: { type: "boolean", default: false } } });
  if (values.site) {
    // the results site: generated from the JSONL, never typed. --check fails if the committed files differ.
    const { buildSite, loadSiteData } = await import("./page.mjs");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const files = buildSite(loadSiteData("."));
    let bad = 0;
    for (const [file, content] of Object.entries(files)) {
      const want = Buffer.from(content);
      if (values.check) {
        const have = await readFile(file).catch(() => null);
        if (!have || !have.equals(want)) { console.error(`${file} is out of date; run: node tools/report.mjs --site`); bad++; }
      } else {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, want);
      }
    }
    console.log(`${values.check ? "checked" : "wrote"} ${Object.keys(files).length} files`);
    process.exit(bad ? 1 : 0);
  }
  if (!positionals.length) {
    console.error("usage: report.mjs <results.jsonl>... [--mode materials] [--json]");
    process.exit(2);
  }
  const rows = [];
  for (const f of positionals) for (const line of (await readFile(f, "utf8")).split("\n")) if (line.trim()) rows.push(JSON.parse(line));
  const byModel = new Map();
  for (const r of rows.filter((x) => x.mode === values.mode)) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);
  const models = [...byModel.values()].map(modelScores).sort((a, b) => a.model.localeCompare(b.model));
  const agg = aggregate(models);
  const handover = values.handover ? JSON.parse(await readFile(values.handover, "utf8")) : null;
  const residual = handover ? residualStructure(rows.filter((x) => x.mode === values.mode), handover) : null;
  process.stdout.write(values.json ? JSON.stringify({ mode: values.mode, models, ...agg, residual }, null, 2) + "\n" : toMarkdown(models, agg, values.mode, residual, handover));
}
