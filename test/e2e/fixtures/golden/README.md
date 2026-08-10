# Golden fixtures — harvested from the live HawRidgePark project

These are real `triton.exe` artifacts harvested from the on-disk HawRidgePark project
(registered in `~/.triforge/projects.json`). See
[`docs/superpowers/specs/GOLDEN_RUN.md`](../../../../docs/superpowers/specs/GOLDEN_RUN.md)
for the source mapping, curation rules, and re-harvest procedure.

**Scope: `exe/` only. Docker is deferred** until explicitly requested.

Map:

- `exe/config.json`             <- project-state DB (paths tokenized: `__PROJECT__`, `__TRITON_SRC__`)
- `exe/triton_execution.cfg`    <- generated run config (clean, tokenized paths)
- `exe/input/`                  <- `HawRidgePark.hyg`, `HawRidgePark.src`
- `exe/output/asc/`             <- curated `H_` depth frames (9 steps × 2 partitions = 18 files); see `exe/output/README.md`
- `exe/baseline.json`           <- assertion targets generated from the real frames
- `../dems/HawRidgePark.asc`    <- the input DEM the run consumed (shared)

The E2E seeds a temp workspace whose `.triforge/projects.json` points at a copy of `exe/`
(with tokens substituted), then the fake triton replays `exe/output/` into the run dir.
