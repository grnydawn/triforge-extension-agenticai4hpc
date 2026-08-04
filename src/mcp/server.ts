// src/mcp/server.ts
// The ONLY file that imports the MCP SDK. Bundled to dist/mcp/server.cjs by
// esbuild (scripts/mcp/build.mjs) and excluded from `tsc` typecheck.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildRegistry } from './registry';
import { Transcript } from './transcript';

async function main(): Promise<void> {
  const transcriptPath = process.env.TRIFORGE_MCP_TRANSCRIPT ?? 'triforge-mcp-transcript.jsonl';
  const transcript = new Transcript(transcriptPath);
  const registry = buildRegistry();
  const server = new McpServer({ name: 'triforge-mcp', version: '0.1.0' });
  for (const def of registry.list()) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.inputSchema },
      async (args: Record<string, unknown>) => {
        const r = await registry.call(def.name, args, transcript);
        return { content: r.content, isError: r.isError };
      },
    );
  }
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
