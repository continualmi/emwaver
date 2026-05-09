import Security
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
    private static let wifiHostnameDefaultsKey = "emwaver.wifi.setup.hostname"
    private static let wifiPasswordKeychainAccount = "emwaver.wifi.setup.password"

    @ObservedObject var device: MacUSBManager
    @ObservedObject var firmwareUpdater: FirmwareUpdateManager
    @Binding var selectedDeviceID: String?
    @Environment(\.dismiss) private var dismiss
    @State private var wifiHost: String = ""
    @State private var wifiPort: String = "3922"
    @State private var wifiPairingSecret: String = ""
    @State private var wifiSSID: String = ""
    @State private var wifiPassword: String = ""
    @State private var wifiHostname: String = ""
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
            return ("Connected", "cable.connector")
        }
        if espBootloaderAvailable {
            return ("ESP Bootloader", "cpu")
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
            return "esp32"
        }
        return device.lastDetectedBoardType ?? "stm32f042"
    }

    private var espBootloaderAvailable: Bool {
        !device.isConnected && (firmwareUpdater.espBootloaderConnected || firmwareUpdater.espBootloaderPort != nil)
    }

    private var isEspBoard: Bool {
        switch currentBoardType.lowercased() {
        case "esp32", "esp32s2", "esp32s3":
            return true
        default:
            return false
        }
    }

    private var shouldShowWiFiCard: Bool {
        isEspBoard && device.connectedTransportKind != "Wi-Fi"
    }

    private var currentBoardDisplayName: String {
        switch currentBoardType.lowercased() {
        case "esp32":
            return "ESP32"
        case "esp32s2":
            return "ESP32-S2"
        case "esp32s3":
            return "ESP32-S3"
        case "stm32f042":
            return "STM32F042"
        default:
            return currentBoardType.uppercased()
        }
    }

    private static func generatePairingSecret() -> String {
        var bytes = [UInt8](repeating: 0, count: 24)
        if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess {
            return bytes.map { String(format: "%02x", $0) }.joined()
        }
        return UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                deviceListCard
                if shouldShowWiFiCard {
                    wifiCard
                }
                firmwareCard
            }
            .padding(24)
        }
        .frame(minWidth: 560, idealWidth: 620, minHeight: 480, idealHeight: 560)
        .onAppear {
            loadWiFiFormState()
            if wifiPairingSecret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                wifiPairingSecret = Self.generatePairingSecret()
            }
            if wifiHostname.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                wifiHostname = MacUSBManager.generatedWiFiHostname()
            }
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
        .onChange(of: wifiHostname) { _ in
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
        wifiHostname = UserDefaults.standard.string(forKey: Self.wifiHostnameDefaultsKey) ?? wifiHostname
        wifiPassword = (try? KeychainStore.getString(account: Self.wifiPasswordKeychainAccount)) ?? wifiPassword
    }

    private func saveWiFiFormState() {
        UserDefaults.standard.set(wifiSSID, forKey: Self.wifiSSIDDefaultsKey)
        UserDefaults.standard.set(wifiHost, forKey: Self.wifiHostDefaultsKey)
        UserDefaults.standard.set(wifiPort, forKey: Self.wifiPortDefaultsKey)
        UserDefaults.standard.set(wifiHostname, forKey: Self.wifiHostnameDefaultsKey)
        do {
            try KeychainStore.setString(wifiPassword, account: Self.wifiPasswordKeychainAccount)
        } catch {
            // Form persistence is a convenience; provisioning should still work if Keychain is unavailable.
        }
    }

    private var header: some View {
        HStack {
            Spacer(minLength: 0)
            Button("Close") { dismiss() }
                .buttonStyle(.bordered)
        }
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

                if let status = device.wifiProvisioningStatus, !status.isEmpty {
                    Text(status)
                        .font(.caption)
                        .foregroundStyle(device.isWiFiProvisioningError ? Color.orange : .secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            Spacer(minLength: 12)

            Button("Set Up Wi-Fi") {
                isWiFiSetupPresented = true
            }
            .buttonStyle(.borderedProminent)
            .disabled(!device.isConnected || device.connectedTransportKind == "Wi-Fi")
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
                    Text("Send network credentials and the local pairing secret over the current USB or BLE connection.")
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

                    TextField("Hostname", text: $wifiHostname)
                        .textFieldStyle(.roundedBorder)
                }

                GridRow {
                    SecureField("Wi-Fi password", text: $wifiPassword)
                        .textFieldStyle(.roundedBorder)

                    SecureField("Pairing secret", text: $wifiPairingSecret)
                        .textFieldStyle(.roundedBorder)
                }
            }

            ViewThatFits(in: .horizontal) {
                wifiProvisioningActions
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        wifiSendSetupButton
                        wifiClearSetupButton
                    }
                    HStack(spacing: 10) {
                        wifiResetPairingButton
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
            wifiResetPairingButton
            wifiStatusButton
        }
    }

    private var wifiSendSetupButton: some View {
        Button(device.isWiFiProvisioning ? "Provisioning" : "Send Wi-Fi Setup") {
            saveWiFiFormState()
            device.provisionWiFi(
                ssid: wifiSSID,
                password: wifiPassword,
                pairingSecret: wifiPairingSecret,
                hostname: wifiHostname
            )
        }
        .buttonStyle(.bordered)
        .disabled(device.isWiFiProvisioning ||
                  !device.isConnected ||
                  device.connectedTransportKind == "Wi-Fi" ||
                  wifiSSID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                  wifiPairingSecret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    private var wifiClearSetupButton: some View {
        Button("Clear Setup") {
            device.clearWiFiProvisioning(hostname: wifiHostname)
        }
        .buttonStyle(.bordered)
        .disabled(device.isWiFiProvisioning ||
                  !device.isConnected ||
                  device.connectedTransportKind == "Wi-Fi")
    }

    private var wifiResetPairingButton: some View {
        Button("Reset Pairing") {
            device.resetWiFiPairing(
                pairingSecret: wifiPairingSecret,
                hostname: wifiHostname,
                pairingHost: wifiHost
            )
        }
        .buttonStyle(.bordered)
        .disabled(device.isWiFiProvisioning ||
                  !device.isConnected ||
                  device.connectedTransportKind == "Wi-Fi" ||
                  wifiPairingSecret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    private var wifiStatusButton: some View {
        Button("Status") {
            device.refreshWiFiProvisioningStatus()
        }
        .buttonStyle(.bordered)
        .disabled(device.isWiFiProvisioning ||
                  !device.isConnected ||
                  device.connectedTransportKind == "Wi-Fi")
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
                Text(isEspBoard ? "Flash the bundled ESP32 firmware." : "Update the connected board firmware.")
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
        if item.lastErrorText == "Pairing required" { return "Pair \(prefix)" }
        if item.connectionState == .connected { return "Use \(prefix)" }
        if item.connectionState == .connecting { return "\(prefix) Connecting" }
        return "Use \(prefix)"
    }

    private func isTransportActionDisabled(_ item: LocalDeviceDescriptor) -> Bool {
        item.connectionState == .connecting || item.lastErrorText == "Pairing required"
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
        case .usbMidi:
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
        return uid.isEmpty ? nil : uid
    }

    private func groupTitleCandidate(for item: LocalDeviceDescriptor) -> String {
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
        case .ble:
            return 1
        case .wifi:
            return 2
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
