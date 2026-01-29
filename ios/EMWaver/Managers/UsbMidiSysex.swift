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

import Foundation

/// SysEx codec matching STM32 firmware (`usbd_midi_if.c`) and Android (`UsbMidiSysex.java`).
///
/// Mini-frame format (fixed-size):
///   F0 7D 'E' 'M' 'W' <42 encoded bytes> F7
/// where the payload decodes to exactly 36 bytes:
///   18B cmd lane + 18B stream lane.
enum UsbMidiSysex {
    fileprivate static let sysexStart: UInt8 = 0xF0
    fileprivate static let sysexEnd: UInt8 = 0xF7

    fileprivate static let manufacturerId: UInt8 = 0x7D // non-commercial
    fileprivate static let magic: [UInt8] = Array("EMW".utf8)
    fileprivate static let superframeSize: Int = 36
    fileprivate static let encodedPayloadSize: Int = 42

    static func encodeSuperframe(_ superframe: Data) -> Data? {
        guard superframe.count == superframeSize else { return nil }
        guard let encoded = encodePayload7Bit(superframe) else { return nil }
        guard encoded.count == encodedPayloadSize else { return nil }

        var out = Data()
        out.reserveCapacity(1 + 1 + 3 + encoded.count + 1)
        out.append(sysexStart)
        out.append(manufacturerId)
        out.append(contentsOf: magic)
        out.append(encoded)
        out.append(sysexEnd)
        return out
    }

    /// Returns decoded 36B superframe or nil when not a valid EMWaver SysEx payload.
    static func decodeSysexToSuperframe(_ sysex: Data) -> Data? {
        guard sysex.count >= 7 else { return nil }
        guard sysex.first == sysexStart, sysex.last == sysexEnd else { return nil }

        let bytes = [UInt8](sysex)
        guard bytes[1] == manufacturerId else { return nil }
        guard Array(bytes[2..<5]) == magic else { return nil }

        let encoded = Data(bytes[5..<(bytes.count - 1)])
        return decodePayload7Bit(encoded)
    }

    // MARK: - 7-bit payload codec

    private static func encodePayload7Bit(_ in128: Data) -> Data? {
        guard in128.count == superframeSize else { return nil }

        // Fixed-size: 36 raw bytes -> 42 encoded bytes.
        var out = Data()
        out.reserveCapacity(encodedPayloadSize)

        let bytes = [UInt8](in128)
        var inPos = 0
        while inPos < superframeSize {
            var prefix: UInt8 = 0
            var chunk = [UInt8](repeating: 0, count: 7)
            var chunkLen = 0

            for j in 0..<7 {
                guard inPos < superframeSize else { break }
                let b = bytes[inPos]
                inPos += 1

                if (b & 0x80) != 0 {
                    prefix |= 1 << j
                }
                chunk[j] = b & 0x7F
                chunkLen += 1
            }

            out.append(prefix & 0x7F)
            out.append(contentsOf: chunk.prefix(chunkLen))
        }

        return out
    }

    private static func decodePayload7Bit(_ input: Data) -> Data? {
        guard !input.isEmpty else { return nil }

        let inBytes = [UInt8](input)
        var out = [UInt8](repeating: 0, count: superframeSize)

        var inPos = 0
        var outPos = 0

        while inPos < inBytes.count && outPos < superframeSize {
            let prefix = inBytes[inPos] & 0x7F
            inPos += 1

            for j in 0..<7 {
                if outPos >= superframeSize { break }
                guard inPos < inBytes.count else { return nil }

                var v = inBytes[inPos] & 0x7F
                inPos += 1

                if (prefix & (1 << j)) != 0 {
                    v |= 0x80
                }

                out[outPos] = v
                outPos += 1
            }
        }

        guard outPos == superframeSize else { return nil }
        return Data(out)
    }
}

/// Accumulates chunked CoreMIDI byte streams into complete SysEx frames.
struct UsbMidiSysexAccumulator {
    private var buf = Data(capacity: 512)
    private var inSysex = false

    init() {}

    mutating func feed(_ data: Data) -> [Data] {
        var out: [Data] = []
        out.reserveCapacity(1)

        for b in data {
            if b == UsbMidiSysex.sysexStart {
                buf.removeAll(keepingCapacity: true)
                inSysex = true
            }

            guard inSysex else { continue }
            buf.append(b)

            if b == UsbMidiSysex.sysexEnd {
                out.append(buf)
                buf.removeAll(keepingCapacity: true)
                inSysex = false
            }
        }

        return out
    }
}
