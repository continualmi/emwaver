// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "EMWaverAppleCore",
    platforms: [
        .iOS(.v17),
        .macOS(.v13),
    ],
    products: [
        .library(name: "EMWaverTransport", targets: ["EMWaverTransport"]),
        .library(name: "EMWaverScriptModel", targets: ["EMWaverScriptModel"]),
        .library(name: "EMWaverScriptSwiftUI", targets: ["EMWaverScriptSwiftUI"]),
        .library(name: "EMWaverScriptRuntime", targets: ["EMWaverScriptRuntime"]),
        .library(name: "EMWaverScriptStorage", targets: ["EMWaverScriptStorage"]),
        .library(name: "EMWaverScriptsUI", targets: ["EMWaverScriptsUI"]),
    ],
    targets: [
        .target(
            name: "EMWaverTransport",
            path: "Sources/EMWaverTransport"
        ),
        .target(
            name: "EMWaverScriptModel",
            path: "Sources/EMWaverScriptModel"
        ),
        .target(
            name: "EMWaverScriptSwiftUI",
            dependencies: [
                "EMWaverScriptModel",
                "EMWaverScriptRuntime",
            ],
            path: "Sources/EMWaverScriptSwiftUI"
        ),
        .target(
            name: "EMWaverScriptRuntime",
            dependencies: [
                "EMWaverScriptModel",
            ],
            path: "Sources/EMWaverScriptRuntime"
        ),
        .target(
            name: "EMWaverScriptStorage",
            path: "Sources/EMWaverScriptStorage"
        ),
        .target(
            name: "EMWaverScriptsUI",
            dependencies: [
                "EMWaverScriptModel",
                "EMWaverScriptSwiftUI",
                "EMWaverScriptRuntime",
                "EMWaverScriptStorage",
            ],
            path: "Sources/EMWaverScriptsUI",
            resources: [
                .process("Resources")
            ],
            linkerSettings: [
                .linkedLibrary("sqlite3")
            ]
        ),
        .testTarget(
            name: "EMWaverScriptRuntimeTests",
            dependencies: [
                "EMWaverScriptRuntime",
            ],
            path: "Tests/EMWaverScriptRuntimeTests"
        ),
    ]
)
