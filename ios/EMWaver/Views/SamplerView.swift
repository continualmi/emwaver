import SwiftUI
import DGCharts
import Combine // Needed for PassthroughSubject later

struct LineChartViewController: UIViewControllerRepresentable {
    // Data to be displayed
    var entries: [ChartDataEntry]
    // Callback to notify SamplerView about visible range changes
    var onVisibleRangeChanged: ((Double, Double, LineChartView) -> Void)?
    // Add callback for when chart interaction ends (optional but good for debouncing)
    var onGestureEnded: (() -> Void)?
    // Add callback for when the underlying chart view is created
    var onChartViewCreated: ((LineChartView) -> Void)?

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
        // Prevent continuous zoom (inertia) after gesture ends
        chartView.dragDecelerationEnabled = false
        // Additional settings to control gestures more tightly
        chartView.doubleTapToZoomEnabled = false // Disable double-tap to zoom
        // chartView.setScaleEnabled(true) // Redundant if setting X/Y individually
        chartView.drawGridBackgroundEnabled = false
        chartView.scaleYEnabled = false // Disable Y-axis scaling (Match Android)
        chartView.scaleXEnabled = true  // Enable X-axis scaling only (Match Android)

        // Set the coordinator as the delegate to receive gesture callbacks
        chartView.delegate = context.coordinator

        // Add chartView as a subview and set constraints
        viewController.view.addSubview(chartView)
        NSLayoutConstraint.activate([
            chartView.topAnchor.constraint(equalTo: viewController.view.topAnchor),
            chartView.leadingAnchor.constraint(equalTo: viewController.view.leadingAnchor),
            chartView.trailingAnchor.constraint(equalTo: viewController.view.trailingAnchor),
            chartView.bottomAnchor.constraint(equalTo: viewController.view.bottomAnchor)
        ])

        // Store chart view in coordinator and call the new callback
        context.coordinator.chartView = chartView
        self.onChartViewCreated?(chartView) // Correct: Call callback via self

        updateChartData(chartView: chartView)
        
        return viewController
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {
        // Update the chart data when SwiftUI state changes
        if let chartView = context.coordinator.chartView {
            // let currentLowestX = chartView.lowestVisibleX // No longer needed for moving view

            updateChartData(chartView: chartView) // Update data and axis limits based on entries

            // Remove the problematic range/position setting logic that locks zoom/pan:
            // chartView.setVisibleXRangeMinimum(1) // REMOVED
            // chartView.setVisibleXRangeMaximum(Double.greatestFiniteMagnitude) // REMOVED
            // chartView.moveViewToX(currentLowestX) // REMOVED

            // The chart should now retain its position/zoom unless data update forces a redraw/rescale
        }
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    class Coordinator: NSObject, ChartViewDelegate {
        var parent: LineChartViewController
        weak var chartView: LineChartView? // Use weak to avoid retain cycles

        init(_ parent: LineChartViewController) {
            self.parent = parent
        }

        // Called when scaling the chart (pinch zoom)
        func chartScaled(_ chartView: ChartViewBase, scaleX: CGFloat, scaleY: CGFloat) {
            guard let chartView = self.chartView else { return }
            parent.onVisibleRangeChanged?(chartView.lowestVisibleX, chartView.highestVisibleX, chartView)
        }

        // Called when translating the chart (pan)
        func chartTranslated(_ chartView: ChartViewBase, dX: CGFloat, dY: CGFloat) {
             guard let chartView = self.chartView else { return }
            parent.onVisibleRangeChanged?(chartView.lowestVisibleX, chartView.highestVisibleX, chartView)
        }

         // Called when a gesture ends
         func chartViewDidEndPanning(_ chartView: ChartViewBase) {
             parent.onGestureEnded?()
         }

         // Add handler for when pinch zoom gesture ends
         func chartViewDidEndZooming(_ chartView: ChartViewBase) {
             parent.onGestureEnded?()
         }
         
         // Implement gesture end callback with UIGestureRecognizer parameter
         func chartView(_ chartView: ChartViewBase, didEndZoomingWith gesture: UIPinchGestureRecognizer) {
             parent.onGestureEnded?()
         }
    }

    // Helper to update chart data
    private func updateChartData(chartView: LineChartView) {
        let dataSet = LineChartDataSet(entries: entries, label: "Demodulator") // Match Android label
        dataSet.drawCirclesEnabled = false // Less clutter with many points
        dataSet.drawValuesEnabled = false // Match Android
        dataSet.lineWidth = 2.0 // Slightly thinner potentially
        
        // Match Android color (#0087FF)
        let androidBlue = UIColor(red: 0.0, green: 135.0/255.0, blue: 255.0/255.0, alpha: 1.0)
        dataSet.setColor(androidBlue)
        dataSet.drawCircleHoleEnabled = false // Solid circles
        dataSet.mode = .linear // Smoother line, or .stepped if preferred
        
        let data = LineChartData(dataSet: dataSet)
        chartView.data = data
        // Optional: Notify chart data has changed if updates are frequent
        // chartView.notifyDataSetChanged()

        // Update X-axis limits based on the actual data range
        if let minX = entries.first?.x, let maxX = entries.last?.x, maxX > minX {
             chartView.xAxis.axisMinimum = minX
             chartView.xAxis.axisMaximum = maxX
        } else {
             // Default if no data or single point
             chartView.xAxis.axisMinimum = 0
             chartView.xAxis.axisMaximum = 1000 // Or some reasonable default
        }
    }
}

// MARK: - Sampler View
struct SamplerView: View {
    @EnvironmentObject var bleManager: BLEManager // Access the shared BLEManager
    @StateObject private var viewModel: SamplerViewModel // Use StateObject for the ViewModel
    @State private var selectedPinIndex: Int = 5 // Default to GPIO5 (index 5 in PINS array)
    @State private var isRecording: Bool = false // Track recording state
    
    // Weak reference to the actual chart view for accessing scaleX and setting axisMax
    @State private var actualChartView: LineChartView?

    // Match the PINS array from Android
    let PINS = [
        "GPIO0", "GPIO1 (CC1101 GDO0)", "GPIO2", "GPIO3", "GPIO4 (IR Transmitter)", "GPIO5 (IR Receiver)", "GPIO6", "GPIO7",
        "GPIO8", "GPIO9", "GPIO10", "GPIO11", "GPIO12", "GPIO13", "GPIO14", "GPIO15",
        "GPIO16", "GPIO17", "GPIO18", "GPIO19", "GPIO20", "GPIO21",
        "GPIO26", "GPIO27", "GPIO28", "GPIO29", "GPIO30", "GPIO31", "GPIO32", "GPIO33",
        "GPIO34", "GPIO35", "GPIO36", "GPIO37", "GPIO38", "GPIO39", "GPIO40", "GPIO41",
        "GPIO42", "GPIO43", "GPIO44", "GPIO45", "GPIO46", "GPIO47", "GPIO48"
    ]
    
    // Initialize ViewModel with BLEManager
    init() {
        // Note: We can't use @EnvironmentObject directly in init,
        // so we create a temporary instance that will be replaced
        _viewModel = StateObject(wrappedValue: SamplerViewModel(bleManager: BLEManager()))
    }

    var body: some View {
        VStack {
            // Chart - Pass the callbacks
            LineChartViewController(entries: viewModel.chartEntries) { low, high, chartView in
                // Pass chart view reference to ViewModel for gesture handling
                viewModel.handleVisibleRangeChange(low: low, high: high, chartView: chartView)
            } onGestureEnded: {
                // When gesture ends, update the view model with isGestureEnded = true
                // to prevent continuous zooming
                if let chartView = self.actualChartView {
                    viewModel.handleVisibleRangeChange(
                        low: chartView.lowestVisibleX,
                        high: chartView.highestVisibleX,
                        chartView: chartView,
                        isGestureEnded: true
                    )
                }
                
                // Trigger final compression update after gesture stops
                viewModel.needsCompressionUpdate.send()
            } onChartViewCreated: { chartViewInstance in
                self.actualChartView = chartViewInstance
            }
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
            // Use provided BLEManager
            viewModel.bleManager = bleManager
            
            // Load initial chart data using the default visible range
            viewModel.updateChartWithCompression(
                rangeStart: viewModel.visibleRangeStart,
                rangeEnd: viewModel.visibleRangeEnd
            )
        }
        // Debounced reaction to range changes
        .onReceive(viewModel.needsCompressionUpdate.debounce(for: .milliseconds(100), scheduler: RunLoop.main)) { _ in
            print("Debounced update: Compressing range \(viewModel.visibleRangeStart) - \(viewModel.visibleRangeEnd)")
            // Pass the current state range to the compression function
            viewModel.updateChartWithCompression(
                rangeStart: viewModel.visibleRangeStart,
                rangeEnd: viewModel.visibleRangeEnd
            )
        }
        // Reaction to external buffer changes (e.g., new recording data, file load)
        .onChange(of: bleManager.bufferVersion) { _ in
            // Update chart axis maximum based on full data length - do this first
            let totalBits = bleManager.getBuffer().count * 8
            DispatchQueue.main.async {
                if let chartView = self.actualChartView {
                    chartView.xAxis.axisMaximum = Double(totalBits)
                    // Ensure min is valid if max changes
                    if chartView.xAxis.axisMinimum >= chartView.xAxis.axisMaximum {
                        chartView.xAxis.axisMinimum = max(0, chartView.xAxis.axisMaximum - 1000) // Ensure min < max
                    }
                    
                    // Force chart to recognize the new axis maximum
                    chartView.notifyDataSetChanged()
                }
            }
            
            // Mirror Android's refreshChart: Update data, trigger compression with CURRENT visible range
            print("Buffer changed: Triggering compression for current visible range \(viewModel.visibleRangeStart) - \(viewModel.visibleRangeEnd)")
            // If the buffer is larger than the visible range, expand the visible range
            if Double(totalBits) > viewModel.visibleRangeEnd {
                // Check if user is viewing the end of the data (within 5% of the current range end)
                let viewingRightEdge = (viewModel.visibleRangeEnd >= viewModel.prevRangeEnd * 0.95)
                if viewingRightEdge {
                    // Auto-expand visible range to match full data
                    viewModel.visibleRangeEnd = Double(totalBits)
                    viewModel.prevRangeEnd = viewModel.visibleRangeEnd
                    print("Auto-expanded visible range to \(viewModel.visibleRangeEnd)")
                }
            }
            
            // Now trigger compression with the potentially updated range
            viewModel.updateChartWithCompression(
                rangeStart: viewModel.visibleRangeStart,
                rangeEnd: viewModel.visibleRangeEnd
            )
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
            // No explicit refresh needed here, onChange(of: bleManager.buffer) will handle it
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
        // No explicit refresh needed here, onChange(of: bleManager.buffer) will handle it
        print("Test Pattern 1 loaded into buffer.")
    }

    func loadTestPattern2() {
        print("Loading Test Pattern 2...")
        let testData = generatePattern2(totalBytes: 2000)
        bleManager.loadBuffer(data: testData)
        // No explicit refresh needed here, onChange(of: bleManager.buffer) will handle it
        print("Test Pattern 2 loaded into buffer.")
    }

    func clearBufferAndChart() {
        print("Clearing buffer and chart...")
        bleManager.clearBuffer()
        // onChange(of: bleManager.buffer) will handle the chart update
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
