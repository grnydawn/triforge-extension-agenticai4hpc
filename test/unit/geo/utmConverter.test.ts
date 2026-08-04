import { expect } from 'chai';
import { UtmConverter } from '../../../src/webview-ui/map/utils/UtmConverter';

// proj4 is a runtime dependency of the project; use it as an independent oracle.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const proj4 = require('proj4').default || require('proj4');

describe('UtmConverter (smoke)', () => {
  it('exposes the static conversion methods', () => {
    expect(typeof UtmConverter.latLonToUtm).to.equal('function');
    expect(typeof UtmConverter.utmToLatLon).to.equal('function');
  });

  it('latLon -> UTM -> latLon round-trips to within ~1e-4 degrees', () => {
    const lat = 34.0, lon = -84.0; // UTM zone 17N (lon=-84 is in zone 17: floor((-84+180)/6)+1 = 17)
    const utm = UtmConverter.latLonToUtm(lat, lon);
    expect(utm.zone).to.equal(17);
    expect(utm.isNorth).to.equal(true);
    const back = UtmConverter.utmToLatLon(utm.x, utm.y, utm.zone, 'WGS84', utm.isNorth);
    expect(back.lat).to.be.closeTo(lat, 1e-4);
    expect(back.lng).to.be.closeTo(lon, 1e-4);
  });

  it('round-trips a southern-hemisphere point and matches proj4 within tolerance', () => {
    // Sao Paulo, Brazil -> UTM zone 23S (southern hemisphere).
    const lat = -23.55, lon = -46.63;

    const utm = UtmConverter.latLonToUtm(lat, lon);
    expect(utm.zone).to.equal(23);
    // Southern hemisphere must be flagged and carry the false northing (~1e7 m offset).
    expect(utm.isNorth).to.equal(false);
    expect(utm.y).to.be.greaterThan(5_000_000);

    // Round-trip back to geographic coordinates within ~1e-4 degrees.
    const back = UtmConverter.utmToLatLon(utm.x, utm.y, utm.zone, 'WGS84', utm.isNorth);
    expect(back.lat).to.be.closeTo(lat, 1e-4);
    expect(back.lng).to.be.closeTo(lon, 1e-4);

    // Independent oracle: proj4 forward projection to the same UTM zone (with +south).
    const utmProj = `+proj=utm +zone=${utm.zone} +south +datum=WGS84 +units=m +no_defs`;
    const wgs84 = '+proj=longlat +datum=WGS84 +no_defs';
    const [px, py] = proj4(wgs84, utmProj, [lon, lat]);
    // Agreement should be sub-millimetre; allow 1e-2 m of slack for series truncation.
    expect(utm.x).to.be.closeTo(px, 1e-2);
    expect(utm.y).to.be.closeTo(py, 1e-2);
  });

  it('honours an explicitly forced zone (number or string)', () => {
    // Point that naturally falls in zone 23; force it into the neighbouring zone 24.
    const lat = -23.55, lon = -46.63;

    const natural = UtmConverter.latLonToUtm(lat, lon);
    expect(natural.zone).to.equal(23);

    const forced = UtmConverter.latLonToUtm(lat, lon, 24);
    expect(forced.zone).to.equal(24);
    // A different central meridian must yield a different easting than the natural zone.
    expect(forced.x).to.not.equal(natural.x);

    // A string zone identifier must parse to the same forced numeric zone.
    const forcedFromString = UtmConverter.latLonToUtm(lat, lon, '24');
    expect(forcedFromString.zone).to.equal(24);
    expect(forcedFromString.x).to.be.closeTo(forced.x, 1e-6);
  });
});
