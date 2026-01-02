---
title: Build & Reproduce Guide
---

# Build & Reproduce Guide

This guide walks you through the end-to-end EMWaver manufacturing workflow: picking the right device, ordering PCBs + PCBA through JLCPCB, sourcing the parts you’ll buy separately, and (when available) printing 3D cases.

If you prefer video, the full walkthrough is here: https://youtu.be/PNf2JGsF1Mk

## 1) Choose what to build

### Platform choice: STM32 vs ESP32-S3

- **STM32 devices (USB)**: Great for **PC + Android**, typically **smaller** and **ultra low cost**, but **not compatible with iPhone/iOS**.
- **ESP32-S3 devices (BLE/Wi‑Fi)**: Works with **iOS, Android, and desktop**, can be **wireless**, and is the most general-purpose lineup.

### Cost reality (prototype volumes)

JLCPCB PCBA usually has a **minimum order of 2** assembled units, and at low volume the cost is dominated by **setup fees** and **small-quantity component pricing**.

- The **flagship EMWaver** is typically the most expensive build (often **$100+** once you include assembly and separately sourced items like antennas).
- For most people, **EMWaver Shield** and/or **EMWaver DIY** are the best ESP32-S3 starting points.

## 2) Use the hardware catalog

- Build & reproduce guide (docs): https://luispl77.github.io/emwaver/hardware/
- Hardware catalog (EasyEDA designs + casings): [hardware-catalog/hardware.html](../hardware-catalog/hardware.html)

On the hardware catalog, each device page includes:

- A brief description and rough reproduction cost estimate
- Buttons/links to open the design in EasyEDA (and casings in Onshape when available)

## 3) Order a board (EasyEDA → JLCPCB PCBA)

### Open the design

1. Open the hardware catalog and pick a device.
2. Click **Open in EasyEDA**.
3. In EasyEDA, optionally view the PCB and 3D model to confirm you’re ordering the correct revision.

### Start the one-click order flow

1. In EasyEDA, click **Fabrication**.
2. Click **One‑click Order PCB/SMT**.
3. Log into JLCPCB (create an account if you don’t have one).

### JLCPCB settings that matter

- **PCB Qty**: set to `2` (minimum for most prototype PCBA orders).
- **PCB Assembly**: enable it.
- **Assembly Side**: choose **Top** (you generally don’t want JLCPCB assembling bottom-side headers; solder those yourself).
- **Confirm parts placement**: recommended (catch flipped parts / polarity issues).
- **PCB color**: optional (purely aesthetic).

## 4) BOM / CPL review (common pitfalls)

When the BOM loads, spend time confirming the component selections. Some common issues:

- **“Do Not Place” parts**: Some parts (like certain antennas) are better sourced and soldered manually; mark them as **Do Not Place** and keep the cheaper assembly option where possible.
- **USB connector not selected**: Occasionally a connector is present but not selected by default—toggle it on.
- **IR receiver duplicate listing quirk**: If the IR receiver shows multiple options, choose the **first option with stock** (some options appear but have no available parts).
- **Yellow warnings / wrong values**: JLCPCB may auto-pick the wrong capacitor/inductor/resistor value (especially small passives). Fix each warning by selecting a part whose **value** matches the **comment**, and confirm the **package size** matches the footprint (e.g., `0402`).

## 5) Economic vs standard PCBA (and global sourcing)

### Economic PCBA (preferred when possible)

If your board supports it, **Economic** assembly is cheaper. Keep it if all required parts are compatible.

### Standard PCBA (sometimes required)

Some boards include parts that force **Standard** assembly (higher fees). If a required part isn’t compatible with economic assembly, you may have to switch.

### Out-of-stock / special parts (antennas) via “My Parts”

Some antennas won’t be in JLCPCB’s standard part stock and may show stock `0`. In that case:

1. Go to **Parts Inventory / My Parts**.
2. Use **Global Sourcing** to search the part number.
3. Buy a small quantity (often minimum `10`) from a vendor that supports low-volume.
4. Once in inventory, select it in the BOM as **My Parts**.

Useful links:

- JLCPCB: https://jlcpcb.com/
- EasyEDA editor: https://easyeda.com/editor
- JLCPCB Global Sourcing / Parts Inventory: https://jlcpcb.com/user-center/smtPrivateLibrary/orderParts/?global=1

## 6) Parts you buy + solder yourself (example: EMWaver Shield)

For boards like **EMWaver Shield**, you’ll typically hand-solder:

- The RF module (example: **RFM69HW**)
- The antenna
- GPIO headers (single-row and/or double-row)
- You’ll also need an **ESP32-S3 dev board** to plug into the shield

Assembly notes:

- Check module orientation carefully (align with the PCB silkscreen outline).
- For small RF modules, tape can help hold the module in place while you tack the first pad.
- Helical antennas usually need a **90° bend** before soldering.

AliExpress parts links (placeholders are fine to swap later):

- RFM69HW module: https://www.aliexpress.us/item/3256806162958228.html
- ESP32‑S3 dev board (2× USB‑C + RGB LED): https://www.aliexpress.us/item/3256808023363384.html
- 433 MHz helical/coil antenna: https://www.aliexpress.us/item/3256805261694510.html
- Female headers (22‑pin): https://www.aliexpress.us/item/2255801012106911.html and https://www.aliexpress.us/item/3256808780541467.html

## 7) 3D printed cases (Onshape → STL → JLC3DP)

Some devices have printable cases.

1. On a device page in the hardware catalog, open the **3D case** entry:
   - **Open in OnShape** (CAD)
   - Or **Download STL** (direct STL download)
2. If using Onshape: right‑click the part/assembly → **Export** → choose **STL**.
3. Upload the STL to JLC3DP and pick a material.
4. Assemble the PCB into the case using **M1.2 × 4 mm self‑tapping screws**.

Links:

- Onshape (via hardware catalog device page): https://luispl77.github.io/emwaver-hardware/
- 3D printing (JLC3DP): https://jlc3dp.com/
- M1.2 × 4 mm self‑tapping screws: https://www.aliexpress.us/item/2251832857570651.html

## 8) Optional add-on modules + quick prototyping

You can expand boards (or even prototype directly on the ESP32‑S3 dev board) using jumper wires:

- RC522 RFID/NFC module: https://www.aliexpress.us/item/3256807702682933.html
- CC1101 module: https://www.aliexpress.us/item/3256806852075714.html
- NRF24L01+ module (pick 2×4 / 8‑pin variant): https://www.aliexpress.us/item/3256806641760729.html
- Female‑to‑female jumper wires: https://www.aliexpress.us/item/3256809822786806.html

## Support the project

Patreon: (placeholder – link coming soon)

## Legal / ethical note

Only test/clone/transmit against devices and systems you own or have explicit permission to work with.
