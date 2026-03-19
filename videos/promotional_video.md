# Promotional Video

Drive folder name: `EMWaver Videos`

Drive Account: emwavers@gmail.com

Drive folder link: `https://drive.google.com/drive/u/2/folders/1hPoiWPKId1ZUcjdpcH-nkf51kpWupgdW`

## Progress

Overall completion: `30%` (`10/33` clips done)

`[#######-------------]`

## Source Clips

| File name | Date recorded | Status | Notes |
| --- | --- | --- | --- |
| `clip_001_device_closeup_rotation.MOV` | `2026-03-04` | `✅` | Slow handheld close-up of the EMWaver device while rotating around the body to show connector placement, board finish, and overall physical quality. |
| `clip_002_android_plug_in_connected.MOV` | `2026-03-04` | `✅` | Start with device unplugged, connect it to an Android phone, show the EMWaver app surfacing automatically, then hold on the UI state change to confirmed connected. |
| `clip_003_ir_capture_light_remote.MOV` | `2026-03-04` | `✅` | In `sampler.emw`, capture an IR command from the light remote and zoom in on the waveform/signal area so viewers clearly see that a real signal was sampled successfully. |
| `clip_004_ir_capture_tv_remote.MOV` | `2026-03-04` | `✅` | Repeat the same capture flow in `sampler.emw` using a TV remote, including a clear zoom on the sampled signal to highlight consistency across different IR remotes. |
| `clip_005_ir_retransmit_light_sequence.MOV` | `TBD` | `pending` | Using `sampler.emw` signal picker, retransmit the lamp command sequence in one realistic flow (power on, then power off) to demonstrate practical playback behavior end to end. |
| `clip_006_ir_retransmit_tv_channel_up.MOV` | `TBD` | `pending` | Using `sampler.emw` signal picker, retransmit the TV `Channel Up` command and show the TV reacting immediately so the clip verifies successful IR replay in a familiar scenario. |
| `clip_007_cc1101_module_insert_into_emwaver.MOV` | `2026-03-05` | `✅` | Show only the physical CC1101 module insertion into the EMWaver device (no phone connection yet), with a tight close-up that clearly shows alignment and seating. |
| `clip_008_cc1101_emwaver_into_phone.MOV` | `2026-03-05` | `✅` | Start with CC1101 already inserted, then plug EMWaver into the phone and hold on connection confirmation in the app to complete the two-step setup story. |
| `clip_009_rc522_module_insert_into_emwaver.MOV` | `2026-03-05` | `✅` | Show only the physical RC522 module insertion into the EMWaver device (no phone connection yet), matching the same framing style used for CC1101. |
| `clip_010_rc522_emwaver_into_phone.MOV` | `2026-03-05` | `✅` | Start with RC522 already inserted, then plug EMWaver into the phone and show app-side connection confirmation to mirror the CC1101 flow. |
| `clip_011_dual_module_insert_into_emwaver.MOV` | `2026-03-05` | `✅` | Show EMWaver with both module slots populated (CC1101 + RC522) as a fully kitted configuration before host connection, emphasizing compact expansion readiness. |
| `clip_012_dual_module_emwaver_into_phone.MOV` | `2026-03-05` | `✅` | Start with both modules installed, then plug the fully kitted EMWaver into the phone and confirm the connected runtime state in-app. |
| `clip_013_cc1101_capture_garage_remote_signal.MOV` | `TBD` | `pending` | With the CC1101 module connected, capture a garage remote RF signal in `sampler.emw`, mirroring the earlier IR capture flow but now demonstrating sub-GHz acquisition. |
| `clip_014_cc1101_retransmit_garage_open.MOV` | `TBD` | `pending` | Outdoors near a real garage, retransmit the captured garage signal from `sampler.emw` and show the garage door beginning to open as visual proof of replay success. |
| `clip_015_cc1101_capture_tesla_charge_port_signal.MOV` | `TBD` | `pending` | Capture the Tesla charging port open signal from the charging cable remote action using CC1101, with clear framing of the source action and sampled signal state. |
| `clip_016_cc1101_retransmit_tesla_charge_port_open.MOV` | `TBD` | `pending` | Retransmit the captured Tesla charging port signal via CC1101 and show the charge port opening response to confirm end-to-end capture and replay behavior. |
| `clip_017_rc522_read_rfid_card_uid.MOV` | `TBD` | `pending` | With RC522 connected, read an RFID card and show the detected UID clearly in the app so viewers see the baseline identity before any cloning step. |
| `clip_018_rc522_clone_rfid_card.MOV` | `TBD` | `pending` | Clone the original RFID card onto a writable target card, showing the write/clone flow completion in the UI with a clean, step-by-step framing. |
| `clip_019_rc522_read_cloned_card_uid_match.MOV` | `TBD` | `pending` | Read the cloned card again and compare it against the original card result, highlighting that the UID now matches to verify the clone outcome. |
| `clip_020_ios_android_functional_ui_parity.MOV` | `TBD` | `pending` | Show EMWaver on iOS opening the same script set used on Android, then present a side-by-side comparison to emphasize functional parity with native platform-specific UI rendering. |
| `clip_021_macos_mobile_ui_parity_comparison.MOV` | `TBD` | `pending` | Compare macOS and mobile app experiences by opening the same scripts and highlighting that core behavior and controls stay aligned while each client remains natively implemented. |
| `clip_022_windows_mobile_ui_parity_comparison.MOV` | `TBD` | `pending` | Compare Windows and mobile app experiences with the same scripts to show equivalent functionality and workflow continuity across platforms, despite native UI differences. |
| `clip_023_macos_pwm_servo_control_demo.MOV` | `TBD` | `pending` | On macOS, connect a PWM-driven servo module, open `pwm.emw`, and use the on-screen controls to move the servo in real time, showing desktop module control beyond mobile-only flows. |
| `clip_024_web_remote_ui_parity_demo.MOV` | `TBD` | `pending` | Move to the EMWaver web frontend and show the same script/UI structure as native apps, reinforcing that remote control surfaces preserve the familiar control model across clients. |
| `clip_025_remote_host_servo_control_from_web.MOV` | `TBD` | `pending` | Demonstrate remote host control by keeping the servo physically attached to a MacBook host while controlling it from a phone browser or another computer via the website, proving from-anywhere actuation. |
| `clip_026_macos_agent_prompt_generates_script.MOV` | `TBD` | `pending` | Screen-record on macOS: type a prompt in the agent bar and show the AI generating a full script and UI scaffolding in one flow, highlighting EMWaver's AI-first authoring experience. |
| `clip_027_macos_agent_tests_nrf24_until_passing.MOV` | `TBD` | `pending` | Screen-record on macOS: ask the agent to test/fix an `nrf24` script until it works, including configuration reads, UI event wiring, and iterative validation to showcase autonomous test-driven iteration. |
| `clip_029_hardware_catalog_overview_scroll.MOV` | `TBD` | `pending` | Screen-record the hardware catalog overview on the website, scrolling through the supported and historical devices so viewers immediately see the breadth of boards and modules they can build. |
| `clip_030_hardware_catalog_device_detail_browse.MOV` | `TBD` | `pending` | Screen-record browsing deeper into the hardware catalog and builder flow, opening a few representative entries and details so the video communicates that EMWaver supports multiple concrete build paths. |
| `clip_031_legacy_device_clip_placeholder_01.MOV` | `TBD` | `pending` | Placeholder for reusing a previously recorded per-device clip from the earlier video edit. Keep this slot available for one of the catalog devices already filmed so the new cut can inherit prior hardware coverage without re-recording it. |
| `clip_032_legacy_device_clip_placeholder_02.MOV` | `TBD` | `pending` | Placeholder for a second reused device clip from the previous video. Pick a device that broadens the perceived catalog variety rather than duplicating the same hardware category as the first placeholder slot. |
| `clip_033_legacy_device_clip_placeholder_03.MOV` | `TBD` | `pending` | Placeholder for a third reused device clip from the previous video. Use it to round out the hardware montage and reinforce that EMWaver spans multiple device forms, not just the current board close-ups. |

## Final Render

| File name | Status |
| --- | --- |
| `final.mp4` | `pending` |
