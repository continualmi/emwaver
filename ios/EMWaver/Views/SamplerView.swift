import SwiftUI
import DGCharts
import UniformTypeIdentifiers

extension UTType {
    static var rawSignal: UTType {
        UTType(filenameExtension: "raw") ?? .data
    }
}

struct SignalDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.rawSignal, .data] }
    var data: Data

    init(_ data: Data) {
        self.data = data
    }

    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

struct LineChartViewController: UIViewControllerRepresentable {
    var entries: [ChartDataEntry]
    var onChartScale: ((Float, Float) -> Void)?
    var onChartTranslate: ((Float, Float) -> Void)?
    var onChartCreated: ((LineChartView) -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIViewController(context: Context) -> UIViewController {
        let controller = UIViewController()
        let chartView = LineChartView()
        chartView.translatesAutoresizingMaskIntoConstraints = false
        chartView.chartDescription.enabled = false
        chartView.legend.enabled = true
        chartView.leftAxis.axisMinimum = -128
        chartView.leftAxis.axisMaximum = 384
        chartView.rightAxis.enabled = false
        chartView.xAxis.labelPosition = .bottom
        chartView.dragEnabled = true
        chartView.pinchZoomEnabled = true
        chartView.dragDecelerationEnabled = false
        chartView.doubleTapToZoomEnabled = false
        chartView.drawGridBackgroundEnabled = false
        chartView.scaleYEnabled = false
        chartView.scaleXEnabled = true
        chartView.highlightPerTapEnabled = false
        chartView.maxVisibleCount = 0
        chartView.autoScaleMinMaxEnabled = false
        chartView.delegate = context.coordinator

        controller.view.addSubview(chartView)
        NSLayoutConstraint.activate([
            chartView.topAnchor.constraint(equalTo: controller.view.topAnchor),
            chartView.leadingAnchor.constraint(equalTo: controller.view.leadingAnchor),
            chartView.trailingAnchor.constraint(equalTo: controller.view.trailingAnchor),
            chartView.bottomAnchor.constraint(equalTo: controller.view.bottomAnchor)
        ])

        if let panGesture = chartView.gestureRecognizers?.first(where: { $0 is UIPanGestureRecognizer }) {
            panGesture.delegate = context.coordinator
        }

        context.coordinator.chartView = chartView
        onChartCreated?(chartView)
        updateChartData(chartView: chartView)
        return controller
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {
        if let chartView = context.coordinator.chartView {
            updateChartData(chartView: chartView)
        }
    }

    class Coordinator: NSObject, ChartViewDelegate, UIGestureRecognizerDelegate {
        let parent: LineChartViewController
        weak var chartView: LineChartView?
        private var currentZoomLevel: Float = 1.0
        private var previousRangeStart: Float = 0
        private var previousRangeEnd: Float = 0

        init(_ parent: LineChartViewController) {
            self.parent = parent
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            gestureRecognizer is UIPanGestureRecognizer && otherGestureRecognizer is UIPanGestureRecognizer
        }

        func chartScaled(_ chartView: ChartViewBase, scaleX: CGFloat, scaleY: CGFloat) {
            guard let view = chartView as? LineChartView else { return }
            let newZoom = Float(view.scaleX)
            if abs(newZoom - currentZoomLevel) >= (newZoom / 10) {
                currentZoomLevel = newZoom
                parent.onChartScale?(newZoom, Float(scaleY))
            }
        }

        func chartTranslated(_ chartView: ChartViewBase, dX: CGFloat, dY: CGFloat) {
            guard let view = chartView as? LineChartView else { return }
            let rangeStart = Float(view.lowestVisibleX)
            let rangeEnd = Float(view.highestVisibleX)
            let span = rangeEnd - rangeStart
            let threshold = span / 100

            if (rangeStart <= 0 && dX > 0) || (rangeEnd >= Float(view.xAxis.axisMaximum) && dX < 0) {
                return
            }

            if (abs(rangeStart - previousRangeStart) > threshold || abs(rangeEnd - previousRangeEnd) > threshold) && span >= 10 {
                previousRangeStart = rangeStart
                previousRangeEnd = rangeEnd
                parent.onChartTranslate?(Float(dX), Float(dY))
            }
        }
    }

    private func updateChartData(chartView: LineChartView) {
        let dataSet = LineChartDataSet(entries: entries, label: "Demodulator")
        dataSet.drawCirclesEnabled = true
        dataSet.circleRadius = 2
        dataSet.drawValuesEnabled = false
        let color = UIColor(red: 0, green: 135.0 / 255.0, blue: 1, alpha: 1)
        dataSet.setColor(color)
        dataSet.setCircleColor(color)
        dataSet.lineWidth = 3
        dataSet.drawCircleHoleEnabled = false
        dataSet.mode = .linear

        chartView.data = LineChartData(dataSet: dataSet)
        chartView.notifyDataSetChanged()
    }
}

struct SamplerView: View {
    @EnvironmentObject var bleManager: BLEManager
    @StateObject private var viewModel = SamplerViewModel()

    @State private var selectedPinIndex = 10 // Default to GPIO6 (IO6) to match Android
    @State private var selectedSignalIndex = 0
    @State private var isRecording = false
    @AppStorage("sampler_tx_pwm_enabled") private var pwmEnabled = false
    @AppStorage("sampler_tx_pwm_freq_hz") private var pwmFreqHz = 38000
    @AppStorage("sampler_tx_pwm_duty_percent") private var pwmDutyPercent = 50
    @State private var pwmFreqText = ""
    @State private var pwmDutyText = ""

    @State private var chartEntries: [ChartDataEntry] = []
    @State private var chartView: LineChartView?
    @State private var chartMinX: Double = 0
    @State private var chartMaxX: Double = 10000
    @State private var lastBufferSize: Int = -1
    @State private var refreshTimer: Timer?
    @State private var isSchedulerRunning = false

    @State private var showingFileImporter = false
    @State private var showingFileExporter = false
    @State private var showingExportDialog = false
    @State private var showingSettingsSheet = false
    @State private var exportFileName = "signal.raw"
    @State private var namePrompt: NamePrompt?
    @State private var showingDeleteConfirmation = false
    @State private var showingRenameDialog = false
    @State private var renameText = ""


    private let pins = [
        "RFM69 DIO0 (IO1)",
        "RFM69 DIO1 (IO2)",
        "RFM69 DIO2 (IO42)",
        "RFM69 DIO3 (IO41)",
        "RFM69 DIO4 (IO40)",
        "RFM69 DIO5 (IO39)",
        "IR RX (IO38)",
        "IR TX (IO37)",
        "GPIO4 (IO4)",
        "GPIO5 (IO5)",
        "GPIO6 (IO6)",
        "GPIO7 (IO7)",
        "GPIO15 (IO15)",
        "GPIO16 (IO16)",
        "GPIO17 (IO17)",
        "GPIO18 (IO18)",
        "GPIO8 (IO8)",
        "GPIO3 (IO3)",
        "GPIO46 (IO46)",
        "GPIO9 (IO9)",
        "GPIO10 (IO10)",
        "GPIO11 (IO11)",
        "GPIO12 (IO12)",
        "GPIO13 (IO13)",
        "GPIO14 (IO14)"
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if !bleManager.isConnected {
                        connectionBanner
                    }

                    chartSection
                    signalPickerSection
                    controlsSection
                }
                .padding(.vertical, 16)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Sampler")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbarContent }
            .onAppear { 
                handleAppear()
                viewModel.refreshSignalList()
                loadLastSelectedSignal()
                syncPwmTextIfNeeded()
            }
            .onChange(of: bleManager.isConnected) { handleConnectionChange($0) }
            .onDisappear { stopScheduler() }
            .onChange(of: selectedSignalIndex) { newValue in
                handleSignalSelection(index: newValue)
            }
            .onChange(of: viewModel.signalNames) { _ in
                // Update picker selection when signal list changes
                if let currentName = viewModel.currentSignalName,
                   let index = viewModel.signalNames.firstIndex(of: currentName) {
                    if selectedSignalIndex != index + 1 {
                        selectedSignalIndex = index + 1
                    }
                } else if viewModel.signalNames.isEmpty && selectedSignalIndex != 0 {
                    selectedSignalIndex = 0
                }
            }
            .alert(item: $viewModel.notice) { notice in
                Alert(title: Text(notice.title), message: Text(notice.message), dismissButton: .default(Text("OK")))
            }
            .sheet(isPresented: $showingSettingsSheet) {
                SettingsSheet()
            }
            .sheet(item: $namePrompt) { prompt in
                NamePromptSheet(prompt: prompt) { value in
                    handleNamePrompt(prompt: prompt, value: value)
                } onCancel: {
                    namePrompt = nil
                }
            }
            .confirmationDialog("Delete signal?", isPresented: $showingDeleteConfirmation, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    performDelete()
                }
                Button("Cancel", role: .cancel) {
                    showingDeleteConfirmation = false
                }
            }
            .fileImporter(
                isPresented: $showingFileImporter,
                allowedContentTypes: [.rawSignal, .data],
                allowsMultipleSelection: false
            ) { result in
                if case let .success(urls) = result, let url = urls.first {
                    importSignal(from: url)
                } else if case let .failure(error) = result {
                    showToast("Error importing file: \(error.localizedDescription)")
                }
            }
            .fileExporter(
                isPresented: $showingFileExporter,
                document: SignalDocument(bleManager.getBuffer()),
                contentType: .rawSignal,
                defaultFilename: exportFileName
            ) { result in
                switch result {
                case .success:
                    showToast("Signal exported successfully")
                case let .failure(error):
                    showToast("Error exporting signal: \(error.localizedDescription)")
                }
            }
            .alert("Export Signal", isPresented: $showingExportDialog) {
                TextField("Filename", text: $exportFileName)
                    .submitLabel(.done)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                Button("Cancel", role: .cancel) {}
                Button("Export") {
                    if !exportFileName.lowercased().hasSuffix(".raw") {
                        exportFileName += ".raw"
                    }
                    showingFileExporter = true
                }
            } message: {
                Text("Enter a name for the signal file.")
            }
        }
    }

    private var connectionBanner: some View {
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
    }

    private var chartSection: some View {
        VStack(spacing: 12) {
            LineChartViewController(
                entries: chartEntries,
                onChartScale: { _, _ in chartGestured() },
                onChartTranslate: { _, _ in chartGestured() },
                onChartCreated: { view in
                    chartView = view
                    view.xAxis.axisMinimum = chartMinX
                    view.xAxis.axisMaximum = chartMaxX
                    refreshChart(force: true)
                }
            )
            .frame(height: 300)
            .padding(.horizontal)

            HStack(spacing: 12) {
                Button {
                    isRecording ? stopRecording() : startRecording()
                } label: {
                    HStack {
                        Image(systemName: isRecording ? "stop.circle.fill" : "record.circle")
                        Text(isRecording ? "Stop" : "Record")
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(isRecording ? .red : .blue)

                Button {
                    retransmitSignal()
                } label: {
                    HStack {
                        Image(systemName: "arrow.up.circle")
                        Text("Transmit")
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .disabled(bleManager.getBuffer().isEmpty)
            }
            .padding(.horizontal)

            VStack(alignment: .leading, spacing: 8) {
                Text("GPIO Pin")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                Picker("", selection: $selectedPinIndex) {
                    ForEach(Array(pins.enumerated()), id: \.offset) { index, title in
                        Text(title).tag(index)
                    }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .leading, spacing: 8) {
                    Toggle("PWM Infrared", isOn: $pwmEnabled)
                        .onChange(of: pwmEnabled) { _ in
                            syncPwmTextIfNeeded()
                        }

                    HStack(spacing: 12) {
                        TextField("Freq (Hz)", text: $pwmFreqText)
                            .keyboardType(.numberPad)
                            .textFieldStyle(.roundedBorder)
                            .disabled(!pwmEnabled)
                            .onChange(of: pwmFreqText) { newValue in
                                if let value = parsePwmInt(newValue) {
                                    pwmFreqHz = value
                                }
                            }

                        TextField("Duty (%)", text: $pwmDutyText)
                            .keyboardType(.numberPad)
                            .textFieldStyle(.roundedBorder)
                            .disabled(!pwmEnabled)
                            .onChange(of: pwmDutyText) { newValue in
                                if let value = parsePwmInt(newValue) {
                                    pwmDutyPercent = value
                                }
                            }
                    }
                }
            }
        }
        .padding(.vertical, 12)
        .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal)
    }

    private var signalPickerSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Signal")
                .font(.headline)
            
            Picker("", selection: $selectedSignalIndex) {
                Text("New signal...").tag(0)
                ForEach(Array(viewModel.signalNames.enumerated()), id: \.offset) { index, name in
                    Text(name).tag(index + 1)
                }
            }
            .pickerStyle(.menu)
            .frame(maxWidth: .infinity, alignment: .leading)
            
            if let currentName = viewModel.currentSignalName {
                HStack {
                    Text(currentName)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    if viewModel.hasUnsavedChanges {
                        Text("*")
                            .font(.subheadline)
                            .foregroundColor(.orange)
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal)
    }
    
    private var controlsSection: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Button(action: startRecording) {
                    Label("Record", systemImage: "record.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(isRecording || !bleManager.isConnected)
                
                Button(action: stopRecording) {
                    Label("Stop", systemImage: "stop.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(!isRecording)
                
                Button(action: retransmitSignal) {
                    Label("Retransmit", systemImage: "arrow.clockwise")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(bleManager.getBuffer().isEmpty || !bleManager.isConnected)
            }
            
            Button(action: getTimings) {
                Label("Get Timings", systemImage: "waveform")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(bleManager.getBuffer().isEmpty)
        }
        .padding()
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal)
    }


    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .navigationBarTrailing) {
            Menu {
                Button("New Signal", action: createNewSignal)
                Button("Save Signal", action: showSavePrompt)
                    .disabled(bleManager.getBuffer().isEmpty)
                Button("Rename Signal", action: showRenamePrompt)
                    .disabled(viewModel.currentSignalName == nil || viewModel.hasUnsavedChanges)
                Button("Delete Signal", action: { showingDeleteConfirmation = true })
                    .disabled(viewModel.currentSignalName == nil || viewModel.hasUnsavedChanges)
                Divider()
                Button("Clear Buffer", action: clearBufferAndChart)
                Button("Import from Storage", action: { showingFileImporter = true })
                Button("Export to Storage", action: showExportPrompt)
                    .disabled(bleManager.getBuffer().isEmpty)
                Button("Settings", action: { showingSettingsSheet = true })
            } label: {
                Image(systemName: "ellipsis.circle")
            }
        }
    }

    private func handleAppear() {
        viewModel.attachBLEManager(bleManager)
        viewModel.refreshSignalList()
        if bleManager.isConnected {
            initScheduler()
        }
    }

    private func handleConnectionChange(_ connected: Bool) {
        if connected {
            viewModel.attachBLEManager(bleManager)
            initScheduler()
        } else {
            stopScheduler()
        }
    }

    private func handleSignalSelection(index: Int) {
        if index == 0 {
            // "New signal..." selected
            createNewSignal()
        } else {
            let signalIndex = index - 1
            if signalIndex < viewModel.signalNames.count {
                let signalName = viewModel.signalNames[signalIndex]
                // Only load if it's different from current
                if viewModel.currentSignalName != signalName || viewModel.hasUnsavedChanges {
                    loadSignal(name: signalName)
                }
            }
        }
    }
    
    private func loadLastSelectedSignal() {
        if let lastSelected = viewModel.loadLastSelectedSignal(),
           let index = viewModel.signalNames.firstIndex(of: lastSelected) {
            selectedSignalIndex = index + 1 // +1 because index 0 is "New signal..."
            loadSignal(name: lastSelected)
        } else {
            selectedSignalIndex = 0
        }
    }

    private func chartGestured() {
        guard let chartView else { return }
        viewModel.setVisibleRangeStart(chartView.lowestVisibleX)
        viewModel.setVisibleRangeEnd(chartView.highestVisibleX)
        updateChartWithCompression(rangeStart: chartView.lowestVisibleX, rangeEnd: chartView.highestVisibleX)
    }

    private func showSavePrompt() {
        let buffer = bleManager.getBuffer()
        if buffer.isEmpty {
            viewModel.notice = SamplerViewModel.Notice(title: "Error", message: "Buffer is empty")
            return
        }
        
        let initial = viewModel.currentSignalName ?? viewModel.generateNewSignalName()
        namePrompt = NamePrompt(
            mode: .save(buffer),
            title: "Save Signal",
            message: "Enter a name for the signal.",
            initialValue: initial
        )
    }

    private func handleNamePrompt(prompt: NamePrompt, value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            namePrompt = nil
            return
        }
        
        switch prompt.mode {
        case .save(let buffer):
            viewModel.saveSignal(name: trimmed, buffer: buffer)
            viewModel.refreshSignalList()
            // Update picker after a short delay to allow refresh to complete
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                let normalized = viewModel.normalizeSignalName(trimmed)
                if let index = viewModel.signalNames.firstIndex(of: normalized) {
                    selectedSignalIndex = index + 1
                }
            }
        case .rename:
            if let currentName = viewModel.currentSignalName {
                viewModel.renameSignal(from: currentName, to: trimmed)
                viewModel.refreshSignalList()
                // Update picker after rename
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                    let normalized = viewModel.normalizeSignalName(trimmed)
                    if let index = viewModel.signalNames.firstIndex(of: normalized) {
                        selectedSignalIndex = index + 1
                    }
                }
            }
        }
        namePrompt = nil
    }

    private func performDelete() {
        showingDeleteConfirmation = false
        guard let signalName = viewModel.currentSignalName else {
            viewModel.notice = SamplerViewModel.Notice(title: "Error", message: "No signal selected")
            return
        }
        viewModel.deleteSignal(name: signalName)
        
        // Select next signal or "New signal..."
        if let deletedIndex = viewModel.signalNames.firstIndex(of: signalName) {
            viewModel.refreshSignalList()
            if deletedIndex < viewModel.signalNames.count {
                selectedSignalIndex = deletedIndex + 1
                loadSignal(name: viewModel.signalNames[deletedIndex])
            } else if !viewModel.signalNames.isEmpty {
                selectedSignalIndex = 1
                loadSignal(name: viewModel.signalNames[0])
            } else {
                selectedSignalIndex = 0
                createNewSignal()
            }
        }
    }

    private func startRecording() {
        guard let pin = selectedPinNumber() else { return }
        let command = Data("sample start --pin=\(pin)".utf8)
        bleManager.sendPacket(command)
        isRecording = true
    }

    private func stopRecording() {
        let command = Data("sample stop".utf8)
        bleManager.sendPacket(command)
        isRecording = false
        viewModel.markBufferDirty()
    }

    private func retransmitSignal() {
        guard !bleManager.getBuffer().isEmpty, let pin = selectedPinNumber() else { return }
        var commandString = "transmit start --pin=\(pin)"
        if pwmEnabled {
            let freqHz = parsePwmInt(pwmFreqText) ?? pwmFreqHz
            let dutyPercent = parsePwmInt(pwmDutyText) ?? pwmDutyPercent
            if freqHz < 1 {
                showToast("Invalid PWM frequency")
                return
            }
            if dutyPercent < 1 || dutyPercent > 100 {
                showToast("Invalid PWM duty (1-100)")
                return
            }
            pwmFreqHz = freqHz
            pwmDutyPercent = dutyPercent
            commandString += " --pwm --freq=\(freqHz) --duty=\(dutyPercent)"
        }
        let command = Data(commandString.utf8)
        bleManager.sendPacket(command)
        bleManager.transmitBuffer()
    }

    private func getTimings() {
        let buffer = bleManager.getBuffer()
        guard !buffer.isEmpty else {
            viewModel.notice = SamplerViewModel.Notice(title: "Error", message: "Buffer is empty")
            return
        }
        viewModel.outputText = viewModel.buildSignedRawTimings(from: buffer)
    }


    private func convertToIR() {
        let buffer = bleManager.getBuffer()
        guard !buffer.isEmpty else { return }
        let utils = Utils()
        let converted = utils.convertToIRBuffer(buffer)
        bleManager.loadBuffer(data: converted)
        viewModel.markBufferDirty()
        refreshChart(force: true)
        showToast("Signal converted to 38kHz IR format")
    }

    private func clearBufferAndChart() {
        bleManager.clearBuffer()
        viewModel.markBufferDirty()
        refreshChart(force: true)
    }

    private func createNewSignal() {
        bleManager.clearBuffer()
        viewModel.createNewSignal()
        selectedSignalIndex = 0
        refreshChart(force: true)
    }

    private func showRenamePrompt() {
        guard let currentName = viewModel.currentSignalName else {
            viewModel.notice = SamplerViewModel.Notice(title: "Error", message: "No signal loaded")
            return
        }
        let nameWithoutExt = currentName.replacingOccurrences(of: ".raw", with: "", options: .caseInsensitive)
        namePrompt = NamePrompt(
            mode: .rename,
            title: "Rename Signal",
            message: "Enter a new name.",
            initialValue: nameWithoutExt
        )
    }
    
    private func showExportPrompt() {
        let buffer = bleManager.getBuffer()
        if buffer.isEmpty {
            showToast("Buffer is empty, nothing to export")
            return
        }
        exportFileName = viewModel.currentSignalName ?? generateDefaultFileName()
        showingExportDialog = true
    }

    private func loadSignal(name: String) {
        // Prevent loading the same signal if it's already loaded and clean
        if name == viewModel.currentSignalName && !viewModel.hasUnsavedChanges {
            return
        }
        
        guard let data = viewModel.loadSignal(name: name) else { return }
        bleManager.loadBuffer(data: data)
        refreshChart(force: true)
        
        // Update picker selection (without triggering onChange)
        if let index = viewModel.signalNames.firstIndex(of: name) {
            DispatchQueue.main.async {
                self.selectedSignalIndex = index + 1 // +1 because index 0 is "New signal..."
            }
        }
    }

    private func initScheduler() {
        stopScheduler()
        let interval = Double(viewModel.refreshTime) / 1000.0
        guard interval > 0 else { return }
        isSchedulerRunning = true
        refreshTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { _ in
            if isSchedulerRunning {
                refreshChartWithBufferCheck()
            }
        }
    }

    private func stopScheduler() {
        isSchedulerRunning = false
        refreshTimer?.invalidate()
        refreshTimer = nil
    }

    private func refreshChartWithBufferCheck() {
        if viewModel.isBufferSizeLimitReached(isRecording: isRecording) {
            stopRecording()
            showToast("Recording stopped: Buffer size limit reached. Adjust it in Settings.")
        }
        refreshChart()
    }

    private func refreshChart(force: Bool = false) {
        guard let chartView else { return }
        let bufferSize = bleManager.getBuffer().count
        if bufferSize != lastBufferSize || force {
            lastBufferSize = bufferSize
            chartMaxX = Double(bufferSize * 8)
            chartView.xAxis.axisMinimum = chartMinX
            chartView.xAxis.axisMaximum = chartMaxX
            chartGestured()
        }
    }

    private func updateChartWithCompression(rangeStart: Double, rangeEnd: Double) {
        let span = rangeEnd - rangeStart
        let start = max(0, rangeStart - span * 0.05)
        let end = rangeEnd + span * 0.05
        let entries = viewModel.updateChartWithCompression(rangeStart: start, rangeEnd: end)
        chartEntries = entries
        chartView?.notifyDataSetChanged()
    }

    private func importSignal(from url: URL) {
        guard url.startAccessingSecurityScopedResource() else {
            showToast("Failed to access file")
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }

        do {
            let data = try Data(contentsOf: url)
            let fileName = url.lastPathComponent
            let normalizedName = viewModel.normalizeSignalName(fileName)
            
            // Save to local signals directory
            viewModel.saveSignal(name: normalizedName, buffer: data)
            
            // Load into buffer
            bleManager.loadBuffer(data: data)
            viewModel.markBufferDirty()
            refreshChart(force: true)
            
            // Update picker selection
            viewModel.refreshSignalList()
            if let index = viewModel.signalNames.firstIndex(of: normalizedName) {
                selectedSignalIndex = index + 1
            }
            
            showToast("Imported \(normalizedName)")
        } catch {
            showToast("Error importing file: \(error.localizedDescription)")
        }
    }

    private func selectedPinNumber() -> UInt8? {
        guard selectedPinIndex >= 0 && selectedPinIndex < pins.count else { return nil }
        let text = pins[selectedPinIndex]
        let pattern = "\\(IO(\\d+)\\)"
        if let range = text.range(of: pattern, options: .regularExpression) {
            let match = text[range]
            let digits = match.dropFirst(3).dropLast()
            return UInt8(String(digits))
        }
        return nil
    }

    private func parseNumericValue(_ raw: String) -> Int? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        var sign = 1
        if text.hasPrefix("-") {
            sign = -1
            text.removeFirst()
        } else if text.hasPrefix("+") {
            text.removeFirst()
        }
        if text.isEmpty { return nil }
        let value: Int?
        if text.lowercased().hasPrefix("0x") {
            value = Int(text.dropFirst(2), radix: 16)
        } else if text.hasPrefix("#") {
            value = Int(text.dropFirst(), radix: 16)
        } else if text.hasPrefix("0") && text.count > 1 {
            value = Int(text, radix: 8)
        } else {
            value = Int(text, radix: 10)
        }
        guard let parsed = value else { return nil }
        return sign * parsed
    }

    private func syncPwmTextIfNeeded() {
        if pwmFreqText.isEmpty {
            pwmFreqText = String(pwmFreqHz)
        }
        if pwmDutyText.isEmpty {
            pwmDutyText = String(pwmDutyPercent)
        }
    }

    private func parsePwmInt(_ raw: String) -> Int? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return Int(trimmed)
    }

    private func generateDefaultFileName() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd_HHmmss"
        let pinName = pins[selectedPinIndex]
            .replacingOccurrences(of: " ", with: "_")
            .replacingOccurrences(of: "(", with: "")
            .replacingOccurrences(of: ")", with: "")
        return "signal_\(pinName)_\(formatter.string(from: Date())).raw"
    }

    private func showToast(_ message: String) {
        #if os(iOS)
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let controller = scene.windows.first?.rootViewController else {
            return
        }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        controller.present(alert, animated: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            alert.dismiss(animated: true)
        }
        #endif
    }
}


private struct NamePrompt: Identifiable {
    enum Mode {
        case save(Data)
        case rename
    }

    let id = UUID()
    let mode: Mode
    let title: String
    let message: String
    let initialValue: String
}

private struct NamePromptSheet: View {
    let prompt: NamePrompt
    let onSubmit: (String) -> Void
    let onCancel: () -> Void

    @State private var value: String

    init(prompt: NamePrompt, onSubmit: @escaping (String) -> Void, onCancel: @escaping () -> Void) {
        self.prompt = prompt
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _value = State(initialValue: prompt.initialValue)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(footer: Text(prompt.message)) {
                    TextField("Name", text: $value)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                }
            }
            .navigationTitle(prompt.title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSubmit(value)
                    }
                }
            }
        }
    }
}
