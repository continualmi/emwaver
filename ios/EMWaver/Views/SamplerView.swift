import SwiftUI
import DGCharts
import Combine // Needed for PassthroughSubject

struct LineChartViewController: UIViewControllerRepresentable {
    // Data to be displayed
    var entries: [ChartDataEntry]
    // Callback for zoom gestures
    var onChartScale: ((Float, Float) -> Void)?
    // Callback for pan gestures
    var onChartTranslate: ((Float, Float) -> Void)?
    // Callback for updating state when creating the chart
    var onChartCreated: ((LineChartView) -> Void)?

    func makeUIViewController(context: Context) -> UIViewController {
        // Simple UIViewController to host the chart view
        let viewController = UIViewController()
        let chartView = LineChartView()
        
        // Basic chart setup - EXACTLY MATCH ANDROID
        chartView.translatesAutoresizingMaskIntoConstraints = false
        chartView.chartDescription.enabled = false
        chartView.legend.enabled = true
        
        // Y-axis setup - EXACTLY MATCH ANDROID
        chartView.leftAxis.axisMinimum = -128
        chartView.leftAxis.axisMaximum = 384 // 256 + 128
        chartView.rightAxis.enabled = false
        
        // X-axis setup - EXACTLY MATCH ANDROID
        chartView.xAxis.labelPosition = .bottom
        
        // Gesture setup - EXACTLY MATCH ANDROID
        chartView.dragEnabled = true
        chartView.pinchZoomEnabled = true
        chartView.dragDecelerationEnabled = false
        chartView.doubleTapToZoomEnabled = false
        chartView.drawGridBackgroundEnabled = false
        chartView.scaleYEnabled = false // Only scale X-axis like Android
        chartView.scaleXEnabled = true
        
        // ENHANCED: Improve responsiveness
        chartView.highlightPerTapEnabled = false
        chartView.maxVisibleCount = 0 // Unlimited visible entries
        chartView.autoScaleMinMaxEnabled = false
        
        // Ensure chart responds directly to touch events
        chartView.isUserInteractionEnabled = true
        
        // Set delegate for callbacks
        chartView.delegate = context.coordinator

        // Add chartView as a subview and set constraints
        viewController.view.addSubview(chartView)
        NSLayoutConstraint.activate([
            chartView.topAnchor.constraint(equalTo: viewController.view.topAnchor),
            chartView.leadingAnchor.constraint(equalTo: viewController.view.leadingAnchor),
            chartView.trailingAnchor.constraint(equalTo: viewController.view.trailingAnchor),
            chartView.bottomAnchor.constraint(equalTo: viewController.view.bottomAnchor)
        ])

        // Store chart view in coordinator
        context.coordinator.chartView = chartView
        
        // Call creation callback
        self.onChartCreated?(chartView)

        // Initialize with data
        updateChartData(chartView: chartView)
        
        return viewController
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {
        if let chartView = context.coordinator.chartView {
            updateChartData(chartView: chartView)
        }
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    class Coordinator: NSObject, ChartViewDelegate {
        var parent: LineChartViewController
        weak var chartView: LineChartView?
        // Exactly like Android - track current zoom level
        var currentZoomLevel: Float = 1.0
        var prevRangeStart: Float = 0
        var prevRangeEnd: Float = 0

        init(_ parent: LineChartViewController) {
            self.parent = parent
        }

        // EXACTLY MATCH ANDROID - Called when scaling the chart
        func chartScaled(_ chartView: ChartViewBase, scaleX: CGFloat, scaleY: CGFloat) {
            guard let lineChartView = chartView as? LineChartView else { return }
            let newZoomLevel = Float(lineChartView.scaleX)
            
            // Use same 10% threshold as Android
            if abs(newZoomLevel - currentZoomLevel) >= (newZoomLevel/10) {
                currentZoomLevel = newZoomLevel
                
                // Call scale callback with exact same parameters
                parent.onChartScale?(newZoomLevel, Float(scaleY))
            }
        }

        // EXACTLY MATCH ANDROID - Called when translating the chart
        func chartTranslated(_ chartView: ChartViewBase, dX: CGFloat, dY: CGFloat) {
            guard let lineChartView = chartView as? LineChartView else { return }
            let visibleRangeStart = Float(lineChartView.lowestVisibleX)
            let visibleRangeEnd = Float(lineChartView.highestVisibleX)
            
            let span = visibleRangeEnd - visibleRangeStart
            let translationThreshold = span / 100.0
            
            // Check boundaries (match Android)
            if (visibleRangeStart <= 0 && dX > 0) || (visibleRangeEnd >= Float(lineChartView.xAxis.axisMaximum) && dX < 0) {
                return
            }
            
            // Use same threshold check as Android
            if (abs(visibleRangeStart - prevRangeStart) > translationThreshold ||
                abs(visibleRangeEnd - prevRangeEnd) > translationThreshold) &&
                span >= 10 {
                
                prevRangeStart = visibleRangeStart
                prevRangeEnd = visibleRangeEnd
                
                // Call translate callback with exact same parameters
                parent.onChartTranslate?(Float(dX), Float(dY))
            }
        }
    }

    // Helper to update chart data - EXACTLY MATCH ANDROID
    private func updateChartData(chartView: LineChartView) {
        let dataSet = LineChartDataSet(entries: entries, label: "Demodulator")
        dataSet.drawCirclesEnabled = true
        dataSet.circleRadius = 2.0
        dataSet.drawValuesEnabled = false
        
        // Match Android color exactly - #0087FF
        let androidBlue = UIColor(red: 0.0, green: 135.0/255.0, blue: 255.0/255.0, alpha: 1.0)
        dataSet.setColor(androidBlue)
        dataSet.setCircleColor(androidBlue)
        
        // Match Android line width exactly - 3.0f
        dataSet.lineWidth = 3.0
        
        // Other settings to match Android exactly
        dataSet.drawCircleHoleEnabled = false
        dataSet.mode = .linear
        
        let data = LineChartData(dataSet: dataSet)
        chartView.data = data
        chartView.notifyDataSetChanged()
    }
}

// MARK: - Sampler View
struct SamplerView: View {
    @EnvironmentObject var bleManager: BLEManager
    @StateObject private var viewModel: SamplerViewModel
    @State private var selectedPinIndex: Int = 5 // Default to GPIO5
    @State private var isRecording: Bool = false
    
    // Chart state - MATCH ANDROID
    @State private var chartEntries: [ChartDataEntry] = []
    @State private var chartView: LineChartView?
    @State private var chartMinX: Double = 0
    @State private var chartMaxX: Double = 10000
    @State private var currentZoomLevel: CGFloat = 1.0
    @State private var prevRangeStart: Double = 0
    @State private var prevRangeEnd: Double = 0
    @State private var lastBufferSize: Int = 0
    
    // EXACTLY match Android's PINS array 
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
        _viewModel = StateObject(wrappedValue: SamplerViewModel(bleManager: BLEManager()))
    }

    var body: some View {
        VStack {
            // Chart view
            LineChartViewController(entries: chartEntries,
                                   onChartScale: { scaleX, scaleY in
                // EXACTLY match Android scale handling
                if let chartView = self.chartView {
                    let visibleRangeStart = chartView.lowestVisibleX
                    let visibleRangeEnd = chartView.highestVisibleX
                    
                    viewModel.setVisibleRangeStart(visibleRangeStart)
                    viewModel.setVisibleRangeEnd(visibleRangeEnd)
                    
                    // Update chart with compressed data
                    updateChartWithCompression(
                        visibleRangeStart: visibleRangeStart,
                        visibleRangeEnd: visibleRangeEnd
                    )
                }
            }, onChartTranslate: { dX, dY in
                // EXACTLY match Android translation handling
                if let chartView = self.chartView {
                    let visibleRangeStart = chartView.lowestVisibleX
                    let visibleRangeEnd = chartView.highestVisibleX
                    
                    viewModel.setVisibleRangeStart(visibleRangeStart)
                    viewModel.setVisibleRangeEnd(visibleRangeEnd)
                    
                    // Update chart with compressed data
                    updateChartWithCompression(
                        visibleRangeStart: visibleRangeStart,
                        visibleRangeEnd: visibleRangeEnd
                    )
                }
            }, onChartCreated: { chartView in
                // Store the chart view and initialize it
                self.chartView = chartView
                
                // Configure initial chart settings
                chartView.xAxis.axisMinimum = self.chartMinX
                chartView.xAxis.axisMaximum = self.chartMaxX
                
                // Initial refresh
                self.refreshChart()
            })
            .frame(height: 300)

            // Controls HStack
            HStack {
                // GPIO Pin Picker
                Picker("GPIO Pin", selection: $selectedPinIndex) {
                    ForEach(0..<PINS.count, id: \.self) { index in
                        Text(PINS[index]).tag(index)
                    }
                }
                .pickerStyle(.menu)

                Spacer()

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
                .frame(minWidth: 80)

                // Retransmit Button
                Button("Retransmit") {
                    retransmitSignal()
                }
                .buttonStyle(.borderedProminent)
                .disabled(bleManager.getBuffer().isEmpty)
            }
            .padding(.horizontal)
            .padding(.vertical, 5)

            // Action Buttons Row
            HStack {
                Button("Convert to IR") {
                    convertToIR()
                }
                .buttonStyle(.bordered)
                
                Spacer()
            }
            .padding(.horizontal)

            // Test Pattern Buttons
            HStack {
                Button("Load Test Pattern 1") { loadTestPattern1() }
                    .buttonStyle(.bordered)
                Button("Load Test Pattern 2") { loadTestPattern2() }
                    .buttonStyle(.bordered)
                Spacer()
            }
            .padding(.horizontal)

            Spacer()
        }
        .navigationTitle("Sampler")
        .onAppear {
            // Connect ViewModel to BLEManager
            viewModel.bleManager = bleManager
            
            // Initial refresh
            refreshChart()
            
            // Setup timer to periodically refresh chart - MATCH ANDROID
            // Use DispatchQueue instead of Timer for better control
            let refreshQueue = DispatchQueue(label: "com.emwaver.chartRefresh", qos: .userInteractive)
            refreshQueue.async {
                while true {
                    // Refresh at 100ms intervals (10Hz) to match Android
                    Thread.sleep(forTimeInterval: 0.1)
                    
                    // Dispatch refresh to main thread
                    DispatchQueue.main.async { [self] in
                        refreshChart()
                    }
                }
            }
        }
        .onChange(of: bleManager.bufferVersion) { _ in
            // Buffer changed - refresh chart
            refreshChart()
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
    
    // MARK: - Chart Functions
    
    // Refresh chart - EXACTLY MATCH ANDROID refreshChart()
    func refreshChart() {
        guard let chartView = self.chartView else { return }
        
        let currentBufferSize = bleManager.getBuffer().count
        if currentBufferSize != lastBufferSize {
            lastBufferSize = currentBufferSize
            
            // Update ranges from chart
            let visibleRangeStart = chartView.lowestVisibleX
            let visibleRangeEnd = chartView.highestVisibleX
            viewModel.setVisibleRangeStart(visibleRangeStart)
            viewModel.setVisibleRangeEnd(visibleRangeEnd)
            
            // Update chart max X
            chartMaxX = Double(currentBufferSize * 8)
            chartView.xAxis.axisMinimum = chartMinX
            chartView.xAxis.axisMaximum = chartMaxX
            
            // Update chart with compression
            updateChartWithCompression(
                visibleRangeStart: visibleRangeStart,
                visibleRangeEnd: visibleRangeEnd
            )
        }
    }
    
    // Update chart with compression - EXACTLY MATCH ANDROID
    func updateChartWithCompression(visibleRangeStart: Double, visibleRangeEnd: Double) {
        // Calculate view span
        let viewSpan = visibleRangeEnd - visibleRangeStart
        
        // Add some padding to avoid edge effects
        let paddedStart = max(0, visibleRangeStart - (viewSpan * 0.05))
        let paddedEnd = visibleRangeEnd + (viewSpan * 0.05)
        
        // Get compressed data from ViewModel with enhanced range
        let entries = viewModel.updateChartWithCompression(
            rangeStart: paddedStart,
            rangeEnd: paddedEnd
        )
        
        // Update chart entries
        DispatchQueue.main.async {
            self.chartEntries = entries
            // If we have a chart view, make sure it redraws immediately
            if let chartView = self.chartView {
                chartView.notifyDataSetChanged()
                chartView.setNeedsDisplay()
            }
        }
    }

    // MARK: - Button Actions

    func startRecording() {
        guard let pinNumber = getSelectedPinNumber() else { return }
        
        // Send raw command exactly like Android
        let commandBytes: [UInt8] = [0x72, 0x61, 0x77, pinNumber] // "raw" + pin number
        let commandData = Data(commandBytes)
        
        bleManager.sendPacket(commandData)
        isRecording = true
    }

    func stopRecording() {
        // Send stop command exactly like Android
        if let commandData = BLEManager.parseCommand("s") {
            bleManager.sendPacket(commandData)
            isRecording = false
        }
    }

    func retransmitSignal() {
        guard !bleManager.getBuffer().isEmpty else { return }
        guard let pinNumber = getSelectedPinNumber() else { return }

        // Log buffer state before transmission - match Android
        let bufferLength = bleManager.getBuffer().count
        print("BEFORE_RETRANSMIT: Buffer contains \(bufferLength) bytes = \(bufferLength * 8) bits")
        
        // Send tran command exactly like Android
        let commandBytes: [UInt8] = [0x74, 0x72, 0x61, 0x6E, pinNumber] // "tran" + pin number
        let commandData = Data(commandBytes)
        
        bleManager.sendPacket(commandData)
        
        // Call transmitBuffer immediately - Android doesn't have a delay here
        bleManager.transmitBuffer()
        
        // Log buffer state after transmission
        let postTransmitLength = bleManager.getBuffer().count
        print("AFTER_RETRANSMIT: Buffer contains \(postTransmitLength) bytes = \(postTransmitLength * 8) bits")
    }

    func getSelectedPinNumber() -> UInt8? {
        guard selectedPinIndex >= 0 && selectedPinIndex < PINS.count else { return nil }
        let selectedPinString = PINS[selectedPinIndex]
        // Extract digits after "GPIO"
        if let range = selectedPinString.range(of: "GPIO") {
            let numberString = selectedPinString[range.upperBound...].split(separator: " ")[0]
            return UInt8(numberString)
        }
        return nil
    }

    // MARK: - Test Pattern Loading
    
    // EXACTLY MATCH ANDROID patterns
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
        let testData = generatePattern1(totalBytes: 4096) // Match Android 4096 bytes
        bleManager.loadBuffer(data: testData)
    }

    func loadTestPattern2() {
        let testData = generatePattern2(totalBytes: 4096) // Match Android 4096 bytes
        bleManager.loadBuffer(data: testData)
    }

    func clearBufferAndChart() {
        bleManager.clearBuffer()
    }

    // MARK: - IR Conversion

    func convertToIR() {
        guard !bleManager.getBuffer().isEmpty else {
            print("Buffer is empty, nothing to convert")
            return
        }
        
        // Get the current buffer
        let buffer = bleManager.getBuffer()
        
        // Convert the buffer to IR format
        let irBuffer = convertToIRBuffer(buffer: buffer)
        
        // Load the converted buffer back
        bleManager.loadBuffer(data: irBuffer)
        
        // Refresh the chart
        refreshChart()
        
        print("Signal converted to precise 38kHz IR carrier")
    }

    func convertToIRBuffer(buffer: Data) -> Data {
        var irBuffer = Data(count: buffer.count)
        
        // Create a 38kHz carrier pattern (100 samples at 10μs resolution = 1ms period)
        var carrierPattern = [Bool](repeating: false, count: 100)
        for i in 0..<100 {
            let cyclePosition = Double(i) * 38.0 / 100.0
            let fractionalPart = cyclePosition - floor(cyclePosition)
            carrierPattern[i] = fractionalPart < 0.5
        }
        
        var patternIndex = 0
        for i in 0..<buffer.count {
            let currentByte = buffer[i]
            var newByte: UInt8 = 0
            
            for bit in 0..<8 {
                let isHigh = ((currentByte >> bit) & 1) != 0
                if isHigh {
                    if carrierPattern[patternIndex] {
                        newByte |= (1 << bit)
                    }
                    patternIndex = (patternIndex + 1) % 100
                }
            }
            
            irBuffer[i] = newByte
        }
        
        return irBuffer
    }
}

struct SamplerView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationView {
            SamplerView()
                .environmentObject(BLEManager())
        }
    }
}
