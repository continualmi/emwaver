# EMWaver Video Plan (YouTube)

This document defines the YouTube videos the **frontend** should surface under **Documentation** and other **Tutorials / Resources** sections.

Status legend: `[x]` = done/published, `[ ]` = pending.

## Video Code Index

| Code | Status | Title (working) | Where it shows in frontend | Related test(s) | YouTube URL |
| --- | --- | --- | --- | --- | --- |
| `V001_GETTING_STARTED_OVERVIEW_AND_BLINK` | `[ ]` | Getting started: overview + USB setup + first script (`blink.emw`) | Docs → Getting Started | `001` |  |
| `V002_SCRIPTING_AND_UI_BASICS` | `[ ]` | Scripting + UI basics (buttons, sliders, plots, state) | Docs → Scripting |  |  |
| `V003_TROUBLESHOOTING_AND_FIRMWARE` | `[ ]` | Troubleshooting + firmware updates (common fixes) | Docs → Troubleshooting / Firmware |  |  |
| `V004_CC1101_WIRING_AND_REGISTER_READBACK` | `[ ]` | CC1101 wiring + init + register readback | Tutorials → Modules → CC1101 | `002` |  |
| `V005_SAMPLER_CAPTURE_RETRANSMIT_AND_SAFETY` | `[ ]` | Capture + retransmit (Sampler + CC1101) + RF safety/legal notes | Tutorials → RF | `003` |  |
| `V006_SERVO_PWM_POSITION_CONTROL` | `[ ]` | Servo control with `pwm.emw` (wiring + presets + slider) | Tutorials → PWM/Servos | `004` |  |
| `V007_AGENT_MFRC522_UID_FULL_CYCLE` | `[ ]` | Agent full cycle: MFRC522 (RC522) UID read | Tutorials → Modules → MFRC522 | `005` |  |
| `V008_AGENT_MFRC522_WRITE_VERIFY_FULL_CYCLE` | `[ ]` | Agent full cycle: MFRC522 block write + verify | Tutorials → Modules → MFRC522 | `006` |  |
| `V009_REMOTE_HOSTS_OVERVIEW_AND_DEMO` | `[ ]` | Remote hosts: controller vs host + run a script remotely (blink demo) | Docs → Remote Hosts / Tutorials → Remote Hosts | `001R` (and concept for `002R–006R`) |  |
| `V010_CLOUD_SYNC_AND_SHARING_RULES` | `[ ]` | Cloud sync basics + what *doesn’t* sync/share (bootstrap rules) | Docs → Cloud |  |  |

## Frontend Placement Matrix

Legend: `[x]` show by default, `[ ]` optional / not shown.

| Frontend section | `V001` | `V002` | `V003` | `V004` | `V005` | `V006` | `V007` | `V008` | `V009` | `V010` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Docs → Getting Started | `[x]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| Docs → Scripting | `[x]` | `[x]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| Docs → Troubleshooting | `[ ]` | `[ ]` | `[x]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| Docs → Firmware | `[ ]` | `[ ]` | `[x]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| Docs → Remote Hosts | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[x]` | `[ ]` |
| Docs → Cloud | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[x]` |
| Tutorials → RF | `[ ]` | `[ ]` | `[ ]` | `[x]` | `[x]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| Tutorials → PWM/Servos | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[x]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| Tutorials → Modules → CC1101 | `[ ]` | `[ ]` | `[ ]` | `[x]` | `[x]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` |
| Tutorials → Modules → MFRC522 | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[x]` | `[x]` | `[ ]` | `[ ]` |
| Tutorials → Remote Hosts | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `[x]` | `[ ]` |

## Notes / Requirements (for whoever implements the frontend)

- Each video entry should be renderable from:
  - `code` (stable identifier)
  - `title`
  - `youtubeUrl` (or `youtubeId`)
  - optional `duration`, `publishedAt`
  - optional `tags` (e.g. `getting-started`, `rf`, `agent`, `remote-hosts`)
- Prefer **short** videos for docs embeds (3–8 min). Longer deep-dives can be listed under “More resources”.
- Keep the “Related test(s)” column aligned with `TESTS.md` codes when relevant, but include some non-test docs (setup, troubleshooting, firmware, cloud).
