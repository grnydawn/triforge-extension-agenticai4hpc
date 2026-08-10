import { expect } from 'chai';

import { AnimationLayer } from '../../../src/webview-ui/map/layers/AnimationLayer';
import { Colors } from '../../../src/webview-ui/map/utils/Colors';

/**
 * ANI-4 — NODATA color-FLOOR characterization (confirms a REFUTED bug).
 *
 * A reviewer flagged an "animation NODATA-color-collapse" bug: the claim was that
 * NODATA cells would drag/collapse the animation color scale, so real flood-depth
 * cells render with a degenerate (collapsed) color. Adversarial verification
 * REFUTED it (CODE_REVIEW.md, "Verification note" + "Animation render path is
 * genuinely optimized … a `getRange` percent-floor that correctly avoids the
 * NODATA color collapse a reviewer flagged (refuted finding)").
 *
 * This is therefore a CHARACTERIZATION test (NOT an `xfail`): it pins the
 * already-correct NODATA-floor behavior so a future change that DID collapse
 * NODATA onto the color floor would fail here.
 *
 * The behavior is governed by two pieces of REAL source:
 *
 *  1. `AnimationLayer.renderFrame` (`src/webview-ui/map/layers/AnimationLayer.ts`
 *     :161–170) — the per-pixel mapping. For each cell value `val`:
 *       - `val === -9999 || val === noData || val < min || val > max`
 *         => `pixels[i] = 0` (a FULLY TRANSPARENT pixel — RGBA 0,0,0,0).
 *       - otherwise => the colormap LUT entry at
 *         `clamp(Math.floor((val - min) * 255/(max-min)), 0, 255)`, fully OPAQUE.
 *     So a NODATA sentinel renders TRANSPARENT — it is masked out, it does NOT
 *     collapse onto the colormap floor color. A REAL value AT the floor
 *     (`val === min`) renders as LUT index 0 = `Colors.getColor(0, mapType)` —
 *     the colormap's floor color — which is a DISTINCT, opaque color, not the
 *     NODATA mask. (The LUT itself is built from the real `Colors.getColor`
 *     source: `AnimationLayer.ts` :106–110.)
 *
 *  2. `MapController.getRange(..., usePercent = true)` (`MapController.ts`
 *     :121–135) — when the animation min is "Auto" it returns `min = 0.01 * max`
 *     (a 1%-of-data-max percent floor), NOT the raw data minimum. Because the raw
 *     data minimum can be a NODATA sentinel (e.g. -9999), flooring at a percent of
 *     the data MAX is what keeps the NODATA sentinel from dragging the scale floor
 *     down. `getRange` is a private DOM/Leaflet-bound method, so it is not
 *     unit-callable in isolation; we instead exercise the authoritative
 *     consumer (`renderFrame`) directly with min/max and assert the floor/NODATA
 *     split, which is the rendered consequence the percent-floor protects.
 *
 * We drive the REAL `AnimationLayer.renderFrame` against a minimal Canvas/
 * `createImageBitmap` shim (Node has no DOM canvas) so the assertions read the
 * ACTUAL pixel buffer the source writes — this is a faithful exercise of the
 * source loop, not a re-derivation of it.
 */

// ---------------------------------------------------------------------------
// Minimal canvas shim — just enough for AnimationLayer.renderFrame to run and
// write into a real Uint8ClampedArray we can read back. renderFrame's pixel
// writes go through `new Uint32Array(imageData.data.buffer)`, so `data` MUST be
// a Uint8ClampedArray backed by a real ArrayBuffer.
// ---------------------------------------------------------------------------
class ShimImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

/** The most-recently-created ImageData — the buffer the source wrote pixels into. */
let lastImageData: ShimImageData | null = null;

class Shim2DContext {
  createImageData(w: number, h: number): ShimImageData {
    lastImageData = new ShimImageData(w, h);
    return lastImageData;
  }
  clearRect(): void {
    /* no-op */
  }
  putImageData(): void {
    /* no-op (the source already wrote into our ImageData.data buffer) */
  }
  drawImage(): void {
    /* no-op */
  }
}

class ShimCanvas {
  style: Record<string, string> = {};
  width = 0;
  height = 0;
  className = '';
  private ctx: Shim2DContext | null = null;
  getContext(): Shim2DContext {
    return this.ctx || (this.ctx = new Shim2DContext());
  }
  appendChild(): void {
    /* no-op */
  }
}

/** A Leaflet-map stand-in: only the calls AnimationLayer's ctor/transform make. */
const shimMap = {
  getPane: () => ({ appendChild: () => undefined }),
  on: () => undefined,
  latLngToLayerPoint: () => ({ x: 0, y: 0 }),
};

/**
 * Build an {@link AnimationLayer} with the shims installed, render `frame` over a
 * `cols × 1` grid with the given `min`/`max`/`noData`, and return each cell's
 * rendered RGBA. `bounds` is left null so `updateTransform` short-circuits (no
 * real Leaflet geometry needed).
 */
async function renderRow(
  frame: number[],
  opts: { min: number; max: number; noData: number; mapType?: string },
): Promise<number[][]> {
  const original = {
    ImageData: (globalThis as Record<string, unknown>).ImageData,
    createImageBitmap: (globalThis as Record<string, unknown>).createImageBitmap,
    document: (globalThis as Record<string, unknown>).document,
  };
  (globalThis as Record<string, unknown>).ImageData = ShimImageData;
  (globalThis as Record<string, unknown>).createImageBitmap = async (img: ShimImageData) => ({
    close: () => undefined,
    width: img.width,
    height: img.height,
  });
  (globalThis as Record<string, unknown>).document = {
    createElement: () => new ShimCanvas(),
  };
  lastImageData = null;

  try {
    const cols = frame.length;
    const rows = 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layer = new AnimationLayer(shimMap as any);
    if (opts.mapType) layer.setOptions({ mapType: opts.mapType });
    // bounds=null so updateTransform() early-returns; cols/rows/noData drive the
    // canvas size + the NODATA mask threshold inside renderFrame.
    layer.setDemContext(null, cols, rows, opts.noData);
    layer.setData([frame]);
    await layer.renderFrame(0, opts.min, opts.max);

    expect(lastImageData, 'renderFrame should have created the pixel ImageData').to.not.be.null;
    const d = lastImageData!.data;
    const out: number[][] = [];
    for (let i = 0; i < cols; i++) {
      out.push([d[i * 4], d[i * 4 + 1], d[i * 4 + 2], d[i * 4 + 3]]);
    }
    return out;
  } finally {
    (globalThis as Record<string, unknown>).ImageData = original.ImageData;
    (globalThis as Record<string, unknown>).createImageBitmap = original.createImageBitmap;
    (globalThis as Record<string, unknown>).document = original.document;
  }
}

describe('Animation NODATA color floor (ANI-4: NODATA is masked, not collapsed onto the floor)', () => {
  // Golden-shaped numbers: NODATA sentinel -9999, a real depth range like the
  // baseline (0 .. ~7.2 m). The min here is a real low value (the floor), not the
  // NODATA sentinel — which is the whole point of the percent-floor in getRange.
  const NODATA = -9999;
  const MIN = 0.5; // a real low depth (the color floor)
  const MAX = 7.0; // a real high depth (top of the color ramp)

  it('renders a NODATA cell as a fully transparent pixel (alpha 0), not a color', async () => {
    // Cells: [NODATA, a mid value, the max value].
    const [nodataPx, midPx, maxPx] = await renderRow([NODATA, 3.0, MAX], {
      min: MIN,
      max: MAX,
      noData: NODATA,
    });

    // NODATA => transparent mask (RGBA all zero). It is NOT painted with any
    // colormap color, so it cannot collapse the visible scale.
    expect(nodataPx, 'a NODATA cell must render fully transparent (RGBA 0,0,0,0)').to.deep.equal([
      0, 0, 0, 0,
    ]);

    // Real in-range cells render opaque (alpha 255) with real color.
    expect(midPx[3], 'a real in-range cell must be opaque (alpha 255)').to.equal(255);
    expect(maxPx[3], 'the max cell must be opaque (alpha 255)').to.equal(255);
  });

  it('renders a real value AT the floor (val===min) as the colormap index-0 floor color', async () => {
    // The default animation colormap is Rainbow (AnimationLayer.mapType default).
    const mapType = 'Rainbow';
    const [floorPx, nodataPx] = await renderRow([MIN, NODATA], {
      min: MIN,
      max: MAX,
      noData: NODATA,
      mapType,
    });

    // A real value exactly at the floor maps to LUT index 0 = Colors.getColor(0).
    // This is the colormap's FLOOR color — a distinct, opaque color, produced by
    // the real source colormap function (so this is not a hand-rolled constant).
    const [r, g, b] = Colors.getColor(0, mapType);
    expect(
      [floorPx[0], floorPx[1], floorPx[2]],
      'a real value at the floor (val===min) must paint the colormap index-0 floor color',
    ).to.deep.equal([r, g, b]);
    expect(floorPx[3], 'the floor cell must be opaque (alpha 255)').to.equal(255);

    // And the NODATA cell in the SAME frame stays transparent — proving NODATA
    // does NOT collapse onto the floor color (the refuted bug). The two outcomes
    // are genuinely different pixels.
    expect(nodataPx, 'NODATA must stay transparent even alongside a floor-value cell').to.deep.equal(
      [0, 0, 0, 0],
    );
    expect(
      nodataPx,
      'NODATA must NOT take the floor color — the two outcomes must differ',
    ).to.not.deep.equal(floorPx);
  });

  it('masks NODATA the same whether the sentinel is the literal -9999 or the configured noData', async () => {
    // renderFrame guards BOTH `val === -9999` AND `val === noData`. Use a NON-9999
    // configured sentinel to prove the configured-noData branch also masks (so a
    // DEM whose NODATA is, say, -3.4e38 is still masked, not collapsed).
    const customNoData = -32768;
    const [literalPx, customPx, realPx] = await renderRow([-9999, customNoData, 4.0], {
      min: MIN,
      max: MAX,
      noData: customNoData,
    });

    expect(literalPx, 'the literal -9999 sentinel must be masked transparent').to.deep.equal([
      0, 0, 0, 0,
    ]);
    expect(customPx, 'the configured noData sentinel must be masked transparent').to.deep.equal([
      0, 0, 0, 0,
    ]);
    expect(realPx[3], 'a real in-range value must remain opaque alongside masked NODATA').to.equal(
      255,
    );
  });

  it('keeps the floor distinct from the top of the ramp (a real, non-degenerate scale)', async () => {
    // With NODATA present, the visible color scale still spans floor..max for the
    // REAL values — the NODATA mask does not collapse the ramp onto one color.
    const mapType = 'Rainbow';
    const [floorPx, , topPx] = await renderRow([MIN, NODATA, MAX], {
      min: MIN,
      max: MAX,
      noData: NODATA,
      mapType,
    });
    expect(floorPx[3], 'floor cell opaque').to.equal(255);
    expect(topPx[3], 'top-of-ramp cell opaque').to.equal(255);
    // A non-degenerate ramp: the floor color differs from the top color.
    expect(
      [floorPx[0], floorPx[1], floorPx[2]],
      'the floor color must differ from the top-of-ramp color (the ramp is not collapsed)',
    ).to.not.deep.equal([topPx[0], topPx[1], topPx[2]]);
  });
});
