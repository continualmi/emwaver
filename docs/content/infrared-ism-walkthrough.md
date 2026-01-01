---
title: Infrared + Sub‑GHz (ISM) Walkthrough (Android, iOS, Desktop)
---

# Infrared + Sub‑GHz (ISM) Walkthrough (Android, iOS, Desktop)

<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:12px;">
  <iframe
    style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;"
    src="https://www.youtube.com/embed/uopJ7ONPtM4"
    title="EMWaver: Infrared + Sub‑GHz (ISM) Walkthrough"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen
  ></iframe>
</div>

This guide follows the workflow shown in the video: record, inspect, save, and retransmit real Infrared and Sub‑GHz (ISM) signals across Android, iOS, and Desktop, using multiple EMWaver devices.

## Devices used

- **Infrared Waver** (STM32, USB): IR RX + IR TX for recording and replay.
- **ISM Waver** (STM32, USB): CC1101 Sub‑GHz RX/TX for 315/433/868/915 MHz experimentation.
- **EMWaver flagship** (ESP32‑S3, BLE/USB): includes both IR and Sub‑GHz (CC1101), and supports iOS over BLE.

## What you’ll do

- **Infrared**: record a TV/AC remote, view pulses in the Sampler chart, save, then retransmit and re-capture to verify a 1:1 match.
- **Sub‑GHz (ISM)**: use the CC1101 Wavelet to initialize RX/TX at 433 MHz, record a garage remote, then retransmit and re-capture to verify a 1:1 match.

## Platform notes

- **iOS**: requires **ESP32‑S3** devices (like the flagship) over BLE.
- **Desktop**: connects over USB to both STM32 and ESP32 devices.
- **Android**: supports USB and BLE depending on the device.

## Infrared (IR) recording (Sampler)

1. Connect an IR-capable device:
   - **Infrared Waver** (USB) or **EMWaver flagship**.
2. Open the **Sampler** fragment (bottom nav, middle icon).
3. Select the **IR RX** pin (the infrared receiver input).
4. Tap **Record**, press a button on your IR remote, then tap **Stop**.
5. Zoom the chart to inspect timings/pulses.
6. Tap **Save** (top-right) to store the capture for later retransmission.

## Infrared (IR) retransmission (verify via second receiver)

To prove retransmission matches the original capture, the video uses one device as the **transmitter** and another as the **receiver**:

1. On the transmitting device, open the saved IR capture in **Sampler**.
2. Enable **PWM** so the replay is modulated correctly (typically **38 kHz** for IR).
3. Switch pin selection from **IR RX** to **IR TX**.
4. On the receiving device (phone/desktop), select **IR RX** and tap **Record**.
5. Tap **Retransmit** on the transmitter.
6. Stop recording on the receiver and compare the captured waveform to the original (they should match).

## Sub‑GHz (ISM) setup (CC1101 Wavelet)

1. Connect a Sub‑GHz capable device:
   - **ISM Waver** or **EMWaver flagship** (both use **CC1101**).
2. Open **Wavelets** (bottom nav).
3. Select the **CC1101** Wavelet.
4. Tap **Init RX** and set the target frequency (the video uses **433 MHz**).
5. (Optional) Open the **ISM view** to read/register-dump and confirm configuration (frequency + modulation like **ASK/OOK**).

## Sub‑GHz (ISM) recording (Sampler)

1. Open **Sampler**.
2. Select the CC1101 digital output pin (typically **GDO0**).
3. Tap **Record**, press the button on the garage remote, then tap **Stop**.
4. Zoom in to inspect the pulses/data.
5. Save the capture if you want to reuse it later.

## Sub‑GHz (ISM) retransmission (verify via second receiver)

1. Keep the same sampler pin selected (**GDO0**).
2. Open the **CC1101** Wavelet and tap **Init TX**.
3. On the receiving device, select **GDO0** and tap **Record**.
4. Tap **Retransmit** (the Wavelet’s TX button) on the transmitter.
5. Stop recording on the receiver and compare the waveform to the original capture (including any small noise spikes).

## Related docs

- Wavelets (UI + APIs): `wavelets.md`
- Buffer + Sampler reference: `documentation/buffer.md`

## Legal / safety note

Only record, clone, or transmit signals for devices and systems you own or have explicit permission to test.
