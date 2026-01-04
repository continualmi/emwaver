#pragma once

// Set to 1 to enumerate as class-compliant USB MIDI (Audio/MIDI Streaming).
// Set to 0 to enumerate as USB CDC ACM (Virtual COM Port).
//
// This is intentionally a simple compile-time switch so we can quickly test
// iOS compatibility without reworking higher-level firmware logic.
#ifndef EMWAVER_USB_MIDI_ENABLED
#define EMWAVER_USB_MIDI_ENABLED 1
#endif

