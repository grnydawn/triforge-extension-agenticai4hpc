// Intercept require('vscode') in unit tests (vscode only exists inside the extension host).
const Module = require('module');
const stub = require('./vscode-stub.js');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return stub;
  return originalLoad.apply(this, arguments);
};
