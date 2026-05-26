/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

enum IOSAppBuildInfo {
    static var toolbarVersionText: String {
        commitShort.isEmpty ? displayVersion : "\(displayVersion) \(commitShort)"
    }

    static var displayVersion: String {
        let version = bundleValue("CFBundleShortVersionString")
        return version.isEmpty ? "unknown" : version
    }

    static var buildNumber: String {
        let build = bundleValue("CFBundleVersion")
        return build.isEmpty ? "unknown" : build
    }

    static var commitShort: String {
        let commit = bundleValue("EMWaverCommit")
        return commit.isEmpty ? "" : String(commit.prefix(7))
    }

    private static func bundleValue(_ key: String) -> String {
        Bundle.main.object(forInfoDictionaryKey: key) as? String ?? ""
    }
}
