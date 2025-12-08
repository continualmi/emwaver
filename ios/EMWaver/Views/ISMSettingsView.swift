import SwiftUI

struct ISMSettingsView: View {
    @StateObject private var settingsManager = SettingsManager.shared
    @Environment(\.dismiss) var dismiss
    
    @State private var csPin: String = ""
    @State private var csActiveHigh: Bool = true
    
    var body: some View {
        Form {
            Section(header: Text("RFM69 SPI Settings")) {
                HStack {
                    Text("CS Pin")
                    Spacer()
                    TextField("36", text: $csPin)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 80)
                }
                
                Toggle("CS Active High", isOn: $csActiveHigh)
            }
            
            Section(header: Text("About")) {
                Text("Configure the Chip Select (CS) pin and polarity for RFM69 SPI communication.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .navigationTitle("ISM Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button("Cancel") {
                    dismiss()
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Save") {
                    saveSettings()
                    dismiss()
                }
            }
        }
        .onAppear {
            csPin = settingsManager.rfm69CsPin
            csActiveHigh = settingsManager.rfm69CsActiveHigh
        }
    }
    
    private func saveSettings() {
        if !csPin.isEmpty {
            settingsManager.updateRfm69CsPin(csPin)
        }
        settingsManager.updateRfm69CsActiveHigh(csActiveHigh)
    }
}

#Preview {
    NavigationView {
        ISMSettingsView()
            .environmentObject(SettingsManager.shared)
    }
}
