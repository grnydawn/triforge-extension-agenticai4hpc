// src/services/floodGif.ts
// Pure (no vscode/DOM): turn water-depth raster frames into a colormap GIF.
import { Colors } from '../webview-ui/map/utils/Colors';
import { GifEncoderService } from './GifEncoderService';

/** Global min/max across every frame, ignoring nodata (stable color scale). */
export function globalMinMax(frames: Float32Array[], noData: number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const f of frames) {
    for (let i = 0; i < f.length; i++) {
      const v = f[i];
      if (v === -9999 || v === noData || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min)) { min = 0; max = 1; }
  return { min, max };
}

/** One frame -> flat RGBA byte array (length = frame.length * 4). nodata/out-of-range
 *  -> fully transparent; else `Colors.getColor(t)` opaque. Mirrors AnimationLayer:161-170. */
export function frameToRgba(
  frame: Float32Array,
  opts: { min: number; max: number; colormap: string; noData: number },
): number[] {
  const { min, max, colormap, noData } = opts;
  const range = max - min;
  const out = new Array<number>(frame.length * 4);
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i];
    const o = i * 4;
    if (v === -9999 || v === noData || v < min || v > max) {
      out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0;
    } else {
      const t = range > 0 ? (v - min) / range : 0;
      const c = Colors.getColor(t, colormap);
      out[o] = Math.round(c[0]); out[o + 1] = Math.round(c[1]); out[o + 2] = Math.round(c[2]); out[o + 3] = 255;
    }
  }
  return out;
}

export interface FloodGifOptions {
  frames: Float32Array[];
  cols: number;
  rows: number;
  colormap: string;
  noData: number;
  delayMs: number;
  outPath: string;
  min?: number;
  max?: number;
}

/** Encode frames to a GIF at outPath. Uses a global min/max unless both are given. */
export async function renderFloodGif(
  o: FloodGifOptions,
  gif: GifEncoderService = new GifEncoderService(),
): Promise<string> {
  const scale = (o.min !== undefined && o.max !== undefined)
    ? { min: o.min, max: o.max }
    : globalMinMax(o.frames, o.noData);
  gif.start(o.cols, o.rows, o.delayMs, o.outPath, o.frames.length);
  for (const f of o.frames) {
    gif.addFrame(frameToRgba(f, { min: scale.min, max: scale.max, colormap: o.colormap, noData: o.noData }));
  }
  await gif.finish();
  return o.outPath;
}

/** Group TRITON output tile files into per-timestep frames, ordered ascending in time.
 *  Reproduces the grouping/sort in src/commands/animation.ts:246-341 without vscode.
 *  Filenames: `name_Frame_Subdomain.ext` (tiled) or `name_Frame.ext` (single sequence). */
export function groupOutputFrames(files: string[]): string[][] {
  const base = (p: string): string => p.replace(/^.*[\\/]/, '');
  const tileIndex = (p: string): number => {
    const m = base(p).match(/_(\d+)\.[a-zA-Z0-9]+$/);
    return m ? parseInt(m[1], 10) : 0;
  };
  const groups = new Map<string, { frame: number; files: string[] }>();
  for (const f of files) {
    const name = base(f);
    const tiled = name.match(/^(.*)_(\d+)_(\d+)\.[a-zA-Z0-9]+$/);
    const single = name.match(/^(.*)_(\d+)\.[a-zA-Z0-9]+$/);
    let key: string;
    let frame: number;
    if (tiled) {
      frame = parseInt(tiled[2], 10);
      key = `${tiled[1]}_${frame}`;
    } else if (single) {
      frame = parseInt(single[2], 10);
      key = `${single[1]}_${frame}`;
    } else {
      frame = 0;
      key = name;
    }
    if (!groups.has(key)) groups.set(key, { frame, files: [] });
    groups.get(key)!.files.push(f);
  }
  const ordered = Array.from(groups.values());
  for (const g of ordered) g.files.sort((a, b) => tileIndex(a) - tileIndex(b));
  ordered.sort((a, b) => a.frame - b.frame);
  return ordered.map((g) => g.files);
}
