---
title: Build & Reproduce Devices
---

# Build & Reproduce Devices

The full hardware catalog (PCBs, BOM cost notes, CAD, EasyEDA/OSHWLab links, photos) lives here:

- https://luispl77.github.io/emwaver-hardware/

## Current Gen Devices

<div class="emw-device-grid">
  <a class="emw-device-card" href="https://luispl77.github.io/emwaver-hardware/device.html?id=emwaver" target="_blank" rel="noopener">
    <img src="../EMWAVER.jpg" alt="EMWaver" class="emw-device-image" />
    <div class="emw-device-title">EMWaver</div>
    <div class="emw-device-subtitle">ESP32-S3</div>
  </a>
  <a class="emw-device-card" href="https://luispl77.github.io/emwaver-hardware/device.html?id=ISM_WAVER" target="_blank" rel="noopener">
    <img src="../ISM_WAVER.jpg" alt="ISM Waver" class="emw-device-image" />
    <div class="emw-device-title">ISM Waver</div>
    <div class="emw-device-subtitle">STM32F042</div>
  </a>
  <a class="emw-device-card" href="https://luispl77.github.io/emwaver-hardware/device.html?id=INFRARED_WAVER" target="_blank" rel="noopener">
    <img src="../INFRARED_WAVER.jpg" alt="Infrared Waver" class="emw-device-image" />
    <div class="emw-device-title">Infrared Waver</div>
    <div class="emw-device-subtitle">STM32F042</div>
  </a>
  <a class="emw-device-card" href="https://luispl77.github.io/emwaver-hardware/device.html?id=GPIO_WAVER" target="_blank" rel="noopener">
    <img src="../GPIO_WAVER.jpg" alt="GPIO Waver" class="emw-device-image" />
    <div class="emw-device-title">GPIO Waver</div>
    <div class="emw-device-subtitle">STM32F042</div>
  </a>
  <a class="emw-device-card" href="https://luispl77.github.io/emwaver-hardware/device.html?id=EMWAVER_DIY" target="_blank" rel="noopener">
    <img src="../EMWAVER_DIY.jpg" alt="EMWaver DIY" class="emw-device-image" />
    <div class="emw-device-title">EMWaver DIY</div>
    <div class="emw-device-subtitle">Module</div>
  </a>
  <a class="emw-device-card" href="https://luispl77.github.io/emwaver-hardware/device.html?id=EMWAVER_SHIELD" target="_blank" rel="noopener">
    <img src="../EMWAVER_SHIELD.jpg" alt="EMWaver Shield" class="emw-device-image" />
    <div class="emw-device-title">EMWaver Shield</div>
    <div class="emw-device-subtitle">Module</div>
  </a>
  <a class="emw-device-card" href="https://luispl77.github.io/emwaver-hardware/device.html?id=RFID_WAVER" target="_blank" rel="noopener">
    <img src="../RFID_WAVER.jpg" alt="RFID Waver" class="emw-device-image" />
    <div class="emw-device-title">RFID Waver</div>
    <div class="emw-device-subtitle">Module</div>
  </a>
</div>

## Video Tutorial

<div class="emw-youtube">
  <iframe
    src="https://www.youtube-nocookie.com/embed/PNf2JGsF1Mk"
    title="EMWaver Hardware Lineup - Building and Ordering"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    referrerpolicy="strict-origin-when-cross-origin"
    allowfullscreen
  ></iframe>
</div>

## Written Guide

Follow the step-by-step written guide here:

- [Build & Reproduce Guide](hardware/build-reproduce.md)

## Quick Guide (EasyEDA → JLCPCB)

1. Open the hardware catalog and select the device you want to reproduce.
2. On the device page, click `Open in EasyEDA` (or the EasyEDA project link).
3. In EasyEDA, open the PCB project, then go to `Fabrication`.
4. Choose `One-click Order PCB/SMT` (PCBA).
5. On JLCPCB:
   - Set **PCB Qty** to `2` (usually the minimum / cheapest for prototypes).
   - Enable **PCB Assembly** and set **Assembly Side** to `Top` (most EMWaver boards are top-side assembly).
   - Confirm the **BOM/CPL** look correct (no missing placements, correct rotations).
   - Ensure the assembly selection includes all required parts (watch for any “Do Not Place” items or unassembled components).
   - Review the **total cost** (PCB + assembly + shipping) and adjust quantity if needed.
6. Proceed with JLCPCB’s normal checkout flow, then track the order until delivery.

If JLCPCB flags out-of-stock parts, review substitutions carefully (or switch to bare PCBs and hand-assemble).

## Quick Guide (3D Printed Casings)

1. In the hardware catalog, open the device you’re building and click the casing entry (it opens the CAD in Onshape).
2. In Onshape, right-click the casing part/assembly and choose `Export`.
3. Export as `STL` (default settings are usually fine for a first print).
4. Go to JLC3DP, upload the STL, and pick the cheapest material/finish that meets your needs.
5. Order and assemble the device using **M1.2 self-tapping screws** (get a small assortment pack so you have spares).
