using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
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

    private ScriptInfo? _selectedScript;
    private bool _isPreviewMode;
    private bool _isRunning;
    private bool _suppressTextChanged;
    private string _pendingSaveScript = "";

    // Agent state
    private string _agentChatId = "";
    private readonly List<(string role, string message)> _agentMessages = new();

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

        ScriptListBox.ItemsSource = _scripts.All;

        _runTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        _runTimer.Tick += OnRunTick;

        _versionCheckTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
        _versionCheckTimer.Tick += OnVersionCheckTick;
        _versionCheckTimer.Start();

        Loaded += async (_, __) => await _scripts.EnsureBootstrappedAsync();
    }

    // --- Public API for MainWindow ---

    public event Action<bool>? PreviewModeChanged;
    public event Action<bool, string?>? RunningScriptStatusChanged;

    public void HandleNewScript()
    {
        var name = "new-script-" + DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        _scripts.Create(name, "// New script\n\nconsole.log('hello EMWaver');\n");
        var info = _scripts.All.FirstOrDefault(s => s.FileName == name);
        if (info != null) SelectScript(info);
    }

    public void HandleSaveScript()
    {
        if (_selectedScript == null) return;
        _scripts.Save(_selectedScript.FileName, EditorTextBox.Text);
        _suppressTextChanged = true;
        _pendingSaveScript = _selectedScript.FileName;
    }

    public void HandleMakeCopy()
    {
        if (_selectedScript == null) return;
        var copyName = _selectedScript.FileName + "-copy";
        _scripts.Create(copyName, EditorTextBox.Text);
    }

    public void HandleRename()
    {
        if (_selectedScript == null) return;
        var newName = Microsoft.VisualBasic.Interaction.InputBox("New name:", "Rename Script", _selectedScript.FileName);
        if (string.IsNullOrWhiteSpace(newName) || newName == _selectedScript.FileName) return;
        _scripts.Rename(_selectedScript.FileName, newName);
    }

    public void HandleDelete()
    {
        if (_selectedScript == null) return;
        var result = MessageBox.Show($"Delete '{_selectedScript.DisplayName}'?",
            "Delete Script", MessageBoxButton.YesNo, MessageBoxImage.Warning);
        if (result == MessageBoxResult.Yes)
        {
            _scripts.Delete(_selectedScript.FileName);
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
            AgentPanelColumn.Width = new GridLength(300);
            AgentPanel.Visibility = Visibility.Visible;

            if (string.IsNullOrWhiteSpace(_agentChatId))
            {
                _agentChatId = Guid.NewGuid().ToString("N");
                _agentMessages.Clear();
            }
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

    private void SelectScript(ScriptInfo? info)
    {
        _selectedScript = info;
        if (info == null)
        {
            EditorTitle.Text = "No script selected";
            EditorTextBox.Text = "";
            EditorTextBox.IsEnabled = false;
            return;
        }

        EditorTitle.Text = info.DisplayName;
        EditorTextBox.IsEnabled = true;

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

    private void OnEditorTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressTextChanged)
        {
            _suppressTextChanged = false;
            return;
        }
    }

    // --- Script execution ---

    private void RunScript()
    {
        if (_selectedScript == null || _isRunning) return;
        ErrorBanner.Visibility = Visibility.Collapsed;

        try
        {
            _engine.Run(EditorTextBox.Text);
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

        var state = _engine.PollState();
        var tree = state?.Tree;

        if (tree != null && _isPreviewMode)
        {
            var element = _renderer.Render(tree);
            PreviewContent.Content = element;
        }

        if (state?.IsComplete == true)
        {
            StopScript();
        }
    }

    private void InvokeScriptHandler(string handlerId, IReadOnlyList<object?> args)
    {
        if (_selectedScript == null) return;
        try
        {
            _engine.FireHandler(handlerId, args);
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
        if (e.Key == Key.Enter)
        {
            SendAgentMessage();
            e.Handled = true;
        }
    }

    private void OnAgentSendClick(object sender, RoutedEventArgs e)
    {
        SendAgentMessage();
    }

    private async void SendAgentMessage()
    {
        var input = AgentInputBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(input)) return;

        if (string.IsNullOrWhiteSpace(_agentChatId))
        {
            _agentChatId = Guid.NewGuid().ToString("N");
        }

        AgentInputBox.Text = "";
        AddAgentMessage("user", input);

        try
        {
            var response = await _agentApi.SendMessageAsync(_agentChatId, input, EditorTextBox.Text);
            if (!string.IsNullOrWhiteSpace(response))
            {
                AddAgentMessage("assistant", response);
            }
        }
        catch (Exception ex)
        {
            AddAgentMessage("error", ex.Message);
        }
    }

    private void AddAgentMessage(string role, string text)
    {
        _agentMessages.Add((role, text));

        var bubble = new Border
        {
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(10, 6, 10, 6),
            Margin = new Thickness(0, 0, 0, 8),
            MaxWidth = 280,
        };

        var tb = new TextBlock
        {
            Text = text,
            TextWrapping = TextWrapping.Wrap,
            FontSize = 12,
        };

        if (role == "user")
        {
            bubble.Background = FindResource("AgentUserBubbleBrush") as System.Windows.Media.Brush;
            bubble.BorderBrush = FindResource("AgentBubbleBorderBrush") as System.Windows.Media.Brush;
            bubble.BorderThickness = new Thickness(1);
            bubble.HorizontalAlignment = HorizontalAlignment.Right;
            tb.Foreground = FindResource("PlotLineBrush") as System.Windows.Media.Brush;
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

        bubble.Child = tb;
        AgentMessagesPanel.Children.Add(bubble);
        AgentMessagesScroll.ScrollToEnd();
    }
}
