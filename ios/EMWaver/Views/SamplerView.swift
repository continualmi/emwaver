import SwiftUI
import DGCharts
import Combine // Needed for PassthroughSubject later

struct LineChartViewController: UIViewControllerRepresentable {
    // Data to be displayed
    var entries: [ChartDataEntry]
    // Callback to notify SamplerView about visible range changes
    var onVisibleRangeChanged: ((Double, Double) -> Void)?
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
            parent.onVisibleRangeChanged?(chartView.lowestVisibleX, chartView.highestVisibleX)
        }

        // Called when translating the chart (pan)
        func chartTranslated(_ chartView: ChartViewBase, dX: CGFloat, dY: CGFloat) {
             guard let chartView = self.chartView else { return }
            parent.onVisibleRangeChanged?(chartView.lowestVisibleX, chartView.highestVisibleX)
        }

         // Called when a gesture ends
         func chartViewDidEndPanning(_ chartView: ChartViewBase) {
             parent.onGestureEnded?()
         }

         // Add other gesture end callbacks if needed (like zoom end)
         // func chartView(_ chartView: ChartViewBase, didEndZoomingWith gesture: UIPinchGestureRecognizer) { ... }

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
    @State private var chartEntries: [ChartDataEntry] = []
    @State private var selectedPinIndex: Int = 5 // Default to GPIO5 (index 5 in PINS array)
    @State private var isRecording: Bool = false // Track recording state
    // Remove the timer for auto-refresh, use gesture/buffer updates instead
    // @State private var timer = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()

    // State to hold current visible range
    @State private var visibleXMin: Double = 0.0
    @State private var visibleXMax: Double = 10000.0 // Initial default max
    @State private var needsCompressionUpdate = PassthroughSubject<Void, Never>() // Use PassthroughSubject for debouncing

    // Add state mirroring Android's gesture tracking
    @State private var currentZoomLevel: CGFloat = 1.0
    @State private var prevRangeStart: Double = 0.0
    @State private var prevRangeEnd: Double = 10000.0

    // Match the PINS array from Android
    let PINS = [
        "GPIO0", "GPIO1 (CC1101 GDO0)", "GPIO2", "GPIO3", "GPIO4 (IR Transmitter)", "GPIO5 (IR Receiver)", "GPIO6", "GPIO7",
        "GPIO8", "GPIO9", "GPIO10", "GPIO11", "GPIO12", "GPIO13", "GPIO14", "GPIO15",
        "GPIO16", "GPIO17", "GPIO18", "GPIO19", "GPIO20", "GPIO21",
        "GPIO26", "GPIO27", "GPIO28", "GPIO29", "GPIO30", "GPIO31", "GPIO32", "GPIO33",
        "GPIO34", "GPIO35", "GPIO36", "GPIO37", "GPIO38", "GPIO39", "GPIO40", "GPIO41",
        "GPIO42", "GPIO43", "GPIO44", "GPIO45", "GPIO46", "GPIO47", "GPIO48"
    ]

    // Number of points/bins for compression
    let numberBins = 500 // Match Android refreshChartFromBuffer logic

    // Weak reference to the actual chart view for accessing scaleX and setting axisMax
    @State private var actualChartView: LineChartView? // Renamed state variable

    var body: some View {
        VStack {
            // Chart - Pass the callbacks
            LineChartViewController(entries: chartEntries) { low, high in
                // Android-style threshold checks before updating state and triggering compression
                handleVisibleRangeChange(low: low, high: high)
            } onGestureEnded: {
                 // Trigger final compression update after gesture stops
                 self.needsCompressionUpdate.send()
            } onChartViewCreated: { chartViewInstance in
                self.actualChartView = chartViewInstance // Assign the instance here
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
            // Load initial chart data using the default visible range
             updateChartWithCompression(rangeStart: visibleXMin, rangeEnd: visibleXMax)
        }
        // Debounced reaction to range changes
        .onReceive(needsCompressionUpdate.debounce(for: .milliseconds(100), scheduler: RunLoop.main)) { _ in
             print("Debounced update: Compressing range \(visibleXMin) - \(visibleXMax)")
             // Pass the current state range to the compression function
             updateChartWithCompression(rangeStart: visibleXMin, rangeEnd: visibleXMax)
        }
        // Reaction to external buffer changes (e.g., new recording data, file load)
        .onChange(of: bleManager.bufferVersion) { _ in
            // Mirror Android's refreshChart: Update data, trigger compression with CURRENT visible range
            print("Buffer changed: Triggering compression for current visible range \(visibleXMin) - \(visibleXMax)")
            // Don't modify visibleXMin/Max here based on buffer size, just trigger recompression of the current view
             updateChartWithCompression(rangeStart: visibleXMin, rangeEnd: visibleXMax)
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
        // Explicitly clear entries if buffer becomes empty before onChange triggers
        if bleManager.getBuffer().isEmpty {
            self.chartEntries = []
            // Reset visible range on clear? Optional.
            // self.visibleXMin = 0
            // self.visibleXMax = 10000
        }
    }

    // MARK: - Chart Update Logic (Centralized Compression)

    // This function now handles all chart updates by compressing the relevant buffer range
    func updateChartWithCompression(rangeStart: Double, rangeEnd: Double) {
        let bufferData = bleManager.getBuffer()
        let totalBits = bufferData.count * 8

        // Update chart axis maximum based on full data length
        DispatchQueue.main.async {
             if let chartView = self.actualChartView {
                 chartView.xAxis.axisMaximum = Double(totalBits)
                 // Ensure min is valid if max changes
                 if chartView.xAxis.axisMinimum >= chartView.xAxis.axisMaximum {
                      chartView.xAxis.axisMinimum = max(0, chartView.xAxis.axisMaximum - 1000) // Ensure min < max
                 }
                 // chartView.notifyDataSetChanged() // Maybe needed if axis change requires redraw
             } else {
                 print("Chart ref nil during axis update")
             }
        }

        if totalBits == 0 {
            // Reset state when buffer clears
            self.chartEntries = []
            self.visibleXMin = 0
            self.visibleXMax = 10000 // Default range
            self.prevRangeStart = 0
            self.prevRangeEnd = 10000
            self.currentZoomLevel = 1.0
            print("Updated chart with 0 data points (empty buffer).")
            return
        }

        // Clamp the requested range to the actual data bounds [0, totalBits]
        let clampedStart = max(0, Int(rangeStart.rounded()))
        let clampedEnd = min(totalBits, Int(rangeEnd.rounded()))
        // Prevent negative range if start > end after clamping/rounding
        let effectiveStart = (clampedEnd < clampedStart) ? clampedEnd : clampedStart
        let effectiveEnd = max(clampedStart, clampedEnd)

         // Avoid compression if the range is invalid or effectively zero
         guard effectiveEnd > effectiveStart else {
             print("Skipping compression: Invalid or zero range [\(effectiveStart), \(effectiveEnd)] after clamping")
             // Optionally clear chart entries if range is truly invalid?
             // self.chartEntries = []
             return
         }

        print("Compressing data for range: [\(effectiveStart), \(effectiveEnd)] with \(numberBins) bins")

        // Call the compression function
        let (timeValues, dataValues) = bleManager.compressDataBits(
            rangeStart: effectiveStart,
            rangeEnd: effectiveEnd,
            numberBins: numberBins
        )

        var entries: [ChartDataEntry] = []
        entries.reserveCapacity(timeValues.count)
        for i in 0..<timeValues.count {
            guard i < dataValues.count else { break }
            entries.append(ChartDataEntry(x: Double(timeValues[i]), y: Double(dataValues[i])))
        }

        // Update chart entries on the main thread
        DispatchQueue.main.async {
            self.chartEntries = entries
             // We do NOT modify visibleXMin/Max or prevRangeStart/End here.
             // Only the gesture handler modifies those state variables.
            print("Updated chart data with \(entries.count) compressed points for range [\(effectiveStart)-\(effectiveEnd)]")
        }
    }

    // Function mirroring Android's gesture checks
    func handleVisibleRangeChange(low: Double, high: Double) {
         guard let chartView = actualChartView else {
              print("Chart view ref not available yet for gesture handling")
              return
         }
         let newZoomLevel = chartView.scaleX
         let visibleRangeStart = low
         let visibleRangeEnd = high

         var needsUpdate = false

         // --- Scale Check (Mirroring Android onChartScale) ---
         // Use a small epsilon to prevent updates from floating point inaccuracies
         if abs(newZoomLevel - currentZoomLevel) >= max(0.01, (currentZoomLevel / 10.0)) {
             print("Significant Zoom Detected: Old=\(currentZoomLevel), New=\(newZoomLevel)")
             currentZoomLevel = newZoomLevel
             // Update state *immediately* to reflect the gesture's effect
             self.visibleXMin = max(0, visibleRangeStart)
             self.visibleXMax = visibleRangeEnd
             // Update prev range as well, as zoom changes the boundaries
             self.prevRangeStart = self.visibleXMin
             self.prevRangeEnd = self.visibleXMax
             needsUpdate = true
         }

         // --- Translate Check (Mirroring Android onChartTranslate) ---
         let span = visibleRangeEnd - visibleRangeStart
         // Avoid threshold checks if span is too small or invalid
         if span > 10 { // Added guard similar to Android comment
             // Use a small epsilon or minimum threshold
             let translationThreshold = max(1.0, span / 100.0) // 1% threshold or min 1.0

             // Check absolute difference from previously recorded range start/end
             if abs(visibleRangeStart - prevRangeStart) > translationThreshold || abs(visibleRangeEnd - prevRangeEnd) > translationThreshold {
                 print("Significant Pan Detected: Old=[\(prevRangeStart)-\(prevRangeEnd)], New=[\(visibleRangeStart)-\(visibleRangeEnd)]")
                 // Update state *immediately*
                 self.visibleXMin = max(0, visibleRangeStart)
                 self.visibleXMax = visibleRangeEnd
                 // Update prev range to the new position
                 self.prevRangeStart = self.visibleXMin
                 self.prevRangeEnd = self.visibleXMax
                 needsUpdate = true
             }
         }

         // If significant change detected by either zoom or pan
         if needsUpdate {
             // Send event to trigger debounced compression
             self.needsCompressionUpdate.send()
         }
    }

    // Converts Data (bytes) into ChartDataEntry array (bits) - Keep for reference or potential future use
    /*
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
    */
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
