"use client";

import type { EmwUiNode } from "@/lib/emwUiRuntime";
import { EmwUiRenderer } from "@/components/EmwUiRenderer";

export function EmwUiPreview({ root }: { root: EmwUiNode }) {
  return (
    <EmwUiRenderer
      root={root}
      adapter={{
        getKey: (_n, index) => String(index),
        getType: (n) => n.type,
        getProps: (n) => n.props || {},
        getChildren: (n) => (Array.isArray(n.children) ? (n.children as any) : []),
        isEnabled: () => false,
        onEvent: () => {},
      }}
    />
  );
}
