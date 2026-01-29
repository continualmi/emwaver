// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "EMWaverAppleCore",
    platforms: [
        .iOS(.v15),
        .macOS(.v13),
    ],
    products: [
        .library(name: "EMWaverTransport", targets: ["EMWaverTransport"]),
        .library(name: "EMWaverScriptModel", targets: ["EMWaverScriptModel"]),
        .library(name: "EMWaverScriptSwiftUI", targets: ["EMWaverScriptSwiftUI"]),
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
            ],
            path: "Sources/EMWaverScriptSwiftUI"
        ),
    ]
)
