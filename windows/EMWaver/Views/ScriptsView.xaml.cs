using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Threading;
using ICSharpCode.AvalonEdit.Highlighting;
using ICSharpCode.AvalonEdit.Search;
using EMWaver.Models;
using EMWaver.Scripting;
using EMWaver.Scripting.Render;
using EMWaver.Services;
using EMWaver.Services.Agent;

namespace EMWaver.Views;

public partial class ScriptsView : UserControl
{
    private readonly ScriptRepository _scripts;
    private readonly ScriptEngine _engine;
    private readonly ScriptRenderer _renderer;
    private readonly WindowsDeviceManager _device;
    private readonly AgentApi _agentApi;
    private readonly AgentChatStore _agentChats;

    private readonly DispatcherTimer _runTimer;
    private readonly DispatcherTimer _versionCheckTimer;
    private readonly ICollectionView _scriptView;
    private readonly object _renderCoalesceLock = new();
    private ScriptTree? _pendingRenderTree;
    private bool _renderRefreshPending;
    private bool _transportLogRefreshPending;

    private ScriptInfo? _selectedScript;
    private bool _isPreviewMode;
    private bool _isRunning;
    private bool _suppressTextChanged;
    private string _pendingSaveScript = "";

    // Agent state
    private string _agentChatId = "";
    private CancellationTokenSource? _agentCts;
    private bool _isAgentSending;
    private bool _suppressAgentConversationChange;
    private readonly List<(string role, string message)> _agentMessages = new();

    private static class AgentHardwareProtocol
    {
        internal const byte ResponseOk = 0x80;
        internal const byte ResponseErr = 0x81;
        internal const byte ResponseBusy = 0x82;
        internal const byte NameGet = 0x04;
        internal const byte BoardGet = 0x09;
        internal const byte Gpio = 0x10;
        internal const byte GpioInput = 0x00;
        internal const byte GpioOutput = 0x01;
        internal const byte GpioRead = 0x02;
        internal const byte GpioHigh = 0x03;
        internal const byte GpioLow = 0x04;
        internal const byte GpioPull = 0x05;
        internal const byte AdcRead = 0x20;
        internal const byte AdcPin = 0x00;
        internal const byte SpiTransfer = 0x50;
    }

    public ScriptsView()
        : this(AppServices.Scripts, AppServices.ScriptEngine, AppServices.Device, AppServices.AgentApi, AppServices.AgentChats)
    {
    }

    public ScriptsView(
        ScriptRepository scripts,
        ScriptEngine engine,
        WindowsDeviceManager device,
        AgentApi agentApi,
        AgentChatStore agentChats)
    {
        InitializeComponent();

        _scripts = scripts;
        _engine = engine;
        _renderer = new ScriptRenderer(InvokeScriptHandler);
        _device = device;
        _agentApi = agentApi;
        _agentChats = agentChats;

        _device.PropertyChanged += OnDevicePropertyChanged;
        AppServices.Settings.Changed += OnSettingsChanged;
        Unloaded += (_, __) =>
        {
            _device.PropertyChanged -= OnDevicePropertyChanged;
            AppServices.Settings.Changed -= OnSettingsChanged;
        };
        RefreshTransportLogVisibility();

        EditorTextBox.SyntaxHighlighting = HighlightingManager.Instance.GetDefinition("JavaScript");
        SearchPanel.Install(EditorTextBox.TextArea);
        _scriptView = CollectionViewSource.GetDefaultView(_scripts.All);
        _scriptView.GroupDescriptions.Add(new PropertyGroupDescription(nameof(ScriptInfo.SectionTitle)));
        _scriptView.Filter = FilterScript;
        ScriptListBox.ItemsSource = _scriptView;
        PreviewScrollViewer.PreviewMouseWheel += OnPreviewMouseWheel;
        _engine.Setup(
            ScheduleRender,
            (payload, timeoutMs) => _device.SendPacket(payload, timeoutMs),
            message => Dispatcher.BeginInvoke((Action)(() => ShowError(message))),
            getBoardType: () => _device.ConnectedBoardType ?? _device.LastDetectedBoardType);

        _runTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        _runTimer.Tick += OnRunTick;

        _versionCheckTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
        _versionCheckTimer.Tick += OnVersionCheckTick;
        _versionCheckTimer.Start();

        Loaded += async (_, __) =>
        {
            await _scripts.EnsureBootstrappedAsync();
            _scriptView.Refresh();
            LoadAgentConversations();
        };
    }

    private void ScheduleRender(ScriptTree tree)
    {
        lock (_renderCoalesceLock)
        {
            _pendingRenderTree = tree;
            if (_renderRefreshPending) return;
            _renderRefreshPending = true;
        }

        Dispatcher.BeginInvoke((Action)(() =>
        {
            ScriptTree? latest;
            lock (_renderCoalesceLock)
            {
                latest = _pendingRenderTree;
                _pendingRenderTree = null;
                _renderRefreshPending = false;
            }

            if (!_isPreviewMode || latest == null) return;
            PreviewContent.Content = _renderer.Render(latest);
        }), System.Windows.Threading.DispatcherPriority.Background);
    }

    private bool FilterScript(object item)
    {
        if (item is not ScriptInfo script) return false;
        var query = (ScriptSearchBox?.Text ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(query)) return true;
        return script.FileName.Contains(query, StringComparison.OrdinalIgnoreCase)
            || script.KindLabel.Contains(query, StringComparison.OrdinalIgnoreCase);
    }

    private void OnScriptSearchChanged(object sender, TextChangedEventArgs e)
    {
        _scriptView.Refresh();
    }

    private void OnPreviewMouseWheel(object sender, MouseWheelEventArgs e)
    {
        // WPF nested ScrollViewers/controls can swallow wheel input in generated script UI.
        // Route wheel movement to the main script preview scroller so users do not have to drag the bar.
        if (!_isPreviewMode) return;

        PreviewScrollViewer.ScrollToVerticalOffset(PreviewScrollViewer.VerticalOffset - e.Delta);
        e.Handled = true;
    }

    private void OnDevicePropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(WindowsDeviceManager.ActivityLogText)) return;
        if (!AppServices.Settings.ShowTransportLog) return;
        if (_transportLogRefreshPending) return;

        _transportLogRefreshPending = true;
        Dispatcher.BeginInvoke((Action)(() =>
        {
            _transportLogRefreshPending = false;
            if (!AppServices.Settings.ShowTransportLog) return;
            TransportLogTextBox.Text = _device.ActivityLogText;
            TransportLogTextBox.ScrollToEnd();
        }), System.Windows.Threading.DispatcherPriority.Background);
    }

    private void OnSettingsChanged()
    {
        Dispatcher.BeginInvoke((Action)RefreshTransportLogVisibility);
    }

    private void RefreshTransportLogVisibility()
    {
        var show = AppServices.Settings.ShowTransportLog;
        TransportLogExpander.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        if (show)
        {
            TransportLogTextBox.Text = _device.ActivityLogText;
            TransportLogTextBox.ScrollToEnd();
        }
    }

    // --- Public API for MainWindow ---

    public event Action<bool>? PreviewModeChanged;
    public event Action<bool, string?>? RunningScriptStatusChanged;

    public void HandleNewScript()
    {
        var name = "new-script-" + DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        _scripts.Create(name, "// New script\n\nconsole.log('hello EMWaver');\n");
        _scriptView.Refresh();
        var info = _scripts.All.FirstOrDefault(s => s.FileName == name);
        if (info != null) SelectScript(info);
    }

    public void HandleSaveScript()
    {
        if (_selectedScript == null) return;
        if (_selectedScript.IsBundled)
        {
            ShowError("This is a bundled read-only script. Use Make Copy before editing.");
            return;
        }
        _scripts.Save(_selectedScript.FileName, EditorTextBox.Text);
        _scriptView.Refresh();
        _suppressTextChanged = true;
        _pendingSaveScript = _selectedScript.FileName;
    }

    public void HandleMakeCopy()
    {
        if (_selectedScript == null) return;
        var copyName = _selectedScript.FileName + "-copy";
        var copy = _scripts.Create(copyName, EditorTextBox.Text);
        _scriptView.Refresh();
        SelectScript(copy);
    }

    public void HandleRename()
    {
        if (_selectedScript == null) return;
        var newName = Microsoft.VisualBasic.Interaction.InputBox("New name:", "Rename Script", _selectedScript.FileName);
        if (string.IsNullOrWhiteSpace(newName) || newName == _selectedScript.FileName) return;
        var renamed = _scripts.Rename(_selectedScript.FileName, newName);
        _scriptView.Refresh();
        SelectScript(renamed);
    }

    public void HandleDelete()
    {
        if (_selectedScript == null) return;
        var result = MessageBox.Show($"Delete '{_selectedScript.DisplayName}'?",
            "Delete Script", MessageBoxButton.YesNo, MessageBoxImage.Warning);
        if (result == MessageBoxResult.Yes)
        {
            _scripts.Delete(_selectedScript.FileName);
            _scriptView.Refresh();
            SelectScript(null);
        }
    }

    public void HandleTogglePreview(bool enablePreview)
    {
        _isPreviewMode = enablePreview;
        EditorTextBox.Visibility = enablePreview ? Visibility.Collapsed : Visibility.Visible;
        PreviewScrollViewer.Visibility = enablePreview ? Visibility.Visible : Visibility.Collapsed;
        PreviewModeChanged?.Invoke(enablePreview);

        if (enablePreview)
        {
            RunScript();
        }
        else
        {
            StopScript();
        }
    }

    public void HandleToggleAgent()
    {
        var isOpen = AgentPanelColumn.Width.Value > 0;
        if (isOpen)
        {
            AgentPanelColumn.Width = new GridLength(0);
            AgentPanel.Visibility = Visibility.Collapsed;
        }
        else
        {
            AgentPanelColumn.Width = new GridLength(340);
            AgentPanel.Visibility = Visibility.Visible;

            LoadAgentConversations();
            if (string.IsNullOrWhiteSpace(_agentChatId))
            {
                StartNewAgentConversation("Chat");
            }

            UpdateAgentPanelState();
        }
    }

    private void UpdateAgentPanelState()
    {
        var hasKey = AppServices.AgentKeys.HasAgentKey;
        AgentSetupPanel.Visibility = hasKey ? Visibility.Collapsed : Visibility.Visible;
        AgentInputBox.IsEnabled = hasKey && !_isAgentSending;
        AgentSendButton.IsEnabled = hasKey && !_isAgentSending;
        AgentStopButton.Visibility = _isAgentSending ? Visibility.Visible : Visibility.Collapsed;
        AgentStatusText.Text = _isAgentSending
            ? "Thinking…"
            : "The Agent sees your message and the current script text.";
        AgentInputBox.ToolTip = hasKey ? "Ask the Agent about the current script" : "Add an MGPT API key to enable Agent replies";
    }

    private void LoadAgentConversations()
    {
        var selected = _agentChatId;
        var conversations = _agentChats.ListConversations();
        _suppressAgentConversationChange = true;
        AgentConversationBox.ItemsSource = conversations;
        AgentConversationBox.SelectedItem = conversations.FirstOrDefault(c => c.Id == selected) ?? conversations.FirstOrDefault();
        _suppressAgentConversationChange = false;

        if (AgentConversationBox.SelectedItem is AgentApi.Conversation conversation && string.IsNullOrWhiteSpace(_agentChatId))
        {
            LoadAgentConversation(conversation.Id);
        }
    }

    private void StartNewAgentConversation(string? title = null)
    {
        var conversation = _agentChats.CreateConversation(title);
        LoadAgentConversations();
        LoadAgentConversation(conversation.Id);
    }

    private void LoadAgentConversation(string id)
    {
        _agentChatId = id;
        _agentMessages.Clear();
        AgentMessagesPanel.Children.Clear();
        AgentMessagesPanel.Children.Add(AgentSuggestionsPanel);
        AgentSuggestionsPanel.Visibility = Visibility.Visible;

        foreach (var message in _agentChats.ListMessages(id))
        {
            AddAgentMessage(message.Role, message.Content, persist: false);
        }

        _suppressAgentConversationChange = true;
        AgentConversationBox.SelectedItem = AgentConversationBox.Items.Cast<AgentApi.Conversation>().FirstOrDefault(c => c.Id == id);
        _suppressAgentConversationChange = false;
    }

    private void OnAgentConversationChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressAgentConversationChange) return;
        if (AgentConversationBox.SelectedItem is AgentApi.Conversation conversation)
        {
            LoadAgentConversation(conversation.Id);
        }
    }

    private void OnAgentNewChatClick(object sender, RoutedEventArgs e)
    {
        StartNewAgentConversation("Chat");
        UpdateAgentPanelState();
    }

    private void OnAgentRenameChatClick(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_agentChatId)) return;
        var current = (AgentConversationBox.SelectedItem as AgentApi.Conversation)?.DisplayTitle ?? "Chat";
        var title = Microsoft.VisualBasic.Interaction.InputBox("Conversation name:", "Rename Agent Chat", current);
        if (string.IsNullOrWhiteSpace(title)) return;
        _agentChats.RenameConversation(_agentChatId, title);
        LoadAgentConversations();
    }

    private void OnAgentDeleteChatClick(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_agentChatId)) return;
        var result = MessageBox.Show("Delete this Agent conversation?", "Delete Agent Chat", MessageBoxButton.YesNo, MessageBoxImage.Warning);
        if (result != MessageBoxResult.Yes) return;
        _agentChats.ArchiveConversation(_agentChatId);
        _agentChatId = "";
        AgentMessagesPanel.Children.Clear();
        AgentMessagesPanel.Children.Add(AgentSuggestionsPanel);
        AgentSuggestionsPanel.Visibility = Visibility.Visible;
        LoadAgentConversations();
        if (AgentConversationBox.SelectedItem is AgentApi.Conversation conversation)
        {
            LoadAgentConversation(conversation.Id);
        }
        else
        {
            StartNewAgentConversation("Chat");
        }
    }

    private void OnAgentOpenKeyClick(object sender, RoutedEventArgs e)
    {
        var window = new AgentKeyWindow(AppServices.AgentKeys)
        {
            Owner = Window.GetWindow(this)
        };
        window.ShowDialog();
        UpdateAgentPanelState();
    }

    public async Task HandleStopRunning()
    {
        StopScript();
        await Task.CompletedTask;
    }

    // --- Script selection ---

    private void OnScriptSelected(object sender, SelectionChangedEventArgs e)
    {
        if (ScriptListBox.SelectedItem is ScriptInfo info)
        {
            SelectScript(info);
        }
    }

    private void SelectScript(ScriptInfo? info)
    {
        _selectedScript = info;
        if (_isPreviewMode)
        {
            HandleTogglePreview(false);
        }

        if (info == null)
        {
            EditorTitle.Text = "No script selected";
            EditorTextBox.Text = "";
            EditorTextBox.IsEnabled = false;
            EditorTextBox.IsReadOnly = false;
            return;
        }

        EditorTitle.Text = string.IsNullOrWhiteSpace(info.KindLabel) ? info.DisplayName : $"{info.DisplayName} — {info.KindLabel}";
        EditorTextBox.IsEnabled = true;
        EditorTextBox.IsReadOnly = info.IsBundled;

        try
        {
            EditorTextBox.Text = File.ReadAllText(info.FilePath);
        }
        catch
        {
            EditorTextBox.Text = "// Could not load script";
        }

        ErrorBanner.Visibility = Visibility.Collapsed;
    }

    private void OnEditorTextChanged(object? sender, EventArgs e)
    {
        if (_suppressTextChanged)
        {
            _suppressTextChanged = false;
            return;
        }
    }

    private void OnFindClick(object sender, RoutedEventArgs e)
    {
        EditorTextBox.Focus();
        SearchPanel.Install(EditorTextBox.TextArea).Open();
    }

    private void OnGoToLineClick(object sender, RoutedEventArgs e)
    {
        var raw = Microsoft.VisualBasic.Interaction.InputBox("Line number:", "Go to Line", "1");
        if (!int.TryParse(raw, out var line)) return;
        line = Math.Clamp(line, 1, Math.Max(1, EditorTextBox.Document.LineCount));
        EditorTextBox.ScrollToLine(line);
        var docLine = EditorTextBox.Document.GetLineByNumber(line);
        EditorTextBox.Select(docLine.Offset, 0);
        EditorTextBox.Focus();
    }

    // --- Script execution ---

    private void RunScript()
    {
        if (_selectedScript == null || _isRunning) return;
        ErrorBanner.Visibility = Visibility.Collapsed;

        try
        {
            _engine.Execute(EditorTextBox.Text);
            _isRunning = true;
            _runTimer.Start();

            var name = _selectedScript?.DisplayName ?? "";
            RunningScriptStatusChanged?.Invoke(true, string.IsNullOrWhiteSpace(name) ? null : name);
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
        }
    }

    private void StopScript()
    {
        _isRunning = false;
        _runTimer.Stop();
        _engine.Stop();
        RunningScriptStatusChanged?.Invoke(false, null);
    }

    private void OnRunTick(object? sender, EventArgs e)
    {
        if (!_isRunning) return;

        // Script render updates arrive through ScriptEngine.Setup's render callback.
    }

    private void InvokeScriptHandler(string handlerId, IReadOnlyList<object?> args)
    {
        if (_selectedScript == null) return;
        try
        {
            _engine.Invoke(handlerId, args);
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
        }
    }

    private void ShowError(string message)
    {
        ErrorText.Text = message;
        ErrorBanner.Visibility = Visibility.Visible;
    }

    // --- Version check (polling for version changes, same as macOS) ---

    private void OnVersionCheckTick(object? sender, EventArgs e)
    {
        // If a save was pending, reload the script from disk
        if (!string.IsNullOrWhiteSpace(_pendingSaveScript))
        {
            var name = _pendingSaveScript;
            _pendingSaveScript = "";

            if (_selectedScript != null && _selectedScript.FileName == name)
            {
                try
                {
                    EditorTextBox.Text = File.ReadAllText(_selectedScript.FilePath);
                }
                catch { }
            }
        }
    }

    // --- Agent ---

    private void OnAgentInputKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && Keyboard.Modifiers != ModifierKeys.Shift)
        {
            SendAgentMessage();
            e.Handled = true;
        }
    }

    private void OnAgentSendClick(object sender, RoutedEventArgs e)
    {
        SendAgentMessage();
    }

    private void OnAgentSuggestionClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button button && button.Tag is string prompt)
        {
            AgentInputBox.Text = prompt;
            AgentInputBox.Focus();
        }
    }

    private void OnAgentStopClick(object sender, RoutedEventArgs e)
    {
        _agentCts?.Cancel();
    }

    private async void SendAgentMessage()
    {
        UpdateAgentPanelState();
        if (!AppServices.AgentKeys.HasAgentKey || _isAgentSending) return;

        var input = AgentInputBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(input)) return;

        if (string.IsNullOrWhiteSpace(_agentChatId))
        {
            StartNewAgentConversation(input);
        }

        AgentInputBox.Text = "";
        _isAgentSending = true;
        _agentCts = new CancellationTokenSource();
        UpdateAgentPanelState();
        AddAgentMessage("user", input, persist: false);

        try
        {
            if (TryParseLocalAgentToolInput(input, out var directToolName, out var directToolArguments))
            {
                var result = await ExecuteAgentToolAsync(directToolName, directToolArguments, _agentCts.Token);
                AddAgentToolCard(result);
                return;
            }

            var assistantReply = string.Empty;
            var scriptName = _selectedScript?.FileName ?? "current-script.js";
            await _agentApi.ChatStreamWithToolsAsync(
                _agentChatId,
                input,
                new AgentApi.ScriptContext(scriptName, EditorTextBox.Text, BuildAgentToolContext()),
                ev =>
                {
                    if (ev.Kind == AgentApi.StreamEventKind.Done && ev.DoneMessage is not null)
                    {
                        assistantReply = ev.DoneMessage.Content;
                        Dispatcher.BeginInvoke((Action)(() => AddAgentMessage("assistant", ev.DoneMessage.Content, persist: false)));
                    }
                    else if (ev.Kind == AgentApi.StreamEventKind.Error)
                    {
                        Dispatcher.BeginInvoke((Action)(() => AddAgentMessage("error", ev.Text, persist: false)));
                    }
                },
                _agentCts.Token);

            await ExecuteAssistantToolBlocksAsync(assistantReply, _agentCts.Token);
        }
        catch (OperationCanceledException)
        {
            AddAgentMessage("error", "Agent request stopped.", persist: false);
        }
        catch (Exception ex)
        {
            AddAgentMessage("error", ex.Message, persist: false);
        }
        finally
        {
            _isAgentSending = false;
            _agentCts?.Dispose();
            _agentCts = null;
            LoadAgentConversations();
            UpdateAgentPanelState();
        }
    }

    private string BuildAgentToolContext()
    {
        var connected = _device.IsConnected ? "connected" : "not connected";
        var board = _device.ConnectedBoardType ?? _device.LastDetectedBoardType ?? "unknown";
        var script = _selectedScript?.FileName ?? "none";
        return "Windows local Agent tools are available. Device=" + connected + "; transport=" + _device.ActiveTransport + "; boardType=" + board + "; selectedScript=" + script + ".\n" +
               "To request local hardware/tool execution, reply with an emw-tool fenced JSON block containing one object or an array of objects: ```emw-tool\n[{\"name\":\"gpio_read\",\"arguments\":{\"pin\":2}}]\n```. " +
               "Available tools: list_scripts, read_script, apply_patch_to_script, run_script, stop_script, get_device_status, spi_transfer(bytes,cs,rx_length), gpio_mode(pin,mode INPUT|OUTPUT|INPUT_PULLUP), gpio_write(pin,value HIGH|LOW), gpio_read(pin), analog_read(pin), sleep(ms). " +
               "Do not ask the user to manually run JavaScript for primitive hardware checks; use these named tools.";
    }

    private void AddAgentMessage(string role, string text, bool persist = false)
    {
        if (persist && !string.IsNullOrWhiteSpace(_agentChatId))
        {
            _agentChats.AppendMessage(_agentChatId, role, text);
        }

        _agentMessages.Add((role, text));
        AgentSuggestionsPanel.Visibility = Visibility.Collapsed;

        var bubble = new Border
        {
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(10, 6, 10, 6),
            Margin = new Thickness(0, 0, 0, 8),
            MaxWidth = 280,
        };

        var content = BuildAgentMessageContent(role, text);

        if (role == "user")
        {
            bubble.Background = FindResource("AgentUserBubbleBrush") as System.Windows.Media.Brush;
            bubble.BorderBrush = FindResource("AgentBubbleBorderBrush") as System.Windows.Media.Brush;
            bubble.BorderThickness = new Thickness(1);
            bubble.HorizontalAlignment = HorizontalAlignment.Right;
        }
        else if (role == "error")
        {
            bubble.Background = FindResource("StatusErrorBackgroundBrush") as System.Windows.Media.Brush;
            bubble.BorderThickness = new Thickness(0);
        }
        else
        {
            bubble.Background = FindResource("AgentAssistantBubbleBrush") as System.Windows.Media.Brush;
            bubble.BorderThickness = new Thickness(0);
        }

        bubble.Child = content;
        AgentMessagesPanel.Children.Add(bubble);

        if (role == "assistant")
        {
            if (TryExtractPatch(text, out var patch))
            {
                var patchButton = MakeAgentActionButton("Apply patch to editor", patch);
                patchButton.Click += OnApplyAgentPatchClick;
                AgentMessagesPanel.Children.Add(patchButton);
            }
            else if (TryExtractCodeBlock(text, out var code))
            {
                var applyButton = MakeAgentActionButton("Apply code to editor", code);
                applyButton.Click += OnApplyAgentCodeClick;
                AgentMessagesPanel.Children.Add(applyButton);
            }
        }

        AgentMessagesScroll.ScrollToEnd();
    }

    private sealed record AgentToolCall(string Name, Dictionary<string, JsonElement> Arguments);
    private sealed record AgentToolResult(string Name, bool Ok, string Json, string? Error = null);

    private async Task ExecuteAssistantToolBlocksAsync(string assistantReply, CancellationToken ct)
    {
        List<AgentToolCall> calls;
        try
        {
            calls = ExtractAgentToolCalls(assistantReply).ToList();
        }
        catch (Exception ex)
        {
            AddAgentToolCard(ToolError("tool_parse", "Could not parse Agent tool request: " + ex.Message));
            return;
        }

        foreach (var call in calls)
        {
            ct.ThrowIfCancellationRequested();
            var result = await ExecuteAgentToolAsync(call.Name, call.Arguments, ct);
            AddAgentToolCard(result);
        }
    }

    private void AddAgentToolCard(AgentToolResult result)
    {
        var panel = new StackPanel();
        panel.Children.Add(new TextBlock
        {
            Text = (result.Ok ? "✓ " : "⚠ ") + result.Name,
            FontWeight = FontWeights.SemiBold,
            FontSize = 12,
            Foreground = result.Ok ? FindResource("AppTextForegroundBrush") as System.Windows.Media.Brush : FindResource("AppErrorTextBrush") as System.Windows.Media.Brush,
        });
        panel.Children.Add(new TextBox
        {
            Text = result.Ok ? result.Json : (result.Error ?? result.Json),
            IsReadOnly = true,
            TextWrapping = TextWrapping.Wrap,
            AcceptsReturn = true,
            MaxHeight = 140,
            FontFamily = new System.Windows.Media.FontFamily("Consolas"),
            FontSize = 11,
            Background = FindResource("EditorSurfaceBackgroundBrush") as System.Windows.Media.Brush,
            Foreground = FindResource("EditorTextForegroundBrush") as System.Windows.Media.Brush,
            Margin = new Thickness(0, 4, 0, 0),
        });

        AgentMessagesPanel.Children.Add(new Border
        {
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(10, 6, 10, 6),
            Margin = new Thickness(0, 0, 0, 8),
            MaxWidth = 280,
            Background = FindResource(result.Ok ? "StatusSuccessBackgroundBrush" : "StatusErrorBackgroundBrush") as System.Windows.Media.Brush,
            Child = panel,
        });
        AgentMessagesScroll.ScrollToEnd();
    }

    private static IEnumerable<AgentToolCall> ExtractAgentToolCalls(string text)
    {
        var matches = Regex.Matches(text ?? string.Empty, "```(?:emw-tool|tool|json)\\s*(?<json>.*?)```", RegexOptions.Singleline | RegexOptions.IgnoreCase);
        foreach (Match match in matches)
        {
            foreach (var call in ParseAgentToolCalls(match.Groups["json"].Value)) yield return call;
        }
    }

    private static bool TryParseLocalAgentToolInput(string input, out string name, out Dictionary<string, JsonElement> arguments)
    {
        name = string.Empty;
        arguments = new Dictionary<string, JsonElement>();
        var trimmed = (input ?? string.Empty).Trim();
        if (!trimmed.StartsWith("/", StringComparison.Ordinal)) return false;
        var split = trimmed.IndexOf(' ');
        name = (split > 0 ? trimmed[1..split] : trimmed[1..]).Trim();
        if (string.IsNullOrWhiteSpace(name)) return false;
        var json = split > 0 ? trimmed[(split + 1)..].Trim() : "{}";
        if (string.IsNullOrWhiteSpace(json)) json = "{}";
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind == JsonValueKind.Object)
            {
                arguments = doc.RootElement.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone(), StringComparer.OrdinalIgnoreCase);
            }
            return true;
        }
        catch
        {
            arguments = new Dictionary<string, JsonElement>();
            return true;
        }
    }

    private static IEnumerable<AgentToolCall> ParseAgentToolCalls(string json)
    {
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if (TryParseAgentToolCall(item, out var call)) yield return call;
            }
        }
        else if (TryParseAgentToolCall(doc.RootElement, out var call))
        {
            yield return call;
        }
    }

    private static bool TryParseAgentToolCall(JsonElement item, out AgentToolCall call)
    {
        call = new AgentToolCall("", new Dictionary<string, JsonElement>());
        if (item.ValueKind != JsonValueKind.Object) return false;
        if (!item.TryGetProperty("name", out var n) && !item.TryGetProperty("tool", out n)) return false;
        var name = n.GetString() ?? "";
        if (string.IsNullOrWhiteSpace(name)) return false;
        var args = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
        if (item.TryGetProperty("arguments", out var a) && a.ValueKind == JsonValueKind.Object)
        {
            args = a.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone(), StringComparer.OrdinalIgnoreCase);
        }
        call = new AgentToolCall(name, args);
        return true;
    }

    private async Task<AgentToolResult> ExecuteAgentToolAsync(string name, Dictionary<string, JsonElement> args, CancellationToken ct)
    {
        var toolName = (name ?? string.Empty).Trim();
        try
        {
            switch (toolName)
            {
                case "list_scripts":
                    return ToolOk(toolName, new { scripts = _scripts.All.Select(s => new { id = s.FileName, name = s.DisplayName, kind = s.KindLabel, runnable = s.KindLabel != "Library" && s.KindLabel != "Kernel", isAsset = s.IsBundled, readOnly = s.IsBundled }) });
                case "read_script":
                    {
                        var script = FindAgentScript(GetString(args, "scriptId") ?? GetString(args, "id"));
                        if (script == null) return ToolError(toolName, "Script not found.");
                        return ToolOk(toolName, new { id = script.FileName, name = script.DisplayName, source = File.ReadAllText(script.FilePath), kind = script.KindLabel, readOnly = script.IsBundled });
                    }
                case "apply_patch_to_script":
                    return ApplyAgentPatchTool(toolName, args);
                case "run_script":
                    {
                        var script = FindAgentScript(GetString(args, "scriptId") ?? GetString(args, "id"));
                        if (script != null) SelectScript(script);
                        if (_selectedScript == null) return ToolError(toolName, "No script selected.");
                        HandleTogglePreview(true);
                        return ToolOk(toolName, new { scriptId = _selectedScript.FileName, name = _selectedScript.DisplayName, running = _isRunning });
                    }
                case "stop_script":
                    StopScript();
                    return ToolOk(toolName, new { stopped = true });
                case "get_device_status":
                    return ToolOk(toolName, new { connected = _device.IsConnected, transport = _device.ActiveTransport.ToString(), boardType = _device.ConnectedBoardType ?? _device.LastDetectedBoardType ?? "", activeScriptName = _isRunning ? _selectedScript?.DisplayName ?? "" : "", isRendering = _isPreviewMode, lastError = ErrorBanner.Visibility == Visibility.Visible ? ErrorText.Text : "" });
                case "spi_transfer":
                    return await AgentToolSpiTransfer(args, ct);
                case "gpio_mode":
                    return await AgentToolGpioMode(args, ct);
                case "gpio_write":
                    return await AgentToolGpioWrite(args, ct);
                case "gpio_read":
                    return await AgentToolGpioRead(args, ct);
                case "analog_read":
                    return await AgentToolAnalogRead(args, ct);
                case "sleep":
                    var ms = Math.Clamp(GetInt(args, "ms") ?? 0, 0, 30000);
                    await Task.Delay(ms, ct);
                    return ToolOk(toolName, new { slept_ms = ms });
                default:
                    return ToolError(toolName, "Unknown EMWaver tool: " + toolName);
            }
        }
        catch (Exception ex)
        {
            return ToolError(toolName, ex.Message);
        }
    }

    private AgentToolResult ApplyAgentPatchTool(string name, Dictionary<string, JsonElement> args)
    {
        var script = FindAgentScript(GetString(args, "scriptId") ?? GetString(args, "id"));
        if (script != null) SelectScript(script);
        if (_selectedScript == null) return ToolError(name, "No script selected.");
        if (_selectedScript.IsBundled) return ToolError(name, "Script is bundled/read-only. Use Make Copy first.");
        var content = GetString(args, "content");
        if (!string.IsNullOrWhiteSpace(content))
        {
            EditorTextBox.Text = content;
            return ToolOk(name, new { scriptId = _selectedScript.FileName, bytes = content.Length, saved = false });
        }
        var patch = GetString(args, "patch");
        if (string.IsNullOrWhiteSpace(patch)) return ToolError(name, "patch or content is required.");
        if (!TryApplyUnifiedPatch(EditorTextBox.Text, patch, out var updated, out var error)) return ToolError(name, error ?? "Patch failed.");
        EditorTextBox.Text = updated;
        return ToolOk(name, new { scriptId = _selectedScript.FileName, bytes = updated.Length, saved = false });
    }

    private ScriptInfo? FindAgentScript(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return _selectedScript;
        return _scripts.All.FirstOrDefault(s => s.FileName.Equals(id, StringComparison.OrdinalIgnoreCase) || s.DisplayName.Equals(id, StringComparison.OrdinalIgnoreCase));
    }

    private async Task<AgentToolResult> AgentToolSpiTransfer(Dictionary<string, JsonElement> args, CancellationToken ct)
    {
        var tx = GetByteArray(args, "bytes");
        if (tx == null) return ToolError("spi_transfer", "bytes must be an array of 0-255 numbers.");
        if (tx.Length > 14) return ToolError("spi_transfer", $"bytes is too long ({tx.Length}, max 14).");
        var cs = GetByte(args, "cs");
        if (cs == null) return ToolError("spi_transfer", "cs is required.");
        var rxLength = Math.Clamp(GetInt(args, "rx_length") ?? tx.Length, 0, 17);
        var command = new byte[] { AgentHardwareProtocol.SpiTransfer, cs.Value, (byte)rxLength, (byte)tx.Length }.Concat(tx).ToArray();
        var payload = await AgentHardwareSend(command, ct);
        if (payload.Error != null) return ToolError("spi_transfer", payload.Error);
        return ToolOk("spi_transfer", new { rx = payload.Payload.Take(rxLength).ToArray() });
    }

    private async Task<AgentToolResult> AgentToolGpioMode(Dictionary<string, JsonElement> args, CancellationToken ct)
    {
        var pin = GetByte(args, "pin");
        if (pin == null) return ToolError("gpio_mode", "pin is required.");
        var mode = (GetString(args, "mode") ?? "").ToUpperInvariant();
        byte sub = mode switch { "INPUT" => AgentHardwareProtocol.GpioInput, "OUTPUT" => AgentHardwareProtocol.GpioOutput, "INPUT_PULLUP" => AgentHardwareProtocol.GpioPull, _ => 0xff };
        if (sub == 0xff) return ToolError("gpio_mode", "mode must be INPUT, OUTPUT, or INPUT_PULLUP.");
        var command = sub == AgentHardwareProtocol.GpioPull ? new[] { AgentHardwareProtocol.Gpio, sub, pin.Value, (byte)1 } : new[] { AgentHardwareProtocol.Gpio, sub, pin.Value };
        var payload = await AgentHardwareSend(command, ct);
        return payload.Error == null ? ToolOk("gpio_mode", new { pin = pin.Value, mode }) : ToolError("gpio_mode", payload.Error);
    }

    private async Task<AgentToolResult> AgentToolGpioWrite(Dictionary<string, JsonElement> args, CancellationToken ct)
    {
        var pin = GetByte(args, "pin");
        if (pin == null) return ToolError("gpio_write", "pin is required.");
        var value = (GetString(args, "value") ?? "").ToUpperInvariant();
        var sub = value switch { "HIGH" => AgentHardwareProtocol.GpioHigh, "LOW" => AgentHardwareProtocol.GpioLow, _ => (byte)0xff };
        if (sub == 0xff) return ToolError("gpio_write", "value must be HIGH or LOW.");
        var payload = await AgentHardwareSend(new[] { AgentHardwareProtocol.Gpio, sub, pin.Value }, ct);
        return payload.Error == null ? ToolOk("gpio_write", new { pin = pin.Value, value }) : ToolError("gpio_write", payload.Error);
    }

    private async Task<AgentToolResult> AgentToolGpioRead(Dictionary<string, JsonElement> args, CancellationToken ct)
    {
        var pin = GetByte(args, "pin");
        if (pin == null) return ToolError("gpio_read", "pin is required.");
        var payload = await AgentHardwareSend(new[] { AgentHardwareProtocol.Gpio, AgentHardwareProtocol.GpioRead, pin.Value }, ct);
        if (payload.Error != null) return ToolError("gpio_read", payload.Error);
        return ToolOk("gpio_read", new { pin = pin.Value, level = payload.Payload.FirstOrDefault() == 0 ? 0 : 1 });
    }

    private async Task<AgentToolResult> AgentToolAnalogRead(Dictionary<string, JsonElement> args, CancellationToken ct)
    {
        var pin = GetByte(args, "pin");
        if (pin == null) return ToolError("analog_read", "pin is required.");
        var payload = await AgentHardwareSend(new[] { AgentHardwareProtocol.AdcRead, AgentHardwareProtocol.AdcPin, pin.Value, (byte)1 }, ct);
        if (payload.Error != null) return ToolError("analog_read", payload.Error);
        var lo = payload.Payload.Length > 0 ? payload.Payload[0] : 0;
        var hi = payload.Payload.Length > 1 ? payload.Payload[1] : 0;
        return ToolOk("analog_read", new { pin = pin.Value, value = (hi << 8) | lo });
    }

    private async Task<(byte[] Payload, string? Error)> AgentHardwareSend(byte[] command, CancellationToken ct)
    {
        if (!_device.IsConnected) return (Array.Empty<byte>(), "No device connected.");
        if (command.Length > 18) return (Array.Empty<byte>(), $"Command too large ({command.Length}, max 18).");
        var response = await _device.SendPacketAsync(command, 1500);
        ct.ThrowIfCancellationRequested();
        if (response == null || response.Length == 0) return (Array.Empty<byte>(), _device.LastErrorText ?? "Device did not respond.");
        return response[0] switch
        {
            AgentHardwareProtocol.ResponseOk => (response.Skip(1).ToArray(), null),
            AgentHardwareProtocol.ResponseBusy => (Array.Empty<byte>(), "Device busy (0x82): another transport session owns runtime control."),
            AgentHardwareProtocol.ResponseErr => (Array.Empty<byte>(), "Device returned ERR (0x81)."),
            var other => (Array.Empty<byte>(), $"Device error: {other}.")
        };
    }

    private static string? GetString(Dictionary<string, JsonElement> args, string key) => args.TryGetValue(key, out var e) && e.ValueKind == JsonValueKind.String ? e.GetString() : null;
    private static int? GetInt(Dictionary<string, JsonElement> args, string key) => args.TryGetValue(key, out var e) && e.TryGetInt32(out var v) ? v : null;
    private static byte? GetByte(Dictionary<string, JsonElement> args, string key)
    {
        var v = GetInt(args, key);
        return v is >= 0 and <= 255 ? (byte)v.Value : null;
    }
    private static byte[]? GetByteArray(Dictionary<string, JsonElement> args, string key)
    {
        if (!args.TryGetValue(key, out var e) || e.ValueKind != JsonValueKind.Array) return null;
        var list = new List<byte>();
        foreach (var item in e.EnumerateArray())
        {
            if (!item.TryGetInt32(out var v) || v < 0 || v > 255) return null;
            list.Add((byte)v);
        }
        return list.ToArray();
    }
    private static AgentToolResult ToolOk(string name, object payload) => new(name, true, JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true }));
    private static AgentToolResult ToolError(string name, string error) => new(name, false, JsonSerializer.Serialize(new { error }, new JsonSerializerOptions { WriteIndented = true }), error);

    private FrameworkElement BuildAgentMessageContent(string role, string text)
    {
        var panel = new StackPanel { Orientation = Orientation.Vertical };
        var pattern = new Regex("```(?<lang>[a-zA-Z0-9_-]+)?\\s*(?<code>.*?)```", RegexOptions.Singleline);
        var index = 0;
        foreach (Match match in pattern.Matches(text ?? string.Empty))
        {
            AddAgentTextSegment(panel, (text ?? string.Empty)[index..match.Index], role);
            AddAgentCodeSegment(panel, match.Groups["code"].Value.Trim(), match.Groups["lang"].Value.Trim());
            index = match.Index + match.Length;
        }
        AddAgentTextSegment(panel, (text ?? string.Empty)[index..], role);
        return panel;
    }

    private void AddAgentTextSegment(Panel panel, string segment, string role)
    {
        var cleaned = (segment ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(cleaned)) return;
        var lines = cleaned.Replace("\r\n", "\n").Split('\n');
        foreach (var raw in lines)
        {
            var line = raw.TrimEnd();
            if (string.IsNullOrWhiteSpace(line)) continue;
            var isHeading = line.StartsWith("#", StringComparison.Ordinal);
            var isBullet = line.TrimStart().StartsWith("- ", StringComparison.Ordinal) || line.TrimStart().StartsWith("* ", StringComparison.Ordinal);
            var text = isHeading ? line.TrimStart('#', ' ') : isBullet ? "• " + line.TrimStart().Substring(2) : line;
            panel.Children.Add(new TextBlock
            {
                Text = StripInlineMarkdown(text),
                TextWrapping = TextWrapping.Wrap,
                FontSize = isHeading ? 13 : 12,
                FontWeight = isHeading ? FontWeights.SemiBold : FontWeights.Normal,
                Foreground = role == "user" ? FindResource("PlotLineBrush") as System.Windows.Media.Brush : FindResource("AppTextForegroundBrush") as System.Windows.Media.Brush,
                Margin = new Thickness(isBullet ? 8 : 0, 0, 0, 4),
            });
        }
    }

    private static string StripInlineMarkdown(string value)
    {
        var text = value ?? string.Empty;
        text = Regex.Replace(text, @"\*\*(.*?)\*\*", "$1");
        text = Regex.Replace(text, @"`([^`]+)`", "$1");
        text = Regex.Replace(text, @"\[([^\]]+)\]\(([^\)]+)\)", "$1 ($2)");
        return text;
    }

    private void AddAgentCodeSegment(Panel panel, string code, string language)
    {
        if (string.IsNullOrWhiteSpace(code)) return;
        var header = new DockPanel { Margin = new Thickness(0, 4, 0, 2) };
        header.Children.Add(new TextBlock
        {
            Text = string.IsNullOrWhiteSpace(language) ? "code" : language,
            FontSize = 10,
            FontWeight = FontWeights.SemiBold,
            Foreground = FindResource("AppTextSecondaryBrush") as System.Windows.Media.Brush,
        });
        var copy = new Button
        {
            Content = "Copy",
            Tag = code,
            Padding = new Thickness(6, 1, 6, 1),
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        DockPanel.SetDock(copy, Dock.Right);
        copy.Click += OnCopyAgentCodeClick;
        header.Children.Add(copy);
        panel.Children.Add(header);
        panel.Children.Add(new TextBox
        {
            Text = code,
            IsReadOnly = true,
            AcceptsReturn = true,
            TextWrapping = TextWrapping.NoWrap,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            MaxHeight = 180,
            FontFamily = new System.Windows.Media.FontFamily("Consolas"),
            FontSize = 11,
            Background = FindResource("EditorSurfaceBackgroundBrush") as System.Windows.Media.Brush,
            Foreground = FindResource("EditorTextForegroundBrush") as System.Windows.Media.Brush,
        });
    }

    private Button MakeAgentActionButton(string title, string payload)
    {
        return new Button
        {
            Content = title,
            Margin = new Thickness(0, -4, 0, 8),
            Padding = new Thickness(8, 3, 8, 3),
            HorizontalAlignment = HorizontalAlignment.Left,
            Tag = payload,
        };
    }

    private void OnCopyAgentCodeClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button button && button.Tag is string code)
        {
            Clipboard.SetText(code);
        }
    }

    private void OnApplyAgentCodeClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button button || button.Tag is not string code || string.IsNullOrWhiteSpace(code)) return;
        if (_selectedScript?.IsBundled == true)
        {
            ShowError("This is a bundled read-only script. Use Make Copy before applying Agent code.");
            return;
        }

        EditorTextBox.Text = code.Trim();
        HandleTogglePreview(false);
    }

    private void OnApplyAgentPatchClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button button || button.Tag is not string patch || string.IsNullOrWhiteSpace(patch)) return;
        if (_selectedScript?.IsBundled == true)
        {
            ShowError("This is a bundled read-only script. Use Make Copy before applying Agent patches.");
            return;
        }

        if (TryApplyUnifiedPatch(EditorTextBox.Text, patch, out var updated, out var error))
        {
            var changed = CountChangedLines(EditorTextBox.Text, updated);
            var confirm = MessageBox.Show($"Apply this Agent patch to the current editor?\n\nChanged lines: {changed}", "Apply Agent Patch", MessageBoxButton.YesNo, MessageBoxImage.Question);
            if (confirm != MessageBoxResult.Yes) return;
            EditorTextBox.Text = updated;
            HandleTogglePreview(false);
        }
        else
        {
            ShowError(error ?? "Could not apply patch.");
        }
    }

    private static bool TryExtractCodeBlock(string text, out string code)
    {
        code = string.Empty;
        var match = Regex.Match(text ?? string.Empty, "```(?:emw|javascript|js)?\\s*(.*?)```", RegexOptions.Singleline | RegexOptions.IgnoreCase);
        if (!match.Success) return false;
        code = match.Groups[1].Value.Trim();
        return !string.IsNullOrWhiteSpace(code) && !code.StartsWith("--- ", StringComparison.Ordinal);
    }

    private static bool TryExtractPatch(string text, out string patch)
    {
        patch = string.Empty;
        var match = Regex.Match(text ?? string.Empty, "```(?:diff|patch)?\\s*(?<patch>--- .*?)```", RegexOptions.Singleline | RegexOptions.IgnoreCase);
        if (match.Success)
        {
            patch = match.Groups["patch"].Value.Trim();
            return true;
        }

        var idx = (text ?? string.Empty).IndexOf("--- ", StringComparison.Ordinal);
        if (idx >= 0 && (text ?? string.Empty).IndexOf("@@", idx, StringComparison.Ordinal) >= 0)
        {
            patch = (text ?? string.Empty)[idx..].Trim();
            return true;
        }
        return false;
    }

    private static bool TryApplyUnifiedPatch(string original, string patch, out string updated, out string? error)
    {
        updated = original;
        error = null;
        var source = original.Replace("\r\n", "\n").Split('\n').ToList();
        var lines = patch.Replace("\r\n", "\n").Split('\n');
        var output = new List<string>();
        var sourceIndex = 0;
        var i = 0;
        while (i < lines.Length)
        {
            if (!lines[i].StartsWith("@@", StringComparison.Ordinal))
            {
                i++;
                continue;
            }

            var header = Regex.Match(lines[i], @"@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@");
            if (!header.Success)
            {
                error = "Unsupported patch hunk header.";
                return false;
            }

            var oldStart = Math.Max(0, int.Parse(header.Groups[1].Value) - 1);
            while (sourceIndex < oldStart && sourceIndex < source.Count)
            {
                output.Add(source[sourceIndex++]);
            }

            i++;
            while (i < lines.Length && !lines[i].StartsWith("@@", StringComparison.Ordinal))
            {
                var line = lines[i];
                if (line.Length == 0)
                {
                    i++;
                    continue;
                }

                var marker = line[0];
                var body = line.Length > 1 ? line[1..] : string.Empty;
                if (marker == ' ')
                {
                    if (sourceIndex >= source.Count || source[sourceIndex] != body)
                    {
                        error = "Patch context did not match the current editor text.";
                        return false;
                    }
                    output.Add(source[sourceIndex++]);
                }
                else if (marker == '-')
                {
                    if (sourceIndex >= source.Count || source[sourceIndex] != body)
                    {
                        error = "Patch removal did not match the current editor text.";
                        return false;
                    }
                    sourceIndex++;
                }
                else if (marker == '+')
                {
                    output.Add(body);
                }
                i++;
            }
        }

        while (sourceIndex < source.Count)
        {
            output.Add(source[sourceIndex++]);
        }
        updated = string.Join(Environment.NewLine, output);
        return true;
    }

    private static int CountChangedLines(string before, string after)
    {
        var a = (before ?? string.Empty).Replace("\r\n", "\n").Split('\n');
        var b = (after ?? string.Empty).Replace("\r\n", "\n").Split('\n');
        var max = Math.Max(a.Length, b.Length);
        var changed = 0;
        for (var i = 0; i < max; i++)
        {
            var av = i < a.Length ? a[i] : null;
            var bv = i < b.Length ? b[i] : null;
            if (av != bv) changed++;
        }
        return changed;
    }
}
