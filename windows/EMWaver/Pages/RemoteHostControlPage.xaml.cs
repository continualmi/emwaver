using EMWaver.Services.Cloud;
using EMWaver.Scripting;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.UI;
using System.Linq;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Input;
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
            if (ReferenceEquals(AppServices.RemoteControlClient.Delegate, this))
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

    // --- Remote renderer ---
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
                case ScriptNodeType.Row:
                    {
                        var vertical = node.Type == ScriptNodeType.Column;
                        var sp = new StackPanel
                        {
                            Orientation = vertical ? Orientation.Vertical : Orientation.Horizontal,
                            Spacing = GetDouble(node.Props, "spacing") ?? 8,
                        };
                        foreach (var c in node.Children) sp.Children.Add(RenderNode(c));
                        return sp;
                    }
                case ScriptNodeType.Scroll:
                    {
                        var axis = (GetString(node.Props, "axis") ?? "vertical").Trim().ToLowerInvariant();
                        var content = new StackPanel
                        {
                            Orientation = axis == "horizontal" ? Orientation.Horizontal : Orientation.Vertical,
                            Spacing = GetDouble(node.Props, "spacing") ?? 8,
                        };
                        foreach (var c in node.Children) content.Children.Add(RenderNode(c));
                        return new ScrollViewer
                        {
                            Content = content,
                            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
                            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                        };
                    }
                case ScriptNodeType.Text:
                    return new TextBlock { Text = GetString(node.Props, "text") ?? "", TextWrapping = TextWrapping.Wrap };

                case ScriptNodeType.Divider:
                    return new Border { Height = 1, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(40, 255, 255, 255)) };

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
                        var tokenSubmit = node.Props.HandlerId(ScriptEventType.Submit);
                        var tokenChange = node.Props.HandlerId(ScriptEventType.Change);
                        s.IsEnabled = !string.IsNullOrWhiteSpace(tokenSubmit) || !string.IsNullOrWhiteSpace(tokenChange);
                        s.ValueChanged += (_, args) =>
                        {
                            if (!string.IsNullOrWhiteSpace(tokenSubmit)) return;
                            if (!string.IsNullOrWhiteSpace(tokenChange)) _send(node.Id, ScriptEventType.Change, args.NewValue);
                        };
                        s.AddHandler(UIElement.PointerReleasedEvent, new PointerEventHandler((_, __) =>
                        {
                            if (!string.IsNullOrWhiteSpace(tokenSubmit)) _send(node.Id, ScriptEventType.Submit, s.Value);
                        }), handledEventsToo: true);
                        return s;
                    }

                case ScriptNodeType.Picker:
                    {
                        var combo = new ComboBox();
                        var selected = GetString(node.Props, "selected") ?? string.Empty;
                        if (node.Props.Raw.TryGetValue("options", out var optRaw) && optRaw is List<object?> opts)
                        {
                            foreach (var item in opts)
                            {
                                if (item is Dictionary<string, object?> dict)
                                {
                                    var label = dict.TryGetValue("label", out var l) ? l?.ToString() : null;
                                    var value = dict.TryGetValue("value", out var v) ? v?.ToString() : null;
                                    combo.Items.Add(new ComboBoxItem { Content = label ?? value ?? string.Empty, Tag = value ?? label ?? string.Empty });
                                }
                            }
                        }
                        foreach (var it in combo.Items.OfType<ComboBoxItem>())
                        {
                            if (string.Equals(it.Tag?.ToString(), selected, StringComparison.Ordinal))
                            {
                                combo.SelectedItem = it;
                                break;
                            }
                        }
                        var token = node.Props.HandlerId(ScriptEventType.Change);
                        combo.IsEnabled = !string.IsNullOrWhiteSpace(token);
                        combo.SelectionChanged += (_, __) =>
                        {
                            if (combo.SelectedItem is ComboBoxItem cbi) _send(node.Id, ScriptEventType.Change, cbi.Tag?.ToString() ?? string.Empty);
                        };
                        return WrapLabel(node, combo);
                    }

                case ScriptNodeType.TextField:
                    {
                        var tb = new TextBox
                        {
                            PlaceholderText = GetString(node.Props, "placeholder") ?? string.Empty,
                            Text = GetString(node.Props, "value") ?? GetString(node.Props, "text") ?? string.Empty,
                        };
                        var token = node.Props.HandlerId(ScriptEventType.Change);
                        var submit = node.Props.HandlerId(ScriptEventType.Submit);
                        tb.IsEnabled = !string.IsNullOrWhiteSpace(token) || !string.IsNullOrWhiteSpace(submit);
                        tb.TextChanged += (_, __) => { if (!string.IsNullOrWhiteSpace(token)) _send(node.Id, ScriptEventType.Change, tb.Text); };
                        tb.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter && !string.IsNullOrWhiteSpace(submit)) _send(node.Id, ScriptEventType.Submit, tb.Text); };
                        return WrapLabel(node, tb);
                    }

                case ScriptNodeType.TextEditor:
                    {
                        var tb = new TextBox { AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, Height = 140, Text = GetString(node.Props, "value") ?? GetString(node.Props, "text") ?? "" };
                        var token = node.Props.HandlerId(ScriptEventType.Change);
                        tb.IsEnabled = !string.IsNullOrWhiteSpace(token);
                        tb.TextChanged += (_, __) => _send(node.Id, ScriptEventType.Change, tb.Text);
                        return tb;
                    }

                case ScriptNodeType.Plot:
                    {
                        // Placeholder visualization for remote view: script remains controllable and can report plot errors.
                        var border = new Border
                        {
                            Height = GetDouble(node.Props, "height") ?? 240,
                            BorderThickness = new Thickness(1),
                            BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(40, 255, 255, 255)),
                            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(18, 255, 255, 255)),
                            CornerRadius = new CornerRadius(8),
                            Padding = new Thickness(10),
                        };
                        var errorText = GetString(node.Props, "errorText");
                        border.Child = new TextBlock
                        {
                            Text = string.IsNullOrWhiteSpace(errorText) ? "Plot preview is not supported in this remote view yet." : "Chart error: " + errorText,
                            TextWrapping = TextWrapping.Wrap,
                            Opacity = 0.85,
                        };
                        return border;
                    }

                default:
                    {
                        var sp = new StackPanel { Orientation = Orientation.Vertical, Spacing = 8 };
                        foreach (var c in node.Children) sp.Children.Add(RenderNode(c));
                        return sp;
                    }
            }
        }

        private static UIElement WrapLabel(ScriptNode node, UIElement content)
        {
            var label = GetString(node.Props, "label");
            if (string.IsNullOrWhiteSpace(label)) return content;
            var panel = new StackPanel { Orientation = Orientation.Vertical, Spacing = 6 };
            panel.Children.Add(new TextBlock { Text = label, FontSize = 13, FontWeight = new Windows.UI.Text.FontWeight { Weight = 600 } });
            panel.Children.Add(content);
            return panel;
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
