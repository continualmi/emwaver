/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import SwiftUI

struct ISMView: View {
    @EnvironmentObject var bleManager: USBManager

    @State private var cc1101Initialized = false

    @State private var registers: [String: String] = [:]
    @State private var rfParams: RfParameters?
    @State private var statusMessage: String = ""

    @State private var showLoading = false
    @State private var loadingCancelled = false
    @State private var loadingProgress: Double = 0.0
    @State private var totalLoadSteps: Int = 0
    @State private var completedLoadSteps: Int = 0
    @State private var currentCommand: String = "Preparing..."

    @State private var editTarget: EditTarget?
    @State private var editValue: String = ""
    @State private var editMode: EditMode = .hex
    @State private var editAllowDecimal: Bool = false

    private enum EditMode {
        case hex
        case number
    }

    private struct EditTarget: Identifiable {
        let id: String
        let title: String
        let kind: Kind

        enum Kind {
            case register(name: String, address: UInt8)
            case paTable(index: Int)
            case rfParam(key: RfParamKey)
        }
    }

    private enum RfParamKey {
        case frequencyMHz
        case dataRate
        case bandwidth
        case deviation
    }

    private struct RfParameters {
        var frequencyMHz: Double
        var dataRate: Int
        var bandwidth: Double
        var deviation: Int
        var modulation: Int
        var txPower: Int
    }

    private static let cc1101PaTableSize = 8
    private static let cc1101PaTableAddr: UInt8 = 0x3E

    private static let cc1101FxtalHz = 26_000_000.0
    private static let cc1101RegFreq2: UInt8 = 0x0D
    private static let cc1101RegFreq1: UInt8 = 0x0E
    private static let cc1101RegFreq0: UInt8 = 0x0F
    private static let cc1101RegMdmcfg4: UInt8 = 0x10
    private static let cc1101RegMdmcfg3: UInt8 = 0x11
    private static let cc1101RegMdmcfg2: UInt8 = 0x12
    private static let cc1101RegDeviatn: UInt8 = 0x15
    private static let cc1101RegFrend0: UInt8 = 0x22

    private static let cc1101Mod2Fsk = 0
    private static let cc1101ModGfsk = 1
    private static let cc1101ModAsk = 3
    private static let cc1101Mod4Fsk = 4
    private static let cc1101ModMsk = 7

    private static let cc1101ModulationOptions: [(label: String, value: Int)] = [
        ("2-FSK", cc1101Mod2Fsk),
        ("GFSK", cc1101ModGfsk),
        ("ASK/OOK", cc1101ModAsk),
        ("4-FSK", cc1101Mod4Fsk),
        ("MSK", cc1101ModMsk),
    ]

    private static let cc1101PowerLevelsDbm = [-30, -20, -15, -10, 0, 5, 7, 10]
    private static let cc1101PowerSetting315Mhz: [UInt8] = [0x12, 0x0D, 0x1C, 0x34, 0x51, 0x85, 0xCB, 0xC2]
    private static let cc1101PowerSetting433Mhz: [UInt8] = [0x12, 0x0E, 0x1D, 0x34, 0x60, 0x84, 0xC8, 0xC0]
    private static let cc1101PowerSetting868Mhz: [UInt8] = [0x03, 0x0F, 0x1E, 0x27, 0x50, 0x81, 0xCB, 0xC2]
    private static let cc1101PowerSetting915Mhz: [UInt8] = [0x03, 0x0E, 0x1E, 0x27, 0x8E, 0xCD, 0xC7, 0xC0]

    private static let cc1101ConfigRegisters: [(name: String, addr: UInt8)] = [
        ("IOCFG2", 0x00),
        ("IOCFG1", 0x01),
        ("IOCFG0", 0x02),
        ("FIFOTHR", 0x03),
        ("SYNC1", 0x04),
        ("SYNC0", 0x05),
        ("PKTLEN", 0x06),
        ("PKTCTRL1", 0x07),
        ("PKTCTRL0", 0x08),
        ("ADDR", 0x09),
        ("CHANNR", 0x0A),
        ("FSCTRL1", 0x0B),
        ("FSCTRL0", 0x0C),
        ("FREQ2", 0x0D),
        ("FREQ1", 0x0E),
        ("FREQ0", 0x0F),
        ("MDMCFG4", 0x10),
        ("MDMCFG3", 0x11),
        ("MDMCFG2", 0x12),
        ("MDMCFG1", 0x13),
        ("MDMCFG0", 0x14),
        ("DEVIATN", 0x15),
        ("MCSM2", 0x16),
        ("MCSM1", 0x17),
        ("MCSM0", 0x18),
        ("FOCCFG", 0x19),
        ("BSCFG", 0x1A),
        ("AGCCTRL2", 0x1B),
        ("AGCCTRL1", 0x1C),
        ("AGCCTRL0", 0x1D),
        ("WOREVT1", 0x1E),
        ("WOREVT0", 0x1F),
        ("WORCTRL", 0x20),
        ("FREND1", 0x21),
        ("FREND0", 0x22),
        ("FSCAL3", 0x23),
        ("FSCAL2", 0x24),
        ("FSCAL1", 0x25),
        ("FSCAL0", 0x26),
        ("RCCTRL1", 0x27),
        ("RCCTRL0", 0x28),
        ("FSTEST", 0x29),
        ("PTEST", 0x2A),
        ("AGCTEST", 0x2B),
        ("TEST2", 0x2C),
        ("TEST1", 0x2D),
        ("TEST0", 0x2E),
    ]

    private static let cc1101StatusRegisters: [(name: String, addr: UInt8)] = [
        ("PARTNUM", 0x30),
        ("VERSION", 0x31),
        ("FREQEST", 0x32),
        ("LQI", 0x33),
        ("RSSI", 0x34),
        ("MARCSTATE", 0x35),
        ("WORTIME1", 0x36),
        ("WORTIME0", 0x37),
        ("PKTSTATUS", 0x38),
        ("VCO_VC_DAC", 0x39),
        ("TXBYTES", 0x3A),
        ("RXBYTES", 0x3B),
        ("RCCTRL1_STATUS", 0x3C),
        ("RCCTRL0_STATUS", 0x3D),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header

                Button(action: loadAll) {
                    Text("Initialize & Read")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!bleManager.isConnected)

                Text("TX power updates PATABLE[0] and PATABLE[1] for ASK/OOK.")
                    .font(.caption)
                    .foregroundColor(.secondary)

                if !statusMessage.isEmpty {
                    Text(statusMessage)
                        .font(.caption)
                        .foregroundColor(.orange)
                }

                rfParametersSection
                registersSection
            }
            .padding()
        }
        .sheet(isPresented: $showLoading) {
            LoadingDialogView(
                title: "Initializing CC1101",
                progress: loadingProgress,
                completedSteps: completedLoadSteps,
                totalSteps: max(totalLoadSteps, 1),
                currentCommand: currentCommand,
                onCancel: {
                    loadingCancelled = true
                    showLoading = false
                }
            )
        }
        .sheet(item: $editTarget) { target in
            editSheet(target: target)
        }
        .onAppear {
            statusMessage = bleManager.isConnected ? "" : "Not connected"
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("ISM")
                .font(.title2)
                .fontWeight(.semibold)
            Text("CC1101 control and registers")
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
    }

    private var rfParametersSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("RF Parameters")
                .font(.headline)

            LabeledRow(label: "Frequency (MHz)", value: rfParams.map { String(format: "%.6f", $0.frequencyMHz) } ?? "--") {
                openEditNumber(title: "Frequency (MHz)", initial: rfParams.map { String(format: "%.6f", $0.frequencyMHz) } ?? "", allowDecimal: true, kind: .rfParam(key: .frequencyMHz))
            }

            LabeledRow(label: "Data Rate (bps)", value: rfParams.map { "\($0.dataRate)" } ?? "--") {
                openEditNumber(title: "Data Rate (bps)", initial: rfParams.map { "\($0.dataRate)" } ?? "", allowDecimal: false, kind: .rfParam(key: .dataRate))
            }

            LabeledRow(label: "Bandwidth (kHz)", value: rfParams.map { String(format: "%.1f", $0.bandwidth) } ?? "--") {
                openEditNumber(title: "Bandwidth (kHz)", initial: rfParams.map { String(format: "%.1f", $0.bandwidth) } ?? "", allowDecimal: true, kind: .rfParam(key: .bandwidth))
            }

            LabeledRow(label: "Deviation (Hz)", value: rfParams.map { "\($0.deviation)" } ?? "--") {
                openEditNumber(title: "Deviation (Hz)", initial: rfParams.map { "\($0.deviation)" } ?? "", allowDecimal: false, kind: .rfParam(key: .deviation))
            }

            Picker("Modulation", selection: Binding(get: {
                rfParams?.modulation ?? Self.cc1101ModulationOptions.first?.value ?? 0
            }, set: { newValue in
                guard var params = rfParams else { return }
                Task { await setModulationAndPower(modulation: newValue, power: params.txPower) }
                params.modulation = newValue
                rfParams = params
            })) {
                ForEach(Self.cc1101ModulationOptions, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }
            .disabled(rfParams == nil)

            Picker("TX Power (dBm)", selection: Binding(get: {
                rfParams?.txPower ?? Self.cc1101PowerLevelsDbm.first ?? 0
            }, set: { newValue in
                guard var params = rfParams else { return }
                Task { await setModulationAndPower(modulation: params.modulation, power: newValue) }
                params.txPower = newValue
                rfParams = params
            })) {
                ForEach(Self.cc1101PowerLevelsDbm, id: \.self) { value in
                    Text("\(value)").tag(value)
                }
            }
            .disabled(rfParams == nil)
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private var registersSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Registers")
                .font(.headline)

            Text("Config")
                .font(.caption)
                .foregroundColor(.secondary)
            registerGrid(names: Self.cc1101ConfigRegisters.map { $0.name })

            Text("Status")
                .font(.caption)
                .foregroundColor(.secondary)
            registerGrid(names: Self.cc1101StatusRegisters.map { $0.name })

            Text("PA Table")
                .font(.caption)
                .foregroundColor(.secondary)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(0..<Self.cc1101PaTableSize, id: \.self) { idx in
                    let name = "PA_TABLE\(idx)"
                    registerCell(name: name, value: registers[name] ?? "--") {
                        editTarget = EditTarget(id: name, title: "Edit \(name)", kind: .paTable(index: idx))
                        editValue = registers[name] ?? ""
                        editMode = .hex
                        editAllowDecimal = false
                    }
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private func registerGrid(names: [String]) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            ForEach(names, id: \.self) { name in
                registerCell(name: name, value: registers[name] ?? "--") {
                    guard let addr = (Self.cc1101ConfigRegisters.first { $0.name == name }?.addr) ?? (Self.cc1101StatusRegisters.first { $0.name == name }?.addr) else {
                        return
                    }
                    editTarget = EditTarget(id: name, title: "Edit \(name)", kind: .register(name: name, address: addr))
                    editValue = registers[name] ?? ""
                    editMode = .hex
                    editAllowDecimal = false
                }
            }
        }
    }

    private func registerCell(name: String, value: String, onTap: @escaping () -> Void) -> some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(value)
                    .font(.system(.body, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(8)
            .background(Color(.tertiarySystemBackground))
            .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }

    private func openEditNumber(title: String, initial: String, allowDecimal: Bool, kind: EditTarget.Kind) {
        editTarget = EditTarget(id: title, title: title, kind: kind)
        editValue = initial
        editMode = .number
        editAllowDecimal = allowDecimal
    }

    private func editSheet(target: EditTarget) -> some View {
        NavigationView {
            Form {
                Section(target.title) {
                    TextField("", text: $editValue)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(true)
                        .font(.system(.body, design: .monospaced))
                }
            }
            .navigationTitle(target.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { editTarget = nil }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await applyEdit(target: target) } }
                }
            }
        }
    }

    private func applyEdit(target: EditTarget) async {
        let value = editValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if editMode == .hex && !value.isEmpty && !value.allSatisfy({ $0.isHexDigit }) {
            statusMessage = "Invalid hexadecimal value."
            return
        }
        if editMode == .number {
            let ok = editAllowDecimal
                ? value.range(of: #"^[0-9]+(\.[0-9]+)?$"#, options: .regularExpression) != nil
                : value.range(of: #"^[0-9]+$"#, options: .regularExpression) != nil
            if !ok {
                statusMessage = "Invalid number value."
                return
            }
        }

        do {
            let service = try ensureCc1101Service()
            switch target.kind {
            case .register(_, let address):
                let parsed = UInt8(value, radix: 16) ?? 0
                try service.writeReg(address, value: parsed)
                let confirm = try service.readReg(address)
                registers[target.id] = String(format: "%02X", confirm)
            case .paTable(let index):
                let parsed = UInt8(value, radix: 16) ?? 0
                var table = try service.readBurst(Self.cc1101PaTableAddr, len: Self.cc1101PaTableSize)
                guard index >= 0 && index < table.count else { return }
                table[index] = parsed
                try service.writeBurst(Self.cc1101PaTableAddr, bytes: table)
                let verify = try service.readBurst(Self.cc1101PaTableAddr, len: Self.cc1101PaTableSize)
                for idx in 0..<min(verify.count, Self.cc1101PaTableSize) {
                    registers["PA_TABLE\(idx)"] = String(format: "%02X", verify[idx])
                }
            case .rfParam(let key):
                guard var params = rfParams else { return }
                switch key {
                case .frequencyMHz:
                    let freq = Double(value) ?? 0
                    _ = try cc1101SetFrequencyMHz(service: service, frequencyMHz: freq)
                    params.frequencyMHz = try cc1101GetFrequencyMHz(service: service)
                case .dataRate:
                    let rate = Int(value) ?? 0
                    _ = try cc1101SetDataRate(service: service, bitRate: rate)
                    params.dataRate = try cc1101GetDataRate(service: service)
                case .bandwidth:
                    let bw = Double(value) ?? 0
                    _ = try cc1101SetBandwidth(service: service, bandwidthKHz: bw)
                    params.bandwidth = try cc1101GetBandwidthKHz(service: service)
                case .deviation:
                    let dev = Int(value) ?? 0
                    _ = try cc1101SetDeviation(service: service, deviationHz: dev)
                    params.deviation = try cc1101GetDeviation(service: service)
                }
                rfParams = params
            }
            editTarget = nil
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    private func loadAll() {
        guard bleManager.isConnected else {
            statusMessage = "Not connected"
            return
        }

        loadingCancelled = false
        showLoading = true
        loadingProgress = 0
        completedLoadSteps = 0

        totalLoadSteps = Self.cc1101ConfigRegisters.count + Self.cc1101StatusRegisters.count + Self.cc1101PaTableSize + 6

        Task.detached(priority: .userInitiated) {
            do {
                let service = try await ensureCc1101ServiceAsync()

                var completed = 0
                var nextRegisters: [String: String] = [:]

                for reg in Self.cc1101ConfigRegisters {
                    if await MainActor.run(resultType: Bool.self, body: { loadingCancelled }) { return }
                    await MainActor.run { currentCommand = "cc1101 read 0x\(String(format: "%02X", reg.addr))" }
                    let value = try service.readReg(reg.addr)
                    nextRegisters[reg.name] = String(format: "%02X", value)
                    completed += 1
                    await setProgress(completed: completed)
                }

                for reg in Self.cc1101StatusRegisters {
                    if await MainActor.run(resultType: Bool.self, body: { loadingCancelled }) { return }
                    await MainActor.run { currentCommand = "cc1101 read 0x\(String(format: "%02X", reg.addr))" }
                    let value = try service.readReg(reg.addr)
                    nextRegisters[reg.name] = String(format: "%02X", value)
                    completed += 1
                    await setProgress(completed: completed)
                }

                await MainActor.run { currentCommand = "cc1101 read_burst PATABLE" }
                let pa = try service.readBurst(Self.cc1101PaTableAddr, len: Self.cc1101PaTableSize)
                for idx in 0..<min(pa.count, Self.cc1101PaTableSize) {
                    nextRegisters["PA_TABLE\(idx)"] = String(format: "%02X", pa[idx])
                    completed += 1
                    await setProgress(completed: completed)
                }

                await MainActor.run { currentCommand = "Reading RF parameters" }
                let params = try readRfParameters(service: service)
                completed += 6
                await setProgress(completed: completed)

                await MainActor.run {
                    registers = nextRegisters
                    rfParams = params
                    statusMessage = "Settings loaded successfully"
                    showLoading = false
                    currentCommand = "Preparing..."
                }
            } catch {
                await MainActor.run {
                    statusMessage = "Failed to load settings: \(error.localizedDescription)"
                    showLoading = false
                    currentCommand = "Preparing..."
                }
            }
        }
    }

    @MainActor
    private func setProgress(completed: Int) {
        completedLoadSteps = completed
        let total = max(totalLoadSteps, 1)
        loadingProgress = Double(min(completed, total)) / Double(total)
    }

    private func ensureCc1101Service() throws -> CC1101Service {
        if !bleManager.isConnected {
            throw CC1101Service.CC1101Error.notConnected
        }
        let service = CC1101Service(bleManager: bleManager)
        if !cc1101Initialized {
            try service.openDevice()
            cc1101Initialized = true
        }
        return service
    }

    private func ensureCc1101ServiceAsync() async throws -> CC1101Service {
        try await MainActor.run {
            try ensureCc1101Service()
        }
    }

    private func readRfParameters(service: CC1101Service) throws -> RfParameters {
        let freq = try cc1101GetFrequencyMHz(service: service)
        let rate = try cc1101GetDataRate(service: service)
        let bw = try cc1101GetBandwidthKHz(service: service)
        let dev = try cc1101GetDeviation(service: service)
        let mod = try cc1101GetModulation(service: service)
        let pwr = try cc1101GetPowerLevel(service: service)
        return RfParameters(frequencyMHz: freq, dataRate: rate, bandwidth: bw, deviation: dev, modulation: mod, txPower: pwr)
    }

    private func setModulationAndPower(modulation: Int, power: Int) async {
        do {
            let service = try await ensureCc1101ServiceAsync()
            let ok = try cc1101SetModulationAndPower(service: service, modulation: modulation, dbm: power)
            if !ok {
                await MainActor.run { statusMessage = "Failed to update modulation/power." }
            }
        } catch {
            await MainActor.run { statusMessage = error.localizedDescription }
        }
    }

    private func cc1101GetFrequencyMHz(service: CC1101Service) throws -> Double {
        let freq2 = Double(try service.readReg(Self.cc1101RegFreq2))
        let freq1 = Double(try service.readReg(Self.cc1101RegFreq1))
        let freq0 = Double(try service.readReg(Self.cc1101RegFreq0))
        let word = (freq2 * 65536.0) + (freq1 * 256.0) + freq0
        return (word * (Self.cc1101FxtalHz / pow(2.0, 16.0))) / 1e6
    }

    private func cc1101SetFrequencyMHz(service: CC1101Service, frequencyMHz: Double) throws -> Bool {
        let word = Int(round((frequencyMHz * 1e6 * pow(2.0, 16.0)) / Self.cc1101FxtalHz))
        try service.writeReg(Self.cc1101RegFreq2, value: UInt8((word >> 16) & 0xff))
        try service.writeReg(Self.cc1101RegFreq1, value: UInt8((word >> 8) & 0xff))
        try service.writeReg(Self.cc1101RegFreq0, value: UInt8(word & 0xff))
        try service.strobe(54)
        try service.strobe(51)
        let confirm = try cc1101GetFrequencyMHz(service: service)
        return abs(confirm - frequencyMHz) < 0.001
    }

    private func cc1101GetDataRate(service: CC1101Service) throws -> Int {
        let mdmcfg4 = Int(try service.readReg(Self.cc1101RegMdmcfg4))
        let drateE = mdmcfg4 & 0x0f
        let drateM = Int(try service.readReg(Self.cc1101RegMdmcfg3))
        let bitRate = (Double(256 + drateM) * pow(2.0, Double(drateE)) * Self.cc1101FxtalHz) / pow(2.0, 28.0)
        return Int(round(bitRate))
    }

    private func cc1101SetDataRate(service: CC1101Service, bitRate: Int) throws -> Bool {
        guard bitRate > 0 else { return false }
        let target = (Double(bitRate) * pow(2.0, 28.0)) / Self.cc1101FxtalHz
        var bestM = 0
        var bestE = 0
        var bestDiff = Double.greatestFiniteMagnitude
        for e in 0...15 {
            for m in 0...255 {
                let current = Double(256 + m) * pow(2.0, Double(e))
                let diff = abs(current - target)
                if diff < bestDiff {
                    bestDiff = diff
                    bestM = m
                    bestE = e
                }
            }
        }
        let current = Int(try service.readReg(Self.cc1101RegMdmcfg4))
        let bandwidthPart = current & 0xf0
        let newMdmcfg4 = UInt8((bandwidthPart | (bestE & 0x0f)) & 0xff)
        let newMdmcfg3 = UInt8(bestM & 0xff)
        try service.writeBurst(Self.cc1101RegMdmcfg4, bytes: [newMdmcfg4, newMdmcfg3])
        let confirm = try service.readBurst(Self.cc1101RegMdmcfg4, len: 2)
        return confirm.count == 2 && confirm[0] == newMdmcfg4 && confirm[1] == newMdmcfg3
    }

    private func cc1101GetBandwidthKHz(service: CC1101Service) throws -> Double {
        let v = Int(try service.readReg(Self.cc1101RegMdmcfg4))
        let bwExp = (v >> 6) & 0x03
        let bwMant = (v >> 4) & 0x03
        let bandwidthHz = Self.cc1101FxtalHz / (8.0 * (Double(4 + bwMant)) * pow(2.0, Double(bwExp)))
        return bandwidthHz / 1000.0
    }

    private func cc1101SetBandwidth(service: CC1101Service, bandwidthKHz: Double) throws -> Bool {
        guard bandwidthKHz > 0 else { return false }
        let targetHz = bandwidthKHz * 1000.0
        var bestExp = 0
        var bestMant = 0
        var bestDiff = Double.greatestFiniteMagnitude
        for exp in 0...3 {
            for mant in 0...3 {
                let bwHz = Self.cc1101FxtalHz / (8.0 * (Double(4 + mant)) * pow(2.0, Double(exp)))
                let diff = abs(bwHz - targetHz)
                if diff < bestDiff {
                    bestDiff = diff
                    bestExp = exp
                    bestMant = mant
                }
            }
        }
        let current = Int(try service.readReg(Self.cc1101RegMdmcfg4))
        let drateE = current & 0x0f
        let newMdmcfg4 = UInt8(((bestExp << 6) | (bestMant << 4) | drateE) & 0xff)
        try service.writeReg(Self.cc1101RegMdmcfg4, value: newMdmcfg4)
        let confirm = try service.readReg(Self.cc1101RegMdmcfg4)
        return confirm == newMdmcfg4
    }

    private func cc1101GetDeviation(service: CC1101Service) throws -> Int {
        let v = Int(try service.readReg(Self.cc1101RegDeviatn))
        let deviationM = v & 0x07
        let deviationE = (v >> 4) & 0x07
        let deviationHz = (Double(8 + deviationM) * pow(2.0, Double(deviationE))) * (Self.cc1101FxtalHz / pow(2.0, 17.0))
        return Int(round(deviationHz))
    }

    private func cc1101SetDeviation(service: CC1101Service, deviationHz: Int) throws -> Bool {
        guard deviationHz > 0 else { return false }
        var bestE = 0
        var bestM = 0
        var bestDiff = Double.greatestFiniteMagnitude
        for e in 0...7 {
            for m in 0...7 {
                let current = (Double(8 + m) * pow(2.0, Double(e))) * (Self.cc1101FxtalHz / pow(2.0, 17.0))
                let diff = abs(current - Double(deviationHz))
                if diff < bestDiff {
                    bestDiff = diff
                    bestE = e
                    bestM = m
                }
            }
        }
        let value = UInt8(((bestE << 4) | (bestM & 0x07)) & 0xff)
        try service.writeReg(Self.cc1101RegDeviatn, value: value)
        let confirm = try service.readReg(Self.cc1101RegDeviatn)
        return confirm == value
    }

    private func cc1101GetModulation(service: CC1101Service) throws -> Int {
        let mdmcfg2 = Int(try service.readReg(Self.cc1101RegMdmcfg2))
        return (mdmcfg2 >> 4) & 0x07
    }

    private func cc1101GetPowerLevel(service: CC1101Service) throws -> Int {
        let frequencyMHz = try cc1101GetFrequencyMHz(service: service)
        let powerSettings: [UInt8]
        if frequencyMHz >= 300 && frequencyMHz <= 348 {
            powerSettings = Self.cc1101PowerSetting315Mhz
        } else if frequencyMHz >= 378 && frequencyMHz <= 464 {
            powerSettings = Self.cc1101PowerSetting433Mhz
        } else if frequencyMHz >= 779 && frequencyMHz <= 899.99 {
            powerSettings = Self.cc1101PowerSetting868Mhz
        } else if frequencyMHz >= 900 && frequencyMHz <= 928 {
            powerSettings = Self.cc1101PowerSetting915Mhz
        } else {
            return 0
        }
        let modulation = try cc1101GetModulation(service: service)
        let pa = try service.readBurst(Self.cc1101PaTableAddr, len: 2)
        guard pa.count >= 2 else { return 0 }
        let current = (modulation == Self.cc1101ModAsk ? pa[1] : pa[0]) & 0xff
        for (idx, setting) in powerSettings.enumerated() where idx < Self.cc1101PowerLevelsDbm.count {
            if setting == current {
                return Self.cc1101PowerLevelsDbm[idx]
            }
        }
        var closestIndex = 0
        var smallestDiff = Int.max
        for (idx, setting) in powerSettings.enumerated() where idx < Self.cc1101PowerLevelsDbm.count {
            let diff = abs(Int(setting) - Int(current))
            if diff < smallestDiff {
                smallestDiff = diff
                closestIndex = idx
            }
        }
        return Self.cc1101PowerLevelsDbm[closestIndex]
    }

    private func cc1101SetModulationAndPower(service: CC1101Service, modulation: Int, dbm: Int) throws -> Bool {
        let frequencyMHz = try cc1101GetFrequencyMHz(service: service)
        guard let powerIndex = Self.cc1101PowerLevelsDbm.firstIndex(of: dbm) else { return false }
        let powerSettings: [UInt8]
        if frequencyMHz >= 300 && frequencyMHz <= 348 {
            powerSettings = Self.cc1101PowerSetting315Mhz
        } else if frequencyMHz >= 378 && frequencyMHz <= 464 {
            powerSettings = Self.cc1101PowerSetting433Mhz
        } else if frequencyMHz >= 779 && frequencyMHz <= 899.99 {
            powerSettings = Self.cc1101PowerSetting868Mhz
        } else if frequencyMHz >= 900 && frequencyMHz <= 928 {
            powerSettings = Self.cc1101PowerSetting915Mhz
        } else {
            return false
        }
        let powerSetting = powerSettings[powerIndex]
        let currentMdmcfg2 = Int(try service.readReg(Self.cc1101RegMdmcfg2))
        let newMdmcfg2 = UInt8(((currentMdmcfg2 & 0x0f) | ((modulation & 0x07) << 4)) & 0xff)
        let frend0: UInt8 = modulation == Self.cc1101ModAsk ? 0x11 : 0x10
        try service.writeReg(Self.cc1101RegMdmcfg2, value: newMdmcfg2)
        try service.writeReg(Self.cc1101RegFrend0, value: frend0)
        var paTable = Array(repeating: UInt8(0), count: Self.cc1101PaTableSize)
        if modulation == Self.cc1101ModAsk {
            paTable[1] = powerSetting
        } else {
            paTable[0] = powerSetting
        }
        try service.writeBurst(Self.cc1101PaTableAddr, bytes: paTable)
        let confirmMdmcfg2 = try service.readReg(Self.cc1101RegMdmcfg2)
        let confirmFrend0 = try service.readReg(Self.cc1101RegFrend0)
        return confirmMdmcfg2 == newMdmcfg2 && confirmFrend0 == frend0
    }
}

private struct LabeledRow: View {
    let label: String
    let value: String
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack {
                Text(label)
                    .foregroundColor(.secondary)
                Spacer()
                Text(value)
                    .font(.system(.body, design: .monospaced))
            }
        }
        .buttonStyle(.plain)
    }
}

