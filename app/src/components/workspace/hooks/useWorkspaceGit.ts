/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { isTauriAvailable, safeInvoke } from "../../../utils/tauri";
import type { GitDiffContents, GitRepoStatus } from "../workspaceTypes";

export type GitSelectedDiff =
  | {
      path: string;
      view: "staged" | "unstaged";
      orig_path?: string | null;
    }
  | null;

export function useWorkspaceGit(rootDir: string | null) {
  const [gitStatus, setGitStatus] = useState<GitRepoStatus | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [gitHasChecked, setGitHasChecked] = useState(false);
  const [isGitLoading, setIsGitLoading] = useState(false);
  const [isGitBusy, setIsGitBusy] = useState(false);
  const [gitCommitMessage, setGitCommitMessage] = useState("");
  const [gitSelectedDiff, setGitSelectedDiff] = useState<GitSelectedDiff>(null);
  const [gitDiffContents, setGitDiffContents] = useState<GitDiffContents | null>(null);
  const [isGitDiffLoading, setIsGitDiffLoading] = useState(false);

  const gitRepoIssue = useMemo(() => {
    const message = (gitError ?? "").toLowerCase();
    if (!message) {
      return null;
    }
    if (message.includes("not a git repository")) {
      return "not_repo" as const;
    }
    if (message.includes("git is not installed")) {
      return "git_missing" as const;
    }
    return null;
  }, [gitError]);
  const showGitNeedsInitIndicator = gitRepoIssue === "not_repo";

  const refreshGit = useCallback(async () => {
    if (!rootDir || !isTauriAvailable()) {
      setGitStatus(null);
      setGitError(null);
      setGitHasChecked(false);
      return;
    }
    setIsGitLoading(true);
    if (!gitHasChecked) {
      setGitStatus(null);
      setGitError(null);
    }
    try {
      const status = await safeInvoke<GitRepoStatus>("git_status", { payload: { path: rootDir } }, { throwOnError: true });
      setGitStatus(status ?? null);
      setGitError(null);
    } catch (error) {
      setGitStatus(null);
      setGitError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsGitLoading(false);
      setGitHasChecked(true);
    }
  }, [gitHasChecked, rootDir]);

  useEffect(() => {
    void refreshGit();
  }, [refreshGit]);

  useEffect(() => {
    if (!gitSelectedDiff || !rootDir || !isTauriAvailable()) {
      setGitDiffContents(null);
      return;
    }

    let canceled = false;
    setIsGitDiffLoading(true);
    setGitError(null);
    void safeInvoke<GitDiffContents>(
      "git_diff_contents",
      {
        payload: {
          path: rootDir,
          file_path: gitSelectedDiff.path,
          view: gitSelectedDiff.view,
          orig_path: gitSelectedDiff.orig_path ?? undefined,
        },
      },
      { throwOnError: true },
    )
      .then((contents) => {
        if (canceled) return;
        setGitDiffContents(contents ?? null);
      })
      .catch((error) => {
        if (canceled) return;
        setGitDiffContents(null);
        setGitError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (canceled) return;
        setIsGitDiffLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [gitSelectedDiff, rootDir]);

  const runGitAction = useCallback(
    async (action: () => Promise<unknown>) => {
      if (!rootDir || !isTauriAvailable()) {
        return;
      }
      setIsGitBusy(true);
      setGitError(null);
      try {
        await action();
        await refreshGit();
      } catch (error) {
        setGitError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsGitBusy(false);
      }
    },
    [refreshGit, rootDir],
  );

  const handleGitStage = useCallback(
    async (paths: string[]) => {
      await runGitAction(() => safeInvoke<void>("git_stage", { payload: { path: rootDir!, paths } }));
    },
    [rootDir, runGitAction],
  );

  const handleGitUnstage = useCallback(
    async (paths: string[]) => {
      await runGitAction(() => safeInvoke<void>("git_unstage", { payload: { path: rootDir!, paths } }));
    },
    [rootDir, runGitAction],
  );

  const handleGitDiscard = useCallback(
    async (paths: string[]) => {
      await runGitAction(() => safeInvoke<void>("git_discard", { payload: { path: rootDir!, paths } }));
    },
    [rootDir, runGitAction],
  );

  const handleGitCommit = useCallback(async () => {
    const message = gitCommitMessage.trim();
    if (!message) {
      return;
    }
    await runGitAction(() => safeInvoke<void>("git_commit", { payload: { path: rootDir!, message } }));
    setGitCommitMessage("");
  }, [gitCommitMessage, rootDir, runGitAction]);

  const handleGitPush = useCallback(async () => {
    await runGitAction(() => safeInvoke<void>("git_push", { payload: { path: rootDir! } }));
  }, [rootDir, runGitAction]);

  const handleGitStageAll = useCallback(async () => {
    await runGitAction(() => safeInvoke<void>("git_stage_all", { payload: { path: rootDir! } }));
  }, [rootDir, runGitAction]);

  const handleGitUnstageAll = useCallback(async () => {
    await runGitAction(() => safeInvoke<void>("git_unstage_all", { payload: { path: rootDir! } }));
  }, [rootDir, runGitAction]);

  return {
    gitStatus,
    gitError,
    gitHasChecked,
    isGitLoading,
    isGitBusy,
    gitCommitMessage,
    setGitCommitMessage,
    gitSelectedDiff,
    setGitSelectedDiff,
    gitDiffContents,
    isGitDiffLoading,
    showGitNeedsInitIndicator,
    refreshGit,
    handleGitStage,
    handleGitUnstage,
    handleGitDiscard,
    handleGitCommit,
    handleGitPush,
    handleGitStageAll,
    handleGitUnstageAll,
  };
}

