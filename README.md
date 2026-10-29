# STOA

**Segmented, Tagged, Open Assets** — named part-segmentations of open 3D assets.

**Licensing, in two parts.** The annotations in this repository (records, plans,
names, tools) are released under **CC0** — see [LICENSE](LICENSE). The *source
assets* they describe keep their own licences, recorded per record in
`source.licence`; copies of each non-CC0 licence live in [licenses/](licenses/).
These are different things.

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
    node tools/score.mjs --dir <flatten dir> --recovered recovered.json         structural recovery scoring -> JSONL
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

`score.mjs` computes per-part best IoU over surface area, recovery rate
(best IoU >= 0.5), part-count ratio and reverse IoU from a `recovered.json`
(recovered parts as lists of flattened triangle indices). Naming verdicts
(same / grain / wrong) are left `null` for a judge to fill in.
