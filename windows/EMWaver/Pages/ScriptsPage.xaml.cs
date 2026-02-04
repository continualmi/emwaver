using EMWaver.Models;
using EMWaver.Scripting;
using EMWaver.Scripting.Render;
using EMWaver.Services;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EMWaver.Pages;

public sealed partial class ScriptsPage : Page
{
    private readonly ObservableCollection<ScriptInfo> _scripts = new();
    private readonly ObservableCollection<string> _agentMessages = new();

    private ScriptInfo? _current;
    private string _loadedTextNormalized = string.Empty;
    private bool _isDirty;
    private bool _suppressSelectionChange;
    private bool _suppressEditorChanged;

    // Monaco editor state (WebView2)
    private bool _useMonaco;
    private bool _monacoReady;
    private string _monacoTextCache = string.Empty;
    private string _pendingMonacoText = string.Empty;
    private bool _pendingMonacoReadOnly;

    private readonly ScriptEngine _scriptEngine = new();
    private readonly ScriptRenderer _scriptRenderer;

    public event Action<ScriptToolbarState>? ToolbarStateChanged;
    public ScriptToolbarState CurrentToolbarState { get; private set; } = new(false, false, false);

    public ScriptsPage()
    {
        InitializeComponent();

        ScriptsList.ItemsSource = _scripts;
        AgentMessagesList.ItemsSource = _agentMessages;

        _useMonaco = AppServices.Settings.UseMonacoEditor;
        AppServices.Settings.Changed += OnSettingsChanged;

        _scriptRenderer = new ScriptRenderer((token, args) =>
        {
            _scriptEngine.Invoke(token, args);
        });

        _scriptEngine.Setup(
            renderHandler: tree =>
            {
                _ = DispatcherQueue.TryEnqueue(() => RenderPreview(tree));
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
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;

        if (_useMonaco)
        {
            await EnsureMonacoInitializedAsync();
        }

        await RefreshAsync();
    }

    private void OnSettingsChanged()
    {
        _ = DispatcherQueue.TryEnqueue(async () =>
        {
            var next = AppServices.Settings.UseMonacoEditor;
            if (next == _useMonaco)
            {
                return;
            }

            // If we're turning Monaco off, capture the latest buffer so the simple editor matches.
            if (!next)
            {
                _suppressEditorChanged = true;
                try
                {
                    EditorBox.Text = _monacoTextCache;
                }
                finally
                {
                    _suppressEditorChanged = false;
                }
            }
            else
            {
                await EnsureMonacoInitializedAsync();
            }

            _useMonaco = next;
            ApplyEditorMode();

            // Re-evaluate dirty state (buffer may have moved between controls).
            var now = GetEditorTextNormalized();
            _isDirty = !string.Equals(now, _loadedTextNormalized, StringComparison.Ordinal);
            UpdateCommandStates();
        });
    }

    private void ApplyEditorMode()
    {
        if (MonacoView == null || EditorBox == null)
        {
            return;
        }

        MonacoView.Visibility = _useMonaco ? Visibility.Visible : Visibility.Collapsed;
        EditorBox.Visibility = _useMonaco ? Visibility.Collapsed : Visibility.Visible;
    }

    private async Task EnsureMonacoInitializedAsync()
    {
        if (_monacoReady)
        {
            return;
        }

        // WebView2 needs to be loaded/initialized before navigation.
        try
        {
            MonacoView.WebMessageReceived -= OnMonacoWebMessage;
            MonacoView.WebMessageReceived += OnMonacoWebMessage;

            MonacoView.Source = new Uri("ms-appx-web:///Assets/Monaco/monaco.html");

            // Wait until the web side reports ready.
            // (No busy loop: the ready message flips _monacoReady.)
            for (var i = 0; i < 80 && !_monacoReady; i++)
            {
                await Task.Delay(50);
            }

            if (_monacoReady)
            {
                // Push any pending state.
                if (!string.IsNullOrEmpty(_pendingMonacoText))
                {
                    PostMonaco(new { type = "setText", text = _pendingMonacoText });
                    _pendingMonacoText = string.Empty;
                }

                PostMonaco(new { type = "setReadOnly", readOnly = _pendingMonacoReadOnly });
            }
        }
        catch
        {
            // If Monaco fails to init for any reason, fall back to the simple editor.
            _useMonaco = false;
            AppServices.Settings.UseMonacoEditor = false;
            ApplyEditorMode();
        }
    }

    private void PostMonaco(object payload)
    {
        if (!_monacoReady)
        {
            return;
        }

        var json = JsonSerializer.Serialize(payload);
        MonacoView.PostWebMessageAsJson(json);
    }

    private void OnMonacoWebMessage(WebView2 sender, WebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            using var doc = JsonDocument.Parse(args.WebMessageAsJson);
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var tEl)) return;
            var type = tEl.GetString();
            if (type == "ready")
            {
                _monacoReady = true;

                // Apply initial state (current buffer + readonly) once Monaco is ready.
                var text = _pendingMonacoText;
                if (string.IsNullOrEmpty(text))
                {
                    text = EditorBox.Text ?? string.Empty;
                }

                _monacoTextCache = text;
                PostMonaco(new { type = "setText", text });
                PostMonaco(new { type = "setReadOnly", readOnly = _pendingMonacoReadOnly });
                _pendingMonacoText = string.Empty;
                return;
            }

            if (type == "text")
            {
                if (root.TryGetProperty("text", out var textEl))
                {
                    _monacoTextCache = textEl.GetString() ?? string.Empty;

                    // Dirty tracking for Monaco: compare cache against last loaded normalized.
                    if (_current != null && _current.IsBundled == false)
                    {
                        var now = NormalizeLineEndings(_monacoTextCache).TrimEnd('\n');
                        var dirty = !string.Equals(now, _loadedTextNormalized, StringComparison.Ordinal);
                        if (dirty != _isDirty)
                        {
                            _isDirty = dirty;
                            UpdateCommandStates();
                        }
                    }
                }
            }
        }
        catch
        {
            // Ignore malformed messages.
        }
    }

    private async Task RefreshAsync(string? selectFullPath = null)
    {
        try
        {
            await AppServices.Scripts.EnsureBootstrappedAsync();
            var scripts = await AppServices.Scripts.ListScriptsAsync();

            await RunOnUiAsync(async () =>
            {
                _suppressSelectionChange = true;
                try
                {
                    _scripts.Clear();
                    foreach (var s in scripts)
                    {
                        _scripts.Add(s);
                    }

                    // Force ListView to notice collection refresh even if called from odd contexts.
                    ScriptsList.UpdateLayout();

                    if (selectFullPath != null)
                    {
                        var match = _scripts.FirstOrDefault(s => string.Equals(s.FullPath, selectFullPath, StringComparison.OrdinalIgnoreCase));
                        if (match != null)
                        {
                            ScriptsList.SelectedItem = match;
                            await OpenScriptAsync(match);
                        }
                        return;
                    }

                    if (_current != null)
                    {
                        var stillThere = _scripts.FirstOrDefault(s => string.Equals(s.FullPath, _current.FullPath, StringComparison.OrdinalIgnoreCase));
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
                _suppressSelectionChange = true;
                ScriptsList.SelectedItem = _current;
                _suppressSelectionChange = false;
                return;
            }
        }

        if (ScriptsList.SelectedItem is ScriptInfo script)
        {
            await OpenScriptAsync(script);
        }
        else
        {
            ClearEditor();
        }
    }

    private async Task OpenScriptAsync(ScriptInfo script)
    {
        _current = script;

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

        await RunOnUiAsync(async () =>
        {
            _loadedTextNormalized = NormalizeLineEndings(text);
            _isDirty = false;

            _suppressEditorChanged = true;
            EditorBox.IsReadOnly = script.IsBundled;
            EditorBox.Text = text ?? string.Empty;
            _suppressEditorChanged = false;

            _pendingMonacoReadOnly = script.IsBundled;
            _pendingMonacoText = text ?? string.Empty;
            _monacoTextCache = _pendingMonacoText;
            if (_useMonaco && _monacoReady)
            {
                PostMonaco(new { type = "setReadOnly", readOnly = _pendingMonacoReadOnly });
                PostMonaco(new { type = "setText", text = _pendingMonacoText });
                _pendingMonacoText = string.Empty;
            }

            EmptyHint.Visibility = Visibility.Collapsed;
            ReadOnlyBanner.Visibility = script.IsBundled ? Visibility.Visible : Visibility.Collapsed;

            PreviewHost.Children.Clear();
            PreviewHint.Visibility = Visibility.Visible;

            UpdateCommandStates();
            await Task.CompletedTask;
        });

        // Execute on open so users see script-side effects immediately.
        _scriptEngine.Execute(text);
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

            _pendingMonacoReadOnly = true;
            _pendingMonacoText = string.Empty;
            _monacoTextCache = string.Empty;
            if (_useMonaco && _monacoReady)
            {
                PostMonaco(new { type = "setReadOnly", readOnly = true });
                PostMonaco(new { type = "setText", text = string.Empty });
                _pendingMonacoText = string.Empty;
            }

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
        if (_suppressEditorChanged || _useMonaco)
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
        var raw = _useMonaco ? _monacoTextCache : (EditorBox.Text ?? string.Empty);
        return NormalizeLineEndings(raw).TrimEnd('\n');
    }

    private static string NormalizeLineEndings(string text)
    {
        if (string.IsNullOrEmpty(text)) return string.Empty;
        return text.Replace("\r\n", "\n").Replace("\r", "\n");
    }

    private void SetPreviewMode(bool preview)
    {
        if (EditorPane == null || PreviewPane == null)
        {
            return;
        }

        EditorPane.Visibility = preview ? Visibility.Collapsed : Visibility.Visible;
        PreviewPane.Visibility = preview ? Visibility.Visible : Visibility.Collapsed;
    }

    private void RenderPreview(ScriptTree tree)
    {
        System.Diagnostics.Debug.WriteLine($"[EMWaver][Windows][Preview] RenderPreview rootType={tree?.Root.Type}");

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
