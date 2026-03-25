# EMWaver Planning

This file is the durable working tracker for ongoing EMWaver priorities.

Use it to capture:
- what we are actively working on,
- what is blocked,
- what should happen next,
- any short planning notes that should survive beyond a single week.

`SCHEDULE.md` remains the weekly execution tracker.
`TESTS.md` remains the manual hardware validation tracker.

---

## Current Focus

- Promo video launch cut centered on the script-first `cc1101` story across `Core`, `Carrier`, `macOS`, and `Android`.
- Hardware validation still needs local completion for `004_MFRC522_READ_WRITE_RFID_CARD` and `005_SERVO_PWM_POSITION_CONTROL`.

## Active Work

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| `P0` | Launch promo video | `in progress` | Recent work is concentrated in `videos/promotional_video.md`; main launch cut clips for Core/Carrier and macOS/Android parity were recorded on `2026-03-25`. |
| `P0` | RFID local validation (`004`) | `pending` | Need end-to-end MFRC522 read/write/readback pass on real hardware. |
| `P0` | Servo local validation (`005`) | `pending` | Need full `0 -> 180` movement confidence and slider-driven reliability check. |
| `P1` | Remote test expansion | `pending` | Frontend -> macOS remote cases are ahead; most other controller/host combinations are still open in `TESTS.md`. |
| `P1` | Link follow-up promo pass | `planned` | Use the second-wave plan captured in `videos/promotional_video.md` after the current launch cut. |

## Next Up

1. Finish the current launch promo selection/edit pass from the newly recorded clips.
2. Run and mark local hardware test `004`.
3. Run and mark local hardware test `005`.
4. Revisit the next weekly slice in `SCHEDULE.md` once the above is complete.

## Blockers / Risks

- Hardware-dependent validation depends on having the right boards/modules/cards/servo setup available.
- `SCHEDULE.md` is currently older than the latest video work, so this file should be used as the more reliable high-level snapshot until the weekly schedule is refreshed.

## Notes

- Keep this file concise and current.
- When priorities change, update this file in the same pass as the related work whenever possible.
