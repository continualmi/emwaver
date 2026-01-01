import { useCallback } from "react";
import { ChevronDownIcon, ChevronRightIcon, FolderIcon } from "../WorkspaceIcons";
import type { DirectoryChildEntry } from "../workspaceTypes";
import { iconLabelForPath } from "../workspaceUtils";

type ExplorerTreeProps = {
  root: string | null;
  dirChildren: Record<string, DirectoryChildEntry[]>;
  openDirs: Set<string>;
  selectedPath: string | null;
  onToggleDir: (path: string) => void | Promise<void>;
  onOpenFile: (path: string) => void | Promise<void>;
};

export default function ExplorerTree({ root, dirChildren, openDirs, selectedPath, onToggleDir, onOpenFile }: ExplorerTreeProps) {
  const renderDirectory = useCallback(
    (dir: string, depth: number) => {
      const children = dirChildren[dir] ?? [];
      return (
        <div>
          {children.map((entry) => {
            const paddingLeft = 6 + depth * 10;
            const isDir = entry.kind === "directory";
            const isOpen = isDir ? openDirs.has(entry.path) : false;
            const isSelected = selectedPath === entry.path;
            const iconLabel = !isDir ? iconLabelForPath(entry.path) : null;
            return (
              <div key={entry.path}>
                <button
                  type="button"
                  onClick={() => {
                    if (isDir) {
                      void onToggleDir(entry.path);
                    } else {
                      void onOpenFile(entry.path);
                    }
                  }}
                  className={`group grid w-full items-center rounded px-2 py-[3px] text-left text-xs transition-colors ${
                    isDir ? "grid-cols-[16px_22px_1fr]" : "grid-cols-[16px_1fr]"
                  } ${isSelected ? "bg-slate-900 text-sky-200" : "text-slate-300 hover:bg-slate-900/70"}`}
                  style={{ paddingLeft }}
                  title={entry.path}
                >
                  <span className="flex h-4 w-4 items-center justify-center text-slate-500" aria-hidden="true">
                    {isDir ? (
                      isOpen ? (
                        <ChevronDownIcon className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRightIcon className="h-3.5 w-3.5" />
                      )
                    ) : (
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded bg-slate-900/50 text-[9px] font-semibold leading-none ${
                          iconLabel?.accentClass ?? ""
                        }`}
                      >
                        {iconLabel?.label}
                      </span>
                    )}
                  </span>
                  {isDir ? (
                    <span className="flex h-4 w-4 items-center justify-center text-slate-500" aria-hidden="true">
                      <FolderIcon className="h-4 w-4" />
                    </span>
                  ) : null}
                  <span className={`min-w-0 truncate ${isDir ? "text-slate-200" : ""}`}>{entry.name}</span>
                </button>
                {isDir && isOpen ? <div>{renderDirectory(entry.path, depth + 1)}</div> : null}
              </div>
            );
          })}
        </div>
      );
    },
    [dirChildren, onOpenFile, onToggleDir, openDirs, selectedPath],
  );

  if (!root) {
    return <p className="px-2 text-xs text-slate-500">No folder open.</p>;
  }

  return renderDirectory(root, 0);
}

