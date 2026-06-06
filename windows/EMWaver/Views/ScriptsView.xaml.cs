using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
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

namespace EMWaver.Views;

public partial class ScriptsView : UserControl
{
    private readonly ScriptRepository _scripts;
    private readonly ScriptEngine _engine;
    private readonly ScriptRenderer _renderer;
    private readonly WindowsDeviceManager _device;

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

    public ScriptsView()
        : this(AppServices.Scripts, AppServices.ScriptEngine, AppServices.Device)
    {
    }

    public ScriptsView(
        ScriptRepository scripts,
        ScriptEngine engine,
        WindowsDeviceManager device)
    {
        InitializeComponent();

        _scripts = scripts;
        _engine = engine;
        _renderer = new ScriptRenderer(InvokeScriptHandler);
        _device = device;

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
            RestoreLastOpenScript();
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

    private void RestoreLastOpenScript()
    {
        var last = AppServices.Settings.LastOpenScript;
        var script = !string.IsNullOrWhiteSpace(last)
            ? _scripts.All.FirstOrDefault(s => s.FileName.Equals(last, StringComparison.OrdinalIgnoreCase) || s.Name.Equals(last, StringComparison.OrdinalIgnoreCase))
            : null;
        script ??= _scripts.All.FirstOrDefault(s => s.KindLabel == "Example") ?? _scripts.All.FirstOrDefault();
        if (script != null)
        {
            ScriptListBox.SelectedItem = script;
            ScriptListBox.ScrollIntoView(script);
            SelectScript(script);
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
        AppServices.Settings.LastOpenScript = info.FileName;
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

}
