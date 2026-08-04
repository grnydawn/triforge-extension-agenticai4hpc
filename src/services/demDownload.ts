// src/services/demDownload.ts
// Pure orchestration of the OpenTopography DEM pipeline (no vscode). Mirrors
// InputGeneratorEditor._handleGetDemFromOpenTopography lines 186-237.
import { DemManager } from '../parsers/DemManager';
import { DemResampler } from './DemResampler';
import { OpenTopographyService } from './OpenTopographyService';
import type { DemHeader } from '../parsers/DemParser';

export interface DemDownloadDeps {
  downloadDem: (apiKey: string, source: string, header: DemHeader, utmZone: string, datum: string, outDir: string) => Promise<string>;
  load: (filePath: string) => Promise<import('../parsers/DemParser').DemData>;
  resample: (source: import('../parsers/DemParser').DemData, targetHeader: DemHeader, utmZone: string, datum: string) => Promise<import('../parsers/DemParser').DemData>;
  save: (filePath: string, data: import('../parsers/DemParser').DemData) => Promise<void>;
}

const defaultDeps: DemDownloadDeps = {
  downloadDem: (apiKey, source, header, utmZone, datum, outDir) =>
    OpenTopographyService.downloadDem(apiKey, source, header, utmZone, datum, outDir),
  load: (p) => DemManager.load(p),
  resample: (s, h, z, d) => DemResampler.resample(s, h, z, d),
  save: (p, d) => DemManager.save(p, d),
};

export interface DemDownloadOptions {
  apiKey: string; source: string; targetHeader: DemHeader;
  utmZone: string; datum: string; outPath: string; tmpDir: string;
}

export async function downloadProjectDem(
  o: DemDownloadOptions,
  deps: DemDownloadDeps = defaultDeps,
): Promise<{ outPath: string; cols: number; rows: number }> {
  const wgs84Path = await deps.downloadDem(o.apiKey, o.source, o.targetHeader, o.utmZone, o.datum, o.tmpDir);
  const wgs84 = await deps.load(wgs84Path);
  const utm = await deps.resample(wgs84, o.targetHeader, o.utmZone, o.datum);
  await deps.save(o.outPath, utm);
  return { outPath: o.outPath, cols: o.targetHeader.ncols, rows: o.targetHeader.nrows };
}
