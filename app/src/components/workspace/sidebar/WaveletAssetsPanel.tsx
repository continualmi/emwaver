import { useMemo } from "react";
import { ChevronDownIcon, ChevronRightIcon, PlayIcon } from "../WorkspaceIcons";
import { WAVELET_ASSET_SCRIPTS, WAVELET_BOOTSTRAP_FILENAME, iconLabelForPath } from "../workspaceUtils";

type WaveletAssetsPanelProps = {
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenAsset: (filename: string) => void | Promise<void>;
  onPreviewAsset: (filename: string) => void | Promise<void>;
  onRunAsset: (filename: string) => void | Promise<void>;
};

export default function WaveletAssetsPanel({
  isCollapsed,
  onToggleCollapsed,
  onOpenAsset,
  onPreviewAsset,
  onRunAsset,
}: WaveletAssetsPanelProps) {
  const entries = useMemo(() => [WAVELET_BOOTSTRAP_FILENAME, ...WAVELET_ASSET_SCRIPTS], []);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex items-center justify-between gap-2 rounded px-2 py-2 text-left text-xs font-semibold text-slate-300 hover:bg-slate-900/60 hover:text-slate-100"
        title="Toggle asset scripts"
      >
        <span className="flex items-center gap-2">
          <span className="flex h-4 w-4 items-center justify-center text-slate-500" aria-hidden="true">
            {isCollapsed ? <ChevronRightIcon className="h-3.5 w-3.5" /> : <ChevronDownIcon className="h-3.5 w-3.5" />}
          </span>
          <span>Asset scripts</span>
        </span>
        <span className="text-[11px] font-normal text-slate-500">{entries.length}</span>
      </button>

      {!isCollapsed ? (
        <div className="mt-1 max-h-52 overflow-auto pr-1">
          {entries.map((filename) => {
            const icon = iconLabelForPath(filename);
            return (
              <div
                key={filename}
                className="group flex w-full items-center gap-2 rounded px-2 py-[3px] text-left text-xs text-slate-400 hover:bg-slate-900/50 hover:text-slate-100"
                title={`Open ${filename}`}
              >
                <button type="button" onClick={() => void onOpenAsset(filename)} className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    className={`flex h-4 w-6 items-center justify-center rounded bg-slate-950/40 text-[10px] font-semibold ${icon.accentClass}`}
                    aria-hidden="true"
                  >
                    {icon.label}
                  </span>
                  <span className="min-w-0 truncate">{filename}</span>
                </button>

                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void onPreviewAsset(filename);
                    }}
                    className="rounded border border-emerald-300/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/20"
                    title="Preview"
                  >
                    <span className="flex items-center gap-1">
                      <PlayIcon className="h-3 w-3" />
                      Preview
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void onRunAsset(filename);
                    }}
                    className="rounded border border-slate-700 bg-slate-900/40 px-2 py-0.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-800"
                    title="Run"
                  >
                    <span className="flex items-center gap-1">
                      <PlayIcon className="h-3 w-3" />
                      Run
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
