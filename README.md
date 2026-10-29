# STOA

**Segmented, Tagged, Open Assets** — named part-segmentations of open 3D assets.

**Licensing, in three parts.**

- **Records, plans, names and triage data** (everything except `tools/`) are **CC0** — see [LICENSE](LICENSE). Contributions are accepted under CC0 ([CONTRIBUTING.md](CONTRIBUTING.md)).
- **Code** in `tools/` and `.github/` is **Apache-2.0** — see [tools/LICENSE](tools/LICENSE). CC0 is silent on patents and unconventional for code.
- The **source assets** the records describe keep their own licences, recorded per record in `source.licence`. Copies of each redistributable non-CC0 licence are in [licenses/](licenses/); the ones that are not ours to redistribute are named and linked there.

## Ids, not paths

A record is referred to by its **id**: the first 16 hex characters of the
sha256 of its source file. Never cite a path. The id is stable across
corrections, computable before any work is done, evenly distributed, and
self-verifying (a record whose source does not hash to its id is wrong).

    Duck.glb  65bf938f54d6073e619e76e007820bbf980cdc3dc0daec0d94830ffc4ae54ab5  ->  65bf938f54d6073e

A second, competing segmentation of the same asset is `<id>-2`; the normal way
to disagree is a PR against the existing record.

## Layout

    objects/<id[0:2]>/<id>.json      one record per asset, 256 buckets
    objects/<id[0:2]>/assets/        packs and images used by that bucket's records
    index/objects.json               GENERATED  id -> path, title, source, parts, classes, status
    index/buckets.json               GENERATED  bucket -> count
    triage/khronos-2.0.json          output of tools/enumerate-khronos.mjs
    docs/                            gh-pages: the browser only, no data
    tools/                           see below

`index/` is generated, never hand-edited. CI regenerates it and fails on any
difference. **Migration trigger:** any bucket over 800 entries moves to two
levels (`objects/65/bf/…`); links do not break because they use ids.

## Tools

Node 22, no dependencies.

    node tools/enumerate-khronos.mjs   triage every .glb/.gltf in KhronosGroupArchives/glTF-Sample-Models/2.0
    node tools/build-index.mjs         regenerate index/ (--check to verify, --worktree for uncommitted records)
    node tools/verify-sources.mjs      S1 id == sha256(source)[:16]; S4 re-fetch every source and compare (--offline for S1 only)
    node tools/flatten.mjs <model|file.glb> [--mode materials|single] | --all   flatten to one mesh + key.json (.cache/flatten/)
    node tools/recovered-from-record.mjs <scene.json>... [--key key.json]       recovered.json from a SEG record's `parents` (no geometry)
    node tools/score.mjs --dir <flatten dir> --recovered recovered.json         structural recovery scoring -> JSONL
    node tools/judge.mjs pairs|apply ...                                        naming pairs out, verdicts in (brief: tools/judge-brief.md)
    node tools/report.mjs results.jsonl...                                      per-model rows, macro (headline) and micro
    node tools/seed-floor.mjs                                                   a record for every refused and no-evidence asset
    node tools/seg-refusals.mjs                                                 ask SEG.wouldRefuse about the floor (needs the editor served)
    node tools/recovery-run.mjs identity|evidence|check|run <model>             drive the real editor: plans in, records out, scores (see tools/plan-brief.md)
    node tools/material-overlap.mjs                                             how much the material boundary and material names hand over
    node --test tools/*.test.mjs

`build-index.mjs` reads the committed tree (`git ls-tree -r HEAD`), so commit
records before regenerating the index.

## Triage

[triage/khronos-2.0.json](triage/khronos-2.0.json) records, for every file: mesh,
material, primitive and triangle counts, skinned, morph targets, UVs, base-colour
texture, bytes and sha256, plus a bucket per model (`ground-truth`, `hard`,
`no-evidence`, `refused`). glTF-only models (e.g. FlightHelmet) are packed to
`.glb` in memory with a before/after check on meshes, materials, primitives,
nodes, triangles and part names.

Ground-truth models also carry a `tier` (A: author-meaningful names, B: feature
test, C: generic names or < 2 parts) and `nameQuality`, the fraction of part
names that are not generic, numbered or parametric. C is derived (quality below
0.5 or fewer than 2 parts); B is the curated list in
[triage/feature-tests.json](triage/feature-tests.json), because "descriptive
but not inferable from shape" cannot be computed. Tier A is 21 models, 282
named parts. Naming is scored on Tier A only; structure on all 49.

## Recovery measurement

`flatten.mjs` merges a multi-part asset into one mesh (one primitive per
material, or one primitive with `--mode single` for one-material assets such as
Lantern) and writes `key.json`: every original part, by name, with its triangle
indices into the flattened mesh. Triangle count (exact), surface area and
bounding box (to float32 precision, 1e-6) are checked before and after. A part
is a mesh *instance*, so a mesh reused by several nodes yields several parts and
the flattened triangle count can exceed the triage's per-mesh count.

SEG 1.5.0 records `parents`: for every output triangle, the input triangle it
was cut from. `recovered-from-record.mjs` builds `recovered.json` from that alone,
and refuses a record without it rather than matching by position. Subdivision
produces equal-area children, so a part's share of a parent triangle is its
children of it over all children of it, and every IoU is exact.

`score.mjs` computes per-part best IoU over surface area, recovery rate
(best IoU >= 0.5), part-count ratio and reverse IoU from a `recovered.json`
(recovered parts as lists of flattened triangle indices). Naming verdicts
(same / grain / wrong) are left `null` for a judge to fill in.

`report.mjs` reports macro (mean of per-model scores, the headline) alongside micro
(all parts pooled). Tier A is dominated by VC and ABeautifulGame, so micro mostly
measures those two. Authored names are compared with one trailing index group
stripped (`Bishop_B1` -> `Bishop_B`, `car-11` -> `car`, `build05-08` -> `build05`;
`build05` and `skscr01` are types and stay), and the share of parts that carry an
index is reported next to the naming score.

## Records

Every record carries `id_method: "primary-file-sha256"`: the id is the hash of the
primary file (the `.gltf`, for glTF assets). `source.files[]` lists every file of a
multi-file asset with its hash and size, and `verify-sources.mjs` re-fetches them
all. `source.packed` is the `.glb` the packer makes from it: a convenience that
depends on the packer version (`stoa-pack@1`), never an identifier.

`seed-floor.mjs` writes the floor: a record for every refused and no-evidence asset
(`status`, `refusal.reason`, `parts: null`), so the denominator is complete.

## Packaging

How geometry travels with a record is a recorded choice, not a consequence of how the editor saves.
**Decision (2026-10-28): packs are release artifacts** — regenerable from the record's source and plan,
kept outside git history so they can be removed without rewriting it. Records carry annotations, not
Sony's or anyone's geometry. Moving to `plan` (the editor regenerates a cut from its source on open) is
the end state and waits on that landing in Strata. The floor records have no geometry: `packaging: "none"`.
SEG's `parents` (one integer per output triangle) are scoring artifacts and are never committed in a
record; `verify-sources.mjs` fails a record that carries them.

## Results

The recovery measurement is in [results/](results/README.md): structure on 49 models, naming on the 21 Tier A
models, labelled as the ceiling. Start with the "Read these before quoting a number" section.

The results page (`docs/index.html`, published with GitHub Pages from `docs/`) is generated by
`node tools/report.mjs --site` and checked in CI with `--site --check`; nothing on it is typed.
Enable Pages on the `main` branch, `/docs` folder; it will be served at
https://tejaswigowda.github.io/STOA/ (the base URL is `SITE` in `tools/page.mjs`).
