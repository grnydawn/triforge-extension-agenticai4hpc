// src/mcp/tools/explainTriton.ts
import * as path from 'path';
import { z } from 'zod';
import { ToolDef, ToolResult } from '../types';
import { loadKnowledge, lookupKnowledge } from '../../services/tritonKnowledge';

// Bundled knowledge dir relative to the built server (dist/mcp/server.cjs) → <ext>/resources/knowledge.
// CWD-independent (unlike configure_solver's process.cwd() default). The LM surface overrides this
// via args.knowledgeDir (extensionUri-derived); the MCP surface uses this default.
const DEFAULT_KNOWLEDGE_DIR = path.join(__dirname, '..', '..', 'resources', 'knowledge');

export const explainTritonTool: ToolDef = {
  name: 'explain_triton',
  description:
    'Answer TRITON/Triforge domain questions from a curated, vetted knowledge base. Call this ' +
    'before answering any question about TRITON file formats, deck (.cfg) structure, output ' +
    'variables (H/QX/QY/MH), grid conventions, common failure modes, or the Triforge workflow. ' +
    'Pass `topic` (a keyword or article id, e.g. "file-formats", "runoff map", "MH") to read an ' +
    'article; omit `topic` to list topics. Read-only reference — never modifies a project.',
  inputSchema: {
    topic: z.string().optional(),
  },
  handler: (args): ToolResult => {
    const dir = typeof args.knowledgeDir === 'string' && args.knowledgeDir
      ? args.knowledgeDir
      : DEFAULT_KNOWLEDGE_DIR;
    const topic = typeof args.topic === 'string' ? args.topic : undefined;
    return { content: [{ type: 'text', text: lookupKnowledge(loadKnowledge(dir), topic) }] };
  },
};
