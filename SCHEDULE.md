# SCHEDULE

Weekly plan + status for EMWaver.

Principles:
- Week-by-week, not a running daily log.
- Prefer shipping vertical slices (end-to-end demos) over scattered tasks.
- Each week should have a clear “Definition of Done”.
- If the deadline slips, cut scope first.

---

## Week of 2026-02-23 (Mon) → 2026-03-01 (Sun)

### Goal (one sentence)
- Finish and demo the two core hardware scripts (`rfid.emw` + `pwm.emw`) and close testing-scope cleanup.

### Definition of Done (must be demo-able)
- [ ] `rfid.emw`: block reads/writes working; UID magic card clone works end-to-end.
- [ ] `pwm.emw`: servo control working with UI slider; full 0→180° range.
- [ ] Test plan cleanup complete: remove MFRC522 and “agent stuff” from testing.
- [ ] (Bonus) Remote-control tests completed for blink sampler + CC1101.

### Planned (top 3)
- [ ] Finish + verify `rfid.emw` (block R/W + magic UID clone).
- [ ] Finish + verify `pwm.emw` (servo UI slider, full range).
- [ ] Cleanup testing scope (remove MFRC522 + agent-related items).

### Status (fill during/at end of week)
- **Outcome:** (shipped / partial / slipped)
- **What shipped:**
  - 
- **What changed / decisions:**
  - 
- **Blockers / risks:**
  - 
- **Next week focus:**
  - 

### Notes / links
- Keep scope tight: ship the two scripts first, then optional remote tests.

---

## Week of 2026-02-16 (Mon) → 2026-02-22 (Sun)

### Goal (one sentence)
- Ship 3 core local-hardware scripts/demos (RFID + PWM/servo) and get the new EMWaver casing finalized.

### Definition of Done (must be demo-able)
- [ ] `rfid.emw`: block reads/writes working; UID magic card clone works end-to-end.
- [x] Casing for new EMWaver finalized and ordered on JLC3DP.
- [ ] `pwm.emw`: servo control working with UI slider; full 0→180° range.
- [ ] (Bonus) Remote-control tests completed for blink sampler + CC1101.
- [ ] Test plan cleanup: remove MFRC522 and “agent stuff” from testing.

### Planned (top 3)
- [ ] Finish + verify `rfid.emw` (block R/W + magic UID clone).
- [ ] Finish + verify `pwm.emw` (servo UI slider, full range).
- [ ] Finish casing design and place JLC3DP order.

### Status (fill during/at end of week)
- **Outcome:** partial
- **What shipped:**
  - Casing design completed and JLC3DP order placed.
- **What changed / decisions:**
  - Keep RFID + PWM/servo as highest-priority carry-over for next week.
  - Keep testing scope cleanup explicitly in-week (not deferred indefinitely).
- **Blockers / risks:**
  - Context switching and execution bandwidth prevented progress on scripts.
- **Next week focus:**
  - Finish `rfid.emw` and `pwm.emw`, then lock testing scope cleanup.

### Notes / links
- Bonus: remote-control tests on blink sampler + CC1101.
- Reminder: remove MFRC522 + agent-related items from testing scope.
