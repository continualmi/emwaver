import type { ChangeEvent, KeyboardEvent } from "react";
import {
  ArrowUpIcon,
  MinusIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
} from "../WorkspaceIcons";
import type { GitRepoStatus } from "../workspaceTypes";
import type { GitSelectedDiff } from "../hooks/useWorkspaceGit";

type GitSidebarPanelProps = {
  rootDir: string | null;
  gitStatus: GitRepoStatus | null;
  gitError: string | null;
  gitHasChecked: boolean;
  isGitLoading: boolean;
  isGitBusy: boolean;
  showGitNeedsInitIndicator: boolean;
  gitCommitMessage: string;
  onCommitMessageChange: (value: string) => void;
  gitSelectedDiff: GitSelectedDiff;
  onSelectDiff: (next: GitSelectedDiff) => void;
  onRefresh: () => void | Promise<void>;
  onStage: (paths: string[]) => void | Promise<void>;
  onUnstage: (paths: string[]) => void | Promise<void>;
  onDiscard: (paths: string[]) => void | Promise<void>;
  onCommit: () => void | Promise<void>;
  onPush: () => void | Promise<void>;
  onStageAll: () => void | Promise<void>;
  onUnstageAll: () => void | Promise<void>;
};

export default function GitSidebarPanel({
  rootDir,
  gitStatus,
  gitError,
  gitHasChecked,
  isGitLoading,
  isGitBusy,
  showGitNeedsInitIndicator,
  gitCommitMessage,
  onCommitMessageChange,
  gitSelectedDiff,
  onSelectDiff,
  onRefresh,
  onStage,
  onUnstage,
  onDiscard,
  onCommit,
  onPush,
  onStageAll,
  onUnstageAll,
}: GitSidebarPanelProps) {
  if (!rootDir) {
    return <p className="px-2 text-xs text-slate-500">Open a folder to use Source Control.</p>;
  }

  if (!gitHasChecked) {
    return (
      <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-3 px-4 py-6 text-slate-400">
        <div aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
        <div className="text-xs">Checking Git status…</div>
      </div>
    );
  }

  if (showGitNeedsInitIndicator) {
    return (
      <div className="space-y-2 px-2 py-2">
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-100">
          <div className="text-xs font-semibold">Not a Git repository</div>
          <div className="mt-1 text-[11px] text-amber-200/80">
            Run <span className="font-mono">git init</span> in this folder to enable Source Control.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={isGitLoading || isGitBusy}
          className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900 disabled:opacity-50"
          title="Refresh"
        >
          Refresh
        </button>
      </div>
    );
  }

  if (gitError) {
    return (
      <div className="space-y-2 px-2 py-2">
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-100">
          <div className="text-xs font-semibold">Source Control unavailable</div>
          <div className="mt-1 break-words text-[11px] text-rose-200/80">{gitError}</div>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={isGitLoading || isGitBusy}
          className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900 disabled:opacity-50"
          title="Refresh"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-2 py-2">
      <div className="px-1 text-[11px] text-slate-500">
        <span className="font-semibold text-slate-300">{gitStatus?.branch ? gitStatus.branch : "detached"}</span>
        {gitStatus?.upstream ? <span className="text-slate-600"> → {gitStatus.upstream}</span> : null}
        <span className="ml-2">↑ {gitStatus?.ahead ?? 0}</span>
        <span className="ml-2">↓ {gitStatus?.behind ?? 0}</span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <div className="text-[11px] font-semibold tracking-wide text-slate-400">CHANGES</div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={isGitLoading || isGitBusy}
              className="rounded p-1 text-slate-500 hover:bg-slate-900/60 hover:text-slate-200 disabled:opacity-50"
              title="Refresh"
            >
              <RefreshIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void onStageAll()}
              disabled={isGitLoading || isGitBusy || (gitStatus?.changes?.length ?? 0) === 0}
              className="rounded p-1 text-slate-500 hover:bg-slate-900/60 hover:text-slate-200 disabled:opacity-50"
              title="Stage all changes"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void onUnstageAll()}
              disabled={isGitLoading || isGitBusy || (gitStatus?.staged?.length ?? 0) === 0}
              className="rounded p-1 text-slate-500 hover:bg-slate-900/60 hover:text-slate-200 disabled:opacity-50"
              title="Unstage all changes"
            >
              <MinusIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void onPush()}
              disabled={isGitLoading || isGitBusy || (gitStatus?.ahead ?? 0) === 0}
              className="rounded p-1 text-slate-500 hover:bg-slate-900/60 hover:text-slate-200 disabled:opacity-50"
              title="Push"
            >
              <ArrowUpIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        <textarea
          rows={2}
          value={gitCommitMessage}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onCommitMessageChange(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            const isCommit = (event.ctrlKey || event.metaKey) && event.key === "Enter";
            if (!isCommit) {
              return;
            }
            if (isGitLoading || isGitBusy) {
              return;
            }
            if ((gitStatus?.staged?.length ?? 0) === 0) {
              return;
            }
            if (!gitCommitMessage.trim()) {
              return;
            }
            event.preventDefault();
            void onCommit();
          }}
          placeholder="Message"
          className="w-full resize-none rounded border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-slate-700 focus:outline-none"
        />

        <button
          type="button"
          onClick={() => void onCommit()}
          disabled={isGitLoading || isGitBusy || (gitStatus?.staged?.length ?? 0) === 0 || !gitCommitMessage.trim()}
          className="w-full rounded bg-sky-600 px-2 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          title="Commit staged changes"
        >
          Commit
        </button>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between px-1 text-[11px] font-semibold text-slate-300">
          <span>Staged Changes</span>
          <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-200">{gitStatus?.staged?.length ?? 0}</span>
        </div>
        <div className="space-y-0.5">
          {(gitStatus?.staged ?? []).map((entry) => {
            const isActive = gitSelectedDiff?.path === entry.path && gitSelectedDiff?.view === "staged";
            return (
              <div
                key={`staged:${entry.path}`}
                className={`group flex items-center gap-1 rounded px-1 py-0.5 ${isActive ? "bg-slate-900/60" : "hover:bg-slate-900/60"}`}
              >
                <button
                  type="button"
                  onClick={() => onSelectDiff({ path: entry.path, view: "staged", orig_path: entry.orig_path ?? null })}
                  className="min-w-0 flex-1 truncate px-1 py-1 text-left text-xs text-slate-200"
                  title={entry.path}
                >
                  <span className="mr-2 inline-block w-4 text-slate-500">{entry.index_status}</span>
                  {entry.path}
                </button>
                <button
                  type="button"
                  onClick={() => void onUnstage([entry.path])}
                  disabled={isGitLoading || isGitBusy}
                  className="rounded p-1 text-slate-500 opacity-0 hover:bg-slate-900/60 hover:text-slate-200 group-hover:opacity-100 disabled:opacity-50"
                  title="Unstage"
                >
                  <MinusIcon className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between px-1 text-[11px] font-semibold text-slate-300">
          <span>Changes</span>
          <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-200">{gitStatus?.changes?.length ?? 0}</span>
        </div>
        <div className="space-y-0.5">
          {(gitStatus?.changes ?? []).map((entry) => {
            const isActive = gitSelectedDiff?.path === entry.path && gitSelectedDiff?.view === "unstaged";
            const canDiscard = !entry.is_untracked && entry.worktree_status.trim() !== "";
            return (
              <div
                key={`change:${entry.path}`}
                className={`group flex items-center gap-1 rounded px-1 py-0.5 ${isActive ? "bg-slate-900/60" : "hover:bg-slate-900/60"}`}
              >
                <button
                  type="button"
                  onClick={() => onSelectDiff({ path: entry.path, view: "unstaged", orig_path: entry.orig_path ?? null })}
                  className="min-w-0 flex-1 truncate px-1 py-1 text-left text-xs text-slate-200"
                  title={entry.path}
                >
                  <span className="mr-2 inline-block w-4 text-slate-500">{entry.is_untracked ? "?" : entry.worktree_status}</span>
                  {entry.path}
                </button>
                <button
                  type="button"
                  onClick={() => void onStage([entry.path])}
                  disabled={isGitLoading || isGitBusy}
                  className="rounded p-1 text-slate-500 opacity-0 hover:bg-slate-900/60 hover:text-slate-200 group-hover:opacity-100 disabled:opacity-50"
                  title="Stage"
                >
                  <PlusIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void onDiscard([entry.path])}
                  disabled={isGitLoading || isGitBusy || !canDiscard}
                  className="rounded p-1 text-slate-500 opacity-0 hover:bg-slate-900/60 hover:text-slate-200 group-hover:opacity-100 disabled:opacity-50"
                  title={entry.is_untracked ? "Discard is not available for untracked files" : "Discard"}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

