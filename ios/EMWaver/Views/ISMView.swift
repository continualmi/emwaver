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
    @State private var showingRegistersView: Bool = false
    
    // Status
    @State private var statusMessage: String = "Not connected"
    @State private var isLoading: Bool = false
    
    // Define modulation types
    private let modulationFormats = ["2-FSK", "GFSK", "ASK/OOK", "4-FSK", "MSK"]
    private let modulationValues: [UInt8] = [0, 1, 3, 4, 7] // CC1101.MOD_* values
    
    // Define power levels
    private let powerLevels = ["-30 dBm", "-20 dBm", "-15 dBm", "-10 dBm", "0 dBm", "5 dBm", "7 dBm", "10 dBm"]
    private let powerValues = [-30, -20, -15, -10, 0, 5, 7, 10] // CC1101.POWER_* values
    
    var body: some View {
        VStack {
            connectionStatus
            
            if bleManager.isConnected {
                ScrollView {
                    VStack(spacing: 20) {
                        rfParametersCard
                        buttonsCard
                    }
                    .padding()
                }
            } else {
                connectionPrompt
            }
            
            if isLoading {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle())
                    .scaleEffect(1.5)
                    .padding()
            }
        }
        .navigationTitle("ISM")
        .onAppear {
            if bleManager.isConnected {
                setupCC1101()
            }
        }
        .onChange(of: bleManager.isConnected) { connected in
            if connected {
                setupCC1101()
            }
        }
        .sheet(isPresented: $showingRegistersView) {
            RegistersView(cc1101: cc1101, registerValues: $registerValues)
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
            
            Button(bleManager.isConnected ? "Disconnect" : "Connect") {
                if bleManager.isConnected {
                    bleManager.disconnect()
                } else {
                    bleManager.startScan()
                    statusMessage = "Scanning..."
                }
            }
            .buttonStyle(.bordered)
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
            
            Button("Connect") {
                bleManager.startScan()
                statusMessage = "Scanning..."
            }
            .buttonStyle(.borderedProminent)
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
                    .onTapGesture {
                        // Show edit dialog
                    }
                
                Button("Set") {
                    if let freqValue = Double(frequency) {
                        setFrequency(freqValue)
                    }
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
                
                Button("Set") {
                    if let rateValue = Int(dataRate) {
                        setDataRate(rateValue)
                    }
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
                
                Button("Set") {
                    if let bwValue = Double(bandwidth) {
                        setBandwidth(bwValue)
                    }
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
                
                Button("Set") {
                    if let devValue = Int(deviation) {
                        setDeviation(devValue)
                    }
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
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(10)
    }
    
    // Buttons Card
    private var buttonsCard: some View {
        VStack(alignment: .leading, spacing: 15) {
            Text("Actions")
                .font(.headline)
                .padding(.bottom, 5)
            
            HStack(spacing: 20) {
                Button("View Registers") {
                    loadRegisters()
                    showingRegistersView = true
                }
                .buttonStyle(.bordered)
                
                Button("Calibrate") {
                    calibrateRadio()
                }
                .buttonStyle(.bordered)
                
                Button("Reset") {
                    resetRadio()
                }
                .buttonStyle(.bordered)
            }
            
            HStack(spacing: 20) {
                Button("315 MHz Antenna") {
                    select315MHzAntenna()
                }
                .buttonStyle(.bordered)
                
                Button("433 MHz Antenna") {
                    select433MHzAntenna()
                }
                .buttonStyle(.bordered)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(10)
    }
    
    // MARK: - Helper Methods
    
    private func setupCC1101() {
        // Initialize CC1101 if needed
        if cc1101 == nil {
            cc1101 = CC1101(bleManager: bleManager)
        }
        
        statusMessage = "Connecting to CC1101..."
        isLoading = true
        
        // Check BLE connection before proceeding
        if !bleManager.isConnected {
            statusMessage = "Not connected to BLE device"
            isLoading = false
            return
        }
        
        // Load current settings with a delay to ensure BLE is ready
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            self.loadCurrentSettings()
        }
    }
    
    private func loadCurrentSettings() {
        guard let cc1101 = cc1101 else {
            statusMessage = "CC1101 not initialized"
            return 
        }
        
        isLoading = true
        
        // Get frequency
        let freqValue = cc1101.getFrequency()
        frequency = String(format: "%.6f", freqValue)
        
        // Get data rate
        let rateValue = cc1101.getDataRate()
        dataRate = String(rateValue)
        
        // Get bandwidth
        let bwValue = cc1101.getBandwidth()
        bandwidth = String(format: "%.1f", bwValue)
        
        // Get deviation
        let devValue = cc1101.getDeviation()
        deviation = String(devValue)
        
        // Get modulation
        let modValue = cc1101.getModulation()
        selectedModulation = modulationValues.firstIndex(of: UInt8(modValue)) ?? 0
        
        // Get power level
        let powValue = cc1101.getPowerLevel()
        selectedPower = powerValues.firstIndex(of: powValue) ?? 4 // Default to 0 dBm
        
        // Load registers
        loadRegisters()
        
        isLoading = false
        statusMessage = "Settings loaded successfully"
    }
    
    private func loadRegisters() {
        guard let cc1101 = cc1101 else { return }
        
        // Clear register values
        registerValues.removeAll()
        
        // Configuration registers
        for i in 0..<47 {
            let addr = UInt8(i)
            let value = cc1101.readReg(addr: addr)
            print("Read config register 0x\(String(format: "%02X", addr)): 0x\(String(format: "%02X", value))")
            registerValues[String(format: "%02X", addr)] = String(format: "%02X", value)
        }
        
        // Status registers - use burst read mode with READ_BURST bit set instead of READ_SINGLE
        for i in 0..<12 {
            let baseAddr = UInt8(CC1101.PARTNUM) + UInt8(i)
            let addr = baseAddr | CC1101.READ_BURST
            let value = cc1101.readReg(addr: addr)
            print("Read status register 0x\(String(format: "%02X", baseAddr)): 0x\(String(format: "%02X", value))")
            registerValues[String(format: "%02X", baseAddr)] = String(format: "%02X", value)
        }
        
        // PA Table
        let paTable = cc1101.readBurstReg(addr: CC1101.PATABLE, len: 8)
        for i in 0..<min(8, paTable.count) {
            print("Read PA Table PA\(i): 0x\(String(format: "%02X", paTable[i]))")
            registerValues["PA\(i)"] = String(format: "%02X", paTable[i])
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
    
    private func calibrateRadio() {
        guard let cc1101 = cc1101 else { return }
        
        isLoading = true
        cc1101.calibrate()
        statusMessage = "Radio calibrated"
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
        
        loadCurrentSettings() // Reload settings
        statusMessage = "Radio reset and re-initialized"
        isLoading = false
    }
    
    private func select315MHzAntenna() {
        guard let cc1101 = cc1101 else { return }
        
        isLoading = true
        cc1101.select315MHzAntenna()
        statusMessage = "315 MHz antenna selected"
        isLoading = false
    }
    
    private func select433MHzAntenna() {
        guard let cc1101 = cc1101 else { return }
        
        isLoading = true
        cc1101.select433MHzAntenna()
        statusMessage = "433 MHz antenna selected"
        isLoading = false
    }
}

// MARK: - Register Viewer

struct RegistersView: View {
    let cc1101: CC1101?
    @Binding var registerValues: [String: String]
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        NavigationView {
            List {
                Section(header: Text("Configuration Registers")) {
                    ForEach(configRegisters, id: \.key) { register in
                        registerRow(name: register.name, address: register.key, value: registerValues[register.key] ?? "??")
                    }
                }
                
                Section(header: Text("Status Registers")) {
                    ForEach(statusRegisters, id: \.key) { register in
                        registerRow(name: register.name, address: register.key, value: registerValues[register.key] ?? "??")
                    }
                }
                
                Section(header: Text("PA Table")) {
                    ForEach(0..<8, id: \.self) { index in
                        registerRow(name: "PA[\(index)]", address: "PA\(index)", value: registerValues["PA\(index)"] ?? "??")
                    }
                }
            }
            .refreshable {
                // Refresh register values
                if let cc1101 = cc1101 {
                    for register in configRegisters {
                        if let addr = UInt8(register.key, radix: 16) {
                            let value = cc1101.readReg(addr: addr)
                            registerValues[register.key] = String(format: "%02X", value)
                        }
                    }
                    
                    for register in statusRegisters {
                        if let addr = UInt8(register.key, radix: 16) {
                            let value = cc1101.readReg(addr: addr | CC1101.READ_BURST)
                            registerValues[register.key] = String(format: "%02X", value)
                        }
                    }
                    
                    let paTable = cc1101.readBurstReg(addr: CC1101.PATABLE, len: 8)
                    for i in 0..<min(8, paTable.count) {
                        registerValues["PA\(i)"] = String(format: "%02X", paTable[i])
                    }
                }
            }
            .navigationTitle("CC1101 Registers")
            .navigationBarItems(trailing: Button("Done") {
                dismiss()
            })
        }
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
}

#Preview {
    NavigationView {
        ISMView()
            .environmentObject(BLEManager())
    }
} 
