using EMWaver.Models;
using EMWaver.Scripting;
using EMWaver.Scripting.Render;
using EMWaver.Services;
using EMWaver.Services.Cloud;
using System.IO;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.InteropServices;

namespace EMWaver.Pages;

public sealed partial class ScriptsPage : Page
{
    public event Action<bool>? PreviewModeChanged;

    protected override async void OnNavigatedTo(Microsoft.UI.Xaml.Navigation.NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);

        var next = AppServices.Settings.EditorMode;
        Debug.WriteLine($"[EMWaver][Windows][Editor] OnNavigatedTo mode(setting)={next} prev={_editorMode}");

        if (next != _editorMode)
        {
            _editorMode = next;
            ApplyEditorMode();
        }

        Debug.WriteLine($"[EMWaver][Windows][Editor] ApplyEditorMode visible code={RichEditor?.Visibility} simple={EditorBox?.Visibility}");

        if (_editorMode == EditorMode.Code)
        {
            EnsureHighlightTimer();
            ScheduleHighlight();
        }
    }

    private readonly ObservableCollection<Models.ScriptListSection> _sections = new();
    private readonly ObservableCollection<string> _agentMessages = new();

    private ScriptInfo? _current;
    private Models.SignalFileInfo? _currentSignal;
    private string _loadedTextNormalized = string.Empty;
    private bool _isDirty;
    private bool _suppressSelectionChange;
    private bool _suppressEditorChanged;

    private EditorMode _editorMode;

    // Code editor state (RichEditBox)
    private bool _suppressRichChanged;
    private string _richTextCache = string.Empty;
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _highlightTimer;

    private readonly ScriptEngine _scriptEngine = new();
    private readonly ScriptRenderer _scriptRenderer;

    public event Action<ScriptToolbarState>? ToolbarStateChanged;
    public ScriptToolbarState CurrentToolbarState { get; private set; } = new(false, false, false);

    public ScriptsPage()
    {
        InitializeComponent();

        // Grouped list (Examples / Your Scripts / Signals)
        var cvs = new Microsoft.UI.Xaml.Data.CollectionViewSource
        {
            IsSourceGrouped = true,
            Source = _sections,
            ItemsPath = new Microsoft.UI.Xaml.PropertyPath("Items"),
        };
        ScriptsList.ItemsSource = cvs.View;

        AgentMessagesList.ItemsSource = _agentMessages;

        _editorMode = AppServices.Settings.EditorMode;
        AppServices.Settings.Changed += OnSettingsChanged;

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
                    if (_isPreviewMode && gen == _activeRenderGeneration)
                    {
                        RenderPreview(tree);
                    }
                });
            },
            sendPacket: (bytes, timeoutMs) => AppServices.Device.SendPacket(bytes, timeoutMs),
            errorHandler: message =>
            {
                _ = DispatcherQueue.TryEnqueue(async () => await ShowInfoAsync("Script Error", message));
            }
        );

        Loaded += OnLoaded;

        // Default: editor-first.
        SetPreviewMode(false);

        ApplyEditorMode();

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

        if (_editorMode == EditorMode.Code)
        {
            EnsureHighlightTimer();
            ScheduleHighlight();
        }

        await RefreshAsync();
    }

    private void OnSettingsChanged()
    {
        _ = DispatcherQueue.TryEnqueue(async () =>
        {
            var next = AppServices.Settings.EditorMode;
            if (next == _editorMode)
            {
                return;
            }

            // Moving between editors: capture latest buffer so the next editor has the same text.
            var currentText = GetEditorTextNormalized();

            _editorMode = next;
            ApplyEditorMode();

            if (_editorMode == EditorMode.Simple)
            {
                _suppressEditorChanged = true;
                try { EditorBox.Text = currentText; }
                finally { _suppressEditorChanged = false; }
            }
            else // Code editor
            {
                SetRichEditorText(currentText);
                EnsureHighlightTimer();
                ScheduleHighlight();
            }

            // Re-evaluate dirty state (buffer may have moved between controls).
            var now = GetEditorTextNormalized();
            _isDirty = !string.Equals(now, _loadedTextNormalized, StringComparison.Ordinal);
            UpdateCommandStates();
        });
    }

    private void ApplyEditorMode()
    {
        if (RichEditor == null || EditorBox == null)
        {
            Debug.WriteLine("[EMWaver][Windows][Editor] ApplyEditorMode: controls not ready");
            return;
        }

        RichEditor.Visibility = _editorMode == EditorMode.Code ? Visibility.Visible : Visibility.Collapsed;
        EditorBox.Visibility = _editorMode == EditorMode.Simple ? Visibility.Visible : Visibility.Collapsed;

        // When switching into code mode, apply highlight once (helps read-only/bundled scripts).
        if (_editorMode == EditorMode.Code && _current != null)
        {
            EnsureHighlightTimer();
            ScheduleHighlight();
            ApplyHighlightingSafe();
        }

        Debug.WriteLine($"[EMWaver][Windows][Editor] ApplyEditorMode: mode={_editorMode} => code={RichEditor.Visibility} simple={EditorBox.Visibility}");
    }

    // Monaco/WebView2 removed on Windows (unstable and non-native).

    private async Task RefreshAsync(string? selectFullPath = null)
    {
        try
        {
            await AppServices.Scripts.EnsureBootstrappedAsync();
            var scripts = await AppServices.Scripts.ListScriptsAsync();

            // Signals directory (synced)
            var signalsDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "EMWaver",
                "Signals"
            );

            var signals = new List<Models.SignalFileInfo>();
            try
            {
                if (Directory.Exists(signalsDir))
                {
                    foreach (var p in Directory.EnumerateFiles(signalsDir, "*", SearchOption.TopDirectoryOnly))
                    {
                        var ext = Path.GetExtension(p) ?? "";
                        if (!string.Equals(ext, ".raw", StringComparison.OrdinalIgnoreCase) &&
                            !string.Equals(ext, ".txt", StringComparison.OrdinalIgnoreCase))
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
            _suppressEditorChanged = false;

            // NOTE: setting RichEditBox.Document text can throw if IsReadOnly is true.
            // Set read-only after we load text.

            // Code editor state
            SetRichEditorText(text ?? string.Empty);
            RichEditor.IsReadOnly = script.IsBundled;
            EnsureHighlightTimer();
            ScheduleHighlight();
            ApplyHighlightingSafe();

            // Always start in editor mode when opening a script.
            SetPreviewMode(false);

            EmptyHint.Visibility = Visibility.Collapsed;
            ReadOnlyBanner.Visibility = script.IsBundled ? Visibility.Visible : Visibility.Collapsed;

            PreviewHost.Children.Clear();
            PreviewHint.Visibility = Visibility.Visible;

            UpdateCommandStates();

            // Improve UX: focus the active editor automatically when a script is opened.
            _ = DispatcherQueue.TryEnqueue(() =>
            {
                try
                {
                    if (_editorMode == EditorMode.Code)
                    {
                        RichEditor.Focus(FocusState.Programmatic);
                    }
                    else
                    {
                        EditorBox.Focus(FocusState.Programmatic);
                    }
                }
                catch { }
            });

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
                text = "(Binary signal .raw)";
            }
            else
            {
                text = await File.ReadAllTextAsync(sig.FullPath);
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
            _suppressEditorChanged = false;

            SetRichEditorText(text);
            RichEditor.IsReadOnly = true;

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
            _suppressEditorChanged = false;

            SetRichEditorText(string.Empty);
            RichEditor.IsReadOnly = true;

            EmptyHint.Visibility = Visibility.Visible;
            ReadOnlyBanner.Visibility = Visibility.Collapsed;

            PreviewHost.Children.Clear();
            PreviewHint.Visibility = Visibility.Visible;

            UpdateCommandStates();
            await Task.CompletedTask;
        });
    }

    private void OnEditorTextChanged(object sender, RoutedEventArgs e)
    {
        if (_suppressEditorChanged || _editorMode != EditorMode.Simple)
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
        var raw = _editorMode switch
        {
            // Always read the document; RichEdit normalizes line endings and may differ from our last cache.
            EditorMode.Code => GetRichEditorText(),
            _ => (EditorBox.Text ?? string.Empty),
        };
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

            // Re-apply highlighting when returning from preview.
            // (RichEdit can lose formatting when hidden/collapsed by the layout.)
            if (_editorMode == EditorMode.Code && _current != null)
            {
                try { _highlightTimer?.Stop(); } catch { }
                ApplyHighlightingSafe();
            }

            // When returning to code view, make the editor immediately interactive.
            _ = DispatcherQueue.TryEnqueue(() =>
            {
                try
                {
                    if (_editorMode == EditorMode.Code)
                    {
                        RichEditor.Focus(FocusState.Programmatic);
                    }
                    else
                    {
                        EditorBox.Focus(FocusState.Programmatic);
                    }
                }
                catch { }
            });
        }

        PreviewModeChanged?.Invoke(preview);
    }

    private void RenderPreview(ScriptTree tree)
    {
        System.Diagnostics.Debug.WriteLine($"[EMWaver][Windows][Preview] RenderPreview rootType={tree?.Root.Type}");

        if (!_isPreviewMode)
        {
            return;
        }

        PreviewHost.Children.Clear();
        PreviewHost.Children.Add(_scriptRenderer.Render(tree));
        PreviewHint.Visibility = Visibility.Collapsed;
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

    private void SetAgentPaneVisibility(bool show)
    {
        AgentPane.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        AgentColumn.Width = show ? new GridLength(380) : new GridLength(0);
    }

    private void OnAgentSendClick(object sender, RoutedEventArgs e)
    {
        var text = AgentInput.Text?.Trim();
        if (string.IsNullOrWhiteSpace(text)) return;

        _agentMessages.Add("You: " + text);
        _agentMessages.Add("Agent: (not wired up on Windows yet)");
        AgentInput.Text = string.Empty;
    }

    private async void OnRefreshClick(object sender, RoutedEventArgs e)
    {
        await RefreshAsync();
    }

    private bool _syncInProgress;
    private ContentDialog? _syncDialog;
    private ProgressBar? _syncProgress;
    private TextBlock? _syncStatus;

    private async Task ShowSyncProgressAsync(string status)
    {
        await RunOnUiAsync(async () =>
        {
            if (_syncDialog == null)
            {
                _syncProgress = new ProgressBar
                {
                    IsIndeterminate = true,
                    Height = 6,
                    MinWidth = 260,
                };

                _syncStatus = new TextBlock
                {
                    Text = status,
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(0, 10, 0, 0),
                };

                var panel = new StackPanel();
                panel.Children.Add(_syncProgress);
                panel.Children.Add(_syncStatus);

                _syncDialog = new ContentDialog
                {
                    XamlRoot = XamlRoot,
                    Title = "Sync",
                    Content = panel,
                    PrimaryButtonText = string.Empty,
                    CloseButtonText = string.Empty,
                    DefaultButton = ContentDialogButton.None,
                };

                // ShowAsync is modeless-ish; we don't await it so sync can run.
                _ = _syncDialog.ShowAsync();
            }

            if (_syncStatus != null)
            {
                _syncStatus.Text = status;
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
            await Task.CompletedTask;
        });
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

            var baseRaw = (AppServices.CloudConfig.BackendBaseUrl ?? "").Trim();
            if (string.IsNullOrWhiteSpace(baseRaw) || !Uri.TryCreate(baseRaw, UriKind.Absolute, out var baseUrl))
            {
                await ShowInfoAsync("Sync", "Backend URL is not configured (EMWAVER_BACKEND_URL).");
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
            var cts2 = new CancellationTokenSource(TimeSpan.FromMinutes(10));

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
                ct: cts2.Token
            );

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
                ct: cts2.Token
            );

            var total = s1.Add(s2);
            await RefreshAsync(selectFullPath: _current?.FullPath);

            await HideSyncProgressAsync();
            await ShowInfoAsync(
                "Sync complete",
                $"Uploaded: {total.Uploaded}, Downloaded: {total.Downloaded}, Conflicts: {total.Conflicts}"
            );
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine("[EMWaver][Windows][Sync] failed: " + ex);
            await HideSyncProgressAsync();
            await ShowInfoAsync("Sync", ex.Message);
        }
        finally
        {
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

    private async void OnRunClick(object sender, RoutedEventArgs e)
    {
        if (_current == null)
        {
            return;
        }

        System.Diagnostics.Debug.WriteLine($"[EMWaver][Windows][Scripts] Run clicked script={_current.Name} bundled={_current.IsBundled}");

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
