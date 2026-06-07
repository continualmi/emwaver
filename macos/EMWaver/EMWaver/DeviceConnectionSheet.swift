import SwiftUI

struct DeviceConnectionSheet: View {
    private struct LocalDeviceGroup: Identifiable {
        let id: String
        var title: String
        var boardType: String?
        var uidText: String?
        var hasUIDError: Bool
        var transports: [LocalDeviceDescriptor]

        var detailText: String {
            if let uidText {
                return uidText
            }
            if hasUIDError {
                return "uid unavailable"
            }
            return ""
        }

        var boardText: String {
            LocalDeviceLabelFormatter.boardDisplayName(boardType)
        }
    }

    private static let wifiSSIDDefaultsKey = "emwaver.wifi.setup.ssid"
    private static let wifiHostDefaultsKey = "emwaver.wifi.manual.host"
    private static let wifiPortDefaultsKey = "emwaver.wifi.manual.port"
    private static let wifiPasswordKeychainAccount = "emwaver.wifi.setup.password"
    private static let uidProbeTimestampFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .medium
        return formatter
    }()

    @ObservedObject var device: MacUSBManager
    @ObservedObject var firmwareUpdater: FirmwareUpdateManager
    @Binding var selectedDeviceID: String?
    @Environment(\.dismiss) private var dismiss
    @State private var wifiHost: String = ""
    @State private var wifiPort: String = "3922"
    @State private var wifiSSID: String = ""
    @State private var wifiPassword: String = ""
    @State private var isWiFiSetupPresented: Bool = false

    private var parsedWiFiPort: Int? {
        Self.parsedWiFiPort(wifiPort)
    }

    private var statusLabel: (text: String, icon: String) {
        if device.isConnected {
            if device.connectedTransportKind == "BLE" {
                return ("Connected over BLE", "antenna.radiowaves.left.and.right")
            }
            if device.connectedTransportKind == "Wi-Fi" {
                return ("Connected over Wi-Fi", "wifi")
            }
            if device.connectedTransportKind == "USB Serial" {
                return ("Connected over USB Serial", "cable.connector")
            }
            return ("Connected", "cable.connector")
        }
        if espBootloaderAvailable {
            return ("\(currentBoardDisplayName) serial", "cpu")
        }
        if firmwareUpdater.dfuConnected {
            return ("Update Mode", "arrow.triangle.2.circlepath")
        }
        return ("Disconnected", "cable.connector.slash")
    }

    private var deviceMetadata: [(label: String, value: String)] {
        var items: [(label: String, value: String)] = []
        if let port = device.connectedPortName, !port.isEmpty {
            items.append((device.connectedTransportKind == "BLE" ? "Device" : "Port", port))
        }
        if espBootloaderAvailable, let port = firmwareUpdater.espBootloaderPort, !port.isEmpty {
            items.append(("Flash port", port))
        }
        if device.isConnected, let version = device.deviceEmwaverVersion, !version.isEmpty {
            items.append(("Firmware", "EMWaver \(version)"))
        }
        if device.isConnected, let uid = device.connectedHardwareUID, !uid.isEmpty {
            items.append(("Hardware UID", String(uid.suffix(12))))
        }
        if device.isConnected, let transport = device.connectedTransportKind, !transport.isEmpty {
            items.append(("Transport", transport))
        }
        if isEspBoard && espBootloaderAvailable {
            items.append(("MCU", currentBoardDisplayName))
        } else if device.isConnected {
            items.append(("MCU", currentBoardDisplayName))
        }
        return items
    }

    private var currentBoardType: String {
        if let connected = device.connectedBoardType {
            return connected
        }
        if espBootloaderAvailable {
            return firmwareUpdater.espBootloaderBoardType ?? "esp"
        }
        return device.lastDetectedBoardType ?? "stm32f042"
    }

    private var espBootloaderAvailable: Bool {
        !device.isConnected && (firmwareUpdater.espBootloaderConnected || firmwareUpdater.espBootloaderPort != nil)
    }

    private var isEspBoard: Bool {
        FirmwareUpdateManager.isEspBoardType(currentBoardType)
    }

    private var shouldShowWiFiCard: Bool {
        isEspBoard
    }

    private var uidProbeLastCheckedText: String {
        guard let checkedAt = device.uidConnectionProbeLastChecked else {
            return "Last checked: never"
        }
        return "Last checked: \(Self.uidProbeTimestampFormatter.string(from: checkedAt))"
    }

    private var currentBoardDisplayName: String {
        LocalDeviceLabelFormatter.boardDisplayName(currentBoardType)
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    uidProbeStatusLine
                    deviceListCard
                    if shouldShowWiFiCard {
                        wifiCard
                    }
                    firmwareCard
                }
                .padding(24)
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxHeight: 520)

            Divider()

            footer
        }
        .frame(minWidth: 560, idealWidth: 620)
        .onAppear {
            loadWiFiFormState()
            firmwareUpdater.refreshDfuPresence(includeEspSerialProbe: true)
        }
        .onDisappear {
            saveWiFiFormState()
        }
        .onChange(of: wifiSSID) { _ in
            saveWiFiFormState()
        }
        .onChange(of: wifiPassword) { _ in
            saveWiFiFormState()
        }
        .onChange(of: wifiHost) { _ in
            saveWiFiFormState()
        }
        .onChange(of: wifiPort) { _ in
            saveWiFiFormState()
        }
        .sheet(isPresented: $isWiFiSetupPresented) {
            wifiSetupSheet
        }
    }

    private func loadWiFiFormState() {
        wifiSSID = UserDefaults.standard.string(forKey: Self.wifiSSIDDefaultsKey) ?? wifiSSID
        wifiHost = UserDefaults.standard.string(forKey: Self.wifiHostDefaultsKey) ?? wifiHost
        wifiPort = UserDefaults.standard.string(forKey: Self.wifiPortDefaultsKey) ?? wifiPort
        wifiPassword = (try? KeychainStore.getString(account: Self.wifiPasswordKeychainAccount)) ?? wifiPassword
    }

    private func saveWiFiFormState() {
        UserDefaults.standard.set(wifiSSID, forKey: Self.wifiSSIDDefaultsKey)
        UserDefaults.standard.set(wifiHost, forKey: Self.wifiHostDefaultsKey)
        UserDefaults.standard.set(wifiPort, forKey: Self.wifiPortDefaultsKey)
        do {
            try KeychainStore.setString(wifiPassword, account: Self.wifiPasswordKeychainAccount)
        } catch {
            // Form persistence is a convenience; provisioning should still work if Keychain is unavailable.
        }
    }

    private var footer: some View {
        HStack {
            Spacer(minLength: 0)
            Button("Close") { dismiss() }
                .buttonStyle(.bordered)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 14)
    }

    private var deviceMetadataLeftColumn: [(label: String, value: String)] {
        metadataItems(for: ["Device", "Port", "Hardware UID"])
    }

    private var deviceMetadataRightColumn: [(label: String, value: String)] {
        metadataItems(for: ["Firmware", "Transport", "MCU"])
    }

    private func metadataItems(for labels: [String]) -> [(label: String, value: String)] {
        labels.compactMap { label in
            deviceMetadata.first { $0.label == label }
        }
    }

    private func deviceMetadataColumn(_ items: [(label: String, value: String)]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(items, id: \.label) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.label)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(item.value)
                        .font(.caption.weight(.medium))
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var deviceListCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Local devices", systemImage: "list.bullet.rectangle")
                .font(.headline)

            if device.discoveredDevices.isEmpty {
                Text("No EMWaver devices discovered yet.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 8) {
                    ForEach(groupedLocalDevices) { group in
                        HStack(spacing: 12) {
                            Image(systemName: preferredTransportIcon(for: group))
                                .foregroundStyle(.secondary)
                                .frame(width: 20)

                            VStack(alignment: .leading, spacing: 3) {
                                Text(group.title)
                                    .font(.subheadline.weight(.medium))
                                    .lineLimit(1)
                                if !group.detailText.isEmpty {
                                    Text(group.detailText)
                                        .font(.caption.weight(.medium))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }

                            Spacer(minLength: 0)

                            Text(group.boardText)
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .frame(minWidth: 72, alignment: .trailing)

                            transportControl(for: group)
                        }
                        .padding(10)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.secondary.opacity(0.06)))
                    }
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.secondary.opacity(0.08)))
    }

    private var uidProbeStatusLine: some View {
        Text(uidProbeLastCheckedText)
            .font(.caption.weight(.medium))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var groupedLocalDevices: [LocalDeviceGroup] {
        var groups: [LocalDeviceGroup] = []
        var indexByKey: [String: Int] = [:]

        for item in device.discoveredDevices {
            let uid = hardwareUID(from: item.identifierText)
            let key = uid.map { "uid:\($0)" } ?? item.id
            if let idx = indexByKey[key] {
                groups[idx].transports.append(item)
                groups[idx].title = preferredGroupTitle(current: groups[idx].title, candidate: groupTitleCandidate(for: item))
                groups[idx].boardType = groups[idx].boardType ?? item.boardType
                groups[idx].uidText = groups[idx].uidText ?? item.identifierText
                groups[idx].hasUIDError = groups[idx].hasUIDError || item.lastErrorText == "UID unavailable"
            } else {
                indexByKey[key] = groups.count
                groups.append(LocalDeviceGroup(
                    id: key,
                    title: groupTitleCandidate(for: item),
                    boardType: item.boardType,
                    uidText: item.identifierText,
                    hasUIDError: item.lastErrorText == "UID unavailable",
                    transports: [item]
                ))
            }
        }

        return groups.map { group in
            var copy = group
            copy.transports.sort { lhs, rhs in
                transportSortKey(lhs.transport) < transportSortKey(rhs.transport)
            }
            return copy
        }
        .sorted { lhs, rhs in
            return lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending
        }
    }

    private var wifiCard: some View {
        HStack(alignment: .center, spacing: 14) {
            Image(systemName: "wifi")
                .font(.title3.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 3) {
                Text("Wi-Fi Setup")
                    .font(.subheadline.weight(.semibold))
                Text("Provision this ESP32 for local network control.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 12)

            Button("Set Up Wi-Fi") {
                isWiFiSetupPresented = true
            }
            .buttonStyle(.borderedProminent)
            .disabled(!device.isConnected)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.secondary.opacity(0.08)))
    }

    private var wifiSetupSheet: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Label("ESP32 Wi-Fi Setup", systemImage: "wifi")
                        .font(.headline)
                    Text("Send network credentials over the current device connection. The ESP32 will choose its own local hostname.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 12)

                Button("Close") {
                    isWiFiSetupPresented = false
                }
                .buttonStyle(.bordered)
            }

            Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 10) {
                GridRow {
                    TextField("SSID", text: $wifiSSID)
                        .textFieldStyle(.roundedBorder)
                        .frame(minWidth: 250)

                    SecureField("Wi-Fi password", text: $wifiPassword)
                        .textFieldStyle(.roundedBorder)
                }
            }

            ViewThatFits(in: .horizontal) {
                wifiProvisioningActions
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        wifiSendSetupButton
                        wifiClearSetupButton
                        wifiStatusButton
                    }
                }
            }

            if let status = device.wifiProvisioningStatus, !status.isEmpty {
                Text(status)
                    .font(.caption)
                    .foregroundStyle(device.isWiFiProvisioningError ? Color.orange : .secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(24)
        .frame(minWidth: 560, idealWidth: 620)
    }

    private var wifiProvisioningActions: some View {
        HStack(spacing: 10) {
            wifiSendSetupButton
            wifiClearSetupButton
            wifiStatusButton
        }
    }

    private var wifiSendSetupButton: some View {
        Button(device.isWiFiProvisioning ? "Provisioning" : "Send Wi-Fi Setup") {
            saveWiFiFormState()
            device.provisionWiFi(
                ssid: wifiSSID,
                password: wifiPassword
            )
        }
        .buttonStyle(.bordered)
        .disabled(device.isWiFiProvisioning ||
                  !device.isConnected ||
                  wifiSSID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    private var wifiClearSetupButton: some View {
        Button("Clear Setup") {
            device.clearWiFiProvisioning()
        }
        .buttonStyle(.bordered)
        .disabled(device.isWiFiProvisioning ||
                  !device.isConnected)
    }

    private var wifiStatusButton: some View {
        Button("Status") {
            device.refreshWiFiProvisioningStatus()
        }
        .buttonStyle(.bordered)
        .disabled(device.isWiFiProvisioning ||
                  !device.isConnected)
    }

    private var firmwareCard: some View {
        HStack(alignment: .center, spacing: 14) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.title3.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 3) {
                Text("Firmware")
                    .font(.subheadline.weight(.semibold))
                Text(isEspBoard ? "Flash the bundled \(currentBoardDisplayName) firmware." : "Update the connected board firmware.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 12)

            Button(isEspBoard ? "Flash firmware" : "Update firmware") {
                firmwareUpdater.present(boardType: currentBoardType)
                dismiss()
            }
            .buttonStyle(.borderedProminent)
            .disabled(!device.isConnected && !firmwareUpdater.dfuConnected && !espBootloaderAvailable)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.secondary.opacity(0.08)))
    }

    private func transportActionTitle(for item: LocalDeviceDescriptor) -> String {
        let prefix = item.transport.rawValue
        if item.connectionState == .connected { return "Use \(prefix)" }
        if item.connectionState == .connecting { return "\(prefix) Connecting" }
        return "Use \(prefix)"
    }

    private func isTransportActionDisabled(_ item: LocalDeviceDescriptor) -> Bool {
        item.connectionState == .connecting
    }

    @ViewBuilder
    private func transportControl(for group: LocalDeviceGroup) -> some View {
        if group.transports.count > 1 {
            Picker("Transport", selection: Binding(
                get: { selectedTransportID(for: group) },
                set: { selectedID in
                    guard let item = group.transports.first(where: { $0.id == selectedID }),
                          !isTransportActionDisabled(item) else { return }
                    selectedDeviceID = selectedID
                    device.connectDevice(id: selectedID)
                }
            )) {
                ForEach(group.transports) { item in
                    Text(item.transport.rawValue)
                        .tag(item.id)
                }
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            .frame(width: max(150, CGFloat(group.transports.count) * 74))
            .help("Switch transport for this device")
        } else if let item = preferredTransport(for: group) {
            Text(item.transport.rawValue)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background(Capsule().fill(Color.secondary.opacity(0.12)))
            .help(deviceDetailText(for: item))
        }
    }

    private func selectedTransportID(for group: LocalDeviceGroup) -> String {
        if let selectedDeviceID,
           group.transports.contains(where: { $0.id == selectedDeviceID }) {
            return selectedDeviceID
        }
        if let active = group.transports.first(where: { $0.isActive }) {
            return active.id
        }
        if let connected = group.transports.first(where: { $0.connectionState == .connected }) {
            return connected.id
        }
        return preferredTransport(for: group)?.id ?? group.transports.first?.id ?? group.id
    }

    private func preferredTransport(for group: LocalDeviceGroup) -> LocalDeviceDescriptor? {
        group.transports.sorted { lhs, rhs in
            transportSortKey(lhs.transport) < transportSortKey(rhs.transport)
        }.first
    }

    private func preferredTransportIcon(for group: LocalDeviceGroup) -> String {
        preferredTransport(for: group).map { transportIcon(for: $0.transport) } ?? "cpu"
    }

    private func transportIcon(for transport: LocalDeviceDescriptor.TransportKind) -> String {
        switch transport {
        case .ble:
            return "antenna.radiowaves.left.and.right"
        case .usbMidi, .usbSerial:
            return "cable.connector"
        case .wifi:
            return "wifi"
        }
    }

    private func deviceDetailText(for item: LocalDeviceDescriptor) -> String {
        let errorText = item.lastErrorText.map { " · \($0.lowercased())" } ?? ""
        let identifierText = item.identifierText.map { " · \($0)" } ?? ""
        return "\(item.transport.rawValue) · \(item.boardType ?? "Unknown") · \(item.connectionState.rawValue)\(identifierText)\(errorText)"
    }

    private func hardwareUID(from identifierText: String?) -> String? {
        guard let identifierText, identifierText.hasPrefix("UID ") else { return nil }
        let uid = String(identifierText.dropFirst("UID ".count)).trimmingCharacters(in: .whitespacesAndNewlines)
        guard uid.count == 12, uid.allSatisfy(\.isHexDigit) else { return nil }
        return uid
    }

    private func groupTitleCandidate(for item: LocalDeviceDescriptor) -> String {
        if item.transport == .usbSerial {
            return item.displayName.isEmpty ? LocalDeviceLabelFormatter.boardDisplayName(item.boardType) : item.displayName
        }
        if let module = item.moduleLabel, !module.isEmpty, item.transport == .wifi {
            return item.displayName
        }
        if let module = item.moduleLabel, !module.isEmpty {
            return module
        }
        return item.displayName.isEmpty ? LocalDeviceLabelFormatter.boardDisplayName(item.boardType) : item.displayName
    }

    private func preferredGroupTitle(current: String, candidate: String) -> String {
        if current.isEmpty { return candidate }
        if candidate.isEmpty { return current }
        if current == candidate { return current }
        if current.localizedCaseInsensitiveContains("EMWaver") && !candidate.localizedCaseInsensitiveContains("EMWaver") {
            return current
        }
        if candidate.localizedCaseInsensitiveContains("EMWaver") && !current.localizedCaseInsensitiveContains("EMWaver") {
            return candidate
        }
        return current.count <= candidate.count ? current : candidate
    }

    private func transportSortKey(_ transport: LocalDeviceDescriptor.TransportKind) -> Int {
        switch transport {
        case .usbMidi:
            return 0
        case .usbSerial:
            return 1
        case .ble:
            return 2
        case .wifi:
            return 3
        }
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

    static func parsedWiFiPort(_ value: String) -> Int? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let port = Int(trimmed), (1...65535).contains(port) else {
            return nil
        }
        return port
    }
}
