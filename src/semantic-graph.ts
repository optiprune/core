import { createHash } from "node:crypto";
import type { Range } from "./types.js";

export type SemanticNodeType = 
  | 'File' 
  | 'Function' 
  | 'Class' 
  | 'Variable' 
  | 'Export' 
  | 'Import' 
  | 'Dynamic'
  | 'Unknown';

export type ReferenceKind = 
  | 'CALLS' 
  | 'IMPORTS' 
  | 'EXPORTS' 
  | 'DEFINES' 
  | 'USES' 
  | 'TYPE_DEPENDENCY';

export interface SemanticNode {
  id: string; // Stable Logical Entity Identifier (LEI)
  contentHash: string; // Content-addressed cryptographic hash for change detection
  type: SemanticNodeType;
  name?: string;
  location?: Range;
  fileId: string; // Reference to the containing FileNode
  metadata: Record<string, any>;
  incomingReferences: Reference[];
  outgoingReferences: Reference[];
  isStale?: boolean; // For Soft-Delete Strategy
}

export interface Reference {
  sourceNodeId: string;
  targetNodeId: string;
  kind: ReferenceKind;
  metadata?: Record<string, any> | undefined;
}

export class SemanticGraph {
  private nodes: Map<string, SemanticNode> = new Map();
  private fileToNodes: Map<string, Set<string>> = new Map();

  /**
   * Generates a stable Logical Entity Identifier (LEI).
   */
  static generateLei(fileId: string, type: SemanticNodeType, name?: string): string {
    return `symbol:${fileId}#${type}${name ? ':' + name : ''}`;
  }

  /**
   * Generates a content-addressed hash for change detection.
   */
  static generateContentHash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  addNode(node: SemanticNode): void {
    this.nodes.set(node.id, node);
    
    if (!this.fileToNodes.has(node.fileId)) {
      this.fileToNodes.set(node.fileId, new Set());
    }
    this.fileToNodes.get(node.fileId)!.add(node.id);
  }

  getNode(id: string): SemanticNode | undefined {
    return this.nodes.get(id);
  }

  removeNode(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;

    // Remove all references associated with this node
    for (const ref of node.incomingReferences) {
      const sourceNode = this.nodes.get(ref.sourceNodeId);
      if (sourceNode) {
        sourceNode.outgoingReferences = sourceNode.outgoingReferences.filter(
          r => r.targetNodeId !== id
        );
      }
    }
    for (const ref of node.outgoingReferences) {
      const targetNode = this.nodes.get(ref.targetNodeId);
      if (targetNode) {
        targetNode.incomingReferences = targetNode.incomingReferences.filter(
          r => r.sourceNodeId !== id
        );
      }
    }

    this.nodes.delete(id);
    this.fileToNodes.get(node.fileId)?.delete(id);
  }

  addReference(sourceId: string, targetId: string, kind: ReferenceKind, metadata?: Record<string, any>): void {
    const sourceNode = this.nodes.get(sourceId);
    const targetNode = this.nodes.get(targetId);

    if (!sourceNode || !targetNode) {
      // In a real implementation, we might want to handle pending references
      // if the target node hasn't been parsed yet.
      return;
    }

    const reference: Reference = {
      sourceNodeId: sourceId,
      targetNodeId: targetId,
      kind,
      metadata: metadata ?? undefined
    };

    sourceNode.outgoingReferences.push(reference);
    targetNode.incomingReferences.push(reference);
  }

  getNodesInFile(fileId: string): SemanticNode[] {
    const nodeIds = this.fileToNodes.get(fileId);
    if (!nodeIds) return [];
    return Array.from(nodeIds).map(id => this.nodes.get(id)!).filter(Boolean);
  }

  getAllNodes(): SemanticNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Returns nodes that have no incoming references of a certain kind.
   * Useful for initial dead code detection.
   */
  getOrphanedNodes(kind?: ReferenceKind): SemanticNode[] {
    return Array.from(this.nodes.values()).filter(node => {
      if (node.type === 'File') return false; // Files are entry points or handled differently
      
      const refs = kind 
        ? node.incomingReferences.filter(r => r.kind === kind)
        : node.incomingReferences;
        
      return refs.length === 0;
    });
  }
}
