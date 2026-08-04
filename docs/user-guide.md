# User guide

This is the field-level reference for Triforge's panels. It has one section per
panel, in the order you'd normally use them: create a project, define the
simulation area and elevation, prepare inputs, configure the computation, set up
the execution, and visualize the results. Each section says **how to open the
panel**, lists **every field** (control, default, and meaning), and names the
**button that applies or saves** your work.

If you're new here, walk through [Getting started](getting-started.md) first for
a linear, end-to-end run, then come back to this page to look up individual
fields.

:::{note}
Triforge's sidebar has three views: **Projects** (your projects), **Simulations**
(the tree of the *active* project — Inputs, Computation, Execution, Output), and
**Properties** (details for the current selection). Most panels below open from
the **Simulations** tree.
:::

## Create a new project

**Open it:** click the **+ (Create New Project)** button in the **Projects** view
title bar. The form has three section headers (not tabs): *General*, *TRITON Data
File Format*, and *Simulation Area in UTM*.

| Field | Control | Default | Meaning |
|---|---|---|---|
| Project Name | text | — (e.g. `MyFloodProject`) | Project name; becomes the folder name; auto-derives Project Location. |
| Project Location | text | configured Project Folder, else `~/triforge-projects` | Absolute path where the project is created. |
| Input Format | dropdown | Ascii | Format for input rasters (Ascii/Binary). |
| Output Format | dropdown | Ascii | Format for outputs (Ascii/Binary/GeoTIFF). |
| Ncols / Nrows | number | — (e.g. 211 / 161) | DEM grid columns / rows. |
| Xllcorner / Yllcorner | number | — (e.g. 500000.00 / 4000000.00) | Lower-left grid corner (UTM easting/northing). |
| Cellsize | number | — (e.g. 30) | Cell resolution (meters); must be > 0. |
| NoData Value | number | -9999 | NODATA sentinel. |
| UTM Zone | text | (auto 16N if blank) | UTM zone for the area. |
| Datum | dropdown | WGS84 (EPSG:4326) | CRS/datum (also NAD83). |

**Buttons:** **Browse…** (choose the Project Location), **Load from DEM File…**
(auto-fills the grid fields from a `.dem`/`.asc`), **Generate from Map…** (draw
the area on a map to fill the grid — needs Cellsize > 0), **Create Project**
(creates the project and makes it active), **Cancel**.

:::{note}
This form has **no Simulation-Start or Timezone field**. Those live in
[Computation Setup](#computation-setup), not here.
:::

## Simulation area and DEM

Two related tasks define the ground your simulation runs on: the **grid** (the
rectangle and cell size) and the **DEM** (the elevation surface inside it).

### Pick Simulation Area

**Open it:** run **Pick Simulation Area…** from the Command Palette
(`Ctrl/Cmd+Shift+P`). A map opens.

| Prompt | Control | Default | Meaning |
|---|---|---|---|
| Cell Size (meters) | input box | 30 | Grid resolution; smaller cells mean more detail and a heavier run. |

Draw a rectangle over your area on the map, and Triforge reports the selected area
(cell size plus the UTM header) in a notification. Note that this command currently
**only shows** the selection — it does not by itself save the grid onto the project.
To actually set a project's grid, use **Generate from Map…** or **Load from DEM
File…** in the Create Project form (those values are saved when you click **Create
Project**).

### Generate DEM

**Open it:** run **Triforge: Generate DEM** from the Command Palette. Generate
DEM is **Command-Palette-only** — it has no button, tree node, or right-click
entry — and it needs the active project to **already have a simulation grid**
(set it during project creation or with *Pick Simulation Area…* above).

Generate DEM is a sequence of Command-Palette prompts:

| Prompt | Control | Options / default | Meaning |
|---|---|---|---|
| Select Elevation Data Source | quick pick | SRTMGL1 (~30 m), SRTMGL3 (~90 m), AW3D30, COP30, NASADEM | Which OpenTopography dataset to fetch. |
| OpenTopography API Key | password input | asked once, stored securely | Your free OpenTopography key; reused on later downloads. |
| UTM EPSG Code | input box | (asked only if unset, e.g. `32616`) | Projection for the fetched raster. |

A cancellable **"Fetching DEM…"** progress notification runs while the data
downloads.

:::{admonition} Requirements and a caveat
:class: warning
Generate DEM shells out to **Python 3** (the `triforge.python.interpreterPath`
setting, default `python3`) and needs a free **OpenTopography API key**. On
success it writes `generated_dem_<SOURCE>.tif` into the project's `Input` folder.
The tree scans for `.dem`/`.asc` files and its GeoTIFF handling is limited, so the
fetched `.tif` **may not appear in the tree on its own**. See
[Troubleshooting](troubleshooting.md#dem-download-fails) and
[Settings and data](settings.md#vs-code-setting).
:::

## Inputs

Inputs are authored through the **Input Generator**, reached from two nodes in the
**Simulations** tree under **Inputs**.

### Static inputs

**Open it:** `Inputs ▸ Static Inputs`. The functional pages are:

| Page | What you do | Applies with |
|---|---|---|
| Elevation | **Browse** a local DEM, or use the OpenTopography online tab. | (page-specific) |
| Water Depth | **Browse** an initial water-depth raster. | **Ok** |
| Water Discharge | **Browse** exactly two files — the QX and QY discharge rasters. | **Ok** |

### Dynamic inputs — water source

**Open it:** `Inputs ▸ Dynamic Inputs`. This opens the **Streamflow hydrograph**
page. Its **Create/Edit** tab is the authoring path for a water source:

| Field / action | Control | Default | Meaning |
|---|---|---|---|
| Distribution Type | dropdown | Constant | Constant (reveals **Value**) or Random (reveals **Min** / **Max**). |
| Value | number | 1 | Constant discharge value (Constant only). |
| Min / Max | number | — | Discharge range (Random only). |
| Add a source | **double-click inside the orange dashed project boundary** | — | Drops a source marker at that point; a discharge bar-chart appears for it. |
| Shape discharge over time | drag the bars in the hydrograph chart | — | Sets how much water the source releases at each time. |
| Manage sources | drag to move; click to select; right-click ▸ **Remove Marker** | — | Reposition or delete source markers. |

**Apply:** click **Ok**. It writes `<name>.src` and `<name>.hyg` and requires
**at least one marker** — clicking Ok with no marker inside the boundary errors.
A **Streamflow** node then appears under Dynamic Inputs.

:::{admonition} Coming soon
:class: note
Several Input Generator pages are stubs and are **not functional yet**: Surface
Roughness (Manning), Runoff, External boundaries, Observation locations, and
Runoff hydrograph. Don't rely on them.
:::

## Computation Setup

**Open it:** `Computation ▸ Setup` in the tree (or **Triforge: Open Computation
Setup**). Two sections: *TRITON Executable Target* and *Simulation Parameters*.

### TRITON Executable Target

Pick one option (radio); each reveals its own sub-fields.

| Option | Sub-fields |
|---|---|
| Build from Source (default) | TRITON Source Directory (+ **Browse**); Build Directory (default `<project>/build`, + **Browse**); Build Command (auto-filled). **Build Now** streams a Build Log. |
| Use Existing Executable | Executable Path (+ **Browse**). |
| Use Docker Image | Docker Image Name (+ **Download/Pull**, which runs `docker pull` in a VS Code terminal). |

### Simulation Parameters

| Field | Control | Default | Meaning |
|---|---|---|---|
| Start Date | date | today | Simulation start date. |
| Start Time | time | 12:00 | Simulation start time. |
| Timezone | dropdown | UTC | UTC or Local. |
| Sim Start (HH:MM) | number:number | 0:0 | Start offset (stored as seconds). |
| Duration (HH:MM) | number:number | 24:0 | Run length (stored as seconds). |
| Print Option | dropdown | huv | Output variables (h=depth, u/v=velocity). |
| Print Interval (s) | number | 900 | Output frame interval. |
| Time Increment Fixed | dropdown | 0 (Variable) | Fixed (1) vs adaptive (0) timestep. |
| Time Step | number | 0.01 (shown only when Fixed=1) | Fixed timestep (s). |
| Courant | number | 0.5 | CFL number bounding the adaptive step. |
| GPU Direct Flag | dropdown | 0 | Enable GPUDirect. |
| Domain Decomp | dropdown | static | Decomposition strategy. |
| Factor Interval DD | number | 2 (shown only when Dynamic) | Rebalance interval for dynamic decomposition. |
| Open Boundaries | dropdown | 0 | Open (outflow) domain edges. |

**Apply:** click **Ok** — it validates the executable target, then saves. **Cancel**
discards.

## Execution Setup

**Open it:** click the **Execution** node in the tree (or **Triforge: Open
Execution Setup**). It only opens when the active project has a **valid
computation target** — a built `triton.exe`, or a valid executable path / Docker
image from [Computation Setup](#computation-setup). Three sections: *Execution
Config*, *System Configuration*, and *Output Generation*.

| Field | Control | Default | Meaning |
|---|---|---|---|
| Execution Type | radio | Interactive | Interactive spawns the Run Command directly; Batch writes `triton_batch.sh` and submits it (reveals Batch Script Header + Step Launch Command; relabels Run Command → Batch Submission Command). |
| Run Directory | text | run_directory / build_dir / project path | Working dir for the run; `triton_execution.cfg` is written here. |
| Batch Script Header | textarea | (SBATCH template, Batch only) | Scheduler directives at the top of the batch script. |
| Run Command / Batch Submission Command | text | by target: `triton_run.sh` / `mpirun -n <cpus> <exe> <cfg>` / `docker run triton <cfg>`; Batch: `sbatch` | The launched command (the process count lives inside this string). |
| Step Launch Command | text | `srun …` (Batch only) | Per-step launch line in the batch script. |
| Environment Variables | textarea | (empty) | One `KEY=VALUE` per line, added to the child process's env. |
| Print Observation (s) | number | 900 | Observation interval written to the cfg. |
| Projection (EPSG/WKT) | text | EPSG:32616 | CRS for geo-referenced outputs. |
| Output Option | dropdown | PAR | PAR (parallel) vs SEQ (single). |
| Output Filename Pattern | text | `%s/%s/%s_%02d_%02d` | printf-style output name pattern. |
| Iteration Print Interval | number | 3600 | Print cadence (`it_print`). |
| IT Count | number | 0 | Iteration-count parameter. |
| Checkpoint ID | number | 0 | Checkpoint to resume from. |

**Apply:** click **Run Simulation** — a single button. Parameters persist when you
Run; there is no separate Save or Submit.

:::{note}
A run is a **detached child process that streams into the panel's Execution Output
log** — not a VS Code terminal. Closing the panel stops the run. (The only step
that uses a real terminal is the `docker pull` in Computation Setup.)
:::

## Visualizing results

**Open it:** in the **Simulations** tree, expand **Output**, then **right-click an
output category** (for example **Ascii**) and choose **Animate**. This opens the
**Triforge Map** with your results ready to play. (Clicking an input node —
Elevation, Water Depth, Water Discharge, or Streamflow — also opens the same map,
focused on that layer.)

Once the map is open, these panes and controls are available.

### Animation pane

| Control | Default | Meaning |
|---|---|---|
| ▶ Play / Pause | — | Play or pause the flood animation. |
| Timeline slider | — | Scrub to a specific frame; shows a frame counter with Date/Time labels. |
| Colormap | Rainbow | Water colormap (Rainbow / Blues / Teal / Water / Magma / Viridis / Grayscale). |
| Min / Max | Auto (+ reset) | Value range for the color scale. |
| Transparency | 80 | Opacity of the water layer. |

:::{note}
There is **no speed control** for the animation — only play/pause, the frame
slider, colormap, min/max, and transparency.
:::

### Elevation (DEM) pane

| Control | Default | Meaning |
|---|---|---|
| Colormap | Terrain | DEM colormap. |
| Min / Max | (+ reset) | Value range for the color scale. |
| Hillshade | — | Toggle shaded-relief lighting. |
| Transparency | 100 | Opacity of the DEM layer. |

### Data-dependent panes

These appear only when the project has the matching data:

- **Water Depth** — the initial-condition depth raster.
- **Water Discharge** — the QX/QY discharge layer, drawn as velocity arrows. It's
  a **static overlay** (not tied to the animation timeline) with **Scale**,
  **Stride**, and **Color** controls.
- **Streamflow** — the water-source markers.

### Base map and export

- **Base map switcher:** OpenStreetMap / OpenTopoMap / Satellite / None.
- **Download GIF:** enter crop mode, draw the crop box, press **Enter**, then
  choose a save path. Triforge captures the animated, basemap-backed map as a GIF.

:::{admonition} Not available yet
:class: note
The Coming-Soon Input Generator pages listed under [Inputs](#inputs) (Surface
Roughness/Manning, Runoff, External boundaries, Observation locations, Runoff
hydrograph) are not functional. There is also **no observation time-series
viewer** — "observation" appears only as configuration fields (Execution Setup)
and as one of those stub pages.
:::

## Share a project: export and import

A Triforge project is **portable**. You can pack the whole thing — its
configuration, its input data, and (optionally) its computed outputs — into a
single `.tfp` archive, hand that file to another machine, and unpack it there.
Inside the archive every path is stored **relative to the project**, so a `.tfp`
made on Windows imports cleanly on macOS or Linux, and the other way round.

| Action | Where | What happens |
|---|---|---|
| **Export Project…** | **right-click a project** in the **Projects** view | Choose *Inputs only* or *Inputs + outputs*, then a Save dialog writes `<project>.tfp` (defaults to your home folder). |
| **Import Project…** (⤓) | the **⤓ button in the Projects view title bar** | Choose a `.tfp`; the project is created under your Project Folder and becomes active. |

**What's in a `.tfp`:** the project's `config.json` (with project-relative paths),
everything under its `input/` folder, and the output data **only** when you export
*Inputs + outputs*. On import, Triforge rewrites the paths for the new machine and
regenerates `build/triton_execution.cfg`, so the imported project is ready to run
locally.

:::{note}
**Re-importing merges.** If you import a `.tfp` for a project you already have (same
project id), Triforge shows a **Merge** prompt instead of creating a duplicate.
Merging updates files from the archive and **combines the output lists**, so an
*Inputs only* archive can never erase outputs you computed locally (local build
settings are reset). This is what makes the round-trip below work.
:::

### Example: build on Windows, run on macOS, animate back on Windows

A common split is to do all the *authoring* on one machine and the *simulation run*
on another — say, the one with the GPU or the TRITON build. Here Windows does
everything except the run:

1. **On Windows** — create the project with **+ (Create New Project)**, download
   elevation with **Generate DEM**, add a water source under **Inputs ▸ Dynamic
   Inputs ▸ Streamflow**, and fill in [Computation Setup](#computation-setup) and
   [Execution Setup](#execution-setup). Do everything *except* the run.
2. **On Windows** — right-click the project ▸ **Export Project… ▸ Inputs only**,
   save `myflood.tfp`, and copy it to the Mac.
3. **On macOS** — click **⤓ Import Project…** in the Projects title bar and choose
   `myflood.tfp`. Open [Computation Setup](#computation-setup) and set *this*
   machine's TRITON target (build from source there, or point at a macOS executable
   or Docker image), then open **Execution Setup** and click **Run Simulation**.
4. **On macOS** — right-click the project ▸ **Export Project… ▸ Inputs + outputs**,
   save `myflood.tfp`, and copy it back to Windows.
5. **On Windows** — click **⤓ Import Project…**, choose the returned `myflood.tfp`,
   and confirm **Merge**. The computed outputs fold into your original project. Now
   right-click **Output ▸ Animate** to visualize the flood.

:::{admonition} Triforge ships the project, not the solver
:class: warning
The archive carries your project's data and configuration — it does **not** carry
TRITON itself. The machine that runs step 3 needs a working TRITON executable (built
from source, a prebuilt binary, or a Docker image; see
[Computation Setup](#computation-setup) and [Installation](installation.md)). And
because the exported archive preserves the project **id**, step 5 recognizes the
returning archive as the *same* project and offers **Merge** rather than creating a
duplicate.
:::
