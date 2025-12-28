import SwiftUI
import UniformTypeIdentifiers
import UIKit

struct FlashView: View {
    @EnvironmentObject var bleManager: BLEManager

    @State private var isPickingFirmware = false
    @State private var firmwareName: String? = nil
    @State private var firmwareSize: Int? = nil
    @State private var firmwareData: Data? = nil
    @State private var showWifiHelp = false

    private var binType: UTType { UTType(filenameExtension: "bin") ?? .data }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                GroupBox(label: Label("Connection", systemImage: "antenna.radiowaves.left.and.right").font(.headline)) {
                    VStack(spacing: 10) {
                        Button(action: {
                            if bleManager.isConnected {
                                bleManager.disconnect()
                            } else {
                                bleManager.startScan()
                            }
                        }) {
                            HStack {
                                Image(systemName: bleManager.isConnected ? "antenna.radiowaves.left.and.right.slash" : "antenna.radiowaves.left.and.right")
                                Text(bleManager.isConnected ? "Disconnect" : "Connect to EMWaver")
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(bleManager.isConnected ? Color.red.opacity(0.8) : Color.blue.opacity(0.8))
                            .foregroundColor(.white)
                            .cornerRadius(10)
                        }

                        HStack {
                            Image("TabEMWaver")
                                .renderingMode(.template)
                                .resizable()
                                .scaledToFit()
                                .frame(width: 20, height: 20)
                                .foregroundStyle(bleManager.isConnected ? Color.green : Color.gray)
                            Circle()
                                .fill(bleManager.isConnected ? Color.green : Color.gray)
                                .frame(width: 12, height: 12)
                            Text(bleManager.isConnected ? "Connected" : "Not connected")
                                .font(.subheadline)
                                .foregroundColor(bleManager.isConnected ? .green : .gray)
                            Spacer()
                        }
                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal)

                GroupBox(label: Label("Firmware", systemImage: "doc").font(.headline)) {
                    VStack(spacing: 12) {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(firmwareName ?? "No firmware selected")
                                    .font(.subheadline)
                                    .foregroundColor(firmwareName == nil ? .gray : .primary)
                                if let firmwareSize {
                                    Text("\(firmwareSize) bytes")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                            Spacer()
                            Button("Select .bin") {
                                isPickingFirmware = true
                            }
                        }
                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal)

                GroupBox(label: Label("OTA Flash", systemImage: "arrow.up.circle").font(.headline)) {
                    VStack(spacing: 12) {
                        Picker("Transport", selection: $bleManager.otaTransport) {
                            ForEach(BLEManager.OtaTransport.allCases) { transport in
                                Text(transport.rawValue).tag(transport)
                            }
                        }
                        .pickerStyle(.segmented)

                        if bleManager.otaTransport == .wifi {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Wi‑Fi SoftAP OTA (faster)")
                                    .font(.subheadline)
                                Text("1) Connect over BLE\n2) Tap Start Wi‑Fi OTA Mode\n3) Join Wi‑Fi 'EMWaver-OTA'\n4) Flash")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                HStack(spacing: 10) {
                                    Button("Start Wi‑Fi OTA Mode") {
                                        Task {
                                            do {
                                                try await bleManager.otaWifiStartMode()
                                            } catch {
                                                await MainActor.run {
                                                    bleManager.otaErrorText = error.localizedDescription
                                                }
                                            }
                                        }
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .disabled(!bleManager.isConnected || bleManager.otaIsFlashing)

                                    Button("Wi‑Fi Settings") {
                                        if let url = URL(string: UIApplication.openSettingsURLString) {
                                            UIApplication.shared.open(url)
                                        }
                                    }
                                    .buttonStyle(.bordered)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        if bleManager.otaIsFlashing {
                            ProgressView(value: bleManager.otaProgress)
                                .progressViewStyle(.linear)
                            Text(bleManager.otaStatusText.isEmpty ? "Flashing…" : bleManager.otaStatusText)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        } else if !bleManager.otaStatusText.isEmpty {
                            Text(bleManager.otaStatusText)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }

                        if let err = bleManager.otaErrorText, !err.isEmpty {
                            Text(err)
                                .font(.caption)
                                .foregroundColor(.red)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        Button(action: startOta) {
                            HStack {
                                Image(systemName: "arrow.up.circle.fill")
                                Text(bleManager.otaIsFlashing ? "Flashing…" : "Flash Firmware")
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(Color.green.opacity(0.85))
                            .foregroundColor(.white)
                            .cornerRadius(10)
                        }
                        .disabled(!canFlash)
                        if bleManager.otaTransport == .wifi && !bleManager.isConnected {
                            Text("Tip: keep BLE connected to receive final success status.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal)
            }
            .padding(.vertical)
        }
        .navigationTitle("Flash")
        .navigationBarTitleDisplayMode(.inline)
        .fileImporter(
            isPresented: $isPickingFirmware,
            allowedContentTypes: [binType],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                guard let url = urls.first else { return }
                readFirmware(from: url)
            case .failure(let error):
                bleManager.otaErrorText = error.localizedDescription
            }
        }
    }

    private var canFlash: Bool {
        let hasFirmware = firmwareData != nil
        let isBusy = bleManager.otaIsFlashing
        if bleManager.otaTransport == .ble {
            return bleManager.isConnected && hasFirmware && !isBusy
        }
        return hasFirmware && !isBusy
    }

    private func readFirmware(from url: URL) {
        let didStart = url.startAccessingSecurityScopedResource()
        defer {
            if didStart {
                url.stopAccessingSecurityScopedResource()
            }
        }

        do {
            let data = try Data(contentsOf: url)
            firmwareData = data
            firmwareName = url.lastPathComponent
            firmwareSize = data.count
            bleManager.otaErrorText = nil
        } catch {
            firmwareData = nil
            firmwareName = nil
            firmwareSize = nil
            bleManager.otaErrorText = error.localizedDescription
        }
    }

    private func startOta() {
        guard let firmwareData else { return }
        bleManager.otaErrorText = nil
        Task {
            do {
                if bleManager.otaTransport == .ble {
                    try await bleManager.otaFlashFirmware(firmwareData)
                } else {
                    try await bleManager.otaFlashFirmwareWifi(firmwareData)
                }
            } catch {
                await MainActor.run {
                    bleManager.otaIsFlashing = false
                    bleManager.otaErrorText = error.localizedDescription
                }
            }
        }
    }
}

#Preview {
    NavigationView {
        FlashView()
            .environmentObject(BLEManager())
    }
}
