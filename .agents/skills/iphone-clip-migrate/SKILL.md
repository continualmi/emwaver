---
name: iphone-clip-migrate
description: Use when Codex needs to manage the Samsung T7 post-export ingest flow: find video clips in `/Volumes/T7/iPhone`, list likely recent candidates, and move or copy a selected clip into a project folder such as `/Volumes/T7/EMWaver_Final_Video/clips`.
---

# iPhone Clip Migrate

Handle the Samsung T7 post-export ingest step: locate recently exported iPhone videos in the T7 staging folder, show the best candidates, and move or copy the chosen clip into the mounted project clips folder.

This skill assumes Image Capture has already exported the file into `/Volumes/T7/iPhone`. It does not try to control the Image Capture UI or list live files directly from the phone.

The current default destination is EMWaver, but the helper also supports sending a clip to another project folder with `--destination`.

## Quick Checks

Before listing or moving anything, verify the expected tools and destination are available:

```bash
test -d /Volumes/T7/iPhone
test -d /Volumes/T7/EMWaver_Final_Video/clips
python3 /Users/luisml/continualmi/.agents/skills/iphone-clip-migrate/scripts/iphone_clip_migrate.py list
```

If either T7 folder is missing, stop and tell the user the drive or staging folder is not mounted at the expected path.

## Default Workflow

1. Export from Image Capture into `/Volumes/T7/iPhone`.

2. List recent likely iPhone exports from the T7 staging folder:

```bash
python3 /Users/luisml/continualmi/.agents/skills/iphone-clip-migrate/scripts/iphone_clip_migrate.py list
```

3. If the newest result is clearly the just-recorded clip, migrate by index:

```bash
python3 /Users/luisml/continualmi/.agents/skills/iphone-clip-migrate/scripts/iphone_clip_migrate.py migrate --index 1
```

4. If the correct file is not obvious, either:

- rerun with a wider search window:

```bash
python3 /Users/luisml/continualmi/.agents/skills/iphone-clip-migrate/scripts/iphone_clip_migrate.py list --days 30
```

- or migrate an explicit path:

```bash
python3 /Users/luisml/continualmi/.agents/skills/iphone-clip-migrate/scripts/iphone_clip_migrate.py migrate --path /Volumes/T7/iPhone/IMG_1234.MOV
```

## Search Rules

The helper script searches this staging folder by default:

- `/Volumes/T7/iPhone`

It prioritizes files that look like iPhone camera imports, especially names like:

- `IMG_*.MOV`
- `IMG_*.MP4`
- `IMG_*.M4V`

It sorts by the newest available filesystem timestamp so recent imports rise to the top.

## Migration Rules

- Default destination: `/Volumes/T7/EMWaver_Final_Video/clips`
- Destination override: use `--destination /Volumes/T7/<Project>/clips` when the clip belongs in another T7 project folder
- Default behavior: move the file
- Preserve the original filename when possible
- If a filename collision exists, create a suffixed destination filename instead of overwriting

Use copy mode only when the user wants to keep the original imported file in place:

```bash
python3 /Users/luisml/continualmi/.agents/skills/iphone-clip-migrate/scripts/iphone_clip_migrate.py migrate --index 1 --mode copy
```

## Recommended Interaction Style

- If the user says "move the clip I just exported", run `list` first and use the top result when it is unambiguous.
- If multiple fresh `IMG_*.MOV` files exist, summarize the top few with timestamps and sizes before moving one.
- After migration, report both the source file and the final destination path.
- If the drive is unavailable, do not guess another destination.

## Script

Use the bundled helper:

- `scripts/iphone_clip_migrate.py`

Run `--help` on either subcommand when needed:

```bash
python3 /Users/luisml/continualmi/.agents/skills/iphone-clip-migrate/scripts/iphone_clip_migrate.py --help
python3 /Users/luisml/continualmi/.agents/skills/iphone-clip-migrate/scripts/iphone_clip_migrate.py list --help
python3 /Users/luisml/continualmi/.agents/skills/iphone-clip-migrate/scripts/iphone_clip_migrate.py migrate --help
```
