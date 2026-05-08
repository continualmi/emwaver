import Security
import SwiftUI

struct DeviceConnectionSheet: View {
    @ObservedObject var device: MacUSBManager
    @ObservedObject var firmwareUpdater: FirmwareUpdateManager
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var wifiHost: String = ""
    @State private var wifiPort: String = "3922"
    @State private var wifiPairingSecret: String = ""
    @State private var wifiSSID: String = ""
    @State private var wifiPassword: String = ""
    @State private var wifiHostname: String = ""

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
        if firmwareUpdater.espBootloaderConnected || firmwareUpdater.espBootloaderPort != nil {
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
        if let port = firmwareUpdater.espBootloaderPort, !port.isEmpty {
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
        if isEspBoard && (firmwareUpdater.espBootloaderConnected || firmwareUpdater.espBootloaderPort != nil) {
            items.append(("MCU", currentBoardDisplayName))
        } else if device.isConnected {
            items.append(("MCU", currentBoardDisplayName))
        }
        return items
    }

    private var currentBoardType: String {
        if firmwareUpdater.espBootloaderConnected || firmwareUpdater.espBootloaderPort != nil {
            return "esp32s3"
        }
        return device.connectedBoardType ?? device.lastDetectedBoardType ?? "stm32f042"
    }

    private var isEspBoard: Bool {
        currentBoardType.caseInsensitiveCompare("esp32s3") == .orderedSame
    }

    private var currentBoardDisplayName: String {
        switch currentBoardType.lowercased() {
        case "esp32s3":
            return "ESP32-S3"
        case "stm32f042":
            return "STM32F042"
        default:
            return currentBoardType.uppercased()
        }
    }

    private var needsFirmwareInstall: Bool {
        false
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
                overviewCard
                deviceListCard
                wifiCard
                bleCard
            }
            .padding(24)
        }
        .frame(minWidth: 560, idealWidth: 620, minHeight: 480, idealHeight: 560)
        .onAppear {
            if wifiPairingSecret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                wifiPairingSecret = Self.generatePairingSecret()
            }
            firmwareUpdater.refreshDfuPresence(includeEspSerialProbe: true)
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
                }

                if !deviceMetadata.isEmpty {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 132), spacing: 14)], alignment: .leading, spacing: 8) {
                        ForEach(deviceMetadata, id: \.label) { item in
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
                }
            }

            Spacer(minLength: 0)

            Button("Close") { dismiss() }
                .buttonStyle(.bordered)
        }
    }

    private var overviewCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(deviceStatusText)
                .foregroundStyle(.secondary)

            HStack(spacing: 10) {
                Button(isEspBoard ? "Flash firmware" : "Update firmware") {
                    firmwareUpdater.present(boardType: currentBoardType)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(!device.isConnected && !firmwareUpdater.dfuConnected && !firmwareUpdater.espBootloaderConnected && firmwareUpdater.espBootloaderPort == nil)

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

    private var deviceListCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("Local devices", systemImage: "list.bullet.rectangle")
                    .font(.headline)

                Spacer()

                Button("Refresh") {
                    device.refreshPorts()
                    if device.bluetoothStateText == "On" {
                        device.startBleScan()
                    }
                }
                .buttonStyle(.bordered)
            }

            if device.discoveredDevices.isEmpty {
                Text("No EMWaver devices discovered yet. Enter a Wi-Fi address, start BLE scan, or connect a USB MIDI board.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 8) {
                    ForEach(device.discoveredDevices) { item in
                        HStack(spacing: 12) {
                            Image(systemName: transportIcon(for: item.transport))
                                .foregroundStyle(item.isActive ? Color.green : .secondary)
                                .frame(width: 20)

                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 8) {
                                    Text(item.moduleLabel?.isEmpty == false ? item.moduleLabel! : item.displayName)
                                        .font(.subheadline.weight(.medium))
                                        .lineLimit(1)
                                    if item.isActive {
                                        Text("Active")
                                            .font(.caption2.weight(.semibold))
                                            .foregroundStyle(.green)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(Capsule().fill(Color.green.opacity(0.12)))
                                    }
                                }
                                Text(deviceDetailText(for: item))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }

                            Spacer(minLength: 0)

                            Button(deviceActionTitle(for: item)) {
                                device.connectDevice(id: item.id)
                            }
                            .buttonStyle(.bordered)
                            .disabled(item.isActive || item.connectionState == .connecting || item.lastErrorText == "Pairing required")
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

    private var wifiCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("Wi-Fi", systemImage: "wifi")
                    .font(.headline)

                Spacer()

                Text(device.connectedTransportKind == "Wi-Fi" ? "Connected" : "LAN or VPN")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(device.connectedTransportKind == "Wi-Fi" ? Color.green : .secondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(Color.secondary.opacity(0.12)))
            }

            if isEspBoard && device.connectedTransportKind != "Wi-Fi" {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Provision ESP32-S3")
                        .font(.subheadline.weight(.semibold))

                    Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 10) {
                        GridRow {
                            TextField("SSID", text: $wifiSSID)
                                .textFieldStyle(.roundedBorder)
                                .frame(minWidth: 250)

                            TextField("Hostname", text: $wifiHostname)
                                .textFieldStyle(.roundedBorder)
                                .frame(minWidth: 180)
                        }

                        GridRow {
                            SecureField("Wi-Fi password", text: $wifiPassword)
                                .textFieldStyle(.roundedBorder)

                            SecureField("Pairing secret", text: $wifiPairingSecret)
                                .textFieldStyle(.roundedBorder)
                        }
                    }

                    HStack(spacing: 10) {
                        Button(device.isWiFiProvisioning ? "Provisioning" : "Send Wi-Fi Setup") {
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

                        Button("Clear Setup") {
                            device.clearWiFiProvisioning(hostname: wifiHostname)
                        }
                        .buttonStyle(.bordered)
                        .disabled(device.isWiFiProvisioning ||
                                  !device.isConnected ||
                                  device.connectedTransportKind == "Wi-Fi")

                        Button("Status") {
                            device.refreshWiFiProvisioningStatus()
                        }
                        .buttonStyle(.bordered)
                        .disabled(device.isWiFiProvisioning ||
                                  !device.isConnected ||
                                  device.connectedTransportKind == "Wi-Fi")

                        if let status = device.wifiProvisioningStatus, !status.isEmpty {
                            Text(status)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                    }
                }
                .padding(.bottom, 4)
            }

            Divider()

            Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 10) {
                GridRow {
                    TextField("Host or IP", text: $wifiHost)
                        .textFieldStyle(.roundedBorder)
                        .frame(minWidth: 250)

                    TextField("Port", text: $wifiPort)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 82)
                }

                GridRow {
                    SecureField("Pairing secret", text: $wifiPairingSecret)
                        .textFieldStyle(.roundedBorder)
                        .gridCellColumns(2)
                }
            }

            HStack(spacing: 10) {
                Button("Connect Wi-Fi") {
                    device.connectWiFi(
                        host: wifiHost,
                        port: Int(wifiPort) ?? 3922,
                        pairingSecret: wifiPairingSecret
                    )
                }
                .buttonStyle(.borderedProminent)
                .disabled(wifiHost.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                          wifiPairingSecret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Text("Manual IP works when mDNS does not cross a user-owned VPN.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.secondary.opacity(0.08)))
    }

    private var bleCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("Bluetooth LE", systemImage: "antenna.radiowaves.left.and.right")
                    .font(.headline)

                Spacer()

                Text(bleStatusText)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(device.isBleScanning ? Color.green : .secondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(Color.secondary.opacity(0.12)))
            }

            if showsBluetoothUnavailableNotice {
                HStack(alignment: .center, spacing: 12) {
                    Label(bluetoothUnavailableText, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.orange)
                }
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.orange.opacity(0.12))
                )
            }

            HStack(spacing: 10) {
                if device.bluetoothStateText == "On" {
                    Button(device.isBleScanning ? "Stop scan" : "Start scan") {
                        if device.isBleScanning {
                            device.stopBleScan()
                        } else {
                            device.startBleScan()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                } else {
                    Button("Open Bluetooth Settings") {
                        if let url = URL(string: "x-apple.systempreferences:com.apple.BluetoothSettings") {
                            openURL(url)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }

                Toggle("Auto connect", isOn: $device.autoConnectEnabled)
                    .toggleStyle(.checkbox)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.secondary.opacity(0.08)))
    }

    private func deviceActionTitle(for item: LocalDeviceDescriptor) -> String {
        if item.isActive { return "Active" }
        if item.lastErrorText == "Pairing required" { return "Pair" }
        if item.connectionState == .connected { return "Select" }
        if item.connectionState == .connecting { return "Connecting" }
        return "Connect"
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
        let pairingText = item.lastErrorText == "Pairing required" ? " · pairing required" : ""
        return "\(item.transport.rawValue) · \(item.boardType ?? "Unknown") · \(item.connectionState.rawValue)\(pairingText)"
    }

    private var bleStatusText: String {
        if device.connectedTransportKind == "BLE" {
            return "Connected"
        }
        if device.bluetoothStateText != "On" {
            return "Bluetooth \(device.bluetoothStateText.lowercased())"
        }
        if device.isBleScanning {
            return "Scanning"
        }
        return "Idle"
    }

    private var showsBluetoothUnavailableNotice: Bool {
        !device.isConnected && device.bluetoothStateText != "On" && device.bluetoothStateText != "Starting"
    }

    private var bluetoothUnavailableText: String {
        switch device.bluetoothStateText {
        case "Off":
            return "Bluetooth is off. Turn it on to discover ESP32 BLE devices."
        case "Not authorized":
            return "Bluetooth access is not authorized for EMWaver."
        case "Unsupported":
            return "Bluetooth LE is not available on this Mac."
        default:
            return "Bluetooth is not ready, so EMWaver cannot scan for BLE devices."
        }
    }

    private var deviceStatusText: String {
        if needsFirmwareInstall {
            return "This device can be updated with managed EMWaver firmware for the best local runtime compatibility."
        }
        if isEspBoard && (firmwareUpdater.espBootloaderConnected || firmwareUpdater.espBootloaderPort != nil) {
            return "This ESP32-S3 is in bootloader mode and can be flashed with the latest bundled EMWaver firmware."
        }
        return "This device is ready for local scripts and hardware control."
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
