![EMWaver](banner.jpeg)

EMWaver is a hardware hacking and development platform — designed to be a more powerful and cost-effective alternative to platforms like [Flipper Zero](https://en.wikipedia.org/wiki/Flipper_Zero) and [Arduino](https://en.wikipedia.org/wiki/Arduino) by treating your phone and PC as part of the “device”.

Instead of cramming everything into firmware, EMWaver devices connect directly over **USB** and lean on the resources you already have (CPU, memory, storage, UI). That lets you build workflows that are hard or impossible with firmware alone: richer interfaces, bigger captures, faster iteration loops, and scripted procedures that can evolve without reflashing.

Because boards can plug straight into your phone over USB‑C for power + communication, the form factor stays compact and cable-free—targeting Flipper Zero-style portability without shipping batteries, storage, buttons, or a display on-device, which is what makes EMWaver hardware an order of magnitude cheaper, while the combined EMWaver + phone package often far exceeds dedicated handheld capabilities (which are usually constrained by CPU, memory, and especially UI—small screens + few buttons—whereas EMWaver can leverage iOS/Android for rich interfaces plus the phone’s compute + storage for processing signals and captured data).

EMWaver ships first-class apps on iOS, Android, and desktop. All three can connect to EMWaver devices and include plug-and-play tooling for the built-in hardware so you can get hacking immediately, with many built-in features such as Sub-GHz (ISM) and Infrared signal reading, analysis, cloning and transmission, RFID card reading and cloning, and BadUSB.

EMWaver also targets rapid iteration: the desktop app includes an IDE + EMWaver scripts tooling so you can iterate quickly without reflashing firmware for most workflows.

Hardware is now centered around a single current-gen **STM32** device (USB).

**EMWaver scripts** are small programs written in the EMWaver scripting language. They render real, native-feeling UI (via the UI DSL) and call into device APIs to run hardware workflows. They’re designed for rapid iteration: edit a script, reload, and immediately get new controls and logic-without recompiling the apps or reflashing firmware.

The goal behind EMWaver IDE is simple: how fast can you fully exploit a new sensor/module/chip—not just “read a register” on a 1D serial monitor, but ship a complete UI for the chip’s functionality? With EMWaver, scripts let you build that UI in minutes with zero reflashing, while the EMWaver IDE and ecosystem let you iterate on firmware when needed. Instead of parsing logs, you get real controls (buttons, lists, pickers) that make it practical to explore and operate hardware features across common embedded protocols like SPI and I2C.

See the current device here: [Current Device](hardware/device.md). Legacy boards are archived under [History](hardware-catalog/catalog.html).

## Next steps

<div class="grid cards" markdown>

-   :material-download:{ .lg .middle } **Installing & Using**

    ---

    Install the apps and watch the walkthrough.

    [:octicons-arrow-right-24: Open Installing & Using](installing-using.md)

-   :material-hammer-wrench:{ .lg .middle } **Device**

    ---

    Build the current EMWaver board (legacy designs are archived).

    [:octicons-arrow-right-24: Open Device](hardware/device.md)

-   :material-order-bool-ascending-variant:{ .lg .middle } **Order from JLCPCB**

    ---

    Download the PCB/BOM/CPL files and order the board.

    [:octicons-arrow-right-24: Open Order from JLCPCB](hardware-catalog/hardware.html)

-   :material-pin:{ .lg .middle } **Pinout**

    ---

    GPIO numbering model and STM32 pin mapping.

    [:octicons-arrow-right-24: Open Pinout](hardware/pinout/)

-   :material-book-open-variant:{ .lg .middle } **Scripts**

    ---

    EMWaver scripts (UI + APIs).

    [:octicons-arrow-right-24: EMWaver scripts](scripts.md)

</div>
