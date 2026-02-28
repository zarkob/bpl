#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const verbose = process.argv.includes('--verbose') || process.env.CONNECTIVITY_TEST_VERBOSE === '1';
const runtimeConsole = verbose ? console : { log: () => {}, warn: () => {}, error: () => {} };

function loadConnectivityEngine(enginePath, context) {
  const engineCode = fs.readFileSync(enginePath, 'utf8');
  vm.runInContext(engineCode, context);
}

function loadConnectivityTests(testsPath) {
  const testCode = fs.readFileSync(testsPath, 'utf8');
  const ctx = { console: runtimeConsole, module: { exports: {} }, exports: {}, window: {} };
  vm.createContext(ctx);
  vm.runInContext(testCode, ctx);
  return ctx.module.exports.runConnectivityTests;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const parserPath = path.join(root, 'shared', 'bpmn-lite-parser.js');
  const enginePath = path.join(root, 'shared', 'connectivity-engine.js');
  const testsPath = path.join(root, 'test-connectivity.js');

  const parserCode = fs.readFileSync(parserPath, 'utf8') + '\nthis.BpmnLiteParser=BpmnLiteParser;';
  const parserCtx = { console: runtimeConsole, module: { exports: {} }, exports: {}, window: {} };
  vm.createContext(parserCtx);
  loadConnectivityEngine(enginePath, parserCtx);
  vm.runInContext(parserCode, parserCtx);
  const ParserClass = parserCtx.BpmnLiteParser;
  const runConnectivityTests = loadConnectivityTests(testsPath);
  const results = runConnectivityTests(ParserClass);
  const failed = results.filter(result => !result.passed);
  const passed = results.length - failed.length;

  console.log(`Connectivity tests: ${passed}/${results.length} passed`);

  if (failed.length > 0) {
    console.log('\nFailed tests:');
    failed.forEach(result => {
      const missing = result.missing ? result.missing.length : 0;
      const extra = result.extra ? result.extra.length : 0;
      const err = result.error ? ` error=${result.error}` : '';
      console.log(`- ${result.name} (missing=${missing}, extra=${extra}${err})`);
    });
    process.exit(1);
  }
}

main();
