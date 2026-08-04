import { expect } from 'chai';
import { ProjectionManager } from '../../../src/webview-ui/map/ProjectionManager';

// proj4 is a runtime dependency of the project; use it as an independent oracle for
// the geographic corner correspondences that drive the projective (homography) transform.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const proj4 = require('proj4').default || require('proj4');

// ProjectionManager.update(src, dst) builds a 2D projective transform mapping DEM grid
// indices (src) to a destination pixel/coordinate space (dst). demToPixel applies the
// forward transform; pixelToDem applies the inverse. Each entry is [x1,y1,x2,y2,x3,y3,x4,y4]
// for the four corners in the order TL, TR, BR, BL.

describe('ProjectionManager', () => {
  it('exposes the transform API', () => {
    expect(typeof ProjectionManager.update).to.equal('function');
    expect(typeof ProjectionManager.demToPixel).to.equal('function');
    expect(typeof ProjectionManager.pixelToDem).to.equal('function');
  });

  it('forward transform reproduces a known affine mapping; inverse round-trips', () => {
    const w = 100, h = 50;
    const src = [0, 0, w, 0, w, h, 0, h];
    // Pure affine destination: scale x and y by 4, translate by (10, 20).
    const dst = [10, 20, 410, 20, 410, 220, 10, 220];
    ProjectionManager.update(src, dst);

    // Corners must land exactly on the destination corners.
    expect(ProjectionManager.demToPixel(0, 0)).to.deep.equal([10, 20]);
    const br = ProjectionManager.demToPixel(w, h)!;
    expect(br[0]).to.be.closeTo(410, 1e-6);
    expect(br[1]).to.be.closeTo(220, 1e-6);

    // Interior point follows the analytic affine map: (10 + col*4, 20 + row*4).
    const fwd = ProjectionManager.demToPixel(50, 25)!;
    expect(fwd[0]).to.be.closeTo(10 + 50 * 4, 1e-6);
    expect(fwd[1]).to.be.closeTo(20 + 25 * 4, 1e-6);

    // Inverse transform recovers the original DEM grid index.
    const inv = ProjectionManager.pixelToDem(fwd[0], fwd[1])!;
    expect(inv[0]).to.be.closeTo(50, 1e-6);
    expect(inv[1]).to.be.closeTo(25, 1e-6);
  });

  it('forward transform matches proj4-projected corners; inverse round-trips (perspective case)', () => {
    // Define a DEM grid over a geographic bounding box. proj4 projects the four corner
    // lon/lat into UTM metres, and those metre coordinates become the destination space.
    // ProjectionManager must reproduce exactly the proj4 corner projections, and its
    // inverse must recover the source grid indices.
    const wgs84 = '+proj=longlat +datum=WGS84 +no_defs';
    const utmProj = '+proj=utm +zone=17 +datum=WGS84 +units=m +no_defs';

    const W = 1000, H = 800;
    // Corner lon/lat in TL, TR, BR, BL order (a region inside UTM zone 17N).
    const cornersLonLat = [
      [-84.5, 40.5], // TL
      [-83.5, 40.5], // TR
      [-83.5, 39.5], // BR
      [-84.5, 39.5], // BL
    ];
    const dstUTM = cornersLonLat.map(([lon, lat]) => proj4(wgs84, utmProj, [lon, lat]));

    const src = [0, 0, W, 0, W, H, 0, H];
    const dst = [
      dstUTM[0][0], dstUTM[0][1],
      dstUTM[1][0], dstUTM[1][1],
      dstUTM[2][0], dstUTM[2][1],
      dstUTM[3][0], dstUTM[3][1],
    ];
    ProjectionManager.update(src, dst);

    // Each grid corner must forward-project to exactly the proj4 UTM coordinate.
    for (let i = 0; i < 4; i++) {
      const f = ProjectionManager.demToPixel(src[i * 2], src[i * 2 + 1])!;
      expect(f[0]).to.be.closeTo(dst[i * 2], 1e-3);
      expect(f[1]).to.be.closeTo(dst[i * 2 + 1], 1e-3);
    }

    // The four UTM corners form a (slightly) non-affine quadrilateral, so this exercises
    // the perspective branch. Forward then inverse of an interior point recovers the source.
    const fwd = ProjectionManager.demToPixel(500, 400)!;
    const inv = ProjectionManager.pixelToDem(fwd[0], fwd[1])!;
    expect(inv[0]).to.be.closeTo(500, 1e-6);
    expect(inv[1]).to.be.closeTo(400, 1e-6);
  });
});
