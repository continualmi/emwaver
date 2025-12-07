import SwiftUI

struct AgentsView: View {
    @StateObject private var viewModel: AgentViewModel
    @FocusState private var isComposerFocused: Bool

    init(authManager: AuthenticationManager) {
        _viewModel = StateObject(wrappedValue: AgentViewModel(authManager: authManager))
    }

    var body: some View {
        VStack(spacing: 12) {
            conversationHeader

            Divider()

            messagesList
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .overlay(alignment: .center) {
                    if viewModel.isLoading {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle())
                            .padding()
                            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                    }
                }

            messageComposer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .padding()
        .task { viewModel.loadIfNeeded() }
        .navigationTitle("Agents")
        .toolbar { toolbarContent }
        .alert("Agent Error", isPresented: $viewModel.isShowingErrorAlert, presenting: viewModel.errorMessage) { message in
            Button("OK", role: .cancel) {}
        } message: { message in
            Text(message)
        }
        .sheet(isPresented: $viewModel.isPresentingNewConversationSheet) {
            NavigationView {
                Form {
                    Section(header: Text("Conversation")) {
                        TextField("Topic (optional)", text: $viewModel.newConversationTitle)
                    }
                }
                .navigationTitle("New Conversation")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { viewModel.isPresentingNewConversationSheet = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Create") {
                            viewModel.createConversation(with: viewModel.newConversationTitle)
                            viewModel.newConversationTitle = ""
                            viewModel.isPresentingNewConversationSheet = false
                        }
                        .disabled(viewModel.isStreaming)
                    }
                }
            }
        }
        .sheet(isPresented: $viewModel.isPresentingRenameSheet) {
            NavigationView {
                Form {
                    Section(header: Text("Title")) {
                        TextField("Conversation title", text: $viewModel.renameConversationTitle)
                    }
                }
                .navigationTitle("Rename Conversation")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { viewModel.isPresentingRenameSheet = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            viewModel.renameSelectedConversation(to: viewModel.renameConversationTitle)
                            viewModel.isPresentingRenameSheet = false
                        }
                    }
                }
            }
        }
        .confirmationDialog(
            "Delete Conversation?",
            isPresented: $viewModel.isShowingDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                viewModel.deleteSelectedConversation()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This conversation will be removed permanently.")
        }
    }

    private var conversationHeader: some View {
        HStack {
            Menu {
                if viewModel.conversations.isEmpty {
                    Text("No conversations")
                } else {
                    ForEach(viewModel.conversations) { conversation in
                        Button {
                            viewModel.selectConversation(id: conversation.id)
                        } label: {
                            HStack {
                                Text(conversation.title)
                                Spacer()
                                if viewModel.selectedConversationId == conversation.id {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                }
            } label: {
                HStack {
                    Text(viewModel.conversations.first(where: { $0.id == viewModel.selectedConversationId })?.title ?? "Select conversation")
                        .foregroundColor(.primary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.down")
                        .foregroundColor(.secondary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.gray.opacity(0.3), lineWidth: 1)
                )
            }

            Button {
                viewModel.newConversationTitle = ""
                viewModel.isPresentingNewConversationSheet = true
            } label: {
                Label("New", systemImage: "plus")
                    .labelStyle(.iconOnly)
                    .frame(width: 44, height: 44)
                    .background(Color.accentColor.opacity(0.15))
                    .foregroundColor(.accentColor)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(viewModel.isStreaming)
        }
    }

    private var messagesList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(viewModel.messages) { message in
                        MessageRow(message: message)
                            .id(message.id)
                    }
                }
                .padding(.vertical, 8)
            }
            .background(RoundedRectangle(cornerRadius: 16).fill(Color(.systemGray6)))
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: viewModel.messages) { _ in
                if let last = viewModel.messages.last {
                    withAnimation {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
        }
    }

    private var messageComposer: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Message")
                .font(.caption)
                .foregroundColor(.secondary)

            HStack(alignment: .bottom, spacing: 12) {
                ZStack(alignment: .topLeading) {
                    TextEditor(text: $viewModel.messageInput)
                        .frame(minHeight: 44, maxHeight: 120)
                        .padding(8)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Color(.systemBackground)))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color.gray.opacity(0.25), lineWidth: 1)
                        )
                        .disabled(viewModel.isStreaming)
                        .focused($isComposerFocused)

                    if viewModel.messageInput.isEmpty {
                        Text("Ask the agent...")
                            .foregroundColor(.gray)
                            .padding(.top, 16)
                            .padding(.leading, 14)
                            .allowsHitTesting(false)
                    }
                }

                Button {
                    viewModel.sendMessage()
                } label: {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(width: 44, height: 44)
                        .background(viewModel.canSend ? Color.accentColor : Color.gray.opacity(0.4))
                        .clipShape(Circle())
                }
                .disabled(!viewModel.canSend)
            }
        }
    }

    private var toolbarContent: some ToolbarContent {
        ToolbarItemGroup(placement: .navigationBarTrailing) {
            if viewModel.selectedConversationId != nil {
                Button("Rename") {
                    if let selected = viewModel.conversations.first(where: { $0.id == viewModel.selectedConversationId }) {
                        viewModel.renameConversationTitle = selected.title
                    } else {
                        viewModel.renameConversationTitle = ""
                    }
                    viewModel.isPresentingRenameSheet = true
                }

                Button(role: .destructive) {
                    viewModel.isShowingDeleteConfirmation = true
                } label: {
                    Image(systemName: "trash")
                }
            }
        }
    }
}

private extension AgentViewModel {
    var canSend: Bool {
        !messageInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isStreaming
    }
}

private struct MessageRow: View {
    let message: AgentMessage

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if message.role == .assistant {
                LLMIconSymbol()
                    .frame(width: 28, height: 28)
                    .foregroundColor(Color.accentColor)
            }

            VStack(alignment: message.role == .assistant ? .leading : .trailing, spacing: 4) {
                Text(attributedContent)
                    .foregroundColor(message.role == .assistant ? .primary : .white)
                    .padding(12)
                    .background(bubbleBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }
            .frame(maxWidth: .infinity, alignment: message.role == .assistant ? .leading : .trailing)

            if message.role == .user {
                Spacer().frame(width: 28)
            }
        }
        .frame(maxWidth: .infinity, alignment: message.role == .assistant ? .leading : .trailing)
    }

    private var attributedContent: AttributedString {
        if let attributed = try? AttributedString(markdown: message.content) {
            return attributed
        }
        return AttributedString(message.content)
    }

    private var bubbleBackground: some View {
        Group {
            if message.role == .assistant {
                Color(.systemBackground)
            } else {
                LinearGradient(
                    colors: [Color.accentColor, Color.accentColor.opacity(0.85)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            }
        }
    }
}

private struct LLMIconSymbol: View {
    private static let path = SVGPathShape(
        pathData: "M107,26.7c-7,2.8 -11.6,10.6 -10.6,17.7l0.6,4.1 -18.7,10.7c-10.4,5.9 -18.9,10.3 -19.1,9.8 -0.8,-2.3 -7.6,-5.2 -12.1,-5.3 -9.2,-0.1 -15.2,5.6 -15.9,15 -0.3,4.8 0,6.4 2,9.2 4,5.9 7.2,7.6 14.4,7.6l6.4,0.1 5.4,8.8 5.3,8.9 -5.6,8.7c-4.6,7.2 -5.9,8.6 -7.3,7.9 -6,-3.2 -17.2,1.9 -20,9.1 -1.4,3.7 -1.2,10.4 0.6,13.8 4.6,8.9 17.5,11.6 24.4,5.1l2.3,-2 19.4,12.3c14,8.9 19.3,12.7 18.9,13.8 -1.7,4.6 -1.5,8.1 0.6,12.4 2.8,6 7.8,9 14.5,9 11.5,-0 19.1,-10.8 15.1,-21.4 -0.4,-1.1 4.7,-5 18.5,-14.1l19.1,-12.7 2.3,2.3c7.4,6.8 20.4,4.4 25,-4.5 2.3,-4.4 1.9,-12.1 -0.7,-16 -4,-5.8 -7.2,-7.5 -14.5,-7.5l-6.5,-0.1 -5.4,-8.1 -5.3,-8.2 5.7,-9.3 5.7,-9.3 3.7,0.9c5.1,1.3 10.5,-0.5 14.7,-4.8 2.9,-2.9 3.5,-4.5 3.9,-9.1 0.5,-6.5 -0.9,-10.6 -5,-14 -6.2,-5.2 -15.5,-5.3 -21,-0.1l-2.6,2.3 -18.6,-10.6 -18.6,-10.6 0.6,-4.1c0.8,-5.4 -2.2,-12.2 -6.6,-15.4 -3.3,-2.4 -11.8,-3.7 -15,-2.3zM120.8,34.5c5.4,5.8 4,14.5 -2.9,18.1 -7.8,4 -16.9,-1.5 -16.9,-10.2 0,-11.1 12.2,-16.1 19.8,-7.9zM97.2,62.1c-2.6,4.1 -8.1,12.7 -12.2,19.1l-7.3,11.7 -7.5,-3.9 -7.5,-3.8 -0.1,-6 -0.1,-5.9 18.5,-10.6c15.1,-8.7 18.7,-10.4 19.8,-9.3 1.1,1.1 0.4,2.6 -3.6,8.7zM149.6,65.9l12.9,7.3 -0.2,5.9 -0.1,5.9 -7.5,3.8 -7.5,3.9 -7.3,-11.6c-4,-6.4 -9.4,-14.9 -12.1,-19 -3.8,-5.7 -4.6,-7.6 -3.7,-8.7 0.9,-1.2 2.1,-0.8 6.8,1.9 3.2,1.7 11.5,6.5 18.7,10.6zM109.1,58c0.5,-0 0.9,8.3 0.9,19.4l0,19.3 -2.8,0.6c-1.5,0.3 -4,1.8 -5.5,3.3l-2.7,2.7 -8.5,-4.4c-4.7,-2.3 -8.4,-4.5 -8.3,-4.9 0.2,-0.3 5.5,-8.7 11.8,-18.7 7.4,-11.8 12,-18.1 12.8,-17.8 0.8,0.3 1.8,0.5 2.3,0.5zM131,75.2c6.3,10 11.6,18.5 11.8,18.9 0.2,0.3 -3.6,2.6 -8.3,4.9l-8.5,4.2 -2.7,-2.6c-1.5,-1.5 -4,-3 -5.5,-3.3l-2.8,-0.6 0,-19.3c0,-20.2 -0.1,-19.5 4,-20.3 0.3,-0 5.7,8.1 12,18.1zM53.4,70.1c3.9,3.1 5.9,7.5 5.2,11.5 -0.8,4 -5.5,9 -9.3,9.7 -9.8,1.9 -17.8,-9.5 -12.4,-17.7 3.8,-5.8 11.5,-7.4 16.5,-3.5zM183.8,69.4c3.3,1.8 6.2,6.6 6.2,10.2 0,6.8 -7.5,13 -14.3,11.7 -3.8,-0.7 -8.5,-5.7 -9.3,-9.7 -1.6,-9.1 9.3,-16.8 17.4,-12.2zM68,92.5c3.9,1.9 7,3.7 7,4 0,0.2 -1.7,3.1 -3.8,6.5l-3.9,6 -5,-8.2c-4.7,-7.6 -5,-8.4 -3.6,-10.1 0.9,-0.9 1.8,-1.7 2,-1.7 0.2,-0 3.5,1.6 7.3,3.5zM166.1,90.6c1.6,1.4 1.4,2 -3.4,9.9l-5.2,8.3 -3.8,-6c-2.1,-3.3 -3.5,-6.3 -3.2,-6.6 0.6,-0.6 12.7,-7.1 13.4,-7.1 0.3,-0.1 1.2,0.6 2.2,1.5zM96.5,112.5l-0.1,5.5 -8.8,4.5c-4.9,2.5 -9,4.5 -9.2,4.5 -0.1,-0 -2,-3.1 -4.3,-6.9l-4.1,-7 4.7,-7.4 4.8,-7.5 8.6,4.4 8.5,4.3 -0.1,5.6zM150.9,119.8c-2.3,3.7 -4.3,6.8 -4.4,7 -0.2,0.2 -4.3,-1.7 -9.2,-4.2l-8.9,-4.4 0.1,-5.7 0.1,-5.8 8.4,-4.2 8.5,-4.3 4.7,7.4 4.8,7.4 -4.1,6.8zM120.6,104.4c2.9,2.9 3.4,4.1 3.4,8.1 0,4 -0.5,5.2 -3.4,8.1 -2.9,2.9 -4.1,3.4 -8.1,3.4 -4,-0 -5.2,-0.5 -8.1,-3.4 -2.9,-2.9 -3.4,-4.1 -3.4,-8.1 0,-4 0.5,-5.2 3.4,-8.1 2.9,-2.9 4.1,-3.4 8.1,-3.4 4,-0 5.2,0.5 8.1,3.4zM163.6,126.6c3.9,6 4.1,6.4 2.4,7.9 -1.6,1.5 -2.3,1.3 -8.4,-1.7 -3.6,-1.8 -6.6,-3.5 -6.6,-3.9 0,-0.4 1.5,-3.2 3.3,-6.3 2.6,-4.6 3.4,-5.3 4.2,-4 0.6,0.9 2.9,4.5 5.1,8zM71,123.6c1.8,3 3.1,5.7 2.9,5.8 -0.2,0.2 -3.3,1.8 -6.7,3.5 -6,3 -6.5,3.1 -8.2,1.6 -1.7,-1.6 -1.6,-1.9 2.6,-8.3 2.4,-3.7 4.4,-7 4.4,-7.5 0,-2.2 2.2,-0 5,4.9zM101.9,124.6c1.3,1.4 3.7,2.8 5.3,3.1l2.8,0.5 0,21.8c0,29.4 0.2,29.4 -16,2.9 -6.6,-11 -12.3,-20.5 -12.6,-21.2 -0.4,-1.1 14.5,-9.5 17.1,-9.6 0.6,-0 2.1,1.1 3.4,2.5zM135.1,126.1c4.6,2.3 8.6,4.3 8.7,4.5 0.2,0.1 -5.3,9.7 -12.3,21.2 -16.8,27.7 -16.5,27.7 -16.5,-1.8l0,-21.8 2.8,-0.5c1.6,-0.3 4,-1.7 5.3,-3.1 1.3,-1.4 2.7,-2.6 3,-2.6 0.4,-0 4.4,1.9 9,4.1zM53.6,135.7c2.4,1.5 5.4,7 5.4,9.8 0,0.9 -0.7,2.9 -1.5,4.5 -4.5,8.7 -15.3,9.5 -20.6,1.4 -6.8,-10.4 6.1,-22.7 16.7,-15.7zM89,153.2c11.8,19.4 13.7,23.3 11.5,23.3 -0.5,-0 -9.3,-5.4 -19.5,-11.9l-18.6,-12 0.2,-6.5 0.3,-6.4 6.3,-3.3c3.5,-1.8 6.6,-3.3 6.9,-3.3 0.4,-0.1 6.2,9 12.9,20.1zM155.9,136.5l6.3,3.3 0.1,6 0.1,6 -18,11.9c-9.8,6.6 -18.5,12.3 -19.2,12.7 -0.7,0.4 -1.4,0.2 -1.7,-0.6 -0.6,-1.4 24.1,-42.8 25.3,-42.8 0.4,0.1 3.6,1.6 7.1,3.5zM184.3,135.2c1,0.5 2.7,2.4 3.7,4.1 7.1,11.5 -7.3,23.5 -17.4,14.7 -4,-3.6 -5.2,-7.6 -3.6,-12.5 2.3,-7 10.3,-9.9 17.3,-6.3zM120.6,179.4c2.9,2.9 3.4,4.1 3.4,8.1 0,4 -0.5,5.2 -3.4,8.1 -4.9,4.9 -11.3,4.9 -16.2,-0 -2.9,-2.9 -3.4,-4.1 -3.4,-8.1 0,-4 0.5,-5.2 3.4,-8.1 2.9,-2.9 4.1,-3.4 8.1,-3.4 4,-0 5.2,0.5 8.1,3.4z",
        viewport: CGSize(width: 225, height: 225)
    )

    var body: some View {
        LLMIconSymbol.path
            .aspectRatio(1, contentMode: .fit)
            .background(Color.clear)
    }
}

private struct SVGPathShape: Shape {
    private let pathData: String
    private let viewport: CGSize
    private let basePath: CGPath

    init(pathData: String, viewport: CGSize) {
        self.pathData = pathData
        self.viewport = viewport
        self.basePath = SVGPathParser(data: pathData).parse()
    }

    func path(in rect: CGRect) -> Path {
        let scaleX = rect.width / viewport.width
        let scaleY = rect.height / viewport.height
        var transform = CGAffineTransform(scaleX: scaleX, y: scaleY)
        transform = transform.concatenating(CGAffineTransform(translationX: rect.minX, y: rect.minY))
        if let scaled = basePath.copy(using: &transform) {
            return Path(scaled)
        }
        return Path(basePath)
    }

    private final class SVGPathParser {
        private let data: String
        private var index: String.Index
        private let endIndex: String.Index
        private let path = CGMutablePath()

        private var currentPoint: CGPoint = .zero
        private var startPoint: CGPoint = .zero
        private var lastControlPoint: CGPoint?

        init(data: String) {
            self.data = data
            self.index = data.startIndex
            self.endIndex = data.endIndex
        }

        func parse() -> CGPath {
            var currentCommand: Character?

            while let command = readCommand(current: currentCommand) {
                currentCommand = command

                switch command {
                case "M":
                    var first = true
                    while let point = readPoint() {
                        if first {
                            path.move(to: point)
                            currentPoint = point
                            startPoint = point
                            first = false
                        } else {
                            path.addLine(to: point)
                            currentPoint = point
                        }
                    }
                case "m":
                    var first = true
                    while let delta = readPoint(relativeTo: currentPoint) {
                        if first {
                            path.move(to: delta)
                            currentPoint = delta
                            startPoint = delta
                            first = false
                        } else {
                            path.addLine(to: delta)
                            currentPoint = delta
                        }
                    }
                case "L":
                    while let point = readPoint() {
                        path.addLine(to: point)
                        currentPoint = point
                    }
                case "l":
                    while let point = readPoint(relativeTo: currentPoint) {
                        path.addLine(to: point)
                        currentPoint = point
                    }
                case "H":
                    while let x = readNumber() {
                        let point = CGPoint(x: x, y: currentPoint.y)
                        path.addLine(to: point)
                        currentPoint = point
                    }
                case "h":
                    while let dx = readNumber() {
                        let point = CGPoint(x: currentPoint.x + dx, y: currentPoint.y)
                        path.addLine(to: point)
                        currentPoint = point
                    }
                case "V":
                    while let y = readNumber() {
                        let point = CGPoint(x: currentPoint.x, y: y)
                        path.addLine(to: point)
                        currentPoint = point
                    }
                case "v":
                    while let dy = readNumber() {
                        let point = CGPoint(x: currentPoint.x, y: currentPoint.y + dy)
                        path.addLine(to: point)
                        currentPoint = point
                    }
                case "C":
                    while
                        let c1 = readPoint(),
                        let c2 = readPoint(),
                        let end = readPoint()
                    {
                        path.addCurve(to: end, control1: c1, control2: c2)
                        currentPoint = end
                        lastControlPoint = c2
                    }
                case "c":
                    while
                        let c1 = readPoint(relativeTo: currentPoint),
                        let c2 = readPoint(relativeTo: currentPoint),
                        let end = readPoint(relativeTo: currentPoint)
                    {
                        path.addCurve(to: end, control1: c1, control2: c2)
                        currentPoint = end
                        lastControlPoint = c2
                    }
                case "S":
                    while
                        let c2 = readPoint(),
                        let end = readPoint()
                    {
                        let c1 = reflectedControlPoint()
                        path.addCurve(to: end, control1: c1, control2: c2)
                        currentPoint = end
                        lastControlPoint = c2
                    }
                case "s":
                    while
                        let c2 = readPoint(relativeTo: currentPoint),
                        let end = readPoint(relativeTo: currentPoint)
                    {
                        let c1 = reflectedControlPoint()
                        path.addCurve(to: end, control1: c1, control2: c2)
                        currentPoint = end
                        lastControlPoint = c2
                    }
                case "Q":
                    while
                        let control = readPoint(),
                        let end = readPoint()
                    {
                        path.addQuadCurve(to: end, control: control)
                        currentPoint = end
                        lastControlPoint = control
                    }
                case "q":
                    while
                        let control = readPoint(relativeTo: currentPoint),
                        let end = readPoint(relativeTo: currentPoint)
                    {
                        path.addQuadCurve(to: end, control: control)
                        currentPoint = end
                        lastControlPoint = control
                    }
                case "T":
                    while let end = readPoint() {
                        let control = reflectedControlPoint()
                        path.addQuadCurve(to: end, control: control)
                        currentPoint = end
                        lastControlPoint = control
                    }
                case "t":
                    while let end = readPoint(relativeTo: currentPoint) {
                        let control = reflectedControlPoint()
                        path.addQuadCurve(to: end, control: control)
                        currentPoint = end
                        lastControlPoint = control
                    }
                case "Z", "z":
                    path.closeSubpath()
                    currentPoint = startPoint
                    lastControlPoint = nil
                default:
                    skipUntilNextCommand()
                }
            }

            return path
        }

        private func reflectedControlPoint() -> CGPoint {
            if let lastControlPoint {
                return CGPoint(
                    x: 2 * currentPoint.x - lastControlPoint.x,
                    y: 2 * currentPoint.y - lastControlPoint.y
                )
            }
            return currentPoint
        }

        private func readCommand(current: Character?) -> Character? {
            skipWhitespace()

            guard index < endIndex else { return nil }

            let character = data[index]
            if character.isLetter {
                index = data.index(after: index)
                return character
            } else if let current {
                return current
            }
            return nil
        }

        private func readPoint() -> CGPoint? {
            guard let x = readNumber(), let y = readNumber() else { return nil }
            return CGPoint(x: x, y: y)
        }

        private func readPoint(relativeTo reference: CGPoint) -> CGPoint? {
            guard let x = readNumber(), let y = readNumber() else { return nil }
            return CGPoint(x: reference.x + x, y: reference.y + y)
        }

        private func readNumber() -> CGFloat? {
            skipWhitespace()
            guard let start = numberStartIndex() else { return nil }
            var end = start
            var hasDecimal = false
            var hasExponent = false

            while end < data.endIndex {
                let char = data[end]
                if char == "." {
                    if hasDecimal { break }
                    hasDecimal = true
                } else if char == "e" || char == "E" {
                    if hasExponent { break }
                    hasExponent = true
                    end = data.index(after: end)
                    if end < data.endIndex {
                        let next = data[end]
                        if next == "+" || next == "-" {
                            end = data.index(after: end)
                        }
                    }
                    continue
                } else if char == "-" || char == "+" {
                    if end != start { break }
                } else if char.isNumber == false {
                    break
                }
                end = data.index(after: end)
            }

            let numberString = String(data[start..<end])
            index = end
            guard let value = Double(numberString) else { return nil }
            return CGFloat(value)
        }

        private func numberStartIndex() -> String.Index? {
            var current = index
            while current < endIndex {
                let char = data[current]
                if char.isWhitespace || char == "," {
                    current = data.index(after: current)
                    continue
                }
                index = current
                return current
            }
            index = endIndex
            return nil
        }

        private func skipWhitespace() {
            while index < endIndex {
                let char = data[index]
                if char.isWhitespace || char == "," {
                    index = data.index(after: index)
                } else {
                    break
                }
            }
        }

        private func skipUntilNextCommand() {
            while index < endIndex {
                let char = data[index]
                if char.isLetter {
                    break
                }
                index = data.index(after: index)
            }
        }
    }
}
