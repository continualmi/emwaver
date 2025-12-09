# EMWaver Licensing

This repository uses a dual-licensing approach to protect both the open-source software and the proprietary hardware design.

## Software License: GPL-3.0

All code in this repository is licensed under the **GNU General Public License v3.0** (GPL-3.0).

This includes:
- **Firmware** (`main/` directory) - ESP32-S3 firmware code
- **Android App** (`android/` directory) - Android companion application
- **iOS App** (`ios/` directory) - iOS companion application  
- **Desktop App** (`app/` directory) - Cross-platform desktop application
- **CLI Tool** (`cli/` directory) - Rust command-line interface
- **Documentation** (`docs/` directory) - MkDocs documentation site

### What GPL-3.0 Means

- ✅ You can use, study, modify, and distribute the code
- ✅ You can create derivative works
- ✅ You must release derivative works under GPL-3.0 (copyleft)
- ✅ You must include the license and copyright notices
- ✅ You must make source code available when distributing binaries

**Important**: If you create a device using this code, you must also release your modified code under GPL-3.0. This ensures the software remains open source.

## Hardware License: CC BY-NC-SA 4.0

Hardware design files are licensed under **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International** (CC BY-NC-SA 4.0).

This applies to:
- **Schematics** (`hardware/schematics/` directory)
- **PCB Designs** (`hardware/pcb/` directory)
- **CAD Files** (`hardware/cad/` directory)
- **Hardware Documentation** (`hardware/` directory)

### What CC BY-NC-SA 4.0 Means

- ✅ You can share and adapt the hardware designs
- ✅ You must give appropriate credit to the original creator
- ✅ You must share adaptations under the same license (ShareAlike)
- ❌ **You cannot use the designs for commercial purposes** (NonCommercial)

**Important**: This license allows you to:
- Build devices for personal use
- Create variants and modifications
- Share your modifications with others
- **NOT** sell devices based on this design commercially

The original creator (Luís Marnoto) retains the right to commercially manufacture and sell EMWaver devices.

## License Files

- `LICENSE` - Full GPL-3.0 license text for software
- `LICENSE-HARDWARE` - Full CC BY-NC-SA 4.0 license text for hardware

## Summary

| Component | License | Commercial Use |
|-----------|---------|---------------|
| Software (Code) | GPL-3.0 | ✅ Allowed (must release source) |
| Hardware (Designs) | CC BY-NC-SA 4.0 | ❌ Not allowed |

This dual-licensing approach ensures:
- The software remains open source and freely modifiable
- The hardware design is protected from commercial competition
- You can build and modify devices for personal/educational use
- The original creator can commercially manufacture the device

## Questions?

If you have questions about licensing or want to discuss commercial licensing options, please contact the repository maintainer.
