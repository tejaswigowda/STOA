# Recovery results (materials)

Khronos is an upper bound: hand-built, carefully unwrapped, small. `--mode materials` is the ceiling test (material boundaries are handed over), not the production case.

## Structure (all models)

| | models | mean best IoU | recovery rate | part-count ratio | reverse IoU |
|---|--:|--:|--:|--:|--:|
| **macro** (headline) | 49 | 0.728 | 75.8% | 5.248 | 0.485 |
| micro (1755 parts pooled) | 49 | 0.931 | 94.8% | | |

| model | tier | parts | mean best IoU | recovery rate | part-count ratio | reverse IoU |
|---|:-:|--:|--:|--:|--:|--:|
| 2CylinderEngine | C | 67 | 0.941 | 98.5% | 1.970 | 0.508 |
| ABeautifulGame | A | 49 | 0.924 | 98.0% | 1.327 | 0.754 |
| AlphaBlendModeTest | B | 9 | 0.790 | 77.8% | 2.111 | 0.474 |
| AntiqueCamera | A | 2 | 0.351 | 0.0% | 28.000 | 0.036 |
| AttenuationTest | B | 23 | 0.940 | 95.7% | 2.000 | 0.500 |
| BoomBoxWithAxes | A | 5 | 0.489 | 20.0% | 2.800 | 0.166 |
| BoxAnimated | A | 2 | 1.000 | 100.0% | 1.000 | 1.000 |
| Buggy | C | 190 | 0.962 | 98.9% | 2.016 | 0.492 |
| CesiumMilkTruck | A | 3 | 0.604 | 100.0% | 9.000 | 0.111 |
| ClearCoatTest | B | 27 | 0.587 | 100.0% | 2.000 | 0.500 |
| DirectionalLight | C | 3 | 1.000 | 100.0% | 1.000 | 1.000 |
| DragonAttenuation | A | 2 | 0.565 | 50.0% | 21.000 | 0.048 |
| EmissiveStrengthTest | C | 6 | 0.929 | 100.0% | 1.667 | 0.600 |
| EnvironmentTest | B | 3 | 0.091 | 0.0% | 11.000 | 0.091 |
| FlightHelmet | A | 6 | 0.551 | 50.0% | 12.667 | 0.079 |
| GearboxAssy | C | 95 | 0.955 | 91.6% | 2.221 | 0.450 |
| GlamVelvetSofa | A | 3 | 0.152 | 0.0% | 10.333 | 0.097 |
| InterpolationTest | C | 10 | 1.000 | 100.0% | 1.000 | 1.000 |
| IridescenceDielectricSpheres | C | 346 | 1.000 | 100.0% | 1.000 | 1.000 |
| IridescenceLamp | A | 3 | 0.718 | 100.0% | 4.667 | 0.214 |
| IridescenceMetallicSpheres | C | 346 | 1.000 | 100.0% | 1.000 | 1.000 |
| IridescenceSuzanne | A | 3 | 0.945 | 100.0% | 3.000 | 0.333 |
| IridescentDishWithOlives | A | 4 | 0.755 | 75.0% | 13.000 | 0.077 |
| Lantern | A | 3 | 0.539 | 33.3% | 5.333 | 0.188 |
| MaterialsVariantsShoe | A | 1 | 0.522 | 100.0% | 25.000 | 0.040 |
| MeshPrimitiveModes | B | 7 | 0.429 | 42.9% | 0.429 | 1.000 |
| MetalRoughSpheres | B | 5 | 0.052 | 0.0% | 21.200 | 0.047 |
| MetalRoughSpheresNoTextures | C | 102 | 0.980 | 98.0% | 1.069 | 0.936 |
| MosquitoInAmber | A | 3 | 0.749 | 66.7% | 3.000 | 0.333 |
| NegativeScaleTest | B | 11 | 0.698 | 72.7% | 2.545 | 0.393 |
| OrientationTest | B | 13 | 1.000 | 100.0% | 1.000 | 1.000 |
| ReciprocatingSaw | C | 113 | 0.918 | 90.3% | 1.416 | 0.697 |
| SheenChair | A | 4 | 0.513 | 50.0% | 12.750 | 0.078 |
| SheenDamask | A | 11 | 0.713 | 72.7% | 4.636 | 0.216 |
| SheenHighHeel | A | 8 | 0.668 | 75.0% | 3.000 | 0.333 |
| SpecGlossVsMetalRough | A | 4 | 0.553 | 100.0% | 2.500 | 0.400 |
| SpecularTest | B | 24 | 0.862 | 83.3% | 2.042 | 0.490 |
| StainedGlassLamp | A | 8 | 0.541 | 50.0% | 5.000 | 0.200 |
| TextureCoordinateTest | B | 5 | 1.000 | 100.0% | 1.000 | 1.000 |
| TextureSettingsTest | B | 10 | 0.427 | 70.0% | 3.600 | 0.278 |
| TextureTransformMultiTest | B | 29 | 0.969 | 96.6% | 1.379 | 0.725 |
| TextureTransformTest | B | 12 | 1.000 | 100.0% | 1.000 | 1.000 |
| ToyCar | A | 3 | 0.777 | 100.0% | 4.333 | 0.231 |
| TransmissionRoughnessTest | B | 9 | 0.227 | 11.1% | 7.667 | 0.130 |
| TransmissionTest | B | 22 | 0.795 | 100.0% | 1.409 | 0.710 |
| UnlitTest | B | 2 | 1.000 | 100.0% | 1.000 | 1.000 |
| VC | A | 135 | 0.930 | 97.0% | 1.563 | 0.640 |
| VertexColorTest | B | 2 | 0.577 | 50.0% | 6.500 | 0.154 |
| XmpMetadataRoundedCube | C | 2 | 1.000 | 100.0% | 1.000 | 1.000 |

## What the material boundary hands over

1281 of 1755 original parts (73.0%) are exactly one material's mesh, so the importer recovers them before SEG runs (Tier A: 179 of 262, 68.3%). In Tier A, 108 of 262 authored part names (41.2%) also share a word with their material's name (an upper bound). The scores above include those parts. **On the 474 parts the boundary does not hand over** (22 models) the structure scores are:

| | models | mean best IoU | recovery rate |
|---|--:|--:|--:|
| macro | 22 | 0.736 | 77.8% |
| micro (474 parts) | 22 | 0.889 | 92.6% |

Tier A residual naming: 83 parts, 3 same, 47 grain, 21 wrong (2 of them against a named part), 12 unmatched or below the IoU threshold.

## Naming (Tier A only)

262 parts across 21 models. Instance indices are stripped from authored names before comparison; **149 of 262 parts (56.9%) carry one**, so the naming score rests on what remains. The largest model is 51.5% of the parts.

| | same | same or grain |
|---|--:|--:|
| **macro** (headline) | 28.3% | 49.9% |
| micro | 14.9% | 39.3% |

Of 229 matched pairs, SEG's plan **named** the part (claimed what it is) in 80 and **described** it (abstained: shape, colour, position) in 149. When it named: 75 same-or-grain, 5 wrong (93.8% right). When it only described: 28 same-or-grain. Abstentions are scored wrong by the three-way rule and reported here so they are not read as wrong names.

| model | parts | index-bearing | same | grain | wrong | unmatched | below-threshold | no-name | pending | same rate |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| ABeautifulGame | 49 | 44 (89.8%) | 0 | 48 | 0 | 0 | 1 | 0 | 0 | 0.0% |
| AntiqueCamera | 2 | 0 (0.0%) | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0.0% |
| BoomBoxWithAxes | 5 | 0 (0.0%) | 0 | 1 | 0 | 0 | 4 | 0 | 0 | 0.0% |
| BoxAnimated | 2 | 0 (0.0%) | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 100.0% |
| CesiumMilkTruck | 3 | 1 (33.3%) | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| DragonAttenuation | 2 | 0 (0.0%) | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 50.0% |
| FlightHelmet | 6 | 0 (0.0%) | 1 | 2 | 0 | 0 | 3 | 0 | 0 | 16.7% |
| GlamVelvetSofa | 3 | 0 (0.0%) | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0.0% |
| IridescenceLamp | 3 | 0 (0.0%) | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 66.7% |
| IridescenceSuzanne | 3 | 3 (100.0%) | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0.0% |
| IridescentDishWithOlives | 4 | 0 (0.0%) | 3 | 0 | 0 | 0 | 1 | 0 | 0 | 75.0% |
| Lantern | 3 | 0 (0.0%) | 0 | 0 | 1 | 0 | 2 | 0 | 0 | 0.0% |
| MaterialsVariantsShoe | 1 | 0 (0.0%) | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0.0% |
| MosquitoInAmber | 3 | 3 (100.0%) | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 33.3% |
| SheenChair | 4 | 0 (0.0%) | 1 | 1 | 0 | 0 | 2 | 0 | 0 | 25.0% |
| SheenDamask | 11 | 0 (0.0%) | 4 | 0 | 4 | 0 | 3 | 0 | 0 | 36.4% |
| SheenHighHeel | 8 | 0 (0.0%) | 4 | 2 | 0 | 0 | 2 | 0 | 0 | 50.0% |
| SpecGlossVsMetalRough | 4 | 0 (0.0%) | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 50.0% |
| StainedGlassLamp | 8 | 0 (0.0%) | 1 | 3 | 0 | 0 | 4 | 0 | 0 | 12.5% |
| ToyCar | 3 | 0 (0.0%) | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 66.7% |
| VC | 135 | 98 (72.6%) | 15 | 0 | 116 | 0 | 4 | 0 | 0 | 11.1% |
