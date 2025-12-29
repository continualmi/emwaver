# Buffer

This page describes the **transport buffering architecture** used by EMWaver clients and devices.

## Motivation

EMWaver connects a **resource-constrained microcontroller** to a **resource-rich client**.

- On the **microcontroller** side, RAM/CPU are tight and must stay predictable.
- On the **client** side (desktop/mobile), memory and CPU are effectively “infinite” by comparison.

So the architecture is chosen around a few core ideas:

1. The client can afford to keep a single, always-available buffer for visibility and debugging.
2. The microcontroller must remain bounded, with only simple fixed-memory buffering patterns.
3. The protocol should stay simple: avoid adding “protocol layer abstractions” that hide what’s happening on the wire.

### Non-goals

What we explicitly avoid:

- **Concurrency** as a protocol feature (multiple in-flight commands, out-of-order responses).
- **Multiple endpoints/characteristics** as a design requirement (on BLE or USB) to emulate richer transports.
- **Extra protocol abstraction layers** that turn a simple byte stream into a complex messaging system.

The guiding tradeoff is: **simplicity and debuggability over convenience abstractions**.

## Mental model

The goal is a simple mental model:

- The **client** owns one in-memory buffer object with two byte-vectors: `tx` and `rx`.
- The **device** (microcontroller) stays bounded: it accepts one command at a time and returns one response at a time.
- The client prioritizes **visibility** (you can inspect exactly what was sent/received) and **simplicity** (append-only receive, deterministic parsing).

## Architecture (client + microcontroller)

```text
┌──────────────────────────────────────┬───────────────────────────────┐
│ CLIENT (effectively unbounded)       │ MICROCONTROLLER (bounded)     │
│                                      │                               │
│ buffer                               │ command buffer                │
│ ┌──────────────────────────────────┐ │ (small, fixed-size)           │
│ │ append-only bytes received        │ │ ┌───────────────┐             │
│ │ full visibility / wire dump       │ │ │ latest command │             │
│ │                                  │ │ └───────────────┘             │
│ │                                  │ │                               │
│ └──────────────────────────────────┘ │                               │
│                                      │                               │
│ buffer counter                        │ circular buffer              │
│ - how many fixed-size response      │ (retransmit)                 │
│   frames have been consumed         │ ┌───────────────┐             │
│                                     │ │ ring buffer    │             │
│                                     │ └───────────────┘             │
│                                      │                               │
│                                      │ dual buffer (ping/pong)       │
│                                      │ (record / capture)            │
│                                      │ ┌───────┐  ┌───────┐          │
│                                      │ │ buf A │  │ buf B │          │
│                                      │ └───────┘  └───────┘          │
└──────────────────────────────────────┴───────────────────────────────┘
```

## Client-side buffer model

This architecture emphasizes the client buffer as the canonical “wire capture”: raw bytes first, decoding on top.

### Buffer (what we received)

- Append every inbound payload to the buffer in arrival order.
- Treat the buffer as the canonical “wire capture” for debugging (raw bytes first; decoding happens on top).

### Buffer counter (how we consume responses)

Clients parse responses as fixed-size frames of **64 bytes**.

- The buffer counter is “how many complete 64-byte responses have been consumed”.
- The next response starts at byte offset: (buffer counter × 64).
- A new response is available when the buffer contains at least ((buffer counter + 1) × 64) bytes.
- When available: read the next 64 bytes, decode to a response, then increment the buffer counter.

This gives deterministic “get me the next response” behavior without ever mutating the underlying `rx` capture.

## Microcontroller-side constraints (bounded)

The device should remain simple and bounded:

- A single fixed-size command mailbox (new writes overwrite old ones).
- A single fixed-size response slot (exactly one response per command).
- Streaming features (sampler/capture) may use bounded buffering patterns:
  - circular buffer
  - dual buffer (ping/pong)
  - command buffer (mailbox)

Even in streaming modes, the client still treats received bytes as an append-only capture in `rx`.

This document defines the **minimal** buffering model used across EMWaver transports. It intentionally focuses on just two sides:

- the **microcontroller** (bounded memory)
- the **client** (effectively unbounded memory)

## Microcontroller side (bounded)

The microcontroller should only implement bounded buffers:

### 1) Command buffer (mailbox)

- A single, fixed-size **command buffer** holds the latest command packet received from the host.
- The firmware command handler consumes that buffer, executes the command, and emits exactly one response.
- The system is conceptually synchronous from the host perspective: **one command → one response**.

### 2) Stream mode buffers (bounded)

When a feature requires streaming (e.g. sampler/capture), the microcontroller may switch into a streaming mode and use one of:

- a **circular buffer**, or
- a **dual buffer** (ping/pong)

These are still bounded and exist only because the microcontroller has limited RAM.

## Client side (effectively unbounded)

Clients (desktop, Android, iOS) are assumed to have “infinite” memory relative to the microcontroller.

### 1) RX buffer (append-only)

- The client maintains a single append-only **RX buffer** containing all bytes received from the device.
- This RX buffer may be displayed directly in the UI for maximum visibility.

### 2) RX buffer counter

- The client maintains a single integer **RX buffer counter**.
- The counter represents how many fixed-size response packets have been parsed from the RX buffer.
- Responses are parsed as fixed-size packets of **64 bytes** (padded as needed by the device).

### Parsing rule

- A response packet is considered available when the RX buffer contains at least `(rx_buffer_counter + 1) * 64` bytes.
- The client reads the next 64-byte packet, decodes it into a response string, and increments `rx_buffer_counter`.
