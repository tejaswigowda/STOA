// The results site (results work order). Every figure is computed from the JSONL; nothing is typed.
// `buildSite(data)` returns { path -> string | Buffer }. tools/report.mjs --site writes it to docs/ and --site --check
// fails if what is committed differs, the same discipline as index/objects.json from git ls-tree.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { aggregate, modelScores, residualStructure } from "./stats.mjs";
import { ogPng } from "./og-image.mjs";

export const REPO = "https://github.com/tejaswigowda/STOA";
export const SITE = "https://tejaswigowda.github.io/STOA/";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct1 = (v) => (v == null ? "-" : (100 * v).toFixed(1) + "%");
const pct0 = (v) => (v == null ? "-" : Math.round(100 * v) + "%");
const f3 = (v) => (v == null ? "-" : v.toFixed(3));
const int = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const uniq = (xs) => [...new Set(xs.filter(Boolean))].sort();

const readJsonl = (f) => readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

/** Everything the site is built from, read from the repository. */
export function loadSiteData(root = ".") {
  const at = (p) => path.join(root, p);
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8" }).trim();
  const dataPaths = ["results/recovery-materials.jsonl", "results/recovery-single.jsonl", "results/plans", "results/material-name-overlap.json"];
  const planDir = at("results/plans/materials");
  return {
    rows: readJsonl(at("results/recovery-materials.jsonl")),
    singleRows: readJsonl(at("results/recovery-single.jsonl")),
    plans: Object.fromEntries(readdirSync(planDir).filter((f) => f.endsWith(".json")).map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(path.join(planDir, f), "utf8"))])),
    handover: JSON.parse(readFileSync(at("results/material-name-overlap.json"), "utf8")),
    triage: JSON.parse(readFileSync(at("triage/khronos-2.0.json"), "utf8")),
    jsonlSha256: sha(readFileSync(at("results/recovery-materials.jsonl"))),
    commit: git("log", "-1", "--format=%H", "--", ...dataPaths),
  };
}

// ----------------------------------------------------------------------------- numbers

export function compute(d) {
  const byModel = new Map();
  for (const r of d.rows) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);
  const models = [...byModel.values()].map(modelScores).sort((a, b) => a.model.localeCompare(b.model));
  const agg = aggregate(models);
  const residual = residualStructure(d.rows, d.handover);
  const A = d.rows.filter((r) => r.kind === "original" && r.tier === "A");
  const judged = A.filter((r) => r.verdict);
  const isRight = (r) => r.verdict === "same" || r.verdict === "grain";
  const named = judged.filter((r) => r.recovered_label === "named");
  const described = judged.filter((r) => r.recovered_label === "descriptive");
  const count = (rs, v) => rs.filter((r) => r.verdict === v).length;
  const kappa = (xa, xb) => {
    const cats = ["same", "grain", "wrong"], n = xa.length;
    const po = xa.filter((v, i) => v === xb[i]).length / n;
    const pe = cats.reduce((s, c) => s + (xa.filter((v) => v === c).length / n) * (xb.filter((v) => v === c).length / n), 0);
    return { n, agree: xa.filter((v, i) => v === xb[i]).length, kappa: (po - pe) / (1 - pe), sameOrGrainAgree: xa.filter((v, i) => (v === "wrong") === (xb[i] === "wrong")).length };
  };
  const ja = judged.map((r) => r.judge_a), jb = judged.map((r) => r.judge_b);
  const nth = (key, v) => judged.filter((r) => r[key] === v).length;
  const tier = (m) => d.triage.assets.find((a) => a.canonical && a.model === m);
  const ids = (plan) => Math.max(0, ...plan.meshes.map((e) => (JSON.stringify(e.plan?.parts ?? []).match(/\d+/g) ?? []).length));
  const idCounts = Object.entries(d.plans).map(([m, p]) => [m, ids(p)]).sort((a, b) => b[1] - a[1]);
  const bySize = [...models].sort((a, b) => b.structure.parts - a.structure.parts);
  const top2 = bySize.slice(0, 2);
  const tierAParts = d.triage.assets.filter((a) => a.canonical && a.tier === "A");
  return {
    models, agg, residual, judged, tier,
    headline: {
      pairs: judged.length, named: named.length, namedRight: named.filter(isRight).length, namedWrong: count(named, "wrong"),
      precision: named.filter(isRight).length / named.length, coverage: named.length / judged.length,
      described: described.length, describedRight: described.filter(isRight).length, abstained: count(judged, "abstained"),
      belowThreshold: A.filter((r) => r.failure === "below-threshold").length, unmatched: A.filter((r) => r.failure === "unmatched").length, noName: A.filter((r) => r.failure === "no-name").length,
      leak: d.handover.total.tier_a.overlap_share, distinctNames: sum(tierAParts.map((a) => a.parts)),
    },
    judges: { sameA: nth("judge_a", "same"), sameB: nth("judge_b", "same"), sameConsensus: count(judged, "same"), ...kappa(ja, jb), tiebreak: judged.filter((r) => r.judge_c).length },
    refusals: d.rows.filter((r) => r.kind === "refusal").length,
    maxIdsInOnePlan: idCounts[0], segVersions: uniq(d.rows.map((r) => r.seg_version)),
    stratoDirty: d.rows.some((r) => r.strata_dirty),
    scorers: uniq(d.rows.map((r) => r.scorer_sha256)), flatteners: uniq(d.rows.map((r) => r.flatten_sha256)),
    topTwo: { names: top2.map((m) => m.model), share: sum(top2.map((m) => m.structure.parts)) / sum(models.map((m) => m.structure.parts)), iou: sum(top2.map((m) => m.structure.mean_best_iou * m.structure.parts)) / sum(top2.map((m) => m.structure.parts)) },
    tierStructure: Object.fromEntries(["A", "B", "C"].map((t) => {
      const ms = models.filter((m) => m.tier === t);
      return [t, { n: ms.length, iou: sum(ms.map((m) => m.structure.mean_best_iou)) / ms.length, rec: sum(ms.map((m) => m.structure.recovery_rate)) / ms.length }];
    })),
  };
}

// ------------------------------------------------------------------------------ html

const CSS = `body{font:16px/1.5 system-ui,sans-serif;max-width:68rem;margin:0 auto;padding:1rem 1.2rem 4rem;color:#181818;background:#fafaf7}
h1{font-size:1.7rem;margin:.6rem 0}h2{margin-top:2.2rem;border-top:1px solid #ddd;padding-top:1rem}code,pre{font:13px ui-monospace,monospace}
.banner{background:#fff3cd;border:2px solid #b8860b;padding:.8rem 1rem;font-weight:600}.trace{background:#eef3ee;border-left:4px solid #006440;padding:.6rem 1rem;font-size:14px}
.headline{font-size:1.25rem;border-left:5px solid #006440;padding-left:1rem}table{border-collapse:collapse;width:100%;font-size:13px;margin:.6rem 0}
th,td{border-bottom:1px solid #ddd;padding:.25rem .5rem;text-align:right}th:first-child,td:first-child,td.l,th.l{text-align:left}th{cursor:pointer;background:#f0f0ea;position:sticky;top:0}
.nav a{margin-right:1rem}.fail li{margin:.4rem 0}.small{font-size:13px;color:#555}svg text{font:12px sans-serif}.filter button{margin-right:.4rem}`;

function page({ title, description, url, image, body, rel = "" }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="STOA">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(description)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${esc(image)}">
<style>${CSS}</style><script src="${rel}sort.js" defer></script></head>
<body>${body}</body></html>
`;
}

const link = (href, text) => `<a href="${esc(href)}">${esc(text)}</a>`;
const mlink = (m) => link(`models/${m}.html`, m);

function bar(h) {
  const segs = [
    ["Named, same or grain", h.namedRight, "#006440"], ["Named, wrong", h.namedWrong, "#a00000"],
    ["Described, same or grain", h.describedRight, "#7fae9b"], ["Abstained (described, no match)", h.abstained, "#c8c8c0"],
  ];
  const total = sum(segs.map((s) => s[1]));
  let x = 0;
  const rects = segs.map(([label, n, color]) => {
    const w = (n / total) * 1000;
    const r = `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="34" fill="${color}"><title>${esc(label)}: ${n}</title></rect>`;
    x += w;
    return r;
  }).join("");
  const legend = segs.map(([label, n, color], i) => `<g transform="translate(${(i % 2) * 500},${56 + Math.floor(i / 2) * 20})"><rect width="12" height="12" fill="${color}"/><text x="18" y="11">${esc(label)}: ${n}</text></g>`).join("");
  return `<svg viewBox="0 0 1000 110" role="img" aria-label="${esc(`${total} judged pairs: ` + segs.map((s) => `${s[0]} ${s[1]}`).join(", "))}" width="100%">${rects}${legend}</svg>`;
}

const links = (c, d, model) => {
  const t = c.tier(model);
  return `${link(`${REPO}/blob/${c.commit}/results/plans/materials/${model}.json`, "plan")} · ${link(`models/${model}.html`, "rows")} · ${link(`https://raw.githubusercontent.com/${d.triage.source.repo}/${d.triage.source.commit}/${t.path}`, "source")}`;
};

function structureTable(c, d) {
  const rows = c.models.map((m) => {
    const t = c.tier(m.model), h = d.handover.models[m.model];
    return `<tr data-tier="${m.tier}"><td class="l">${mlink(m.model)}</td><td>${m.tier}</td><td>${m.structure.parts}</td><td>${t.facts.materials}</td><td>${t.facts.hasBaseColourTexture ? "yes" : "no"}</td><td>${f3(m.structure.mean_best_iou)}</td><td>${pct1(m.structure.recovery_rate)}</td><td>${f3(m.structure.part_count_ratio)}</td><td>${pct1(h.exact_share)}</td><td class="l">${links(c, d, m.model)}</td></tr>`;
  }).join("\n");
  return `<table id="structure"><thead><tr><th class="l">model</th><th>tier</th><th>parts</th><th>materials</th><th>textured</th><th>mean best IoU</th><th>recovery rate</th><th>part-count ratio</th><th>handed over by material</th><th class="l">links</th></tr></thead><tbody>
${rows}
</tbody></table>`;
}

function namingTable(c, d) {
  const rows = c.models.filter((m) => m.naming).map((m) => {
    const n = m.naming, h = d.handover.models[m.model];
    return `<tr data-tier="${m.tier}"><td class="l">${mlink(m.model)}</td><td>${n.parts}</td><td>${n.same}</td><td>${n.grain}</td><td>${n.same + n.grain}</td><td>${n.wrong}</td><td>${n.abstained}</td><td>${n["below-threshold"] + n.unmatched}</td><td>${pct1(n.index_bearing_share)}</td><td>${pct1(h.overlap_share)}</td><td class="l">${links(c, d, m.model)}</td></tr>`;
  }).join("\n");
  return `<table id="naming"><thead><tr><th class="l">model</th><th>parts</th><th>same</th><th>grain</th><th>same or grain</th><th>wrong</th><th>abstained</th><th>below threshold</th><th>index-bearing</th><th>name shares a word with its material</th><th class="l">links</th></tr></thead><tbody>
${rows}
</tbody></table>`;
}

function indexPage(c, d) {
  const h = c.headline, s = c.agg.structure, n = c.agg.naming, r = c.residual, t = d.handover.total, j = c.judges;
  const description = `When the plan names a part it is right ${pct0(h.precision)} of the time (${h.namedRight} of ${h.named}), possibly inflated by material-name leaks (${pct1(h.leak)} of Tier A names), and it names ${pct0(h.coverage)} of judged parts (${h.named} of ${h.pairs}). A ceiling, not production.`;
  const failing = c.models.filter((m) => m.structure.part_count_ratio >= 3).sort((a, b) => b.structure.part_count_ratio - a.structure.part_count_ratio);
  const gap = r.macro.mean_best_iou - s.macro.mean_best_iou;
  const residualNote = Math.abs(gap) < 0.02
    ? `essentially identical to the ${f3(s.macro.mean_best_iou)} overall, so the handover was not inflating the score`
    : `${gap > 0 ? "higher" : "lower"} than the ${f3(s.macro.mean_best_iou)} overall by ${f3(Math.abs(gap))}, so the handover does move the score`;
  const body = `
<p class="nav">${link(REPO, "STOA on GitHub")} ${link(`${REPO}/blob/${c.commit}/results/README.md`, "results notes")}</p>
<div class="banner" id="ceiling">This is a ceiling, not production. The models are Khronos glTF samples: hand-built, carefully unwrapped and small, and the plan authors were handed every material boundary and every material name (<code>--mode materials</code>). Nothing here estimates how SEG does on photoscans, stock-store assets or Objaverse.</div>
<div class="trace" id="trace"><b>Traceability.</b> Every figure on this page is computed from ${link(`${REPO}/blob/${c.commit}/results/recovery-materials.jsonl`, "recovery-materials.jsonl")} (sha256 <code>${d.jsonlSha256.slice(0, 16)}…</code>) at commit <code>${c.commit.slice(0, 12)}</code>. Regenerate with <code>node tools/report.mjs --site</code>; CI fails if this page differs. Scorer sha256 ${c.scorers.map((x) => `<code>${x.slice(0, 16)}…</code>`).join(", ")}, flatten sha256 ${c.flatteners.map((x) => `<code>${x.slice(0, 16)}…</code>`).join(", ")}, SEG ${esc(c.segVersions.join(", "))}${c.stratoDirty ? " (the editor checkout had uncommitted changes)" : ""}. Links: ${link(`${REPO}/blob/${c.commit}/results/recovery-materials.jsonl`, "rows (JSONL)")} · ${link(`${REPO}/blob/${c.commit}/results/recovery-single.jsonl`, "Lantern, single mode (JSONL)")} · ${link(`${REPO}/blob/${c.commit}/results/recovery-materials.md`, "per-model markdown")} · ${link(`${REPO}/tree/${c.commit}/results/plans/materials`, "plans/materials/")}.</div>
<h1>STOA recovery measurement</h1>
<h2 id="headline">Headline</h2>
<p class="headline"><b>When the plan names a part it is right ${pct0(h.precision)} of the time (${h.namedRight} of ${h.named}), a figure that may be inflated because ${pct1(h.leak)} of Tier A authored part names share a word with their material's name, which the plan authors could see, and it names ${pct0(h.coverage)} of judged parts (${h.named} of ${h.pairs}).</b> The cross-tab of named or described, by leak or no leak, by verdict has not been computed; until it is, read the ${pct0(h.precision)} with that confound attached.</p>
${bar(h)}
<p>The other ${h.described} judged pairs the plan <i>described</i> (shape, colour, position) instead of naming; ${h.describedRight} of those were still ruled same-or-grain, and ${h.abstained} were ruled wrong by judges whose rubric had no category for declining to name. They are recorded as <b>abstained</b>: the pipeline was told to describe rather than guess when the evidence does not support a name, so scoring them as errors would misreport the method. That the rubric had no such category is itself a finding.</p>
<p><b>Structure:</b> over ${s.models} models and ${int(s.micro.parts)} parts the macro mean best IoU is <b>${f3(s.macro.mean_best_iou)}</b> and the macro recovery rate (parts with IoU ≥ 0.5) is <b>${pct1(s.macro.recovery_rate)}</b>. Macro is the headline: the pooled figures (${f3(s.micro.mean_best_iou)}, ${pct1(s.micro.recovery_rate)}) are dominated by the two largest scenes (${c.topTwo.names.map(mlink).join(" and ")}), which are ${pct1(c.topTwo.share)} of the parts and average ${f3(c.topTwo.iou)}. Macro mean best IoU by tier: A ${f3(c.tierStructure.A.iou)}, B ${f3(c.tierStructure.B.iou)}, C ${f3(c.tierStructure.C.iou)}.</p>
<p><b>Naming, all Tier A parts:</b> ${pct1(n.macro.same_or_grain_rate)} macro (${pct1(n.micro.same_or_grain_rate)} pooled) were matched and ruled same-or-grain. That counts abstentions against the method; read it with the precision and coverage above.</p>

<h2 id="material">What the material boundary already gives you</h2>
<p>${int(t.exact_by_material)} of ${int(t.parts)} parts (${pct1(t.exact_share)}) are exactly one material's mesh, recovered by the importer before SEG runs (Tier A: ${t.tier_a.exact_by_material} of ${t.tier_a.parts}, ${pct1(t.tier_a.exact_share)}). On the ${r.parts} parts it does not hand over (${r.models} models) the macro mean best IoU is ${f3(r.macro.mean_best_iou)} and the recovery rate ${pct1(r.macro.recovery_rate)}; pooled ${f3(r.micro.mean_best_iou)}, ${pct1(r.micro.recovery_rate)}. That macro IoU is ${residualNote}. In Tier A the residual is ${r.naming.parts} parts: ${r.naming.same} same, ${r.naming.grain} grain, ${r.naming.wrong} wrong, ${r.naming.abstained} abstained, ${r.naming.unmatched_or_below} below the threshold.</p>

<h2 id="denominators">Denominators</h2>
<ul><li>Structure: <b>${s.models} models</b>, <b>${int(s.micro.parts)} parts</b> (a part is a mesh instance).</li>
<li>Naming: <b>${n.models} Tier A models</b>, <b>${n.parts} instances</b>, ${h.distinctNames} distinct names. <b>${h.pairs} judged</b> pairs (IoU ≥ 0.5), <b>${h.belowThreshold} below threshold</b>, <b>${h.unmatched} unmatched</b>, ${h.noName} left unnamed by SEG.</li>
<li>Index-bearing: ${n.index_bearing} of ${n.parts} instances (${pct1(n.index_bearing_share)}) carry an instance index; authored names were compared with one trailing index group removed.</li></ul>

<h2 id="failures">The failure set</h2>
<p><i>This is an output, not a defect list. Nothing was fixed during the run.</i> Counts are computed; the descriptions are curated from the plan authors' logs in ${link(`${REPO}/tree/${c.commit}/results/plans/materials`, "plans/materials")}.</p>
<ul class="fail">
<li><b>Granularity mismatch.</b> ${failing.length} models recovered at least three parts for every original (part-count ratio): ${failing.map((m) => `${mlink(m.model)} ${m.structure.part_count_ratio.toFixed(1)}`).join(", ")}. Where an author grouped parts and the plan cut finer, IoU falls although nothing is geometrically wrong.</li>
<li><b>Evidence-limited naming.</b> The plan only described ${h.described} of ${h.pairs} judged parts. Many models have no colour evidence, no stated up or front axis (so left/right and front/back are assumed), and <code>at</code> is relative to each mesh, not the scene.</li>
<li><b>Instances SEG cannot separate.</b> Near-identical islands got ordinal or positional names, or were merged.</li>
<li><b>Plan-syntax friction.</b> Every island id must be listed (no range or "rest"): the largest plan lists ${c.maxIdsInOnePlan[1]} numbers in one mesh (${mlink(c.maxIdsInOnePlan[0])}).</li>
<li><b>Truncated <code>SEG.describe</code></b> on large meshes: authors planned by component, or condensed the text with a script, because island lists were cut off.</li>
<li><b><code>basis</code> list.</b> It accepts only position, size, colour and shape; two authors' first checks were refused for listing "material".</li>
<li><b>Editor log.</b> <code>Invalid string length</code> appeared in the console while cutting ${mlink("ABeautifulGame")}; the cut completed and scored (observed in the run, not recorded in the JSONL).</li>
<li><b>SEG refusals.</b> ${c.refusals} across ${c.models.length} models.</li></ul>

<h2 id="protocol">Protocol and deviations</h2>
<ul>
<li><b>Blindness.</b> Plan authors saw SEG's report and material names, never part names or the answer key. The barrier was an instruction, not a permission, and authors sometimes recognised the object from shape.</li>
<li><b>Slips.</b> One author listed the plans folder (file names only); one wrote and deleted a scratch file in the session folder. Neither read another plan's content.</li>
<li><b>Harness bug.</b> An empty README licence section gave an empty attribution, which looked like a refusal on ${mlink("DirectionalLight")}; fixed before scoring and noted in that plan's log.</li>
<li><b>Lantern, <code>--mode single</code>.</b> Lantern has one material, so its single-mode mesh is byte-identical to its materials-mode one. It is reported separately but is not an independent experiment: mean best IoU ${f3(c.single.iou)}, recovery ${pct1(c.single.rec)}.</li>
<li><b>SEG version.</b> ${esc(c.segVersions.join(", "))}${c.stratoDirty ? "; the editor checkout had uncommitted changes on top of the committed 1.5.0 the work depends on" : ""}.</li></ul>

<h2 id="judges">Who judged</h2>
<p><b>All plan authoring, naming labels and verdicts on this page are model output.</b> The ${Object.keys(d.plans).length} plans were written by model agents with no human in the loop, and the verdicts by three model judges: two independent, and a third on the ${j.tiebreak} pairs they split. The ground truth is human (the original authors' part names); the verdicts are not.</p>
<p>Judge agreement on the ${j.n} judged pairs: ${j.agree} identical verdicts, Cohen's kappa ${j.kappa.toFixed(2)}; same-or-grain versus wrong agreed on ${j.sameOrGrainAgree}. The split between "same" and "grain" is a judgement call: judge A ruled ${j.sameA} pairs same, judge B ${j.sameB}, and the tie-break ruled all ${j.tiebreak} disputed pairs grain (${j.sameConsensus} same in the consensus). Read the same-or-grain figures, not "same".</p>

<h2 id="structure-table">Structure, ${s.models} models</h2>
<p class="filter small">Filter by tier: <button data-f="all">all</button><button data-f="A">A</button><button data-f="B">B</button><button data-f="C">C</button> Click a heading to sort. Tier A: real objects with author-meaningful names; B: feature tests; C: generic names.</p>
${structureTable(c, d)}

<h2 id="naming-table">Naming, Tier A, ${n.models} models</h2>
<p class="small">Counts of judged parts by consensus verdict. "Same or grain" is the figure to use. The last column is an upper bound on how much the material name gives away.</p>
${namingTable(c, d)}
`;
  return page({ title: "STOA recovery measurement: ceiling results", description, url: SITE, image: `${SITE}og.png`, body });
}

function modelPage(c, d, m) {
  const rows = d.rows.filter((r) => r.model === m.model);
  const orig = rows.filter((r) => r.kind === "original");
  const exact = new Set(d.handover.models[m.model].exact_parts);
  const t = c.tier(m.model);
  const tr = orig.map((r) => `<tr><td class="l">${esc(r.name)}</td><td class="l">${esc(r.name_stripped)}</td><td>${exact.has(r.part) ? "yes" : "no"}</td><td>${f3(r.best_iou)}</td><td class="l">${esc(r.recovered_name ?? "")}</td><td>${esc(r.recovered_label ?? "")}</td><td>${esc(r.verdict ?? r.failure ?? "")}</td><td>${r.index_bearing ? "yes" : "no"}</td></tr>`).join("\n");
  const body = `
<p class="nav">${link(SITE, "← results")} ${link(`${REPO}/blob/${c.commit}/results/plans/materials/${m.model}.json`, "plan")} ${link(`https://raw.githubusercontent.com/${d.triage.source.repo}/${d.triage.source.commit}/${t.path}`, "source at pinned commit")} ${link(`${REPO}/blob/${c.commit}/results/recovery-materials.jsonl`, "JSONL")}</p>
<div class="banner">Ceiling, not production: material boundaries and names were handed to the plan author.</div>
<h1>${esc(m.model)}</h1>
<p>Tier ${m.tier}. ${m.structure.parts} original parts, ${t.facts.materials} materials, ${t.facts.hasBaseColourTexture ? "textured" : "untextured"}. Mean best IoU ${f3(m.structure.mean_best_iou)}, recovery rate ${pct1(m.structure.recovery_rate)}, part-count ratio ${f3(m.structure.part_count_ratio)} (${rows.filter((r) => r.kind === "recovered").length} recovered parts), ${d.handover.models[m.model].exact_by_material} of ${m.structure.parts} parts handed over by a material boundary. ${m.tier === "A" ? "The authored name is shown with its instance index removed. A verdict appears only for parts matched at IoU ≥ 0.5." : "Naming is not scored for this tier."}</p>
<p class="small">Source ${esc(t.source.files[0].path)} (sha256 <code>${esc(t.sha256.slice(0, 16))}…</code>) · plan: ${d.plans[m.model].meshes.length} meshes · generated from the JSONL at ${esc(c.commit.slice(0, 12))}.</p>
<table><thead><tr><th class="l">original part</th><th class="l">authored name, index removed</th><th>handed over by material</th><th>best IoU</th><th class="l">recovered name</th><th>label</th><th>verdict</th><th>index-bearing</th></tr></thead><tbody>
${tr}
</tbody></table>`;
  return page({ title: `${m.model}: STOA recovery rows`, description: `${m.model} (tier ${m.tier}): mean best IoU ${f3(m.structure.mean_best_iou)}, recovery ${pct1(m.structure.recovery_rate)}, ceiling result.`, url: `${SITE}models/${m.model}.html`, image: `${SITE}og.png`, body, rel: "../" });
}

const SORT_JS = `// Progressive enhancement: the tables are complete without this.
document.querySelectorAll("table th").forEach(function (th) {
  th.addEventListener("click", function () {
    var table = th.closest("table"), body = table.tBodies[0], i = Array.prototype.indexOf.call(th.parentNode.children, th);
    var dir = th.dataset.dir === "asc" ? -1 : 1; th.dataset.dir = dir === 1 ? "asc" : "desc";
    var rows = Array.prototype.slice.call(body.rows);
    rows.sort(function (a, b) {
      var x = a.cells[i].textContent.trim(), y = b.cells[i].textContent.trim(), nx = parseFloat(x.replace(/,/g, "")), ny = parseFloat(y.replace(/,/g, ""));
      return (isNaN(nx) || isNaN(ny) ? x.localeCompare(y) : nx - ny) * dir;
    });
    rows.forEach(function (r) { body.appendChild(r); });
  });
});
document.querySelectorAll(".filter button").forEach(function (b) {
  b.addEventListener("click", function () {
    var f = b.dataset.f;
    document.querySelectorAll("tr[data-tier]").forEach(function (r) { r.style.display = f === "all" || r.dataset.tier === f ? "" : "none"; });
  });
});
`;

export function buildSite(d) {
  const c = compute(d);
  c.commit = d.commit;
  const single = d.singleRows.filter((r) => r.kind === "original");
  c.single = { iou: single.reduce((a, r) => a + r.best_iou, 0) / single.length, rec: single.filter((r) => r.matched).length / single.length };
  const h = c.headline;
  const files = {
    "docs/index.html": indexPage(c, d),
    "docs/sort.js": SORT_JS,
    "docs/og.png": ogPng([
      { text: "STOA RECOVERY MEASUREMENT", y: 50, scale: 5, color: 3 },
      { text: `${pct0(h.precision)}`, y: 110, scale: 18, color: 2 },
      { text: "RIGHT WHEN IT NAMES A PART", y: 250, scale: 6, color: 2 },
      { text: `BUT NAMES ONLY ${pct0(h.coverage)} (${h.named} OF ${h.pairs})`, y: 330, scale: 6 },
      { text: "MAY BE INFLATED BY MATERIAL NAMES", y: 410, scale: 4, color: 3 },
      { text: "CEILING NOT PRODUCTION", y: 480, scale: 7 },
    ]),
    "docs/robots.txt": `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`,
    "docs/.nojekyll": "",
  };
  for (const m of c.models) files[`docs/models/${m.model}.html`] = modelPage(c, d, m);
  files["docs/sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[SITE, ...c.models.map((m) => `${SITE}models/${m.model}.html`)].map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}\n</urlset>\n`;
  return files;
}
