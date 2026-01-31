using EMWaver.Models;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

namespace EMWaver.Pages;

public sealed partial class ScriptsPage : Page
{
    private readonly ObservableCollection<ScriptInfo> _scripts = new();

    private readonly ObservableCollection<string> _agentMessages = new();

    private ScriptInfo? _current;
    private string _loadedText = string.Empty;
    private bool _isDirty;
    private bool _suppressEditorChange;
    private bool _suppressSelectionChange;

    private bool _editorReady;
    private bool _editorReadOnly;
    private string _pendingEditorText = string.Empty;

    public ScriptsPage()
    {
        InitializeComponent();
        ScriptsList.ItemsSource = _scripts;
        AgentMessagesList.ItemsSource = _agentMessages;
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;

        InitEditor();
        await RefreshAsync();
    }

    private void InitEditor()
    {
        // WebView2 initialization and callbacks must stay on the UI thread.
        if (!DispatcherQueue.HasThreadAccess)
        {
            _ = DispatcherQueue.TryEnqueue(InitEditor);
            return;
        }

        EditorWebView.CoreWebView2Initialized += OnWebViewCoreInitialized;

        // This forces CoreWebView2 creation.
        _ = EditorWebView.EnsureCoreWebView2Async();
    }

    private void OnWebViewCoreInitialized(WebView2 sender, CoreWebView2InitializedEventArgs args)
    {
        if (args.Exception != null || sender.CoreWebView2 == null)
        {
            return;
        }

        sender.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
        sender.NavigateToString(GetEditorHtml());
    }

    private void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            var json = args.WebMessageAsJson;
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (!root.TryGetProperty("kind", out var kindEl)) return;
            var kind = kindEl.GetString();

            switch (kind)
            {
                case "ready":
                    _editorReady = true;
                    _ = DispatcherQueue.TryEnqueue(async () =>
                    {
                        await EditorSetTextAsync(_pendingEditorText);
                        await EditorSetReadOnlyAsync(_editorReadOnly);
                        await EditorFocusAsync();
                    });
                    break;

                case "change":
                    if (_suppressEditorChange) return;
                    if (_current == null) return;
                    if (_current.IsBundled) return;

                    if (!root.TryGetProperty("text", out var textEl)) return;
                    var text = textEl.GetString() ?? string.Empty;

                    _isDirty = !string.Equals(text, _loadedText, StringComparison.Ordinal);
                    UpdateCommandStates();
                    break;
            }
        }
        catch
        {
            // Ignore editor bridge parse errors.
        }
    }

    private async void OnRefreshClick(object sender, RoutedEventArgs e)
    {
        await RefreshAsync();
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

    private void OnAgentToggleClick(object sender, RoutedEventArgs e)
    {
        var show = AgentToggleButton.IsChecked == true;
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
            var created = await AppServices.Scripts.CreateLocalScriptAsync(name, content: "");
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
            var currentText = await EditorGetTextAsync();
            await AppServices.Scripts.SaveScriptTextAsync(_current, currentText);
            _loadedText = currentText;
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
        await ShowInfoAsync("Run", "Script preview/run is not wired up on Windows yet.");
    }

    private async Task RefreshAsync(string? selectFullPath = null)
    {
        try
        {
            await AppServices.Scripts.EnsureBootstrappedAsync();
            var scripts = await AppServices.Scripts.ListScriptsAsync();

            _scripts.Clear();
            foreach (var s in scripts)
            {
                _scripts.Add(s);
            }

            if (selectFullPath != null)
            {
                var match = _scripts.FirstOrDefault(s => string.Equals(s.FullPath, selectFullPath, StringComparison.OrdinalIgnoreCase));
                if (match != null)
                {
                    _suppressSelectionChange = true;
                    ScriptsList.SelectedItem = match;
                    _suppressSelectionChange = false;
                    await OpenScriptAsync(match);
                }
                return;
            }

            if (_current != null)
            {
                var stillThere = _scripts.FirstOrDefault(s => string.Equals(s.FullPath, _current.FullPath, StringComparison.OrdinalIgnoreCase));
                if (stillThere != null)
                {
                    _suppressSelectionChange = true;
                    ScriptsList.SelectedItem = stillThere;
                    _suppressSelectionChange = false;
                    await OpenScriptAsync(stillThere);
                    return;
                }
            }

            ClearEditor();
        }
        catch (Exception)
        {
            // Leave whatever is currently shown.
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
            _loadedText = text;
            _isDirty = false;

            EditorTitleText.Text = script.FileName;
            EditorSubtitleText.Text = script.KindLabel;

            EmptyHint.Visibility = Visibility.Collapsed;
            EditorWebView.Visibility = Visibility.Visible;

            _pendingEditorText = text;
            _editorReadOnly = script.IsBundled;

            _suppressEditorChange = true;
            if (_editorReady)
            {
                await EditorSetTextAsync(text);
                await EditorSetReadOnlyAsync(_editorReadOnly);
            }
            _suppressEditorChange = false;

            UpdateCommandStates();
        });
    }

    private void ClearEditor()
    {
        _current = null;
        _loadedText = string.Empty;
        _isDirty = false;

        _pendingEditorText = string.Empty;
        _editorReadOnly = true;

        _ = RunOnUiAsync(async () =>
        {
            _suppressEditorChange = true;
            if (_editorReady)
            {
                await EditorSetTextAsync(string.Empty);
                await EditorSetReadOnlyAsync(true);
            }
            _suppressEditorChange = false;

            EditorTitleText.Text = "Select a script";
            EditorSubtitleText.Text = string.Empty;
            EditorWebView.Visibility = Visibility.Collapsed;
            EmptyHint.Visibility = Visibility.Visible;
            UpdateCommandStates();
        });
    }

    private void UpdateCommandStates()
    {
        var has = _current != null;
        var isBundled = _current?.IsBundled == true;

        SaveButton.IsEnabled = has && !isBundled && _isDirty;
        MakeCopyButton.IsEnabled = has;
        RenameButton.IsEnabled = has && !isBundled;
        DeleteButton.IsEnabled = has && !isBundled;

        // Placeholder until ScriptEngine + renderer are implemented on Windows.
        RunButton.IsEnabled = false;
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

    private static string GetEditorHtml()
    {
        // Matches macOS EmwCodeEditor.swift, but uses WebView2 messaging.
        return """
<!DOCTYPE html>
<html>
<head>
  <meta charset=\"UTF-8\">
  <meta http-equiv=\"Content-Security-Policy\" content=\"default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;\">
  <style>
    html, body { margin:0; padding:0; width:100%; height:100%; overflow:hidden; background:#1e1e1e; }
    #container { width:100%; height:100%; }
  </style>
  <script src=\"https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/loader.js\"></script>
</head>
<body>
  <div id=\"container\"></div>
  <script>
    const post = (obj) => {
      try { window.chrome.webview.postMessage(obj); } catch (e) {}
    };

    require.config({ paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' }});

    window.MonacoEnvironment = {
      getWorkerUrl: function(workerId, label) {
        return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
          self.MonacoEnvironment = { baseUrl: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/' };
          importScripts('https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/base/worker/workerMain.js');
        `)}`;
      }
    };

    window.emw_setText = function(text) {
      if (window.editor) window.editor.setValue(text ?? '');
    };
    window.emw_getText = function() {
      if (!window.editor) return '';
      return window.editor.getValue();
    };
    window.emw_setReadOnly = function(readOnly) {
      if (window.editor) window.editor.updateOptions({ readOnly: !!readOnly });
    };
    window.emw_focus = function() {
      if (window.editor) window.editor.focus();
    };

    require(['vs/editor/editor.main'], function() {
      window.editor = monaco.editor.create(document.getElementById('container'), {
        value: '',
        language: 'javascript',
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 13,
        fontFamily: 'Consolas, SF Mono, Monaco, Menlo, monospace',
        lineNumbers: 'on',
        roundedSelection: true,
        renderLineHighlight: 'line',
        wordWrap: 'off',
        readOnly: false,
        contextmenu: true,
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true, indentation: true }
      });

      post({ kind: 'ready' });

      window.editor.onDidChangeModelContent(function() {
        post({ kind: 'change', text: window.editor.getValue() });
      });
    });
  </script>
</body>
</html>
""";
    }

    private Task EditorSetTextAsync(string text)
    {
        if (!_editorReady) return Task.CompletedTask;
        var json = JsonSerializer.Serialize(text ?? string.Empty);
        return EditorWebView.ExecuteScriptAsync($"window.emw_setText({json});").AsTask();
    }

    private Task EditorSetReadOnlyAsync(bool readOnly)
    {
        if (!_editorReady) return Task.CompletedTask;
        var js = readOnly ? "true" : "false";
        return EditorWebView.ExecuteScriptAsync($"window.emw_setReadOnly({js});").AsTask();
    }

    private Task EditorFocusAsync()
    {
        if (!_editorReady) return Task.CompletedTask;
        return EditorWebView.ExecuteScriptAsync("window.emw_focus();").AsTask();
    }

    private async Task<string> EditorGetTextAsync()
    {
        if (!_editorReady)
        {
            return _pendingEditorText;
        }

        var resultJson = await EditorWebView.ExecuteScriptAsync("window.emw_getText();");
        // ExecuteScriptAsync returns a JSON-encoded string.
        try
        {
            return JsonSerializer.Deserialize<string>(resultJson) ?? string.Empty;
        }
        catch
        {
            return string.Empty;
        }
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

    private async Task ShowInfoAsync(string title, string message)
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
