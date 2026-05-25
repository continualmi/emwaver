using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using EMWaver.Services;
using System;
using System.Collections.Generic;
using System.Linq;

namespace EMWaver.Scripting.Render;

public sealed class ScriptRenderer
{
    private readonly Action<string, IReadOnlyList<object?>> _invokeHandler;

    public ScriptRenderer(Action<string, IReadOnlyList<object?>> invokeHandler)
    {
        _invokeHandler = invokeHandler;
    }

    public UIElement Render(ScriptTree? tree)
    {
        if (tree?.Root == null)
        {
            return new Grid();
        }
        return RenderNode(tree.Root);
    }

    public UIElement RenderNodeElement(ScriptNode node)
    {
        return RenderNode(node);
    }

    public static List<ScriptNode> CollectModalNodes(ScriptNode node)
    {
        var modals = new List<ScriptNode>();
        Walk(node);
        return modals;

        void Walk(ScriptNode n)
        {
            if (n.Type == ScriptNodeType.Modal) modals.Add(n);
            foreach (var c in n.Children) Walk(c);
        }
    }

    private UIElement RenderNode(ScriptNode node)
    {
        UIElement baseElement = node.Type switch
        {
            ScriptNodeType.Column => RenderStack(node, System.Windows.Controls.Orientation.Vertical),
            ScriptNodeType.Row => RenderStack(node, System.Windows.Controls.Orientation.Horizontal),
            ScriptNodeType.Card => RenderCard(node),
            ScriptNodeType.Tile => RenderTile(node),
            ScriptNodeType.Text => RenderText(node),
            ScriptNodeType.Button => RenderButton(node),
            ScriptNodeType.Slider => RenderSlider(node),
            ScriptNodeType.LogViewer => RenderLogViewer(node),
            ScriptNodeType.Scroll => RenderScroll(node),
            ScriptNodeType.TextField => RenderTextField(node, multiline: false),
            ScriptNodeType.TextEditor => RenderTextField(node, multiline: true),
            ScriptNodeType.Picker => RenderPicker(node),
            ScriptNodeType.Toggle => RenderToggle(node),
            ScriptNodeType.Grid => RenderGrid(node),
            ScriptNodeType.Plot => RenderPlot(node),
            ScriptNodeType.Modal => new System.Windows.Controls.Grid(), // handled separately
            ScriptNodeType.Spacer => RenderSpacer(node),
            ScriptNodeType.Divider => new System.Windows.Controls.Border { Height = 1, Background = ThemeResources.Brush("GeneratedDividerBrush", Color.FromArgb(40, 255, 255, 255)) },
            ScriptNodeType.Progress => RenderProgress(node),
            _ => new System.Windows.Controls.Grid(),
        };

        return ApplyModifiers(baseElement, node);
    }

    private UIElement ApplyModifiers(UIElement element, ScriptNode node)
    {
        var raw = node.Props.Raw;

        // Foreground color: apply directly when possible.
        var foreground = ScriptPropParsers.ParseBrush(raw, "foregroundColor");
        if (foreground != null)
        {
            if (element is System.Windows.Controls.TextBlock tb)
            {
                tb.Foreground = foreground;
            }
            else if (element is System.Windows.Controls.Control c)
            {
                c.Foreground = foreground;
            }
        }

        if (element is FrameworkElement fe)
        {
            ScriptPropParsers.ApplyCommonFrameworkProps(fe, raw);
        }

        Thickness? padding = null;
        Brush? background = null;
        double? cornerRadius = null;

        // Nodes that already own their container styling.
        var ownsContainer = node.Type == ScriptNodeType.Card
            || node.Type == ScriptNodeType.Tile
            || node.Type == ScriptNodeType.LogViewer
            || node.Type == ScriptNodeType.Plot;

        if (!ownsContainer)
        {
            padding = ScriptPropParsers.GetPadding(raw);
            background = ScriptPropParsers.ParseBrush(raw, "backgroundColor");
            cornerRadius = ScriptPropParsers.GetDouble(raw, "cornerRadius");
        }

        if (padding == null && background == null && !cornerRadius.HasValue)
        {
            return element;
        }

        var wrapper = new System.Windows.Controls.Border
        {
            Padding = padding ?? new Thickness(0),
            Background = background,
            CornerRadius = new CornerRadius(cornerRadius ?? 0),
            Child = element,
        };

        if (element is FrameworkElement child)
        {
            wrapper.HorizontalAlignment = child.HorizontalAlignment;
            wrapper.VerticalAlignment = child.VerticalAlignment;
            wrapper.Margin = child.Margin;
            wrapper.Width = child.Width;
            wrapper.Height = child.Height;
            wrapper.MinWidth = child.MinWidth;
            wrapper.MinHeight = child.MinHeight;
            wrapper.MaxWidth = child.MaxWidth;
            wrapper.MaxHeight = child.MaxHeight;

            // Reset child's layout so the wrapper becomes the layout surface.
            child.Margin = new Thickness(0);
            child.Width = double.NaN;
            child.Height = double.NaN;
            child.MinWidth = 0;
            child.MinHeight = 0;
            child.MaxWidth = double.PositiveInfinity;
            child.MaxHeight = double.PositiveInfinity;
        }

        return wrapper;
    }

    private UIElement RenderStack(ScriptNode node, System.Windows.Controls.Orientation orientation)
    {
        var raw = node.Props.Raw;
        var spacing = ScriptPropParsers.GetSpacing(raw, fallback: 8);
        var children = node.Children.Select(RenderNode).ToList();

        if (orientation == System.Windows.Controls.Orientation.Horizontal)
        {
            // Avoid WPF StackPanel's infinite horizontal measure, which causes script UIs
            // to overflow and create horizontal scrolling. A star grid keeps row children
            // inside the preview viewport, matching the macOS adaptive layout more closely.
            var grid = new System.Windows.Controls.Grid { HorizontalAlignment = HorizontalAlignment.Stretch };
            for (var i = 0; i < children.Count; i++)
            {
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                var child = children[i];
                var positioned = child as FrameworkElement ?? new ContentControl { Content = child };
                positioned.HorizontalAlignment = HorizontalAlignment.Stretch;
                if (i > 0) positioned.Margin = new Thickness(spacing, 0, 0, 0);
                System.Windows.Controls.Grid.SetColumn(positioned, i);
                grid.Children.Add(positioned);
            }
            return grid;
        }

        var panel = new StackPanel
        {
            Orientation = orientation,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        for (var i = 0; i < children.Count; i++)
        {
            var child = children[i];
            if (child is FrameworkElement fe)
            {
                fe.HorizontalAlignment = HorizontalAlignment.Stretch;
                if (i > 0) fe.Margin = new Thickness(0, spacing, 0, 0);
            }
            panel.Children.Add(child);
        }
        return panel;
    }

    private UIElement RenderCard(ScriptNode node)
    {
        var raw = node.Props.Raw;
        var padding = ScriptPropParsers.GetPadding(raw) ?? new Thickness(16);
        var spacing = ScriptPropParsers.GetSpacing(raw, fallback: 12);

        var content = new StackPanel { Orientation = System.Windows.Controls.Orientation.Vertical };

        var title = ScriptPropParsers.GetString(raw, "title");
        var subtitle = ScriptPropParsers.GetString(raw, "subtitle");
        if (!string.IsNullOrWhiteSpace(title) || !string.IsNullOrWhiteSpace(subtitle))
        {
            var header = new StackPanel { Orientation = System.Windows.Controls.Orientation.Vertical, Margin = new Thickness(0, 0, 0, 10) };
            if (!string.IsNullOrWhiteSpace(title))
            {
                header.Children.Add(new System.Windows.Controls.TextBlock { Text = title, FontSize = 18, FontWeight = FontWeights.SemiBold });
            }
            if (!string.IsNullOrWhiteSpace(subtitle))
            {
                header.Children.Add(new System.Windows.Controls.TextBlock { Text = subtitle, FontSize = 12, Opacity = 0.75 });
            }
            content.Children.Add(header);
        }

        for (var i = 0; i < node.Children.Count; i++)
        {
            var child = RenderNode(node.Children[i]);
            if (child is FrameworkElement fe && i > 0)
            {
                fe.Margin = new Thickness(0, spacing, 0, 0);
            }
            content.Children.Add(child);
        }

        var border = new System.Windows.Controls.Border
        {
            Padding = padding,
            CornerRadius = new CornerRadius(ScriptPropParsers.GetDouble(raw, "cornerRadius") ?? 10),
            Background = ScriptPropParsers.ParseBrush(raw, "backgroundColor") ?? ThemeResources.Brush("GeneratedSurfaceBackgroundBrush", Color.FromArgb(20, 255, 255, 255)),
            BorderBrush = ThemeResources.Brush("GeneratedSurfaceBorderBrush", Color.FromArgb(40, 255, 255, 255)),
            BorderThickness = new Thickness(1),
            Child = content,
        };
        return border;
    }

    private UIElement RenderTile(ScriptNode node)
    {
        var raw = node.Props.Raw;
        var title = ScriptPropParsers.GetString(raw, "title");
        var value = ScriptPropParsers.GetString(raw, "value");
        var subtitle = ScriptPropParsers.GetString(raw, "subtitle");
        var disabled = ScriptPropParsers.GetBool(raw, "disabled") ?? false;
        var monospace = ScriptPropParsers.GetBool(raw, "monospaceValue") ?? false;

        var token = node.Props.HandlerId(ScriptEventType.Tap);
        var canTap = !disabled && !string.IsNullOrWhiteSpace(token);

        var stack = new StackPanel { Orientation = System.Windows.Controls.Orientation.Vertical };
        if (!string.IsNullOrWhiteSpace(title))
        {
            stack.Children.Add(new System.Windows.Controls.TextBlock { Text = title.ToUpperInvariant(), FontSize = 11, Opacity = 0.75 });
        }
        if (!string.IsNullOrWhiteSpace(value))
        {
            var valueTb = new System.Windows.Controls.TextBlock { Text = value, FontSize = 14 };
            if (monospace) valueTb.FontFamily = new FontFamily("Consolas");
            stack.Children.Add(valueTb);
        }
        if (!string.IsNullOrWhiteSpace(subtitle))
        {
            stack.Children.Add(new System.Windows.Controls.TextBlock { Text = subtitle, FontSize = 12, Opacity = 0.75 });
        }

        var tileBody = new System.Windows.Controls.Border
        {
            Padding = new Thickness(10),
            CornerRadius = new CornerRadius(ScriptPropParsers.GetDouble(raw, "cornerRadius") ?? 10),
            Background = ScriptPropParsers.ParseBrush(raw, "backgroundColor") ?? ThemeResources.Brush("GeneratedSurfaceBackgroundBrush", Color.FromArgb(20, 255, 255, 255)),
            BorderBrush = ThemeResources.Brush("GeneratedSurfaceBorderBrush", Color.FromArgb(40, 255, 255, 255)),
            BorderThickness = new Thickness(1),
            Child = stack,
            Opacity = disabled ? 0.6 : 1.0,
        };

        if (canTap)
        {
            var btn = new System.Windows.Controls.Button
            {
                Content = tileBody,
                Padding = new Thickness(0),
                Background = null,
                BorderThickness = new Thickness(0),
            };
            btn.Click += (_, __) => _invokeHandler(token!, Array.Empty<object?>());
            return btn;
        }

        return tileBody;
    }

    private UIElement RenderText(ScriptNode node)
    {
        var raw = node.Props.Raw;
        var text = ScriptPropParsers.GetString(raw, "text") ?? ScriptPropParsers.GetString(raw, "label") ?? string.Empty;
        var tb = new System.Windows.Controls.TextBlock { Text = text, TextWrapping = TextWrapping.Wrap };
        ScriptPropParsers.ApplyTextProps(tb, raw);
        return tb;
    }

    private UIElement RenderButton(ScriptNode node)
    {
        var raw = node.Props.Raw;
        var label = ScriptPropParsers.GetString(raw, "label") ?? "Button";
        var token = node.Props.HandlerId(ScriptEventType.Tap);

        var btn = new System.Windows.Controls.Button { Content = label };
        if (!string.IsNullOrWhiteSpace(token))
        {
            btn.Click += (_, __) => _invokeHandler(token!, Array.Empty<object?>());
        }
        return btn;
    }

    private UIElement RenderSlider(ScriptNode node)
    {
        var raw = node.Props.Raw;
        var label = ScriptPropParsers.GetString(raw, "label");
        var value = ScriptPropParsers.GetDouble(raw, "value") ?? 0;
        var min = ScriptPropParsers.GetDouble(raw, "min") ?? 0;
        var max = ScriptPropParsers.GetDouble(raw, "max") ?? 1;
        if (min > max) (min, max) = (max, min);

        var tokenSubmit = node.Props.HandlerId(ScriptEventType.Submit);
        var tokenChange = node.Props.HandlerId(ScriptEventType.Change);

        var slider = new System.Windows.Controls.Slider { Minimum = min, Maximum = max, Value = Math.Clamp(value, min, max) };

        // Windows quirk: many scripts call render() from slider handlers.
        // Treat sliders as commit-on-release to avoid UI rebuild fighting the drag.
        var isDragging = false;

        // WPF: use Preview mouse events so we get them even if the thumb captures the mouse.
        slider.PreviewMouseLeftButtonDown += (_, __) => { isDragging = true; };
        slider.PreviewMouseLeftButtonUp += (_, __) =>
        {
            var wasDragging = isDragging;
            isDragging = false;
            if (!wasDragging) return;
            var token = tokenSubmit ?? tokenChange;
            if (!string.IsNullOrWhiteSpace(token)) _invokeHandler(token!, new object?[] { slider.Value });
        };

        slider.LostMouseCapture += (_, __) =>
        {
            var wasDragging = isDragging;
            isDragging = false;
            if (!wasDragging) return;
            var token = tokenSubmit ?? tokenChange;
            if (!string.IsNullOrWhiteSpace(token)) _invokeHandler(token!, new object?[] { slider.Value });
        };

        slider.ValueChanged += (_, e) =>
        {
            if (isDragging) return;
            if (!string.IsNullOrWhiteSpace(tokenSubmit)) return;
            if (!string.IsNullOrWhiteSpace(tokenChange)) _invokeHandler(tokenChange!, new object?[] { e.NewValue });
        };

        if (string.IsNullOrWhiteSpace(label))
        {
            return slider;
        }

        return new StackPanel
        {
            Orientation = System.Windows.Controls.Orientation.Vertical,
            Children =
            {
                new System.Windows.Controls.TextBlock { Text = label, FontSize = 12, Opacity = 0.75 },
                slider,
            }
        };
    }

    private UIElement RenderLogViewer(ScriptNode node)
    {
        var raw = node.Props.Raw;
        var text = ScriptPropParsers.GetString(raw, "text") ?? string.Empty;

        var tb = new System.Windows.Controls.TextBlock
        {
            Text = text,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 12,
            TextWrapping = TextWrapping.Wrap,
        };

        return new System.Windows.Controls.Border
        {
            Padding = new Thickness(8),
            CornerRadius = new CornerRadius(ScriptPropParsers.GetDouble(raw, "cornerRadius") ?? 8),
            Background = ScriptPropParsers.ParseBrush(raw, "backgroundColor") ?? ThemeResources.Brush("GeneratedSurfaceBackgroundBrush", Color.FromArgb(18, 255, 255, 255)),
            Child = new ScrollViewer
            {
                Content = tb,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            }
        };
    }

    private UIElement RenderScroll(ScriptNode node)
    {
        var raw = node.Props.Raw;
        var axis = (ScriptPropParsers.GetString(raw, "axis") ?? "vertical").Trim().ToLowerInvariant();
        var showsIndicators = ScriptPropParsers.GetBool(raw, "showsIndicators") ?? true;

        UIElement content;
        if (axis == "horizontal")
        {
            content = RenderStack(node, System.Windows.Controls.Orientation.Horizontal);
        }
        else
        {
            content = RenderStack(node, System.Windows.Controls.Orientation.Vertical);
        }

        return new ScrollViewer
        {
            Content = content,
            HorizontalScrollBarVisibility = axis == "horizontal"
                ? (showsIndicators ? ScrollBarVisibility.Auto : ScrollBarVisibility.Hidden)
                : ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = axis == "horizontal"
                ? ScrollBarVisibility.Disabled
                : (showsIndicators ? ScrollBarVisibility.Auto : ScrollBarVisibility.Hidden),
        };
    }

    private UIElement RenderTextField(ScriptNode node, bool multiline)
    {
        var raw = node.Props.Raw;
        var label = ScriptPropParsers.GetString(raw, "label");
        var placeholder = ScriptPropParsers.GetString(raw, "placeholder") ?? string.Empty;
        var value = ScriptPropParsers.GetString(raw, "value") ?? string.Empty;
        var isSecure = ScriptPropParsers.GetBool(raw, "secure") ?? false;

        var changeToken = node.Props.HandlerId(ScriptEventType.Change);
        var submitToken = node.Props.HandlerId(ScriptEventType.Submit);

        UIElement input;
        if (!multiline && isSecure)
        {
            // WPF PasswordBox doesn't have PlaceholderText natively; use a small workaround.
            var pb = new System.Windows.Controls.PasswordBox { Password = value };
            PlaceholderHelper.SetPlaceholder(pb, placeholder);
            pb.PasswordChanged += (_, __) =>
            {
                if (!string.IsNullOrWhiteSpace(changeToken)) _invokeHandler(changeToken!, new object?[] { pb.Password });
            };
            input = pb;
        }
        else
        {
            var tb = new System.Windows.Controls.TextBox
            {
                Text = value,
                AcceptsReturn = multiline,
                TextWrapping = multiline ? TextWrapping.Wrap : TextWrapping.NoWrap,
            };
            PlaceholderHelper.SetPlaceholder(tb, placeholder);
            tb.TextChanged += (_, __) =>
            {
                if (!string.IsNullOrWhiteSpace(changeToken)) _invokeHandler(changeToken!, new object?[] { tb.Text });
            };
            tb.KeyDown += (_, e) =>
            {
                if (e.Key == Key.Enter && !string.IsNullOrWhiteSpace(submitToken))
                {
                    _invokeHandler(submitToken!, new object?[] { tb.Text });
                }
            };
            input = tb;
        }

        if (string.IsNullOrWhiteSpace(label))
        {
            return input;
        }

        return new StackPanel
        {
            Orientation = System.Windows.Controls.Orientation.Vertical,
            Children =
            {
                new System.Windows.Controls.TextBlock { Text = label, FontSize = 14, FontWeight = FontWeights.SemiBold },
                input,
            }
        };
    }

    private UIElement RenderPicker(ScriptNode node)
    {
        var raw = node.Props.Raw;
        var label = ScriptPropParsers.GetString(raw, "label");
        var selected = ScriptPropParsers.GetString(raw, "selected") ?? string.Empty;
        var token = node.Props.HandlerId(ScriptEventType.Change);

        var combo = new System.Windows.Controls.ComboBox();
        if (raw.TryGetValue("options", out var optRaw) && optRaw is List<object?> opts)
        {
            foreach (var item in opts)
            {
                if (item is Dictionary<string, object?> dict)
                {
                    var optLabel = dict.TryGetValue("label", out var l) ? l?.ToString() : null;
                    var optValue = dict.TryGetValue("value", out var v) ? v?.ToString() : null;
                    var tag = optValue ?? optLabel ?? string.Empty;
                    combo.Items.Add(new ComboBoxItem { Content = optLabel ?? tag, Tag = tag });
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

        var lastValue = selected;
        combo.SelectionChanged += (_, __) =>
        {
            if (combo.SelectedItem is not ComboBoxItem cbi) return;
            var next = cbi.Tag?.ToString() ?? string.Empty;
            if (string.Equals(next, lastValue, StringComparison.Ordinal)) return;
            lastValue = next;
            if (!string.IsNullOrWhiteSpace(token)) _invokeHandler(token!, new object?[] { next });
        };

        // Enable mouse-wheel scrolling inside the dropdown popup.
        // The popup has its own visual tree, so we must hook the ScrollViewer
        // each time the dropdown opens.
        combo.DropDownOpened += (_, __) =>
        {
            if (combo.Template?.FindName("PART_Popup", combo) is not System.Windows.Controls.Primitives.Popup popup)
                return;
            var sv = popup.Child as System.Windows.Controls.ScrollViewer
                     ?? (popup.Child as System.Windows.Controls.Border)?.Child as System.Windows.Controls.ScrollViewer;
            if (sv != null) sv.PreviewMouseWheel += OnComboPopupMouseWheel;

            void OnComboPopupMouseWheel(object s, MouseWheelEventArgs e)
            {
                var scrollViewer = s as System.Windows.Controls.ScrollViewer;
                scrollViewer?.ScrollToVerticalOffset(scrollViewer.VerticalOffset - e.Delta);
                e.Handled = true;
            }
        };
        combo.DropDownClosed += (_, __) =>
        {
            if (combo.Template?.FindName("PART_Popup", combo) is not System.Windows.Controls.Primitives.Popup popup)
                return;
            var sv = popup.Child as System.Windows.Controls.ScrollViewer
                     ?? (popup.Child as System.Windows.Controls.Border)?.Child as System.Windows.Controls.ScrollViewer;
            // Can't unsubscribe a local function, but the popup is torn down
            // when closed so the ScrollViewer is discarded anyway.
        };

        if (string.IsNullOrWhiteSpace(label))
        {
            return combo;
        }

        return new StackPanel
        {
            Orientation = System.Windows.Controls.Orientation.Vertical,
            Children =
            {
                new System.Windows.Controls.TextBlock { Text = label, FontSize = 14, FontWeight = FontWeights.SemiBold },
                combo,
            }
        };
    }

    private UIElement RenderToggle(ScriptNode node)
    {
        var raw = node.Props.Raw;
        var label = ScriptPropParsers.GetString(raw, "label") ?? string.Empty;
        var disabled = ScriptPropParsers.GetBool(raw, "disabled") ?? false;
        var selected = ScriptPropParsers.GetBool(raw, "value")
            ?? ScriptPropParsers.GetBool(raw, "selected")
            ?? false;
        var token = node.Props.HandlerId(ScriptEventType.Change);

        // WPF doesn't have ToggleSwitch natively; use CheckBox with toggle styling or just CheckBox.
        var toggle = new System.Windows.Controls.CheckBox
        {
            Content = string.IsNullOrWhiteSpace(label) ? null : label,
            IsChecked = selected,
            IsEnabled = !disabled,
        };
        toggle.Checked += (_, __) =>
        {
            if (!string.IsNullOrWhiteSpace(token)) _invokeHandler(token!, new object?[] { true });
        };
        toggle.Unchecked += (_, __) =>
        {
            if (!string.IsNullOrWhiteSpace(token)) _invokeHandler(token!, new object?[] { false });
        };
        return toggle;
    }

    private UIElement RenderGrid(ScriptNode node)
    {
        var raw = node.Props.Raw;
        var columns = Math.Max(1, ScriptPropParsers.GetInt(raw, "columns") ?? 2);
        var spacing = ScriptPropParsers.GetSpacing(raw, fallback: 8);
        var minColWidth = ScriptPropParsers.GetDouble(raw, "minColumnWidth");

        var grid = new System.Windows.Controls.Grid();
        for (var c = 0; c < columns; c++)
        {
            var cd = new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) };
            if (minColWidth.HasValue) cd.MinWidth = minColWidth.Value;
            grid.ColumnDefinitions.Add(cd);
        }

        var rows = (int)Math.Ceiling(node.Children.Count / (double)columns);
        for (var r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (var i = 0; i < node.Children.Count; i++)
        {
            var child = RenderNode(node.Children[i]);
            var positioned = child as FrameworkElement ?? new System.Windows.Controls.ContentControl { Content = child };
            var r = i / columns;
            var c = i % columns;
            if (positioned is FrameworkElement fe)
            {
                var left = c == 0 ? 0 : spacing;
                var top = r == 0 ? 0 : spacing;
                fe.Margin = new Thickness(left, top, 0, 0);
            }
            System.Windows.Controls.Grid.SetRow(positioned, r);
            System.Windows.Controls.Grid.SetColumn(positioned, c);
            grid.Children.Add(positioned);
        }

        return grid;
    }

    private UIElement RenderPlot(ScriptNode node)
    {
        var plot = new ScriptPlotControl();
        plot.Apply(node, _invokeHandler);
        return plot;
    }

    private UIElement RenderSpacer(ScriptNode node)
    {
        var raw = node.Props.Raw;
        var minLength = ScriptPropParsers.GetDouble(raw, "minLength") ?? 0;
        return new System.Windows.Controls.Border { Height = minLength };
    }

    private UIElement RenderProgress(ScriptNode node)
    {
        var raw = node.Props.Raw;
        var value = ScriptPropParsers.GetDouble(raw, "value");
        var total = ScriptPropParsers.GetDouble(raw, "total") ?? ScriptPropParsers.GetDouble(raw, "max");
        var label = ScriptPropParsers.GetString(raw, "label");
        var detail = ScriptPropParsers.GetString(raw, "detail");

        var pb = new System.Windows.Controls.ProgressBar
        {
            IsIndeterminate = !value.HasValue,
            Minimum = 0,
            Maximum = total ?? 1,
            Value = value.HasValue ? Math.Min(value.Value, total ?? 1) : 0,
        };

        if (pb.IsIndeterminate && pb.Value == 0) pb.Value = double.NaN;

        var panel = new StackPanel { Orientation = System.Windows.Controls.Orientation.Vertical };
        if (!string.IsNullOrWhiteSpace(label))
        {
            panel.Children.Add(new System.Windows.Controls.TextBlock { Text = label, Margin = new Thickness(0, 0, 0, 4) });
        }
        panel.Children.Add(pb);
        if (!string.IsNullOrWhiteSpace(detail))
        {
            panel.Children.Add(new System.Windows.Controls.TextBlock { Text = detail, FontSize = 12, Opacity = 0.75, Margin = new Thickness(0, 2, 0, 0) });
        }
        return panel;
    }
}
