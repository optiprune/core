import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticGraph } from '../src/semantic-graph.js';
import { TopologyManager } from '../src/topology-manager.js';
import { SymbolicEngine, SymbolicExecutionContract } from '../src/symbolic-engine.js';

describe('Headless Living Graph Engine', () => {
  let graph: SemanticGraph;
  let topology: TopologyManager;
  let symbolic: SymbolicEngine;

  beforeEach(() => {
    graph = new SemanticGraph();
    topology = new TopologyManager(graph);
    symbolic = new SymbolicEngine(graph);
  });

  it('should correctly build a semantic graph with LEI and content hashes', () => {
    const fileContent = "function test() {}";
    const lei = SemanticGraph.generateLei('file.ts', 'Function', 'test');
    const contentHash = SemanticGraph.generateContentHash(fileContent);
    
    graph.addNode({
      id: lei,
      contentHash: contentHash,
      type: 'Function',
      name: 'test',
      fileId: 'file.ts',
      metadata: {},
      incomingReferences: [],
      outgoingReferences: []
    });

    const node = graph.getNode(lei);
    expect(node).toBeDefined();
    expect(node?.id).toBe(lei);
    expect(node?.contentHash).toBe(contentHash);
  });

  it('should handle incremental updates and identify affected dependents', () => {
    // Setup initial graph
    graph.addNode({
      id: 'node1',
      contentHash: 'h1',
      type: 'Function',
      name: 'caller',
      fileId: 'file1.ts',
      metadata: {},
      incomingReferences: [],
      outgoingReferences: []
    });
    graph.addNode({
      id: 'node2',
      contentHash: 'h2',
      type: 'Function',
      name: 'callee',
      fileId: 'file1.ts',
      metadata: {},
      incomingReferences: [],
      outgoingReferences: []
    });
    graph.addReference('node1', 'node2', 'CALLS');

    // Simulate update: remove node2
    const affected = topology.updateFile('file1.ts', [
      {
        id: 'node1',
        contentHash: 'h1',
        type: 'Function',
        name: 'caller',
        fileId: 'file1.ts',
        metadata: {},
        incomingReferences: [],
        outgoingReferences: []
      }
    ]);

    expect(affected.has('node1')).toBe(true);
    expect(graph.getNode('node2')).toBeUndefined();
  });

  it('should evaluate symbolic contracts for dynamic code', async () => {
    // Setup nodes
    graph.addNode({
      id: 'dynamic-node',
      contentHash: 'h3',
      type: 'Dynamic',
      name: 'handler',
      fileId: 'app.ts',
      metadata: { dynamicType: 'property-access', objectName: 'handlers', propertyVar: 'mode' },
      incomingReferences: [],
      outgoingReferences: []
    });
    graph.addNode({
      id: 'target-admin',
      contentHash: 'h4',
      type: 'Function',
      name: 'handlers.admin',
      fileId: 'handlers.ts',
      metadata: {},
      incomingReferences: [],
      outgoingReferences: []
    });

    // Register contract
    const contract: SymbolicExecutionContract = {
      nodeId: 'dynamic-node',
      inputs: { mode: 'symbolic' },
      constraints: [],
      stateSpace: new Map([['mode', ['admin']]])
    };
    symbolic.registerContract(contract);

    // Evaluate
    await symbolic.evaluateContracts({} as any);

    const dynamicNode = graph.getNode('dynamic-node');
    expect(dynamicNode?.outgoingReferences.some(r => r.targetNodeId === 'target-admin')).toBe(true);
  });
});
