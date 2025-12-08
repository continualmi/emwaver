import SwiftUI

struct ISMView: View {
    @EnvironmentObject var bleManager: BLEManager
    @State private var rfm69: RFM69?
    
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
    @State private var loadingAlertMessage: String = "Loading RFM69 parameters..."
    @State private var currentCommand: String = "Preparing..."
    @State private var totalLoadSteps: Int = 0
    @State private var completedLoadSteps: Int = 0
    @State private var showingSettingsSheet = false
    
    // Define modulation types
    private let modulationFormats = ["FSK", "OOK"]
    private let modulationValues: [Int] = [0, 1] // RFM69.MOD_FSK, RFM69.MOD_OOK
    
    // Define power levels
    private let powerLevels = ["-30 dBm", "-20 dBm", "-15 dBm", "-10 dBm", "0 dBm", "5 dBm", "7 dBm", "10 dBm", "13 dBm", "17 dBm", "20 dBm"]
    private let powerValues = [-30, -20, -15, -10, 0, 5, 7, 10, 13, 17, 20]
    
    // Configuration registers (matching Android CONFIG_REGISTERS list)
    private let configRegisters: [(key: String, name: String, address: UInt8)] = [
        ("01", "OPMODE", 0x01), ("02", "DATAMODUL", 0x02), ("03", "BITRATEMSB", 0x03), ("04", "BITRATELSB", 0x04),
        ("05", "FDEVMSB", 0x05), ("06", "FDEVLSB", 0x06), ("07", "FRFMSB", 0x07), ("08", "FRFMID", 0x08),
        ("09", "FRFLSB", 0x09), ("0A", "OSC1", 0x0A), ("0B", "AFCCTRL", 0x0B), ("0C", "LOWBAT", 0x0C),
        ("0D", "LISTEN1", 0x0D), ("0E", "LISTEN2", 0x0E), ("0F", "LISTEN3", 0x0F), ("11", "PALEVEL", 0x11),
        ("12", "PARAMP", 0x12), ("13", "OCP", 0x13), ("18", "LNA", 0x18), ("19", "RXBW", 0x19),
        ("1A", "AFCBW", 0x1A), ("1B", "OOKPEAK", 0x1B), ("1C", "OOKAVG", 0x1C), ("1D", "OOKFIX", 0x1D),
        ("1E", "AFCFEI", 0x1E), ("1F", "AFCMSB", 0x1F), ("20", "AFCLSB", 0x20), ("21", "FEIMSB", 0x21),
        ("22", "FEILSB", 0x22), ("23", "RSSICONFIG", 0x23), ("25", "DIOMAPPING1", 0x25), ("26", "DIOMAPPING2", 0x26),
        ("27", "IRQFLAGS1", 0x27), ("28", "IRQFLAGS2", 0x28), ("29", "RSSITHRESH", 0x29), ("2A", "RXTIMEOUT1", 0x2A),
        ("2B", "RXTIMEOUT2", 0x2B), ("2C", "PREAMBLEMSB", 0x2C), ("2D", "PREAMBLELSB", 0x2D), ("2E", "SYNCCONFIG", 0x2E),
        ("37", "PACKETCONFIG1", 0x37), ("38", "PAYLOADLENGTH", 0x38), ("39", "NODEADRS", 0x39), ("3A", "BROADCASTADRS", 0x3A),
        ("3B", "AUTOMODES", 0x3B), ("3C", "FIFOTHRESH", 0x3C), ("3D", "PACKETCONFIG2", 0x3D)
    ]
    
    // Status registers
    private let statusRegisters: [(key: String, name: String, address: UInt8)] = [
        ("10", "VERSION", 0x10), ("24", "RSSIVALUE", 0x24), ("4E", "TEMP1", 0x4E), ("4F", "TEMP2", 0x4F)
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
                setupRFM69()
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
                setupRFM69()
            } else if !connected {
                // Close SPI device when disconnected
                if let rfm69 = rfm69 {
                    _ = rfm69.closeDevice()
                }
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
            
            Text("Connect to an EMWaver device to control the RFM69 radio.")
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
                Text("RFM69 Registers")
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
    
    private func setupRFM69() {
        print("Setting up RFM69 in ISM View")
        // Initialize RFM69 if needed
        if rfm69 == nil {
            rfm69 = RFM69(bleManager: bleManager)
        }
        
        // Check BLE connection before proceeding
        if !bleManager.isConnected {
            statusMessage = "Not connected to BLE device"
            isLoading = false
            return
        }
        
        // Ensure SPI device is open before any operations
        if !rfm69!.openDevice() {
            print("RFM69: Failed to open SPI device")
            statusMessage = "Failed to initialize RFM69"
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
        guard let rfm69 = rfm69 else {
            showLoadingAlert = false
            return
        }
        
        isLoadingRegisters = true
        registerLoadingProgress = 0.0
        
        // Clear register values
        registerValues.removeAll()
        
        // Set up command observer to update the current command display
        rfm69.setCommandObserver { command in
            Task { @MainActor in
                self.currentCommand = command
            }
        }
        
        // Use Task to perform loading asynchronously
        Task {
            // Set total steps (RF parameters + config registers + status registers)
            let totalSteps = 5 + configRegisters.count + statusRegisters.count
            await MainActor.run {
                totalLoadSteps = totalSteps
                completedLoadSteps = 0
            }
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
            let freqValue = rfm69.getFrequency()
            await MainActor.run {
                frequency = String(format: "%.6f", freqValue)
                currentStep += 1
                completedLoadSteps = currentStep
                registerLoadingProgress = Double(currentStep) / Double(totalSteps)
            }
            
            // Get data rate
            await MainActor.run {
                loadingAlertMessage = "Loading parameters... (2/5)"
            }
            let rateValue = rfm69.getDataRate()
            await MainActor.run {
                dataRate = String(rateValue)
                currentStep += 1
                completedLoadSteps = currentStep
                registerLoadingProgress = Double(currentStep) / Double(totalSteps)
            }
            
            // Get bandwidth
            await MainActor.run {
                loadingAlertMessage = "Loading parameters... (3/5)"
            }
            let bwValue = rfm69.getBandwidth()
            await MainActor.run {
                bandwidth = String(format: "%.1f", bwValue)
                currentStep += 1
                completedLoadSteps = currentStep
                registerLoadingProgress = Double(currentStep) / Double(totalSteps)
            }
            
            // Get deviation
            await MainActor.run {
                loadingAlertMessage = "Loading parameters... (4/5)"
            }
            let devValue = rfm69.getDeviation()
            await MainActor.run {
                deviation = String(devValue)
                currentStep += 1
                completedLoadSteps = currentStep
                registerLoadingProgress = Double(currentStep) / Double(totalSteps)
            }
            
            // Get modulation and power level
            await MainActor.run {
                loadingAlertMessage = "Loading parameters... (5/5)"
            }
            let modValue = rfm69.getModulation()
            let powValue = rfm69.getPowerLevel()
            await MainActor.run {
                selectedModulation = modulationValues.firstIndex(of: modValue) ?? 0
                selectedPower = powerValues.firstIndex(of: powValue) ?? 4
                currentStep += 1
                completedLoadSteps = currentStep
                registerLoadingProgress = Double(currentStep) / Double(totalSteps)
            }
            
            // Step 2: Configuration registers
            await MainActor.run {
                loadingAlertMessage = "Loading registers... (1/2)"
            }
            for (index, register) in configRegisters.enumerated() {
                if loadingRegistersCancelled {
                    await MainActor.run {
                        showLoadingAlert = false
                        isLoadingRegisters = false
                    }
                    return
                }
                
                let value = rfm69.readReg(addr: register.address)
                
                await MainActor.run {
                    registerValues[register.key] = String(format: "%02X", value)
                    currentStep += 1
                    completedLoadSteps = currentStep
                    registerLoadingProgress = Double(currentStep) / Double(totalSteps)
                    
                    // Update loading message occasionally
                    if index % 10 == 0 {
                        loadingAlertMessage = "Loading config registers... (\(index)/\(configRegisters.count))"
                    }
                }
                
                // Short delay to allow UI to remain responsive
                try? await Task.sleep(nanoseconds: 10_000_000) // 10ms delay
            }
            
            // Step 3: Status registers
            await MainActor.run {
                loadingAlertMessage = "Loading status registers... (2/2)"
            }
            for register in statusRegisters {
                if loadingRegistersCancelled {
                    await MainActor.run {
                        showLoadingAlert = false
                        isLoadingRegisters = false
                    }
                    return
                }
                
                let value = rfm69.readReg(addr: register.address)
                
                await MainActor.run {
                    registerValues[register.key] = String(format: "%02X", value)
                    currentStep += 1
                    completedLoadSteps = currentStep
                    registerLoadingProgress = Double(currentStep) / Double(totalSteps)
                }
                
                try? await Task.sleep(nanoseconds: 10_000_000) // 10ms delay
            }
            
            // Complete loading
            await MainActor.run {
                registerLoadingProgress = 1.0
                completedLoadSteps = totalSteps
                isLoadingRegisters = false
                showLoadingAlert = false
                statusMessage = "Settings loaded successfully"
                loadingAlertMessage = "Loading RFM69 parameters..." // Reset for next time
                currentCommand = "Preparing..."
                // Clear command observer
                rfm69.clearCommandObserver()
            }
        }
    }
    
    // MARK: - Control Methods
    
    private func setFrequency(_ freq: Double) {
        guard let rfm69 = rfm69 else { return }
        
        isLoading = true
        rfm69.setFrequencyMHz(Float(freq))
        let actualFreq = rfm69.getFrequency()
        frequency = String(format: "%.6f", actualFreq)
        statusMessage = "Frequency set to \(actualFreq) MHz"
        isLoading = false
    }
    
    private func setDataRate(_ rate: Int) {
        guard let rfm69 = rfm69 else { return }
        
        isLoading = true
        rfm69.setDataRate(rate)
        let actualRate = rfm69.getDataRate()
        dataRate = String(actualRate)
        statusMessage = "Data rate set to \(actualRate) bps"
        isLoading = false
    }
    
    private func setBandwidth(_ bw: Double) {
        guard let rfm69 = rfm69 else { return }
        
        isLoading = true
        if rfm69.setBandwidth(bw) {
            let actualBw = rfm69.getBandwidth()
            bandwidth = String(format: "%.1f", actualBw)
            statusMessage = "Bandwidth set to \(actualBw) kHz"
        } else {
            statusMessage = "Failed to set bandwidth"
        }
        isLoading = false
    }
    
    private func setDeviation(_ dev: Int) {
        guard let rfm69 = rfm69 else { return }
        
        isLoading = true
        rfm69.setDeviation(dev)
        let actualDev = rfm69.getDeviation()
        deviation = String(actualDev)
        statusMessage = "Deviation set to \(actualDev) Hz"
        isLoading = false
    }
    
    private func setModulation(_ mod: Int) {
        guard let rfm69 = rfm69 else { return }
        
        isLoading = true
        rfm69.setModulation(mod)
        statusMessage = "Modulation set to \(modulationFormats[selectedModulation])"
        isLoading = false
    }
    
    private func setPowerLevel(_ power: Int) {
        guard let rfm69 = rfm69 else { return }
        
        isLoading = true
        if rfm69.setPowerLevel(power) {
            statusMessage = "Power level set to \(power) dBm"
        } else {
            statusMessage = "Failed to set power level"
            // Revert selection
            let currentPower = rfm69.getPowerLevel()
            selectedPower = powerValues.firstIndex(of: currentPower) ?? 4
        }
        isLoading = false
    }
    
    private func resetRadio() {
        guard let rfm69 = rfm69 else { return }
        
        isLoading = true
        // RFM69 reset: set to sleep mode then standby
        rfm69.setMode(RFM69.MODE_SLEEP)
        Thread.sleep(forTimeInterval: 0.1)
        rfm69.setMode(RFM69.MODE_STANDBY)
        Thread.sleep(forTimeInterval: 0.1)
        
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
