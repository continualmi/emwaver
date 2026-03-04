# Promotional Video

Drive folder name: `EMWaver Videos`

Drive Account: emwavers@gmail.com

Drive folder link: `TBD`

## Source Clips

| File name | Date recorded | Status | Notes |
| --- | --- | --- | --- |
| `clip_001_device_closeup_rotation.MOV` | `2026-03-04` | `done` | Slow handheld close-up of the EMWaver device while rotating around the body to show connector placement, board finish, and overall physical quality. |
| `clip_002_android_plug_in_connected.MOV` | `2026-03-04` | `done` | Start with device unplugged, connect it to an Android phone, show the EMWaver app surfacing automatically, then hold on the UI state change to confirmed connected. |
| `clip_003_ir_capture_light_remote.MOV` | `2026-03-04` | `done` | In `sampler.emw`, capture an IR command from the light remote and zoom in on the waveform/signal area so viewers clearly see that a real signal was sampled successfully. |
| `clip_004_ir_capture_tv_remote.MOV` | `2026-03-04` | `done` | Repeat the same capture flow in `sampler.emw` using a TV remote, including a clear zoom on the sampled signal to highlight consistency across different IR remotes. |
| `clip_005_ir_retransmit_light_sequence.MOV` | `TBD` | `pending` | Using `sampler.emw` signal picker, retransmit the lamp command sequence in one realistic flow (power on, then power off) to demonstrate practical playback behavior end to end. |
| `clip_006_ir_retransmit_tv_channel_up.MOV` | `TBD` | `pending` | Using `sampler.emw` signal picker, retransmit the TV `Channel Up` command and show the TV reacting immediately so the clip verifies successful IR replay in a familiar scenario. |
| `clip_007_cc1101_module_plug_in.MOV` | `TBD` | `pending` | Show plugging in the CC1101 module and framing it as an easy hardware expansion path that augments EMWaver capabilities without changing the core workflow. |
| `clip_008_rc522_module_plug_in.MOV` | `TBD` | `pending` | Show plugging in the RC522 module in a similarly simple setup flow to reinforce that EMWaver can be extended quickly with different module types. |
| `clip_009_full_kitted_dual_module_setup.MOV` | `TBD` | `pending` | Show EMWaver with both module slots populated (CC1101 + RC522) as a fully kitted configuration, highlighting a compact but expanded hardware setup. |
| `clip_010_cc1101_capture_garage_remote_signal.MOV` | `TBD` | `pending` | With the CC1101 module connected, capture a garage remote RF signal in `sampler.emw`, mirroring the earlier IR capture flow but now demonstrating sub-GHz acquisition. |
| `clip_011_cc1101_retransmit_garage_open.MOV` | `TBD` | `pending` | Outdoors near a real garage, retransmit the captured garage signal from `sampler.emw` and show the garage door beginning to open as visual proof of replay success. |
| `clip_012_cc1101_capture_tesla_charge_port_signal.MOV` | `TBD` | `pending` | Capture the Tesla charging port open signal from the charging cable remote action using CC1101, with clear framing of the source action and sampled signal state. |
| `clip_013_cc1101_retransmit_tesla_charge_port_open.MOV` | `TBD` | `pending` | Retransmit the captured Tesla charging port signal via CC1101 and show the charge port opening response to confirm end-to-end capture and replay behavior. |
| `clip_014_rc522_read_rfid_card_uid.MOV` | `TBD` | `pending` | With RC522 connected, read an RFID card and show the detected UID clearly in the app so viewers see the baseline identity before any cloning step. |
| `clip_015_rc522_clone_rfid_card.MOV` | `TBD` | `pending` | Clone the original RFID card onto a writable target card, showing the write/clone flow completion in the UI with a clean, step-by-step framing. |
| `clip_016_rc522_read_cloned_card_uid_match.MOV` | `TBD` | `pending` | Read the cloned card again and compare it against the original card result, highlighting that the UID now matches to verify the clone outcome. |
| `clip_017_ios_android_functional_ui_parity.MOV` | `TBD` | `pending` | Show EMWaver on iOS opening the same script set used on Android, then present a side-by-side comparison to emphasize functional parity with native platform-specific UI rendering. |
| `clip_018_macos_mobile_ui_parity_comparison.MOV` | `TBD` | `pending` | Compare macOS and mobile app experiences by opening the same scripts and highlighting that core behavior and controls stay aligned while each client remains natively implemented. |
| `clip_019_windows_mobile_ui_parity_comparison.MOV` | `TBD` | `pending` | Compare Windows and mobile app experiences with the same scripts to show equivalent functionality and workflow continuity across platforms, despite native UI differences. |
| `clip_020_macos_pwm_servo_control_demo.MOV` | `TBD` | `pending` | On macOS, connect a PWM-driven servo module, open `pwm.emw`, and use the on-screen controls to move the servo in real time, showing desktop module control beyond mobile-only flows. |
| `clip_021_web_remote_ui_parity_demo.MOV` | `TBD` | `pending` | Move to the EMWaver web frontend and show the same script/UI structure as native apps, reinforcing that remote control surfaces preserve the familiar control model across clients. |
| `clip_022_remote_host_servo_control_from_web.MOV` | `TBD` | `pending` | Demonstrate remote host control by keeping the servo physically attached to a MacBook host while controlling it from a phone browser or another computer via the website, proving from-anywhere actuation. |
| `clip_023_macos_agent_prompt_generates_script.MOV` | `TBD` | `pending` | Screen-record on macOS: type a prompt in the agent bar and show the AI generating a full script and UI scaffolding in one flow, highlighting EMWaver's AI-first authoring experience. |
| `clip_024_macos_agent_tests_nrf24_until_passing.MOV` | `TBD` | `pending` | Screen-record on macOS: ask the agent to test/fix an `nrf24` script until it works, including configuration reads, UI event wiring, and iterative validation to showcase autonomous test-driven iteration. |

## Final Render

| File name | Status |
| --- | --- |
| `final.mp4` | `pending` |
