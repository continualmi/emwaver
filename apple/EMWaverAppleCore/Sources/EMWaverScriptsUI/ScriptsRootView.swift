/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import SwiftUI
import EMWaverScriptModel
import EMWaverScriptRuntime
import EMWaverScriptStorage
import EMWaverScriptSwiftUI

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

public struct ScriptsRootView: View {
    public struct ScriptRunRequest {
        public let scriptId: String
        public let name: String
        public let source: String
        public let moduleSources: [String: String]

        public init(scriptId: String, name: String, source: String, moduleSources: [String: String]) {
            self.scriptId = scriptId
            self.name = name
            self.source = source
            self.moduleSources = moduleSources
        }
    }

    public struct ScriptRunResult {
        public let scriptInstanceId: String
        public let name: String
        public let running: Bool
        public let errorMessage: String?

        public init(scriptInstanceId: String, name: String, running: Bool, errorMessage: String? = nil) {
            self.scriptInstanceId = scriptInstanceId
            self.name = name
            self.running = running
            self.errorMessage = errorMessage
        }
    }

    public struct ScriptSessionStatus: Identifiable, Equatable {
        public let id: String
        public let deviceId: String
        public let scriptId: String
        public let deviceLabel: String
        public let stateText: String

        public init(id: String, deviceId: String = "active", scriptId: String, deviceLabel: String, stateText: String) {
            self.id = id
            self.deviceId = deviceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "active" : deviceId.trimmingCharacters(in: .whitespacesAndNewlines)
            self.scriptId = scriptId
            self.deviceLabel = deviceLabel
            self.stateText = stateText
        }

        public var isRunning: Bool {
            stateText.caseInsensitiveCompare("running") == .orderedSame
        }
    }

    @StateObject private var viewModel = ScriptsViewModel()
    @StateObject private var previewManager: ScriptPreviewManager
    @StateObject private var agentViewModel: AgentChatViewModel

    private let agentEndpointProvider: (() -> (baseURL: URL, accessToken: String)?)?
    private let onRunScript: ((ScriptRunRequest) async -> ScriptRunResult?)?
    private let activePreviewManagerProvider: (() -> ScriptPreviewManager?)?
    private let onStopActiveScript: (() -> Void)?
    private let externalScriptSessions: [ScriptSessionStatus]
    private let onSelectExternalScriptSession: ((String) -> Void)?
    private let onStopExternalScriptSession: ((String) -> Void)?

    private let device: (any ScriptDevice)?
    private let hostStatusSink: ((Bool, String?) -> Void)?

    // Pro gating (caller-controlled).
    private let agentEnabled: Bool
    private let onRequestAgentUpgrade: (() -> Void)?
    private let onRequestOpenSettings: (() -> Void)?
    private let leadingHeaderItem: AnyView?
    private let agentLeadingToolbarItem: AnyView?
    private let navigationTitleAccessoryText: String?

    @State private var showingEditor = false
    @State private var showingPreview = false
    @State private var previewLaunchedFromEditor = false
    @State private var currentScriptId: String?
    @State private var editorContent: String = ""
    @State private var editorIsReadOnly = false
    @State private var lineWrapEnabled = false
    @State private var namePrompt: NamePrompt?
    @State private var deleteTarget: DeletionTarget?
    @State private var showingDeleteConfirmation = false

    private enum EditorMode {
        case script
        case signalRaw
        case signalText
    }

    @State private var editorMode: EditorMode = .script
    @State private var editorTitleOverride: String?

    @State private var signalRenamePrompt: NamePrompt?
    @State private var signalDeleteTarget: DeletionTarget?
    @State private var showingSignalDeleteConfirmation = false
    @State private var pendingScriptPreviewId: String?
    @State private var showingSwitchScriptConfirmation = false

    @State private var showingAgentPanel = false
    #if os(macOS)
    @State private var agentPanelWidth: CGFloat = 380
    #endif

    @MainActor
    public init(
        previewManager: ScriptPreviewManager,
        device: (any ScriptDevice)? = nil,
        agentEndpointProvider: (() -> (baseURL: URL, accessToken: String)?)? = nil,
        hostStatusSink: ((Bool, String?) -> Void)? = nil,
        agentEnabled: Bool = true,
        onRequestAgentUpgrade: (() -> Void)? = nil,
        onRequestOpenSettings: (() -> Void)? = nil,
        leadingHeaderItem: AnyView? = nil,
        agentLeadingToolbarItem: AnyView? = nil,
        navigationTitleAccessoryText: String? = nil,
        onRunScript: ((ScriptRunRequest) async -> ScriptRunResult?)? = nil,
        activePreviewManagerProvider: (() -> ScriptPreviewManager?)? = nil,
        onStopActiveScript: (() -> Void)? = nil,
        externalScriptSessions: [ScriptSessionStatus] = [],
        onSelectExternalScriptSession: ((String) -> Void)? = nil,
        onStopExternalScriptSession: ((String) -> Void)? = nil
    ) {
        self.device = device
        self.hostStatusSink = hostStatusSink
        self.agentEnabled = agentEnabled
        self.onRequestAgentUpgrade = onRequestAgentUpgrade
        self.onRequestOpenSettings = onRequestOpenSettings
        self.leadingHeaderItem = leadingHeaderItem
        self.agentLeadingToolbarItem = agentLeadingToolbarItem
        self.navigationTitleAccessoryText = navigationTitleAccessoryText
        self.agentEndpointProvider = agentEndpointProvider
        self.onRunScript = onRunScript
        self.activePreviewManagerProvider = activePreviewManagerProvider
        self.onStopActiveScript = onStopActiveScript
        self.externalScriptSessions = externalScriptSessions
        self.onSelectExternalScriptSession = onSelectExternalScriptSession
        self.onStopExternalScriptSession = onStopExternalScriptSession
        self._previewManager = StateObject(wrappedValue: previewManager)
        _agentViewModel = StateObject(
            wrappedValue: AgentChatViewModel(endpointProvider: agentEndpointProvider)
        )
    }

    @MainActor
    public init(
        device: (any ScriptDevice)? = nil,
        agentEndpointProvider: (() -> (baseURL: URL, accessToken: String)?)? = nil,
        hostStatusSink: ((Bool, String?) -> Void)? = nil,
        agentEnabled: Bool = true,
        onRequestAgentUpgrade: (() -> Void)? = nil,
        onRequestOpenSettings: (() -> Void)? = nil,
        leadingHeaderItem: AnyView? = nil,
        agentLeadingToolbarItem: AnyView? = nil,
        navigationTitleAccessoryText: String? = nil,
        onRunScript: ((ScriptRunRequest) async -> ScriptRunResult?)? = nil,
        activePreviewManagerProvider: (() -> ScriptPreviewManager?)? = nil,
        onStopActiveScript: (() -> Void)? = nil,
        externalScriptSessions: [ScriptSessionStatus] = [],
        onSelectExternalScriptSession: ((String) -> Void)? = nil,
        onStopExternalScriptSession: ((String) -> Void)? = nil
    ) {
        self.init(
            previewManager: ScriptPreviewManager(),
            device: device,
            agentEndpointProvider: agentEndpointProvider,
            hostStatusSink: hostStatusSink,
            agentEnabled: agentEnabled,
            onRequestAgentUpgrade: onRequestAgentUpgrade,
            onRequestOpenSettings: onRequestOpenSettings,
            leadingHeaderItem: leadingHeaderItem,
            agentLeadingToolbarItem: agentLeadingToolbarItem,
            navigationTitleAccessoryText: navigationTitleAccessoryText,
            onRunScript: onRunScript,
            activePreviewManagerProvider: activePreviewManagerProvider,
            onStopActiveScript: onStopActiveScript,
            externalScriptSessions: externalScriptSessions,
            onSelectExternalScriptSession: onSelectExternalScriptSession,
            onStopExternalScriptSession: onStopExternalScriptSession
        )
    }

    public var body: some View {
        ZStack {
            #if os(macOS)
            HStack(spacing: 0) {
                primaryContent
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                if showingAgentPanel {
                    AgentPanelResizeHandle(panelWidth: $agentPanelWidth)
                    AgentChatPanelView(
                        viewModel: agentViewModel,
                        agentEnabled: agentEnabled,
                        onRequestUpgrade: onRequestAgentUpgrade
                    )
                    .frame(width: agentPanelWidth)
                    .transition(.move(edge: .trailing))
                }
            }
            #else
            primaryContent
            #endif

            if viewModel.isPerformingAction {
                VStack(spacing: 12) {
                    ProgressView()
                        .progressViewStyle(.circular)

                    if let t = viewModel.performingActionText, !t.isEmpty {
                        Text(t)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }
                .padding(24)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .shadow(radius: 12)
            }
        }
        .navigationTitle(navigationTitleText)
        #if canImport(UIKit)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar { toolbarContent() }
        .alert(item: $viewModel.notice) { notice in
            Alert(title: Text(notice.title), message: Text(notice.message), dismissButton: .default(Text("OK")))
        }
        .alert(item: $previewManager.dialog) { dialog in
            Alert(title: Text(dialog.title), message: Text(dialog.message), dismissButton: .default(Text("OK")))
        }
        .sheet(
            isPresented: Binding(
                get: { previewManager.scriptError != nil },
                set: { presented in
                    if !presented { previewManager.scriptError = nil }
                }
            )
        ) {
            scriptErrorSheet
        }
        .confirmationDialog(
            "Stop current script?",
            isPresented: $showingSwitchScriptConfirmation,
            titleVisibility: .visible
        ) {
            Button("Stop & Run", role: .destructive) {
                startPendingScriptPreview()
            }
            Button("Cancel", role: .cancel) {
                pendingScriptPreviewId = nil
            }
        } message: {
            Text(switchScriptConfirmationMessage)
        }
        .sheet(item: $namePrompt) { prompt in
            NamePromptSheet(prompt: prompt)
        }
        #if !os(macOS)
        .sheet(isPresented: $showingAgentPanel) {
            NavigationStack {
                AgentChatPanelView(
                    viewModel: agentViewModel,
                    agentEnabled: agentEnabled,
                    onRequestUpgrade: onRequestAgentUpgrade
                )
                .navigationTitle("Agent")
                #if canImport(UIKit)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close") {
                            showingAgentPanel = false
                        }
                    }

                    ToolbarItem(placement: .primaryAction) {
                        Menu {
                            agentConversationMenuItems
                        } label: {
                            Image(systemName: "ellipsis.circle")
                        }
                    }
                }
            }
            #if canImport(UIKit)
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            #endif
        }
        #endif
        .sheet(item: $signalRenamePrompt) { prompt in
            NamePromptSheet(prompt: prompt)
        }
        .confirmationDialog(
            "Delete script?",
            isPresented: $showingDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                guard let target = deleteTarget else { return }
                Task {
                    await viewModel.deleteScript(id: target.id)
                }
                deleteTarget = nil
            }
            Button("Cancel", role: .cancel) {
                deleteTarget = nil
            }
        } message: {
            if let target = deleteTarget {
                Text("Are you sure you want to delete \(target.name)?")
            }
        }
        .confirmationDialog(
            "Delete file?",
            isPresented: $showingSignalDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                guard let target = signalDeleteTarget else { return }
                deleteSignalFile(id: target.id)
                signalDeleteTarget = nil
            }
            Button("Cancel", role: .cancel) {
                signalDeleteTarget = nil
            }
        } message: {
            if let target = signalDeleteTarget {
                Text("Are you sure you want to delete \(target.name)?")
            }
        }
        // Signals open in the same editor view (not a modal sheet).
        .onAppear {
            previewManager.attach(device: device)
            #if os(macOS)
            agentViewModel.configureToolRuntime(makeMacAgentToolRuntime())
            #endif
            loadScripts()
            hostStatusSink?(previewManager.activeScriptName != nil, previewManager.activeScriptName)
        }
        .onChange(of: showingPreview) { _ in
            hostStatusSink?(previewManager.activeScriptName != nil, previewManager.activeScriptName)
        }
        .onChange(of: previewManager.activeScriptName) { _ in
            hostStatusSink?(previewManager.activeScriptName != nil, previewManager.activeScriptName)
        }
    }

    private var primaryContent: some View {
        Group {
            if showingEditor {
                editorView
            } else {
                mainView
            }
        }
    }

    private var mainView: some View {
        Group {
            if showingPreview {
                let renderManager = activePreviewManager
                ZStack {
                    ScriptRenderView(tree: renderManager.scriptTree) { token, args in
                        renderManager.invoke(token: token, arguments: args)
                    }
                    .opacity(renderManager.scriptTree == nil ? 0 : 1)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

                    if renderManager.scriptTree == nil {
                        VStack {
                            if renderManager.isRendering {
                                ProgressView("Rendering…")
                            } else if let error = renderManager.scriptError, !error.isEmpty {
                                Text(error)
                                    .font(.caption.monospaced())
                                    .foregroundColor(.red)
                                    .textSelection(.enabled)
                                    .multilineTextAlignment(.leading)
                                    .frame(maxWidth: 640, alignment: .leading)
                            } else {
                                Text("Render a script to preview it here.")
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Self.secondaryBackground)
            } else {
                if viewModel.assetScripts.isEmpty && viewModel.customScripts.isEmpty {
                    VStack(spacing: 8) {
                        Text("No scripts available")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        Button(action: openNewScriptEditor) {
                            Label("New Script", systemImage: "plus")
                                .font(.caption)
                        }
                        .buttonStyle(.bordered)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        if !viewModel.assetScripts.isEmpty {
                            ForEach(viewModel.assetScripts) { script in
                                ScriptRow(
                                    script: script,
                                    isSelected: script.id == viewModel.selectedScriptId,
                                    sessionStatuses: sessionStatuses(for: script.id),
                                    onTap: { openOrRestoreScript(script.id) },
                                    onStopSession: { stopScriptSession(for: script.id) },
                                    onEdit: { openEditor(for: script.id) }
                                )
                                .listRowSeparator(.hidden)
                                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                            }
                        }

                        if !viewModel.customScripts.isEmpty {
                            Section("Custom Scripts") {
                                ForEach(viewModel.customScripts) { script in
                                    ScriptRow(
                                        script: script,
                                        isSelected: script.id == viewModel.selectedScriptId,
                                        sessionStatuses: sessionStatuses(for: script.id),
                                        onTap: { openOrRestoreScript(script.id) },
                                        onStopSession: { stopScriptSession(for: script.id) },
                                        onEdit: { openEditor(for: script.id) }
                                    )
                                    .listRowSeparator(.hidden)
                                    .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                                }
                            }
                        }

                        if !viewModel.signalFiles.isEmpty {
                            Section("Signals") {
                                ForEach(viewModel.signalFiles) { item in
                                    ScriptRow(
                                        script: item,
                                        isSelected: false,
                                        sessionStatuses: [],
                                        onTap: { openSignalEditor(item) },
                                        onStopSession: nil,
                                        onEdit: { openSignalEditor(item) }
                                    )
                                    .listRowSeparator(.hidden)
                                    .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
        }
    }

    private var editorView: some View {
        VStack(spacing: 0) {
                if editorIsReadOnly {

                    HStack(spacing: 10) {
                        Label(readOnlyLabelText, systemImage: "lock")
                            .font(.subheadline)
                            .foregroundColor(.secondary)

                        Spacer()

                        if editorMode == .script {
                            Button("Make Copy") {
                                if let currentScriptId {
                                    presentNamePrompt(context: .copy(id: currentScriptId))
                                }
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Self.secondaryBackground)
                }

                editorTextView
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Self.primaryBackground)
    }

    private var readOnlyLabelText: String {
        switch editorMode {
        case .script:
            if let currentScriptId {
                switch viewModel.fileKind(for: currentScriptId) {
                case .library:
                    return "Library script (read-only)"
                case .kernel:
                    return "Kernel script (read-only)"
                case .script, .signalRaw, .signalText:
                    break
                }
            }
            return "Example script (read-only)"
        case .signalRaw:
            return "Signal .raw (read-only)"
        case .signalText:
            return "Signal .txt"
        }
    }

    private var editorTextView: some View {
        Group {
            EmwCodeEditor(
                text: $editorContent,
                isEditable: !editorIsReadOnly,
                wrapLines: (editorMode == .signalText) ? true : lineWrapEnabled
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onChange(of: editorContent) { newValue in
            if let id = currentScriptId {
                viewModel.updateDraft(for: id, content: newValue)
            }
        }
    }

    private func calculateTextWidth(_ text: String) -> CGFloat {
        let lines = text.components(separatedBy: .newlines)
        let longestLine = lines.max(by: { $0.count < $1.count }) ?? ""
        let calculatedWidth = CGFloat(longestLine.count) * 10 + 200
        return max(800, calculatedWidth)
    }

    private var currentScriptName: String? {
        guard let id = currentScriptId else { return nil }
        return viewModel.scriptName(for: id)
    }

    private var navigationTitleText: String {
        if showingEditor {
            if let override = editorTitleOverride, !override.isEmpty {
                return override
            }
            return currentScriptName ?? "Script"
        }
        if showingPreview {
            return (currentScriptName ?? "Script") + " Preview"
        }
        if let navigationTitleAccessoryText,
           !navigationTitleAccessoryText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "EMWaver \(navigationTitleAccessoryText)"
        }
        return "EMWaver"
    }

    private var activePreviewManager: ScriptPreviewManager {
        activePreviewManagerProvider?() ?? previewManager
    }

    private func loadScripts() {
        Task {
            await viewModel.loadScripts()
        }
    }

    private func previewScript(_ id: String) {
        guard viewModel.isRunnableScript(id) else {
            openEditor(for: id)
            return
        }
        if onRunScript == nil, shouldConfirmSwitchBeforePreview(id: id) {
            pendingScriptPreviewId = id
            showingSwitchScriptConfirmation = true
            return
        }
        startPreviewScript(id)
    }

    private func openOrRestoreScript(_ id: String) {
        guard viewModel.isRunnableScript(id) else {
            openEditor(for: id)
            return
        }
        if let session = sessionStatuses(for: id).first {
            onSelectExternalScriptSession?(session.id)
            viewModel.selectScript(id: id)
            currentScriptId = id
            showingEditor = false
            showingPreview = true
            return
        }
        previewScript(id)
    }

    private func sessionStatuses(for scriptId: String) -> [ScriptSessionStatus] {
        externalScriptSessions.filter { $0.scriptId == scriptId }
    }

    private func stopScriptSession(for scriptId: String) {
        guard let session = sessionStatuses(for: scriptId).first else { return }
        onStopExternalScriptSession?(session.id)
    }

    private func startPendingScriptPreview() {
        guard let id = pendingScriptPreviewId else { return }
        pendingScriptPreviewId = nil
        previewManager.exitPreview()
        startPreviewScript(id)
    }

    private func startPreviewScript(_ id: String) {
        // Track whether we launched from the editor or main screen
        let wasInEditor = showingEditor
        if showingEditor, let currentId = currentScriptId {
            viewModel.updateDraft(for: currentId, content: editorContent)
        }

        viewModel.selectScript(id: id)
        currentScriptId = id
        Task {
            await viewModel.ensureContent(for: id)
            await MainActor.run {
                let script = viewModel.scriptDraft(for: id)
                let name = viewModel.scriptName(for: id)
                let modules = viewModel.moduleSources()
                startScriptRuntime(scriptId: id, script: script, name: name, moduleSources: modules)
                previewLaunchedFromEditor = wasInEditor
                showingPreview = true
                showingEditor = false
            }
        }
    }

    private func shouldConfirmSwitchBeforePreview(id: String) -> Bool {
        guard onRunScript == nil else { return false }
        guard let runningName = previewManager.activeScriptName, !runningName.isEmpty else {
            return false
        }
        let targetName = viewModel.scriptName(for: id)
        return runningName != targetName
    }

    private var switchScriptConfirmationMessage: String {
        let runningName = previewManager.activeScriptName ?? "current script"
        let targetName = pendingScriptPreviewId.map { viewModel.scriptName(for: $0) } ?? "selected script"
        return "\(runningName) is still running in the background. Stop it and run \(targetName)?"
    }

    private func startScriptRuntime(scriptId: String, script: String, name: String, moduleSources: [String: String]) {
        guard let onRunScript else {
            previewManager.render(script: script, name: name, moduleSources: moduleSources)
            return
        }

        Task {
            let request = ScriptRunRequest(scriptId: scriptId, name: name, source: script, moduleSources: moduleSources)
            if let result = await onRunScript(request) {
                if result.running {
                    hostStatusSink?(true, result.name)
                } else {
                    previewManager.scriptError = result.errorMessage ?? "Script did not start."
                    hostStatusSink?(false, result.name)
                }
            } else {
                previewManager.scriptError = "Script did not start."
                hostStatusSink?(false, name)
            }
        }
    }

    private func openEditor(for id: String) {
        editorMode = .script
        editorTitleOverride = nil
        // Default to no-wrap for scripts (toggle available in menu)
        lineWrapEnabled = false
        viewModel.selectScript(id: id)
        currentScriptId = id
        editorIsReadOnly = viewModel.isAssetScript(id)
        Task {
            await viewModel.ensureContent(for: id)
            await MainActor.run {
                editorContent = viewModel.scriptDraft(for: id)
                showingEditor = true
                showingPreview = false
            }
        }
    }

    private func openSignalEditor(_ item: ScriptsViewModel.ScriptListItem) {
        guard item.kind != .script else { return }

        currentScriptId = item.id
        editorTitleOverride = item.name
        viewModel.selectScript(id: nil)

        switch item.kind {
        case .signalRaw:
            editorMode = .signalRaw
            editorIsReadOnly = true
            lineWrapEnabled = false
        case .signalText:
            editorMode = .signalText
            editorIsReadOnly = false
            // Always wrap .txt (no toggle)
            lineWrapEnabled = true
        case .script, .library, .kernel:
            editorMode = .script
            editorIsReadOnly = false
            lineWrapEnabled = false
        }

        Task {
            do {
                let url = FileService.shared.signalsDirectoryURL().appendingPathComponent(item.id)
                let data = try Data(contentsOf: url)
                await MainActor.run {
                    if item.kind == .signalRaw {
                        editorContent = formatHex(data: data, maxBytes: 256 * 1024)
                    } else {
                        // Be tolerant of non-UTF8 bytes; show replacement chars instead of blank.
                        editorContent = String(decoding: data, as: UTF8.self)
                    }
                    showingEditor = true
                    showingPreview = false
                }
            } catch {
                await MainActor.run {
                    editorContent = ""
                    editorIsReadOnly = true
                    showingEditor = true
                    showingPreview = false
                }
            }
        }
    }

    private func openNewScriptEditor() {
        editorMode = .script
        editorTitleOverride = nil
        lineWrapEnabled = false
        viewModel.selectScript(id: viewModel.unsavedIdentifier)
        currentScriptId = viewModel.unsavedIdentifier
        editorContent = viewModel.scriptDraft(for: viewModel.unsavedIdentifier)
        editorIsReadOnly = false
        showingEditor = true
        showingPreview = false
    }

    private func exitEditor() {
        showingEditor = false
        currentScriptId = nil
        editorContent = ""
        editorIsReadOnly = false
        editorMode = .script
        editorTitleOverride = nil
        lineWrapEnabled = false
    }

    private func exitPreview() {
        // On macOS we want scripts to keep running in the background even if the user goes back
        // to the main script list. That also allows the Agent to keep observing ui.snapshot.
        showingPreview = false
        // If launched from editor, go back to editor; otherwise go to main screen
        if previewLaunchedFromEditor {
            showingEditor = true
        } else {
            currentScriptId = nil
        }
        previewLaunchedFromEditor = false

        #if os(macOS)
        activePreviewManager.hidePreview()
        #else
        previewManager.exitPreview()
        #endif
    }

    private func saveCurrentScript() {
        guard let id = currentScriptId else { return }
        if viewModel.isAssetScript(id) {
            return
        }
        if viewModel.isExistingScript(id) {
            Task {
                await viewModel.saveScript(id: id)
            }
        } else {
            presentNamePrompt(context: .create)
        }
    }

    private func saveCurrentSignalText() {
        guard let id = currentScriptId else { return }
        let url = FileService.shared.signalsDirectoryURL().appendingPathComponent(id)
        let data = editorContent.data(using: .utf8) ?? Data()
        Task {
            do {
                try data.write(to: url, options: [.atomic])
                await viewModel.loadScripts()
            } catch {
                // Best-effort; view model will show errors elsewhere.
            }
        }
    }

    private func formatHex(data: Data, maxBytes: Int) -> String {
        let slice = data.prefix(maxBytes)
        var out: [String] = []
        out.reserveCapacity((slice.count / 16) + 8)

        let bytes = [UInt8](slice)
        var offset = 0
        while offset < bytes.count {
            let line = bytes[offset..<min(offset + 16, bytes.count)]
            let hex = line.map { String(format: "%02X", $0) }.joined(separator: " ")
            let ascii = line.map { b -> String in
                if b >= 32 && b < 127 {
                    return String(UnicodeScalar(b))
                }
                return "."
            }.joined()
            out.append(String(format: "%08X  %-47@  |%@|", offset, hex as NSString, ascii as NSString))
            offset += 16
        }

        if data.count > maxBytes {
            out.append("\n(truncated to \(maxBytes) bytes; file is \(data.count) bytes)")
        }
        return out.joined(separator: "\n")
    }

    private func presentNamePrompt(context: NamePromptContext) {
        let initial: String
        switch context {
        case .create:
            initial = "script_script.js"
        case .rename(let id):
            initial = viewModel.scriptName(for: id)
        case .copy(let id):
            let original = viewModel.scriptName(for: id)
            if original.lowercased().hasSuffix(".js") {
                let base = String(original.dropLast(3))
                initial = base + "_copy.js"
            } else {
                initial = original + "_copy"
            }
        }

        namePrompt = NamePrompt(
            context: context,
            title: context.title,
            message: context.message,
            initialValue: initial
        ) { name in
            handleName(context: context, name: name)
        }
    }

    private func presentSignalRenamePrompt(id: String) {
        let currentName = editorTitleOverride ?? id
        signalRenamePrompt = NamePrompt(
            context: .rename(id: id),
            title: "Rename File",
            message: "Enter a new name for this file.",
            initialValue: currentName
        ) { name in
            renameSignalFile(id: id, newName: name)
        }
    }

    private func renameSignalFile(id: String, newName: String) {
        let trimmed = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // Keep extension stable.
        let requiredExt: String
        switch editorMode {
        case .signalRaw: requiredExt = ".raw"
        case .signalText: requiredExt = ".txt"
        case .script: requiredExt = ""
        }

        var finalName = trimmed
        if !requiredExt.isEmpty, !finalName.lowercased().hasSuffix(requiredExt) {
            finalName += requiredExt
        }

        let dir = FileService.shared.signalsDirectoryURL()
        let oldURL = dir.appendingPathComponent(id)
        let newURL = dir.appendingPathComponent(finalName)

        do {
            if FileManager.default.fileExists(atPath: newURL.path) {
                return
            }
            try FileManager.default.moveItem(at: oldURL, to: newURL)
            currentScriptId = finalName
            editorTitleOverride = finalName
            Task { await viewModel.loadScripts() }
        } catch {
            // Best-effort; ignore for now.
        }
    }

    private func deleteSignalFile(id: String) {
        let dir = FileService.shared.signalsDirectoryURL()
        let url = dir.appendingPathComponent(id)
        do {
            try FileManager.default.removeItem(at: url)
        } catch {
            // ignore
        }
        exitEditor()
        loadScripts()
    }

    private func handleName(context: NamePromptContext, name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        Task {
            switch context {
            case .create:
                if let newId = await viewModel.createScript(name: trimmed) {
                    await MainActor.run {
                        currentScriptId = newId
                        editorContent = viewModel.scriptDraft(for: newId)
                    }
                }
            case .rename(let id):
                await viewModel.renameScript(id: id, newName: trimmed)
            case .copy(let id):
                if let newId = await viewModel.copyScript(id: id, newName: trimmed) {
                    await MainActor.run {
                        currentScriptId = newId
                        editorContent = viewModel.scriptDraft(for: newId)
                    }
                }
            }
        }
    }

    #if os(macOS)
    private func makeMacAgentToolRuntime() -> AgentToolRuntime {
        AgentToolRuntime(
            tools: { macAgentTools },
            context: { macAgentToolContext() },
            execute: { name, arguments in
                await executeMacAgentTool(name: name, arguments: arguments)
            }
        )
    }

    private var macAgentTools: [AgentToolDefinition] {
        let empty = schema([])
        let scriptId = optionalStringProperty("scriptId", "Script id. Defaults to the current script.")
        return [
            AgentToolDefinition(name: "list_scripts", description: "Return bundled and custom EMWaver JavaScript scripts.", parameters: empty),
            AgentToolDefinition(name: "read_script", description: "Return script source. Defaults to the current script.", parameters: schema([scriptId])),
            AgentToolDefinition(name: "apply_patch_to_script", description: "Update an editable script draft. Asset scripts are read-only.", parameters: schema([
                scriptId,
                optionalStringProperty("patch", "Unified diff patch to apply."),
                optionalStringProperty("content", "Full replacement script content."),
            ])),
            AgentToolDefinition(name: "run_script", description: "Start the script runtime for the given script.", parameters: schema([scriptId])),
            AgentToolDefinition(name: "stop_script", description: "Stop the current script runtime.", parameters: empty),
            AgentToolDefinition(name: "get_device_status", description: "Return connected/local device and runtime status known to the macOS app.", parameters: empty),
            AgentToolDefinition(name: "spi_transfer", description: "Send bytes over SPI and receive the response. `bytes` is the TX array (0–255 each). `cs` is the chip-select pin number. `rx_length`, if provided, overrides the number of response bytes to read.", parameters: schema([
                ("bytes", .object(["type": .string("array"), "items": .object(["type": .string("number")]), "description": .string("Bytes to transmit (0–255 each).")])),
                ("cs", .object(["type": .string("number"), "description": .string("Chip-select pin number.")])),
                ("rx_length", .object(["type": .string("number"), "description": .string("Number of response bytes. Defaults to len(bytes).")])),
            ], required: ["bytes", "cs"])),
            AgentToolDefinition(name: "gpio_mode", description: "Set a GPIO pin mode.", parameters: schema([
                ("pin", .object(["type": .string("number"), "description": .string("Pin number.")])),
                ("mode", .object(["type": .string("string"), "enum": .array([.string("INPUT"), .string("OUTPUT"), .string("INPUT_PULLUP")]), "description": .string("Pin mode.")])),
            ], required: ["pin", "mode"])),
            AgentToolDefinition(name: "gpio_write", description: "Write HIGH or LOW to a digital output pin.", parameters: schema([
                ("pin", .object(["type": .string("number"), "description": .string("Pin number.")])),
                ("value", .object(["type": .string("string"), "enum": .array([.string("HIGH"), .string("LOW")]), "description": .string("Output level.")])),
            ], required: ["pin", "value"])),
            AgentToolDefinition(name: "gpio_read", description: "Read the current level of a digital pin. Returns 0 or 1.", parameters: schema([
                ("pin", .object(["type": .string("number"), "description": .string("Pin number.")])),
            ], required: ["pin"])),
            AgentToolDefinition(name: "analog_read", description: "Read an ADC pin. Returns a floating-point voltage or raw value depending on the board.", parameters: schema([
                ("pin", .object(["type": .string("number"), "description": .string("Pin number.")])),
            ], required: ["pin"])),
            AgentToolDefinition(name: "sleep", description: "Wait for a given number of milliseconds before continuing. Use after triggering async hardware operations to allow them time to complete.", parameters: schema([
                ("ms", .object(["type": .string("number"), "description": .string("Milliseconds to wait (max 30000).")])),
            ], required: ["ms"])),
        ]
    }

    private func optionalStringProperty(_ name: String, _ description: String) -> (String, AgentToolJSON) {
        (name, .object(["type": .string("string"), "description": .string(description)]))
    }

    private func schema(_ properties: [(String, AgentToolJSON)], required: [String] = []) -> AgentToolJSON {
        var props: [String: AgentToolJSON] = [:]
        for (name, value) in properties {
            props[name] = value
        }
        return .object([
            "type": .string("object"),
            "properties": .object(props),
            "required": .array(required.map { .string($0) }),
            "additionalProperties": .bool(false),
        ])
    }

    private func macAgentToolContext() -> String {
        let selected = currentScriptId ?? viewModel.selectedScriptId ?? ""
        let manager = activePreviewManager
        let running = manager.activeScriptName ?? ""
        let deviceState = device == nil ? "not attached" : "attached"
        let boardType = agentReadDeviceTextCommand(AgentHardwareProtocol.boardGet) ?? "unknown"
        return "selectedScriptId=\(selected); runningScript=\(running); device=\(deviceState); boardType=\(boardType)"
    }

    private func executeMacAgentTool(name: String, arguments: [String: AgentToolJSON]) async -> AgentToolResult {
        do {
            switch name {
            case "list_scripts":
                return agentToolListScripts()
            case "read_script":
                return try await agentToolReadScript(scriptId: arguments["scriptId"]?.stringValue)
            case "apply_patch_to_script":
                return try await agentToolApplyPatch(scriptId: arguments["scriptId"]?.stringValue, patch: arguments["patch"]?.stringValue, content: arguments["content"]?.stringValue)
            case "run_script":
                return try await agentToolPreviewScript(scriptId: arguments["scriptId"]?.stringValue, toolName: name)
            case "stop_script":
                if let onStopActiveScript {
                    onStopActiveScript()
                } else {
                    previewManager.exitPreview()
                }
                hostStatusSink?(false, nil)
                return AgentToolResult(id: nil, name: name, ok: true, result: .object(["stopped": .bool(true)]))
            case "get_device_status":
                return agentToolDeviceStatus()
            case "spi_transfer":
                return await agentToolSpiTransfer(arguments: arguments)
            case "gpio_mode":
                return await agentToolGpioMode(arguments: arguments)
            case "gpio_write":
                return await agentToolGpioWrite(arguments: arguments)
            case "gpio_read":
                return await agentToolGpioRead(arguments: arguments)
            case "analog_read":
                return await agentToolAnalogRead(arguments: arguments)
            case "sleep":
                let ms: Double
                if case .number(let v) = arguments["ms"] { ms = v } else { ms = 0 }
                let clamped = min(max(ms, 0), 30_000)
                try await Task.sleep(nanoseconds: UInt64(clamped) * 1_000_000)
                return AgentToolResult(id: nil, name: "sleep", ok: true, result: .object(["slept_ms": .number(clamped)]))
            default:
                return AgentToolResult(id: nil, name: name, ok: false, error: "Unknown EMWaver tool: \(name)")
            }
        } catch {
            return AgentToolResult(id: nil, name: name, ok: false, error: (error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
        }
    }

    private enum MacAgentToolError: LocalizedError {
        case noScriptSelected
        case scriptNotFound(String)
        case readOnlyScript(String)
        case missingArgument(String)

        var errorDescription: String? {
            switch self {
            case .noScriptSelected: return "No script is selected."
            case .scriptNotFound(let id): return "Script not found: \(id)"
            case .readOnlyScript(let id): return "Script is read-only: \(id)"
            case .missingArgument(let name): return "Missing required argument: \(name)"
            }
        }
    }

    private func currentAgentScriptId(_ requested: String? = nil) throws -> String {
        if let requested, !requested.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return requested
        }
        if let currentScriptId, editorMode == .script {
            return currentScriptId
        }
        if let selected = viewModel.selectedScriptId {
            return selected
        }
        throw MacAgentToolError.noScriptSelected
    }

    private func agentToolListScripts() -> AgentToolResult {
        func itemObject(_ item: ScriptsViewModel.ScriptListItem) -> AgentToolJSON {
            .object([
                "id": .string(item.id),
                "name": .string(item.name),
                "kind": .string(item.kind.rawValue),
                "runnable": .bool(item.kind.isRunnable),
                "isAsset": .bool(item.isAsset),
                "isDirty": .bool(item.isDirty)
            ])
        }
        let scripts = (viewModel.assetScripts + viewModel.customScripts).map(itemObject)
        return AgentToolResult(id: nil, name: "list_scripts", ok: true, result: .object(["scripts": .array(scripts)]))
    }

    private func agentToolReadScript(scriptId: String?) async throws -> AgentToolResult {
        let id = try currentAgentScriptId(scriptId)
        await viewModel.ensureContent(for: id)
        let source = (showingEditor && currentScriptId == id && editorMode == .script) ? editorContent : viewModel.scriptDraft(for: id)
        if source.isEmpty && !viewModel.isExistingScript(id) {
            throw MacAgentToolError.scriptNotFound(id)
        }
        return AgentToolResult(id: nil, name: "read_script", ok: true, result: .object(scriptObject(id: id, source: source)))
    }

    private func agentToolApplyPatch(scriptId: String?, patch: String?, content: String?) async throws -> AgentToolResult {
        let id = try currentAgentScriptId(scriptId)
        guard !viewModel.isAssetScript(id) else { throw MacAgentToolError.readOnlyScript(id) }
        await viewModel.ensureContent(for: id)

        let updated: String
        if let content {
            updated = content
        } else if let patch, !patch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("emwaver-agent-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: tempDir) }
            let fileName = viewModel.scriptName(for: id)
            let fileURL = tempDir.appendingPathComponent(fileName)
            try viewModel.scriptDraft(for: id).write(to: fileURL, atomically: true, encoding: .utf8)
            _ = try PatchApplier.apply(patchText: patch, baseDir: tempDir)
            updated = try String(contentsOf: fileURL, encoding: .utf8)
        } else {
            throw MacAgentToolError.missingArgument("patch or content")
        }

        viewModel.updateDraft(for: id, content: updated)
        if showingEditor && currentScriptId == id && editorMode == .script {
            editorContent = updated
        }
        return AgentToolResult(id: nil, name: "apply_patch_to_script", ok: true, result: .object([
            "scriptId": .string(id),
            "name": .string(viewModel.scriptName(for: id)),
            "bytes": .number(Double(updated.utf8.count)),
            "saved": .bool(false)
        ]))
    }

    private func agentToolPreviewScript(scriptId: String?, toolName: String) async throws -> AgentToolResult {
        let id = try currentAgentScriptId(scriptId)
        guard viewModel.isRunnableScript(id) else {
            throw MacAgentToolError.scriptNotFound("Script is not runnable: \(id)")
        }
        if showingEditor, currentScriptId == id, editorMode == .script {
            viewModel.updateDraft(for: id, content: editorContent)
        }
        viewModel.selectScript(id: id)
        currentScriptId = id
        await viewModel.ensureContent(for: id)
        let script = viewModel.scriptDraft(for: id)
        guard !script.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw MacAgentToolError.scriptNotFound(id)
        }
        startScriptRuntime(scriptId: id, script: script, name: viewModel.scriptName(for: id), moduleSources: viewModel.moduleSources())
        showingPreview = true
        showingEditor = false
        hostStatusSink?(true, viewModel.scriptName(for: id))
        return AgentToolResult(id: nil, name: toolName, ok: true, result: .object([
            "scriptId": .string(id),
            "name": .string(viewModel.scriptName(for: id)),
            "running": .bool(true)
        ]))
    }

    private func agentToolDeviceStatus() -> AgentToolResult {
        let manager = activePreviewManager
        let boardType = agentReadDeviceTextCommand(AgentHardwareProtocol.boardGet) ?? ""
        let deviceName = agentReadDeviceTextCommand(AgentHardwareProtocol.nameGet) ?? ""
        return AgentToolResult(id: nil, name: "get_device_status", ok: true, result: .object([
            "connected": .bool(device != nil),
            "boardType": .string(boardType),
            "deviceName": .string(deviceName),
            "runtimeOwner": .string("macos"),
            "activeScriptName": .string(manager.activeScriptName ?? ""),
            "activeScriptInstanceId": .string(manager.activeScriptInstanceId ?? ""),
            "isRendering": .bool(manager.isRendering),
            "lastScriptError": .string(manager.scriptError ?? "")
        ]))
    }

    private enum AgentHardwareProtocol {
        static let responseOK: UInt8 = 0x80
        static let responseErr: UInt8 = 0x81
        static let responseBusy: UInt8 = 0x82

        static let nameGet: UInt8 = 0x04
        static let boardGet: UInt8 = 0x09

        static let gpio: UInt8 = 0x10
        static let gpioInput: UInt8 = 0x00
        static let gpioOutput: UInt8 = 0x01
        static let gpioRead: UInt8 = 0x02
        static let gpioHigh: UInt8 = 0x03
        static let gpioLow: UInt8 = 0x04
        static let gpioPull: UInt8 = 0x05

        static let adcRead: UInt8 = 0x20
        static let adcPin: UInt8 = 0x00

        static let spiTransfer: UInt8 = 0x50
    }

    private func agentReadDeviceTextCommand(_ opcode: UInt8) -> String? {
        guard let device else { return nil }
        guard let response = device.sendCommand(Data([opcode]), timeout: 1500) else { return nil }
        let bytes = [UInt8](response)
        guard bytes.first == AgentHardwareProtocol.responseOK else { return nil }
        return String(data: Data(bytes.dropFirst()), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private enum AgentHardwareSendResult {
        case success([UInt8])
        case failure(String)
    }

    private enum AgentArgumentResult<Value> {
        case success(Value)
        case failure(AgentToolResult)
    }

    private final class AgentHardwareDeviceBox: @unchecked Sendable {
        let device: any ScriptDevice

        init(_ device: any ScriptDevice) {
            self.device = device
        }
    }

    private func agentHardwareSend(_ command: [UInt8], timeout: Int = 1500) async -> AgentHardwareSendResult {
        guard let device else {
            return .failure("No device connected")
        }
        guard command.count <= device.bufferPacketSizeBytes() else {
            return .failure("Command is too large (\(command.count) bytes, max \(device.bufferPacketSizeBytes()))")
        }

        let deviceBox = AgentHardwareDeviceBox(device)
        return await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let device = deviceBox.device
                guard device.beginAgentHardwarePrimitiveSession() else {
                    continuation.resume(returning: .failure(device.deviceErrorDescription() ?? "Device is busy or unavailable"))
                    return
                }
                defer {
                    device.endAgentHardwarePrimitiveSession()
                }

                guard let response = device.sendCommand(Data(command), timeout: timeout) else {
                    continuation.resume(returning: .failure(device.deviceErrorDescription() ?? "Device did not respond"))
                    return
                }
                guard let status = response.first else {
                    continuation.resume(returning: .failure("Device returned an empty response"))
                    return
                }

                switch status {
                case AgentHardwareProtocol.responseOK:
                    continuation.resume(returning: .success(Array(response.dropFirst())))
                case AgentHardwareProtocol.responseBusy:
                    continuation.resume(returning: .failure("Device busy (0x82): another transport session owns runtime control"))
                case AgentHardwareProtocol.responseErr:
                    continuation.resume(returning: .failure("Device returned ERR (0x81)"))
                default:
                    continuation.resume(returning: .failure("Device error: \(status)"))
                }
            }
        }
    }

    private func agentNumber(_ value: AgentToolJSON?, name: String, toolName: String) -> AgentArgumentResult<Double> {
        guard case .number(let number) = value else {
            return .failure(AgentToolResult(id: nil, name: toolName, ok: false, error: "\(name) is required"))
        }
        return .success(number)
    }

    private func agentPin(_ value: AgentToolJSON?, name: String, toolName: String) -> AgentArgumentResult<UInt8> {
        switch agentNumber(value, name: name, toolName: toolName) {
        case .success(let number):
            let pin = Int(number)
            guard pin >= 0 && pin <= 255 else {
                return .failure(AgentToolResult(id: nil, name: toolName, ok: false, error: "\(name) must be 0-255"))
            }
            return .success(UInt8(pin))
        case .failure(let result):
            return .failure(result)
        }
    }

    private func agentToolSpiTransfer(arguments: [String: AgentToolJSON]) async -> AgentToolResult {
        guard case .array(let byteValues) = arguments["bytes"] else {
            return AgentToolResult(id: nil, name: "spi_transfer", ok: false, error: "bytes must be an array")
        }
        guard let device else {
            return AgentToolResult(id: nil, name: "spi_transfer", ok: false, error: "No device connected")
        }
        let maxTx = max(0, device.bufferPacketSizeBytes() - 4)
        guard byteValues.count <= maxTx else {
            return AgentToolResult(id: nil, name: "spi_transfer", ok: false, error: "bytes is too long (\(byteValues.count), max \(maxTx))")
        }

        var tx: [UInt8] = []
        tx.reserveCapacity(byteValues.count)
        for value in byteValues {
            guard case .number(let number) = value else {
                return AgentToolResult(id: nil, name: "spi_transfer", ok: false, error: "bytes must contain only numbers")
            }
            let byte = Int(number)
            guard byte >= 0 && byte <= 255 else {
                return AgentToolResult(id: nil, name: "spi_transfer", ok: false, error: "SPI bytes must be 0-255")
            }
            tx.append(UInt8(byte))
        }

        let cs: UInt8
        switch agentPin(arguments["cs"], name: "cs (chip-select pin)", toolName: "spi_transfer") {
        case .success(let value): cs = value
        case .failure(let result): return result
        }

        let maxRx = max(0, device.bufferPacketSizeBytes() - 1)
        var rxLength = tx.count
        if case .number(let rxLen) = arguments["rx_length"] {
            rxLength = max(0, min(maxRx, Int(rxLen)))
        }
        let command = [AgentHardwareProtocol.spiTransfer, cs, UInt8(rxLength), UInt8(tx.count)] + tx

        switch await agentHardwareSend(command) {
        case .success(let payload):
            let rx = Array(payload.prefix(rxLength)).map { AgentToolJSON.number(Double($0)) }
            return AgentToolResult(id: nil, name: "spi_transfer", ok: true, result: .object(["rx": .array(rx)]))
        case .failure(let error):
            return AgentToolResult(id: nil, name: "spi_transfer", ok: false, error: error)
        }
    }

    private func agentToolGpioMode(arguments: [String: AgentToolJSON]) async -> AgentToolResult {
        let pin: UInt8
        switch agentPin(arguments["pin"], name: "pin", toolName: "gpio_mode") {
        case .success(let value): pin = value
        case .failure(let result): return result
        }
        guard let mode = arguments["mode"]?.stringValue else {
            return AgentToolResult(id: nil, name: "gpio_mode", ok: false, error: "mode is required")
        }

        let command: [UInt8]
        switch mode.uppercased() {
        case "INPUT":
            command = [AgentHardwareProtocol.gpio, AgentHardwareProtocol.gpioInput, pin]
        case "OUTPUT":
            command = [AgentHardwareProtocol.gpio, AgentHardwareProtocol.gpioOutput, pin]
        case "INPUT_PULLUP":
            command = [AgentHardwareProtocol.gpio, AgentHardwareProtocol.gpioPull, pin, 1]
        default: return AgentToolResult(id: nil, name: "gpio_mode", ok: false, error: "Invalid mode: \(mode)")
        }

        switch await agentHardwareSend(command) {
        case .success:
            return AgentToolResult(id: nil, name: "gpio_mode", ok: true, result: .object(["pin": .number(Double(pin)), "mode": .string(mode)]))
        case .failure(let error):
            return AgentToolResult(id: nil, name: "gpio_mode", ok: false, error: error)
        }
    }

    private func agentToolGpioWrite(arguments: [String: AgentToolJSON]) async -> AgentToolResult {
        let pin: UInt8
        switch agentPin(arguments["pin"], name: "pin", toolName: "gpio_write") {
        case .success(let value): pin = value
        case .failure(let result): return result
        }
        guard let value = arguments["value"]?.stringValue else {
            return AgentToolResult(id: nil, name: "gpio_write", ok: false, error: "value is required")
        }

        let subcommand: UInt8
        switch value.uppercased() {
        case "HIGH": subcommand = AgentHardwareProtocol.gpioHigh
        case "LOW":  subcommand = AgentHardwareProtocol.gpioLow
        default: return AgentToolResult(id: nil, name: "gpio_write", ok: false, error: "value must be HIGH or LOW")
        }

        switch await agentHardwareSend([AgentHardwareProtocol.gpio, subcommand, pin]) {
        case .success:
            return AgentToolResult(id: nil, name: "gpio_write", ok: true, result: .object(["pin": .number(Double(pin)), "value": .string(value)]))
        case .failure(let error):
            return AgentToolResult(id: nil, name: "gpio_write", ok: false, error: error)
        }
    }

    private func agentToolGpioRead(arguments: [String: AgentToolJSON]) async -> AgentToolResult {
        let pin: UInt8
        switch agentPin(arguments["pin"], name: "pin", toolName: "gpio_read") {
        case .success(let value): pin = value
        case .failure(let result): return result
        }

        switch await agentHardwareSend([AgentHardwareProtocol.gpio, AgentHardwareProtocol.gpioRead, pin]) {
        case .success(let payload):
            let level = payload.first.map { $0 == 0 ? 0 : 1 } ?? 0
            return AgentToolResult(id: nil, name: "gpio_read", ok: true, result: .object(["pin": .number(Double(pin)), "level": .number(Double(level))]))
        case .failure(let error):
            return AgentToolResult(id: nil, name: "gpio_read", ok: false, error: error)
        }
    }

    private func agentToolAnalogRead(arguments: [String: AgentToolJSON]) async -> AgentToolResult {
        let pin: UInt8
        switch agentPin(arguments["pin"], name: "pin", toolName: "analog_read") {
        case .success(let value): pin = value
        case .failure(let result): return result
        }

        switch await agentHardwareSend([AgentHardwareProtocol.adcRead, AgentHardwareProtocol.adcPin, pin, 1]) {
        case .success(let payload):
            let lo = UInt16(payload.indices.contains(0) ? payload[0] : 0)
            let hi = UInt16(payload.indices.contains(1) ? payload[1] : 0)
            let value = Double((hi << 8) | lo)
            return AgentToolResult(id: nil, name: "analog_read", ok: true, result: .object(["pin": .number(Double(pin)), "value": .number(value)]))
        case .failure(let error):
            return AgentToolResult(id: nil, name: "analog_read", ok: false, error: error)
        }
    }

    private func scriptObject(id: String, source: String) -> [String: AgentToolJSON] {
        [
            "id": .string(id),
            "name": .string(viewModel.scriptName(for: id)),
            "source": .string(source),
            "kind": .string(viewModel.fileKind(for: id).rawValue),
            "runnable": .bool(viewModel.isRunnableScript(id)),
            "isAsset": .bool(viewModel.isAssetScript(id)),
            "isDirty": .bool(viewModel.isScriptDirty(id)),
            "readOnly": .bool(viewModel.isAssetScript(id))
        ]
    }

    #endif

    @ToolbarContentBuilder
    private func toolbarContent() -> some ToolbarContent {
        #if os(macOS)
        if !showingEditor {
            ToolbarItemGroup(placement: .primaryAction) {
                if let leadingHeaderItem {
                    leadingHeaderItem
                }

                Button {
                    withAnimation(.smooth(duration: 0.24)) {
                        showingAgentPanel.toggle()
                    }
                } label: {
                    Image(systemName: "sparkles")
                }
                .help(showingAgentPanel ? "Hide agent panel" : "Show agent panel")

                if let agentLeadingToolbarItem {
                    agentLeadingToolbarItem
                }
            }
        }
        #else
        if !showingEditor {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showingAgentPanel = true
                } label: {
                    Image(systemName: "sparkles")
                }
                .accessibilityLabel("Show Agent")
            }
        }
        #endif

        if showingEditor {
            let isScriptEditor = (editorMode == .script)
            let canRun = isScriptEditor && currentScriptId.map { viewModel.isRunnableScript($0) } != false
            let canSave = isScriptEditor || (editorMode == .signalText)

            ToolbarItem(placement: .navigation) {
                Button("Close") { exitEditor() }
            }

            ToolbarItemGroup(placement: .primaryAction) {
                if canRun {
                    Button {
                        guard let id = currentScriptId else { return }
                        viewModel.updateDraft(for: id, content: editorContent)
                        previewScript(id)
                    } label: {
                        Image(systemName: "play.fill")
                    }
                    .disabled(editorContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }

                Menu {
                    Button("Copy") { copyToPasteboard(editorContent) }

                    if !editorIsReadOnly {
                        Button("Paste") {
                            if let text = pasteFromPasteboard() {
                                editorContent = text
                            }
                        }
                    }

                    if isScriptEditor, let currentScriptId, viewModel.isExistingScript(currentScriptId), !viewModel.isAssetScript(currentScriptId) {
                        Divider()
                        Button("Rename") { presentNamePrompt(context: .rename(id: currentScriptId)) }
                        Button("Make Copy") { presentNamePrompt(context: .copy(id: currentScriptId)) }
                        Button("Delete", role: .destructive) {
                            deleteTarget = DeletionTarget(id: currentScriptId, name: viewModel.scriptName(for: currentScriptId))
                            showingDeleteConfirmation = true
                        }
                    } else if !isScriptEditor, let id = currentScriptId {
                        Divider()
                        Button("Rename") { presentSignalRenamePrompt(id: id) }
                        Button("Delete", role: .destructive) {
                            signalDeleteTarget = DeletionTarget(id: id, name: editorTitleOverride ?? id)
                            showingSignalDeleteConfirmation = true
                        }
                    }

                    if isScriptEditor {
                        Divider()
                        Button(lineWrapEnabled ? "Disable Line Wrap" : "Enable Line Wrap") { lineWrapEnabled.toggle() }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }

                if canSave, !editorIsReadOnly {
                    Button("Save") {
                        if isScriptEditor {
                            saveCurrentScript()
                        } else {
                            saveCurrentSignalText()
                        }
                    }
                }
            }
        } else if showingPreview {
            ToolbarItem(placement: .navigation) {
                Button {
                    exitPreview()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                        Text("Back")
                    }
                }
            }

            ToolbarItem(placement: .primaryAction) {
                Menu {
                    if let openSettings = onRequestOpenSettings {
                        Button("Settings…") { openSettings() }
                    }

                    if showingAgentPanel {
                        Divider()
                        agentConversationMenuItems
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        } else {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("New Script") { openNewScriptEditor() }

                    if let selected = viewModel.selectedScriptId, viewModel.isExistingScript(selected) {
                        Divider()
                        Button("Make Copy") { presentNamePrompt(context: .copy(id: selected)) }
                        if !viewModel.isAssetScript(selected) {
                            Button("Rename") { presentNamePrompt(context: .rename(id: selected)) }
                            Button("Delete", role: .destructive) {
                                deleteTarget = DeletionTarget(id: selected, name: viewModel.scriptName(for: selected))
                                showingDeleteConfirmation = true
                            }
                        }
                    }

                    if let openSettings = onRequestOpenSettings {
                        Divider()
                        Button("Settings…") {
                            openSettings()
                        }
                    }

                    if showingAgentPanel {
                        Divider()
                        agentConversationMenuItems
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
    }

    @ViewBuilder
    private var agentConversationMenuItems: some View {
        Button {
            agentViewModel.newConversation()
        } label: {
            Label("New Agent Chat", systemImage: "plus.message")
        }

        if !agentViewModel.conversations.isEmpty {
            ForEach(agentViewModel.conversations) { conv in
                Button {
                    agentViewModel.selectConversation(conv.id)
                } label: {
                    HStack {
                        Text(conv.title)
                        if agentViewModel.selectedConversationId == conv.id {
                            Spacer()
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }

            if let selected = agentViewModel.selectedConversationId {
                Button(role: .destructive) {
                    agentViewModel.deleteConversation(selected)
                } label: {
                    Label("Delete Agent Chat", systemImage: "trash")
                }
            }
        }

        Button {
            agentViewModel.clear()
        } label: {
            Label("Clear Agent Messages", systemImage: "text.badge.xmark")
        }
    }


    private static var primaryBackground: Color {
        #if canImport(UIKit)
        Color(uiColor: .systemBackground)
        #elseif canImport(AppKit)
        Color(nsColor: .windowBackgroundColor)
        #else
        Color.white
        #endif
    }

    private static var secondaryBackground: Color {
        #if canImport(UIKit)
        Color(uiColor: .secondarySystemBackground)
        #elseif canImport(AppKit)
        Color(nsColor: .controlBackgroundColor)
        #else
        Color.gray.opacity(0.08)
        #endif
    }

    private func copyToPasteboard(_ text: String) {
        #if canImport(UIKit)
        UIPasteboard.general.string = text
        #elseif canImport(AppKit)
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(text, forType: .string)
        #endif
    }

    private func pasteFromPasteboard() -> String? {
        #if canImport(UIKit)
        return UIPasteboard.general.string
        #elseif canImport(AppKit)
        return NSPasteboard.general.string(forType: .string)
        #else
        return nil
        #endif
    }

    @ViewBuilder
    private var scriptErrorSheet: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                Text("Script Error")
                    .font(.title3.weight(.semibold))

                ScrollView {
                    Text(previewManager.scriptError ?? "")
                        .font(.system(.body, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
                .padding(12)
                .background(Self.secondaryBackground, in: RoundedRectangle(cornerRadius: 10, style: .continuous))

                HStack {
                    Button("Copy") {
                        copyToPasteboard(previewManager.scriptError ?? "")
                    }
                    Spacer()
                    Button("Close") {
                        previewManager.scriptError = nil
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(16)
        }
        #if os(macOS)
        .frame(minWidth: 620, minHeight: 340)
        #endif
    }
}

#if os(macOS)
private struct AgentPanelResizeHandle: View {
    @Binding var panelWidth: CGFloat
    private let minWidth: CGFloat = 240
    private let maxWidth: CGFloat = 680
    @State private var isHovering = false
    @State private var dragStartWidth: CGFloat? = nil

    var body: some View {
        ZStack {
            Color.clear
                .frame(width: 8)
                .contentShape(Rectangle())
            Rectangle()
                .fill(Color.primary.opacity(isHovering ? 0.20 : 0.10))
                .frame(width: 1)
        }
        .frame(width: 8)
        .gesture(
            DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { value in
                    if dragStartWidth == nil { dragStartWidth = panelWidth }
                    let proposed = (dragStartWidth ?? panelWidth) - value.translation.width
                    panelWidth = max(minWidth, min(maxWidth, proposed))
                }
                .onEnded { _ in dragStartWidth = nil }
        )
        .onHover { hovering in
            isHovering = hovering
            if hovering { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
        }
    }
}
#endif

private struct EmwFileBadgeIcon: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(Color.secondary.opacity(0.18))
            Text("EM")
                .font(.system(size: 9, weight: .bold, design: .rounded))
                .foregroundStyle(.secondary)
        }
        .frame(width: 18, height: 18)
        .accessibilityLabel("EMWaver script")
    }
}

private struct ScriptRow: View {
    let script: ScriptsViewModel.ScriptListItem
    let isSelected: Bool
    let sessionStatuses: [ScriptsRootView.ScriptSessionStatus]
    let onTap: () -> Void
    let onStopSession: (() -> Void)?
    let onEdit: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            if script.kind == .script {
                EmwFileBadgeIcon()
            } else {
                Image(systemName: script.kind.iconSystemName)
                    .foregroundStyle(.secondary)
                    .frame(width: 18)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(script.name)
                        .font(isSelected ? .headline : .body)
                        .lineLimit(1)

                    if !sessionStatuses.isEmpty {
                        HStack(spacing: 6) {
                            ForEach(sessionStatuses.prefix(3)) { session in
                                Label(session.deviceLabel, systemImage: session.isRunning ? "play.fill" : "stop.fill")
                                    .font(.caption)
                                    .foregroundStyle(session.isRunning ? .green : .secondary)
                                    .lineLimit(1)
                            }

                            if sessionStatuses.count > 3 {
                                Text("+\(sessionStatuses.count - 3)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                HStack(spacing: 8) {
                    Text(kindBadgeText)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(kindBadgeForeground)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(kindBadgeBackground, in: Capsule())

                    if let modifiedAt = script.modifiedAt {
                        Text(modifiedAt.formatted(date: .abbreviated, time: .shortened))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if script.isDirty {
                        Text("Unsaved changes")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }
            }
            Spacer()
            if sessionStatuses.contains(where: \.isRunning), let onStopSession {
                Button(role: .destructive, action: onStopSession) {
                    Image(systemName: "stop.fill")
                }
                .buttonStyle(.plain)
                .foregroundStyle(.red)
                .help("Stop running script")
            }
            Button(action: onEdit) {
                if script.kind == .script {
                    Image(systemName: script.isAsset ? "eye" : "pencil")
                } else {
                    Image(systemName: "eye")
                }
            }
            .buttonStyle(.plain)
            .padding(.leading, 8)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
    }

    private var kindBadgeText: String {
        switch script.kind {
        case .script:
            return script.isAsset ? "Example" : "User"
        case .library:
            return "Library"
        case .kernel:
            return "Kernel"
        case .signalRaw, .signalText:
            return "Signal"
        }
    }

    private var kindBadgeForeground: Color {
        switch script.kind {
        case .script:
            return .blue
        case .library:
            return .purple
        case .kernel:
            return .orange
        case .signalRaw, .signalText:
            return .secondary
        }
    }

    private var kindBadgeBackground: Color {
        kindBadgeForeground.opacity(0.12)
    }
}

private enum NamePromptContext {
    case create
    case rename(id: String)
    case copy(id: String)

    var title: String {
        switch self {
        case .create: return "Save Script"
        case .rename: return "Rename Script"
        case .copy: return "Copy Script"
        }
    }

    var message: String {
        switch self {
        case .create: return "Enter a name for the new script."
        case .rename: return "Enter a new name for this script."
        case .copy: return "Enter a name for the duplicated script."
        }
    }
}

private struct NamePrompt: Identifiable {
    let id = UUID()
    let context: NamePromptContext
    let title: String
    let message: String
    var initialValue: String
    let action: (String) -> Void
}

private struct DeletionTarget: Identifiable {
    let id: String
    let name: String
}

private struct NamePromptSheet: View {
    @Environment(\.dismiss) private var dismiss
    let prompt: NamePrompt
    @State private var value: String

    init(prompt: NamePrompt) {
        self.prompt = prompt
        _value = State(initialValue: prompt.initialValue)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(header: Text(prompt.message)) {
                    TextField("Script name", text: $value)
                        #if canImport(UIKit)
                        .textInputAutocapitalization(.none)
                        .autocorrectionDisabled()
                        #endif
                }
            }
            .navigationTitle(prompt.title)
            .toolbar {
                #if os(macOS)
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        prompt.action(value)
                        dismiss()
                    }
                    .keyboardShortcut(.defaultAction)
                    .disabled(value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                #else
                ToolbarItem(placement: .navigation) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Done") {
                        prompt.action(value)
                        dismiss()
                    }
                    .disabled(value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                #endif
            }
        }
    }
}
