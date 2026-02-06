using EMWaver.Services.Cloud;
using EMWaver.Scripting;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Collections.Generic;

namespace EMWaver.Pages;

public sealed partial class RemoteHostControlPage : Page, RemoteControlClientService.IDelegate
{
    private string _hostSessionId = "";
    private string? _scriptInstanceId;
    private int _uiRev;

    private readonly RemoteUiRenderer _renderer;

    public RemoteHostControlPage()
    {
        InitializeComponent();
        _renderer = new RemoteUiRenderer(SendUiEvent);

        RunSourceBox.Text = "UI.render(UI.column({ children: [ UI.text({ text: 'Hello from Windows remote' }), UI.button({ label: 'Tap', onTap: () => UI.render(UI.text({ text: 'Tapped' })) }) ] }))";

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        // noop
    }

    private void OnUnloaded(object sender, RoutedEventArgs e)
    {
        try
        {
            if (AppServices.RemoteControlClient.Delegate == this)
            {
                AppServices.RemoteControlClient.Delegate = null;
            }
            AppServices.RemoteControlClient.Stop();
        }
        catch { }
    }

    protected override void OnNavigatedTo(Microsoft.UI.Xaml.Navigation.NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        _hostSessionId = e.Parameter as string ?? "";
        TitleText.Text = "Remote Control";
        StatusText.Text = string.IsNullOrWhiteSpace(_hostSessionId) ? "" : ("host=" + _hostSessionId);

        AppServices.RemoteControlClient.Delegate = this;
    }

    private void OnBackClick(object sender, RoutedEventArgs e)
    {
        try
        {
            if (Frame.CanGoBack) Frame.GoBack();
        }
        catch { }
    }

    private void OnConnectClick(object sender, RoutedEventArgs e)
    {
        ErrorText.Text = "";
        if (string.IsNullOrWhiteSpace(_hostSessionId))
        {
            ErrorText.Text = "Missing host session id";
            return;
        }
        AppServices.RemoteControlClient.ConnectAndAttach(_hostSessionId);
    }

    private void OnRunClick(object sender, RoutedEventArgs e)
    {
        ErrorText.Text = "";
        if (string.IsNullOrWhiteSpace(_hostSessionId)) return;
        var name = RunNameBox.Text?.Trim() ?? "remote.emw";
        var src = RunSourceBox.Text ?? "";
        AppServices.RemoteControlClient.RunScript(name, src);
    }

    // --- RemoteControlClientService.IDelegate ---

    public void OnStatus(string status)
    {
        _ = DispatcherQueue.TryEnqueue(() =>
        {
            AttachText.Text = "WS: " + status;
        });
    }

    public void OnAttached(string hostSessionId)
    {
        _ = DispatcherQueue.TryEnqueue(() =>
        {
            AttachText.Text = "Attached";
        });
    }

    public void OnScriptStarted(string hostSessionId, string scriptInstanceId, string? name)
    {
        _scriptInstanceId = scriptInstanceId;
        _uiRev = 0;
        _ = DispatcherQueue.TryEnqueue(() =>
        {
            AttachText.Text = "Running: " + (string.IsNullOrWhiteSpace(name) ? scriptInstanceId : name);
        });
    }

    public void OnUiSnapshot(string hostSessionId, string scriptInstanceId, int rev, ScriptTree? tree)
    {
        _scriptInstanceId = scriptInstanceId;
        _uiRev = rev;

        _ = DispatcherQueue.TryEnqueue(() =>
        {
            UiHost.Children.Clear();
            if (tree?.Root != null)
            {
                UiHost.Children.Add(_renderer.Render(tree));
                UiHint.Visibility = Visibility.Collapsed;
            }
            else
            {
                UiHint.Visibility = Visibility.Visible;
            }
        });
    }

    public void OnError(string message)
    {
        _ = DispatcherQueue.TryEnqueue(() =>
        {
            ErrorText.Text = message;
        });
    }

    private void SendUiEvent(string targetNodeId, ScriptEventType ev, object? value)
    {
        var scriptId = _scriptInstanceId;
        if (string.IsNullOrWhiteSpace(scriptId)) return;
        AppServices.RemoteControlClient.SendUiEvent(scriptId, _uiRev, targetNodeId, ev.ToRaw(), value);
    }

    // --- Minimal remote renderer (v1) ---
    private sealed class RemoteUiRenderer
    {
        private readonly Action<string, ScriptEventType, object?> _send;

        public RemoteUiRenderer(Action<string, ScriptEventType, object?> send)
        {
            _send = send;
        }

        public UIElement Render(ScriptTree tree)
        {
            return RenderNode(tree.Root);
        }

        private UIElement RenderNode(ScriptNode node)
        {
            switch (node.Type)
            {
                case ScriptNodeType.Column:
                    {
                        var sp = new StackPanel { Orientation = Orientation.Vertical, Spacing = GetDouble(node.Props, "spacing") ?? 8 };
                        foreach (var c in node.Children) sp.Children.Add(RenderNode(c));
                        return sp;
                    }
                case ScriptNodeType.Row:
                    {
                        var sp = new StackPanel { Orientation = Orientation.Horizontal, Spacing = GetDouble(node.Props, "spacing") ?? 8 };
                        foreach (var c in node.Children) sp.Children.Add(RenderNode(c));
                        return sp;
                    }
                case ScriptNodeType.Text:
                    return new TextBlock { Text = GetString(node.Props, "text") ?? "" };

                case ScriptNodeType.Button:
                    {
                        var b = new Button { Content = GetString(node.Props, "label") ?? "Button" };
                        var token = node.Props.HandlerId(ScriptEventType.Tap);
                        b.IsEnabled = !string.IsNullOrWhiteSpace(token);
                        b.Click += (_, __) => _send(node.Id, ScriptEventType.Tap, null);
                        return b;
                    }

                case ScriptNodeType.Slider:
                    {
                        var min = GetDouble(node.Props, "min") ?? 0;
                        var max = GetDouble(node.Props, "max") ?? 1;
                        var val = GetDouble(node.Props, "value") ?? min;
                        var s = new Slider { Minimum = min, Maximum = max, Value = val };
                        var token = node.Props.HandlerId(ScriptEventType.Change);
                        s.IsEnabled = !string.IsNullOrWhiteSpace(token);
                        s.ValueChanged += (_, args) => _send(node.Id, ScriptEventType.Change, args.NewValue);
                        return s;
                    }

                case ScriptNodeType.TextField:
                    {
                        var tb = new TextBox { Text = GetString(node.Props, "value") ?? GetString(node.Props, "text") ?? "" };
                        var token = node.Props.HandlerId(ScriptEventType.Change);
                        tb.IsEnabled = !string.IsNullOrWhiteSpace(token);
                        tb.TextChanged += (_, __) => _send(node.Id, ScriptEventType.Change, tb.Text);
                        return tb;
                    }

                case ScriptNodeType.TextEditor:
                    {
                        var tb = new TextBox { AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, Height = 140, Text = GetString(node.Props, "value") ?? GetString(node.Props, "text") ?? "" };
                        var token = node.Props.HandlerId(ScriptEventType.Change);
                        tb.IsEnabled = !string.IsNullOrWhiteSpace(token);
                        tb.TextChanged += (_, __) => _send(node.Id, ScriptEventType.Change, tb.Text);
                        return tb;
                    }

                default:
                    {
                        // Fallback: render children
                        var sp = new StackPanel { Orientation = Orientation.Vertical, Spacing = 8 };
                        foreach (var c in node.Children) sp.Children.Add(RenderNode(c));
                        return sp;
                    }
            }
        }

        private static string? GetString(ScriptNodeProps props, string key)
        {
            return props.Raw.TryGetValue(key, out var v) ? (v?.ToString()) : null;
        }

        private static double? GetDouble(ScriptNodeProps props, string key)
        {
            if (!props.Raw.TryGetValue(key, out var v) || v == null) return null;
            if (v is double d) return d;
            if (v is float f) return f;
            if (v is int i) return i;
            if (v is long l) return l;
            if (double.TryParse(v.ToString(), out var parsed)) return parsed;
            return null;
        }
    }
}
