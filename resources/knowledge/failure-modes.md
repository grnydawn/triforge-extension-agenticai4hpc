---
id: failure-modes
title: Common "runs-but-broken" failure modes
keywords: [failure, bug, runoff, zone, index, bounds, grid mismatch, all zero, integrity]
---
TRITON often runs to completion while producing physically wrong output, because it trusts the deck.
Triforge's `diagnose_project` tool statically checks a family of **declared-count / referenced-
artifact integrity** faults. Run `diagnose_project` for the authoritative, up-to-date check list;
the recurring patterns are:

**Out-of-range runoff zone id (the 1-based-vs-0-based bug).** The runoff map holds an integer zone id
per cell; TRITON indexes a runoff-intensity table by that id with **no bounds check**, and the table
is filled 0-based for ids `0..num_runoffs-1`. A **1-based** map (ids `1..num_runoffs`) makes the top
id equal `num_runoffs`, which reads one entry past the table — an out-of-bounds read that injects a
garbage runoff rate into every cell of that zone. The symptom is a hard-edged, constant-valued block
in the output (e.g. a rectangular blow-up in one corner). Fix: re-index the map to 0-based.

**Declared count vs artifact mismatch.** `num_runoffs` must match the runoff hydrograph's column
count and exceed every runoff-map id; `num_sources` must match the source locations / hydrograph
columns; `num_extbc` must match the external-boundary file's row count. A mismatch silently mis-reads
inputs.

**Grid mismatch.** Every input raster must be on the DEM's grid — but compare by cell count, not raw
bytes: the runoff map is `int32` and the DEM is `float64`, and headers differ (6-value DEM vs 2-value
output), so equal grids have unequal byte sizes.

**All-zero forcing.** A hydrograph or boundary file that is entirely zeros produces a run with no
water — usually an upstream generation/units error.
