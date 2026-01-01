import type { WaveletTree } from "../../../utils/WaveletEngine";
import WaveletUIRenderer from "../../wavelets/WaveletUIRenderer";
import type { ThemeMode } from "../workspaceTypes";
import { basename } from "../workspaceUtils";

type WaveletPreviewEntry = {
  tree: WaveletTree | null;
  isRunning: boolean;
};

type WaveletPreviewPanelProps = {
  theme: ThemeMode;
  path: string;
  state: WaveletPreviewEntry | undefined;
  deviceStatus: string;
  onInvokeCallback: (token: string, args: unknown[]) => void;
};

export default function WaveletPreviewPanel({
  path,
  state,
  deviceStatus,
  onInvokeCallback,
}: WaveletPreviewPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col select-text">
      <div className="flex items-center justify-between border-b border-slate-900 bg-slate-950 px-3 py-2 text-xs">
        <div className="min-w-0 truncate text-slate-200" title={path}>
          Preview: {basename(path)}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-600">{deviceStatus}</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {state?.tree ? (
          <WaveletUIRenderer tree={state.tree as WaveletTree} onInvokeCallback={onInvokeCallback} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Preview this wavelet to render.</div>
        )}
      </div>
    </div>
  );
}
