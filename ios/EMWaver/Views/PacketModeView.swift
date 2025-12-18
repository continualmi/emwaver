import SwiftUI

struct PacketModeView: View {
    @EnvironmentObject private var bleManager: BLEManager

    private enum Modulation: String, CaseIterable, Identifiable {
        case ask = "ASK"
        case gfsK = "GFSK"
        case fsk2 = "2FSK"
        case fsk4 = "4FSK"
        case msk = "MSK"

        var id: String { rawValue }

        var firmwareValue: Int {
            switch self {
            case .fsk2: return 0
            case .gfsK: return 1
            case .ask: return 3
            case .fsk4: return 4
            case .msk: return 7
            }
        }
    }

    @State private var frequencyMHz = "433.92"
    @State private var dataRateBps = "2500"
    @State private var powerDbm = "10"
    @State private var modulation: Modulation = .ask
    @State private var syncWord = "CB 8A"
    @State private var payloadHex = "32 CC CC CB 4D 2D 4A D3 4C AB 4B 15 96 65 99 99 96 9A 5A 95 A6 99 56 96 2B 2C CB 33 33 2D 34 B5 2B 4D 32 AD 28"
    @State private var txDelayMs = "50"

    @State private var statusText = ""
    @State private var statusIsError = false
    @State private var logText = ""
    @State private var isBusy = false

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if !bleManager.isConnected {
                    HStack {
                        Circle().fill(.red).frame(width: 10, height: 10)
                        Text("Not Connected")
                            .font(.subheadline)
                        Spacer()
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(8)
                }

                GroupBox(label: Label("Radio", systemImage: "dot.radiowaves.left.and.right")) {
                    VStack(spacing: 12) {
                        HStack {
                            LabeledContent("Frequency (MHz)") {
                                TextField("433.92", text: $frequencyMHz)
                                    .keyboardType(.decimalPad)
                                    .multilineTextAlignment(.trailing)
                                    .textFieldStyle(.roundedBorder)
                                    .frame(width: 120)
                            }
                        }
                        HStack {
                            LabeledContent("Data rate (bps)") {
                                TextField("2500", text: $dataRateBps)
                                    .keyboardType(.numberPad)
                                    .multilineTextAlignment(.trailing)
                                    .textFieldStyle(.roundedBorder)
                                    .frame(width: 120)
                            }
                        }
                        HStack {
                            LabeledContent("Modulation") {
                                Picker("Modulation", selection: $modulation) {
                                    ForEach(Modulation.allCases) { item in
                                        Text(item.rawValue).tag(item)
                                    }
                                }
                                .pickerStyle(.menu)
                            }
                        }
                        HStack {
                            LabeledContent("Power (dBm)") {
                                TextField("10", text: $powerDbm)
                                    .keyboardType(.numberPad)
                                    .multilineTextAlignment(.trailing)
                                    .textFieldStyle(.roundedBorder)
                                    .frame(width: 120)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }

                GroupBox(label: Label("Packet", systemImage: "shippingbox")) {
                    VStack(spacing: 12) {
                        LabeledContent("Sync (2 bytes)") {
                            TextField("CB 8A", text: $syncWord)
                                .textInputAutocapitalization(.characters)
                                .autocorrectionDisabled()
                                .multilineTextAlignment(.trailing)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 140)
                        }
                        LabeledContent("TX delay (ms)") {
                            TextField("50", text: $txDelayMs)
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 120)
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            Text("TX payload (hex)")
                                .font(.subheadline)
                            TextEditor(text: $payloadHex)
                                .font(.system(.body, design: .monospaced))
                                .frame(minHeight: 120)
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(.separator)))
                        }
                    }
                    .padding(.vertical, 4)
                }

                HStack(spacing: 12) {
                    Button("Init") { Task { await initRadio() } }
                        .buttonStyle(.bordered)
                        .disabled(isBusy || !bleManager.isConnected)
                    Button("Start RX") { Task { await startRx() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(isBusy || !bleManager.isConnected)
                    Button("Poll RX") { Task { await pollRx() } }
                        .buttonStyle(.bordered)
                        .disabled(isBusy || !bleManager.isConnected)
                }

                HStack(spacing: 12) {
                    Button("Send TX") { Task { await sendTx() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(isBusy || !bleManager.isConnected)
                    Button("Clear Log") { logText = "" }
                        .buttonStyle(.bordered)
                }

                if !statusText.isEmpty {
                    Text(statusText)
                        .foregroundColor(statusIsError ? .red : .green)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(statusIsError ? Color.red.opacity(0.1) : Color.green.opacity(0.1))
                        .cornerRadius(8)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("Log")
                        .font(.subheadline)
                    ScrollView {
                        Text(logText.isEmpty ? "—" : logText)
                            .font(.system(.footnote, design: .monospaced))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                    }
                    .frame(minHeight: 160, maxHeight: 240)
                    .background(Color.black)
                    .foregroundColor(.white)
                    .cornerRadius(8)
                }
            }
            .padding()
        }
        .navigationTitle("Packet Mode")
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if isBusy {
                ProgressView()
                    .progressViewStyle(.circular)
                    .padding(24)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }

    // MARK: - Actions

    private func initRadio() async {
        await runBusy("Init") { service in
            try service.initialize()
            try applyConfiguration(service: service)
        }
    }

    private func startRx() async {
        await runBusy("Start RX") { service in
            try applyConfiguration(service: service)
            try service.strobe(0x36) // SIDLE
            try service.strobe(0x3A) // SFRX
            try service.strobe(0x34) // SRX
        }
    }

    private func pollRx() async {
        await runBusy("Poll RX") { service in
            let rxBytes = try service.readReg(0x3B) // RXBYTES
            let count = Int(rxBytes & 0x7F)
            guard count > 0 else {
                appendLog("[RX] No data")
                return
            }
            let data = try service.readBurst(0x3F, len: count) // RXFIFO
            try service.strobe(0x3A) // SFRX
            try service.strobe(0x34) // SRX
            let hex = data.map { String(format: "%02X", $0) }.joined(separator: " ")
            appendLog("[RX] \(hex)")
        }
    }

    private func sendTx() async {
        await runBusy("Send TX") { service in
            try applyConfiguration(service: service)

            let payload = parseHexBytes(payloadHex)
            guard !payload.isEmpty else {
                throw NSError(domain: "PacketMode", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid payload hex."])
            }

            try service.writeReg(0x08, value: 0x00) // PKTCTRL0 fixed length
            try service.writeReg(0x06, value: UInt8(payload.count & 0xFF)) // PKTLEN

            try service.strobe(0x36) // SIDLE
            try service.strobe(0x3B) // SFTX
            try service.writeBurst(0x3F, bytes: payload) // TXFIFO
            try service.strobe(0x35) // STX

            let delay = max(0, Int(txDelayMs) ?? 50)
            Thread.sleep(forTimeInterval: Double(delay) / 1000.0)

            try service.strobe(0x36) // SIDLE
            try service.strobe(0x3B) // SFTX
        }
    }

    private func applyConfiguration(service: CC1101Service) throws {
        let freq = Double(frequencyMHz.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 433.92
        let rate = Int(dataRateBps.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 2500
        let power = Int(powerDbm.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 10

        try service.writeReg(0x08, value: 0x00) // PKTCTRL0 fixed length packet mode

        let sync = parseHexBytes(syncWord)
        if sync.count >= 2 {
            try service.writeReg(0x04, value: sync[0]) // SYNC1
            try service.writeReg(0x05, value: sync[1]) // SYNC0
        }

        try service.setFrequencyMHz(freq)
        try service.setDataRate(rate)
        try service.setModulationAndPower(modulation: modulation.firmwareValue, dbm: power)
    }

    private func parseHexBytes(_ input: String) -> [UInt8] {
        let cleaned = input.uppercased().filter { ("0"..."9").contains($0) || ("A"..."F").contains($0) }
        guard cleaned.count % 2 == 0 else { return [] }
        var bytes: [UInt8] = []
        bytes.reserveCapacity(cleaned.count / 2)
        var index = cleaned.startIndex
        while index < cleaned.endIndex {
            let next = cleaned.index(index, offsetBy: 2)
            let byteStr = String(cleaned[index..<next])
            if let value = UInt8(byteStr, radix: 16) {
                bytes.append(value)
            } else {
                return []
            }
            index = next
        }
        return bytes
    }

    private func appendLog(_ line: String) {
        if logText.isEmpty {
            logText = line
        } else {
            logText += "\n" + line
        }
    }

    private func setStatus(_ message: String, isError: Bool) {
        statusText = message
        statusIsError = isError
    }

    private func runBusy(_ label: String, action: @escaping (CC1101Service) throws -> Void) async {
        guard bleManager.isConnected else {
            setStatus("Not connected", isError: true)
            return
        }

        await MainActor.run {
            isBusy = true
            setStatus("\(label)…", isError: false)
        }

        let result: Result<Void, Error> = await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let service = CC1101Service(bleManager: bleManager)
                do {
                    try action(service)
                    continuation.resume(returning: .success(()))
                } catch {
                    continuation.resume(returning: .failure(error))
                }
            }
        }

        await MainActor.run {
            isBusy = false
            switch result {
            case .success:
                setStatus("\(label) complete", isError: false)
                appendLog("[\(label)] OK")
            case .failure(let error):
                setStatus("\(label) failed: \(error.localizedDescription)", isError: true)
                appendLog("[\(label)] ERR: \(error.localizedDescription)")
            }
        }
    }
}

#Preview {
    NavigationView {
        PacketModeView()
            .environmentObject(BLEManager())
    }
}
