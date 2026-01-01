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
    @EnvironmentObject var bleManager: BLEManager
    @State private var rfm69: RFM69?
    @State private var selectedChip: RadioChip = .none
    @State private var cc1101Initialized = false
    
    // RF parameter states - no defaults
    @State private var frequency: String = ""
    @State private var dataRate: String = ""
    @State private var bandwidth: String = ""
    @State private var deviation: String = ""
    @State private var selectedModulation: Int = 0
    @State private var selectedPower: Int = 0
    @State private var suppressRfControlCallbacks = false
    
    // Register viewer
    @State private var registerValues: [String: String] = [:]
    @State private var editTarget: RegisterEditTarget?
    @State private var editValue: String = ""
    @State private var editError: String?
    
    // Status
    @State private var statusMessage: String = "Not connected"
    @State private var isLoading: Bool = false
    @State private var isViewActive: Bool = false
    
    // Load dialog state
    @State private var showLoadingAlert: Bool = false
    @State private var isLoadingRegisters: Bool = false
    @State private var registerLoadingProgress: Double = 0.0
    @State private var loadingRegistersCancelled: Bool = false
    @State private var currentCommand: String = "Preparing..."
    @State private var totalLoadSteps: Int = 0
    @State private var completedLoadSteps: Int = 0
    @State private var showingSettingsSheet = false
    
    private enum RadioChip: String, CaseIterable, Identifiable {
        case none = "Select chip..."
        case cc1101 = "CC1101"
        case rfm69 = "RFM69"

        var id: String { rawValue }
    }

    private struct RegisterSpec: Identifiable {
        let name: String
        let address: UInt8

        var id: String { name }
    }

    private struct RegisterEditTarget: Identifiable {
        let name: String
        let address: UInt8
        let isPaTable: Bool
        let paIndex: Int?

        var id: String { name }
    }

    private static let rfParameterSteps = 6
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

    private static let cc1101PowerLevelsDbm = [-30, -20, -15, -10, 0, 5, 7, 10]
    private static let cc1101PowerSetting315Mhz: [UInt8] = [0x12, 0x0D, 0x1C, 0x34, 0x51, 0x85, 0xCB, 0xC2]
    private static let cc1101PowerSetting433Mhz: [UInt8] = [0x12, 0x0E, 0x1D, 0x34, 0x60, 0x84, 0xC8, 0xC0]
    private static let cc1101PowerSetting868Mhz: [UInt8] = [0x03, 0x0F, 0x1E, 0x27, 0x50, 0x81, 0xCB, 0xC2]
    private static let cc1101PowerSetting915Mhz: [UInt8] = [0x03, 0x0E, 0x1E, 0x27, 0x8E, 0xCD, 0xC7, 0xC0]

    private var modulationFormats: [String] {
        switch selectedChip {
        case .cc1101:
            return ["2-FSK", "GFSK", "ASK/OOK", "4-FSK", "MSK"]
        case .rfm69:
            return ["FSK", "OOK"]
        case .none:
            return ["Select..."]
        }
    }

    private var modulationValues: [Int] {
        switch selectedChip {
        case .cc1101:
            return [Self.cc1101Mod2Fsk, Self.cc1101ModGfsk, Self.cc1101ModAsk, Self.cc1101Mod4Fsk, Self.cc1101ModMsk]
        case .rfm69:
            return [RFM69.MOD_FSK, RFM69.MOD_OOK]
        case .none:
            return [0]
        }
    }

    private var powerLevels: [String] {
        switch selectedChip {
        case .cc1101:
            return Self.cc1101PowerLevelsDbm.map { "\($0) dBm" }
        case .rfm69:
            return ["-30 dBm", "-20 dBm", "-15 dBm", "-10 dBm", "0 dBm", "5 dBm", "7 dBm", "10 dBm", "13 dBm", "17 dBm", "20 dBm"]
        case .none:
            return ["Select..."]
        }
    }

    private var powerValues: [Int] {
        switch selectedChip {
        case .cc1101:
            return Self.cc1101PowerLevelsDbm
        case .rfm69:
            return [-30, -20, -15, -10, 0, 5, 7, 10, 13, 17, 20]
        case .none:
            return [0]
        }
    }

    private let rfm69ConfigRegisters: [RegisterSpec] = [
        RegisterSpec(name: "OPMODE", address: 0x01),
        RegisterSpec(name: "DATAMODUL", address: 0x02),
        RegisterSpec(name: "BITRATEMSB", address: 0x03),
        RegisterSpec(name: "BITRATELSB", address: 0x04),
        RegisterSpec(name: "FDEVMSB", address: 0x05),
        RegisterSpec(name: "FDEVLSB", address: 0x06),
        RegisterSpec(name: "FRFMSB", address: 0x07),
        RegisterSpec(name: "FRFMID", address: 0x08),
        RegisterSpec(name: "FRFLSB", address: 0x09),
        RegisterSpec(name: "OSC1", address: 0x0A),
        RegisterSpec(name: "AFCCTRL", address: 0x0B),
        RegisterSpec(name: "LOWBAT", address: 0x0C),
        RegisterSpec(name: "LISTEN1", address: 0x0D),
        RegisterSpec(name: "LISTEN2", address: 0x0E),
        RegisterSpec(name: "LISTEN3", address: 0x0F),
        RegisterSpec(name: "PALEVEL", address: 0x11),
        RegisterSpec(name: "PARAMP", address: 0x12),
        RegisterSpec(name: "OCP", address: 0x13),
        RegisterSpec(name: "LNA", address: 0x18),
        RegisterSpec(name: "RXBW", address: 0x19),
        RegisterSpec(name: "AFCBW", address: 0x1A),
        RegisterSpec(name: "OOKPEAK", address: 0x1B),
        RegisterSpec(name: "OOKAVG", address: 0x1C),
        RegisterSpec(name: "OOKFIX", address: 0x1D),
        RegisterSpec(name: "AFCFEI", address: 0x1E),
        RegisterSpec(name: "AFCMSB", address: 0x1F),
        RegisterSpec(name: "AFCLSB", address: 0x20),
        RegisterSpec(name: "FEIMSB", address: 0x21),
        RegisterSpec(name: "FEILSB", address: 0x22),
        RegisterSpec(name: "RSSICONFIG", address: 0x23),
        RegisterSpec(name: "DIOMAPPING1", address: 0x25),
        RegisterSpec(name: "DIOMAPPING2", address: 0x26),
        RegisterSpec(name: "IRQFLAGS1", address: 0x27),
        RegisterSpec(name: "IRQFLAGS2", address: 0x28),
        RegisterSpec(name: "RSSITHRESH", address: 0x29),
        RegisterSpec(name: "RXTIMEOUT1", address: 0x2A),
        RegisterSpec(name: "RXTIMEOUT2", address: 0x2B),
        RegisterSpec(name: "PREAMBLEMSB", address: 0x2C),
        RegisterSpec(name: "PREAMBLELSB", address: 0x2D),
        RegisterSpec(name: "SYNCCONFIG", address: 0x2E),
        RegisterSpec(name: "PACKETCONFIG1", address: 0x37),
        RegisterSpec(name: "PAYLOADLENGTH", address: 0x38),
        RegisterSpec(name: "NODEADRS", address: 0x39),
        RegisterSpec(name: "BROADCASTADRS", address: 0x3A),
        RegisterSpec(name: "AUTOMODES", address: 0x3B),
        RegisterSpec(name: "FIFOTHRESH", address: 0x3C),
        RegisterSpec(name: "PACKETCONFIG2", address: 0x3D)
    ]

    private let rfm69StatusRegisters: [RegisterSpec] = [
        RegisterSpec(name: "VERSION", address: 0x10),
        RegisterSpec(name: "RSSIVALUE", address: 0x24),
        RegisterSpec(name: "TEMP1", address: 0x4E),
        RegisterSpec(name: "TEMP2", address: 0x4F)
    ]

    private let cc1101ConfigRegisters: [RegisterSpec] = [
        RegisterSpec(name: "IOCFG2", address: 0x00),
        RegisterSpec(name: "IOCFG1", address: 0x01),
        RegisterSpec(name: "IOCFG0", address: 0x02),
        RegisterSpec(name: "FIFOTHR", address: 0x03),
        RegisterSpec(name: "SYNC1", address: 0x04),
        RegisterSpec(name: "SYNC0", address: 0x05),
        RegisterSpec(name: "PKTLEN", address: 0x06),
        RegisterSpec(name: "PKTCTRL1", address: 0x07),
        RegisterSpec(name: "PKTCTRL0", address: 0x08),
        RegisterSpec(name: "ADDR", address: 0x09),
        RegisterSpec(name: "CHANNR", address: 0x0A),
        RegisterSpec(name: "FSCTRL1", address: 0x0B),
        RegisterSpec(name: "FSCTRL0", address: 0x0C),
        RegisterSpec(name: "FREQ2", address: 0x0D),
        RegisterSpec(name: "FREQ1", address: 0x0E),
        RegisterSpec(name: "FREQ0", address: 0x0F),
        RegisterSpec(name: "MDMCFG4", address: 0x10),
        RegisterSpec(name: "MDMCFG3", address: 0x11),
        RegisterSpec(name: "MDMCFG2", address: 0x12),
        RegisterSpec(name: "MDMCFG1", address: 0x13),
        RegisterSpec(name: "MDMCFG0", address: 0x14),
        RegisterSpec(name: "DEVIATN", address: 0x15),
        RegisterSpec(name: "MCSM2", address: 0x16),
        RegisterSpec(name: "MCSM1", address: 0x17),
        RegisterSpec(name: "MCSM0", address: 0x18),
        RegisterSpec(name: "FOCCFG", address: 0x19),
        RegisterSpec(name: "BSCFG", address: 0x1A),
        RegisterSpec(name: "AGCCTRL2", address: 0x1B),
        RegisterSpec(name: "AGCCTRL1", address: 0x1C),
        RegisterSpec(name: "AGCCTRL0", address: 0x1D),
        RegisterSpec(name: "WOREVT1", address: 0x1E),
        RegisterSpec(name: "WOREVT0", address: 0x1F),
        RegisterSpec(name: "WORCTRL", address: 0x20),
        RegisterSpec(name: "FREND1", address: 0x21),
        RegisterSpec(name: "FREND0", address: 0x22),
        RegisterSpec(name: "FSCAL3", address: 0x23),
        RegisterSpec(name: "FSCAL2", address: 0x24),
        RegisterSpec(name: "FSCAL1", address: 0x25),
        RegisterSpec(name: "FSCAL0", address: 0x26),
        RegisterSpec(name: "RCCTRL1", address: 0x27),
        RegisterSpec(name: "RCCTRL0", address: 0x28),
        RegisterSpec(name: "FSTEST", address: 0x29),
        RegisterSpec(name: "PTEST", address: 0x2A),
        RegisterSpec(name: "AGCTEST", address: 0x2B),
        RegisterSpec(name: "TEST2", address: 0x2C),
        RegisterSpec(name: "TEST1", address: 0x2D),
        RegisterSpec(name: "TEST0", address: 0x2E)
    ]

    private let cc1101StatusRegisters: [RegisterSpec] = [
        RegisterSpec(name: "PARTNUM", address: 0x30),
        RegisterSpec(name: "VERSION", address: 0x31),
        RegisterSpec(name: "FREQEST", address: 0x32),
        RegisterSpec(name: "LQI", address: 0x33),
        RegisterSpec(name: "RSSI", address: 0x34),
        RegisterSpec(name: "MARCSTATE", address: 0x35),
        RegisterSpec(name: "WORTIME1", address: 0x36),
        RegisterSpec(name: "WORTIME0", address: 0x37),
        RegisterSpec(name: "PKTSTATUS", address: 0x38),
        RegisterSpec(name: "VCO_VC_DAC", address: 0x39),
        RegisterSpec(name: "TXBYTES", address: 0x3A),
        RegisterSpec(name: "RXBYTES", address: 0x3B),
        RegisterSpec(name: "RCCTRL1_STATUS", address: 0x3C),
        RegisterSpec(name: "RCCTRL0_STATUS", address: 0x3D)
    ]

    private var configRegisters: [RegisterSpec] {
        switch selectedChip {
        case .rfm69:
            return rfm69ConfigRegisters
        case .cc1101:
            return cc1101ConfigRegisters
        case .none:
            return []
        }
    }

    private var statusRegisters: [RegisterSpec] {
        switch selectedChip {
        case .rfm69:
            return rfm69StatusRegisters
        case .cc1101:
            return cc1101StatusRegisters
        case .none:
            return []
        }
    }
    
    // Focus state for keyboard dismissal
    @FocusState private var focusedField: Field?
    
    enum Field: Hashable {
        case frequency
        case dataRate
        case bandwidth
        case deviation
    }
    
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                if !bleManager.isConnected {
                    // Connection status bar shown only when disconnected
                    HStack {
                        Circle()
                            .fill(Color.red)
                            .frame(width: 10, height: 10)
                        Text("Not Connected")
                            .font(.subheadline)
                        Spacer()
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(8)
                    .padding(.horizontal)
                    .padding(.top, 8)
                }

                // ISM UI cards (always visible)
                VStack(spacing: 20) {
                    rfParametersCard
                    
                    // Register viewer section directly below RF parameters
                    registersViewSection
                }
                .padding()

                // Loading indicator
                if isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle())
                        .scaleEffect(1.5)
                        .padding()
                }

                Spacer()
            }
        }
        .onAppear {
            print("ISM View appeared")
            isViewActive = true
            if !bleManager.isConnected {
                statusMessage = "Not connected"
            }
        }
        .onDisappear {
            print("ISM View disappeared")
            isViewActive = false
            // Cancel any ongoing register loading
            loadingRegistersCancelled = true
            // Clear command observer and close SPI device when view disappears
            if let rfm69 = rfm69 {
                rfm69.clearCommandObserver()
                _ = rfm69.closeDevice()
            }
        }
        .onChange(of: bleManager.isConnected) { connected in
            if connected && isViewActive {
                statusMessage = "Connected"
            } else if !connected {
                // Close SPI device when disconnected
                if let rfm69 = rfm69 {
                    _ = rfm69.closeDevice()
                }
                cc1101Initialized = false
                statusMessage = "Not connected"
            }
        }
        .onChange(of: selectedChip) { _ in
            resetForChipSelection()
        }
        .navigationTitle("ISM")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button("Settings") {
                        showingSettingsSheet = true
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") {
                    focusedField = nil
                }
            }
        }
        .sheet(isPresented: $showingSettingsSheet) {
            SettingsSheet()
        }
        .sheet(isPresented: $showLoadingAlert) {
            LoadingDialogView(
                title: "Initializing \(selectedChip == .cc1101 ? "CC1101" : (selectedChip == .rfm69 ? "RFM69" : "Radio"))",
                progress: registerLoadingProgress,
                completedSteps: completedLoadSteps,
                totalSteps: totalLoadSteps,
                currentCommand: currentCommand,
                onCancel: {
                    loadingRegistersCancelled = true
                    isLoadingRegisters = false
                    showLoadingAlert = false
                }
            )
            .interactiveDismissDisabled()
        }
        .sheet(item: $editTarget) { target in
            NavigationView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Edit \(target.name)")
                        .font(.headline)
                    TextField("Hex value", text: $editValue)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .keyboardType(.asciiCapable)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                    if let editError = editError {
                        Text(editError)
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                    Spacer()
                }
                .padding()
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button("Cancel") {
                            editTarget = nil
                            editError = nil
                        }
                    }
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button("Save") {
                            applyEditedRegister(target: target)
                        }
                        .disabled(!isValidHex(editValue))
                    }
                }
            }
        }
    }
    
    // Connection status view
    private var connectionStatus: some View {
        HStack {
            Circle()
                .fill(bleManager.isConnected ? Color.green : Color.red)
                .frame(width: 10, height: 10)
            
            Text(bleManager.isConnected ? "Connected" : "Not Connected")
                .font(.subheadline)
            
            Spacer()
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(8)
        .padding(.horizontal)
    }
    
    // Connection prompt view
    private var connectionPrompt: some View {
        VStack {
            Image(systemName: "antenna.radiowaves.left.and.right")
                .font(.system(size: 60))
                .foregroundColor(.blue)
                .padding()
            
            Text("Connect to an EMWaver device to control the radio.")
                .multilineTextAlignment(.center)
                .padding()
            
            Text(statusMessage)
                .font(.caption)
                .foregroundColor(.secondary)
                .padding()
        }
        .padding()
    }
    
    // RF Parameters Card
    private var rfParametersCard: some View {
        VStack(alignment: .leading, spacing: 15) {
            Text("Radio")
                .font(.headline)
                .padding(.bottom, 5)

            HStack {
                Text("Chip:")
                    .frame(width: 150, alignment: .leading)

                Picker("Chip", selection: $selectedChip) {
                    ForEach(RadioChip.allCases) { chip in
                        Text(chip.rawValue).tag(chip)
                    }
                }
                .pickerStyle(MenuPickerStyle())
            }

            Button("Initialize & Read") {
                startInitialization()
            }
            .buttonStyle(.borderedProminent)
            .disabled(selectedChip == .none || !bleManager.isConnected)

            if selectedChip == .none {
                Text("Select a chip, then tap Initialize & Read.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            if selectedChip == .cc1101 {
                Text("CC1101 notes: TX Power updates PATABLE[0], and PATABLE[1] for ASK/OOK.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Group {
                Text("RF Parameters")
                    .font(.headline)
                    .padding(.top, 6)
                
                // Frequency input
                HStack {
                    Text("Frequency (MHz):")
                        .frame(width: 150, alignment: .leading)
                    
                    TextField("Frequency", text: $frequency)
                        .keyboardType(.decimalPad)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                        .focused($focusedField, equals: .frequency)
                        .submitLabel(.done)
                    
                    Button("Set") {
                        if let freqValue = Double(frequency) {
                            setFrequency(freqValue)
                        }
                        focusedField = nil
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                
                // Data Rate input
                HStack {
                    Text("Data Rate (bps):")
                        .frame(width: 150, alignment: .leading)
                    
                    TextField("Data Rate", text: $dataRate)
                        .keyboardType(.numberPad)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                        .focused($focusedField, equals: .dataRate)
                        .submitLabel(.done)
                    
                    Button("Set") {
                        if let rateValue = Int(dataRate) {
                            setDataRate(rateValue)
                        }
                        focusedField = nil
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                
                // Bandwidth input
                HStack {
                    Text("Bandwidth (kHz):")
                        .frame(width: 150, alignment: .leading)
                    
                    TextField("Bandwidth", text: $bandwidth)
                        .keyboardType(.decimalPad)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                        .focused($focusedField, equals: .bandwidth)
                        .submitLabel(.done)
                    
                    Button("Set") {
                        if let bwValue = Double(bandwidth) {
                            setBandwidth(bwValue)
                        }
                        focusedField = nil
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                
                // Deviation input
                HStack {
                    Text("Deviation (Hz):")
                        .frame(width: 150, alignment: .leading)
                    
                    TextField("Deviation", text: $deviation)
                        .keyboardType(.numberPad)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                        .focused($focusedField, equals: .deviation)
                        .submitLabel(.done)
                    
                    Button("Set") {
                        if let devValue = Int(deviation) {
                            setDeviation(devValue)
                        }
                        focusedField = nil
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                
                // Modulation Picker
                HStack {
                    Text("Modulation Format:")
                        .frame(width: 150, alignment: .leading)
                    
                    Picker("Modulation", selection: $selectedModulation) {
                        ForEach(0..<modulationFormats.count, id: \.self) { index in
                            Text(modulationFormats[index]).tag(index)
                        }
                    }
                    .pickerStyle(MenuPickerStyle())
                    .onChange(of: selectedModulation) { newValue in
                        applyModulationAndPowerFromUi(modulationIndex: newValue, powerIndex: selectedPower)
                    }
                }
                
                // TX Power Picker
                HStack {
                    Text("TX Power:")
                        .frame(width: 150, alignment: .leading)
                    
                    Picker("Power", selection: $selectedPower) {
                        ForEach(0..<powerLevels.count, id: \.self) { index in
                            Text(powerLevels[index]).tag(index)
                        }
                    }
                    .pickerStyle(MenuPickerStyle())
                    .onChange(of: selectedPower) { newValue in
                        applyModulationAndPowerFromUi(modulationIndex: selectedModulation, powerIndex: newValue)
                    }
                }
                
                // Quick controls
                if selectedChip == .rfm69 {
                    HStack {
                        Button("Reset") {
                            resetRadio()
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
            }
            .disabled(selectedChip == .none)
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(10)
    }
    
    // Registers View Section
    private var registersViewSection: some View {
        VStack(alignment: .leading, spacing: 15) {
            Text("\(selectedChip == .cc1101 ? "CC1101" : (selectedChip == .rfm69 ? "RFM69" : "Radio")) Registers")
                .font(.headline)
                .padding(.bottom, 5)

            if selectedChip == .none {
                Text("Select a chip, then tap Initialize & Read.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        Text("Configuration Registers")
                            .font(.subheadline)
                            .padding(.vertical, 4)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        ForEach(configRegisters) { register in
                            registerRow(
                                name: register.name,
                                address: register.address,
                                value: registerValues[register.name] ?? "??",
                                isEditable: true,
                                isPaTable: false,
                                paIndex: nil
                            )
                        }

                        Divider()
                            .padding(.vertical, 4)

                        Text("Status Registers")
                            .font(.subheadline)
                            .padding(.vertical, 4)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        ForEach(statusRegisters) { register in
                            registerRow(
                                name: register.name,
                                address: register.address,
                                value: registerValues[register.name] ?? "??",
                                isEditable: false,
                                isPaTable: false,
                                paIndex: nil
                            )
                        }

                        if selectedChip == .cc1101 {
                            Divider()
                                .padding(.vertical, 4)

                            Text("PA Table")
                                .font(.subheadline)
                                .padding(.vertical, 4)
                                .frame(maxWidth: .infinity, alignment: .leading)

                            ForEach(0..<Self.cc1101PaTableSize, id: \.self) { index in
                                let name = "PA_TABLE\(index)"
                                registerRow(
                                    name: name,
                                    address: Self.cc1101PaTableAddr,
                                    value: registerValues[name] ?? "??",
                                    isEditable: true,
                                    isPaTable: true,
                                    paIndex: index
                                )
                            }
                        }
                    }
                    .padding(.horizontal, 4)
                }
                .frame(height: 400)
                .background(Color(.systemBackground))
                .cornerRadius(8)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(10)
    }
    
    private func registerRow(name: String,
                             address: UInt8,
                             value: String,
                             isEditable: Bool,
                             isPaTable: Bool,
                             paIndex: Int?) -> some View {
        HStack {
            Text(name)
                .font(.headline)
            Spacer()
            Text(String(format: "0x%02X", address))
                .font(.subheadline)
                .foregroundColor(.secondary)
            Spacer()
            Text("0x\(value)")
                .font(.system(.body, design: .monospaced))
                .foregroundColor(isEditable ? .primary : .secondary)
                .onTapGesture {
                    guard isEditable else { return }
                    startEditingRegister(
                        name: name,
                        address: address,
                        isPaTable: isPaTable,
                        paIndex: paIndex,
                        currentValue: value
                    )
                }
        }
    }
    
    // MARK: - Helper Methods

    private func startInitialization() {
        guard bleManager.isConnected else {
            statusMessage = "Not connected"
            return
        }
        guard selectedChip != .none else {
            statusMessage = "Select a chip"
            return
        }
        loadingRegistersCancelled = false
        registerLoadingProgress = 0.0
        completedLoadSteps = 0
        totalLoadSteps = calculateTotalLoadSteps()
        currentCommand = "Preparing..."
        showLoadingAlert = true
        loadAllSettings()
    }

    private func resetForChipSelection() {
        registerValues.removeAll()
        frequency = ""
        dataRate = ""
        bandwidth = ""
        deviation = ""
        selectedModulation = 0
        selectedPower = powerValues.firstIndex(of: 0) ?? 0
        suppressRfControlCallbacks = false
        cc1101Initialized = false
        if selectedChip != .rfm69, let rfm69 = rfm69 {
            _ = rfm69.closeDevice()
        }
        statusMessage = selectedChip == .none ? "Select a chip" : "Ready to initialize"
    }

    private func calculateTotalLoadSteps() -> Int {
        var steps = configRegisters.count + statusRegisters.count
        if selectedChip == .cc1101 {
            steps += Self.cc1101PaTableSize
        }
        if selectedChip != .none {
            steps += Self.rfParameterSteps
        }
        return max(steps, 1)
    }

    private func isValidHex(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        return trimmed.range(of: "^[0-9A-Fa-f]+$", options: .regularExpression) != nil
    }

    private func startEditingRegister(name: String,
                                      address: UInt8,
                                      isPaTable: Bool,
                                      paIndex: Int?,
                                      currentValue: String) {
        editValue = currentValue
        editError = nil
        editTarget = RegisterEditTarget(name: name, address: address, isPaTable: isPaTable, paIndex: paIndex)
    }

    private func applyEditedRegister(target: RegisterEditTarget) {
        let trimmed = editValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isValidHex(trimmed), let byteValue = UInt8(trimmed, radix: 16) else {
            editError = "Enter a valid hex byte."
            return
        }
        editTarget = nil
        editError = nil

        Task.detached(priority: .userInitiated) {
            guard await ensureSelectedChipOpen() else { return }
            switch await MainActor.run { selectedChip } {
            case .rfm69:
                guard let rfm69 = await MainActor.run(resultType: RFM69?.self, body: { self.rfm69 }) else { return }
                rfm69.writeReg(addr: target.address, value: byteValue)
                await MainActor.run {
                    registerValues[target.name] = String(format: "%02X", byteValue)
                    statusMessage = "\(target.name) updated"
                }
            case .cc1101:
                let service = CC1101Service(bleManager: bleManager)
                do {
                    if target.isPaTable, let index = target.paIndex {
                        let table = try service.readBurst(Self.cc1101PaTableAddr, len: Self.cc1101PaTableSize)
                        guard table.count >= Self.cc1101PaTableSize else {
                            await MainActor.run { statusMessage = "Failed to read PA table" }
                            return
                        }
                        var updated = table
                        updated[index] = byteValue
                        try service.writeBurst(Self.cc1101PaTableAddr, bytes: updated)
                        let verify = (try? service.readBurst(Self.cc1101PaTableAddr, len: Self.cc1101PaTableSize)) ?? updated
                        await MainActor.run {
                            for i in 0..<min(verify.count, Self.cc1101PaTableSize) {
                                let key = "PA_TABLE\(i)"
                                registerValues[key] = String(format: "%02X", verify[i])
                            }
                            statusMessage = "PA table updated"
                        }
                    } else {
                        try service.writeReg(target.address, value: byteValue)
                        await MainActor.run {
                            registerValues[target.name] = String(format: "%02X", byteValue)
                            statusMessage = "\(target.name) updated"
                        }
                    }
                } catch {
                    await MainActor.run {
                        statusMessage = "Failed to update \(target.name): \(error.localizedDescription)"
                    }
                }
            case .none:
                return
            }
        }
    }

    private func updateProgress(currentStep: inout Int, totalSteps: Int) async {
        currentStep += 1
        await MainActor.run {
            completedLoadSteps = currentStep
            registerLoadingProgress = Double(currentStep) / Double(totalSteps)
        }
    }

    private func isLoadingCancelled() async -> Bool {
        await MainActor.run(resultType: Bool.self, body: { loadingRegistersCancelled })
    }

    private func ensureSelectedChipOpen() async -> Bool {
        guard await MainActor.run(resultType: Bool.self, body: { bleManager.isConnected }) else {
            await MainActor.run { statusMessage = "Not connected" }
            return false
        }

        switch await MainActor.run(resultType: RadioChip.self, body: { selectedChip }) {
        case .rfm69:
            let rfm69Instance: RFM69 = await MainActor.run {
                if rfm69 == nil {
                    rfm69 = RFM69(bleManager: bleManager)
                }
                return rfm69!
            }
            await MainActor.run { currentCommand = "rfm69 init" }
            if !rfm69Instance.openDevice() {
                await MainActor.run { statusMessage = "Failed to initialize RFM69" }
                return false
            }
            return true
        case .cc1101:
            let service = CC1101Service(bleManager: bleManager)
            let alreadyInitialized = await MainActor.run { cc1101Initialized }
            if !alreadyInitialized {
                await MainActor.run { currentCommand = "cc1101 init" }
                do {
                    try service.openDevice()
                    await MainActor.run { cc1101Initialized = true }
                } catch {
                    await MainActor.run {
                        statusMessage = "Failed to initialize CC1101: \(error.localizedDescription)"
                    }
                    return false
                }
            }
            return true
        case .none:
            await MainActor.run { statusMessage = "Select a chip" }
            return false
        }
    }

    private func loadAllSettings() {
        isLoadingRegisters = true
        registerLoadingProgress = 0.0
        registerValues.removeAll()
        let totalSteps = calculateTotalLoadSteps()

        Task.detached(priority: .userInitiated) {
            let chip = await MainActor.run { selectedChip }
            await MainActor.run {
                totalLoadSteps = totalSteps
                completedLoadSteps = 0
            }
            guard await ensureSelectedChipOpen() else {
                await MainActor.run {
                    showLoadingAlert = false
                    isLoadingRegisters = false
                }
                return
            }

            var currentStep = 0
            var success = true

            switch chip {
            case .rfm69:
                if let rfm69Instance = await MainActor.run(resultType: RFM69?.self, body: { self.rfm69 }) {
                    rfm69Instance.setCommandObserver { command in
                        Task { @MainActor in
                            self.currentCommand = command
                        }
                    }
                    success = await loadRfm69Settings(rfm69: rfm69Instance, totalSteps: totalSteps, currentStep: &currentStep)
                    rfm69Instance.clearCommandObserver()
                } else {
                    success = false
                }
            case .cc1101:
                let service = CC1101Service(bleManager: bleManager)
                success = await loadCc1101Settings(service: service, totalSteps: totalSteps, currentStep: &currentStep)
            case .none:
                success = false
            }

            await MainActor.run {
                registerLoadingProgress = success ? 1.0 : registerLoadingProgress
                completedLoadSteps = success ? totalSteps : completedLoadSteps
                isLoadingRegisters = false
                showLoadingAlert = false
                currentCommand = "Preparing..."
                statusMessage = success ? "Settings loaded successfully" : "Failed to load settings"
            }
        }
    }

    private func loadRfm69Settings(rfm69: RFM69, totalSteps: Int, currentStep: inout Int) async -> Bool {
        if await isLoadingCancelled() { return false }

        let freqValue = rfm69.getFrequency()
        await MainActor.run {
            frequency = String(format: "%.6f", freqValue)
        }
        await updateProgress(currentStep: &currentStep, totalSteps: totalSteps)

        if await isLoadingCancelled() { return false }
        let rateValue = rfm69.getDataRate()
        await MainActor.run {
            dataRate = String(rateValue)
        }
        await updateProgress(currentStep: &currentStep, totalSteps: totalSteps)

        if await isLoadingCancelled() { return false }
        let bwValue = rfm69.getBandwidth()
        await MainActor.run {
            bandwidth = String(format: "%.1f", bwValue)
        }
        await updateProgress(currentStep: &currentStep, totalSteps: totalSteps)

        if await isLoadingCancelled() { return false }
        let devValue = rfm69.getDeviation()
        await MainActor.run {
            deviation = String(devValue)
        }
        await updateProgress(currentStep: &currentStep, totalSteps: totalSteps)

        if await isLoadingCancelled() { return false }
        let modValue = rfm69.getModulation()
        let powValue = rfm69.getPowerLevel()
        await MainActor.run {
            suppressRfControlCallbacks = true
            selectedModulation = modulationValues.firstIndex(of: modValue) ?? 0
            selectedPower = powerValues.firstIndex(of: powValue) ?? (powerValues.firstIndex(of: 0) ?? 0)
            suppressRfControlCallbacks = false
        }
        await updateProgress(currentStep: &currentStep, totalSteps: totalSteps)

        for register in rfm69ConfigRegisters {
            if await isLoadingCancelled() { return false }
            let value = rfm69.readReg(addr: register.address)
            await MainActor.run {
                registerValues[register.name] = String(format: "%02X", value)
            }
            await updateProgress(currentStep: &currentStep, totalSteps: totalSteps)
        }

        for register in rfm69StatusRegisters {
            if await isLoadingCancelled() { return false }
            let value = rfm69.readReg(addr: register.address)
            await MainActor.run {
                registerValues[register.name] = String(format: "%02X", value)
            }
            await updateProgress(currentStep: &currentStep, totalSteps: totalSteps)
        }
        return true
    }

    private func loadCc1101Settings(service: CC1101Service, totalSteps: Int, currentStep: inout Int) async -> Bool {
        if await isLoadingCancelled() { return false }

        do {
            let freqValue = try cc1101GetFrequencyMHz(service: service)
            await MainActor.run {
                frequency = String(format: "%.6f", freqValue)
            }
            await updateProgress(currentStep: &currentStep, totalSteps: totalSteps)

            if await isLoadingCancelled() { return false }
            let rateValue = try cc1101GetDataRate(service: service)
            await MainActor.run {
                dataRate = String(rateValue)
            }
            await updateProgress(currentStep: &currentStep, totalSteps: totalSteps)

            if await isLoadingCancelled() { return false }
            let bwValue = try cc1101GetBandwidthKHz(service: service)
            await MainActor.run {
                bandwidth = String(format: "%.1f", bwValue)
            }
            await updateProgress(currentStep: &currentStep, totalSteps: totalSteps)

            if await isLoadingCancelled() { return false }
            let devValue = try cc1101GetDeviation(service: service)
            await MainActor.run {
                deviation = String(devValue)
            }
            await updateProgress(currentStep: &currentStep, totalSteps: totalSteps)

            if await isLoadingCancelled() { return false }
            let modValue = try cc1101GetModulation(service: service)
            let powValue = try cc1101GetPowerLevel(service: service)
            await MainActor.run {
                suppressRfControlCallbacks = true
                selectedModulation = modulationValues.firstIndex(of: modValue) ?? 0
                selectedPower = powerValues.firstIndex(of: powValue) ?? (powerValues.firstIndex(of: 0) ?? 0)
                suppressRfControlCallbacks = false
            }
            await updateProgress(currentStep: &currentStep, totalSteps: totalSteps)

            for register in cc1101ConfigRegisters {
                if await isLoadingCancelled() { return false }
                await MainActor.run { currentCommand = String(format: "cc1101 read --reg=0x%02X", register.address) }
                let value = try service.readReg(register.address)
                await MainActor.run {
                    registerValues[register.name] = String(format: "%02X", value)
                }
                await updateProgress(currentStep: &currentStep, totalSteps: totalSteps)
            }

            for register in cc1101StatusRegisters {
                if await isLoadingCancelled() { return false }
                await MainActor.run { currentCommand = String(format: "cc1101 read --reg=0x%02X", register.address) }
                let value = try service.readReg(register.address)
                await MainActor.run {
                    registerValues[register.name] = String(format: "%02X", value)
                }
                await updateProgress(currentStep: &currentStep, totalSteps: totalSteps)
            }

            let table = try service.readBurst(Self.cc1101PaTableAddr, len: Self.cc1101PaTableSize)
            for i in 0..<min(table.count, Self.cc1101PaTableSize) {
                if await isLoadingCancelled() { return false }
                await MainActor.run {
                    registerValues["PA_TABLE\(i)"] = String(format: "%02X", table[i])
                }
                await updateProgress(currentStep: &currentStep, totalSteps: totalSteps)
            }
            return true
        } catch {
            await MainActor.run {
                statusMessage = "CC1101 error: \(error.localizedDescription)"
            }
            return false
        }
    }

    // MARK: - Control Methods

    private func applyModulationAndPowerFromUi(modulationIndex: Int, powerIndex: Int) {
        guard !suppressRfControlCallbacks else { return }
        guard selectedChip != .none else { return }
        guard modulationIndex >= 0, modulationIndex < modulationValues.count else { return }
        guard powerIndex >= 0, powerIndex < powerValues.count else { return }

        let modulation = modulationValues[modulationIndex]
        let power = powerValues[powerIndex]

        Task.detached(priority: .userInitiated) {
            guard await ensureSelectedChipOpen() else { return }

            switch await MainActor.run { selectedChip } {
            case .rfm69:
                guard let rfm69 = await MainActor.run(resultType: RFM69?.self, body: { self.rfm69 }) else { return }
                rfm69.setModulation(modulation)
                _ = rfm69.setPowerLevel(power)
                await MainActor.run {
                    statusMessage = "Modulation and power updated"
                }
            case .cc1101:
                let service = CC1101Service(bleManager: bleManager)
                do {
                    if try cc1101SetModulationAndPower(service: service, modulation: modulation, dbm: power) {
                        await MainActor.run { statusMessage = "Modulation and power updated" }
                    } else {
                        await MainActor.run { statusMessage = "Failed to update modulation/power" }
                    }
                } catch {
                    await MainActor.run { statusMessage = "CC1101 error: \(error.localizedDescription)" }
                }
            case .none:
                return
            }
        }
    }

    private func setFrequency(_ freq: Double) {
        Task.detached(priority: .userInitiated) {
            guard await ensureSelectedChipOpen() else { return }
            switch await MainActor.run { selectedChip } {
            case .rfm69:
                guard let rfm69 = await MainActor.run(resultType: RFM69?.self, body: { self.rfm69 }) else { return }
                rfm69.setFrequencyMHz(Float(freq))
                let actualFreq = rfm69.getFrequency()
                await MainActor.run {
                    frequency = String(format: "%.6f", actualFreq)
                    statusMessage = "Frequency set to \(actualFreq) MHz"
                }
            case .cc1101:
                let service = CC1101Service(bleManager: bleManager)
                do {
                    _ = try cc1101SetFrequencyMHz(service: service, frequencyMHz: freq)
                    let actual = try cc1101GetFrequencyMHz(service: service)
                    await MainActor.run {
                        frequency = String(format: "%.6f", actual)
                        statusMessage = "Frequency set to \(actual) MHz"
                    }
                } catch {
                    await MainActor.run { statusMessage = "Failed to set frequency: \(error.localizedDescription)" }
                }
            case .none:
                return
            }
        }
    }

    private func setDataRate(_ rate: Int) {
        Task.detached(priority: .userInitiated) {
            guard await ensureSelectedChipOpen() else { return }
            switch await MainActor.run { selectedChip } {
            case .rfm69:
                guard let rfm69 = await MainActor.run(resultType: RFM69?.self, body: { self.rfm69 }) else { return }
                rfm69.setDataRate(rate)
                let actualRate = rfm69.getDataRate()
                await MainActor.run {
                    dataRate = String(actualRate)
                    statusMessage = "Data rate set to \(actualRate) bps"
                }
            case .cc1101:
                let service = CC1101Service(bleManager: bleManager)
                do {
                    _ = try cc1101SetDataRate(service: service, bitRate: rate)
                    let actual = try cc1101GetDataRate(service: service)
                    await MainActor.run {
                        dataRate = String(actual)
                        statusMessage = "Data rate set to \(actual) bps"
                    }
                } catch {
                    await MainActor.run { statusMessage = "Failed to set data rate: \(error.localizedDescription)" }
                }
            case .none:
                return
            }
        }
    }

    private func setBandwidth(_ bw: Double) {
        Task.detached(priority: .userInitiated) {
            guard await ensureSelectedChipOpen() else { return }
            switch await MainActor.run { selectedChip } {
            case .rfm69:
                guard let rfm69 = await MainActor.run(resultType: RFM69?.self, body: { self.rfm69 }) else { return }
                if rfm69.setBandwidth(bw) {
                    let actualBw = rfm69.getBandwidth()
                    await MainActor.run {
                        bandwidth = String(format: "%.1f", actualBw)
                        statusMessage = "Bandwidth set to \(actualBw) kHz"
                    }
                } else {
                    await MainActor.run { statusMessage = "Failed to set bandwidth" }
                }
            case .cc1101:
                let service = CC1101Service(bleManager: bleManager)
                do {
                    _ = try cc1101SetBandwidth(service: service, bandwidthKHz: bw)
                    let actual = try cc1101GetBandwidthKHz(service: service)
                    await MainActor.run {
                        bandwidth = String(format: "%.1f", actual)
                        statusMessage = "Bandwidth set to \(actual) kHz"
                    }
                } catch {
                    await MainActor.run { statusMessage = "Failed to set bandwidth: \(error.localizedDescription)" }
                }
            case .none:
                return
            }
        }
    }

    private func setDeviation(_ dev: Int) {
        Task.detached(priority: .userInitiated) {
            guard await ensureSelectedChipOpen() else { return }
            switch await MainActor.run { selectedChip } {
            case .rfm69:
                guard let rfm69 = await MainActor.run(resultType: RFM69?.self, body: { self.rfm69 }) else { return }
                rfm69.setDeviation(dev)
                let actualDev = rfm69.getDeviation()
                await MainActor.run {
                    deviation = String(actualDev)
                    statusMessage = "Deviation set to \(actualDev) Hz"
                }
            case .cc1101:
                let service = CC1101Service(bleManager: bleManager)
                do {
                    _ = try cc1101SetDeviation(service: service, deviationHz: dev)
                    let actual = try cc1101GetDeviation(service: service)
                    await MainActor.run {
                        deviation = String(actual)
                        statusMessage = "Deviation set to \(actual) Hz"
                    }
                } catch {
                    await MainActor.run { statusMessage = "Failed to set deviation: \(error.localizedDescription)" }
                }
            case .none:
                return
            }
        }
    }

    private func resetRadio() {
        guard selectedChip == .rfm69 else { return }
        guard let rfm69 = rfm69 else { return }
        isLoading = true
        rfm69.setMode(RFM69.MODE_SLEEP)
        Thread.sleep(forTimeInterval: 0.1)
        rfm69.setMode(RFM69.MODE_STANDBY)
        Thread.sleep(forTimeInterval: 0.1)
        statusMessage = "Radio reset. Load parameters to continue."
        isLoading = false
    }

    // MARK: - CC1101 helpers

    private func cc1101GetFrequencyMHz(service: CC1101Service) throws -> Double {
        let freq2 = Int(try service.readReg(Self.cc1101RegFreq2))
        let freq1 = Int(try service.readReg(Self.cc1101RegFreq1))
        let freq0 = Int(try service.readReg(Self.cc1101RegFreq0))
        let word = (freq2 << 16) | (freq1 << 8) | freq0
        return (Double(word) * (Self.cc1101FxtalHz / pow(2.0, 16.0))) / 1_000_000.0
    }

    private func cc1101SetFrequencyMHz(service: CC1101Service, frequencyMHz: Double) throws -> Bool {
        let word = Int64(round(frequencyMHz * 1_000_000.0 * pow(2.0, 16.0) / Self.cc1101FxtalHz))
        let freq2 = UInt8((word >> 16) & 0xFF)
        let freq1 = UInt8((word >> 8) & 0xFF)
        let freq0 = UInt8(word & 0xFF)
        try service.writeReg(Self.cc1101RegFreq2, value: freq2)
        try service.writeReg(Self.cc1101RegFreq1, value: freq1)
        try service.writeReg(Self.cc1101RegFreq0, value: freq0)
        try service.strobe(0x36) // SIDLE
        try service.strobe(0x33) // SCAL
        let actual = try cc1101GetFrequencyMHz(service: service)
        return abs(actual - frequencyMHz) < 0.001
    }

    private func cc1101GetDataRate(service: CC1101Service) throws -> Int {
        let mdmcfg4 = Int(try service.readReg(Self.cc1101RegMdmcfg4))
        let drateE = mdmcfg4 & 0x0F
        let drateM = Int(try service.readReg(Self.cc1101RegMdmcfg3))
        let bitRate = ((256.0 + Double(drateM)) * pow(2.0, Double(drateE)) * Self.cc1101FxtalHz) / pow(2.0, 28.0)
        return Int(round(bitRate))
    }

    private func cc1101SetDataRate(service: CC1101Service, bitRate: Int) throws -> Bool {
        guard bitRate > 0 else { return false }
        let target = Double(bitRate) * pow(2.0, 28.0) / Self.cc1101FxtalHz
        var bestM = 0
        var bestE = 0
        var minDiff = Double.greatestFiniteMagnitude
        for e in 0...15 {
            for m in 0...255 {
                let current = (256.0 + Double(m)) * pow(2.0, Double(e))
                let diff = abs(current - target)
                if diff < minDiff {
                    minDiff = diff
                    bestM = m
                    bestE = e
                }
            }
        }
        let mdmcfg4 = Int(try service.readReg(Self.cc1101RegMdmcfg4))
        let bandwidthPart = mdmcfg4 & 0xF0
        let newMdmcfg4 = UInt8(bandwidthPart | (bestE & 0x0F))
        let newMdmcfg3 = UInt8(bestM & 0xFF)
        try service.writeBurst(Self.cc1101RegMdmcfg4, bytes: [newMdmcfg4, newMdmcfg3])
        let confirm = try service.readBurst(Self.cc1101RegMdmcfg4, len: 2)
        return confirm.count == 2 && confirm[0] == newMdmcfg4 && confirm[1] == newMdmcfg3
    }

    private func cc1101GetBandwidthKHz(service: CC1101Service) throws -> Double {
        let v = Int(try service.readReg(Self.cc1101RegMdmcfg4))
        let bwExp = (v >> 6) & 0x03
        let bwMant = (v >> 4) & 0x03
        let bandwidthHz = Self.cc1101FxtalHz / (8.0 * (4.0 + Double(bwMant)) * pow(2.0, Double(bwExp)))
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
                let bwHz = Self.cc1101FxtalHz / (8.0 * (4.0 + Double(mant)) * pow(2.0, Double(exp)))
                let diff = abs(bwHz - targetHz)
                if diff < bestDiff {
                    bestDiff = diff
                    bestExp = exp
                    bestMant = mant
                }
            }
        }
        let current = Int(try service.readReg(Self.cc1101RegMdmcfg4))
        let drateE = current & 0x0F
        let newMdmcfg4 = UInt8((bestExp << 6) | (bestMant << 4) | drateE)
        try service.writeReg(Self.cc1101RegMdmcfg4, value: newMdmcfg4)
        let confirm = try service.readReg(Self.cc1101RegMdmcfg4)
        return confirm == newMdmcfg4
    }

    private func cc1101GetDeviation(service: CC1101Service) throws -> Int {
        let v = Int(try service.readReg(Self.cc1101RegDeviatn))
        let deviationM = v & 0x07
        let deviationE = (v >> 4) & 0x07
        let deviationHz = ((8.0 + Double(deviationM)) * pow(2.0, Double(deviationE))) * (Self.cc1101FxtalHz / pow(2.0, 17.0))
        return Int(round(deviationHz))
    }

    private func cc1101SetDeviation(service: CC1101Service, deviationHz: Int) throws -> Bool {
        guard deviationHz > 0 else { return false }
        var bestE = 0
        var bestM = 0
        var bestDiff = Double.greatestFiniteMagnitude
        for e in 0...7 {
            for m in 0...7 {
                let currentHz = ((8.0 + Double(m)) * pow(2.0, Double(e))) * (Self.cc1101FxtalHz / pow(2.0, 17.0))
                let diff = abs(currentHz - Double(deviationHz))
                if diff < bestDiff {
                    bestDiff = diff
                    bestE = e
                    bestM = m
                }
            }
        }
        let value = UInt8((bestE << 4) | (bestM & 0x07))
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
        let powerSettings = cc1101PowerSettings(for: frequencyMHz)
        guard !powerSettings.isEmpty else { return 0 }
        let modulation = try cc1101GetModulation(service: service)
        let pa = try service.readBurst(Self.cc1101PaTableAddr, len: 2)
        guard pa.count >= 2 else { return 0 }
        let current = (modulation == Self.cc1101ModAsk ? pa[1] : pa[0])

        for (index, setting) in powerSettings.enumerated() where index < Self.cc1101PowerLevelsDbm.count {
            if setting == current {
                return Self.cc1101PowerLevelsDbm[index]
            }
        }

        var closestIndex = 0
        var smallestDiff = Int.max
        for (index, setting) in powerSettings.enumerated() where index < Self.cc1101PowerLevelsDbm.count {
            let diff = abs(Int(setting) - Int(current))
            if diff < smallestDiff {
                smallestDiff = diff
                closestIndex = index
            }
        }
        return Self.cc1101PowerLevelsDbm[closestIndex]
    }

    private func cc1101SetModulationAndPower(service: CC1101Service, modulation: Int, dbm: Int) throws -> Bool {
        let frequencyMHz = try cc1101GetFrequencyMHz(service: service)
        let powerSettings = cc1101PowerSettings(for: frequencyMHz)
        guard let powerIndex = Self.cc1101PowerLevelsDbm.firstIndex(of: dbm),
              powerIndex < powerSettings.count else {
            return false
        }
        let powerSetting = powerSettings[powerIndex]

        let currentMdmcfg2 = Int(try service.readReg(Self.cc1101RegMdmcfg2))
        let newMdmcfg2 = UInt8((currentMdmcfg2 & 0x0F) | ((modulation & 0x07) << 4))
        let frend0: UInt8 = modulation == Self.cc1101ModAsk ? 0x11 : 0x10
        try service.writeReg(Self.cc1101RegMdmcfg2, value: newMdmcfg2)
        try service.writeReg(Self.cc1101RegFrend0, value: frend0)

        var paTable = [UInt8](repeating: 0, count: Self.cc1101PaTableSize)
        if modulation == Self.cc1101ModAsk {
            paTable[0] = 0
            paTable[1] = powerSetting
        } else {
            paTable[0] = powerSetting
            paTable[1] = 0
        }
        try service.writeBurst(Self.cc1101PaTableAddr, bytes: paTable)

        let confirmMdmcfg2 = try service.readReg(Self.cc1101RegMdmcfg2)
        let confirmFrend0 = try service.readReg(Self.cc1101RegFrend0)
        return confirmMdmcfg2 == newMdmcfg2 && confirmFrend0 == frend0
    }

    private func cc1101PowerSettings(for frequencyMHz: Double) -> [UInt8] {
        if frequencyMHz >= 300 && frequencyMHz <= 348 {
            return Self.cc1101PowerSetting315Mhz
        }
        if frequencyMHz >= 378 && frequencyMHz <= 464 {
            return Self.cc1101PowerSetting433Mhz
        }
        if frequencyMHz >= 779 && frequencyMHz <= 899.99 {
            return Self.cc1101PowerSetting868Mhz
        }
        if frequencyMHz >= 900 && frequencyMHz <= 928 {
            return Self.cc1101PowerSetting915Mhz
        }
        return []
    }
}

#Preview {
    NavigationView {
        ISMView()
            .environmentObject(BLEManager())
    }
} 
