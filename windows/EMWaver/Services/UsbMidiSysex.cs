using System;
using System.Collections.Generic;

namespace EMWaver.Services;

// Host-side SysEx tunnel encoding.
//
// This is a direct C# implementation of the fixed-size SysEx framing used by EMWaver:
// - Encodes a 36-byte superframe into a SysEx message that the firmware can decode.
// - Decodes a SysEx message back into a 36-byte superframe.
//
// The exact byte-level format is shared with other platforms (Android/Apple).
internal static class UsbMidiSysex
{
    // Manufacturer ID: educational / non-commercial (0x7D).
    private const byte SysExStart = 0xF0;
    private const byte SysExEnd = 0xF7;
    private const byte ManufacturerId = 0x7D;

    private static readonly byte[] Header = [(byte)'E', (byte)'M', (byte)'W'];

    // 36 bytes raw -> 42 bytes encoded (7-bit packing scheme).
    private const int RawLen = 36;
    private const int EncodedLen = 42;

    internal static byte[]? EncodeSuperframe(ReadOnlySpan<byte> superframe36)
    {
        if (superframe36.Length != RawLen)
        {
            return null;
        }

        Span<byte> encoded = stackalloc byte[EncodedLen];
        Encode7Bit(superframe36, encoded);

        // SysEx payload:
        // F0 7D 'E' 'M' 'W' <42 bytes encoded> F7
        var outBytes = new byte[1 + 1 + Header.Length + EncodedLen + 1];
        int i = 0;
        outBytes[i++] = SysExStart;
        outBytes[i++] = ManufacturerId;
        outBytes[i++] = Header[0];
        outBytes[i++] = Header[1];
        outBytes[i++] = Header[2];
        for (int k = 0; k < EncodedLen; k++)
        {
            outBytes[i++] = encoded[k];
        }
        outBytes[i++] = SysExEnd;
        return outBytes;
    }

    internal static byte[]? DecodeSysexToSuperframe(ReadOnlySpan<byte> sysex)
    {
        // Minimal validation.
        if (sysex.Length < 1 + 1 + Header.Length + EncodedLen + 1)
        {
            return null;
        }
        if (sysex[0] != SysExStart)
        {
            return null;
        }
        if (sysex[sysex.Length - 1] != SysExEnd)
        {
            return null;
        }
        if (sysex[1] != ManufacturerId)
        {
            return null;
        }
        if (sysex[2] != Header[0] || sysex[3] != Header[1] || sysex[4] != Header[2])
        {
            return null;
        }

        // Fixed-size frame: require the exact payload length.
        int expectedLen = 1 + 1 + Header.Length + EncodedLen + 1;
        if (sysex.Length != expectedLen)
        {
            return null;
        }

        ReadOnlySpan<byte> encoded = sysex.Slice(5, EncodedLen);
        var raw = new byte[RawLen];
        Decode7Bit(encoded, raw);
        return raw;
    }

    // 7-bit packing scheme (matches firmware/Android/Apple):
    // - For each group of up to 7 raw bytes, emit 1 prefix byte containing their MSBs, then the bytes with MSB cleared.
    // - 36 raw bytes => 5 full groups of 7 + 1 group of 1 => 42 encoded bytes.
    private static void Encode7Bit(ReadOnlySpan<byte> raw, Span<byte> encoded)
    {
        if (raw.Length != RawLen || encoded.Length != EncodedLen)
        {
            throw new ArgumentException("Invalid buffer sizes for 7-bit encoding");
        }

        int outIdx = 0;
        int inIdx = 0;

        while (inIdx < RawLen)
        {
            int chunkLen = Math.Min(7, RawLen - inIdx);
            byte prefix = 0;

            // Reserve prefix byte.
            int prefixIdx = outIdx;
            encoded[outIdx++] = 0;

            for (int j = 0; j < chunkLen; j++)
            {
                byte b = raw[inIdx++];
                if ((b & 0x80) != 0)
                {
                    prefix |= (byte)(1 << j);
                }
                encoded[outIdx++] = (byte)(b & 0x7F);
            }

            encoded[prefixIdx] = (byte)(prefix & 0x7F);
        }

        if (outIdx != EncodedLen)
        {
            throw new ArgumentException("Internal error: 7-bit encoder produced wrong length");
        }
    }

    private static void Decode7Bit(ReadOnlySpan<byte> encoded, Span<byte> raw)
    {
        if (raw.Length != RawLen || encoded.Length != EncodedLen)
        {
            throw new ArgumentException("Invalid buffer sizes for 7-bit decoding");
        }

        int inIdx = 0;
        int outIdx = 0;

        while (inIdx < EncodedLen && outIdx < RawLen)
        {
            byte prefix = (byte)(encoded[inIdx++] & 0x7F);
            for (int j = 0; j < 7; j++)
            {
                if (outIdx >= RawLen)
                {
                    break;
                }
                if (inIdx >= EncodedLen)
                {
                    throw new ArgumentException("Invalid encoded payload (truncated)");
                }

                byte b = (byte)(encoded[inIdx++] & 0x7F);
                if (((prefix >> j) & 0x01) != 0)
                {
                    b |= 0x80;
                }
                raw[outIdx++] = b;
            }
        }

        if (outIdx != RawLen)
        {
            throw new ArgumentException("Invalid encoded payload (wrong decoded length)");
        }
    }
}
