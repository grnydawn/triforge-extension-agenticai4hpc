---
id: file-formats
title: TRITON binary and ASCII file formats
keywords: [bin, asc, dem, header, matrix, int32, float64, gtiff, sidecar, runoff, output]
---
TRITON reads and writes several on-disk grid formats. Getting the header/dtype right is essential
because TRITON trusts the file layout with almost no validation.

**DEM binary (`.bin`, `input_format=BIN`).** A 6-value `float64` header
`[ncols, nrows, xll, yll, cellsize, nodata]` followed by row-major `float64` elevation data.
`xll`/`yll` are the lower-left corner (ESRI-style). File size = `(6 + ncols*nrows) * 8` bytes.

**Output / initial-condition rasters (`.out`).** A 2-value `float64` header `[nrows, ncols]`
followed by row-major `float64` data. Used by `H_*`, `QX_*`, `QY_*`, `MH_*` outputs and by
`h_infile`/`qx_infile`/`qy_infile` restart inputs. File size = `(2 + nrows*ncols) * 8` bytes — note
the 2-value header, 32 bytes smaller than a same-grid DEM's 6-value header.

**Runoff map (`.bin`).** TRITON reads it as `matrix<int>`: a 2-value `int32` header `[nrows, ncols]`
then row-major `int32` zone ids. Because it is `int32` (4 bytes/cell), a same-grid runoff map is
half the byte size of the `float64` DEM — a byte-for-byte size comparison against the DEM is wrong.

**ASCII (`.asc`, AAIGrid) and GeoTIFF (`.tif`/`.tiff`).** ESRI ASCII grids carry an `ncols/nrows/
xllcorner/yllcorner/cellsize/NODATA_value` text header. A `.asc` sidecar next to a `.bin` is the
reliable way to recover a binary grid's cell count. GeoTIFFs are GDAL-readable and carry a CRS; the
TRITON `.bin` DEM does not.
