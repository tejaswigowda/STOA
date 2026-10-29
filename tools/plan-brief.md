# Plan author — brief

You are the author in the recovery measurement. You are given SEG's own report on a 3D model that
was flattened to one mesh, and you write the plan that cuts and names its parts. Your plan is then
scored against how the model was authored before it was flattened. You never see that.

## Blindness is the whole point

- Read **only** the evidence file you were given. Do not open `key.json`, anything under
  `.cache/flatten/`, `triage/`, `stoa-ground-truth-tiers.json`, `objects/`, `results/`, the
  `STOA_BLIND_MAP` file, or any other model's evidence or plan. If you find yourself holding an
  authored part name, say so in `log` and stop using it.
- You are not told what the model is. Do not try to identify it from memory of public sample
  models. Name what the evidence supports.
- Material names are part of the evidence (this is the ceiling test: material boundaries are
  handed over). Use them, and say so in `basis`.

## What the evidence is

One entry per mesh. The importer made one mesh per material, so a mesh is one material's worth of
the model, and may hold several things (separate islands or components) that share that material.
Each entry has the SEG report: triangles, size, `at` (0..1 across the whole mesh on x, y, z, which
tells left from right and front from back), colours with shares, and for a scene, components.

## What you write

A JSON file, one object, covering **every mesh**:

```json
{
  "author": "agent",
  "meshes": [
    { "mesh": 0, "whole": { "group": "Thing_Group_a", "name": "Dark_Console_Unit", "classes": ["unit"] } },
    { "mesh": 1, "plan": {
        "group": "Thing_Group_b", "classes": ["thing"],
        "parts": [
          { "island": 0, "name": "...", "classes": ["..."], "basis": ["position", "size", "colour", "shape"] },
          { "component": [3, 4], "name": "...", "classes": ["..."] }
        ] } }
  ],
  "log": ["every problem, surprise or doubt, in your own words"]
}
```

- `whole` makes one part holding every island of the mesh.
- `plan` is a SEG plan (see `guides/MESH_SEGMENT.md` in the editor checkout: "The plan", "A scene").
  Every island (or component) must go to exactly one part. `source` is added for you.
  Do not use `subdivide`/`palette` unless the colour evidence clearly separates parts inside one island.
- **Names**: one an author would choose, not `Mesh`, `Group`, `Object`, `Part_1`, … ; **unique across
  all your meshes**; every part needs at least one class; every `group` needs a name too and is also
  unique. No digits-only or numbered placeholders.
- **Justify every name from position, size and colour.** Record the basis you actually used.
- **Abstain correctly.** If you cannot justify a name, describe the shape (`Dark_Console_Unit`).
  If the evidence does not separate two things, merge them (`Body_And_Head`). These are correct
  outputs, not failures. A guess that looks like a name is the only failure mode that matters.
- Several identical things in one mesh (separate islands, similar size, different `at`): they are
  separate parts. Name them by what they are plus where they are (left/right, front/back,
  high/low) when `at` supports it, and by what distinguishes them otherwise.

## Check, do not score

```
STOA_BLIND_MAP=<map file> node tools/recovery-run.mjs check <code> --plans <your plans.json>
```

It runs SEG's cuts and prints how many meshes were cut, how many parts, and what SEG refused.
It prints no scores. Fix refusals that are mistakes in your plan (a duplicate name, an island left
over). Do not tune the plan towards anything else; you have nothing else to tune towards.

## Log

`log` is the output the project wants from this step: things the agent loop got wrong or could not
do, ambiguous evidence, plan syntax that fought you, anything that cost you more than it should.
Write them down. Do not try to fix SEG.
