import { SemanticGraph, SemanticNode } from "./semantic-graph.js";

export class TopologyManager {
  constructor(private graph: SemanticGraph) {}

  /**
   * Processes a set of new/updated nodes for a file and updates the graph.
   * Implements a Soft-Delete (Tombstone) strategy for resilient parsing.
   */
  updateFile(fileId: string, newNodes: SemanticNode[], parseSuccess: boolean = true): Set<string> {
    const affectedNodeIds = new Set<string>();
    const existingNodes = this.graph.getNodesInFile(fileId);
    const existingNodeMap = new Map(existingNodes.map((n) => [n.id, n]));
    const newNodeMap = new Map(newNodes.map((n) => [n.id, n]));

    if (!parseSuccess) {
      // If parse failed, mark all existing nodes as stale but don't purge them
      for (const oldNode of existingNodes) {
        oldNode.isStale = true;
      }
      return affectedNodeIds;
    }

    // 1. Identify removed nodes or nodes that changed content
    for (const oldNode of existingNodes) {
      const newNode = newNodeMap.get(oldNode.id);
      if (!newNode) {
        // Node was completely removed
        this.markAffectedDependents(oldNode.id, affectedNodeIds);
        this.graph.removeNode(oldNode.id);
      } else if (oldNode.contentHash !== newNode.contentHash) {
        // Content changed, mark as affected but keep LEI
        affectedNodeIds.add(oldNode.id);
        oldNode.contentHash = newNode.contentHash;
        oldNode.isStale = false;
        // In a real implementation, we would re-extract references for the updated node
      } else {
        // Node is still there and unchanged
        oldNode.isStale = false;
      }
    }

    // 2. Add new nodes
    for (const newNode of newNodes) {
      if (!existingNodeMap.has(newNode.id)) {
        this.graph.addNode(newNode);
        affectedNodeIds.add(newNode.id);
      }
    }

    return affectedNodeIds;
  }

  /**
   * Transitively marks all nodes that depend on the given nodeId.
   */
  private markAffectedDependents(nodeId: string, affected: Set<string>): void {
    const node = this.graph.getNode(nodeId);
    if (!node || affected.has(nodeId)) return;

    affected.add(nodeId);

    for (const ref of node.incomingReferences) {
      this.markAffectedDependents(ref.sourceNodeId, affected);
    }
  }

  /**
   * Detects orphaned nodes (dead code) using Tarjan's algorithm for SCC-aware detection.
   * This treats circular dependency cycles as a single unit.
   */
  detectDeadCode(): SemanticNode[] {
    const allNodes = this.graph.getAllNodes();
    const deadNodes: SemanticNode[] = [];

    // 1. Find all SCCs in the graph
    const sccs = this.findSCCs(allNodes);

    // 2. For each SCC, check if it has any incoming references from outside the SCC
    for (const scc of sccs) {
      const sccNodeIds = new Set(scc.map((n) => n.id));
      let hasExternalInflow = false;

      for (const node of scc) {
        // Files are considered entry points for now
        if (node.type === "File") {
          hasExternalInflow = true;
          break;
        }

        for (const ref of node.incomingReferences) {
          if (!sccNodeIds.has(ref.sourceNodeId)) {
            hasExternalInflow = true;
            break;
          }
        }
        if (hasExternalInflow) break;
      }

      if (!hasExternalInflow) {
        deadNodes.push(...scc);
      }
    }

    return deadNodes;
  }

  /**
   * Tarjan's algorithm for finding Strongly Connected Components.
   */
  private findSCCs(nodes: SemanticNode[]): SemanticNode[][] {
    let index = 0;
    const stack: SemanticNode[] = [];
    const indices = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const sccs: SemanticNode[][] = [];

    const strongconnect = (v: SemanticNode) => {
      indices.set(v.id, index);
      lowlink.set(v.id, index);
      index++;
      stack.push(v);
      onStack.add(v.id);

      for (const ref of v.outgoingReferences) {
        const w = this.graph.getNode(ref.targetNodeId);
        if (!w) continue;

        if (!indices.has(w.id)) {
          strongconnect(w);
          lowlink.set(v.id, Math.min(lowlink.get(v.id)!, lowlink.get(w.id)!));
        } else if (onStack.has(w.id)) {
          lowlink.set(v.id, Math.min(lowlink.get(v.id)!, indices.get(w.id)!));
        }
      }

      if (lowlink.get(v.id) === indices.get(v.id)) {
        const scc: SemanticNode[] = [];
        let w: SemanticNode;
        do {
          w = stack.pop()!;
          onStack.delete(w.id);
          scc.push(w);
        } while (w.id !== v.id);
        sccs.push(scc);
      }
    };

    for (const node of nodes) {
      if (!indices.has(node.id)) {
        strongconnect(node);
      }
    }

    return sccs;
  }
}
