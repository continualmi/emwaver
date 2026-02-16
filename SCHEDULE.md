# SCHEDULE

Weekly plan + status for EMWaver.

Principles:
- Week-by-week, not a running daily log.
- Prefer shipping vertical slices (end-to-end demos) over scattered tasks.
- Each week should have a clear “Definition of Done”.
- If the deadline slips, cut scope first.

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
- **Outcome:** (shipped / partial / slipped)
- **What shipped:**
  - Casing design completed and JLC3DP order placed.
- **What changed / decisions:**
  - 
- **Blockers / risks:**
  - 
- **Next week focus:**
  - 

### Notes / links
- Bonus: remote-control tests on blink sampler + CC1101.
- Reminder: remove MFRC522 + agent-related items from testing scope.
