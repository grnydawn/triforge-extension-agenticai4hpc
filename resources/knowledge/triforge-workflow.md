---
id: triforge-workflow
title: The Triforge extension and its AI surfaces
keywords: [triforge, workflow, tfp, tools, surfaces, mcp, copilot, project]
---
Triforge is a VS Code extension for authoring, running, and diagnosing TRITON flood-simulation
workflows. Its capabilities are pure handlers exposed as tools across three surfaces from one
definition: the **GUI** (sidebar/panels), the **stdio MCP server** (external agents such as Claude
Code and Codex), and the **in-editor agent** (GitHub Copilot via VS Code Language Model Tools).

The agent tools include: `configure_solver` (render a `.cfg`), `run_local` (run a build/solver
command), `export_tfp` / `import_tfp` (a portable `.tfp` project archive that round-trips a whole
project, e.g. to and from HPC), `create_water_source`, `generate_dem`, `animate_gif`,
`diagnose_project` (static deck diagnosis), and `explain_triton` (this knowledge base).

A Triforge project is a folder with a TRITON deck plus `input/` and `output/` subfolders; Triforge
also writes `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`/copilot-instructions so any file-aware agent has
project context automatically.
