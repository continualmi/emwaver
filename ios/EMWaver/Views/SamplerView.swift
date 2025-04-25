import SwiftUI
import DGCharts

struct LineChartViewController: UIViewControllerRepresentable {
    // Data to be displayed
    var entries: [ChartDataEntry]

    func makeUIViewController(context: Context) -> UIViewController {
        // Simple UIViewController to host the chart view
        let viewController = UIViewController()
        let chartView = LineChartView()
        
        // Basic chart setup (match Android where applicable)
        chartView.translatesAutoresizingMaskIntoConstraints = false
        chartView.chartDescription.enabled = false
        chartView.legend.enabled = true // Keep legend enabled
        chartView.leftAxis.axisMinimum = -128 // Match Android
        chartView.leftAxis.axisMaximum = 384 // Match Android (256 + 128)
        chartView.rightAxis.enabled = false // Match Android
        chartView.xAxis.labelPosition = .bottom
        chartView.dragEnabled = true
        chartView.pinchZoomEnabled = true
        // chartView.setScaleEnabled(true) // Redundant if setting X/Y individually
        chartView.drawGridBackgroundEnabled = false
        chartView.scaleYEnabled = false // Disable Y-axis scaling (Match Android)
        chartView.scaleXEnabled = true  // Enable X-axis scaling only (Match Android)

        // Add chartView as a subview and set constraints
        viewController.view.addSubview(chartView)
        NSLayoutConstraint.activate([
            chartView.topAnchor.constraint(equalTo: viewController.view.topAnchor),
            chartView.leadingAnchor.constraint(equalTo: viewController.view.leadingAnchor),
            chartView.trailingAnchor.constraint(equalTo: viewController.view.trailingAnchor),
            chartView.bottomAnchor.constraint(equalTo: viewController.view.bottomAnchor)
        ])

        // Store chart view in coordinator for updates
        context.coordinator.chartView = chartView
        updateChartData(chartView: chartView)
        
        return viewController
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {
        // Update the chart data when SwiftUI state changes
        if let chartView = context.coordinator.chartView {
            updateChartData(chartView: chartView)
        }
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    class Coordinator: NSObject {
        var parent: LineChartViewController
        var chartView: LineChartView? // Store the chart view instance

        init(_ parent: LineChartViewController) {
            self.parent = parent
        }
    }

    // Helper to update chart data
    private func updateChartData(chartView: LineChartView) {
        let dataSet = LineChartDataSet(entries: entries, label: "Demodulator") // Match Android label
        dataSet.drawCirclesEnabled = true // Match Android (default is usually true, explicitly enable)
        dataSet.drawValuesEnabled = false // Match Android
        dataSet.lineWidth = 3.0 // Match Android
        
        // Match Android color (#0087FF)
        let androidBlue = UIColor(red: 0.0, green: 135.0/255.0, blue: 255.0/255.0, alpha: 1.0)
        dataSet.setColor(androidBlue)
        dataSet.setCircleColor(androidBlue) // Match Android circle color
        dataSet.circleRadius = 2.0 // Small radius for circles
        dataSet.drawCircleHoleEnabled = false // Solid circles
        
        let data = LineChartData(dataSet: dataSet)
        chartView.data = data
        // Optional: Notify chart data has changed if updates are frequent
        // chartView.notifyDataSetChanged()
    }
}

// MARK: - Sampler View
struct SamplerView: View {
    @EnvironmentObject var bleManager: BLEManager // Access the shared BLEManager
    @State private var chartEntries: [ChartDataEntry] = []
    @State private var selectedPinIndex: Int = 6 // Default to GPIO6 (index 6 in PINS array)
    @State private var isRecording: Bool = false // Track recording state
    @State private var timer = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect() // Timer for auto-refresh

    // Match the PINS array from Android
    let PINS = [
        "GPIO0", "GPIO1 (CC1101 GDO0)", "GPIO2", "GPIO3", "GPIO4 (IR Transmitter)", "GPIO5 (IR Receiver)", "GPIO6", "GPIO7",
        "GPIO8", "GPIO9", "GPIO10", "GPIO11", "GPIO12", "GPIO13", "GPIO14", "GPIO15",
        "GPIO16", "GPIO17", "GPIO18", "GPIO19", "GPIO20", "GPIO21",
        "GPIO26", "GPIO27", "GPIO28", "GPIO29", "GPIO30", "GPIO31", "GPIO32", "GPIO33",
        "GPIO34", "GPIO35", "GPIO36", "GPIO37", "GPIO38", "GPIO39", "GPIO40", "GPIO41",
        "GPIO42", "GPIO43", "GPIO44", "GPIO45", "GPIO46", "GPIO47", "GPIO48"
    ]

    var body: some View {
        VStack {
            // Chart
            LineChartViewController(entries: chartEntries)
                .frame(height: 300)

            // Controls HStack
            HStack {
                // GPIO Pin Picker
                Picker("GPIO Pin", selection: $selectedPinIndex) {
                    ForEach(0..<PINS.count, id: \.self) { index in
                        Text(PINS[index]).tag(index)
                    }
                }
                .pickerStyle(.menu) // Or .wheel, .segmented depending on preference

                Spacer() // Add space between picker and buttons

                // Record/Stop Button
                Button {
                    if isRecording {
                        stopRecording()
                    } else {
                        startRecording()
                    }
                } label: {
                    Text(isRecording ? "Stop" : "Record")
                        .padding(.horizontal)
                        .background(isRecording ? Color.red : Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(5)
                }
                .frame(minWidth: 80) // Ensure minimum size

                // Retransmit Button
                Button("Retransmit") {
                    retransmitSignal()
                }
                .buttonStyle(.borderedProminent)
                 .disabled(bleManager.getBuffer().isEmpty) // Disable if buffer is empty

            }
            .padding(.horizontal)
            .padding(.vertical, 5)

            // Test Pattern Buttons
            HStack {
                Button("Load Test Pattern 1") { loadTestPattern1() }
                    .buttonStyle(.bordered)
                Button("Load Test Pattern 2") { loadTestPattern2() }
                     .buttonStyle(.bordered)
                Spacer()
            }
            .padding(.horizontal)

            Spacer() // Push content to the top
        }
        .navigationTitle("Sampler")
        .onAppear {
            // Load initial test data or refresh based on current buffer
            refreshChartFromBuffer()
        }
        .onReceive(timer) { _ in // Action for the timer
             // Only refresh if not currently recording to avoid UI jumps
             if !isRecording {
                 refreshChartFromBuffer()
             }
        }
        .toolbar {
             ToolbarItemGroup(placement: .navigationBarTrailing) {
                 Button {
                     clearBufferAndChart()
                 } label: {
                     Label("Clear", systemImage: "trash")
                 }
             }
         }
    }

    // MARK: - GPIO Pin Logic
    // Helper to extract the numeric part of the pin string (e.g., "GPIO6" -> 6)
    func getSelectedPinNumber() -> UInt8? {
        guard selectedPinIndex >= 0 && selectedPinIndex < PINS.count else { return nil }
        let selectedPinString = PINS[selectedPinIndex]
        // Extract digits after "GPIO"
        if let range = selectedPinString.range(of: "GPIO") {
             let numberString = selectedPinString[range.upperBound...].split(separator: " ")[0]
             return UInt8(numberString)
        }
        return nil // Should not happen with current PINS array
    }

    // MARK: - Button Actions

    func startRecording() {
        guard let pinNumber = getSelectedPinNumber() else {
            print("Error: Invalid pin selected")
            return
        }
        
        // Debug: Print the selected pin
        print("Selected pin: \(PINS[selectedPinIndex]) (\(pinNumber))")
        
        // Option 1: Send as raw bytes (preferred for ESP32)
        let commandBytes: [UInt8] = [0x72, 0x61, 0x77, pinNumber] // "raw" + pin number
        let commandData = Data(commandBytes)
        
        // Debug: Print the command data
        print("Sending command bytes: \(commandBytes.map { String(format: "%02X", $0) }.joined(separator: " "))")
        
        bleManager.sendPacket(commandData)
        isRecording = true
    }

    func stopRecording() {
        print("Sending stop recording command: s")
        if let commandData = BLEManager.parseCommand("s") {
            bleManager.sendPacket(commandData)
            isRecording = false
            // Refresh chart after stopping to show any received data
             refreshChartFromBuffer() // Might need a small delay
        } else {
            print("Error: Could not parse command: s")
        }

    }

    func retransmitSignal() {
        guard !bleManager.getBuffer().isEmpty else {
            print("Buffer is empty, cannot retransmit.")
            // Optionally show an alert
            return
        }
        guard let pinNumber = getSelectedPinNumber() else {
            print("Error: Invalid pin selected for retransmit")
            return
        }

        // Send the 'tran[pin]' command first
        let commandString = "tran[\(pinNumber)]"
        if let commandData = BLEManager.parseCommand(commandString) {
            print("Sending retransmit command: \(commandString)")
            bleManager.sendPacket(commandData)

             // Wait briefly maybe? Android sends command then calls transmitBuffer immediately.
             DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { // Short delay
                 print("Calling transmitBuffer...")
                 bleManager.transmitBuffer()
             }
        } else {
              print("Error: Could not parse command: \(commandString)")
        }
    }

    // MARK: - Test Pattern Loading (Keep generatePattern1, add generatePattern2)

    func generatePattern1(totalBytes: Int) -> Data {
        var testSignal = Data(capacity: totalBytes)
        for i in 0..<totalBytes {
            testSignal.append((i % 2 == 0) ? 0xFF : 0x00)
        }
        return testSignal
    }

    func generatePattern2(totalBytes: Int) -> Data {
        var testSignal = Data(capacity: totalBytes)
        for i in 0..<totalBytes {
            let positionInBlock = i % 256
            if positionInBlock == 0 || positionInBlock == 255 {
                testSignal.append(0xFF)
            } else {
                testSignal.append(0x00)
            }
        }
        return testSignal
    }

    func loadTestPattern1() {
        print("Loading Test Pattern 1...")
        let testData = generatePattern1(totalBytes: 2000) // Generate 2000 bytes
        bleManager.loadBuffer(data: testData) // Use BLEManager's buffer
        refreshChartFromBuffer()
        print("Test Pattern 1 loaded into buffer.")
    }

    func loadTestPattern2() {
        print("Loading Test Pattern 2...")
        let testData = generatePattern2(totalBytes: 2000)
        bleManager.loadBuffer(data: testData)
        refreshChartFromBuffer()
        print("Test Pattern 2 loaded into buffer.")
    }

    func clearBufferAndChart() {
        print("Clearing buffer and chart...")
        bleManager.clearBuffer()
        refreshChartFromBuffer()
    }

    // MARK: - Chart Update Logic

    func refreshChartFromBuffer() {
        // For now, just show the entire buffer. We will add compression later.
        let bufferData = bleManager.getBuffer()
        self.chartEntries = dataToChartEntries(data: bufferData)
        print("Refreshed chart with \(chartEntries.count) data points from buffer (\(bufferData.count) bytes).")
    }

    // Converts Data (bytes) into ChartDataEntry array (bits) - Existing function
    func dataToChartEntries(data: Data) -> [ChartDataEntry] {
        var entries: [ChartDataEntry] = []
        entries.reserveCapacity(data.count * 8)

        for (byteIndex, byte) in data.enumerated() {
            for bitIndex in 0..<8 {
                let bit = (byte >> bitIndex) & 1
                let xValue = Double(byteIndex * 8 + bitIndex)
                let yValue = Double(bit * 255) // Plot 0 or 255
                entries.append(ChartDataEntry(x: xValue, y: yValue))
            }
        }
        return entries
    }
}


struct SamplerView_Previews: PreviewProvider {
    static var previews: some View {
        // Provide a mock BLEManager for the preview
        NavigationView {
            SamplerView()
                .environmentObject(BLEManager()) // Ensure BLEManager is injected for preview
        }
    }
}
