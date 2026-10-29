# Naming judge — brief

You are comparing the name an author gave a part of a 3D model with the name a
segmentation pipeline recovered for the same part, and ruling on one of three
verdicts. The two parts already cover the same surface (their area overlap is
at least 50%); you are judging only the names.

Each pair is `authored` and `recovered`. Answer with one verdict per pair and a
one-line reason.

## Verdicts

- **same** — they name the same thing. `Wheels` ↔ `Truck_Wheels`.
- **grain** — the right thing at a different granularity. `Wheels` ↔
  `Wheel_Left`, or `Body` ↔ `Body_And_Roof`. This is **not an error**: it says
  the pipeline divides or merges differently than the author did. Do not
  collapse it into `wrong`.
- **wrong** — a different thing. `Wheels` ↔ `Tailgate`.

## What to know before ruling

1. **Abbreviations are correct answers.** Authors abbreviate. `skscr` is a
   skyscraper, `vagon` a wagon, `bridg` a bridge, `build` a building, `cam` a
   camera, `tower` a tower. A recovered `Skyscraper` against an authored
   `skscr01` is **same**, not wrong. Expand the abbreviation first, then
   compare.
2. **Instance indices have already been removed from `authored`.** One trailing
   index group is stripped (`Bishop_B1` → `Bishop_B`, `car-11` → `car`,
   `build05-08` → `build05`). A number glued to a word (`build05`, `skscr01`)
   is part of the type the author chose and is left in. Do not penalise a
   recovered name for lacking an index, and do not penalise it for lacking
   the number in `build05`; decide whether `build05` and `Building` are the
   same thing.
3. **A colour or side suffix the author kept is evidence, not noise.**
   `Bishop_B` (black) against `Bishop_White` is **wrong**; against
   `Black_Bishop` is **same**.
4. **Judge meaning, not spelling.** Word order, case, underscores and plural
   forms do not matter.
5. **Do not reward vagueness.** If the recovered name is a generic container
   (`Group`, `Object`, `Part`), it is **wrong** unless the authored name is
   equally generic.
6. If you cannot tell, say `wrong` and put what you could not resolve in the
   reason. Never invent a meaning for an authored name to make a pair match.

## Output

One JSON object per line, in the order given:

```json
{"key": "<key from the pair>", "verdict": "same|grain|wrong", "reason": "..."}
```
