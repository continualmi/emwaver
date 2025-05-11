import SwiftUI

struct ISMView: View {
    @EnvironmentObject var bleManager: BLEManager
    @State private var cc1101: CC1101?
    
    // RF parameter states - no defaults
    @State private var frequency: String = ""
    @State private var dataRate: String = ""
    @State private var bandwidth: String = ""
    @State private var deviation: String = ""
    @State private var selectedModulation: Int = 0
    @State private var selectedPower: Int = 4 // 0 dBm default
    
    // Register viewer
    @State private var registerValues: [String: String] = [:]
    
    // Status
    @State private var statusMessage: String = "Not connected"
    @State private var isLoading: Bool = false
    @State private var isViewActive: Bool = false
    
    // Load dialog state
    @State private var showLoadingAlert: Bool = false
    @State private var isLoadingRegisters: Bool = false
    @State private var registerLoadingProgress: Double = 0.0
    @State private var loadingRegistersCancelled: Bool = false
    @State private var loadingAlertMessage: String = "Loading CC1101 parameters..."
    
    // Define modulation types
    private let modulationFormats = ["2-FSK", "GFSK", "ASK/OOK", "4-FSK", "MSK"]
    private let modulationValues: [UInt8] = [0, 1, 3, 4, 7] // CC1101.MOD_* values
    
    // Define power levels
    private let powerLevels = ["-30 dBm", "-20 dBm", "-15 dBm", "-10 dBm", "0 dBm", "5 dBm", "7 dBm", "10 dBm"]
    private let powerValues = [-30, -20, -15, -10, 0, 5, 7, 10] // CC1101.POWER_* values
    
    // Configuration registers
    private let configRegisters: [(key: String, name: String)] = [
        ("00", "IOCFG2"), ("01", "IOCFG1"), ("02", "IOCFG0"), ("03", "FIFOTHR"),
        ("04", "SYNC1"), ("05", "SYNC0"), ("06", "PKTLEN"), ("07", "PKTCTRL1"),
        ("08", "PKTCTRL0"), ("09", "ADDR"), ("0A", "CHANNR"), ("0B", "FSCTRL1"),
        ("0C", "FSCTRL0"), ("0D", "FREQ2"), ("0E", "FREQ1"), ("0F", "FREQ0"),
        ("10", "MDMCFG4"), ("11", "MDMCFG3"), ("12", "MDMCFG2"), ("13", "MDMCFG1"),
        ("14", "MDMCFG0"), ("15", "DEVIATN"), ("16", "MCSM2"), ("17", "MCSM1"),
        ("18", "MCSM0"), ("19", "FOCCFG"), ("1A", "BSCFG"), ("1B", "AGCCTRL2"),
        ("1C", "AGCCTRL1"), ("1D", "AGCCTRL0"), ("1E", "WOREVT1"), ("1F", "WOREVT0"),
        ("20", "WORCTRL"), ("21", "FREND1"), ("22", "FREND0"), ("23", "FSCAL3"),
        ("24", "FSCAL2"), ("25", "FSCAL1"), ("26", "FSCAL0"), ("27", "RCCTRL1"),
        ("28", "RCCTRL0"), ("29", "FSTEST"), ("2A", "PTEST"), ("2B", "AGCTEST"),
        ("2C", "TEST2"), ("2D", "TEST1"), ("2E", "TEST0")
    ]
    
    // Status registers
    private let statusRegisters: [(key: String, name: String)] = [
        ("30", "PARTNUM"), ("31", "VERSION"), ("32", "FREQEST"), ("33", "LQI"),
        ("34", "RSSI"), ("35", "MARCSTATE"), ("36", "WORTIME1"), ("37", "WORTIME0"),
        ("38", "PKTSTATUS"), ("39", "VCO_VC_DAC"), ("3A", "TXBYTES"), ("3B", "RXBYTES")
    ]
    
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
            if bleManager.isConnected {
                setupCC1101()
            }
        }
        .onDisappear {
            print("ISM View disappeared")
            isViewActive = false
            // Cancel any ongoing register loading
            loadingRegistersCancelled = true
        }
        // Only setup CC1101 when both view is active AND we get connected
        .onChange(of: bleManager.isConnected) { connected in
            if connected && isViewActive {
                setupCC1101()
            }
        }
        // Alert for loading parameters
        .alert(loadingAlertMessage, isPresented: $showLoadingAlert) {
            Button("Cancel", role: .cancel) {
                loadingRegistersCancelled = true
            }
        }
        .onChange(of: showLoadingAlert) { show in
            if show {
                // Automatically start loading when alert appears
                isLoadingRegisters = true
                loadingRegistersCancelled = false
                loadAllSettings()
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") {
                    focusedField = nil
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
            
            Text("Connect to an EMWaver device to control the CC1101 radio.")
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
            Text("RF Parameters")
                .font(.headline)
                .padding(.bottom, 5)
            
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
                    setModulation(modulationValues[newValue])
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
                    setPowerLevel(powerValues[newValue])
                }
            }
            
            // Quick controls
            HStack {
                Button("Reset") {
                    resetRadio()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(10)
    }
    
    // Registers View Section
    private var registersViewSection: some View {
        VStack(alignment: .leading, spacing: 15) {
            HStack {
                Text("CC1101 Registers")
                    .font(.headline)
                    .padding(.bottom, 5)
                
                Spacer()
                
                Button("Refresh") {
                    showLoadingAlert = true
                    isLoadingRegisters = false
                    registerLoadingProgress = 0.0
                    loadingRegistersCancelled = false
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
            
            ScrollView {
                VStack(spacing: 8) {
                    // Configuration Registers
                    Text("Configuration Registers")
                        .font(.subheadline)
                        .padding(.vertical, 4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    
                    ForEach(configRegisters, id: \.key) { register in
                        registerRow(
                            name: register.name,
                            address: register.key,
                            value: registerValues[register.key] ?? "??"
                        )
                    }
                    
                    Divider()
                        .padding(.vertical, 4)
                    
                    // Status Registers
                    Text("Status Registers")
                        .font(.subheadline)
                        .padding(.vertical, 4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    
                    ForEach(statusRegisters, id: \.key) { register in
                        registerRow(
                            name: register.name,
                            address: register.key,
                            value: registerValues[register.key] ?? "??"
                        )
                    }
                    
                    Divider()
                        .padding(.vertical, 4)
                    
                    // PA Table
                    Text("PA Table")
                        .font(.subheadline)
                        .padding(.vertical, 4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    
                    ForEach(0..<8, id: \.self) { index in
                        registerRow(
                            name: "PA[\(index)]",
                            address: "PA\(index)",
                            value: registerValues["PA\(index)"] ?? "??"
                        )
                    }
                }
                .padding(.horizontal, 4)
            }
            .frame(height: 400)
            .background(Color(.systemBackground))
            .cornerRadius(8)
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(10)
    }
    
    private func registerRow(name: String, address: String, value: String) -> some View {
        HStack {
            Text(name)
                .font(.headline)
            Spacer()
            Text("0x\(address)")
                .font(.subheadline)
                .foregroundColor(.secondary)
            Spacer()
            Text("0x\(value)")
                .font(.system(.body, design: .monospaced))
                .onTapGesture {
                    // Show edit dialog if needed
                }
        }
    }
    
    // MARK: - Helper Methods
    
    private func setupCC1101() {
        print("Setting up CC1101 in ISM View")
        // Initialize CC1101 if needed
        if cc1101 == nil {
            cc1101 = CC1101(bleManager: bleManager)
        }
        
        // Check BLE connection before proceeding
        if !bleManager.isConnected {
            statusMessage = "Not connected to BLE device"
            isLoading = false
            return
        }
        
        // Show loading dialog instead of loading directly
        showLoadingAlert = true
        isLoadingRegisters = false
        registerLoadingProgress = 0.0
        loadingRegistersCancelled = false
    }
    
    private func loadAllSettings() {
        guard let cc1101 = cc1101 else {
            showLoadingAlert = false
            return
        }
        
        isLoadingRegisters = true
        registerLoadingProgress = 0.0
        
        // Clear register values
        registerValues.removeAll()
        
        // Use Task to perform loading asynchronously
        Task {
            // Set total steps (RF parameters + 47 config registers + 12 status registers + 8 PA table entries)
            let totalSteps = 5 + 47 + 12 + 8 // 5 RF parameters + registers
            var currentStep = 0
            
            // Step 1: Load RF parameters
            if loadingRegistersCancelled {
                await MainActor.run {
                    showLoadingAlert = false
                    isLoadingRegisters = false
                }
                return
            }
            
            // Get frequency
            await MainActor.run {
                loadingAlertMessage = "Loading parameters... (1/5)"
            }
            let freqValue = cc1101.getFrequency()
            await MainActor.run {
                frequency = String(format: "%.6f", freqValue)
                currentStep += 1
                registerLoadingProgress = Double(currentStep) / Double(totalSteps)
            }
            
            // Get data rate
            await MainActor.run {
                loadingAlertMessage = "Loading parameters... (2/5)"
            }
            let rateValue = cc1101.getDataRate()
            await MainActor.run {
                dataRate = String(rateValue)
                currentStep += 1
                registerLoadingProgress = Double(currentStep) / Double(totalSteps)
            }
            
            // Get bandwidth
            await MainActor.run {
                loadingAlertMessage = "Loading parameters... (3/5)"
            }
            let bwValue = cc1101.getBandwidth()
            await MainActor.run {
                bandwidth = String(format: "%.1f", bwValue)
                currentStep += 1
                registerLoadingProgress = Double(currentStep) / Double(totalSteps)
            }
            
            // Get deviation
            await MainActor.run {
                loadingAlertMessage = "Loading parameters... (4/5)"
            }
            let devValue = cc1101.getDeviation()
            await MainActor.run {
                deviation = String(devValue)
                currentStep += 1
                registerLoadingProgress = Double(currentStep) / Double(totalSteps)
            }
            
            // Get modulation and power level
            await MainActor.run {
                loadingAlertMessage = "Loading parameters... (5/5)"
            }
            let modValue = cc1101.getModulation()
            let powValue = cc1101.getPowerLevel()
            await MainActor.run {
                selectedModulation = modulationValues.firstIndex(of: UInt8(modValue)) ?? 0
                selectedPower = powerValues.firstIndex(of: powValue) ?? 4
                currentStep += 1
                registerLoadingProgress = Double(currentStep) / Double(totalSteps)
            }
            
            // Step 2: Configuration registers
            await MainActor.run {
                loadingAlertMessage = "Loading registers... (1/3)"
            }
            for i in 0..<47 {
                if loadingRegistersCancelled {
                    await MainActor.run {
                        showLoadingAlert = false
                        isLoadingRegisters = false
                    }
                    return
                }
                
                let addr = UInt8(i)
                let value = cc1101.readReg(addr: addr)
                
                await MainActor.run {
                    registerValues[String(format: "%02X", addr)] = String(format: "%02X", value)
                    currentStep += 1
                    registerLoadingProgress = Double(currentStep) / Double(totalSteps)
                    
                    // Update loading message occasionally
                    if i % 10 == 0 {
                        loadingAlertMessage = "Loading config registers... (\(i)/47)"
                    }
                }
                
                // Short delay to allow UI to remain responsive
                try? await Task.sleep(nanoseconds: 10_000_000) // 10ms delay
            }
            
            // Step 3: Status registers
            await MainActor.run {
                loadingAlertMessage = "Loading status registers... (2/3)"
            }
            for i in 0..<12 {
                if loadingRegistersCancelled {
                    await MainActor.run {
                        showLoadingAlert = false
                        isLoadingRegisters = false
                    }
                    return
                }
                
                let baseAddr = UInt8(CC1101.PARTNUM) + UInt8(i)
                let addr = baseAddr | CC1101.READ_BURST
                let value = cc1101.readReg(addr: addr)
                
                await MainActor.run {
                    registerValues[String(format: "%02X", baseAddr)] = String(format: "%02X", value)
                    currentStep += 1
                    registerLoadingProgress = Double(currentStep) / Double(totalSteps)
                }
                
                try? await Task.sleep(nanoseconds: 10_000_000) // 10ms delay
            }
            
            // Step 4: PA Table
            await MainActor.run {
                loadingAlertMessage = "Loading PA table... (3/3)"
            }
            let paTable = cc1101.readBurstReg(addr: CC1101.PATABLE, len: 8)
            for i in 0..<min(8, paTable.count) {
                if loadingRegistersCancelled {
                    await MainActor.run {
                        showLoadingAlert = false
                        isLoadingRegisters = false
                    }
                    return
                }
                
                await MainActor.run {
                    registerValues["PA\(i)"] = String(format: "%02X", paTable[i])
                    currentStep += 1
                    registerLoadingProgress = Double(currentStep) / Double(totalSteps)
                }
                
                if i < 7 { // Don't delay after the last item
                    try? await Task.sleep(nanoseconds: 10_000_000) // 10ms delay
                }
            }
            
            // Complete loading
            await MainActor.run {
                registerLoadingProgress = 1.0
                isLoadingRegisters = false
                showLoadingAlert = false
                statusMessage = "Settings loaded successfully"
                loadingAlertMessage = "Loading CC1101 parameters..." // Reset for next time
            }
        }
    }
    
    // MARK: - Control Methods
    
    private func setFrequency(_ freq: Double) {
        guard let cc1101 = cc1101 else { return }
        
        isLoading = true
        if cc1101.setFrequencyMHz(frequencyMHz: freq) {
            let actualFreq = cc1101.getFrequency()
            frequency = String(format: "%.6f", actualFreq)
            statusMessage = "Frequency set to \(actualFreq) MHz"
        } else {
            statusMessage = "Failed to set frequency"
        }
        isLoading = false
    }
    
    private func setDataRate(_ rate: Int) {
        guard let cc1101 = cc1101 else { return }
        
        isLoading = true
        if cc1101.setDataRate(bitRate: rate) {
            let actualRate = cc1101.getDataRate()
            dataRate = String(actualRate)
            statusMessage = "Data rate set to \(actualRate) bps"
        } else {
            statusMessage = "Failed to set data rate"
        }
        isLoading = false
    }
    
    private func setBandwidth(_ bw: Double) {
        guard let cc1101 = cc1101 else { return }
        
        isLoading = true
        if cc1101.setBandwidth(bandwidth: bw) {
            let actualBw = cc1101.getBandwidth()
            bandwidth = String(format: "%.1f", actualBw)
            statusMessage = "Bandwidth set to \(actualBw) kHz"
        } else {
            statusMessage = "Failed to set bandwidth"
        }
        isLoading = false
    }
    
    private func setDeviation(_ dev: Int) {
        guard let cc1101 = cc1101 else { return }
        
        isLoading = true
        if cc1101.setDeviation(deviation: dev) {
            let actualDev = cc1101.getDeviation()
            deviation = String(actualDev)
            statusMessage = "Deviation set to \(actualDev) Hz"
        } else {
            statusMessage = "Failed to set deviation"
        }
        isLoading = false
    }
    
    private func setModulation(_ mod: UInt8) {
        guard let cc1101 = cc1101 else { return }
        
        isLoading = true
        if cc1101.setModulation(modulation: mod) {
            statusMessage = "Modulation set to \(modulationFormats[selectedModulation])"
        } else {
            statusMessage = "Failed to set modulation"
            // Revert selection
            let currentMod = cc1101.getModulation()
            selectedModulation = modulationValues.firstIndex(of: UInt8(currentMod)) ?? 0
        }
        isLoading = false
    }
    
    private func setPowerLevel(_ power: Int) {
        guard let cc1101 = cc1101 else { return }
        
        isLoading = true
        if cc1101.setPowerLevel(powerLevel: power) {
            statusMessage = "Power level set to \(power) dBm"
        } else {
            statusMessage = "Failed to set power level"
            // Revert selection
            let currentPower = cc1101.getPowerLevel()
            selectedPower = powerValues.firstIndex(of: currentPower) ?? 4
        }
        isLoading = false
    }
    
    private func resetRadio() {
        guard let cc1101 = cc1101 else { return }
        
        isLoading = true
        cc1101.spiStrobe(commandStrobe: CC1101.SRES)
        Thread.sleep(forTimeInterval: 0.1) // Wait for reset
        
        // Use the CC1101 init method correctly
        cc1101.spiStrobe(commandStrobe: CC1101.SRES) // Reset chip
        Thread.sleep(forTimeInterval: 0.1) // Wait for reset
        
        // Show loading dialog for reloading settings after reset
        showLoadingAlert = true
        isLoadingRegisters = false
        registerLoadingProgress = 0.0
        loadingRegistersCancelled = false
        statusMessage = "Radio reset. Load parameters to continue."
        isLoading = false
    }
}

#Preview {
    NavigationView {
        ISMView()
            .environmentObject(BLEManager())
    }
} 
