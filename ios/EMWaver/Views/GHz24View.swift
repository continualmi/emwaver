import SwiftUI

struct GHz24View: View {
    @EnvironmentObject var bleManager: BLEManager
    @State private var frequency: Double = 2400.0
    @State private var power: Int = 10
    @State private var isTransmitting = false
    @State private var scanResults: [ScanResult] = []
    
    struct ScanResult: Identifiable {
        let id = UUID()
        let frequency: Double
        let signalStrength: Int
    }
    
    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // Connection Status
                GroupBox(label: Label("Connection", systemImage: "antenna.radiowaves.left.and.right").font(.headline)) {
                    HStack {
                        Circle()
                            .fill(bleManager.isConnected ? Color.green : Color.red)
                            .frame(width: 12, height: 12)
                        Text(bleManager.isConnected ? "Connected" : "Not Connected")
                            .font(.subheadline)
                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal)
                
                // Transmitter Controls
                GroupBox(label: Label("2.4 GHz Transmitter", systemImage: "antenna.radiowaves.left.and.right").font(.headline)) {
                    VStack(spacing: 12) {
                        // Frequency slider
                        VStack(alignment: .leading) {
                            Text("Frequency: \(String(format: "%.1f", frequency)) MHz")
                                .font(.subheadline)
                            
                            Slider(value: $frequency, in: 2400...2500, step: 0.1)
                                .disabled(isTransmitting)
                        }
                        
                        // Power slider
                        VStack(alignment: .leading) {
                            Text("Power: \(power) dBm")
                                .font(.subheadline)
                            
                            Slider(value: $power.double, in: 0...20, step: 1)
                                .disabled(isTransmitting)
                        }
                        
                        // Transmit button
                        Button(action: {
                            isTransmitting.toggle()
                            // Placeholder for actual transmit functionality
                        }) {
                            HStack {
                                Image(systemName: isTransmitting ? "stop.fill" : "play.fill")
                                Text(isTransmitting ? "Stop Transmitting" : "Start Transmitting")
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(isTransmitting ? Color.red.opacity(0.8) : Color.green.opacity(0.8))
                            .foregroundColor(.white)
                            .cornerRadius(10)
                        }
                        .disabled(!bleManager.isConnected)
                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal)
                
                // Scanner Controls
                GroupBox(label: Label("2.4 GHz Scanner", systemImage: "magnifyingglass").font(.headline)) {
                    VStack(spacing: 12) {
                        Button(action: {
                            // Placeholder for scan functionality
                            scanResults = [
                                ScanResult(frequency: 2412.0, signalStrength: -45),
                                ScanResult(frequency: 2437.0, signalStrength: -60),
                                ScanResult(frequency: 2462.0, signalStrength: -72)
                            ]
                        }) {
                            HStack {
                                Image(systemName: "arrow.clockwise")
                                Text("Scan 2.4 GHz Band")
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(Color.blue.opacity(0.8))
                            .foregroundColor(.white)
                            .cornerRadius(10)
                        }
                        .disabled(!bleManager.isConnected || isTransmitting)
                        
                        // Scan results
                        if !scanResults.isEmpty {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("Scan Results")
                                    .font(.headline)
                                    .padding(.top, 4)
                                
                                ForEach(scanResults) { result in
                                    HStack {
                                        Text("\(String(format: "%.1f", result.frequency)) MHz")
                                        Spacer()
                                        Text("\(result.signalStrength) dBm")
                                            .foregroundColor(getSignalColor(strength: result.signalStrength))
                                    }
                                    .padding(.vertical, 4)
                                    Divider()
                                }
                            }
                        }
                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal)
            }
            .padding(.vertical)
        }
        .navigationTitle("2.4 GHz")
    }
    
    // Helper function to get signal color based on strength
    private func getSignalColor(strength: Int) -> Color {
        if strength > -50 {
            return .green
        } else if strength > -70 {
            return .yellow
        } else {
            return .red
        }
    }
}

// Extension to allow using Int with Slider which requires Double
extension Int {
    var double: Double {
        get { Double(self) }
        set { self = Int(newValue) }
    }
}

#Preview {
    NavigationView {
        GHz24View()
            .environmentObject(BLEManager())
    }
} 