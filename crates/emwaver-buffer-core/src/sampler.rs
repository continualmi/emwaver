/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

pub fn compress_bits(
    buffer: &[u8],
    range_start: usize,
    range_end: usize,
    number_bins: usize,
) -> (Vec<f32>, Vec<f32>) {
    let time_per_sample: f32 = 1.0;
    let total_bits = buffer.len().saturating_mul(8);
    if buffer.is_empty()
        || range_start >= range_end
        || range_start >= total_bits
        || number_bins == 0
    {
        return (Vec::new(), Vec::new());
    }

    let end = range_end.min(total_bits);
    let start = range_start.min(end);
    let total_points_in_range = ((end - start) as f32) / time_per_sample;

    let mut time_values: Vec<f32> = Vec::new();
    let mut data_values: Vec<f32> = Vec::new();

    if total_points_in_range <= (number_bins.saturating_mul(2) as f32) {
        time_values.reserve(end - start);
        data_values.reserve(end - start);
        for i in start..end {
            let byte_index = i >> 3;
            if byte_index >= buffer.len() {
                break;
            }
            let bit_index = (i & 7) as u8;
            let bit = (buffer[byte_index] >> bit_index) & 1;
            time_values.push((i as f32) * time_per_sample);
            data_values.push(if bit == 1 { 255.0 } else { 0.0 });
        }
        return (time_values, data_values);
    }

    let bin_width = total_points_in_range / (number_bins as f32);
    for bin in 0..number_bins {
        let bin_start = (start as f32 + (bin as f32) * bin_width).floor() as usize;
        let mut bin_end = (bin_start as f32 + bin_width).floor() as usize;
        if bin_end > end {
            bin_end = end;
        }
        if bin_end <= bin_start {
            continue;
        }

        let mut has_low = false;
        let mut has_high = false;

        let mut i = bin_start;
        while i < bin_end {
            let byte_index = i >> 3;
            if byte_index >= buffer.len() {
                break;
            }

            if (i & 7) == 0 && i + 8 <= bin_end {
                let byte_val = buffer[byte_index];
                if byte_val == 0 {
                    has_low = true;
                } else if byte_val == 255 {
                    has_high = true;
                } else {
                    has_low = true;
                    has_high = true;
                }
                i += 8;
            } else {
                let bit_index = (i & 7) as u8;
                let bit = (buffer[byte_index] >> bit_index) & 1;
                if bit == 1 {
                    has_high = true;
                } else {
                    has_low = true;
                }
                i += 1;
            }

            if has_low && has_high {
                break;
            }
        }

        if has_low || has_high {
            time_values.push((bin_start as f32) * time_per_sample);
            data_values.push(if has_low { 0.0 } else { 255.0 });
            time_values.push(((bin_end - 1) as f32) * time_per_sample);
            data_values.push(if has_high { 255.0 } else { 0.0 });
        }
    }

    (time_values, data_values)
}

pub fn build_signed_raw_timings(buffer: &[u8], sample_period_us: usize) -> String {
    if buffer.is_empty() {
        return String::new();
    }

    let total_bits = buffer.len() * 8;
    let mut timings: Vec<String> = Vec::new();
    let mut current_state = (buffer[0] & 0x01) != 0;
    let mut count: usize = 0;

    for i in 0..total_bits {
        let byte_index = i >> 3;
        let bit_index = (i & 7) as u8;
        let bit = ((buffer[byte_index] >> bit_index) & 1) != 0;

        if bit == current_state {
            count += 1;
        } else {
            if count > 0 {
                let microseconds = count * sample_period_us;
                if !current_state {
                    timings.push(format!("-{microseconds}"));
                } else {
                    timings.push(format!("{microseconds}"));
                }
            }
            current_state = bit;
            count = 1;
        }
    }

    if count > 0 {
        let microseconds = count * sample_period_us;
        if !current_state {
            timings.push(format!("-{microseconds}"));
        } else {
            timings.push(format!("{microseconds}"));
        }
    }

    timings.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compress_bits_returns_raw_points_when_small_range() {
        // 16 bits: alternating 0/1 starting from LSB of first byte.
        let buf = [0b0101_0101u8, 0b0101_0101u8];
        let (t, v) = compress_bits(&buf, 0, 16, 10);
        assert_eq!(t.len(), 16);
        assert_eq!(v.len(), 16);
        assert_eq!(t[0], 0.0);
        assert_eq!(t[15], 15.0);
        assert_eq!(v[0], 255.0); // bit0 = 1
        assert_eq!(v[1], 0.0); // bit1 = 0
    }

    #[test]
    fn compress_bits_emits_min_max_pairs_for_large_range() {
        // 128 bits, all ones.
        let buf = vec![0xFFu8; 16];
        let (t, v) = compress_bits(&buf, 0, 128, 4);
        // 4 bins => 2 points per bin.
        assert_eq!(t.len(), 8);
        assert_eq!(v.len(), 8);
        assert!(v.iter().all(|x| *x == 255.0));
    }

    #[test]
    fn compress_bits_detects_mixed_bins() {
        // First half zeros, second half ones.
        let mut buf = vec![0x00u8; 8];
        buf.extend(vec![0xFFu8; 8]);
        let (t, v) = compress_bits(&buf, 0, 128, 2);
        // Each bin has a single level (all low, then all high).
        assert_eq!(t.len(), 4);
        assert_eq!(v, vec![0.0, 0.0, 255.0, 255.0]);
    }
}
