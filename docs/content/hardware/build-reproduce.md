---
title: Order on JLCPCB
---

# Order on JLCPCB

This guide walks you through ordering the EMWaver device through **JLCPCB** (PCB + optional PCBA).

## Video walkthrough

<div class="emw-youtube">
  <iframe
    src="https://www.youtube.com/embed/PNf2JGsF1Mk"
    title="EMWaver - Order on JLCPCB"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen
  ></iframe>
</div>

[![EMWavers YouTube Channel](../assets/emwavers-youtube-channel.jpg){ .emw-icon width="28" }](https://www.youtube.com/@EMWavers)
[EMWavers YouTube Channel](https://www.youtube.com/@EMWavers){ .md-button .md-button--primary }

## Files you’ll need (Gerber + BOM + Pick & Place)

These are checked into the repo docs so you can upload them directly to JLCPCB:

[Gerbers (ZIP)](../hardware-catalog/hardware/pcb/Gerber_EMWAVER_DIY_2_PCB_emwaver_diy_2025-12-09.zip){ .md-button }
[BOM (CSV)](../hardware-catalog/hardware/pcb/BOM_EMWAVER_DIY_2_2025-12-09.csv){ .md-button }
[Pick & Place / CPL (CSV)](../hardware-catalog/hardware/pcb/PickAndPlace_PCB_emwaver_diy_2025-12-09.csv){ .md-button }

You can also reference the PCB PDF when reviewing placement/orientation:

[PCB (PDF)](../hardware-catalog/hardware/pcb/PCB_emwaver_2025-12-09.pdf){ .md-button }

## 1) Order PCB (JLCPCB)

1. Go to https://jlcpcb.com/quote
2. Upload the Gerber `.zip`.
3. Set **PCB Qty** (JLCPCB PCBA commonly has a minimum of `2` units).
4. Choose PCB color / finish (optional).

## 2) (Optional) Add assembly (PCBA)

1. Enable **PCB Assembly**.
2. Choose the **assembly side** that matches the design (typically **Top**).
3. Upload the BOM `.csv` and Pick & Place / CPL `.csv`.
4. Carefully review substitutions and placement/orientation before paying.

## 3) Final checks

- Expect low-volume orders to be dominated by setup fees; prototype PCBA is rarely “cheap” at quantity `2`.
- If you’re unsure about any assembly warnings, it’s often safer to order **PCB only** and hand-solder.

## Legal / ethical note

Only test/clone/transmit against devices and systems you own or have explicit permission to work with.
