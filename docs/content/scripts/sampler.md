---
title: Sampler
---

# Sampler (desktop)

- `await Sampler.start({ pin, clearBefore?, invert? })` → `{ id, startPacket }`
- `await Sampler.stop(id?)`
- `await Sampler.status(id?)` → `{ active, pin?, packetCount, lenBytes }`
- `await Sampler.capture({ pin, durationMs, clearBefore?, invert? })` → `{ bytes, startPacket, endPacket, bufferLenBytes }`

Sampler buffer:

- `await Sampler.buffer.packetCount()`
- `await Sampler.buffer.lenBytes()`
- `await Sampler.buffer.getBytes()`
- `await Sampler.buffer.clear()`
- `await Sampler.buffer.setInvertRx(enabled)`
- `await Sampler.buffer.readPacketsSince({ packetIndex, maxPackets? })` → `{ data, nextPacketIndex, availablePackets }`
- `await Sampler.buffer.compressViewport({ startBit, endBit, bins })` → `{ bufferLenBytes, timeValues, dataValues }`
- `await Sampler.buffer.firstBytes(n)` / `await Sampler.buffer.lastBytes(n)` / `await Sampler.buffer.sliceBytes(start, end)`
