import SwiftUI

struct DeviceConnectionSheet: View {
    @ObservedObject var device: MacUSBManager
    @ObservedObject var firmwareUpdater: FirmwareUpdateManager
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    private var statusLabel: (text: String, icon: String) {
        if device.isConnected {
            if device.connectedTransportKind == "BLE" {
                return ("Connected over BLE", "antenna.radiowaves.left.and.right")
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
        if device.isConnected, let transport = device.connectedTransportKind, !transport.isEmpty {
            items.append(("Transport", transport))
        }
        if isEspBoard && (firmwareUpdater.espBootloaderConnected || firmwareUpdater.espBootloaderPort != nil) {
            items.append(("Board", "ESP32-S3"))
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

    private var needsFirmwareInstall: Bool {
        false
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                overviewCard
                bleCard
            }
            .padding(24)
        }
        .frame(minWidth: 560, idealWidth: 620, minHeight: 480, idealHeight: 560)
        .onAppear {
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
                    .disabled(device.isConnected)
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
                    .disabled(device.isConnected)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.secondary.opacity(0.08)))
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
