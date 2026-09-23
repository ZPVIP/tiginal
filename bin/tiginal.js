#!/usr/bin/env node

const { runCli } = require('../dist/main/cli/index.js');

runCli(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
