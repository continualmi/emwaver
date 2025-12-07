# Environment Setup

| Component        | Tmux Script                                      | Primary Location                    | Notes |
|------------------|--------------------------------------------------|-------------------------------------|-------|
| Android          | `skills/environment/scripts/tmux_android.sh`     | `emwaver-android`                   | Launches adb logcat, Gradle install, backend pane |
| iOS              | `skills/environment/scripts/tmux_ios.sh`         | `emwaver-ios`                       | Opens Xcode workspace and running panes |
| Store (frontend) | `skills/environment/scripts/tmux_store.sh`       | `emwaver-frontend`                  | Installs deps, starts dev server |
| Docs             | `skills/environment/scripts/tmux_docs.sh`        | `emwaver-docs`                      | Runs `mkdocs serve` |
| Mattermost       | `skills/environment/scripts/tmux_mattermost.sh`  | `continuous-mattermost`             | Starts Go server and React webapp |
| CLI              | `skills/environment/scripts/tmux_cli.sh`         | `emwaver-cli`                       | Runs cargo check/test |
| DB CLI           | `skills/environment/scripts/tmux_db_cli.sh`      | `db-cli`                            | Runs cargo check/test with env sourced |
| Firmware         | `skills/environment/scripts/tmux_firmware.sh`    | `emwaver-firmware/main`             | Runs ESP-IDF build/monitor |

## Environment Orchestration (Orchestrator Playbook)

When a user requests an environment restart or startup, the orchestrator must execute the following steps:

> **Fast Path Reminder**
> For the common request "start environment i want to work on android, firmware and ide":
> - Run a quick `git worktree list` check to confirm the standard worktrees are present; if any are missing, create them and then continue.
> - After confirming worktrees, go straight to running the helper scripts from the appropriate worktree roots—no `source ~/setup/emwaver-env.sh`, no extra directory listings, and no re-reading tmux scripts unless something breaks.
> - Skip plan/TODO creation for this flow.
> - Only fall back to the detailed checklist below if any command fails or a worktree is missing.

1. From the user request, determine which components need to run (e.g., Android/IDE, firmware). For each requested component, ensure its backing worktree exists. If a worktree (such as `worktree-emwaver-android` for Android/IDE or `worktree-emwaver-firmware` for firmware) is missing from `git worktree list`, create it before continuing, adjusting the destination path as needed:
   ```bash
   git worktree add ~/worktree-emwaver-android
   git worktree add ~/worktree-emwaver-firmware
   git worktree add ~/worktree-emwaver-ios
   ```
   Only create the entries relevant to the request; skip any that already exist.
2. Enumerate active worktrees to confirm scope:
   ```bash
   git worktree list
   ```
3. For each active worktree, run the tmux helper **from within that worktree root** so `git rev-parse --show-toplevel` resolves correctly:
   - **Firmware worktree (`worktree-emwaver-firmware`)**
     ```bash
     (cd /Users/luispl/worktree-emwaver-firmware && /Users/luispl/continuous-monorepo/skills/environment/scripts/tmux_firmware.sh)
     ```
   - **Android/IDE worktree (`worktree-emwaver-android`)**
     ```bash
     (cd /Users/luispl/worktree-emwaver-android && /Users/luispl/continuous-monorepo/skills/environment/scripts/tmux_android.sh)
     ```
   - **iOS worktree (`worktree-emwaver-ios`)**
     ```bash
     (cd /Users/luispl/worktree-emwaver-ios && /Users/luispl/continuous-monorepo/skills/environment/scripts/tmux_ios.sh)
     ```

   Ensure each script is executable (`chmod +x`) before invoking it if necessary.
4. Verify sessions are up with `tmux list-sessions` and report completion.

## Environment Reset (Full Teardown)

Only execute this procedure when the user explicitly requests an environment reset and wants all sessions cleared:

1. Run `skills/environment/scripts/reset_environment.sh` from the repo root to terminate every tmux session and remove all auxiliary worktrees.
2. Confirm `git worktree list` only shows the primary repository checkout afterwards.
3. Inform the user the environment has been reset; re-run the standard setup steps if they wish to start fresh.

Individual agents working inside a worktree should maintain that worktree's `temp.txt`. Orchestrators performing restarts should not create or edit `temp.txt` files.
