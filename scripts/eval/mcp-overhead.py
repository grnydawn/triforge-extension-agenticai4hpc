#!/usr/bin/env python3
# Estimate the per-cell MCP tool-call overhead (in ~tokens) for an Arm A transcript: the tokens the
# agent spends *because it used the tool* -- the diagnose_project call arguments (output) plus the
# diagnosis text it reads back (input), summed over every call. This is the round-trip cost that a
# reviewer would argue eats into the tool's savings; the fixed ~251-token tool schema is reported
# separately (it is a session constant, normally cached, not in the transcript). ~tokens = chars/4.
#
# Usage: mcp-overhead.py <claude|codex> <transcript.jsonl>  ->  prints an integer token estimate.
import sys, json

client, path = sys.argv[1], sys.argv[2]
chars = 0
try:
    lines = list(open(path, encoding='utf-8', errors='ignore'))
except OSError:
    print(0); sys.exit(0)

def loads(line):
    try: return json.loads(line)
    except Exception: return None

if client == 'codex':
    # mcp_tool_call items carry .arguments and .result.content[].text
    for line in lines:
        e = loads(line)
        it = (e or {}).get('item') or {}
        if it.get('type') == 'mcp_tool_call' and it.get('tool') == 'diagnose_project':
            chars += len(json.dumps(it.get('arguments') or {}))
            for c in ((it.get('result') or {}).get('content') or []):
                if isinstance(c, dict):
                    chars += len(c.get('text') or '')
elif client == 'claude':
    # match diagnose_project tool_use ids, then the tool_result content for those ids
    diag_ids = set()
    for line in lines:
        m = (loads(line) or {}).get('message') or {}
        if isinstance(m, dict) and m.get('role') == 'assistant':
            for c in (m.get('content') or []):
                if isinstance(c, dict) and c.get('type') == 'tool_use' \
                        and c.get('name') == 'mcp__triforge__diagnose_project':
                    diag_ids.add(c.get('id'))
                    chars += len(json.dumps(c.get('input') or {}))
    for line in lines:
        m = (loads(line) or {}).get('message') or {}
        if isinstance(m, dict) and m.get('role') == 'user':
            for c in (m.get('content') or []):
                if isinstance(c, dict) and c.get('type') == 'tool_result' \
                        and c.get('tool_use_id') in diag_ids:
                    cont = c.get('content')
                    if isinstance(cont, list):
                        for b in cont:
                            if isinstance(b, dict):
                                chars += len(b.get('text') or '')
                    elif isinstance(cont, str):
                        chars += len(cont)

print(round(chars / 4))
