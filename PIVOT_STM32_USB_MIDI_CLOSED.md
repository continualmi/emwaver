# EMWaver Pivot: STM32 + USB MIDI + Closed Source

This branch is the staging ground for a bold, simplifying change:

- EMWaver moves from open source to **closed source**.
- We **remove ESP32-S3 completely**.
- We converge on **one low-cost STM32 EMWaver board** that is compatible across **ALL** platforms, including **iOS**, by using **USB MIDI** (instead of USB CDC).
  - This follows the discovery that iOS supports STM32 via USB MIDI, and the latest iPhones we were targeting have USB‑C anyway.

This is a massive change, and that’s the point: we are not compromising — we are doubling down on our strengths.

## The Core Thesis

EMWaver is **ALL about hardware exploration above all**: education, tinkering, “vibe hacking”.

We are not trying to be a general-purpose firmware development environment, and we are not trying to be a deployment platform.

The guiding metric is:

> **Time to Full Chip Exploit** should be as low as possible.

Wavelets (likely renamed to **EMWaver scripts**) are the essence of EMWaver:

- **No compile**.
- **Ultra fast** hardware exploration.
- In a single script you develop both:
  - low-level hardware interactions, and
  - high-level user interfaces.

We will likely introduce:

- `.emw` as a first-class file format for these scripts.

## Closed Source (What It Means Here)

Closed source here means:

- The apps are shipped as **binaries** with clean installation flows.
- The firmware is also **closed**:
  - we give up completely the firmware building/flashing/customization workflow for end users.
  - we do not ship “messy code” or open source it.
  - we do not ship a GitHub repo as the product.

The platform becomes intentionally “client-first”.

## Hardware Direction

The final EMWaver board becomes:

- A fusion between all STM32 boards: **GPIO**, **ISM**, and **infrared**.
- A capability level similar to the old “flagship” concept, but:
  - faster connections via **USB**,
  - smaller form factor (no ESP32‑S3 module),
  - lower overall cost.

The goal: **one board**, not 7 boards, not a catalog, not confusion.

## What We Lose (Explicit Tradeoffs)

We lose a few real things:

1. The wireless nature of ESP32 meant we could control hardware with no device attached.
   - Powerbanks powering the EMWaver flagship still worked perfectly.
2. We lose the ability to flash custom firmware.
   - Without the client, EMWaver boards will now do absolutely nothing.
   - Before, you could flash firmware and have a helper client on the side.

Are these worth sacrificing? The current answer is **yes**.

Custom firmware is not EMWaver — it’s ESP‑IDF / Arduino / STM32CubeIDE / CubeMX / Programmer.
That is not what EMWaver is.

EMWaver is a hardware experimentation platform, and it is not meant to be used without a client.
The client is the strongest argument for EMWaver (sampler experiences, recording and retransmitting signals, etc.).

## What We Gain

We gain a really super simple platform:

- **One board**
- **One firmware binary**
- **Three applications**

That’s it.

No compile/build/flash loops. No wrappers on top of ESP‑IDF, CubeMX, or build/flash tools.

This is starting to feel really right.

## Practical Notes / Reality Check

- It’s rough to give up the `esp/` folder, but it wasn’t that much effort anyway.
  - The sampler work was the effort.
- We still must verify iOS accepts USB MIDI for our use case.
  - An adapter is arriving in ~3 days; this branch exists so we can pivot cleanly while we validate.

## Repo/Project Changes We Expect (Staged, Not Yet Executed Here)

This branch is where we will do the cleanup once MIDI is verified:

- Clear up licenses and README files to match the new reality.
- Create a `frontend/` folder and move docs content there.
  - We are going to serve static pages with **Azure**.
- Remove ESP32‑S3-related code and board variants once we are confident.

## Non-Goals

- EMWaver is not a general-purpose firmware development platform.
- EMWaver is not a “deploy on EMWaver” platform.
- We are not trying to replace ESP‑IDF/CubeMX/Arduino as toolchains.

## Immediate Next Steps

1. Prototype/validate USB MIDI transport on iOS with the adapter.
2. Confirm throughput/reliability is sufficient for our sampler and scripting workflows.
3. Only after validation: begin staged removals/refactors (ESP32‑S3, board catalog simplification, docs → `frontend/`, licensing/README updates).

