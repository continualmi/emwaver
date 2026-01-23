---
title: Sampler
---

# Sampler (desktop)

- `await Sampler.start({ pin, clearBefore?, invert? })` → `{ id, startPacket }`
- `await Sampler.stop(id?)`
- `await Sampler.status(id?)` → `{ active, pin?, packetCount, lenBytes }`
- `await Sampler.capture({ pin, durationMs, clearBefore?, invert? })` → `{ bytes, startPacket, endPacket, bufferLenBytes }`

Buffer helpers:

- `await Sampler.packetCount()`
- `await Sampler.lenBytes()`
- `await Sampler.getBytes()`
- `await Sampler.clear()`
- `await Sampler.setInvertRx(enabled)`
- `await Sampler.readPacketsSince({ packetIndex, maxPackets? })` → `{ data, nextPacketIndex, availablePackets }`
- `await Sampler.compressViewport({ startBit, endBit, bins })` → `{ bufferLenBytes, timeValues, dataValues }`
- `await Sampler.firstBytes(n)` / `await Sampler.lastBytes(n)` / `await Sampler.sliceBytes(start, end)`
