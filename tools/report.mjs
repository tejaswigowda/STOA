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
import { parseArgs } from "node:util";

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const share = (n, d) => (d ? n / d : null);

export const VERDICTS = ["same", "grain", "wrong"];

/** Per-model structure and naming numbers from the rows of one model (one mode). */
export function modelScores(rows) {
  const orig = rows.filter((r) => r.kind === "original");
  const rec = rows.filter((r) => r.kind === "recovered");
  const first = orig[0] ?? rec[0];
  const out = {
    model: first.model, tier: first.tier, mode: first.mode,
    structure: {
      parts: orig.length,
      mean_best_iou: mean(orig.map((r) => r.best_iou)),
      recovery_rate: share(orig.filter((r) => r.matched).length, orig.length),
      part_count_ratio: share(rec.length, orig.length),
      mean_reverse_best_iou: mean(rec.map((r) => r.best_iou)),
    },
  };
  if (first.tier === "A") {
    const n = { same: 0, grain: 0, wrong: 0, pending: 0, unmatched: 0, "below-threshold": 0, "no-name": 0 };
    for (const r of orig) {
      if (r.failure) n[r.failure]++;
      else if (VERDICTS.includes(r.verdict)) n[r.verdict]++;
      else n.pending++;
    }
    const judged = n.pending === 0;
    const indexed = orig.filter((r) => r.index_bearing).length;
    out.naming = {
      parts: orig.length, ...n,
      index_bearing: indexed,
      index_bearing_share: share(indexed, orig.length),
      // unmatched, below-threshold and no-name stay in the denominator: they are naming failures too
      same_rate: judged ? share(n.same, orig.length) : null,
      same_or_grain_rate: judged ? share(n.same + n.grain, orig.length) : null,
    };
  }
  return out;
}

export function aggregate(models) {
  const m = (xs, f) => mean(xs.map(f).filter((v) => v !== null));
  const structure = models.map((x) => x.structure);
  const naming = models.filter((x) => x.naming).map((x) => x.naming);
  const sum = (xs, k) => xs.reduce((a, x) => a + x[k], 0);
  const parts = sum(structure, "parts") || 1;
  const judged = naming.length > 0 && naming.every((n) => n.same_rate !== null);
  return {
    structure: {
      models: models.length,
      macro: {
        mean_best_iou: m(structure, (s) => s.mean_best_iou), recovery_rate: m(structure, (s) => s.recovery_rate),
        part_count_ratio: m(structure, (s) => s.part_count_ratio), mean_reverse_best_iou: m(structure, (s) => s.mean_reverse_best_iou),
      },
      micro: {
        parts: sum(structure, "parts"),
        mean_best_iou: structure.reduce((a, s) => a + s.mean_best_iou * s.parts, 0) / parts,
        recovery_rate: structure.reduce((a, s) => a + s.recovery_rate * s.parts, 0) / parts,
      },
    },
    naming: naming.length === 0 ? null : {
      models: naming.length,
      parts: sum(naming, "parts"),
      index_bearing: sum(naming, "index_bearing"),
      index_bearing_share: share(sum(naming, "index_bearing"), sum(naming, "parts")),
      pending: sum(naming, "pending"),
      macro: judged ? { same_rate: m(naming, (n) => n.same_rate), same_or_grain_rate: m(naming, (n) => n.same_or_grain_rate) } : null,
      micro: judged ? { same_rate: sum(naming, "same") / sum(naming, "parts"), same_or_grain_rate: (sum(naming, "same") + sum(naming, "grain")) / sum(naming, "parts") } : null,
      largest_model_share: Math.max(...naming.map((n) => n.parts)) / (sum(naming, "parts") || 1),
    },
  };
}

const pct = (v) => (v === null || v === undefined ? "-" : (100 * v).toFixed(1) + "%");
const num = (v) => (v === null || v === undefined ? "-" : v.toFixed(3));

export function toMarkdown(models, agg, mode) {
  const L = [`# Recovery results (${mode})`, ""];
  L.push("Khronos is an upper bound: hand-built, carefully unwrapped, small." + (mode === "materials" ? " `--mode materials` is the ceiling test (material boundaries are handed over), not the production case." : ""), "");
  L.push("## Structure (all models)", "", "| | models | mean best IoU | recovery rate | part-count ratio | reverse IoU |", "|---|--:|--:|--:|--:|--:|");
  const s = agg.structure;
  L.push(`| **macro** (headline) | ${s.models} | ${num(s.macro.mean_best_iou)} | ${pct(s.macro.recovery_rate)} | ${num(s.macro.part_count_ratio)} | ${num(s.macro.mean_reverse_best_iou)} |`);
  L.push(`| micro (${s.micro.parts} parts pooled) | ${s.models} | ${num(s.micro.mean_best_iou)} | ${pct(s.micro.recovery_rate)} | | |`, "");
  L.push("| model | tier | parts | mean best IoU | recovery rate | part-count ratio | reverse IoU |", "|---|:-:|--:|--:|--:|--:|--:|");
  for (const x of models) L.push(`| ${x.model} | ${x.tier ?? "-"} | ${x.structure.parts} | ${num(x.structure.mean_best_iou)} | ${pct(x.structure.recovery_rate)} | ${num(x.structure.part_count_ratio)} | ${num(x.structure.mean_reverse_best_iou)} |`);
  if (agg.naming) {
    const n = agg.naming;
    L.push("", "## Naming (Tier A only)", "");
    L.push(`${n.parts} parts across ${n.models} models. Instance indices are stripped from authored names before comparison; **${n.index_bearing} of ${n.parts} parts (${pct(n.index_bearing_share)}) carry one**, so the naming score rests on what remains. The largest model is ${pct(n.largest_model_share)} of the parts.`, "");
    if (n.pending) L.push(`**${n.pending} matched pairs have no judge verdict yet; naming rates are not reported until every pair is judged.**`, "");
    else L.push("| | same | same or grain |", "|---|--:|--:|", `| **macro** (headline) | ${pct(n.macro.same_rate)} | ${pct(n.macro.same_or_grain_rate)} |`, `| micro | ${pct(n.micro.same_rate)} | ${pct(n.micro.same_or_grain_rate)} |`, "");
    L.push("| model | parts | index-bearing | same | grain | wrong | unmatched | below-threshold | no-name | pending | same rate |", "|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
    for (const x of models.filter((y) => y.naming)) {
      const k = x.naming;
      L.push(`| ${x.model} | ${k.parts} | ${k.index_bearing} (${pct(k.index_bearing_share)}) | ${k.same} | ${k.grain} | ${k.wrong} | ${k.unmatched} | ${k["below-threshold"]} | ${k["no-name"]} | ${k.pending} | ${pct(k.same_rate)} |`);
    }
  }
  return L.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { mode: { type: "string", default: "materials" }, json: { type: "boolean", default: false } } });
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
  process.stdout.write(values.json ? JSON.stringify({ mode: values.mode, models, ...agg }, null, 2) + "\n" : toMarkdown(models, agg, values.mode));
}
