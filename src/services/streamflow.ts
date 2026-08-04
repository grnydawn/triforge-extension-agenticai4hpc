// src/services/streamflow.ts
// Pure (no vscode): serialize TRITON streamflow inputs — source locations (.src) and
// the discharge hydrograph (.hyg). Lifted verbatim from InputGeneratorEditor so the
// GUI and the agent produce identical files.
import { UtmConverter } from '../webview-ui/map/utils/UtmConverter';

export interface SourceLatLng { lat: number; lng: number; }
export interface SourceUtm { x: number; y: number; }
export type Source = SourceLatLng | SourceUtm;

export function serializeSourceLocations(locations: Source[], zone: number | string): string {
  const lines = ['%X-Location,Y-Location'];
  for (const loc of locations) {
    let x: number;
    let y: number;
    if ('lat' in loc) {
      const utm = UtmConverter.latLonToUtm(loc.lat, loc.lng, zone);
      x = utm.x;
      y = utm.y;
    } else {
      x = loc.x;
      y = loc.y;
    }
    lines.push(`${x.toFixed(3)},${y.toFixed(3)}`);
  }
  return lines.join('\n');
}

export interface TimeBase { simStart: number; printInterval: number; simDuration: number; }

export function serializeHydrograph(hydrographs: number[][], tb: TimeBase): string {
  const simStart = tb.simStart || 0;
  const printInterval = tb.printInterval || 900;
  const simDuration = tb.simDuration || 86400;
  const numSteps = Math.ceil(simDuration / printInterval) + 1;
  const dataLen = hydrographs.length > 0 ? hydrographs[0].length : numSteps;
  const lines: string[] = [];
  for (let i = 0; i < dataLen; i++) {
    const t = simStart + i * printInterval;
    const row = [t.toFixed(1)];
    for (let j = 0; j < hydrographs.length; j++) {
      const val = hydrographs[j][i] !== undefined ? hydrographs[j][i] : 0;
      row.push(val.toFixed(4));
    }
    lines.push(row.join(','));
  }
  return lines.join('\n');
}
