import SwiftUI
import Combine // Added for Timer

struct EMWaverView: View {
    @EnvironmentObject var bleManager: BLEManager // Use shared BLEManager from environment
    @State private var commandInput = ""
    @State private var showHex = true
    @State private var showAscii = true
    @State private var serialMonitorText = "" // Local state for serial monitor
    @State private var jsEngine: JavaScriptEngine? // Add reference to JavaScriptEngine

    // Timer to fetch data from BLEManager buffer
    let timer = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect() // 100ms interval like Android
    
    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // Connection Section
                GroupBox(label: Label("Connection", systemImage: "antenna.radiowaves.left.and.right").font(.headline)) {
                    HStack {
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
                            Circle()
                                .fill(getConnectionStatusColor())
                                .frame(width: 12, height: 12)
                            Text(getConnectionStatusText())
                                .font(.subheadline)
                                .foregroundColor(getConnectionStatusColor())
                        }
                        .frame(width: 120)
                        .padding(.horizontal)
                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal)
                
                // Command Input Section
                GroupBox(label: Label("Command Input", systemImage: "terminal").font(.headline)) {
                    VStack(spacing: 12) {
                        HStack {
                            TextField("e.g., ble?[0x00][255][0xFF]", text: $commandInput)
                                .textFieldStyle(RoundedBorderTextFieldStyle())
                                .padding(.trailing, 8)
                            
                            Button(action: {
                                sendPacket()
                            }) {
                                HStack {
                                    Image(systemName: "paperplane.fill")
                                    Text("Send")
                                }
                                .padding(10)
                                .background(Color.blue.opacity(0.8))
                                .foregroundColor(.white)
                                .cornerRadius(10)
                            }
                            .disabled(!bleManager.isConnected)
                        }
                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal)
                
                // Serial Monitor Section
                GroupBox(label: Label("Serial Monitor", systemImage: "doc.text").font(.headline)) {
                    VStack {
                        ScrollViewReader { scrollViewProxy in // Added ScrollViewReader for auto-scroll
                            ScrollView {
                                // Use the local serialMonitorText state
                                if serialMonitorText.isEmpty {
                                    Text("Serial monitor output will appear here.")
                                        .font(.system(.body, design: .monospaced))
                                        .foregroundColor(Color.green.opacity(0.7))
                                        .padding(8)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                } else {
                                    // Display the formatted text directly
                                    Text(serialMonitorText)
                                        .font(.system(.body, design: .monospaced))
                                        .foregroundColor(Color.green.opacity(0.8)) // Basic coloring, can refine later if needed
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.bottom, 1) // Ensure last line is visible
                                        .id("bottom") // ID for scrolling
                                }
                            }
                            .background(Color.black)
                            .cornerRadius(8)
                            .frame(minHeight: 200, maxHeight: 200)
                            .onChange(of: serialMonitorText) { _ in // Auto-scroll on change
                                withAnimation {
                                    scrollViewProxy.scrollTo("bottom", anchor: .bottom)
                                }
                            }
                        }

                        HStack {
                            HStack(spacing: 20) {
                                Toggle("HEX", isOn: $showHex)
                                    .toggleStyle(SwitchToggleStyle(tint: .blue))
                                Toggle("ASCII", isOn: $showAscii)
                                    .toggleStyle(SwitchToggleStyle(tint: .blue))
                            }
                            
                            Spacer()
                            
                            Button(action: {
                                clearSerialMonitor()
                            }) {
                                HStack {
                                    Image(systemName: "trash")
                                    Text("Clear")
                                }
                                .padding(10)
                                .background(Color.red.opacity(0.7))
                                .foregroundColor(.white)
                                .cornerRadius(10)
                            }
                        }
                        .padding(.top, 8)
                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal)
            }
            .padding(.vertical)
        }
        .navigationTitle("EMWaver BLE Control")
        .navigationBarTitleDisplayMode(.inline)
        .onReceive(timer) { _ in // Action for the timer
            fetchAndDisplayBufferedData()
        }
        .onAppear {
            // Initialize the JavaScript engine when the view appears
            if bleManager.isConnected && jsEngine == nil {
                setupJSEngine()
            }

            // Add this code for opaque navigation bar
            let appearance = UINavigationBarAppearance()
            appearance.configureWithOpaqueBackground()
            UINavigationBar.appearance().standardAppearance = appearance
            UINavigationBar.appearance().compactAppearance = appearance
            UINavigationBar.appearance().scrollEdgeAppearance = appearance
            // End of added code
        }
        .onChange(of: bleManager.isConnected) { connected in
            if connected && jsEngine == nil {
                setupJSEngine()
            }
        }
        .onDisappear {
            // --- Add Logging Here ---
            print("!!! BLEView disappearing.")
            // Check state immediately
            if let peripheral = bleManager.connectedPeripheral { // Use the public accessor
                print("!!! BLEView onDisappear: Peripheral state is \(peripheral.state.rawValue)") // Raw value for more detail maybe
            } else {
                print("!!! BLEView onDisappear: Peripheral device is nil.")
            }

            // Check state after a small delay
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                if let peripheral = bleManager.connectedPeripheral {
                     print("!!! BLEView 0.1s after disappear: Peripheral state is \(peripheral.state.rawValue)")
                     // If disconnected here without delegate call, it's confirmation
                     if peripheral.state == .disconnected || peripheral.state == .disconnecting {
                         print("!!! Peripheral disconnected shortly after view disappear, but didDisconnect delegate likely wasn't called.")
                         // Potentially trigger a manual reconnect attempt here if needed
                         // bleManager.attemptReconnect() // You'd need to implement this
                     }
                }
            }
        }
    }
    
    // Helper functions
    private func getConnectionStatusText() -> String {
        if bleManager.isScanning {
            return "Scanning..."
        } else if bleManager.isConnected {
            return "Connected"
        } else {
            return "Not connected"
        }
    }
    
    private func getConnectionStatusColor() -> Color {
        if bleManager.isScanning {
            return .orange
        } else if bleManager.isConnected {
            return .green
        } else {
            return .red
        }
    }
    
    private func sendPacket() {
        guard !commandInput.isEmpty else { return }

        if let data = BLEManager.parseCommand(commandInput) {
            // Log the packet being sent to the local serial monitor
            logToSerialMonitor(data: data, direction: .transmit)
            bleManager.sendPacket(data)
            commandInput = "" // Clear input after sending
        } else {
            // Add error feedback to the local serial monitor
            let timestamp = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
            let errorMessage = "[\(timestamp)] Error: Invalid packet format for input: \(commandInput)"

            DispatchQueue.main.async {
                self.serialMonitorText += "\(errorMessage)\n"
            }
        }
    }
    
    private func clearSerialMonitor() {
        DispatchQueue.main.async {
            // Clear the local state
            self.serialMonitorText = ""
        }
    }

    // New function to fetch data from BLEManager buffer and update local state
    private func fetchAndDisplayBufferedData() {
        guard bleManager.isConnected else { return } // Only fetch if connected

        if let data = bleManager.getCommand(), !data.isEmpty {
            logToSerialMonitor(data: data, direction: .receive)
        }
    }

    // Helper to format and log data to the local serial monitor state
    private func logToSerialMonitor(data: Data, direction: BLEManager.DataDirection) {
        let timestamp = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        let dirSymbol = direction == .transmit ? "TX" : "RX"
        var logEntry = "[\(timestamp)] \(dirSymbol): "

        if showHex {
            logEntry += "\(BLEManager.dataToHexString(data))"
        }

        if showHex && showAscii {
            logEntry += " | "
        }

        if showAscii {
            logEntry += "\"\(BLEManager.dataToAsciiString(data))\""
        }

        DispatchQueue.main.async {
            self.serialMonitorText += "\(logEntry)\n"
        }
    }
    
    // Setup JavaScript engine for this view
    private func setupJSEngine() {
        jsEngine = JavaScriptEngine(bleManager: bleManager)
        jsEngine?.setupContext(printCallback: { message in
            DispatchQueue.main.async {
                self.serialMonitorText += "JS: \(message)\n"
            }
        })
        
        // Set up CC1101 if needed later
        let cc1101 = CC1101(bleManager: bleManager)
        jsEngine?.setupCC1101(cc1101)
    }
}

// Enum for direction - needed locally now
enum DataDirection {
    case transmit
    case receive
}

#Preview {
    EMWaverView()
        .environmentObject(BLEManager())
}

// Add BLEManager extension for DataDirection if it's not defined elsewhere
// If DataDirection is intended to be shared, define it outside both classes.
extension BLEManager { // Added extension for DataDirection
    enum DataDirection {
        case transmit
        case receive
    }
} 