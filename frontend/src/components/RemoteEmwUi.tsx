"use client";

import type { RemoteUiNode } from "@/lib/remoteSessions";
import { EmwUiRenderer } from "@/components/EmwUiRenderer";

function hasHandler(n: RemoteUiNode, ev: string): boolean {
  return !!(n.handlers && typeof n.handlers[ev] === "string" && n.handlers[ev]);
}

export function RemoteEmwUi({
  root,
  onEvent,
  plotDataByNodeId,
}: {
  root: RemoteUiNode;
  onEvent: (targetId: string, name: string, payload: any) => void;
  plotDataByNodeId?: Record<string, any>;
}) {
  return (
    <EmwUiRenderer
      root={root}
      adapter={{
        getKey: (n) => n.id,
        getType: (n) => n.type,
        getProps: (n) => ({ ...(n.props || {}), __plotData: plotDataByNodeId ? plotDataByNodeId[n.id] : null }),
        getChildren: (n) => (Array.isArray(n.children) ? (n.children as any) : []),
        isEnabled: (n, eventName) => hasHandler(n, eventName),
        onEvent: (n, eventName, payload) => onEvent(n.id, eventName, payload),
      }}
    />
  );
}
