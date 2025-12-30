import SwiftUI
import Combine

struct EMWaverView: View {
    @EnvironmentObject var bleManager: BLEManager
    @Binding var selection: String

    @State private var commandInput = ""
    @FocusState private var isCommandFieldFocused: Bool

    @State private var firmwareVersion = "Unknown"

    @State private var showTxHex = false
    @State private var showRxHex = false
    @State private var bufferEntries: [BufferEntry] = []
    @State private var rxIndex: UInt64 = 0
    @State private var txIndex: UInt64 = 0
    @State private var entrySeq: UInt64 = 0
    @State private var showingSettingsSheet = false

    private let timerPublisher = Timer.publish(every: 0.5, on: .main, in: .common)
    @State private var timerSubscription: AnyCancellable?

    private static let maxMonitorEntries = 1500
    private static let packetSizeBytes = 64

    private static let monitorBackground = Color(red: 2/255, green: 6/255, blue: 23/255) // slate-950
    private static let monitorBorder = Color.white.opacity(0.10)
    private static let monitorTextPrimary = Color(red: 226/255, green: 232/255, blue: 240/255) // slate-200
    private static let monitorTextSecondary = Color(red: 148/255, green: 163/255, blue: 184/255) // slate-400
    private static let txColor = Color(red: 250/255, green: 204/255, blue: 21/255) // amber-400
    private static let rxColor = Color(red: 34/255, green: 197/255, blue: 94/255) // green-500

    struct BufferEntry: Identifiable {
        let id: UInt64
        let data: Data
        let timestampMs: UInt64
        let timeStr: String
        let isTx: Bool
        let ascii: String
        let hex: String
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                connectionRow
                commandRow
                bufferMonitor
                fragmentsGrid
            }
            .padding(.vertical, 16)
        }
        .background(Color.white)
        .navigationTitle("EMWaver")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button("Settings") { showingSettingsSheet = true }
                    Button("Clear Buffer", role: .destructive) { clearMonitorAndBuffer() }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showingSettingsSheet) {
            SettingsSheet()
        }
        .onAppear {
            timerSubscription = timerPublisher
                .autoconnect()
                .sink { _ in
                    pollBufferMonitor()
                }
        }
        .onChange(of: bleManager.isConnected) { connected in
            if !connected {
                firmwareVersion = "Unknown"
                resetLocalMonitor()
            } else {
                requestFirmwareVersionSoon()
            }
        }
        .onDisappear {
            timerSubscription?.cancel()
            timerSubscription = nil
        }
    }

    private var connectionRow: some View {
        HStack(spacing: 12) {
            Panel {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Circle()
                            .fill(connectionStatusColor)
                            .frame(width: 10, height: 10)
                        Text(connectionStatusText)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        Spacer()
                    }

                    Button {
                        if bleManager.isConnected {
                            bleManager.disconnect()
                        } else {
                            bleManager.startScan()
                        }
                    } label: {
                        HStack {
                            Image(systemName: bleManager.isConnected ? "antenna.radiowaves.left.and.right.slash" : "antenna.radiowaves.left.and.right")
                            Text(bleManager.isConnected ? "Disconnect" : "Connect")
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .center)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(bleManager.isConnected ? .red : .blue)
                }
            }

            Panel {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Firmware")
                        .font(.subheadline)
                        .foregroundColor(.secondary)

                    HStack(spacing: 8) {
                        Text(firmwareVersion)
                            .font(.headline)
                            .foregroundColor(firmwareVersion == "Unknown" ? .secondary : .blue)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)

                        Spacer()

                        Button {
                            requestFirmwareVersion()
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .foregroundColor(.blue)
                        .disabled(!bleManager.isConnected)
                    }
                }
            }
        }
        .padding(.horizontal)
    }

    private var fragmentsGrid: some View {
        let columns = [
            GridItem(.flexible(), spacing: 12),
            GridItem(.flexible(), spacing: 12),
        ]

        return LazyVGrid(columns: columns, spacing: 12) {
            FragmentCard(
                title: "Wavelets",
                subtitle: "Manage and run wavelets",
                systemImage: "puzzlepiece.extension",
                tint: .cyan
            ) { selection = "Wavelets" }

            FragmentCard(
                title: "IDE",
                subtitle: "Not available on iOS",
                systemImage: "terminal",
                tint: .gray,
                isEnabled: false
            ) {}

            FragmentCard(
                title: "ISM (RFM69)",
                subtitle: "Sub‑GHz radio control",
                systemImage: "dot.radiowaves.left.and.right",
                tint: .green
            ) { selection = "ISM" }

            FragmentCard(
                title: "Sampler",
                subtitle: "Signal sampling and analysis",
                systemImage: "waveform.path.ecg",
                tint: .purple
            ) { selection = "Sampler" }

            FragmentCard(
                title: "RFID",
                subtitle: "Read/write tags",
                systemImage: "radiowaves.right",
                tint: .orange
            ) { selection = "RFID" }

            FragmentCard(
                title: "Packet Mode",
                subtitle: "CC1101 fixed packets",
                systemImage: "shippingbox",
                tint: .indigo
            ) { selection = "PacketMode" }

            FragmentCard(
                title: "Flash",
                subtitle: "DFU firmware flashing",
                systemImage: "arrow.up.circle",
                tint: .blue
            ) { selection = "Flash" }

            FragmentCard(
                title: "Template",
                subtitle: "Developer playground",
                systemImage: "square.and.pencil",
                tint: .gray
            ) { selection = "Template" }

            FragmentCard(
                title: "Settings",
                subtitle: "Sampler and RF defaults",
                systemImage: "gearshape",
                tint: .secondary
            ) { selection = "Settings" }
        }
        .padding(.horizontal)
    }

    private var commandRow: some View {
        Panel {
            VStack(alignment: .leading, spacing: 10) {
                Text("Command")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                HStack(spacing: 8) {
                    TextField("e.g. version", text: $commandInput)
                        .textFieldStyle(.roundedBorder)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .focused($isCommandFieldFocused)
                        .onSubmit { sendCommandFromInput() }

                    Button("Send") { sendCommandFromInput() }
                        .buttonStyle(.borderedProminent)
                        .disabled(!bleManager.isConnected || commandInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .padding(.horizontal)
    }

    private var bufferMonitor: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Buffer Monitor")
                        .font(.headline)
                        .foregroundColor(Self.monitorTextPrimary)
                    Spacer()
                    Button("Clear") { clearMonitorAndBuffer() }
                        .foregroundColor(.red)
                }

                HStack(spacing: 12) {
                    Toggle("TX HEX", isOn: $showTxHex)
                    Toggle("RX HEX", isOn: $showRxHex)
                }
                .font(.subheadline)
                .foregroundColor(Self.monitorTextSecondary)
                .tint(.blue)

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 6) {
                        if bufferEntries.isEmpty {
                            Text("No buffer entries yet.")
                                .foregroundColor(Self.monitorTextSecondary)
                                .font(.subheadline)
                                .padding(.vertical, 8)
                        } else {
                            ForEach(bufferEntries) { entry in
                                let content = entry.isTx
                                    ? (showTxHex ? entry.hex : entry.ascii)
                                    : (showRxHex ? entry.hex : entry.ascii)
                                Text("[\(entry.timeStr)] \(entry.isTx ? "TX" : "RX"): \(content)")
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundColor(entry.isTx ? Self.txColor : Self.rxColor)
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                    .padding(.vertical, 6)
                }
                .frame(minHeight: 240, maxHeight: 360)
                .background(Self.monitorBackground.opacity(0.65), in: RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(Self.monitorBorder.opacity(0.8), lineWidth: 1)
                )
            }
        }
        .padding(12)
        .background(Self.monitorBackground, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Self.monitorBorder, lineWidth: 1)
        )
        .padding(.horizontal)
    }

    private var connectionStatusText: String {
        if bleManager.isScanning { return "Scanning…" }
        if bleManager.isConnected { return "Connected" }
        return "Not connected"
    }

    private var connectionStatusColor: Color {
        if bleManager.isScanning { return .orange }
        if bleManager.isConnected { return .green }
        return .red
    }

    private func requestFirmwareVersionSoon() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            requestFirmwareVersion()
        }
    }

    private func requestFirmwareVersion() {
        guard bleManager.isConnected else { return }
        let versionCommand = Data("version".utf8)
        bleManager.sendPacket(versionCommand)
    }

    private func sendCommandFromInput() {
        let trimmed = commandInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard bleManager.isConnected else { return }

        guard let data = BLEManager.parseCommand(trimmed) else {
            commandInput = ""
            return
        }
        bleManager.sendPacket(data)
        commandInput = ""
    }

    private func pollBufferMonitor() {
        guard bleManager.isConnected else { return }

        var batch: [(data: Data, timestampMs: UInt64, isTx: Bool)] = []

        let txResp = bleManager.bufferReadTxSince(packetIndex: txIndex, maxPackets: 64)
        if !txResp.ts_ms.isEmpty, !txResp.data.isEmpty {
            let count = txResp.ts_ms.count
            for p in 0..<count {
                let start = p * Self.packetSizeBytes
                let end = start + Self.packetSizeBytes
                if end <= txResp.data.count {
                    let pkt = Data(txResp.data[start..<end])
                    batch.append((pkt, txResp.ts_ms[p], true))
                }
            }
            txIndex = txResp.next_packet_index
        }

        let rxResp = bleManager.bufferReadPacketsSince(packetIndex: rxIndex, maxPackets: 64)
        if !rxResp.ts_ms.isEmpty, !rxResp.data.isEmpty {
            let count = rxResp.ts_ms.count
            for p in 0..<count {
                let start = p * Self.packetSizeBytes
                let end = start + Self.packetSizeBytes
                if end <= rxResp.data.count {
                    let pkt = Data(rxResp.data[start..<end])
                    batch.append((pkt, rxResp.ts_ms[p], false))
                    updateFirmwareVersionIfNeeded(from: pkt)
                }
            }
            rxIndex = rxResp.next_packet_index
        }

        appendBatchToMonitor(batch)
    }

    private func resetLocalMonitor() {
        bufferEntries.removeAll()
        rxIndex = 0
        txIndex = 0
        entrySeq = 0
    }

    private func clearMonitorAndBuffer() {
        bleManager.bufferClear()
        resetLocalMonitor()
    }

    private func appendBatchToMonitor(_ batch: [(data: Data, timestampMs: UInt64, isTx: Bool)]) {
        guard !batch.isEmpty else { return }

        var built: [BufferEntry] = []
        built.reserveCapacity(batch.count)
        for item in batch {
            let timeStr = Self.formatTimestampMs(item.timestampMs)
            let hex = item.data.map { String(format: "%02X", $0) }.joined(separator: " ")
            let ascii = item.data.map { byte in
                (32...126).contains(Int(byte)) ? String(UnicodeScalar(byte)) : "."
            }.joined()
            built.append(
                BufferEntry(
                    id: entrySeq,
                    data: item.data,
                    timestampMs: item.timestampMs,
                    timeStr: timeStr,
                    isTx: item.isTx,
                    ascii: ascii,
                    hex: hex
                )
            )
            entrySeq += 1
        }

        bufferEntries.append(contentsOf: built)
        bufferEntries.sort { a, b in
            if a.timestampMs != b.timestampMs { return a.timestampMs < b.timestampMs }
            if a.isTx != b.isTx { return a.isTx && !b.isTx }
            return a.id < b.id
        }
        if bufferEntries.count > Self.maxMonitorEntries {
            bufferEntries = Array(bufferEntries.suffix(Self.maxMonitorEntries))
        }
    }

    private func updateFirmwareVersionIfNeeded(from packet: Data) {
        guard firmwareVersion == "Unknown" else { return }

        let trimmed = packet.split(separator: 0, maxSplits: 1, omittingEmptySubsequences: false).first ?? Data()
        let text = String(decoding: trimmed, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        if let match = text.range(of: #"\b\d+\.\d+\.\d+\b"#, options: .regularExpression) {
            firmwareVersion = String(text[match])
        } else if text.contains("Welcome to"), let dash = text.firstIndex(of: "-") {
            let versionPart = text[..<dash].trimmingCharacters(in: .whitespacesAndNewlines)
            if !versionPart.isEmpty {
                firmwareVersion = String(versionPart)
            }
        }
    }

    private static func formatTimestampMs(_ tsMs: UInt64) -> String {
        let date = Date(timeIntervalSince1970: Double(tsMs) / 1000.0)
        return timestampFormatter.string(from: date)
    }

    private static let timestampFormatter: DateFormatter = {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = .current
        df.dateFormat = "HH:mm:ss.SSS"
        return df
    }()
}

private struct Panel<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(12)
            .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(Color.black.opacity(0.08), lineWidth: 1)
            )
    }
}

private struct FragmentCard: View {
    let title: String
    let subtitle: String
    let systemImage: String
    let tint: Color
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: systemImage)
                        .foregroundColor(tint)
                    Spacer()
                }
                Text(title)
                    .font(.headline)
                    .foregroundColor(isEnabled ? .primary : .secondary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, minHeight: 88, alignment: .leading)
            .padding(12)
            .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(isEnabled ? tint.opacity(0.18) : Color.gray.opacity(0.12), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1.0 : 0.55)
    }
}

#Preview {
    NavigationView {
        EMWaverView(selection: .constant("EMWaver"))
            .environmentObject(BLEManager())
    }
}
