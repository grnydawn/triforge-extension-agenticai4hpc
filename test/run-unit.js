// Programmatic Mocha runner for the unit suite.
//
// Why this exists: running the `mocha` CLI pulls in its `yargs` dependency, whose
// extensionless `node_modules/yargs/yargs` shim uses `require()` but sits under a
// package.json with `"type": "module"`. Older Node treated extensionless files as
// CommonJS; Node 25/26 ("Current") classify them as ESM and crash with
// "ReferenceError: require is not defined in ES module scope" before any test runs.
//
// `require('mocha')` (the programmatic API) never loads yargs, so this runner works
// on every supported Node line. Config mirrors .mocharc.json — keep them in sync.
//
// ts-node reads TS_NODE_TRANSPILE_ONLY / TS_NODE_PROJECT from the environment; the
// `test:unit` npm script sets them via cross-env before invoking this file.
'use strict';

require('ts-node/register');
require('./helpers/register-vscode-stub.js');

const fs = require('fs');
const path = require('path');
const Mocha = require('mocha');

const UNIT_ROOT = path.resolve(__dirname, 'unit');

/** Recursively collect *.test.ts under test/unit (zero-dep; no glob needed). */
function collectSpecs(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSpecs(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const mocha = new Mocha({ timeout: 10000 });

// Honor `--grep <pattern>` / `--grep=<pattern>` (and `-g`) so the documented
// `npm run test:unit -- --grep "..."` filter keeps working without the mocha CLI.
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--grep' || a === '-g') {
    if (argv[i + 1]) mocha.grep(argv[++i]);
  } else if (a.startsWith('--grep=')) {
    mocha.grep(a.slice('--grep='.length));
  }
}

collectSpecs(UNIT_ROOT, [])
  .sort()
  .forEach((file) => mocha.addFile(file));

mocha.run((failures) => {
  process.exitCode = failures ? 1 : 0;
});
