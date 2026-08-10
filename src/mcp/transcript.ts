// src/mcp/transcript.ts
import * as fs from 'fs';
import * as path from 'path';
import { TranscriptEntry } from './types';

/** Append-only JSONL record of every tool call — the AE reproduction unit. */
export class Transcript {
  constructor(private readonly filePath: string) {}

  record(entry: TranscriptEntry): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`);
  }
}
