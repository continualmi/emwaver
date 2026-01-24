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

#[derive(Debug, Clone, Copy)]
pub struct BleTxProfile {
    pub max_packet_size: usize,
    pub min_packet_size: usize,
    pub initial_packet_size: usize,
    pub fixed_delay_ms: u32,
    pub target_buffer_level: i32,
    pub buffer_high_threshold: i32,
    pub buffer_low_threshold: i32,
    pub initial_fill_bytes: usize,
    pub nudge_band: i32,
    pub step_large: usize,
    pub step_small: usize,
}

impl BleTxProfile {
    pub const fn default() -> Self {
        Self {
            max_packet_size: 240,
            min_packet_size: 128,
            initial_packet_size: 188,
            fixed_delay_ms: 15,
            target_buffer_level: 2048,
            buffer_high_threshold: 3000,
            buffer_low_threshold: 1000,
            initial_fill_bytes: 2048,
            nudge_band: 100,
            step_large: 32,
            step_small: 16,
        }
    }
}

pub fn ble_next_packet_size(
    profile: BleTxProfile,
    bytes_sent: usize,
    last_status: i32,
    current_packet_size: usize,
) -> usize {
    if bytes_sent < profile.initial_fill_bytes {
        return profile.max_packet_size;
    }

    if last_status > profile.buffer_high_threshold {
        return current_packet_size
            .saturating_sub(profile.step_large)
            .max(profile.min_packet_size);
    }

    if last_status < profile.buffer_low_threshold {
        return (current_packet_size + profile.step_large).min(profile.max_packet_size);
    }

    if current_packet_size != profile.initial_packet_size
        && (last_status - profile.target_buffer_level).abs() < profile.nudge_band
    {
        if current_packet_size < profile.initial_packet_size {
            return (current_packet_size + profile.step_small).min(profile.initial_packet_size);
        }
        return current_packet_size
            .saturating_sub(profile.step_small)
            .max(profile.initial_packet_size);
    }

    current_packet_size
}

#[derive(Debug, Clone, Copy)]
pub struct UsbTxProfile {
    pub packet_size: usize,
    pub period_ns: i64,
    pub flow_time_delta_ns: i64,
    pub buffer_high_threshold: i32,
    pub buffer_low_threshold: i32,
}

impl UsbTxProfile {
    pub const fn default() -> Self {
        // Retransmit target: 100 kbit/s ~= 12.5 kB/s.
        // With an 18-byte stream lane, period ~= 18 / 12_500 = 0.00144s.
        // Use 1.44ms as the baseline and let flow-control adjust as needed.
        Self {
            packet_size: crate::packet::PACKET_SIZE,
            period_ns: 1_440_000,
            flow_time_delta_ns: 250_000,
            buffer_high_threshold: 300,
            buffer_low_threshold: 200,
        }
    }
}

pub fn usb_adjust_deadline_ns(profile: UsbTxProfile, deadline_ns: i64, last_status: i32) -> i64 {
    if last_status > profile.buffer_high_threshold {
        return deadline_ns.saturating_add(profile.flow_time_delta_ns);
    }
    if last_status < profile.buffer_low_threshold {
        return deadline_ns.saturating_sub(profile.flow_time_delta_ns);
    }
    deadline_ns
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ble_next_packet_size_uses_max_during_initial_fill() {
        let p = BleTxProfile::default();
        assert_eq!(
            ble_next_packet_size(p, 0, p.target_buffer_level, 188),
            p.max_packet_size
        );
        assert_eq!(
            ble_next_packet_size(p, p.initial_fill_bytes - 1, 0, 128),
            p.max_packet_size
        );
    }

    #[test]
    fn ble_next_packet_size_slows_down_when_buffer_too_high() {
        let p = BleTxProfile::default();
        assert_eq!(
            ble_next_packet_size(p, p.initial_fill_bytes, p.buffer_high_threshold + 1, 200),
            168
        );
        assert_eq!(
            ble_next_packet_size(
                p,
                p.initial_fill_bytes,
                p.buffer_high_threshold + 1,
                p.min_packet_size
            ),
            p.min_packet_size
        );
    }

    #[test]
    fn ble_next_packet_size_speeds_up_when_buffer_too_low() {
        let p = BleTxProfile::default();
        assert_eq!(
            ble_next_packet_size(p, p.initial_fill_bytes, p.buffer_low_threshold - 1, 160),
            192
        );
        assert_eq!(
            ble_next_packet_size(
                p,
                p.initial_fill_bytes,
                p.buffer_low_threshold - 1,
                p.max_packet_size
            ),
            p.max_packet_size
        );
    }

    #[test]
    fn ble_next_packet_size_nudges_towards_initial_packet_size() {
        let p = BleTxProfile::default();
        let ok_status = p.target_buffer_level;
        assert_eq!(
            ble_next_packet_size(p, p.initial_fill_bytes, ok_status, 100),
            116
        );
        assert_eq!(
            ble_next_packet_size(p, p.initial_fill_bytes, ok_status, 220),
            204
        );
        assert_eq!(
            ble_next_packet_size(p, p.initial_fill_bytes, ok_status, p.initial_packet_size),
            p.initial_packet_size
        );
    }

    #[test]
    fn usb_adjust_deadline_ns_applies_backpressure() {
        let p = UsbTxProfile::default();
        assert_eq!(
            usb_adjust_deadline_ns(p, 10_000, p.buffer_high_threshold + 1),
            1_010_000
        );
        assert_eq!(
            usb_adjust_deadline_ns(p, 10_000, p.buffer_low_threshold - 1),
            -990_000
        );
        assert_eq!(
            usb_adjust_deadline_ns(p, 10_000, p.buffer_low_threshold),
            10_000
        );
    }
}
