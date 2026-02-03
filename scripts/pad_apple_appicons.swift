#!/usr/bin/env swift
import Foundation
import AppKit

struct Options {
    var scale: CGFloat = 0.84
    var dryRun: Bool = false
    var paths: [String] = []
}

func printUsageAndExit(_ code: Int32 = 1) -> Never {
    fputs("""
Usage:
  scripts/pad_apple_appicons.swift [--scale <0.1..1.0>] [--dry-run] <appiconset-dir> [<appiconset-dir> ...]

What it does:
  Adds transparent padding by scaling each PNG down to <scale> and re-centering it
  on a same-size transparent canvas. Overwrites the PNGs in-place.

Examples:
  swift scripts/pad_apple_appicons.swift --scale 0.84 ios/EMWaver/Assets.xcassets/AppIcon.appiconset macos/EMWaver/EMWaver/Assets.xcassets/AppIcon.appiconset

Notes:
  - This is intended to make icons feel less "too big" on macOS/iOS.
  - Keeps each file's pixel dimensions unchanged.
""", stderr)
    exit(code)
}

func parseArgs() -> Options {
    var opts = Options()
    var i = 1
    let args = CommandLine.arguments

    while i < args.count {
        let a = args[i]
        if a == "--help" || a == "-h" {
            printUsageAndExit(0)
        } else if a == "--dry-run" {
            opts.dryRun = true
            i += 1
        } else if a == "--scale" {
            guard i + 1 < args.count else { printUsageAndExit() }
            let s = Double(args[i+1]) ?? -1
            if s <= 0 || s > 1 { printUsageAndExit() }
            opts.scale = CGFloat(s)
            i += 2
        } else if a.hasPrefix("--scale=") {
            let parts = a.split(separator: "=", maxSplits: 1).map(String.init)
            if parts.count != 2 { printUsageAndExit() }
            let s = Double(parts[1]) ?? -1
            if s <= 0 || s > 1 { printUsageAndExit() }
            opts.scale = CGFloat(s)
            i += 1
        } else if a.hasPrefix("-") {
            printUsageAndExit()
        } else {
            opts.paths.append(a)
            i += 1
        }
    }

    if opts.paths.isEmpty {
        printUsageAndExit()
    }
    return opts
}

func loadPNG(_ url: URL) -> NSImage? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    return NSImage(data: data)
}

func savePNG(_ image: NSImage, to url: URL) throws {
    guard let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "pad_apple_appicons", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to encode PNG"])
    }
    try png.write(to: url, options: .atomic)
}

func padImage(_ src: NSImage, scale: CGFloat) -> NSImage? {
    let size = src.size
    if size.width <= 0 || size.height <= 0 { return nil }

    let dst = NSImage(size: size)
    dst.lockFocus()

    // Transparent background by default.
    NSColor.clear.set()
    NSRect(origin: .zero, size: size).fill()

    let targetW = size.width * scale
    let targetH = size.height * scale
    let x = (size.width - targetW) / 2.0
    let y = (size.height - targetH) / 2.0
    let rect = NSRect(x: x, y: y, width: targetW, height: targetH)

    src.draw(in: rect, from: NSRect(origin: .zero, size: size), operation: .sourceOver, fraction: 1.0, respectFlipped: true, hints: [NSImageHintInterpolation: NSImageInterpolation.high])

    dst.unlockFocus()
    return dst
}

let opts = parseArgs()

var total = 0
var changed = 0

for path in opts.paths {
    let dirURL = URL(fileURLWithPath: path)
    var isDir: ObjCBool = false
    guard FileManager.default.fileExists(atPath: dirURL.path, isDirectory: &isDir), isDir.boolValue else {
        print("[skip] not a directory: \(path)")
        continue
    }

    let contents = (try? FileManager.default.contentsOfDirectory(at: dirURL, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])) ?? []
    let pngs = contents.filter { $0.pathExtension.lowercased() == "png" }

    if pngs.isEmpty {
        print("[skip] no PNGs in: \(path)")
        continue
    }

    print("[dir] \(path)  (scale=\(opts.scale), dryRun=\(opts.dryRun))")

    for pngURL in pngs {
        total += 1
        guard let src = loadPNG(pngURL) else {
            print("  [fail] load: \(pngURL.lastPathComponent)")
            continue
        }
        guard let dst = padImage(src, scale: opts.scale) else {
            print("  [fail] pad:  \(pngURL.lastPathComponent)")
            continue
        }

        if opts.dryRun {
            print("  [dry]  \(pngURL.lastPathComponent)")
            continue
        }

        do {
            try savePNG(dst, to: pngURL)
            changed += 1
            print("  [ok]   \(pngURL.lastPathComponent)")
        } catch {
            print("  [fail] save: \(pngURL.lastPathComponent)  (\(error))")
        }
    }
}

print("Done. total=\(total) changed=\(changed)")
