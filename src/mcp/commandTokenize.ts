// src/mcp/commandTokenize.ts
// POSIX-ish argv splitter: honors single/double quotes and backslash escapes,
// and never interprets shell metacharacters (the caller spawns with shell:false).
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let has = false;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (inSingle) {
      if (c === "'") inSingle = false;
      else cur += c;
      has = true;
      continue;
    }
    if (inDouble) {
      if (c === '\\' && (command[i + 1] === '"' || command[i + 1] === '\\')) {
        cur += command[++i];
      } else if (c === '"') {
        inDouble = false;
      } else {
        cur += c;
      }
      has = true;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      has = true;
    } else if (c === '"') {
      inDouble = true;
      has = true;
    } else if (c === '\\' && i + 1 < command.length) {
      cur += command[++i];
      has = true;
    } else if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (has) {
        tokens.push(cur);
        cur = '';
        has = false;
      }
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) tokens.push(cur);
  return tokens;
}
