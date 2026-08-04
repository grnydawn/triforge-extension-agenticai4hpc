// test/unit/services/floodGif.test.ts
import { expect } from 'chai';
import { frameToRgba, globalMinMax, renderFloodGif } from '../../../src/services/floodGif';
import { groupOutputFrames } from '../../../src/services/floodGif';

describe('globalMinMax', () => {
  it('scans all frames and skips nodata', () => {
    const r = globalMinMax([Float32Array.from([1, -9999, 3]), Float32Array.from([2, 5, -9999])], -9999);
    expect(r).to.deep.equal({ min: 1, max: 5 });
  });
});

describe('frameToRgba', () => {
  it('maps nodata/out-of-range to transparent and real values to opaque colormap bytes', () => {
    const out = frameToRgba(Float32Array.from([-9999, 0, 1]), { min: 0, max: 1, colormap: 'Grayscale', noData: -9999 });
    // nodata -> [0,0,0,0]; Grayscale t=0 -> white opaque; t=1 -> black opaque.
    expect(out.slice(0, 4)).to.deep.equal([0, 0, 0, 0]);
    expect(out.slice(4, 8)).to.deep.equal([255, 255, 255, 255]);
    expect(out.slice(8, 12)).to.deep.equal([0, 0, 0, 255]);
  });
});

describe('renderFloodGif', () => {
  it('drives the encoder start -> addFrame per frame -> finish and returns the path', async () => {
    const seen: string[] = [];
    const fakeGif: any = {
      start: (w: number, h: number) => seen.push(`start:${w}x${h}`),
      addFrame: () => seen.push('addFrame'),
      finish: async () => seen.push('finish'),
    };
    const out = await renderFloodGif({
      frames: [Float32Array.from([0, 1]), Float32Array.from([1, 0])],
      cols: 2, rows: 1, colormap: 'Grayscale', noData: -9999, delayMs: 100, outPath: '/tmp/a.gif',
    }, fakeGif);
    expect(out).to.equal('/tmp/a.gif');
    expect(seen).to.deep.equal(['start:2x1', 'addFrame', 'addFrame', 'finish']);
  });
});

describe('groupOutputFrames', () => {
  it('groups tiles by timestep, sorts tiles within a frame, and orders frames ascending', () => {
    // name_Frame_Subdomain.ext — two timesteps, two tiles each (given out of order).
    const files = ['H_1_1.out', 'H_0_1.out', 'H_1_0.out', 'H_0_0.out'];
    expect(groupOutputFrames(files)).to.deep.equal([
      ['H_0_0.out', 'H_0_1.out'],
      ['H_1_0.out', 'H_1_1.out'],
    ]);
  });

  it('orders frames numerically (10 after 2), not lexically', () => {
    const files = ['H_10_0.out', 'H_2_0.out'];
    expect(groupOutputFrames(files)).to.deep.equal([['H_2_0.out'], ['H_10_0.out']]);
  });

  it('handles the single-file-per-timestep sequence (name_Frame.ext)', () => {
    const files = ['depth_1.asc', 'depth_0.asc'];
    expect(groupOutputFrames(files)).to.deep.equal([['depth_0.asc'], ['depth_1.asc']]);
  });
});
