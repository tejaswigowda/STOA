# Recovery measurement: results (2026-10-28 / 29)

> The results page is generated from the JSONL by `node tools/report.mjs --site` (published from `docs/`; CI fails if it
> differs) and is the presentation to cite. It leads with precision and coverage, not with "same". The notes below were
> written by hand before it existed; where they differ from the page, the page is right.

**This is the ceiling, not production.** Khronos models are hand-built, carefully unwrapped and small, and
`--mode materials` hands the plan author every material boundary and every material name. Nothing here
estimates how SEG does on a photoscan, a stock-store asset or Objaverse.

Full tables: [recovery-materials.md](recovery-materials.md) (all 49 per-model structure rows, all 21 per-model
naming rows). Rows: [recovery-materials.jsonl](recovery-materials.jsonl), one per original part, one per recovered
part, one per refusal. Lantern in `--mode single`: [recovery-single.jsonl](recovery-single.jsonl). Plans (the
authored inputs): [plans/materials/](plans/materials/).

## Headlines

| | |
|---|---|
| Structure, 49 models, **macro** | mean best IoU **0.728**, recovery rate (IoU ≥ 0.5) **75.8%** |
| Structure, pooled (micro), 1,755 parts | 0.931, 94.8% |
| Naming, Tier A, 21 models, **macro** | same **28.3%**, same-or-grain **49.9%** |
| Naming, pooled (micro), 262 parts | same 14.9%, same-or-grain 39.3% |

Macro is the headline. Pooling is dominated by a few models: the two Iridescence sphere scenes are 692 of 1,755
parts (39%) and score 1.0, and in Tier A, VC and ABeautifulGame are 70% of the parts.

By tier (structure, macro): A 0.646 / 68.5%, B 0.673 / 70.6%, C 0.971 / 97.9%. Tier C scores highest because its
parts (spheres, `body_N` shells) are mostly exactly one material each.

### Denominators

- **Structure: 49 models, 1,755 original parts** (a part is a mesh instance).
- **Naming: Tier A, 21 models, 262 mesh instances, 282 distinct names.** Scoring is per instance. 229 of the 262 matched a recovered part at IoU ≥ 0.5 and went to a judge; 33 were below threshold; none was unmatched.
- **Index-bearing: 149 of 262 instances (56.9%).** On distinct names, VC is 72.6% (98/135) and ABeautifulGame 78.6% (44/56). Authored names were compared with one trailing index group removed.

## Read these before quoting a number

1. **The material boundary hands over most of the structure.** 1,281 of 1,755 parts (73.0%) are exactly one material's mesh, so the importer recovers them before SEG runs (Tier A: 179 of 262, 68.3%). On the **474 parts it does not hand over** (22 models): macro IoU 0.736, recovery 77.8%; micro 0.889, 92.6%. In Tier A that residual is **83 parts in 6 models**: macro IoU 0.652, recovery 65.2%; naming 3 same, 47 grain, 21 wrong, 12 not matched.
2. **Material names leak the answer.** 108 of 262 Tier A authored names (41.2%) share a word with their material's name (an upper bound: an object word such as "lantern" counts). ABeautifulGame's names are 49/49, FlightHelmet's 6/6. Its plan author said the piece names came only from the material names.
3. **Most "wrong" naming verdicts are abstentions.** Plan authors were told to describe a shape when the evidence does not support a name. A second labeller split the 838 recovered names into *named* (claims what it is) and *descriptive* (shape, colour, position). Of 229 judged pairs, SEG's plan **named** the part in 80 and **described** it in 149. When it named, 75 were same-or-grain and 5 wrong (**93.8%**). When it only described, 28 were same-or-grain; the other 121 "wrong" verdicts are abstentions: the judges had no category for declining to name, so the data now records them as `abstained` (the judge's own verdict is kept as `judge_verdict`).
4. **Same versus grain is a judgement call.** Two independent judges agreed on 185 of 229 pairs (Cohen's kappa 0.68). 42 of the 44 disagreements were same-versus-grain, where a recovered name adds a side or instance word the authored name lacks (`Ornament` ↔ `Ornament_Left`). A third judge settled all 44 as grain. Same-or-grain agreed on 228 of 229, so **same-or-grain is the robust figure** and "same" is a lower bound (judge A alone had 81 same, judge B 40).
5. **The plan authors were not fully blind.** They saw no part names, but material names, and they sometimes recognised the object from shape (one called its object a truck). Evidence files were in a folder outside the repo and the answer key was not given to them; the barrier is an instruction, not a permission. Two small slips are logged below.
6. **Structure rewards matching the author's granularity.** The part-count ratio is 5.2 on average (recovered parts per original). Where an author grouped (five sphere rows as one part) and SEG's plan cut each sphere, IoU is near zero (MetalRoughSpheres 0.05, EnvironmentTest 0.09) although nothing is wrong geometrically.

## The failure set

This is an output, not a defect list. Nothing was fixed during the run.

- **Granularity mismatch dominates the low structure scores:** MetalRoughSpheres, EnvironmentTest, TransmissionRoughnessTest, GlamVelvetSofa, AntiqueCamera, TextureSettingsTest, ClearCoatTest, Lantern, StainedGlassLamp, SheenChair, MaterialsVariantsShoe, BoomBoxWithAxes.
- **Evidence-limited naming:** the evidence has no colour for many models (untextured islands), no stated up or front axis (so left/right and front/back are assumed), and `at` is relative to each mesh's own extent, not the scene.
- **Instances that SEG cannot separate:** identical or near-identical islands (48 olives, 24 untextured fasteners, 343 identical spheres, 142 ring fittings) get ordinal or positional names; one of the plans merged them instead.
- **Plan syntax:** every island id has to be listed (no range or "rest"): 5,595 ids typed for one dragon mesh, 497 for a bead strand.
- **`SEG.describe` output is truncated on large meshes** (one author planned by component because island lists were cut off; another's output "kept truncating").
- **The `basis` list** accepts only position, size, colour and shape; two authors' first checks were refused for listing "material".
- **The editor logged `Invalid string length`** while cutting ABeautifulGame's 1.5 M triangles; the cut still completed and scored.
- **No refusals.** All 49 models' plans were cut with `refused: []` (after the one harness bug below).

## Protocol notes and deviations

- **SEG version.** Rows carry `seg_version: 1.6.0` and `strata_dirty: true`: the editor checkout had uncommitted 1.6.0 changes (`SEG.wouldRefuse`, regeneration) on top of the 1.5.0 commit `08c4af8` this work order depends on. The cut and `parents` code is the 1.5.0 code.
- **Harness bug.** One author logged a refusal ("source.attribution is missing") on DirectionalLight. That was STOA's own bug (an empty README licence section gave an empty attribution), fixed before scoring; noted in that plan's `log`.
- **Slips.** One Tier A author listed the plans folder (file names only); one wrote and deleted a scratch dump in the session folder. Neither read another plan's content.
- **Lantern, `--mode single`.** Lantern has one material, so its single-mode flattened mesh is byte-identical to its materials-mode one (same sha256). It was re-run as `--mode single` with the same plan and the same verdicts carried over, so it is reported separately but is not an independent experiment. SEG recovered **0.539 mean best IoU, 33.3% recovery**; the plan gave all three parts names, but only two claim what the part is (`Left_Tall_Upright_Post`, `Chain_Link_Middle_Pair`); the third (`Hanging_Dark_Large_Lower_Body`) only describes. Atlasing was not built.
- **Offsets.** N1 (FlightHelmet identity through the real editor, six meshes, six offsets) scored 1.0 on every metric. N2: a first-two-meshes swap scores 0.852 / 83.3%; swapped equal-size meshes read 1.0 on structure alone but cross every naming pair, and an overlapping offset is refused. Every run also checks that the editor's mesh k has the triangle count **and surface area** of primitive k.
- **Judges.** Three general-purpose model agents (two independent, one tie-break) working from `tools/judge-brief.md` on shuffled, anonymised pairs; plan authors were 28 other agent runs. All the judging, naming and labelling is model output, not human.
