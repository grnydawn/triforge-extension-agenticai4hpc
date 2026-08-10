import { expect } from 'chai';

import { UtmConverter } from '../../../src/webview-ui/map/utils/UtmConverter';

/**
 * MAP-4 unit guard — BUG-5 (selection half): a crop box straddling a UTM zone
 * boundary must be converted under a SINGLE forced reference zone so all four
 * corners share one zone / consistent eastings.
 *
 * BUG-5 (source): `src/webview-ui/map/MapController.ts:956–980`
 * (`handleSelectionComplete`). The BUG was: each corner was converted with its
 * OWN auto-detected zone (`UtmConverter.latLonToUtm(lat, lon)` — no `forceZone`),
 * then `Math.min/max` over the resulting eastings spanned two different central
 * meridians / false-easting frames, and the header was tagged with only
 * `nwUtm.zone`. A box straddling a zone boundary thus produced a grossly
 * mis-sized, silently mis-georeferenced area.
 *
 * The FIX converts ALL FOUR corners under a single forced reference zone (the
 * box centroid's zone) before `Math.min/max`, and tags the header with that
 * single zone. This unit mirrors that FIXED computation faithfully (the inline
 * conversion in `handleSelectionComplete` needs a live Leaflet map + webview DOM
 * and is not reachable from a Node unit — mirrors the VIEW-3 unit-guard
 * precedent) and asserts the post-fix property as a bare assertion: with all
 * four corners in one reference zone the derived UTM easting span equals the
 * box's real geographic width and all four corners share a single zone.
 *
 * (Was xfail('BUG-5', ...) — flipped to bare green when BUG-5 landed.)
 */
describe('Cross-zone selection (MAP-4 / BUG-5: single forced reference zone)', () => {
  // A 1°×1° crop box straddling the UTM zone 17/18 boundary (zone meridian at
  // lon = -78): the western edge is in zone 17, the eastern edge in zone 18.
  const north = 39.0;
  const south = 38.0;
  const west = -78.5; // zone 17
  const east = -77.5; // zone 18

  // The FIXED computation (mirrors MapController.handleSelectionComplete): pick a
  // single forced reference zone from the box centroid, then convert all four
  // corners under it before spanning the eastings with Math.min/max.
  const centroidLon = (east + west) / 2; // zone depends on longitude only
  const refZone = Math.floor((centroidLon + 180) / 6.0) + 1;

  const nwUtm = UtmConverter.latLonToUtm(north, west, refZone);
  const seUtm = UtmConverter.latLonToUtm(south, east, refZone);
  const neUtm = UtmConverter.latLonToUtm(north, east, refZone);
  const swUtm = UtmConverter.latLonToUtm(south, west, refZone);

  it('derives a UTM easting span equal to the box width across a zone boundary', () => {
    // The true geographic width of the box at its mid-latitude, in metres.
    const midLat = (north + south) / 2;
    const trueWidthMeters = (east - west) * Math.cos((midLat * Math.PI) / 180) * 111320;

    const minX = Math.min(nwUtm.x, seUtm.x, neUtm.x, swUtm.x);
    const maxX = Math.max(nwUtm.x, seUtm.x, neUtm.x, swUtm.x);
    const derivedWidthMeters = maxX - minX;

    // Post-fix property: a box straddling the zone boundary maps to a UTM area
    // whose width matches its real geographic width (because all four corners
    // share ONE reference zone). The per-corner auto-zone span was inflated ~5x.
    expect(
      derivedWidthMeters,
      'a cross-zone crop must yield a UTM easting span equal to its real width ' +
        '(all four corners converted under one forced reference zone) — BUG-5',
    ).to.be.closeTo(trueWidthMeters, 0.1 * trueWidthMeters);
  });

  it('tags all four corners with a single, shared UTM zone', () => {
    const zones = [nwUtm.zone, seUtm.zone, neUtm.zone, swUtm.zone];

    // Post-fix property: all four corners resolve to ONE shared reference zone
    // (the box centroid's zone), so the eastings are mutually consistent.
    expect(
      new Set(zones).size,
      'all four corners of a cross-zone crop must share a single forced ' +
        'reference zone so their eastings are consistent — BUG-5',
    ).to.equal(1);

    // And that shared zone is the centroid's reference zone.
    expect(new Set(zones).has(refZone), 'the shared zone is the box centroid zone — BUG-5').to.be
      .true;
  });
});
