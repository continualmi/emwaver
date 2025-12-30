# EMWaver

EMWaver is a fully open-source, offline-first hardware hacking and development platform — designed to be a more powerful and cost-effective alternative to platforms like [Flipper Zero](https://en.wikipedia.org/wiki/Flipper_Zero) and [Arduino](https://en.wikipedia.org/wiki/Arduino) by treating your phone and PC as part of the “device”.

Instead of cramming everything into firmware, EMWaver devices connect directly over BLE or USB and lean on the resources you already have (CPU, memory, storage, UI). That lets you build workflows that are hard or impossible with firmware alone: richer interfaces, bigger captures, faster iteration loops, and scripted procedures that can evolve without reflashing. The ecosystem includes mobile apps, a desktop app, and the EMWaver CLI (for fast project generation and automation). EMWaver also introduces a middleware layer called Wavelets: self-contained scripts written in a JavaScript-like language (EMWaver DSL) that automate hardware workflows and render portable UI components across Android, iOS, and desktop in a consistent way.

Hardware comes in two platform families: STM32 devices are ultra low-cost, USB-only, and optimized for the smallest form factors (Android/PC focused), while ESP32-S3 devices support all platforms including iOS, enable wireless workflows (BLE/Wi‑Fi), and serve as the more general-purpose, multi-function boards.

The current-gen hardware lineup includes 7 devices/modules (EMWaver, EMWaver Shield, EMWaver DIY, ISM Waver, Infrared Waver, RFID Waver, GPIO Waver) with capabilities like Sub‑GHz ISM radio (RFM69HW / CC1101), infrared RX + TX, GPIO expansion, USB scripting/BadUSB, RFID (RC522), and 2.4 GHz modules (NRF24L01+). Browse the hardware catalog and build guides here: https://luispl77.github.io/emwaver/hardware/

Next: [Installing & Using EMWaver Apps (Android, iOS, Desktop)](installing-using.md)
