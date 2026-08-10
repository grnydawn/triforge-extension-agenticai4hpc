---
id: deck-and-paths
title: The TRITON deck (.cfg) and how paths resolve
keywords: [cfg, deck, num_runoffs, num_sources, num_extbc, hydrograph, path, cwd, gating]
---
A TRITON run is driven by a `.cfg` deck of `key=value` lines (`dem_filename`, `runoff_map`,
`num_runoffs`, `hydrograph_filename`, `num_sources`, `src_loc_file`, `num_extbc`, `extbc_file`,
`sim_duration`, `print_interval`, `print_option`, `const_mann`, `courant`, …).

**Path resolution.** Input paths in the deck (e.g. `runoff_map="input/roff.bin"`) are relative to
the **run directory** — the current working directory TRITON is launched from — not to the `.cfg`'s
own location. Real decks keep a runnable `.cfg` at the run-dir root next to the `input/` folder, and
TRITON is invoked with CWD = run dir. If a `.cfg` physically lives inside `input/` but references
`input/...`, resolve those paths against the run-dir root (the parent), or you get a doubled
`input/input/...`.

**Count keys gate whether files are read.** `num_sources=0` means the streamflow source files
(`hydrograph_filename`, `src_loc_file`) are never opened — a missing file there is harmless.
Likewise `num_runoffs>0` activates `runoff_map`/`runoff_filename`, and `num_extbc>0` activates
`extbc_file`. When validating a deck, honor this gating before flagging a referenced file as missing.
