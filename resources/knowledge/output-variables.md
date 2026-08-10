---
id: output-variables
title: TRITON output variables and file naming
keywords: [h, qx, qy, mh, depth, discharge, maximum, output, outfile_pattern]
---
TRITON writes time-stepped output rasters (all in the `.out` format: 2-value `float64` header
`[nrows, ncols]` + row-major `float64`).

- **H** — water depth (m) at a time step.
- **QX / QY** — the x and y components of unit discharge (flow); velocity magnitude derives from
  these and depth.
- **MH** — maximum water height reached at each cell over the whole run (the running max of H). It
  is the usual "how bad was the flood" summary map.

Files follow `outfile_pattern` (e.g. `"%s/%s/%s_%02d_%02d"`), producing names like `MH_32_00.out`
where the trailing `_NN_NN` indexes the print step / sub-domain. A blocky, constant-valued region in
an MH map that ignores terrain is a classic symptom of garbage injected upstream (see failure-modes).
