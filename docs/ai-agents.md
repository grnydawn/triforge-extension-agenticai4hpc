# Work with AI agents

Triforge can hand an AI assistant the same actions you take by hand — setting up the
solver, running it, checking a project for problems, answering questions about TRITON,
fetching terrain, adding a water source, and rendering results. So you can drive a whole
flood-simulation workflow just by asking, in plain language. You stay in control: anything that changes files or
launches a run asks for your approval first, and your API keys are never shared with
the assistant.

There are two ways to connect an assistant, depending on which one you use:

| Your assistant | How it reaches Triforge | Setup |
|---|---|---|
| **GitHub Copilot** (in VS Code, *agent mode*) | Built in — the Triforge extension registers its tools automatically | None |
| **Claude Code**, **Codex**, **Claude Desktop** | Through Triforge's **MCP server** (a small program the assistant launches) | One-time build, then connect |

:::{admonition} Which one should I use?
:class: tip
If you already use **Copilot** inside VS Code, start there — there's nothing to install
([jump to the steps](#use-it-in-vs-code-with-copilot)). If you use **Claude Code** or
**Codex**, use the [MCP server path](#use-it-with-claude-code-codex-or-claude-desktop).
The two are separate: Copilot uses the built-in tools and does *not* see the MCP server,
and Claude Code/Codex use the MCP server and do *not* see Copilot's tools. That's
expected — pick the path for your assistant.
:::

## What an AI agent can do for you

Once connected, you can ask the assistant to do any of these. Each maps to one Triforge
tool (its `tool_name` is shown), and each row gives an example prompt you can adapt. The
**read-only** tools run on their own; the **✋ Asks-first** tools pause for your explicit
approval before they act.

**Read-only — run freely:**

| Ask it to… (tool) | What it does | Example prompt |
|---|---|---|
| **Diagnose a project** — `diagnose_project` | Statically checks the `.cfg` and inputs and returns ranked, evidence-backed problems | *"Diagnose this project and list what would make it run but come out wrong, worst first."* |
| **Explain TRITON** — `explain_triton` | Answers TRITON/Triforge questions from a vetted knowledge base — file formats, deck structure, output variables (`H`/`QX`/`QY`/`MH`), failure modes | *"Using explain_triton, what do the H, QX, QY, and MH outputs mean, and how are they stored?"* |
| **Configure the solver** — `configure_solver` | Writes the TRITON run configuration (`.cfg`) for your project | *"Configure the solver for a 2-hour run and show me the .cfg."* |
| **Export the project** — `export_tfp` | Packages the project (config + inputs, optionally outputs) into one portable `.tfp` file to move to a cluster | *"Package this project as a .tfp so I can move it to the cluster — include the outputs."* |
| **Animate the output** — `animate_gif` | Renders a flood-depth animation as a GIF from a finished run | *"Animate the water depth for this project's latest run as a GIF using the Blues colormap."* |

**✋ Asks first — pauses for your approval:**

| Ask it to… (tool) | What it does | Example prompt |
|---|---|---|
| **Generate a DEM** — `generate_dem` | Downloads elevation data for your simulation area from OpenTopography | *"Download a DEM for this project's area and use it as the input."* |
| **Create a water source** — `create_water_source` | Adds an inflow — a source location plus a discharge hydrograph — to the project | *"Add a water source at 36.10, -86.80 with inflow over time 0, 5, 40, 120, 60, 10 m³/s."* |
| **Run TRITON locally** — `run_local` | Launches the run and streams the live output back | *"Run this project locally with `mpirun -np 4 ./triton` and show me the output."* |
| **Import a project** — `import_tfp` | Unpacks a `.tfp` and re-localizes it to this machine | *"Import ~/Downloads/my-flood.tfp into a new project folder."* |

:::{note}
The assistant acts on your **active Triforge project** by default. The read-only
**Diagnose** action can also target any TRITON project folder you point it at, even one
Triforge didn't create — useful for checking a hand-built deck.
:::

(use-it-in-vs-code-with-copilot)=
## Use it in VS Code with Copilot

No setup — the Triforge extension registers its tools with VS Code automatically.

1. Make sure **GitHub Copilot** and **Copilot Chat** are installed and you're signed in.
2. Open your Triforge project folder in VS Code.
3. Open the **Copilot Chat** view and switch the chat mode to **Agent**.
4. Ask for what you want in plain language, e.g. *"Diagnose this project and fix the
   solver configuration."* Copilot picks the right Triforge tools automatically. (You can
   also name a tool explicitly by typing `#` — for example `#configureSolver`.)
5. When Copilot uses an **✋ Asks first** action, VS Code shows an **Allow / Cancel**
   prompt with what it's about to do. Read it, then **Allow** (or Cancel).

The Triforge tools show up in Copilot as **Configure TRITON solver**, **Run TRITON
locally**, **Diagnose TRITON project**, and the rest of the list above.

:::{admonition} Copilot shows the tools but Claude Code doesn't (or vice-versa)
:class: note
That's expected. Copilot uses VS Code's built-in tool mechanism; Claude Code and Codex
use the MCP server. If your assistant is Claude Code or Codex, set up the MCP server
below.
:::

(use-it-with-claude-code-codex-or-claude-desktop)=
## Use it with Claude Code, Codex, or Claude Desktop

These assistants reach Triforge through its **MCP server** — a small program the
assistant launches on demand. Build it once, connect your assistant, then check the
connection.

### 1. Build the server (once)

From your Triforge checkout:

```bash
cd <your triforge folder>
npm ci                 # install dependencies (first time only)
npm run mcp:build      # creates dist/mcp/server.cjs
```

:::{admonition} Point the assistant at the built file, not the folder
:class: warning
The launch command is `node <your triforge folder>/dist/mcp/server.cjs` — it ends in
**`/dist/mcp/server.cjs`**. Pointing `node` at the repository *folder* does **not** start
the server (the assistant then sees zero tools). Run `npm run mcp:build` first so the
file exists, and use its full path.
:::

### 2. Connect your assistant

::::{tab-set}

:::{tab-item} Claude Code
**Zero setup from the repo:** the repository ships a project-scoped `.mcp.json`, so after
`npm run mcp:build`, both the `claude` CLI (run from the repo folder) and the Claude Code
VS Code extension (open the repo as the workspace) **discover the server automatically**.
Approve the Triforge tools when Claude Code first offers them.

**To use it from anywhere else**, register the absolute path once:

```bash
claude mcp add triforge -- node /ABS/triforge/dist/mcp/server.cjs
claude mcp list        # triforge should show "connected"
```
:::

:::{tab-item} Codex
Add the server to `~/.codex/config.toml` (use your absolute path):

```toml
[mcp_servers.triforge]
command = "node"
args = ["/ABS/triforge/dist/mcp/server.cjs"]
```
:::

:::{tab-item} Claude Desktop
Add the server to `claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`), then restart
Claude Desktop:

```json
{
  "mcpServers": {
    "triforge": {
      "command": "node",
      "args": ["/ABS/triforge/dist/mcp/server.cjs"]
    }
  }
}
```
:::

::::

### 3. Check it's connected

- **Claude Code:** type `/mcp` — you should see **triforge** listed with its tools. Or
  ask *"list your triforge tools."*
- **Codex / Claude Desktop:** ask the assistant to list its available tools; the Triforge
  ones should appear.

:::{admonition} The tell-tale that the server is NOT connected
:class: caution
If, when you ask it to do something, the assistant starts **reading the source code** or
running scripts "to figure out the behavior" instead of calling a tool, the server isn't
connected. Re-check step 2 (usually the launch path), rebuild with `npm run mcp:build`,
and confirm the tools are listed. When it *is* connected, you'll get an approval prompt
for the action instead.
:::

## Make your projects legible with `@name`

Beyond running the tools, Triforge can make your projects **referable by name** in a
prompt, so you can point the assistant at a specific project. This works in two steps:
**reference** a project with `@name`, and **publish** a catalog the assistant reads to
resolve it.

### Reference a project with `@name`

While you draft a prompt in any **Markdown or plaintext editor**, type `@`. Triforge pops
a completion list of your projects — one entry per project as `@<folder-name>`, each with
a one-line summary. Pick one to drop the reference into your prompt.

:::{note}
The reference is the project's **folder name**, not its display name — a project shown as
"My Flood" whose folder is `my-flood` is referenced `@my-flood`. The completion fires in
Markdown/plaintext **editors**, where you compose prompt files; it is not a control inside
an assistant's chat box.
:::

### Publish the catalog with the 🏠 home button

For an assistant to *resolve* `@my-flood`, it has to be able to read Triforge's project
catalog. Click **Open Triforge Home (AI Catalog)** — the **🏠 button in the Projects view
title bar**. (It appears only while the Triforge home isn't already your first workspace
folder, and hides once it is.) Clicking it:

- writes the catalog into your `.triforge` home folder as `CLAUDE.md`, `GEMINI.md`,
  `AGENTS.md`, and `.github/copilot-instructions.md` (the same catalog in each), and
- opens that `.triforge` folder as your **first workspace folder** (one reload).

Assistants key their working directory off the first workspace folder and auto-read one
of those files, so this is what lets `@name` resolve to the right project.

| AI tool | File it auto-reads |
|---|---|
| Claude Code | `CLAUDE.md` |
| Gemini | `GEMINI.md` |
| Codex | `AGENTS.md` |
| GitHub Copilot | `.github/copilot-instructions.md` |

Each project folder also gets its own `AGENTS.md` manifest — a directory map, the setup
summary, an output-data guide, and how to run or modify the project — so once the
assistant follows a `@name` reference it has full context. **Your API keys are never
written** into any of these files, and Triforge won't overwrite a `CLAUDE.md` or
`AGENTS.md` you authored yourself (it only rewrites files it generated).

:::{note}
Clicking the button reloads the VS Code window once and seats the home right away — the
click *is* your consent, so there's no extra prompt. (Triforge can also seat the home
**automatically** at startup; that path asks first unless you've enabled AI project
access, governed by the **AI project focus** setting in
[Global Settings](settings.md#global-settings).) Switching the active project afterward
needs no reload.
:::

## Your approval is the control

Triforge is built so the consequential actions always pause for you:

- **Actions that change files or launch a run ask first.** Generating a DEM, creating a
  water source, running the solver, and importing a project each pause for an explicit
  **Allow / Cancel** (in VS Code) or an approval step (in an MCP client) before they act.
  Reading and diagnosing never change anything.
- **In an MCP client, keep per-tool approval on.** Don't enable "always allow" for the
  Triforge tools — the client's allow/deny prompt is your main control. The gated actions
  add a second, portable safeguard: the assistant makes the request, you approve, and only
  then does it run (so you may see it call a gated tool **twice** — approve deliberately).
- **Your API keys stay yours.** The OpenTopography key used to download elevation data is
  read from your environment (`TRIFORGE_OPENTOPOGRAPHY_API_KEY`) and is never passed to the
  assistant or written into any catalog file.
