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
            items.append(currentDeviceIsRegistered ? "Secure" : "Needs activation")
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
        if accountDevices.hasOfflineAccess(boardType: "stm32f042", hardwareUid: hardwareUid) {
            return "This device is available in Offline Mode."
        }
        return "This device needs online activation before it can be used in Offline Mode."
    }

    private var currentDeviceIsRegistered: Bool {
        guard let hardwareUid = device.hardwareUidHex, !hardwareUid.isEmpty else { return false }
        return accountDevices.hasOfflineAccess(boardType: "stm32f042", hardwareUid: hardwareUid)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                overviewCard
                devicesSection
                firmwareSection

                if let err = device.lastErrorText, !err.isEmpty {
                    detailSection(title: "Last error") {
                        Text(err)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
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

    private var firmwareSection: some View {
        detailSection(title: "Firmware") {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    Button(currentDeviceIsRegistered ? "Update firmware…" : "Activate device…") {
                        dismiss()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                            firmwareUpdater.present()
                        }
                    }
                    .buttonStyle(.borderedProminent)

                    if device.isConnected {
                        Button("Enter Update Mode") {
                            device.requestEnterUpdateMode()
                            device.disconnect()
                            firmwareUpdater.refreshDfuPresence()
                        }
                        .buttonStyle(.bordered)
                    }
                }

                Text(firmwareUpdater.dfuConnected ? "Update Mode detected." : "Update Mode not detected.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if !currentDeviceIsRegistered {
                    Text("Activation reads the hardware UID, registers the board with the backend, and prepares it for use in the app.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var deviceStatusText: String {
        if currentDeviceIsRegistered {
            if accountDevices.isOfflineMode {
                return "This device is registered and available from the local cache."
            }
            return "This device is registered to your EMWaver device list."
        }
        if accountDevices.isOfflineMode {
            return "This device is not in the local cache yet. Go online once to activate it."
        }
        if auth.isSignedIn {
            return "This device is connected, but it is not registered to your device list yet."
        }
        return "This device is connected, but it is not registered yet. Sign in to activate and sync it."
    }

    private var devicesIntroText: String {
        if let syncAt = accountDevices.lastSyncAt {
            if accountDevices.isOfflineMode {
                return "Showing locally cached devices."
            }
            return "Last synced \(syncAt.formatted(date: .abbreviated, time: .shortened))."
        }
        if accountDevices.isOfflineMode {
            return "Showing locally cached devices."
        }
        if auth.isSignedIn {
            return "Signed in. Your device list will sync when available."
        }
        return "Sign in to sync your devices. Cached devices remain available in Offline Mode."
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
