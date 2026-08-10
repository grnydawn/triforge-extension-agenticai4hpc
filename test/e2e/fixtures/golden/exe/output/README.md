# Golden output subset — HawRidgePark (exe)

These frames are a **deliberate, curated subset** of a real `triton.exe` run, harvested
per [`docs/superpowers/specs/GOLDEN_RUN.md`](../../../../../docs/superpowers/specs/GOLDEN_RUN.md).
This is **not** a truncated or failed run — the full run produced 48 timesteps × 2 partitions
× 3 variables (H/QX/QY) = 288 ASCII frames (~81 MB). We commit only what the map/animation
path needs.

## What's kept

- **Variable:** `H_` (water depth) only — it's the layer the map animates. `QX_`/`QY_`
  (discharge) are excluded; add a pair only if a scenario asserts discharge.
- **Timesteps:** `01, 06, 12, 18, 24, 30, 36, 42, 48` — first, last, and a spread through the
  middle so the animation shows real motion.
- **Partitions:** both `_00` and `_01` for every kept step. The run uses static 2-way domain
  decomposition (`factor_interval_domain_decomposition=2`), so each file holds ~half of the
  211×161 grid; you need both partitions to reconstruct a full timestep field.

Total: **18 files** (9 steps × 2 partitions).

## Assertion baseline

`../baseline.json` records the targets derived from exactly these files: `frameCount=18`,
grid `211×161`, `projection=EPSG:32616`, depth range `0 → 7.22177` m (computed over the
committed subset, excluding NODATA). Depth frames here contain no `-9999` cells — dry cells
are `0`.

## Re-harvesting

Re-run the harvest only if Triton's output format or the HawRidgePark seed input changes.
The source of truth is the live project registered in `~/.triforge/projects.json`.
