import SwiftUI

struct DeviceConnectionSheet: View {
    @ObservedObject var device: MacUSBManager
    @ObservedObject var firmwareUpdater: FirmwareUpdateManager
    @Environment(\.dismiss) private var dismiss

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
        if device.isBleScanning {
            return ("Scanning for BLE", "antenna.radiowaves.left.and.right")
        }
        return ("Disconnected", "cable.connector.slash")
    }

    private var statusChips: [String] {
        var items: [String] = []
        if let port = device.connectedPortName, !port.isEmpty {
            items.append(port)
        }
        if let port = firmwareUpdater.espBootloaderPort, !port.isEmpty {
            items.append(port)
        }
        if device.isConnected, let version = device.deviceEmwaverVersion, !version.isEmpty {
            items.append("EMWaver \(version)")
        }
        if device.isConnected, let transport = device.connectedTransportKind, !transport.isEmpty {
            items.append(transport)
        } else if device.isBleScanning {
            items.append("BLE scan")
        }
        if isEspBoard && (firmwareUpdater.espBootloaderConnected || firmwareUpdater.espBootloaderPort != nil) {
            items.append("ESP32-S3")
        } else if device.isConnected {
            if needsFirmwareInstall {
                items.append("Needs firmware")
            } else {
                items.append("Local")
            }
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
            }
            .padding(24)
        }
        .frame(minWidth: 560, idealWidth: 620, minHeight: 480, idealHeight: 560)
        .onAppear {
            firmwareUpdater.refreshDfuPresence()
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
