import SwiftUI

struct DeviceConnectionSheet: View {
    @ObservedObject var device: MacUSBManager
    @ObservedObject var firmwareUpdater: FirmwareUpdateManager
    @EnvironmentObject private var auth: AuthenticationManager
    @EnvironmentObject private var accountDevices: AccountDevicesService
    @Environment(\.dismiss) private var dismiss

    private var statusLabel: (text: String, icon: String) {
        if device.isConnected {
            return ("Connected", "cable.connector")
        }
        if isEspBoard && firmwareUpdater.espBootloaderConnected {
            return ("ESP Bootloader", "cpu")
        }
        if firmwareUpdater.dfuConnected {
            return ("Update Mode", "arrow.triangle.2.circlepath")
        }
        return ("Disconnected", "cable.connector.slash")
    }

    private var statusChips: [String] {
        var items: [String] = []
        if let port = device.connectedPortName, !port.isEmpty {
            items.append(port)
        }
        if device.isConnected, let version = device.deviceEmwaverVersion, !version.isEmpty {
            items.append("EMWaver \(version)")
        }
        if device.isConnected {
            if needsFirmwareInstall {
                items.append("Needs firmware")
            } else if currentDeviceIsRegistered {
                items.append(auth.isSignedIn ? "Claimed" : "Cached")
            } else if !currentDeviceClaimStatusResolved {
                items.append("Checking")
            } else {
                items.append("Unclaimed")
            }
        }
        if let uid = shortHardwareUid {
            items.append("UID \(uid)")
        }
        return items
    }

    private var shortHardwareUid: String? {
        guard let uid = device.hardwareUidHex, uid.count >= 8 else { return nil }
        return String(uid.suffix(8))
    }

    private var currentDeviceOfflineStatus: String? {
        guard accountDevices.isOfflineMode else { return nil }
        guard let hardwareUid = device.hardwareUidHex, !hardwareUid.isEmpty else { return nil }
        if accountDevices.hasOfflineAccess(boardType: currentBoardType, hardwareUid: hardwareUid) {
            return "This device is available in Offline Mode."
        }
        return "This device needs online activation before it can be used in Offline Mode."
    }

    private var currentDeviceIsRegistered: Bool {
        guard let hardwareUid = currentHardwareUidHex, !hardwareUid.isEmpty else { return false }
        return accountDevices.hasOfflineAccess(boardType: currentBoardType, hardwareUid: hardwareUid)
    }

    private var currentDeviceClaimStatusResolved: Bool {
        guard let hardwareUid = currentHardwareUidHex, !hardwareUid.isEmpty else { return true }
        return accountDevices.claimStatusResolved(
            boardType: currentBoardType,
            hardwareUid: hardwareUid,
            signedIn: auth.isSignedIn
        )
    }

    private var currentHardwareUidHex: String? {
        let value = device.hardwareUidHex ?? device.lastDetectedHardwareUidHex
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    private var currentBoardType: String {
        device.connectedBoardType ?? device.lastDetectedBoardType ?? "stm32f042"
    }

    private var isEspBoard: Bool {
        currentBoardType.caseInsensitiveCompare("esp32s3") == .orderedSame
    }

    private var needsFirmwareInstall: Bool {
        device.isConnected &&
        device.deviceEmwaverVersion != nil &&
        currentHardwareUidHex == nil &&
        device.hardwareUidUnsupportedByFirmware &&
        !isEspBoard
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                overviewCard
                devicesSection
            }
            .padding(24)
        }
        .frame(minWidth: 560, idealWidth: 620, minHeight: 480, idealHeight: 560)
        .onAppear {
            firmwareUpdater.refreshDfuPresence()
            accountDevices.refresh(auth: auth)
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Device")
                    .font(.title2.weight(.semibold))

                HStack(spacing: 10) {
                    Label(statusLabel.text, systemImage: statusLabel.icon)
                        .font(.subheadline.weight(.medium))

                    ForEach(statusChips, id: \.self) { chip in
                        Text(chip)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Capsule().fill(Color.secondary.opacity(0.12)))
                    }
                }
            }

            Spacer(minLength: 0)

            Button("Close") { dismiss() }
                .buttonStyle(.bordered)
        }
    }

    private var overviewCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: accountDevices.isOfflineMode ? "wifi.slash" : "wifi")
                Text(accountDevices.isOfflineMode ? "Offline Mode" : "Online")
                    .fontWeight(.medium)
            }
            .font(.subheadline)

            Text(accountStatusText)
                .font(.caption)
                .foregroundStyle(.secondary)

            Text(deviceStatusText)
                .foregroundStyle(.secondary)

            if let currentDeviceOfflineStatus, !currentDeviceOfflineStatus.isEmpty {
                Text(currentDeviceOfflineStatus)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 10) {
                Button("Disconnect") {
                    device.disconnect()
                }
                .buttonStyle(.bordered)
                .disabled(!device.isConnected)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.secondary.opacity(0.08)))
    }

    private var devicesSection: some View {
        detailSection(title: "My devices") {
            VStack(alignment: .leading, spacing: 10) {
                Text(devicesIntroText)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if accountDevices.devices.isEmpty {
                    Text(accountDevices.isOfflineMode ? "No cached devices on this Mac yet." : "No devices on this account yet.")
                        .foregroundStyle(.secondary)
                } else {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(accountDevices.devices) { entry in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(entry.label.isEmpty ? (entry.boardType ?? "EMWaver device") : entry.label)
                                    .font(.subheadline.weight(.medium))

                                HStack(spacing: 10) {
                                    if let boardType = entry.boardType, !boardType.isEmpty {
                                        Text(boardType)
                                    }
                                    if let hardwareUid = entry.hardwareUid, !hardwareUid.isEmpty {
                                        Text("UID \(hardwareUid.suffix(8))")
                                    }
                                    Text("Seen \(Date(timeIntervalSince1970: TimeInterval(entry.lastSeenAtMs) / 1000).formatted(date: .abbreviated, time: .shortened))")
                                }
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 2)
                        }
                    }
                }

                if let err = accountDevices.lastError, !err.isEmpty, !accountDevices.isOfflineMode {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var deviceStatusText: String {
        if needsFirmwareInstall {
            return "This device is running firmware that does not expose a hardware UID yet. Install managed EMWaver firmware before claiming it."
        }
        if currentDeviceIsRegistered {
            if !auth.isSignedIn {
                return "This device matches a locally cached device record. Sign in to confirm which account it belongs to."
            }
            if accountDevices.isOfflineMode {
                return "This device is claimed and available from the local cache."
            }
            return "This device is claimed in your EMWaver account."
        }
        if !currentDeviceClaimStatusResolved {
            return "Checking whether this device is already claimed in your account."
        }
        if accountDevices.isOfflineMode {
            return "This device is not claimed in the local cache yet. Go online once to set it up."
        }
        if auth.isSignedIn {
            return "This device is connected, but it is not claimed in your account yet."
        }
        return "This device is connected, but it is not claimed yet. Sign in to set it up."
    }

    private var devicesIntroText: String {
        if !auth.isSignedIn {
            if let syncAt = accountDevices.lastSyncAt {
                return "Signed out. Showing locally cached devices from the last sync on \(syncAt.formatted(date: .abbreviated, time: .shortened))."
            }
            return "Signed out. Showing locally cached devices."
        }
        let signedInLabel = auth.session?.email.flatMap { $0.isEmpty ? nil : $0 } ?? auth.userLabel
        if let syncAt = accountDevices.lastSyncAt {
            if accountDevices.isOfflineMode {
                return "Signed in as \(signedInLabel). Showing locally cached devices."
            }
            return "Signed in as \(signedInLabel). Last synced \(syncAt.formatted(date: .abbreviated, time: .shortened))."
        }
        if accountDevices.isOfflineMode {
            return "Signed in as \(signedInLabel). Showing locally cached devices."
        }
        if auth.isSignedIn {
            return "Signed in as \(signedInLabel). Your device list will sync when available."
        }
        return "Sign in to sync your devices. Cached devices remain available in Offline Mode."
    }

    private var accountStatusText: String {
        if let email = auth.session?.email, !email.isEmpty {
            return "Account: \(email)"
        }
        if auth.isSignedIn {
            return "Account: \(auth.userLabel)"
        }
        return "Account: not signed in"
    }

    private func detailSection<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline)

            content()
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.secondary.opacity(0.06)))
        }
    }
}
