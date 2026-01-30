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

pub fn parse_bs(data: &[u8]) -> Option<u16> {
    if data.len() < 4 || data[0] != b'B' || data[1] != b'S' {
        return None;
    }
    Some(u16::from_be_bytes([data[2], data[3]]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_bs_recognizes_header_and_be_u16() {
        assert_eq!(parse_bs(b"BS\x12\x34"), Some(0x1234));
        assert_eq!(parse_bs(b"BS\x00\x01"), Some(1));
    }

    #[test]
    fn parse_bs_rejects_non_bs() {
        assert_eq!(parse_bs(b""), None);
        assert_eq!(parse_bs(b"OK\x00\x01"), None);
        assert_eq!(parse_bs(b"BS\x00"), None);
    }
}
