process.env.TS_NODE_TRANSPILE_ONLY = 'true';
process.env.TS_NODE_PROJECT = 'tsconfig.test.json';
module.exports = {
  require: ['ts-node/register'],
  timeout: 180000,
  retries: 2,
};
