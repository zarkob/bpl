#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadParser(parserPath) {
  const parserCode = fs.readFileSync(parserPath, 'utf8') + '\nthis.BpmnLiteParser=BpmnLiteParser;';
  const ctx = { console: { log: () => {}, warn: () => {}, error: () => {} } };
  vm.createContext(ctx);
  vm.runInContext(parserCode, ctx);
  return ctx.BpmnLiteParser;
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function testNoStartEndSelfLoop(ParserClass) {
  const parser = new ParserClass();
  const ast = parser.parse(`:Loop Check
@A
  !Start
  task one
  !End`);

  const sequence = ast.connections.filter(c => c.type === 'sequenceFlow');
  const startOutgoing = sequence.filter(c => c.sourceRef === 'process_start');
  assert(startOutgoing.length === 1, `expected exactly 1 start outgoing edge, got ${startOutgoing.length}`);
  assert(!sequence.some(c => c.sourceRef === 'process_start' && c.targetRef === 'process_start'), 'unexpected process_start self-loop');
  assert(!sequence.some(c => c.sourceRef === 'process_end' && c.targetRef === 'process_end'), 'unexpected process_end self-loop');
}

function testNoDuplicateEdge(ParserClass) {
  const parser = new ParserClass();
  const ast = parser.parse(`@A
  Task A -> Task B
  Task B`);
  const sequence = ast.connections.filter(c => c.type === 'sequenceFlow');
  const edgeCount = sequence.filter(c => c.sourceRef === 'a_task_a' && c.targetRef === 'a_task_b').length;
  assert(edgeCount === 1, `expected 1 edge a_task_a->a_task_b, got ${edgeCount}`);
}

function testNoOrphanSubgraphStyles(ParserClass) {
  const parser = new ParserClass();
  parser.parse(`@User
  step one
@Empty
@Ops
  step two`);
  const mermaid = parser.toMermaid();

  const subgraphIds = new Set([...mermaid.matchAll(/^\s*subgraph\s+(sg\d+)\[/gm)].map(m => m[1]));
  const styleIds = [...mermaid.matchAll(/^\s*style\s+(sg\d+)\s+/gm)].map(m => m[1]);

  styleIds.forEach(id => {
    assert(subgraphIds.has(id), `style declared for non-existent subgraph ${id}`);
  });
}

function testDistAssetWiring(rootDir) {
  const srcIndex = fs.readFileSync(path.join(rootDir, 'src', 'index.html'), 'utf8');
  assert(srcIndex.includes('src="./shared/connectivity-engine.js"'), 'src/index.html missing ./shared/connectivity-engine.js');
  assert(srcIndex.includes('src="./test-connectivity.js"'), 'src/index.html missing ./test-connectivity.js');
  assert(srcIndex.includes('rel="icon" href="data:,"'), 'src/index.html missing inline favicon');

  const distIndexPath = path.join(rootDir, 'dist', 'index.html');
  assert(fs.existsSync(distIndexPath), 'dist/index.html missing (run npm run build before regression tests)');
  const distIndex = fs.readFileSync(distIndexPath, 'utf8');
  assert(distIndex.includes('src="./shared/connectivity-engine.js"'), 'dist/index.html missing ./shared/connectivity-engine.js');
  assert(distIndex.includes('src="./test-connectivity.js"'), 'dist/index.html missing ./test-connectivity.js');
  assert(fs.existsSync(path.join(rootDir, 'dist', 'shared', 'connectivity-engine.js')), 'dist/shared/connectivity-engine.js missing');
  assert(fs.existsSync(path.join(rootDir, 'dist', 'test-connectivity.js')), 'dist/test-connectivity.js missing');
}

function main() {
  const root = path.resolve(__dirname, '..');
  const parserPath = path.join(root, 'shared', 'bpmn-lite-parser.js');
  const ParserClass = loadParser(parserPath);

  testNoStartEndSelfLoop(ParserClass);
  testNoDuplicateEdge(ParserClass);
  testNoOrphanSubgraphStyles(ParserClass);
  testDistAssetWiring(root);

  console.log('Regression tests: 4/4 passed');
}

main();
