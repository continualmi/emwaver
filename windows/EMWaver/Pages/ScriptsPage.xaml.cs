using EMWaver.Models;
using EMWaver.Scripting;
using EMWaver.Scripting.Render;
using EMWaver.Services;
using EMWaver.Services.Cloud;
using System.IO;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage;
using WindowsLauncher = Windows.System.Launcher;

namespace EMWaver.Pages;

public sealed partial class ScriptsPage : Page
{
    private const double DefaultAgentPaneWidth = 380;

    public event Action<bool>? PreviewModeChanged;
    public event Action<bool, string?>? RunningScriptStatusChanged;

    private readonly ObservableCollection<Models.ScriptListSection> _sections = new();
    private sealed class AgentMessageRow
    {
        public string Role { get; }
        public string Text { get; }

        public AgentMessageRow(string role, string text)
        {
            Role = role;
            Text = text;
        }

        public bool IsUser => string.Equals(Role, "You", StringComparison.OrdinalIgnoreCase);
        public bool IsAssistant => string.Equals(Role, "ELM", StringComparison.OrdinalIgnoreCase);
        public bool IsTool => string.Equals(Role, "Tool", StringComparison.OrdinalIgnoreCase);

        public string RoleLabel => IsUser ? "You" : (IsTool ? "Tool" : "Agent");

        public string IconGlyph => IsUser ? "" : (IsTool ? "" : "");

        public Brush BubbleBackground => IsUser
            ? new SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(36, 0, 120, 212))
            : (IsTool
                ? new SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(25, 140, 140, 140))
                : new SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(18, 128, 128, 128)));

        public Brush BubbleBorderBrush => new SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(36, 80, 80, 80));

        public HorizontalAlignment BubbleAlignment => IsUser ? HorizontalAlignment.Right : HorizontalAlignment.Left;

        public string RenderedText
        {
            get
            {
                if (!IsTool)
                {
                    return IsAssistant ? RenderMarkdownLikeMac(Text) : Text;
                }

                var raw = (Text ?? "").Trim();
                if (raw.StartsWith("[tool]", StringComparison.OrdinalIgnoreCase))
                {
                    raw = raw[6..].Trim();
                }

                if (string.IsNullOrWhiteSpace(raw))
                {
                    return "Tool action";
                }

                var firstSpace = raw.IndexOf(' ');
                var toolId = firstSpace > 0 ? raw[..firstSpace] : raw;
                var detail = firstSpace > 0 ? raw[(firstSpace + 1)..].Trim() : "";

                var title = toolId switch
                {
                    "hosts_list" => "List hosts",
                    "remote_attach" => "Attach host",
                    "remote_run_script" => "Run script",
                    "remote_wait_for_ui" => "Wait for UI",
                    "remote_send_ui_event" => "UI action",
                    _ => toolId,
                };

                return string.IsNullOrWhiteSpace(detail) ? title : (title + "\n" + detail);
            }
        }

        private static string RenderMarkdownLikeMac(string text)
        {
            var t = (text ?? string.Empty).Replace("\r\n", "\n").Replace("\r", "\n");

            // Code fences: keep content, drop fence markers.
            t = Regex.Replace(t, @"```(?:[a-zA-Z0-9_+-]+)?\n([\s\S]*?)```", m => m.Groups[1].Value.Trim('\n'));

            // Headings to plain lines.
            t = Regex.Replace(t, @"^\s{0,3}#{1,6}\s*", "", RegexOptions.Multiline);

            // Bullets and task lists.
            t = Regex.Replace(t, @"^\s*[-*+]\s+", "• ", RegexOptions.Multiline);
            t = Regex.Replace(t, @"^\s*\d+\.\s+", "• ", RegexOptions.Multiline);
            t = Regex.Replace(t, @"\[(x|X| )\]\s+", "", RegexOptions.Multiline);

            // Links: keep label only.
            t = Regex.Replace(t, @"\[([^\]]+)\]\(([^\)]+)\)", "$1");

            // Emphasis/inline code markers (keep content).
            t = Regex.Replace(t, @"`([^`]+)`", "$1");
            t = Regex.Replace(t, @"\*\*([^*]+)\*\*", "$1");
            t = Regex.Replace(t, @"__([^_]+)__", "$1");
            t = Regex.Replace(t, @"\*([^*]+)\*", "$1");
            t = Regex.Replace(t, @"_([^_]+)_", "$1");

            // Block quote prefix.
            t = Regex.Replace(t, @"^>\s?", "", RegexOptions.Multiline);

            // Tighten excessive blank lines while preserving paragraph breaks.
            t = Regex.Replace(t, "\n{3,}", "\n\n");
            return t.Trim();
        }
    }

    private readonly ObservableCollection<AgentMessageRow> _agentMessages = new();
    private readonly ObservableCollection<EMWaver.Services.Agent.AgentApi.Conversation> _agentConversations = new();

    private string? _agentConversationId;
    private CancellationTokenSource? _agentStreamCts;
    private bool _agentSignedIn;
    private bool _agentEnabled;
    private bool _cloudSyncEnabled;
    private bool _isResizingAgentPane;
    private double _agentResizeStartX;
    private double _agentResizeStartWidth;
    private readonly InputCursor _agentResizeCursor = InputSystemCursor.Create(InputSystemCursorShape.SizeWestEast);

    private EMWaver.Services.Agent.AgentApi AgentApi => new(AppServices.Http, AppServices.CloudConfig, AppServices.CloudAuth);


    private ScriptInfo? _current;
    private Models.SignalFileInfo? _currentSignal;
    private string _loadedTextNormalized = string.Empty;
    private bool _isDirty;
    private bool _suppressSelectionChange;
    private bool _suppressEditorChanged;

    private readonly ScriptEngine _scriptEngine = new();
    private readonly ScriptRenderer _scriptRenderer;

    public event Action<ScriptToolbarState>? ToolbarStateChanged;
    public ScriptToolbarState CurrentToolbarState { get; private set; } = new(false, false, false);

    public ScriptsPage()
    {
        InitializeComponent();

        // Remote control host delegate (so this page can run scripts + publish UI snapshots).
        AppServices.RemoteControlHost.Delegate = new RemoteControlDelegate(this);

        // Grouped list (Examples / Your Scripts / Signals)
        var cvs = new Microsoft.UI.Xaml.Data.CollectionViewSource
        {
            IsSourceGrouped = true,
            Source = _sections,
            ItemsPath = new Microsoft.UI.Xaml.PropertyPath("Items"),
        };
        ScriptsList.ItemsSource = cvs.View;

        AgentMessagesList.ItemsSource = _agentMessages;
        AgentConversationsCombo.ItemsSource = _agentConversations;

        _agentConversationId = LoadAgentConversationId();

        _scriptRenderer = new ScriptRenderer((token, args) =>
        {
            _scriptEngine.Invoke(token, args);
        });

        _scriptEngine.Setup(
            renderHandler: tree =>
            {
                var gen = _activeRenderGeneration;
                _ = DispatcherQueue.TryEnqueue(() =>
                {
                    HandleScriptTreeRender(tree, gen);
                });
            },
            sendPacket: (bytes, timeoutMs) => AppServices.Device.SendPacket(bytes, timeoutMs),
            errorHandler: message =>
            {
                _ = DispatcherQueue.TryEnqueue(async () => await ShowScriptErrorAsync(message));
            }
        );

        Loaded += OnLoaded;

        // Default: editor-first.
        SetPreviewMode(false);


        EmptyHint.Visibility = Visibility.Visible;
        PreviewHint.Visibility = Visibility.Visible;
        PreviewHost.Children.Clear();
        EditorBox.IsReadOnly = true;
        EditorBox.Text = string.Empty;

        // Sections bootstrap
        _sections.Clear();
        _sections.Add(new Models.ScriptListSection("Examples"));
        _sections.Add(new Models.ScriptListSection("Your Scripts"));
        _sections.Add(new Models.ScriptListSection("Signals"));
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        await RefreshEntitlementsUiAsync(force: true);
        await RefreshAsync();
        QueueEditorFocus();
    }

    // Monaco/WebView2 removed on Windows (unstable and non-native).

    private async Task RefreshAsync(string? selectFullPath = null)
    {
        try
        {
            await AppServices.Scripts.EnsureBootstrappedAsync();
            var scripts = await AppServices.Scripts.ListScriptsAsync();

            var signals = new List<Models.SignalFileInfo>();
            try
            {
                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var signalsDir in GetSignalDirectories())
                {
                    if (!Directory.Exists(signalsDir))
                    {
                        continue;
                    }

                    foreach (var p in Directory.EnumerateFiles(signalsDir, "*", SearchOption.TopDirectoryOnly))
                    {
                        var ext = Path.GetExtension(p) ?? "";
                        if (!string.Equals(ext, ".raw", StringComparison.OrdinalIgnoreCase) &&
                            !string.Equals(ext, ".txt", StringComparison.OrdinalIgnoreCase))
                        {
                            continue;
                        }

                        if (!seen.Add(p))
                        {
                            continue;
                        }

                        signals.Add(new Models.SignalFileInfo(
                            Name: Path.GetFileNameWithoutExtension(p) ?? "signal",
                            FullPath: p,
                            Extension: ext
                        ));
                    }
                }
            }
            catch { /* best-effort */ }

            await RunOnUiAsync(async () =>
            {
                _suppressSelectionChange = true;
                try
                {
                    var examples = _sections.First(s => s.Title == "Examples");
                    var yours = _sections.First(s => s.Title == "Your Scripts");
                    var sigSection = _sections.First(s => s.Title == "Signals");

                    examples.Items.Clear();
                    yours.Items.Clear();
                    sigSection.Items.Clear();

                    foreach (var s in scripts)
                    {
                        if (s.IsBundled) examples.Items.Add(s);
                        else yours.Items.Add(s);
                    }

                    foreach (var sig in signals.OrderBy(s => s.FileName, StringComparer.OrdinalIgnoreCase))
                    {
                        sigSection.Items.Add(sig);
                    }

                    // Force ListView to notice refresh
                    ScriptsList.UpdateLayout();

                    if (selectFullPath != null)
                    {
                        var match = scripts.FirstOrDefault(s => string.Equals(s.FullPath, selectFullPath, StringComparison.OrdinalIgnoreCase));
                        if (match != null)
                        {
                            ScriptsList.SelectedItem = match;
                            await OpenScriptAsync(match);
                        }
                        return;
                    }

                    if (_current != null)
                    {
                        var stillThere = scripts.FirstOrDefault(s => string.Equals(s.FullPath, _current.FullPath, StringComparison.OrdinalIgnoreCase));
                        if (stillThere != null)
                        {
                            ScriptsList.SelectedItem = stillThere;
                            await OpenScriptAsync(stillThere);
                            return;
                        }
                    }

                    // If the current script disappeared (e.g., deleted), clear selection without prompting.
                    _isDirty = false;
                    ScriptsList.SelectedItem = null;
                    ClearEditor();
                    await Task.CompletedTask;
                }
                finally
                {
                    _suppressSelectionChange = false;
                }
            });
        }
        catch (Exception ex)
        {
            // Don’t silently fail: it makes the list look “stuck”.
            _ = DispatcherQueue.TryEnqueue(async () => await ShowInfoAsync("Scripts", "Refresh failed: " + ex.Message));
        }
    }

    private async void OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressSelectionChange)
        {
            return;
        }

        if (_isDirty)
        {
            var discard = await ConfirmAsync(
                title: "Discard changes?",
                message: "You have unsaved changes. Switching scripts will discard them.",
                primaryButtonText: "Discard",
                closeButtonText: "Cancel"
            );

            if (!discard)
            {
                // Restore selection to whatever we had open.
                object? prev = _currentSignal ?? (object?)_current;

                _suppressSelectionChange = true;
                ScriptsList.SelectedItem = prev;
                _suppressSelectionChange = false;
                return;
            }
        }

        if (ScriptsList.SelectedItem is ScriptInfo script)
        {
            _currentSignal = null;
            await OpenScriptAsync(script);
        }
        else if (ScriptsList.SelectedItem is Models.SignalFileInfo sig)
        {
            _current = null;
            await OpenSignalAsync(sig);
        }
        else
        {
            _current = null;
            _currentSignal = null;
            ClearEditor();
        }
    }

    private void OnScriptsListRightTapped(object sender, RightTappedRoutedEventArgs e)
    {
        var fe = e.OriginalSource as FrameworkElement;
        var candidate = fe?.DataContext;
        if (candidate is ScriptInfo script)
        {
            ScriptsList.SelectedItem = script;
        }
        else if (candidate is Models.SignalFileInfo signal)
        {
            ScriptsList.SelectedItem = signal;
        }
    }

    private void OnScriptsListContextOpening(object sender, object e)
    {
        var canEditScript = _current != null && !_current.IsBundled;
        var canDeleteSignal = _currentSignal != null;
        ScriptsContextRenameItem.IsEnabled = canEditScript;
        ScriptsContextDeleteItem.IsEnabled = canEditScript || canDeleteSignal;
    }

    private void OnScriptsContextRenameClick(object sender, RoutedEventArgs e)
    {
        OnRenameClick(sender, e);
    }

    private void OnScriptsContextDeleteClick(object sender, RoutedEventArgs e)
    {
        OnDeleteClick(sender, e);
    }

    private async Task OpenScriptAsync(ScriptInfo script)
    {
        _current = script;
        _currentSignal = null;

        string text;
        try
        {
            text = await AppServices.Scripts.ReadScriptTextAsync(script);
        }
        catch (Exception ex)
        {
            await ShowInfoAsync("Open", ex.Message);
            ClearEditor();
            return;
        }

        // Selecting a different file while in preview should exit preview mode.
        // (OpenScriptAsync can run off-UI-thread depending on SelectionChanged flow.)
        SetPreviewMode(false);

        await RunOnUiAsync(async () =>
        {
            _loadedTextNormalized = NormalizeLineEndings(text).TrimEnd('\n');
            _isDirty = false;

            _suppressEditorChanged = true;
            EditorBox.IsReadOnly = script.IsBundled;
            EditorBox.Text = text ?? string.Empty;
            SetEditorWrapping(wrapText: false);
            _suppressEditorChanged = false;

            // Always start in editor mode when opening a script.
            SetPreviewMode(false);

            EmptyHint.Visibility = Visibility.Collapsed;
            ReadOnlyBanner.Visibility = script.IsBundled ? Visibility.Visible : Visibility.Collapsed;

            PreviewHost.Children.Clear();
            PreviewHint.Visibility = Visibility.Visible;

            UpdateCommandStates();
            QueueEditorFocus();

            await Task.CompletedTask;
        });

        // Do NOT auto-run on open. Rendering should only happen when the user presses Run.
    }

    private async Task OpenSignalAsync(Models.SignalFileInfo sig)
    {
        _currentSignal = sig;
        _current = null;

        // Signals are read-only artifacts for now.
        SetPreviewMode(false);

        string text;
        try
        {
            if (string.Equals(sig.Extension, ".raw", StringComparison.OrdinalIgnoreCase))
            {
                var data = await File.ReadAllBytesAsync(sig.FullPath);
                text = FormatHex(data, maxBytes: 256 * 1024);
            }
            else
            {
                var data = await File.ReadAllBytesAsync(sig.FullPath);
                text = Encoding.UTF8.GetString(data);
            }
        }
        catch (Exception ex)
        {
            await ShowInfoAsync("Open signal", ex.Message);
            ClearEditor();
            return;
        }

        await RunOnUiAsync(async () =>
        {
            _loadedTextNormalized = NormalizeLineEndings(text).TrimEnd('\n');
            _isDirty = false;

            ReadOnlyBanner.Visibility = Visibility.Collapsed;

            _suppressEditorChanged = true;
            EditorBox.IsReadOnly = true;
            EditorBox.Text = text;
            SetEditorWrapping(wrapText: string.Equals(sig.Extension, ".txt", StringComparison.OrdinalIgnoreCase));
            _suppressEditorChanged = false;


            EmptyHint.Visibility = Visibility.Collapsed;

            UpdateCommandStates();
            await Task.CompletedTask;
        });
    }

    private void ClearEditor()
    {
        _current = null;
        _loadedTextNormalized = string.Empty;
        _isDirty = false;

        _ = RunOnUiAsync(async () =>
        {
            _suppressEditorChanged = true;
            EditorBox.IsReadOnly = true;
            EditorBox.Text = string.Empty;
            SetEditorWrapping(wrapText: false);
            _suppressEditorChanged = false;


            EmptyHint.Visibility = Visibility.Visible;
            ReadOnlyBanner.Visibility = Visibility.Collapsed;

            PreviewHost.Children.Clear();
            PreviewHint.Visibility = Visibility.Visible;

            UpdateCommandStates();
            await Task.CompletedTask;
        });
    }

    private static IEnumerable<string> GetSignalDirectories()
    {
        var root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "EMWaver"
        );

        // Signals can exist in multiple locations depending on script/runtime generation:
        // - root: current sampler save target via FS.appDataDir()
        // - Scripts: parity with platforms that keep artifacts beside scripts
        // - Signals: legacy Windows sync storage
        var candidates = new[]
        {
            root,
            Path.Combine(root, "Scripts"),
            Path.Combine(root, "Signals"),
            Path.Combine(root, "signals"),
        };

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var dir in candidates)
        {
            if (seen.Add(dir))
            {
                yield return dir;
            }
        }
    }

    private void SetEditorWrapping(bool wrapText)
    {
        EditorBox.TextWrapping = wrapText ? TextWrapping.Wrap : TextWrapping.NoWrap;
        ScrollViewer.SetHorizontalScrollBarVisibility(
            EditorBox,
            wrapText ? ScrollBarVisibility.Disabled : ScrollBarVisibility.Auto
        );
    }

    private static string FormatHex(byte[] data, int maxBytes)
    {
        var count = Math.Min(data.Length, maxBytes);
        var sb = new StringBuilder(capacity: Math.Max(64, (count / 16 + 2) * 80));

        for (var offset = 0; offset < count; offset += 16)
        {
            var lineCount = Math.Min(16, count - offset);

            sb.Append(offset.ToString("X8"));
            sb.Append("  ");

            for (var i = 0; i < 16; i++)
            {
                if (i < lineCount)
                {
                    sb.Append(data[offset + i].ToString("X2"));
                }
                else
                {
                    sb.Append("  ");
                }

                if (i != 15)
                {
                    sb.Append(' ');
                }
            }

            sb.Append("  |");
            for (var i = 0; i < lineCount; i++)
            {
                var b = data[offset + i];
                sb.Append(b >= 32 && b < 127 ? (char)b : '.');
            }
            sb.Append('|');

            if (offset + 16 < count)
            {
                sb.AppendLine();
            }
        }

        if (data.Length > maxBytes)
        {
            if (sb.Length > 0) sb.AppendLine();
            sb.AppendLine();
            sb.Append("(truncated to ");
            sb.Append(maxBytes);
            sb.Append(" bytes; file is ");
            sb.Append(data.Length);
            sb.Append(" bytes)");
        }

        return sb.ToString();
    }

    private void OnEditorTextChanged(object sender, RoutedEventArgs e)
    {
        if (_suppressEditorChanged)
        {
            return;
        }

        if (_current == null || _current.IsBundled)
        {
            return;
        }

        var now = GetEditorTextNormalized();
        var dirty = !string.Equals(now, _loadedTextNormalized, StringComparison.Ordinal);
        if (dirty != _isDirty)
        {
            _isDirty = dirty;
            UpdateCommandStates();
        }
    }

    private string GetEditorTextNormalized()
    {
        var raw = (EditorBox.Text ?? string.Empty);
        return NormalizeLineEndings(raw).TrimEnd('\n');
    }

    private static string NormalizeLineEndings(string text)
    {
        if (string.IsNullOrEmpty(text)) return string.Empty;
        return text.Replace("\r\n", "\n").Replace("\r", "\n");
    }

    private bool _isPreviewMode;
    private int _renderGeneration;
    private int _activeRenderGeneration;
    private bool _hasActiveRunningScript;
    private string? _activeRunningScriptName;
    private DispatcherQueueTimer? _editorFocusTimer;
    private int _editorFocusAttemptsRemaining;

    private void QueueEditorFocus()
    {
        // Selection/toolbar actions can steal focus after open; retry a few times.
        _ = DispatcherQueue.TryEnqueue(DispatcherQueuePriority.Low, () =>
        {
            StopEditorFocusTimer();
            _editorFocusAttemptsRemaining = 6;

            if (TryFocusEditorNow())
            {
                return;
            }

            _editorFocusTimer ??= DispatcherQueue.CreateTimer();
            _editorFocusTimer.IsRepeating = true;
            _editorFocusTimer.Interval = TimeSpan.FromMilliseconds(40);
            _editorFocusTimer.Tick -= OnEditorFocusTimerTick;
            _editorFocusTimer.Tick += OnEditorFocusTimerTick;
            _editorFocusTimer.Start();
        });
    }

    private void OnEditorFocusTimerTick(DispatcherQueueTimer sender, object args)
    {
        _editorFocusAttemptsRemaining--;
        if (TryFocusEditorNow() || _editorFocusAttemptsRemaining <= 0)
        {
            StopEditorFocusTimer();
        }
    }

    private bool TryFocusEditorNow()
    {
        try
        {
            if (EditorPane.Visibility != Visibility.Visible || EditorBox.IsReadOnly)
            {
                return true;
            }

            EditorBox.Focus(FocusState.Programmatic);
            EditorBox.SelectionStart = EditorBox.Text?.Length ?? 0;
            EditorBox.SelectionLength = 0;

            var focused = FocusManager.GetFocusedElement(XamlRoot);
            return ReferenceEquals(focused, EditorBox);
        }
        catch
        {
            return false;
        }
    }

    private void StopEditorFocusTimer()
    {
        if (_editorFocusTimer is null)
        {
            return;
        }

        _editorFocusTimer.Stop();
        _editorFocusTimer.Tick -= OnEditorFocusTimerTick;
    }

    private void HandleScriptTreeRender(ScriptTree tree, int generation)
    {
        _lastRenderedTree = tree;

        // Keep remote controller state live even when user switches back to code mode locally.
        AppServices.RemoteControlHost.PublishUiSnapshotIfRemoteControlled();

        if (_isPreviewMode && generation == _activeRenderGeneration)
        {
            RenderPreview(tree);
        }
    }

    private void NotifyRunningScriptStatusChanged()
    {
        var showIndicator = _hasActiveRunningScript;
        RunningScriptStatusChanged?.Invoke(showIndicator, _activeRunningScriptName);
    }

    private void SetRunningScriptState(bool isRunning, string? scriptName)
    {
        _hasActiveRunningScript = isRunning;
        _activeRunningScriptName = isRunning ? scriptName : null;
        NotifyRunningScriptStatusChanged();
    }

    private void SetPreviewMode(bool preview)
    {
        // Must be on UI thread; otherwise WinUI will throw RPC_E_WRONG_THREAD (0x8001010E).
        if (!DispatcherQueue.HasThreadAccess)
        {
            _ = DispatcherQueue.TryEnqueue(() => SetPreviewMode(preview));
            return;
        }

        if (EditorPane == null || PreviewPane == null)
        {
            return;
        }

        if (_isPreviewMode == preview)
        {
            return;
        }

        _isPreviewMode = preview;

        // Any mode switch cancels the previous preview run.
        _renderGeneration++;
        _activeRenderGeneration = _renderGeneration;

        EditorPane.Visibility = preview ? Visibility.Collapsed : Visibility.Visible;
        PreviewPane.Visibility = preview ? Visibility.Visible : Visibility.Collapsed;

        if (!preview)
        {
            // Clear preview UI when leaving preview.
            try
            {
                PreviewHost.Children.Clear();
                PreviewHint.Visibility = Visibility.Visible;
            }
            catch { }

            // Make the editor immediately interactive when returning.
            _ = DispatcherQueue.TryEnqueue(() =>
            {
                QueueEditorFocus();
            });
        }
        else if (_lastRenderedTree != null)
        {
            RenderPreview(_lastRenderedTree);
        }

        NotifyRunningScriptStatusChanged();
        PreviewModeChanged?.Invoke(preview);
    }

    private void RenderPreview(ScriptTree? tree)
    {
        System.Diagnostics.Debug.WriteLine($"[EMWaver][Windows][Preview] RenderPreview rootType={tree?.Root.Type}");

        if (!_isPreviewMode || tree == null)
        {
            return;
        }

        PreviewHost.Children.Clear();
        PreviewHost.Children.Add(_scriptRenderer.Render(tree));
        PreviewHint.Visibility = Visibility.Collapsed;

        // Mirror to remote controller (snapshot-only v1).
        RenderPreviewWithRemoteMirror(tree);
    }

    private void UpdateCommandStates()
    {
        var has = _current != null;
        var isBundled = _current?.IsBundled == true;

        var newState = new ScriptToolbarState(has, isBundled, _isDirty);
        CurrentToolbarState = newState;
        ToolbarStateChanged?.Invoke(newState);
    }

    // Toolbar hooks (called from MainWindow)
    internal void HandleToolbarRun() => OnRunClick(this, new RoutedEventArgs());
    internal void HandleToolbarNew() => OnNewClick(this, new RoutedEventArgs());
    internal void HandleToolbarSave() => OnSaveClick(this, new RoutedEventArgs());
    internal void HandleToolbarMakeCopy() => OnMakeCopyClick(this, new RoutedEventArgs());
    internal void HandleToolbarRename() => OnRenameClick(this, new RoutedEventArgs());
    internal void HandleToolbarDelete() => OnDeleteClick(this, new RoutedEventArgs());
    internal void HandleToolbarRefresh() => OnRefreshClick(this, new RoutedEventArgs());
    internal void HandleToolbarSync() => _ = SyncNowAsync();
    internal void HandleToolbarPreviewToggle(bool preview) => SetPreviewMode(preview);
    internal void HandleToolbarAgentToggle(bool show) => SetAgentPaneVisibility(show);
    internal Task HandleToolbarStopRunningAsync() => StopRunningScriptWithConfirmationAsync();

    private void SetAgentPaneVisibility(bool show)
    {
        AgentPane.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        AgentPaneSplitter.Visibility = show ? Visibility.Visible : Visibility.Collapsed;

        if (show)
        {
            if (AgentColumn.Width.Value <= 0)
            {
                AgentColumn.Width = new GridLength(DefaultAgentPaneWidth);
            }
        }
        else
        {
            AgentColumn.Width = new GridLength(0);
            ProtectedCursor = null;
        }

        if (show)
        {
            _ = BootstrapAgentAsync();
        }
        else
        {
            CancelAgentStream();
        }
    }

    private void OnAgentSplitterPointerEntered(object sender, PointerRoutedEventArgs e)
    {
        if (AgentPane.Visibility != Visibility.Visible)
        {
            return;
        }

        ProtectedCursor = _agentResizeCursor;
    }

    private void OnAgentSplitterPointerExited(object sender, PointerRoutedEventArgs e)
    {
        if (_isResizingAgentPane)
        {
            return;
        }

        ProtectedCursor = null;
    }

    private void OnAgentSplitterPointerPressed(object sender, PointerRoutedEventArgs e)
    {
        if (AgentPane.Visibility != Visibility.Visible)
        {
            return;
        }

        _isResizingAgentPane = true;
        _agentResizeStartX = e.GetCurrentPoint(this).Position.X;
        _agentResizeStartWidth = AgentColumn.ActualWidth > 0 ? AgentColumn.ActualWidth : AgentColumn.Width.Value;

        if (sender is UIElement el)
        {
            el.CapturePointer(e.Pointer);
        }

        e.Handled = true;
    }

    private void OnAgentSplitterPointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (!_isResizingAgentPane)
        {
            return;
        }

        var x = e.GetCurrentPoint(this).Position.X;
        var delta = x - _agentResizeStartX;
        var next = _agentResizeStartWidth - delta;

        // Keep the pane practical: min 280, max 720 (matches desktop intent).
        next = Math.Max(280, Math.Min(720, next));
        AgentColumn.Width = new GridLength(next);

        e.Handled = true;
    }

    private void OnAgentSplitterPointerReleased(object sender, PointerRoutedEventArgs e)
    {
        if (!_isResizingAgentPane)
        {
            return;
        }

        _isResizingAgentPane = false;
        ProtectedCursor = null;
        if (sender is UIElement el)
        {
            el.ReleasePointerCaptures();
        }

        e.Handled = true;
    }

    private async void OnAgentSendClick(object sender, RoutedEventArgs e)
    {
        if (!_agentEnabled)
        {
            SetAgentStatusText(_agentSignedIn
                ? "ELM requires EMWaver Pro. Sending is locked."
                : "Sign in with your EMWaver account to use ELM.");
            return;
        }

        var text = AgentInput.Text?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(text)) return;

        AgentInput.Text = string.Empty;
        SetAgentStatusText("");

        _agentMessages.Add(new AgentMessageRow("You", text));
        ScrollAgentMessagesToBottom();

        // Placeholder row for streaming.
        var placeholder = new AgentMessageRow("ELM", "");
        _agentMessages.Add(placeholder);
        ScrollAgentMessagesToBottom();

        try
        {
            var convoId = _agentConversationId;
            if (string.IsNullOrWhiteSpace(convoId))
            {
                var title = text.Split('\n').FirstOrDefault() ?? "";
                var convo = await AgentApi.CreateConversationAsync(title, CancellationToken.None);
                convoId = convo.Id;
                _agentConversationId = convoId;
                SaveAgentConversationId(convoId);
                await RefreshAgentConversationsAsync();
            }

            var accum = new StringBuilder();

            CancelAgentStream();
            _agentStreamCts = new CancellationTokenSource();

            SetAgentSending(true);

            await AgentApi.ChatStreamWithToolsAsync(convoId!, text, ev =>
            {
                _ = DispatcherQueue.TryEnqueue(() =>
                {
                    switch (ev.Kind)
                    {
                        case EMWaver.Services.Agent.AgentApi.StreamEventKind.Delta:
                            if (!string.IsNullOrEmpty(ev.Text))
                            {
                                accum.Append(ev.Text);
                                ReplaceLastAgentMessage(accum.ToString());
                            }
                            break;

                        case EMWaver.Services.Agent.AgentApi.StreamEventKind.Done:
                            ReplaceLastAgentMessage(ev.DoneMessage?.Content ?? accum.ToString());
                            SetAgentSending(false);
                            break;

                        case EMWaver.Services.Agent.AgentApi.StreamEventKind.Tool:
                            if (!string.IsNullOrWhiteSpace(ev.Text))
                            {
                                _agentMessages.Add(new AgentMessageRow("Tool", ev.Text));
                                ScrollAgentMessagesToBottom();
                            }
                            break;

                        case EMWaver.Services.Agent.AgentApi.StreamEventKind.Error:
                            AgentStatusText.Text = ev.Text;
                            SetAgentSending(false);
                            break;
                    }
                });
            }, _agentStreamCts.Token);
        }
        catch (Exception ex)
        {
            SetAgentStatusText(ex.Message);
            SetAgentSending(false);
        }
    }

    private async void OnRefreshClick(object sender, RoutedEventArgs e)
    {
        await RefreshAsync();
    }

    private async Task BootstrapAgentAsync()
    {
        try
        {
            await RefreshEntitlementsUiAsync(force: true);
            if (!_agentEnabled)
            {
                SetAgentStatusText(_agentSignedIn
                    ? "ELM requires EMWaver Pro. You can read chats and type, but sending is locked."
                    : "Sign in with your EMWaver account to use ELM.");
                return;
            }

            await RefreshAgentConversationsAsync();

            EMWaver.Services.Agent.AgentApi.Conversation? selected = null;
            if (!string.IsNullOrWhiteSpace(_agentConversationId))
            {
                selected = _agentConversations.FirstOrDefault(c => c.Id == _agentConversationId);
            }

            selected ??= _agentConversations.FirstOrDefault();
            if (selected != null)
            {
                AgentConversationsCombo.SelectedItem = selected;
                _agentConversationId = selected.Id;
                SaveAgentConversationId(selected.Id);
                await LoadAgentConversationAsync(selected.Id);
            }
        }
        catch (Exception ex)
        {
            SetAgentStatusText(ex.Message);
        }
    }

    private async Task RefreshAgentConversationsAsync()
    {
        SetAgentStatusText("Loading chats…");
        var list = await AgentApi.ListConversationsAsync(CancellationToken.None);

        await RunOnUiAsync(async () =>
        {
            _agentConversations.Clear();
            foreach (var c in list)
            {
                _agentConversations.Add(c);
            }

            var selected = !string.IsNullOrWhiteSpace(_agentConversationId)
                ? _agentConversations.FirstOrDefault(c => c.Id == _agentConversationId)
                : null;
            selected ??= _agentConversations.FirstOrDefault();
            if (selected != null)
            {
                AgentConversationsCombo.SelectedItem = selected;
            }

            await Task.CompletedTask;
        });
    }

    private async Task LoadAgentConversationAsync(string id)
    {
        SetAgentStatusText("");

        var msgs = await AgentApi.ListMessagesAsync(id, CancellationToken.None);
        await RunOnUiAsync(async () =>
        {
            _agentMessages.Clear();
            foreach (var m in msgs)
            {
                var role = string.Equals(m.Role, "user", StringComparison.OrdinalIgnoreCase) ? "You" : "ELM";
                _agentMessages.Add(new AgentMessageRow(role, m.Content));
            }

            SetAgentStatusText("");
            ScrollAgentMessagesToBottom();
            await Task.CompletedTask;
        });
    }


    private void ScrollAgentMessagesToBottom()
    {
        if (_agentMessages.Count == 0)
        {
            return;
        }

        var last = _agentMessages[_agentMessages.Count - 1];
        _ = DispatcherQueue.TryEnqueue(() =>
        {
            try
            {
                AgentMessagesList.UpdateLayout();
                AgentMessagesList.ScrollIntoView(last);
            }
            catch
            {
                // Best-effort.
            }
        });
    }

    private void ReplaceLastAgentMessage(string text)
    {
        for (var i = _agentMessages.Count - 1; i >= 0; i--)
        {
            if (_agentMessages[i].Role == "ELM")
            {
                _agentMessages[i] = new AgentMessageRow("ELM", text);
                ScrollAgentMessagesToBottom();
                return;
            }
        }
    }

    private void SetAgentSending(bool sending)
    {
        AgentInput.IsEnabled = !sending;
        AgentSendButton.IsEnabled = !sending && _agentEnabled && !string.IsNullOrWhiteSpace(AgentInput.Text?.Trim());
        AgentThinkingRow.Visibility = sending ? Visibility.Visible : Visibility.Collapsed;
    }

    private async Task RefreshEntitlementsUiAsync(bool force)
    {
        try
        {
            var snap = await AppServices.Entitlements.RefreshAsync(force: force, CancellationToken.None);
            _agentSignedIn = AppServices.CloudAuth.IsSignedIn;
            var agentFeatureEnabled = snap.Entitlements?.FeatureFlags.Agent ?? false;
            _agentEnabled = _agentSignedIn && (agentFeatureEnabled || snap.IsPro);
            _cloudSyncEnabled = snap.Entitlements?.FeatureFlags.CloudFiles ?? false;

            await RunOnUiAsync(async () =>
            {
                AgentSignInNotice.Visibility = _agentSignedIn ? Visibility.Collapsed : Visibility.Visible;
                AgentProNotice.Visibility = (!_agentSignedIn || _agentEnabled) ? Visibility.Collapsed : Visibility.Visible;
                AgentSendButton.IsEnabled = _agentEnabled && !string.IsNullOrWhiteSpace(AgentInput.Text?.Trim());
                AgentInput.IsEnabled = _agentEnabled;
                await Task.CompletedTask;
            });
        }
        catch
        {
            // Best-effort.
        }
    }

    private void SetAgentStatusText(string text)
    {
        if (DispatcherQueue.HasThreadAccess)
        {
            AgentStatusText.Text = text;
            return;
        }

        _ = DispatcherQueue.TryEnqueue(() => AgentStatusText.Text = text);
    }

    private async void OnGetProClick(object sender, RoutedEventArgs e)
    {
        try
        {
            var url = FrontendUrl.Resolve().TrimEnd('/') + "/pro";
            await WindowsLauncher.LaunchUriAsync(new Uri(url));
        }
        catch (Exception ex)
        {
            SetAgentStatusText(ex.Message);
        }
    }

    private void OnAgentSignInClick(object sender, RoutedEventArgs e)
    {
        try
        {
            Frame.Navigate(typeof(SettingsPage));
        }
        catch (Exception ex)
        {
            SetAgentStatusText(ex.Message);
        }
    }

    private void CancelAgentStream()
    {
        try { _agentStreamCts?.Cancel(); } catch { }
        try { _agentStreamCts?.Dispose(); } catch { }
        _agentStreamCts = null;
    }

    private static string? LoadAgentConversationId()
    {
        try
        {
            var v = ApplicationData.Current.LocalSettings.Values["emwaver.agent.conversationId"] as string;
            v = (v ?? "").Trim();
            return string.IsNullOrWhiteSpace(v) ? null : v;
        }
        catch { return null; }
    }

    private static void SaveAgentConversationId(string? id)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(id))
            {
                ApplicationData.Current.LocalSettings.Values.Remove("emwaver.agent.conversationId");
            }
            else
            {
                ApplicationData.Current.LocalSettings.Values["emwaver.agent.conversationId"] = id.Trim();
            }
        }
        catch { }
    }

    private void OnAgentNewChatClick(object sender, RoutedEventArgs e)
    {
        _agentConversationId = null;
        SaveAgentConversationId(null);
        _agentMessages.Clear();
        SetAgentStatusText("");
        AgentConversationsCombo.SelectedItem = null;
    }

    private void OnAgentClearClick(object sender, RoutedEventArgs e)
    {
        _agentMessages.Clear();
        SetAgentStatusText("");
    }

    private void OnAgentInputTextChanged(object sender, TextChangedEventArgs e)
    {
        AgentSendButton.IsEnabled = _agentEnabled && !string.IsNullOrWhiteSpace(AgentInput.Text?.Trim());
    }

    private async void OnAgentConversationChanged(object sender, SelectionChangedEventArgs e)
    {
        if (AgentConversationsCombo.SelectedItem is not EMWaver.Services.Agent.AgentApi.Conversation c) return;

        _agentConversationId = c.Id;
        SaveAgentConversationId(c.Id);

        try { await LoadAgentConversationAsync(c.Id); }
        catch (Exception ex) { SetAgentStatusText(ex.Message); }
    }

    private bool _syncInProgress;
    private ContentDialog? _syncDialog;
    private ProgressBar? _syncProgress;
    private TextBlock? _syncStatus;
    private TextBlock? _syncCounts;
    private CancellationTokenSource? _syncCts;

    private sealed record SyncUiProgressState(string Status, int Processed, int Total, int Uploaded, int Downloaded);

    private async Task ShowSyncProgressAsync(string status)
    {
        await ShowSyncProgressAsync(new SyncUiProgressState(status, 0, 0, 0, 0));
    }

    private async Task ShowSyncProgressAsync(SyncUiProgressState state)
    {
        await RunOnUiAsync(async () =>
        {
            if (_syncDialog == null)
            {
                _syncProgress = new ProgressBar
                {
                    IsIndeterminate = false,
                    Height = 6,
                    MinWidth = 260,
                    Minimum = 0,
                    Maximum = 1,
                    Value = 0,
                };

                _syncStatus = new TextBlock
                {
                    Text = state.Status,
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(0, 10, 0, 0),
                };

                _syncCounts = new TextBlock
                {
                    Text = "Processed 0/0 • Uploads 0 • Downloads 0",
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(0, 6, 0, 0),
                    Foreground = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["TextFillColorSecondaryBrush"],
                };

                var panel = new StackPanel();
                panel.Children.Add(_syncProgress);
                panel.Children.Add(_syncStatus);
                panel.Children.Add(_syncCounts);

                _syncDialog = new ContentDialog
                {
                    XamlRoot = XamlRoot,
                    Title = "Sync",
                    Content = panel,
                    PrimaryButtonText = string.Empty,
                    CloseButtonText = "Cancel",
                    DefaultButton = ContentDialogButton.None,
                };

                _syncDialog.CloseButtonClick += (_, __) =>
                {
                    try { _syncCts?.Cancel(); }
                    catch { }
                };

                // ShowAsync is modeless-ish; we don't await it so sync can run.
                _ = _syncDialog.ShowAsync();
            }

            if (_syncStatus != null) _syncStatus.Text = state.Status;
            if (_syncProgress != null)
            {
                if (state.Total > 0)
                {
                    _syncProgress.Maximum = state.Total;
                    _syncProgress.Value = Math.Min(state.Processed, state.Total);
                }
                else
                {
                    _syncProgress.Maximum = 1;
                    _syncProgress.Value = 0;
                }
            }
            if (_syncCounts != null)
            {
                _syncCounts.Text = $"Processed {state.Processed}/{state.Total} • Uploads {state.Uploaded} • Downloads {state.Downloaded}";
            }

            await Task.CompletedTask;
        });
    }

    private async Task HideSyncProgressAsync()
    {
        await RunOnUiAsync(async () =>
        {
            try { _syncDialog?.Hide(); }
            catch { }
            _syncDialog = null;
            _syncProgress = null;
            _syncStatus = null;
            _syncCounts = null;
            await Task.CompletedTask;
        });
    }

    private static string ProgressActionLabel(CloudSyncProgressAction action)
    {
        return action switch
        {
            CloudSyncProgressAction.Uploading => "Uploading",
            CloudSyncProgressAction.Downloading => "Downloading",
            CloudSyncProgressAction.Skipped => "Skipping",
            _ => "Scanning",
        };
    }

    private async Task SyncNowAsync()
    {
        System.Diagnostics.Debug.WriteLine("[EMWaver][Windows][Sync] SyncNowAsync invoked");

        if (_syncInProgress)
        {
            System.Diagnostics.Debug.WriteLine("[EMWaver][Windows][Sync] already in progress");
            return;
        }

        _syncInProgress = true;
        try
        {
            await ShowSyncProgressAsync("Preparing sync…");
            var allowAnonSync = (Environment.GetEnvironmentVariable("EMWAVER_ALLOW_ANON_SYNC") ?? "") == "1";

            await RefreshEntitlementsUiAsync(force: false);
            if (!_cloudSyncEnabled && !allowAnonSync)
            {
                await HideSyncProgressAsync();
                await ShowInfoAsync("Sync", "Cloud sync is available with EMWaver Pro. Upgrade to sync scripts and signals across devices.");
                return;
            }

            var baseRaw = (AppServices.CloudConfig.BackendBaseUrl ?? "").Trim();
            if (string.IsNullOrWhiteSpace(baseRaw) || !Uri.TryCreate(baseRaw, UriKind.Absolute, out var baseUrl))
            {
                await ShowInfoAsync("Sync", "Backend URL is not configured (Settings → Backend).");
                return;
            }

            string accessToken;
            if (AppServices.CloudAuth.IsSignedIn)
            {
                var cts = new CancellationTokenSource(TimeSpan.FromMinutes(3));
                accessToken = await AppServices.CloudAuth.EnsureSignedInAsync(cts.Token);
            }
            else if (allowAnonSync)
            {
                accessToken = "";
            }
            else
            {
                await ShowInfoAsync("Sync", "Sign in first (Settings → Sign In) to sync with cloud.");
                return;
            }

            // Scripts live in LocalAppData/EMWaver/Scripts (ScriptRepository)
            var scriptsDir = AppServices.Scripts.LocalScriptsDir;

            // Signals live in LocalAppData/EMWaver/Signals (parity with Apple signals dir concept).
            var signalsDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "EMWaver",
                "Signals"
            );

            var engine = new CloudSyncEngine(AppServices.CloudFiles);
            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromMinutes(10));
            using var userCts = new CancellationTokenSource();
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(timeoutCts.Token, userCts.Token);
            _syncCts = userCts;

            var aggregateUploaded = 0;
            var aggregateDownloaded = 0;

            IProgress<CloudSyncProgress> MakePhaseProgress(string phaseLabel)
            {
                return new Progress<CloudSyncProgress>(p =>
                {
                    var action = ProgressActionLabel(p.Action);
                    var status = $"{phaseLabel}: {action} {p.Name}";
                    _ = ShowSyncProgressAsync(new SyncUiProgressState(
                        status,
                        p.Processed,
                        p.Total,
                        aggregateUploaded + p.Uploaded,
                        aggregateDownloaded + p.Downloaded));
                });
            }

            System.Diagnostics.Debug.WriteLine($"[EMWaver][Windows][Sync] baseUrl={baseUrl} token={(string.IsNullOrWhiteSpace(accessToken) ? "<empty>" : "<present>")}");
            System.Diagnostics.Debug.WriteLine($"[EMWaver][Windows][Sync] scriptsDir={scriptsDir}");

            await ShowSyncProgressAsync("Syncing scripts…");
            var s1 = await engine.SyncAsync(
                baseUrl: baseUrl,
                accessToken: accessToken,
                storageDir: scriptsDir,
                kinds: new[]
                {
                    new CloudSyncEngine.FileKindSpec(Kind: "script", Ext: ".emw", ContentType: "text/plain"),
                },
                policy: CloudSyncPolicy.PreferLocal,
                ct: linkedCts.Token,
                progress: MakePhaseProgress("Scripts")
            );
            aggregateUploaded += s1.Uploaded;
            aggregateDownloaded += s1.Downloaded;

            await ShowSyncProgressAsync("Syncing signals…");
            var s2 = await engine.SyncAsync(
                baseUrl: baseUrl,
                accessToken: accessToken,
                storageDir: signalsDir,
                kinds: new[]
                {
                    new CloudSyncEngine.FileKindSpec(Kind: "signal_raw", Ext: ".raw", ContentType: "application/octet-stream"),
                    new CloudSyncEngine.FileKindSpec(Kind: "signal_text", Ext: ".txt", ContentType: "text/plain"),
                },
                policy: CloudSyncPolicy.PreferLocal,
                ct: linkedCts.Token,
                progress: MakePhaseProgress("Signals")
            );

            var total = s1.Add(s2);
            await RefreshAsync(selectFullPath: _current?.FullPath);

            await HideSyncProgressAsync();
            await ShowInfoAsync(
                "Sync complete",
                $"Uploaded: {total.Uploaded}, Downloaded: {total.Downloaded}, Conflicts: {total.Conflicts}"
            );
        }
        catch (OperationCanceledException)
        {
            System.Diagnostics.Debug.WriteLine("[EMWaver][Windows][Sync] canceled by user or timeout");
            await HideSyncProgressAsync();
            await ShowInfoAsync("Sync", "Sync canceled.");
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine("[EMWaver][Windows][Sync] failed: " + ex);
            await HideSyncProgressAsync();
            await ShowInfoAsync("Sync", ex.Message);
        }
        finally
        {
            try { _syncCts?.Dispose(); } catch { }
            _syncCts = null;
            await HideSyncProgressAsync();
            _syncInProgress = false;
        }
    }

    private void OnMakeCopyBannerClick(object sender, RoutedEventArgs e)
    {
        // Same behavior as the toolbar copy action.
        OnMakeCopyClick(sender, e);
    }

    private async void OnNewClick(object sender, RoutedEventArgs e)
    {
        var name = await PromptForNameAsync(
            title: "New Script",
            message: "Enter a name for the new script.",
            initialValue: "script_script.emw"
        );

        if (string.IsNullOrWhiteSpace(name))
        {
            return;
        }

        try
        {
            var template = "// New EMWaver script\n\nUI.render(\n  UI.column({\n    padding: 16,\n    spacing: 12,\n    children: [\n      UI.text({ text: \"hello\" }),\n    ],\n  })\n);\n";
            var created = await AppServices.Scripts.CreateLocalScriptAsync(name, content: template);
            await RefreshAsync(selectFullPath: created.FullPath);
        }
        catch (Exception ex)
        {
            await ShowInfoAsync("New Script", ex.Message);
        }
    }

    private async void OnSaveClick(object sender, RoutedEventArgs e)
    {
        if (_current == null || _current.IsBundled)
        {
            return;
        }

        try
        {
            var currentText = GetEditorTextNormalized();
            await AppServices.Scripts.SaveScriptTextAsync(_current, currentText);
            _loadedTextNormalized = currentText;
            _isDirty = false;
            UpdateCommandStates();
        }
        catch (Exception ex)
        {
            await ShowInfoAsync("Save", ex.Message);
        }
    }

    private async void OnRenameClick(object sender, RoutedEventArgs e)
    {
        if (_current == null || _current.IsBundled)
        {
            return;
        }

        var initial = _current.Name + ".emw";
        var name = await PromptForNameAsync(
            title: "Rename Script",
            message: "Enter a new name.",
            initialValue: initial
        );

        if (string.IsNullOrWhiteSpace(name))
        {
            return;
        }

        try
        {
            var renamed = await AppServices.Scripts.RenameLocalScriptAsync(_current, name);
            await RefreshAsync(selectFullPath: renamed.FullPath);
        }
        catch (Exception ex)
        {
            await ShowInfoAsync("Rename", ex.Message);
        }
    }

    private async void OnMakeCopyClick(object sender, RoutedEventArgs e)
    {
        if (_current == null)
        {
            return;
        }

        var initial = _current.Name + "_copy.emw";
        var name = await PromptForNameAsync(
            title: "Copy Script",
            message: "Enter a name for the copy.",
            initialValue: initial
        );

        if (string.IsNullOrWhiteSpace(name))
        {
            return;
        }

        try
        {
            var copied = await AppServices.Scripts.CopyToLocalAsync(_current, name);
            await RefreshAsync(selectFullPath: copied.FullPath);
        }
        catch (Exception ex)
        {
            await ShowInfoAsync("Copy", ex.Message);
        }
    }

    private async void OnDeleteClick(object sender, RoutedEventArgs e)
    {
        if (_currentSignal != null)
        {
            var okSignal = await ConfirmAsync(
                title: "Delete signal?",
                message: $"Delete '{_currentSignal.FileName}'?",
                primaryButtonText: "Delete",
                closeButtonText: "Cancel"
            );

            if (!okSignal)
            {
                return;
            }

            try
            {
                if (File.Exists(_currentSignal.FullPath))
                {
                    File.Delete(_currentSignal.FullPath);
                }

                _currentSignal = null;
                _current = null;
                _isDirty = false;
                await RefreshAsync();
            }
            catch (Exception ex)
            {
                await ShowInfoAsync("Delete", ex.Message);
            }

            return;
        }

        if (_current == null || _current.IsBundled)
        {
            return;
        }

        var ok = await ConfirmAsync(
            title: "Delete script?",
            message: $"Delete '{_current.Name}'?",
            primaryButtonText: "Delete",
            closeButtonText: "Cancel"
        );

        if (!ok)
        {
            return;
        }

        try
        {
            await AppServices.Scripts.DeleteLocalScriptAsync(_current);
            await RefreshAsync();
        }
        catch (Exception ex)
        {
            await ShowInfoAsync("Delete", ex.Message);
        }
    }

    private async Task StopRunningScriptWithConfirmationAsync()
    {
        if (!_hasActiveRunningScript)
        {
            return;
        }

        var runningName = string.IsNullOrWhiteSpace(_activeRunningScriptName) ? "script" : _activeRunningScriptName;
        var stopOk = await ConfirmAsync(
            title: "Stop running script?",
            message: $"Stop '{runningName}'?",
            primaryButtonText: "Stop",
            closeButtonText: "Cancel"
        );

        if (!stopOk)
        {
            return;
        }

        _scriptEngine.Stop();
        SetRunningScriptState(false, null);

        await RunOnUiAsync(async () =>
        {
            try
            {
                PreviewHost.Children.Clear();
                PreviewHint.Visibility = Visibility.Visible;
            }
            catch { }

            await Task.CompletedTask;
        });
    }

    private async void OnRunClick(object sender, RoutedEventArgs e)
    {
        if (_current == null)
        {
            return;
        }

        System.Diagnostics.Debug.WriteLine($"[EMWaver][Windows][Scripts] Run clicked script={_current.Name} bundled={_current.IsBundled}");

        var nextScriptName = _current.Name;
        if (_hasActiveRunningScript &&
            !string.IsNullOrWhiteSpace(_activeRunningScriptName) &&
            !string.Equals(_activeRunningScriptName, nextScriptName, StringComparison.Ordinal))
        {
            var stopOk = await ConfirmAsync(
                title: "Stop running script?",
                message: $"'{_activeRunningScriptName}' is currently running. Stop it and run '{nextScriptName}'?",
                primaryButtonText: "Stop and Run",
                closeButtonText: "Cancel"
            );

            if (!stopOk)
            {
                SetPreviewMode(false);
                return;
            }

            _scriptEngine.Stop();
            SetRunningScriptState(false, null);
        }

        // Switch to preview mode on Run.
        SetPreviewMode(true);

        // Start a new render generation (cancels any previous preview run output).
        _renderGeneration++;
        _activeRenderGeneration = _renderGeneration;

        // Clear preview host before running.
        try
        {
            PreviewHost.Children.Clear();
            PreviewHint.Visibility = Visibility.Visible;
        }
        catch { }

        // Run the current editor buffer (even if dirty) so iteration is fast.
        var text = GetEditorTextNormalized();
        await Task.CompletedTask;

        SetRunningScriptState(true, nextScriptName);
        _scriptEngine.Execute(text);
    }

    private Task RunOnUiAsync(Func<Task> action)
    {
        if (DispatcherQueue.HasThreadAccess)
        {
            return action();
        }

        var tcs = new TaskCompletionSource<object?>(TaskCreationOptions.RunContinuationsAsynchronously);
        _ = DispatcherQueue.TryEnqueue(async () =>
        {
            try
            {
                await action();
                tcs.TrySetResult(null);
            }
            catch (Exception ex)
            {
                tcs.TrySetException(ex);
            }
        });
        return tcs.Task;
    }

    private Task SwitchToUiAsync()
    {
        return RunOnUiAsync(static () => Task.CompletedTask);
    }

    private async Task<bool> ConfirmAsync(string title, string message, string primaryButtonText, string closeButtonText)
    {
        var dialog = new ContentDialog
        {
            Title = title,
            Content = message,
            PrimaryButtonText = primaryButtonText,
            CloseButtonText = closeButtonText,
            XamlRoot = XamlRoot
        };

        var result = await dialog.ShowAsync();
        return result == ContentDialogResult.Primary;
    }

    private readonly SemaphoreSlim _infoDialogLock = new(1, 1);

    private async Task ShowInfoAsync(string title, string message)
    {
        await _infoDialogLock.WaitAsync();
        try
        {
            var dialog = new ContentDialog
            {
                Title = title,
                Content = message,
                CloseButtonText = "OK",
                XamlRoot = XamlRoot
            };

            await dialog.ShowAsync();
        }
        catch (COMException)
        {
            // Ignore; WinUI can throw during transitions or if another dialog is up.
        }
        finally
        {
            _infoDialogLock.Release();
        }
    }

    private async Task ShowScriptErrorAsync(string message)
    {
        await _infoDialogLock.WaitAsync();
        try
        {
            var text = string.IsNullOrWhiteSpace(message) ? "Unknown script error." : message.Trim();

            var panel = new StackPanel { Spacing = 8 };
            panel.Children.Add(new TextBlock
            {
                Text = "The script failed. Full details are below (including line/location when available).",
                TextWrapping = TextWrapping.Wrap,
            });

            panel.Children.Add(new TextBox
            {
                Text = text,
                IsReadOnly = true,
                AcceptsReturn = true,
                TextWrapping = TextWrapping.Wrap,
                FontFamily = new Microsoft.UI.Xaml.Media.FontFamily("Consolas"),
                MinWidth = 720,
                Height = 340,
            });

            var dialog = new ContentDialog
            {
                Title = "Script Error",
                Content = panel,
                PrimaryButtonText = "Copy",
                CloseButtonText = "Close",
                DefaultButton = ContentDialogButton.Close,
                XamlRoot = XamlRoot,
            };

            var result = await dialog.ShowAsync();
            if (result == ContentDialogResult.Primary)
            {
                var package = new DataPackage();
                package.SetText(text);
                Clipboard.SetContent(package);
            }
        }
        catch (COMException)
        {
            // Ignore; WinUI can throw during transitions or if another dialog is up.
        }
        finally
        {
            _infoDialogLock.Release();
        }
    }

    private async Task<string?> PromptForNameAsync(string title, string message, string initialValue)
    {
        var box = new TextBox
        {
            Text = initialValue,
            PlaceholderText = "name.emw",
            Width = 320
        };

        var panel = new StackPanel { Spacing = 8 };
        panel.Children.Add(new TextBlock { Text = message });
        panel.Children.Add(box);

        var dialog = new ContentDialog
        {
            Title = title,
            Content = panel,
            PrimaryButtonText = "OK",
            CloseButtonText = "Cancel",
            XamlRoot = XamlRoot
        };

        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary)
        {
            return null;
        }

        return box.Text;
    }
}
