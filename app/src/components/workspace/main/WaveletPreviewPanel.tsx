import type { WaveletTree } from "../../../utils/WaveletEngine";
import WaveletUIRenderer from "../../wavelets/WaveletUIRenderer";
import type { ThemeMode } from "../workspaceTypes";
import { basename } from "../workspaceUtils";

type WaveletPreviewEntry = {
  tree: WaveletTree | null;
  console: string[];
  isRunning: boolean;
};

type WaveletPreviewPanelProps = {
  theme: ThemeMode;
  path: string;
  state: WaveletPreviewEntry | undefined;
  onClear: () => void;
  onRun: () => void;
  onBackToEditor: () => void;
  deviceStatus: string;
  onInvokeCallback: (token: string, args: unknown[]) => void;
};

export default function WaveletPreviewPanel({
  path,
  state,
  onClear,
  onRun,
  onBackToEditor,
  deviceStatus,
  onInvokeCallback,
}: WaveletPreviewPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col select-text">
      <div className="flex items-center justify-between border-b border-slate-900 bg-slate-950 px-3 py-2 text-xs">
        <div className="min-w-0 truncate text-slate-200" title={path}>
          Preview: {basename(path)}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-900"
            title="Clear preview output"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onRun}
            className="rounded border border-emerald-300/70 bg-emerald-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-400"
            title="Run wavelet"
          >
            Run
          </button>
          <button
            type="button"
            onClick={onBackToEditor}
            className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-900"
            title="Back to editor"
          >
            Editor
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {state?.tree ? (
          <WaveletUIRenderer tree={state.tree as WaveletTree} consoleOutput={state.console ?? []} onInvokeCallback={onInvokeCallback} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Run this wavelet to render a preview.</div>
        )}
      </div>

      <div className="border-t border-slate-900 bg-slate-950 px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold tracking-wide text-slate-400">
          <span>CONSOLE</span>
          <span className="text-slate-600">{deviceStatus}</span>
        </div>
        <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded border border-slate-800 bg-slate-950/40 p-2 font-mono text-[11px] text-slate-200">
          {(state?.console ?? []).length === 0 ? (
            <div className="text-slate-500">No output yet.</div>
          ) : (
            (state?.console ?? []).map((line, idx) => <div key={idx}>{line}</div>)
          )}
        </div>
      </div>
    </div>
  );
}

