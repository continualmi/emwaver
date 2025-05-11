import SwiftUI
import DGCharts
import Combine // Needed for PassthroughSubject
import UniformTypeIdentifiers // Add this for file types

// MARK: - Extension for UTType
extension UTType {
    static var rawSignal: UTType {
        UTType(filenameExtension: "raw") ?? .data
    }
}

// MARK: - Signal Document type
struct SignalDocument: FileDocument {
    var data: Data
    
    init(_ data: Data) {
        self.data = data
    }
    
    static var readableContentTypes: [UTType] { [.rawSignal, .data] }
    
    init(configuration: ReadConfiguration) throws {
        if let data = configuration.file.regularFileContents {
            self.data = data
        } else {
            self.data = Data()
        }
    }
    
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        return FileWrapper(regularFileWithContents: data)
    }
}

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
        
        // Fix scrolling issue by adding simultaneous gesture recognizer
        if let panGesture = chartView.gestureRecognizers?.first(where: { $0 is UIPanGestureRecognizer }) {
            panGesture.require(toFail: viewController.view.gestureRecognizers?.first(where: { $0 is UIPanGestureRecognizer }) ?? UIPanGestureRecognizer())
            panGesture.delegate = context.coordinator
        }
        
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
    
    class Coordinator: NSObject, ChartViewDelegate, UIGestureRecognizerDelegate {
        var parent: LineChartViewController
        weak var chartView: LineChartView?
        // Exactly like Android - track current zoom level
        var currentZoomLevel: Float = 1.0
        var prevRangeStart: Float = 0
        var prevRangeEnd: Float = 0

        init(_ parent: LineChartViewController) {
            self.parent = parent
        }
        
        // Allow simultaneous gesture recognition
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            // Allow chart gestures to work with ScrollView gestures
            if otherGestureRecognizer is UIPanGestureRecognizer && gestureRecognizer is UIPanGestureRecognizer {
                return true
            }
            return false
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
    @State private var selectedPinIndex: Int = 4 // Default to IR RX (IO5)
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
    
    // File import/export states
    @State private var showingFileImporter = false
    @State private var showingFileExporter = false
    @State private var showingExportDialog = false
    @State private var exportFileName = "signal.raw"
    
    // Match Android's PINS array exactly
    let PINS = [
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
    
    // Initialize ViewModel with BLEManager
    init() {
        _viewModel = StateObject(wrappedValue: SamplerViewModel(bleManager: BLEManager()))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
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

                // Chart card
                VStack(alignment: .leading, spacing: 0) {
                    Text("Signal Chart")
                        .font(.headline)
                        .padding(.leading)
                        .padding(.top, 8)
                    LineChartViewController(entries: chartEntries,
                                           onChartScale: { scaleX, scaleY in
                        if let chartView = self.chartView {
                            let visibleRangeStart = chartView.lowestVisibleX
                            let visibleRangeEnd = chartView.highestVisibleX
                            viewModel.setVisibleRangeStart(visibleRangeStart)
                            viewModel.setVisibleRangeEnd(visibleRangeEnd)
                            updateChartWithCompression(
                                visibleRangeStart: visibleRangeStart,
                                visibleRangeEnd: visibleRangeEnd
                            )
                        }
                    }, onChartTranslate: { dX, dY in
                        if let chartView = self.chartView {
                            let visibleRangeStart = chartView.lowestVisibleX
                            let visibleRangeEnd = chartView.highestVisibleX
                            viewModel.setVisibleRangeStart(visibleRangeStart)
                            viewModel.setVisibleRangeEnd(visibleRangeEnd)
                            updateChartWithCompression(
                                visibleRangeStart: visibleRangeStart,
                                visibleRangeEnd: visibleRangeEnd
                            )
                        }
                    }, onChartCreated: { chartView in
                        self.chartView = chartView
                        chartView.xAxis.axisMinimum = self.chartMinX
                        chartView.xAxis.axisMaximum = self.chartMaxX
                        self.refreshChart()
                    })
                    .frame(height: 300)
                    .padding([.horizontal])
                    
                    // Move record and transmit buttons to chart card
                    HStack(spacing: 15) {
                        Button {
                            if isRecording {
                                stopRecording()
                            } else {
                                startRecording()
                            }
                        } label: {
                            HStack {
                                Image(systemName: isRecording ? "stop.circle.fill" : "record.circle")
                                    .font(.system(size: 18))
                                Text(isRecording ? "Stop" : "Record")
                            }
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(isRecording ? Color.red : Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(8)
                        }
                        
                        Button {
                            retransmitSignal()
                        } label: {
                            HStack {
                                Image(systemName: "arrow.up.circle")
                                    .font(.system(size: 18))
                                Text("Transmit")
                            }
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(bleManager.getBuffer().isEmpty ? Color.gray : Color.green)
                            .foregroundColor(.white)
                            .cornerRadius(8)
                        }
                        .disabled(bleManager.getBuffer().isEmpty)
                    }
                    .padding([.horizontal, .bottom])
                }
                .background(Color(.systemGray6))
                .cornerRadius(10)
                .padding([.horizontal, .top])

                // Redesigned Controls card
                VStack(alignment: .leading, spacing: 15) {
                    Text("Signal Controls")
                        .font(.headline)
                        .padding(.top, 8)
                    
                    // GPIO Pin selector with better spacing
                    VStack(alignment: .leading, spacing: 8) {
                        Text("GPIO Pin:")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        
                        Picker("", selection: $selectedPinIndex) {
                            ForEach(0..<PINS.count, id: \.self) { index in
                                Text(PINS[index]).tag(index)
                            }
                        }
                        .pickerStyle(.menu)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(.systemGray5))
                        .cornerRadius(8)
                    }
                    
                    // IR Conversion control with better styling
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Signal Processing:")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        
                        Button {
                            convertToIR()
                        } label: {
                            HStack {
                                Image(systemName: "waveform")
                                    .font(.system(size: 18))
                                Text("Convert to IR")
                            }
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(bleManager.getBuffer().isEmpty ? Color.gray : Color.purple)
                            .foregroundColor(.white)
                            .cornerRadius(8)
                        }
                        .disabled(bleManager.getBuffer().isEmpty)
                    }
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(10)
                .padding([.horizontal, .top])

                Spacer(minLength: 20)
            }
            .navigationTitle("Sampler")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                // Add this code for opaque navigation bar
                let appearance = UINavigationBarAppearance()
                appearance.configureWithOpaqueBackground()
                UINavigationBar.appearance().standardAppearance = appearance
                UINavigationBar.appearance().compactAppearance = appearance
                UINavigationBar.appearance().scrollEdgeAppearance = appearance
                // End of added code

                viewModel.bleManager = bleManager
                if bleManager.isConnected {
                    refreshChart()
                }
            }
            .onChange(of: bleManager.bufferVersion) { _ in
                refreshChart()
            }
            .onChange(of: bleManager.isConnected) { isConnected in
                if isConnected {
                    refreshChart()
                }
            }
            .toolbar {
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    Menu {
                        Button(action: clearBufferAndChart) {
                            Label("Clear", systemImage: "trash")
                        }
                        
                        Divider()
                        
                        Button(action: { showingFileImporter = true }) {
                            Label("Import from Files", systemImage: "square.and.arrow.down")
                        }
                        
                        Button(action: {
                            let buffer = bleManager.getBuffer()
                            if !buffer.isEmpty {
                                exportFileName = generateDefaultFileName()
                                showingExportDialog = true
                            } else {
                                showImportExportToast("Buffer is empty, nothing to export")
                            }
                        }) {
                            Label("Export to Files", systemImage: "square.and.arrow.up")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .imageScale(.large)
                    }
                }
            }
            .fileImporter(
                isPresented: $showingFileImporter,
                allowedContentTypes: [.rawSignal, .data],
                allowsMultipleSelection: false
            ) { result in
                switch result {
                case .success(let urls):
                    if let url = urls.first {
                        importSignalFromFile(url: url)
                    }
                case .failure(let error):
                    print("Error importing file: \(error.localizedDescription)")
                    showImportExportToast("Error importing file: \(error.localizedDescription)")
                }
            }
            .fileExporter(
                isPresented: $showingFileExporter,
                document: SignalDocument(bleManager.getBuffer()),
                contentType: .rawSignal,
                defaultFilename: exportFileName
            ) { result in
                switch result {
                case .success(let url):
                    print("Signal exported to: \(url.lastPathComponent)")
                    showImportExportToast("Signal exported successfully")
                case .failure(let error):
                    print("Error exporting signal: \(error.localizedDescription)")
                    showImportExportToast("Error exporting signal: \(error.localizedDescription)")
                }
            }
            .alert("Export Signal", isPresented: $showingExportDialog) {
                TextField("Filename", text: $exportFileName)
                    .submitLabel(.done)
                    .keyboardType(.default)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                
                Button("Cancel", role: .cancel) {
                    // Just dismiss
                    hideKeyboard()
                }
                
                Button("Export") {
                    // Hide keyboard first
                    hideKeyboard()
                    
                    // Add .raw extension if not present
                    if !exportFileName.lowercased().hasSuffix(".raw") {
                        exportFileName += ".raw"
                    }
                    showingFileExporter = true
                }
            } message: {
                Text("Enter a name for the signal file")
            }
        }
    }
    
    // MARK: - Helper Methods
    
    // Helper function to hide keyboard
    private func hideKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
    
    // Generate a default filename with timestamp
    private func generateDefaultFileName() -> String {
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyyMMdd_HHmmss"
        let dateString = dateFormatter.string(from: Date())
        
        // Get pin name
        let pinName = PINS[selectedPinIndex].replacingOccurrences(of: " ", with: "_")
        let pinString = pinName.replacingOccurrences(of: "(", with: "").replacingOccurrences(of: ")", with: "")
        
        return "signal_\(pinString)_\(dateString).raw"
    }
    
    // MARK: - File Operations
    
    func importSignalFromFile(url: URL) {
        do {
            // Start accessing security-scoped resource
            guard url.startAccessingSecurityScopedResource() else {
                print("Failed to access security-scoped resource")
                showImportExportToast("Failed to access file")
                return
            }
            
            defer {
                // Make sure to release the security-scoped resource when done
                url.stopAccessingSecurityScopedResource()
            }
            
            // Read the file data
            let data = try Data(contentsOf: url)
            
            // Load the data into the buffer
            bleManager.loadBuffer(data: data)
            
            // Refresh the chart
            refreshChart()
            
            let filename = url.lastPathComponent
            print("Imported signal from: \(filename)")
            showImportExportToast("Imported signal: \(filename)")
        } catch {
            print("Error importing signal: \(error.localizedDescription)")
            showImportExportToast("Error importing signal")
        }
    }
    
    // Helper to show toast messages for file operations
    private func showImportExportToast(_ message: String) {
        #if os(iOS)
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let controller = windowScene.windows.first?.rootViewController else {
            return
        }
        
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        controller.present(alert, animated: true)
        
        // Dismiss after short delay
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            alert.dismiss(animated: true)
        }
        #endif
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
        
        // Create a byte array directly with the command and pin as a raw byte value
        var commandBytes = Data("sample ".utf8)
        // Append the actual pin number as a single byte, not as ASCII
        commandBytes.append(pinNumber)
        
        bleManager.sendPacket(commandBytes)
        isRecording = true
    }

    func stopRecording() {
        // Use the updated "stop" command format
        let commandString = "stop"
        if let commandData = commandString.data(using: .utf8) {
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
        
        // Create a byte array directly with the command and pin as a raw byte value
        var commandBytes = Data("transmit ".utf8)
        // Append the actual pin number as a single byte, not as ASCII
        commandBytes.append(pinNumber)
        
        bleManager.sendPacket(commandBytes)
        
        // Call transmitBuffer immediately - Android doesn't have a delay here
        bleManager.transmitBuffer()
        
        // Log buffer state after transmission
        let postTransmitLength = bleManager.getBuffer().count
        print("AFTER_RETRANSMIT: Buffer contains \(postTransmitLength) bytes = \(postTransmitLength * 8) bits")
    }

    func getSelectedPinNumber() -> UInt8? {
        guard selectedPinIndex >= 0 && selectedPinIndex < PINS.count else { return nil }
        let selectedPinString = PINS[selectedPinIndex]
        // Extract pin number from "(IO#)"
        let pattern = "\\(IO(\\d+)\\)"
        if let matchRange = selectedPinString.range(of: pattern, options: .regularExpression) {
            let matchText = String(selectedPinString[matchRange]) // e.g. "(IO12)"
            let numberString = String(matchText.dropFirst(3).dropLast()) // drop "(IO" and ")"
            return UInt8(numberString)
        }
        print("Error: Could not parse pin number from \(selectedPinString)")
        return nil
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

    func clearBufferAndChart() {
        bleManager.clearBuffer()
        lastBufferSize = 0 // Reset last buffer size to force chart refresh
        refreshChart() // Refresh the chart to clear it
        showImportExportToast("Buffer cleared")
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
