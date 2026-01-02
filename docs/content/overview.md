#

![EMWaver](banner.jpeg)

EMWaver is a fully open-source, offline-first hardware hacking and development platform — designed to be a more powerful and cost-effective alternative to platforms like [Flipper Zero](https://en.wikipedia.org/wiki/Flipper_Zero) and [Arduino](https://en.wikipedia.org/wiki/Arduino) by treating your phone and PC as part of the “device”.

Instead of cramming everything into firmware, EMWaver devices connect directly over BLE or USB and lean on the resources you already have (CPU, memory, storage, UI). That lets you build workflows that are hard or impossible with firmware alone: richer interfaces, bigger captures, faster iteration loops, and scripted procedures that can evolve without reflashing.

Because boards can plug straight into your phone over USB‑C for power + communication, the form factor stays compact and cable-free—targeting Flipper Zero-style portability without shipping batteries, storage, buttons, or a display on-device, which is what makes EMWaver hardware an order of magnitude cheaper, while the combined EMWaver + phone package often far exceeds dedicated handheld capabilities (which are usually constrained by CPU, memory, and especially UI—small screens + few buttons—whereas EMWaver can leverage iOS/Android for rich interfaces plus the phone’s compute + storage for processing signals and captured data).

EMWaver ships first-class apps on iOS, Android, and desktop. All three can connect to EMWaver devices and include plug-and-play tooling for the built-in hardware so you can get hacking immediately, with many built-in features such as Sub-GHz (ISM) and Infrared signal reading, analysis, cloning and transmission, RFID card reading and cloning, and BadUSB.

EMWaver also targets the “Arduino workflow” directly: the desktop app includes an IDE with a firmware editor and a single-button build/flash flow for EMWaver boards, so you can iterate quickly without wiring together separate toolchains.

Hardware comes in two platform families: STM32 devices are ultra low-cost, USB-only, and optimized for the smallest form factors (Android/PC focused), while ESP32-S3 devices support all platforms including iOS, enable wireless workflows (BLE/Wi‑Fi), and serve as the more general-purpose, multi-function boards.

Wavelets are small JavaScript scripts that render real, native-feeling UI (via the Wavelet UI DSL) and call into device APIs to run hardware workflows. They’re designed for rapid iteration: edit a Wavelet, reload, and immediately get new controls and logic—without recompiling the apps or reflashing firmware.

The goal behind EMWaver IDE is simple: how fast can you fully exploit a new sensor/module/chip—not just “read a register” on a 1D serial monitor, but ship a complete UI for the chip’s functionality? With EMWaver, Wavelets let you build that UI in minutes with zero reflashing, while the EMWaver IDE and ecosystem let you iterate on firmware when needed alongside the Wavelet UI. Instead of parsing logs, you get real controls (buttons, lists, pickers) that make it practical to explore and operate hardware features across common embedded protocols like SPI and I2C.

The current-gen hardware lineup includes 7 devices/modules (EMWaver, EMWaver Shield, EMWaver DIY, ISM Waver, Infrared Waver, RFID Waver, GPIO Waver) with capabilities like Sub‑GHz ISM radio (RFM69HW / CC1101), infrared RX + TX, GPIO expansion, USB scripting/BadUSB, RFID (RC522), and 2.4 GHz modules (NRF24L01+). Browse the [hardware catalog](hardware-catalog/) and [build guides](hardware/build-reproduce.md).

## Next steps

<div class="grid cards" markdown>

-   :material-download:{ .lg .middle } **Installing & Using**

    ---

    Install the apps and watch the walkthrough.

    [:octicons-arrow-right-24: Open Installing & Using](installing-using.md)

-   :material-hammer-wrench:{ .lg .middle } **Build & Reproduce**

    ---

    Build the boards and 3D-printed casings from the open hardware catalog.

    [:octicons-arrow-right-24: Open Build & Reproduce](hardware-catalog/)

-   :material-flash:{ .lg .middle } **Flashing Firmware**

    ---

    Step-by-step flashing guides for STM32 and ESP32-S3 devices.

    [:octicons-arrow-right-24: Open Flashing Guides](flashing-firmware/index.md)

-   :material-book-open-variant:{ .lg .middle } **Documentation**

    ---

    Wavelets (UI + APIs) and the buffer/protocol reference.

    [:octicons-arrow-right-24: Wavelets](wavelets.md)

    [:octicons-arrow-right-24: Buffer Reference](documentation/buffer.md)

</div>
