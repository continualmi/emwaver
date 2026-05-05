import { EmwUiRenderer } from "./EmwUiRenderer";
import type { RemoteUiNode } from "./remoteSessions";

function hasHandler(n: RemoteUiNode, eventName: string): boolean {
  return !!(n.handlers && typeof n.handlers[eventName] === "string" && n.handlers[eventName]);
}

export function RemoteEmwUi({
  root,
  onEvent,
  plotDataByNodeId,
}: {
  root: RemoteUiNode;
  onEvent: (targetId: string, name: string, payload: unknown) => void;
  plotDataByNodeId?: Record<string, unknown>;
}) {
  return (
    <EmwUiRenderer
      root={root}
      adapter={{
        getKey: (n) => n.id,
        getType: (n) => n.type,
        getProps: (n) => ({ ...(n.props || {}), __plotData: plotDataByNodeId ? plotDataByNodeId[n.id] : null }),
        getChildren: (n) => (Array.isArray(n.children) ? (n.children as RemoteUiNode[]) : []),
        isEnabled: (n, eventName) => hasHandler(n, eventName),
        onEvent: (n, eventName, payload) => onEvent(n.id, eventName, payload),
      }}
    />
  );
}
