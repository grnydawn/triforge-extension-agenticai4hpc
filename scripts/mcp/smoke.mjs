// scripts/mcp/smoke.mjs — spawn the built server over stdio, list tools, and
// exercise configure_solver. Doubles as the Artifact-Evaluation demo harness.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/mcp/server.cjs'],
  env: { ...process.env, TRIFORGE_MCP_TRANSCRIPT: 'dist/mcp/smoke-transcript.jsonl' },
});
const client = new Client({ name: 'triforge-mcp-smoke', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
console.log('TOOLS:', names.join(', ') || '(none)');
for (const need of ['configure_solver', 'run_local', 'export_tfp', 'import_tfp', 'create_water_source', 'generate_dem', 'animate_gif']) {
  if (!names.includes(need)) {
    console.error(`FAIL: ${need} not listed`);
    process.exit(1);
  }
}

const res = await client.callTool({
  name: 'configure_solver',
  arguments: { project: { sim_duration: 7200 }, templatePath: 'resources/triton_execution.cfg.template' },
});
const text = res.content[0].text;
console.log('CFG_CONTAINS_7200:', text.includes('7200'));
if (!text.includes('7200')) {
  console.error('FAIL: rendered cfg missing the injected value');
  process.exit(1);
}

// --- HITL two-call demonstration on run_local ---
import * as fsq from 'fs';
fsq.mkdirSync('dist/mcp/runlocal-smoke', { recursive: true });
const runArgs = {
  project: { sim_duration: 60 },
  runDir: 'dist/mcp/runlocal-smoke',
  runCommand: `node -e "console.log('RAN_OK')"`,
  templatePath: 'resources/triton_execution.cfg.template',
};

const pending = await client.callTool({ name: 'run_local', arguments: runArgs });
const pendingText = pending.content[0].text;
const m = pendingText.match(/APPROVAL_TOKEN: (\S+)/);
console.log('RUN_LOCAL_GATED:', pendingText.includes('APPROVAL REQUIRED') && !!m);
if (!m) {
  console.error('FAIL: run_local did not return an approval token');
  process.exit(1);
}

const approved = await client.callTool({ name: 'run_local', arguments: { ...runArgs, approvalToken: m[1] } });
const ranOk = approved.content[0].text.includes('RAN_OK');
console.log('RUN_LOCAL_APPROVED_RAN:', ranOk);
if (!ranOk) {
  console.error('FAIL: run_local did not run after approval');
  process.exit(1);
}

// --- .tfp round-trip: export a tiny project, then gated import ---
import * as pathq from 'path';
const projDir = 'dist/mcp/tfp-smoke/proj';
fsq.mkdirSync(pathq.join(projDir, 'input'), { recursive: true });
fsq.writeFileSync(pathq.join(projDir, 'input', 'dem.asc'), 'DEM');
fsq.writeFileSync(pathq.join(projDir, 'config.json'), JSON.stringify({
  settings: { name: 'SmokeProj', id: 'smoke-1', path: projDir },
  input: { dem: pathq.join(projDir, 'input', 'dem.asc') },
  compsetup: {}, execution: {}, output: { geotiff: [], binary: [], ascii: [] },
}));
const tfpPath = 'dist/mcp/tfp-smoke/smoke.tfp';
const exp = await client.callTool({ name: 'export_tfp', arguments: { projectDir: projDir, outPath: tfpPath } });
const exportedOk = !exp.isError && fsq.existsSync(tfpPath);
console.log('EXPORT_TFP_OK:', exportedOk);
if (!exportedOk) { console.error('FAIL: export_tfp did not write the archive'); process.exit(1); }

const destRoot = 'dist/mcp/tfp-smoke/imported';
const impArgs = { archivePath: tfpPath, destRoot };
const impPending = await client.callTool({ name: 'import_tfp', arguments: impArgs });
const im = impPending.content[0].text.match(/APPROVAL_TOKEN: (\S+)/);
console.log('IMPORT_TFP_GATED:', impPending.content[0].text.includes('APPROVAL REQUIRED') && !!im);
if (!im) { console.error('FAIL: import_tfp did not gate'); process.exit(1); }
const imp = await client.callTool({ name: 'import_tfp', arguments: { ...impArgs, approvalToken: im[1] } });
const importedOk = !imp.isError && fsq.existsSync(pathq.join(destRoot, 'config.json'));
console.log('IMPORT_TFP_APPROVED_RAN:', importedOk);
if (!importedOk) { console.error('FAIL: import_tfp did not import after approval'); process.exit(1); }

await client.close();
console.log('SMOKE OK');
