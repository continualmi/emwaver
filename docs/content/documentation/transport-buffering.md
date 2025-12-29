# Transport Buffering (Draft)

This document defines the **minimal** buffering model used across EMWaver transports. It intentionally focuses on just two sides:

- the **microcontroller** (bounded memory)
- the **client** (effectively unbounded memory)

## Microcontroller side (bounded)

The microcontroller should only implement bounded buffers:

### 1) Command buffer (mailbox)

- A single, fixed-size **command buffer** holds the latest command packet received from the host.
- The firmware command handler consumes that buffer, executes the command, and emits exactly one response.
- The system is conceptually synchronous from the host perspective: **one command → one response**.
- On BLE today, responses are emitted as **fixed-size 64-byte notifications** (payload is padded with `0x00` as needed).

### 2) Stream mode buffers (bounded)

When a feature requires streaming (e.g. sampler/capture), the microcontroller may switch into a streaming mode and use one of:

- a **circular buffer**, or
- a **dual buffer** (ping/pong)

These are still bounded and exist only because the microcontroller has limited RAM.

**Current sampler implementation note (ESP32):**

- Internally, the sampler uses ping/pong buffers of `256` bytes (`SAMPLER_BUFFER_SIZE`) to decouple the ISR (producer) from the BLE sender task (consumer).
- Even if the sampler attempts to notify more than 64 bytes at a time, the BLE notify path currently **pads/truncates notifications to 64 bytes** on the wire. Clients should treat sampler stream data as arriving in 64-byte chunks.

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
