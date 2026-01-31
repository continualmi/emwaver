using EMWaver.Models;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Windows.UI;

namespace EMWaver.Pages;

public sealed partial class ScriptsPage : Page
{
    private readonly ObservableCollection<ScriptInfo> _scripts = new();

    private readonly ObservableCollection<string> _agentMessages = new();

    private ScriptInfo? _current;
    private string _loadedTextNormalized = string.Empty;
    private bool _isDirty;
    private bool _suppressEditorChange;
    private bool _suppressSelectionChange;

    private DispatcherQueueTimer? _highlightTimer;
    private ScrollViewer? _editorScrollViewer;
    private bool _suppressHighlight;
    private bool _isScrolling;

    private static readonly SolidColorBrush BaseBrush = new(Color.FromArgb(0xFF, 0xD4, 0xD4, 0xD4));
    private static readonly SolidColorBrush KeywordBrush = new(Color.FromArgb(0xFF, 0xC5, 0x86, 0xC0));
    private static readonly SolidColorBrush StringBrush = new(Color.FromArgb(0xFF, 0xCE, 0x91, 0x78));
    private static readonly SolidColorBrush CommentBrush = new(Color.FromArgb(0xFF, 0x6A, 0x99, 0x55));
    private static readonly SolidColorBrush NumberBrush = new(Color.FromArgb(0xFF, 0xB5, 0xCE, 0xA8));

    public ScriptsPage()
    {
        InitializeComponent();
        ScriptsList.ItemsSource = _scripts;
        AgentMessagesList.ItemsSource = _agentMessages;

        EditorBox.TextChanged += OnEditorTextChanged;
        EditorBox.Loaded += OnEditorLoaded;

        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        await RefreshAsync();
    }

    private void OnEditorLoaded(object sender, RoutedEventArgs e)
    {
        _editorScrollViewer ??= FindDescendantScrollViewer(EditorBox);
        if (_editorScrollViewer == null)
        {
            return;
        }

        _editorScrollViewer.ViewChanged -= OnEditorViewChanged;
        _editorScrollViewer.ViewChanged += OnEditorViewChanged;
        UpdateLineNumbersTransform();
    }

    private void OnEditorViewChanged(object? sender, ScrollViewerViewChangedEventArgs e)
    {
        _isScrolling = e.IsIntermediate;

        if (_isScrolling)
        {
            // Avoid any heavy work while the user scrolls.
            _highlightTimer?.Stop();
        }

        UpdateLineNumbersTransform();

        if (!_isScrolling)
        {
            // Keep highlight overlay aligned when scrolling ends.
            ScheduleHighlight();
        }
    }

    private void UpdateLineNumbersTransform()
    {
        if (_editorScrollViewer == null)
        {
            return;
        }

        LineNumbersTransform.Y = -_editorScrollViewer.VerticalOffset;
    }

    private void OnEditorTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressEditorChange)
        {
            return;
        }

        if (_current == null || _current.IsBundled)
        {
            return;
        }

        var normalized = GetEditorTextNormalized();
        _isDirty = !string.Equals(normalized, _loadedTextNormalized, StringComparison.Ordinal);
        UpdateCommandStates();

        UpdateLineNumbers();
        ScheduleHighlight();
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
            _loadedTextNormalized = NormalizeLineEndings(text);
            _isDirty = false;

            EditorTitleText.Text = script.FileName;
            EditorSubtitleText.Text = script.KindLabel;

            EmptyHint.Visibility = Visibility.Collapsed;
            EditorHost.Visibility = Visibility.Visible;

            EditorBox.IsReadOnly = script.IsBundled;
            SetEditorText(text);
            UpdateLineNumbers();
            ScheduleHighlight(immediate: true);

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
            _suppressEditorChange = true;
            SetEditorText(string.Empty);
            EditorBox.IsReadOnly = true;
            _suppressEditorChange = false;

            EditorTitleText.Text = "Select a script";
            EditorSubtitleText.Text = string.Empty;
            EditorHost.Visibility = Visibility.Collapsed;
            EmptyHint.Visibility = Visibility.Visible;
            UpdateCommandStates();

            await Task.CompletedTask;
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



    private void SetEditorText(string text)
    {
        _suppressEditorChange = true;
        try
        {
            EditorBox.Text = NormalizeLineEndings(text ?? string.Empty);
            EditorBox.Select(0, 0);
        }
        finally
        {
            _suppressEditorChange = false;
        }
    }

    private string GetEditorTextRaw()
    {
        return EditorBox.Text ?? string.Empty;
    }

    private string GetEditorTextNormalized()
    {
        return NormalizeLineEndings(GetEditorTextRaw()).TrimEnd('\n');
    }

    private static string NormalizeLineEndings(string text)
    {
        if (string.IsNullOrEmpty(text)) return string.Empty;
        return text.Replace("\r\n", "\n").Replace("\r", "\n");
    }

    private void UpdateLineNumbers()
    {
        var normalized = GetEditorTextNormalized();
        var lineCount = 1;
        for (var i = 0; i < normalized.Length; i++)
        {
            if (normalized[i] == '\n') lineCount++;
        }

        if (lineCount < 1) lineCount = 1;

        var sb = new StringBuilder(capacity: Math.Max(16, lineCount * 4));
        for (var i = 1; i <= lineCount; i++)
        {
            sb.Append(i);
            if (i != lineCount) sb.Append("\r\n");
        }

        LineNumbersText.Text = sb.ToString();
        UpdateLineNumbersTransform();
    }

    private void ScheduleHighlight(bool immediate = false)
    {
        // WinUI 3 TextBox doesn't expose TextHighlighters in this SDK, and the
        // overlay approach proved too visually glitchy. Keep editing stable.
        return;

        if (_isScrolling)
        {
            return;
        }

        if (immediate)
        {
            ApplySyntaxHighlighting();
            return;
        }

        _highlightTimer ??= DispatcherQueue.CreateTimer();
        _highlightTimer.Stop();
        _highlightTimer.Interval = TimeSpan.FromMilliseconds(120);
        _highlightTimer.Tick -= OnHighlightTimerTick;
        _highlightTimer.Tick += OnHighlightTimerTick;
        _highlightTimer.Start();
    }

    private void OnHighlightTimerTick(DispatcherQueueTimer sender, object args)
    {
        sender.Stop();
        ApplySyntaxHighlighting();
    }

    private void ApplySyntaxHighlighting()
    {
        // See ScheduleHighlight(): syntax highlighting is currently disabled on Windows.
        return;

        if (_suppressHighlight)
        {
            return;
        }

        if (_isScrolling)
        {
            return;
        }

        var text = GetEditorTextRaw();
        // Keep it responsive.
        if (text.Length > 200_000)
        {
            return;
        }

        var tokens = TokenizeJavaScript(text);
        if (tokens.Count > 25_000)
        {
            return;
        }

        _suppressHighlight = true;
        try { }
        finally { _suppressHighlight = false; }
    }

    private enum JsTokenKind
    {
        Keyword,
        String,
        Comment,
        Number,
    }

    private readonly struct JsToken
    {
        public readonly int Start;
        public readonly int Length;
        public readonly JsTokenKind Kind;

        public JsToken(int start, int length, JsTokenKind kind)
        {
            Start = start;
            Length = length;
            Kind = kind;
        }
    }

    private static readonly HashSet<string> JsKeywords = new(StringComparer.Ordinal)
    {
        "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete",
        "do", "else", "export", "extends", "finally", "for", "function", "if", "import", "in",
        "instanceof", "let", "new", "return", "super", "switch", "this", "throw", "try", "typeof",
        "var", "void", "while", "with", "yield", "await", "async", "true", "false", "null", "undefined",
    };

    private static List<JsToken> TokenizeJavaScript(string text)
    {
        var tokens = new List<JsToken>(capacity: 2048);
        var i = 0;
        while (i < text.Length)
        {
            var c = text[i];

            // Line comment
            if (c == '/' && i + 1 < text.Length && text[i + 1] == '/')
            {
                var start = i;
                i += 2;
                while (i < text.Length && text[i] != '\n' && text[i] != '\r') i++;
                tokens.Add(new JsToken(start, i - start, JsTokenKind.Comment));
                continue;
            }

            // Block comment
            if (c == '/' && i + 1 < text.Length && text[i + 1] == '*')
            {
                var start = i;
                i += 2;
                while (i + 1 < text.Length)
                {
                    if (text[i] == '*' && text[i + 1] == '/')
                    {
                        i += 2;
                        break;
                    }
                    i++;
                }
                tokens.Add(new JsToken(start, i - start, JsTokenKind.Comment));
                continue;
            }

            // Strings
            if (c == '\'' || c == '"' || c == '`')
            {
                var quote = c;
                var start = i;
                i++;
                while (i < text.Length)
                {
                    var ch = text[i];
                    if (ch == '\\')
                    {
                        i += 2;
                        continue;
                    }

                    if (quote != '`' && (ch == '\n' || ch == '\r'))
                    {
                        break;
                    }

                    if (ch == quote)
                    {
                        i++;
                        break;
                    }

                    i++;
                }

                tokens.Add(new JsToken(start, i - start, JsTokenKind.String));
                continue;
            }

            // Numbers
            if ((c >= '0' && c <= '9') || (c == '.' && i + 1 < text.Length && text[i + 1] >= '0' && text[i + 1] <= '9'))
            {
                var start = i;
                i++;
                while (i < text.Length)
                {
                    var ch = text[i];
                    if ((ch >= '0' && ch <= '9') || ch == '.' || ch == 'x' || ch == 'X' || ch == 'b' || ch == 'B' || ch == 'o' || ch == 'O'
                        || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F') || ch == '_')
                    {
                        i++;
                        continue;
                    }
                    break;
                }
                tokens.Add(new JsToken(start, i - start, JsTokenKind.Number));
                continue;
            }

            // Identifiers / keywords
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_' || c == '$')
            {
                var start = i;
                i++;
                while (i < text.Length)
                {
                    var ch = text[i];
                    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '$')
                    {
                        i++;
                        continue;
                    }
                    break;
                }

                var ident = text.Substring(start, i - start);
                if (JsKeywords.Contains(ident))
                {
                    tokens.Add(new JsToken(start, i - start, JsTokenKind.Keyword));
                }

                continue;
            }

            i++;
        }

        return tokens;
    }

    private static ScrollViewer? FindDescendantScrollViewer(DependencyObject root)
    {
        var q = new Queue<DependencyObject>();
        q.Enqueue(root);
        while (q.Count > 0)
        {
            var cur = q.Dequeue();
            if (cur is ScrollViewer sv)
            {
                return sv;
            }

            var count = VisualTreeHelper.GetChildrenCount(cur);
            for (var i = 0; i < count; i++)
            {
                q.Enqueue(VisualTreeHelper.GetChild(cur, i));
            }
        }

        return null;
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
