import SwiftUI

struct GPIOView: View {
    @EnvironmentObject var bleManager: BLEManager
    @State private var selectedPin = "GPIO0 (IO0)"
    
    let pins = [
        "GPIO0 (IO0)",
        "CC1101 GDO0 (IO1)",
        "CC1101 GDO2 (IO2)",
        "IR TX (IO4)",
        "IR RX (IO5)",
        "GPIO6 (IO6)",
        "GPIO7 (IO7)",
        "GPIO9 (IO9)",
        "CC1101 NSS (IO10)",
        "CC1101 MOSI (IO11)",
        "CC1101 SCK (IO12)",
        "CC1101 MISO (IO13)",
        "GPIO14 (IO14)",
        "GPIO15 (IO15)",
        "GPIO16 (IO16)"
    ]
    
    var body: some View {
        VStack(spacing: 20) {
            // GPIO Control Section
            GroupBox(label: Label("GPIO Control", systemImage: "cpu").font(.headline)) {
                VStack(spacing: 12) {
                    HStack {
                        Text("Select Pin:")
                            .font(.subheadline)
                        
                        Picker("", selection: $selectedPin) {
                            ForEach(pins, id: \.self) { pin in
                                Text(pin)
                            }
                        }
                        .pickerStyle(.menu)
                        .disabled(!bleManager.isConnected)
                        .frame(width: 120)
                    }
                    .padding(.vertical, 4)
                    
                    HStack(spacing: 10) {
                        Button(action: {
                            sendGpioCommand(action: "R")
                        }) {
                            HStack {
                                Image(systemName: "arrow.down.doc")
                                Text("Read")
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(Color.green.opacity(0.8))
                            .foregroundColor(.white)
                            .cornerRadius(10)
                        }
                        .disabled(!bleManager.isConnected)
                        
                        Button(action: {
                            sendGpioCommand(action: "W", value: 1)
                        }) {
                            HStack {
                                Image(systemName: "arrow.up.square")
                                Text("High")
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(Color.orange.opacity(0.8))
                            .foregroundColor(.white)
                            .cornerRadius(10)
                        }
                        .disabled(!bleManager.isConnected)
                        
                        Button(action: {
                            sendGpioCommand(action: "W", value: 0)
                        }) {
                            HStack {
                                Image(systemName: "arrow.down.square")
                                Text("Low")
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(Color.purple.opacity(0.8))
                            .foregroundColor(.white)
                            .cornerRadius(10)
                        }
                        .disabled(!bleManager.isConnected)
                    }
                }
                .padding(.vertical, 8)
            }
            .padding(.horizontal)
            
            Spacer()
        }
    }
    
    // Helper function for sending GPIO commands
    private func sendGpioCommand(action: String, value: UInt8 = 0) {
        // Extract pin number from (IO#)
        let pattern = "\\(IO(\\d+)\\)"
        var pinNumber: Int?
        if let matchRange = selectedPin.range(of: pattern, options: .regularExpression) {
            let matchText = String(selectedPin[matchRange]) // e.g. "(IO12)"
            let numberString = String(matchText.dropFirst(3).dropLast()) // drop "(IO" and ")"
            pinNumber = Int(numberString)
        }
        guard let pin = pinNumber else {
            print("Error: Could not parse pin number from \(selectedPin)")
            return
        }
        // Construct command data
        let commandBytes: [UInt8] = [
            UInt8(ascii: "g".unicodeScalars.first!),
            UInt8(ascii: "p".unicodeScalars.first!),
            UInt8(ascii: "i".unicodeScalars.first!),
            UInt8(ascii: "o".unicodeScalars.first!),
            0,
            UInt8(pin),
            UInt8(action.utf8.first!),
            value
        ]
        let commandData = Data(commandBytes)

        // Send the command via BLEManager
        bleManager.sendPacket(commandData)
    }
}

#Preview {
    GPIOView()
        .environmentObject(BLEManager())
} 