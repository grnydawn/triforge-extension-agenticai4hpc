---
id: grid-conventions
title: Grid conventions and geotransform mapping
keywords: [grid, cellsize, xll, yll, corner, geotransform, gdal, origin, crs]
---
All TRITON grids for one run share a single grid definition: `ncols`, `nrows`, `cellsize`, and the
lower-left corner `(xll, yll)` — the same convention as an ESRI ASCII header. Coordinates are in the
projected CRS of the workflow (metres); the `.bin` DEM itself stores no CRS, so a companion `.asc`,
`.tif`, or the source shapefile supplies it.

To map this to a GDAL geotransform `(originX, pixelW, 0, originY, 0, pixelH)`: GDAL's origin is the
**top-left** corner and rows increase downward, so `originX = xll`, `originY = yll + nrows*cellsize`,
`pixelW = cellsize`, `pixelH = -cellsize`. Two rasters are "on the same grid" when their `ncols`,
`nrows`, `cellsize`, and corner match — not when their byte sizes match (dtype and header size
differ across DEM/output/runoff formats).
