import { EmwUiRenderer } from "./EmwUiRenderer";
import type { EmwUiNode } from "./emwUiRuntime";

export function EmwUiPreview({ root }: { root: EmwUiNode }) {
  return (
    <EmwUiRenderer
      root={root}
      adapter={{
        getKey: (_n, index) => String(index),
        getType: (n) => n.type,
        getProps: (n) => n.props || {},
        getChildren: (n) => (Array.isArray(n.children) ? (n.children as EmwUiNode[]) : []),
        isEnabled: () => false,
        onEvent: () => {},
      }}
    />
  );
}
