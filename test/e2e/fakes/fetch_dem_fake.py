#!/usr/bin/env python3
"""fetch_dem_fake.py - deterministic stand-in for src/scripts/fetch_dem.py.

The real fetch_dem.py is invoked as:

    python3 fetch_dem.py '<JSON config string>'

(see src/commands/map.ts), where the JSON config carries at least:
    output_path  - where the DEM file should be written
    width        - number of columns in the target grid
    height       - number of rows in the target grid
    utm_bbox     - [xmin, ymin, xmax, ymax] in the target CRS

The real script downloads a GTiff from OpenTopography, warps it to the target
grid, and writes it to output_path. This fake makes ZERO network calls and has
no rasterio/requests dependency. It mirrors just enough of the contract to be a
drop-in replacement for the E2E harness: it reads the JSON config from argv[1],
derives a small grid from width/height/utm_bbox, and writes a valid ESRI ASCII
(.asc) DEM to output_path. Then it exits 0.
"""

import sys
import json


def main():
    # Input config is passed as a JSON string argument (mirrors fetch_dem.py).
    config_str = sys.argv[1]
    config = json.loads(config_str)

    output_path = config["output_path"]

    # Use the requested grid dimensions, but clamp to a small fixture size so the
    # generated file stays tiny and deterministic regardless of caller request.
    req_width = int(config.get("width", 4))
    req_height = int(config.get("height", 4))
    ncols = max(1, min(req_width, 8))
    nrows = max(1, min(req_height, 8))

    utm_bbox = config.get("utm_bbox", [0.0, 0.0, 1.0, 1.0])
    xmin, ymin, xmax, ymax = (float(v) for v in utm_bbox)

    # cellsize from the bbox / requested grid (fall back to 30m, a common SRTM res).
    if req_width > 0 and (xmax - xmin) > 0:
        cellsize = (xmax - xmin) / req_width
    else:
        cellsize = 30.0

    nodata = -9999

    # Deterministic, gently varying elevation values so downstream parsers have
    # something non-trivial to read.
    rows = []
    for r in range(nrows):
        vals = [f"{100.0 + r + c:.4f}" for c in range(ncols)]
        rows.append(" ".join(vals))

    with open(output_path, "w") as f:
        f.write(f"ncols         {ncols}\n")
        f.write(f"nrows         {nrows}\n")
        f.write(f"xllcorner     {xmin:.4f}\n")
        f.write(f"yllcorner     {ymin:.4f}\n")
        f.write(f"cellsize      {cellsize:.4f}\n")
        f.write(f"NODATA_value  {nodata}\n")
        f.write("\n".join(rows))
        f.write("\n")

    print(f"Successfully generated DEM at {output_path}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001 - mirror fetch_dem.py's broad catch
        print(f"Error: {e}")
        sys.exit(1)
