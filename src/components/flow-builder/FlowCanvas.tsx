// Canvas React Flow — 100% derivado da árvore (read-only: sem drag, sem
// connect; a edição acontece via picker/painel).
import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "next-themes";
import { layoutTree } from "@/lib/flow-tree";
import { nodeTypes } from "./nodes";
import { edgeTypes } from "./edges";
import { useFlowBuilderStore } from "./store";

export function FlowCanvas() {
  const tree = useFlowBuilderStore((s) => s.tree);
  const meta = useFlowBuilderStore((s) => s.meta);
  const selectedId = useFlowBuilderStore((s) => s.selectedId);
  const select = useFlowBuilderStore((s) => s.select);
  const { resolvedTheme } = useTheme();

  const { nodes, edges } = useMemo(() => {
    const layouted = layoutTree(tree, {
      trigger_type: meta.trigger_type,
      instagram_post_id: meta.instagram_post_id,
      keyword_filter_enabled: meta.keyword_filter_enabled,
      keywords: meta.keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    });
    const nodes: Node[] = layouted.nodes.map((n) => ({
      ...n,
      draggable: false,
      selected:
        (n.type === "trigger" && selectedId === "trigger") ||
        (n.type === "step" && n.data.step?.id === selectedId),
    }));
    const edges: Edge[] = layouted.edges;
    return { nodes, edges };
  }, [tree, meta, selectedId]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={() => {}}
      onPaneClick={() => select(null)}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      zoomOnDoubleClick={false}
      deleteKeyCode={null}
      minZoom={0.2}
      maxZoom={2}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      proOptions={{ hideAttribution: true }}
      colorMode={resolvedTheme === "light" ? "light" : "dark"}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} />
      <Controls position="bottom-left" showInteractive={false} />
    </ReactFlow>
  );
}
