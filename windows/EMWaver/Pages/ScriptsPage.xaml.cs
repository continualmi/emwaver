using EMWaver.Models;
using EMWaver.Interop;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using Windows.Foundation;

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

    private IntPtr _scintillaHwnd = IntPtr.Zero;
    private bool _scintillaConfigured;
    private DispatcherQueueTimer? _dirtyPollTimer;

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
        await RefreshAsync();
    }

    // EditorHost handlers (native Scintilla child HWND)
    private void OnEditorHostLoaded(object sender, RoutedEventArgs e)
    {
        EnsureScintillaCreated();
        UpdateScintillaBounds();
        StartDirtyPoll();

        // Keep the native window hidden until a script is selected.
        if (_current == null)
        {
            HideScintilla();
        }
    }

    private void OnEditorHostUnloaded(object sender, RoutedEventArgs e)
    {
        StopDirtyPoll();
        DestroyScintilla();
    }

    private void OnEditorHostSizeChanged(object sender, SizeChangedEventArgs e)
    {
        UpdateScintillaBounds();
    }

    private void OnEditorHostLayoutUpdated(object sender, object e)
    {
        // SizeChanged won't fire for pure layout moves (e.g. column resize, pane toggle).
        UpdateScintillaBounds();
    }

    private void OnEditorHostPointerPressed(object sender, Microsoft.UI.Xaml.Input.PointerRoutedEventArgs e)
    {
        FocusEditorNative();
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
            MarkEditorSaved();
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

            EnsureScintillaCreated();
            ConfigureScintillaIfNeeded();
            SetEditorReadOnly(script.IsBundled);
            SetEditorText(text);
            MarkEditorSaved();
            ShowScintilla();

            UpdateCommandStates();

            FocusEditorNative();

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
            EnsureScintillaCreated();
            SetEditorText(string.Empty);
            SetEditorReadOnly(true);
            MarkEditorSaved();
            _suppressEditorChange = false;

            EditorTitleText.Text = "Select a script";
            EditorSubtitleText.Text = string.Empty;
            EditorHost.Visibility = Visibility.Collapsed;
            HideScintilla();
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



    // Native editor (Scintilla)
    private void EnsureScintillaCreated()
    {
        if (_scintillaHwnd != IntPtr.Zero)
        {
            return;
        }

        if (App.MainWindow == null)
        {
            return;
        }

        // Make sure SciLexer.dll is loaded so the Scintilla window class exists.
        _ = ScintillaWin32.LoadLibraryW("SciLexer.dll");

        var hwndOwner = WinRT.Interop.WindowNative.GetWindowHandle(App.MainWindow);
        if (hwndOwner == IntPtr.Zero)
        {
            return;
        }

        _scintillaHwnd = ScintillaWin32.CreateWindowExW(
            dwExStyle: 0,
            lpClassName: "Scintilla",
            lpWindowName: string.Empty,
            // NOTE: WinUI's XAML surface can cover WS_CHILD HWNDs. Use an owned
            // popup window so the editor is always visible above XAML.
            dwStyle: ScintillaWin32.WS_POPUP | ScintillaWin32.WS_VISIBLE | ScintillaWin32.WS_TABSTOP,
            x: 0,
            y: 0,
            nWidth: 10,
            nHeight: 10,
            hWndParent: hwndOwner,
            hMenu: IntPtr.Zero,
            hInstance: IntPtr.Zero,
            lpParam: IntPtr.Zero
        );

        if (_scintillaHwnd == IntPtr.Zero)
        {
            return;
        }

        // Best-effort: ask Windows to treat this control as dark-themed
        // (helps with native scrollbars being light/white).
        try
        {
            var dark = 1;
            _ = ScintillaWin32.DwmSetWindowAttribute(_scintillaHwnd, ScintillaWin32.DWMWA_USE_IMMERSIVE_DARK_MODE_20, ref dark, sizeof(int));
            _ = ScintillaWin32.DwmSetWindowAttribute(_scintillaHwnd, ScintillaWin32.DWMWA_USE_IMMERSIVE_DARK_MODE_19, ref dark, sizeof(int));
            _ = ScintillaWin32.SetWindowTheme(_scintillaHwnd, "DarkMode_Explorer", null);
        }
        catch
        {
            // Ignore theming failures; editor still works.
        }

        HideScintilla();
    }

    private void DestroyScintilla()
    {
        if (_scintillaHwnd == IntPtr.Zero)
        {
            return;
        }

        _ = ScintillaWin32.DestroyWindow(_scintillaHwnd);
        _scintillaHwnd = IntPtr.Zero;
        _scintillaConfigured = false;
    }

    private void ConfigureScintillaIfNeeded()
    {
        if (_scintillaConfigured || _scintillaHwnd == IntPtr.Zero)
        {
            return;
        }

        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_SETCODEPAGE, ScintillaWin32.SC_CP_UTF8, 0);
        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_SETLEXER, ScintillaWin32.SCLEX_CPP, 0);

        // Dark theme-ish colors.
        var back = ScintillaWin32.Rgb(0x1E, 0x1E, 0x1E);
        var fore = ScintillaWin32.Rgb(0xD4, 0xD4, 0xD4);
        var keyword = ScintillaWin32.Rgb(0xC5, 0x86, 0xC0);
        var str = ScintillaWin32.Rgb(0xCE, 0x91, 0x78);
        var comment = ScintillaWin32.Rgb(0x6A, 0x99, 0x55);
        var number = ScintillaWin32.Rgb(0xB5, 0xCE, 0xA8);
        var caret = ScintillaWin32.Rgb(0xAE, 0xAF, 0xAD);
        var selBack = ScintillaWin32.Rgb(0x26, 0x4F, 0x78);

        // Base style.
        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_STYLESETBACK, ScintillaWin32.STYLE_DEFAULT, back);
        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_STYLESETFORE, ScintillaWin32.STYLE_DEFAULT, fore);
        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_STYLESETSIZE, ScintillaWin32.STYLE_DEFAULT, 13);
        SetScintillaFont("Consolas");
        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_STYLECLEARALL, 0, 0);

        // C-like lexer styles.
        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_STYLESETFORE, ScintillaWin32.SCE_C_WORD, keyword);
        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_STYLESETBOLD, ScintillaWin32.SCE_C_WORD, 0);
        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_STYLESETFORE, ScintillaWin32.SCE_C_STRING, str);
        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_STYLESETFORE, ScintillaWin32.SCE_C_CHARACTER, str);
        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_STYLESETFORE, ScintillaWin32.SCE_C_NUMBER, number);
        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_STYLESETFORE, ScintillaWin32.SCE_C_COMMENT, comment);
        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_STYLESETFORE, ScintillaWin32.SCE_C_COMMENTLINE, comment);
        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_STYLESETFORE, ScintillaWin32.SCE_C_COMMENTDOC, comment);

        // Selection + caret.
        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_SETCARETFORE, caret, 0);
        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_SETSELFORE, 1, fore);
        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_SETSELBACK, 1, selBack);

        // No margin/line numbers.
        for (var i = 0; i < 5; i++)
        {
            ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_SETMARGINTYPEN, i, 0);
            ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_SETMARGINWIDTHN, i, 0);
        }

        // Disable caret line highlight (keeps UI calmer).
        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_SETCARETLINEVISIBLE, 0, 0);
        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_SETCARETLINEBACK, back, 0);

        SetScintillaKeywords("break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield await async true false null undefined");

        _scintillaConfigured = true;
    }

    private void SetScintillaFont(string fontName)
    {
        var bytes = Encoding.UTF8.GetBytes(fontName + "\0");
        var ptr = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, ptr, bytes.Length);
            ScintillaWin32.SendPtr(_scintillaHwnd, ScintillaWin32.SCI_STYLESETFONT, ScintillaWin32.STYLE_DEFAULT, ptr);
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    private void SetScintillaKeywords(string keywords)
    {
        var bytes = Encoding.UTF8.GetBytes(keywords + "\0");
        var ptr = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, ptr, bytes.Length);
            ScintillaWin32.SendPtr(_scintillaHwnd, ScintillaWin32.SCI_SETKEYWORDS, 0, ptr);
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    private void SetEditorReadOnly(bool readOnly)
    {
        if (_scintillaHwnd == IntPtr.Zero)
        {
            return;
        }

        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_SETREADONLY, readOnly ? 1 : 0, 0);
    }

    private void MarkEditorSaved()
    {
        if (_scintillaHwnd == IntPtr.Zero)
        {
            return;
        }

        ScintillaWin32.Send(_scintillaHwnd, ScintillaWin32.SCI_SETSAVEPOINT, 0, 0);
    }

    private void SetEditorText(string text)
    {
        EnsureScintillaCreated();
        ConfigureScintillaIfNeeded();

        if (_scintillaHwnd == IntPtr.Zero)
        {
            return;
        }

        var normalized = NormalizeLineEndings(text ?? string.Empty);
        var bytes = Encoding.UTF8.GetBytes(normalized + "\0");
        var ptr = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, ptr, bytes.Length);
            ScintillaWin32.SendPtr(_scintillaHwnd, ScintillaWin32.SCI_SETTEXT, 0, ptr);
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    private string GetEditorTextRaw()
    {
        if (_scintillaHwnd == IntPtr.Zero)
        {
            return string.Empty;
        }

        var len = (int)ScintillaWin32.SendMessageW(_scintillaHwnd, ScintillaWin32.SCI_GETTEXTLENGTH, IntPtr.Zero, IntPtr.Zero);
        if (len <= 0)
        {
            return string.Empty;
        }

        // SCI_GETTEXT expects buffer size including trailing NUL.
        var buf = Marshal.AllocHGlobal(len + 1);
        try
        {
            _ = ScintillaWin32.SendMessageW(_scintillaHwnd, ScintillaWin32.SCI_GETTEXT, new IntPtr(len + 1), buf);
            var bytes = new byte[len];
            Marshal.Copy(buf, bytes, 0, len);
            return Encoding.UTF8.GetString(bytes);
        }
        finally
        {
            Marshal.FreeHGlobal(buf);
        }
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

    private void ShowScintilla()
    {
        if (_scintillaHwnd == IntPtr.Zero)
        {
            return;
        }

        _ = ScintillaWin32.ShowWindow(_scintillaHwnd, ScintillaWin32.SW_SHOW);
        UpdateScintillaBounds();
    }

    private void HideScintilla()
    {
        if (_scintillaHwnd == IntPtr.Zero)
        {
            return;
        }

        _ = ScintillaWin32.ShowWindow(_scintillaHwnd, ScintillaWin32.SW_HIDE);
    }

    private void FocusEditorNative()
    {
        if (_scintillaHwnd == IntPtr.Zero)
        {
            return;
        }

        _ = DispatcherQueue.TryEnqueue(() =>
        {
            _ = ScintillaWin32.SetFocus(_scintillaHwnd);
        });
    }

    private void UpdateScintillaBounds()
    {
        if (_scintillaHwnd == IntPtr.Zero)
        {
            return;
        }

        if (EditorHost.Visibility != Visibility.Visible)
        {
            return;
        }

        if (XamlRoot == null || App.MainWindow == null)
        {
            return;
        }

        // Get bounds in window coordinates, then convert to screen pixels.
        var p = EditorHost.TransformToVisual(null).TransformPoint(new Point(0, 0));
        var scale = XamlRoot.RasterizationScale;

        var x = (int)Math.Round(p.X * scale);
        var y = (int)Math.Round(p.Y * scale);
        var w = (int)Math.Round(EditorHost.ActualWidth * scale);
        var h = (int)Math.Round(EditorHost.ActualHeight * scale);

        // Visual padding around the native control.
        var inset = (int)Math.Round(8 * scale);
        if (inset > 0)
        {
            x += inset;
            y += inset;
            w -= inset * 2;
            h -= inset * 2;
        }
        if (w < 4 || h < 4)
        {
            return;
        }

        var hwndOwner = WinRT.Interop.WindowNative.GetWindowHandle(App.MainWindow);
        if (hwndOwner == IntPtr.Zero)
        {
            return;
        }

        var pt = new ScintillaWin32.POINT { x = x, y = y };
        _ = ScintillaWin32.ClientToScreen(hwndOwner, ref pt);

        _ = ScintillaWin32.SetWindowPos(
            _scintillaHwnd,
            ScintillaWin32.HWND_TOP,
            pt.x,
            pt.y,
            w,
            h,
            ScintillaWin32.SWP_NOACTIVATE
        );
    }

    private void StartDirtyPoll()
    {
        _dirtyPollTimer ??= DispatcherQueue.CreateTimer();
        _dirtyPollTimer.Interval = TimeSpan.FromMilliseconds(120);
        _dirtyPollTimer.Tick -= OnDirtyPollTick;
        _dirtyPollTimer.Tick += OnDirtyPollTick;
        _dirtyPollTimer.Start();
    }

    private void StopDirtyPoll()
    {
        _dirtyPollTimer?.Stop();
    }

    private void OnDirtyPollTick(DispatcherQueueTimer sender, object args)
    {
        if (_suppressEditorChange)
        {
            return;
        }

        if (_current == null || _current.IsBundled || _scintillaHwnd == IntPtr.Zero)
        {
            return;
        }

        var modified = ScintillaWin32.SendMessageW(_scintillaHwnd, ScintillaWin32.SCI_GETMODIFY, IntPtr.Zero, IntPtr.Zero) != IntPtr.Zero;
        if (modified != _isDirty)
        {
            _isDirty = modified;
            UpdateCommandStates();
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
