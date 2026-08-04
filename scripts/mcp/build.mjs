// scripts/mcp/build.mjs — bundle the MCP server (ESM SDK + SDK-free tool logic)
// into one CommonJS file so `node dist/mcp/server.cjs` runs with no ESM/CJS
// interop at runtime.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/mcp/server.ts'],
  outfile: 'dist/mcp/server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // Target the MCP SDK's actual Node floor (>=18), not the local dev version, so
  // the bundle also runs on the older LTS Node common on HPC login nodes.
  target: 'node18',
  // vscode is never present headless; Logger's lazy require('vscode') (M5-0) is only
  // reached inside the extension host, so keep it external instead of bundling it.
  external: ['vscode'],
  logLevel: 'info',
});
