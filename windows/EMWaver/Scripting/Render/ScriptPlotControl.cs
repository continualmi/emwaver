using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using System;
using System.Collections.Generic;
using Windows.UI;

namespace EMWaver.Scripting.Render;

public sealed class ScriptPlotControl : UserControl
{
    private readonly Canvas _canvas;
    private readonly Polyline _line;
    private readonly Border _frame;

    private ScriptNode? _node;
    private Action<string, IReadOnlyList<object?>>? _invokeHandler;

    private double _xMin;
    private double _xMax;
    private int _bins;
    private string _sourceKey = string.Empty;
    private bool _isDragging;
    private double _dragStartX;
    private double _dragStartMin;
    private double _dragStartMax;

    public ScriptPlotControl()
    {
        _canvas = new Canvas();
        _line = new Polyline
        {
            Stroke = new SolidColorBrush(Color.FromArgb(255, 255, 255, 255)),
            StrokeThickness = 1.5,
            StrokeLineJoin = PenLineJoin.Round,
        };
        _canvas.Children.Add(_line);

        _frame = new Border
        {
            CornerRadius = new CornerRadius(10),
            Background = new SolidColorBrush(Color.FromArgb(18, 255, 255, 255)),
            BorderBrush = new SolidColorBrush(Color.FromArgb(40, 255, 255, 255)),
            BorderThickness = new Thickness(1),
            Child = _canvas,
        };

        Content = _frame;

        SizeChanged += (_, __) => Redraw();

        PointerPressed += OnPointerPressed;
        PointerMoved += OnPointerMoved;
        PointerReleased += OnPointerReleased;
        PointerWheelChanged += OnPointerWheelChanged;
    }

    public void Apply(ScriptNode node, Action<string, IReadOnlyList<object?>> invokeHandler)
    {
        _node = node;
        _invokeHandler = invokeHandler;

        var raw = node.Props.Raw;

        _bins = Math.Max(16, ScriptPropParsers.GetInt(raw, "bins") ?? 900);
        _xMin = ScriptPropParsers.GetDouble(raw, "xMin") ?? 0;
        _xMax = ScriptPropParsers.GetDouble(raw, "xMax") ?? 1;
        if (_xMax <= _xMin) _xMax = _xMin + 1;

        var height = ScriptPropParsers.GetDouble(raw, "height");
        if (height.HasValue) Height = height.Value;

        // Source can be:
        // - string (e.g. "samplerBits")
        // - object { kind: 'buffer', id: '<id>' }
        _sourceKey = ResolveSourceKey(raw);

        var errorText = ScriptPropParsers.GetString(raw, "errorText");
        if (!string.IsNullOrWhiteSpace(errorText))
        {
            _line.Points.Clear();
            _canvas.Children.Clear();
            _canvas.Children.Add(new TextBlock { Text = "Chart error: " + errorText, FontSize = 12, Opacity = 0.8, Margin = new Thickness(10) });
            return;
        }
        if (!_canvas.Children.Contains(_line))
        {
            _canvas.Children.Clear();
            _canvas.Children.Add(_line);
        }

        Redraw();
    }

    private static string ResolveSourceKey(Dictionary<string, object?> raw)
    {
        if (raw.TryGetValue("source", out var src))
        {
            if (src is string s)
            {
                return s;
            }
            if (src is Dictionary<string, object?> dict)
            {
                var kind = dict.TryGetValue("kind", out var k) ? k?.ToString() : null;
                if (string.Equals(kind, "buffer", StringComparison.OrdinalIgnoreCase))
                {
                    var id = dict.TryGetValue("id", out var v) ? v?.ToString() : null;
                    return id ?? string.Empty;
                }
            }
        }
        return string.Empty;
    }

    private void Redraw()
    {
        if (_node == null) return;

        var width = ActualWidth;
        var height = ActualHeight;
        if (double.IsNaN(width) || double.IsNaN(height) || width < 4 || height < 4) return;

        var bytes = !string.IsNullOrWhiteSpace(_sourceKey) ? PlotBufferStore.Shared.GetBytes(_sourceKey) : Array.Empty<byte>();
        if (bytes.Length == 0)
        {
            _line.Points.Clear();
            return;
        }

        var maxBits = bytes.Length * 8.0;
        var xMin = Math.Max(0, Math.Min(_xMin, maxBits));
        var xMax = Math.Max(0, Math.Min(_xMax, maxBits));
        if (xMax <= xMin) xMax = Math.Min(maxBits, xMin + 1);

        var bins = Math.Max(16, _bins);
        var startBit = (int)Math.Floor(xMin);
        var endBit = (int)Math.Ceiling(xMax);
        var compressed = CompressBits(bytes, startBit, endBit, bins);
        var points = new PointCollection();

        // Add a little padding so the signal doesn't draw right on the border.
        var padX = 6.0;
        var padY = 6.0;
        var plotW = Math.Max(1.0, width - padX * 2);
        var plotH = Math.Max(1.0, height - padY * 2);

        if (compressed.Count == 0)
        {
            _line.Points = points;
            return;
        }

        var domain = Math.Max(1.0, xMax - xMin);
        foreach (var (xBit, v) in compressed)
        {
            var norm = (xBit - xMin) / domain;
            norm = Math.Clamp(norm, 0.0, 1.0);
            var px = padX + norm * plotW;
            var py = padY + (1.0 - (v / 255.0)) * plotH;
            points.Add(new Windows.Foundation.Point(px, py));
        }

        _line.Points = points;
    }

    private static List<(double xBit, int y)> CompressBits(byte[] bytes, int startBit, int endBit, int bins)
    {
        var outPoints = new List<(double xBit, int y)>();
        var span = Math.Max(0, endBit - startBit);
        if (span <= 0 || bytes.Length == 0)
        {
            return outPoints;
        }

        static int BitAt(byte[] src, int idx)
        {
            var byteIndex = idx >> 3;
            var bitIndex = idx & 7;
            if (byteIndex < 0 || byteIndex >= src.Length) return 0;
            return ((src[byteIndex] >> bitIndex) & 1) == 1 ? 1 : 0;
        }

        // Match macOS behavior: for narrow spans draw every bit.
        if (span <= bins * 2)
        {
            outPoints.Capacity = span;
            for (var i = startBit; i < endBit; i++)
            {
                outPoints.Add((i, BitAt(bytes, i) == 1 ? 255 : 0));
            }
            return outPoints;
        }

        var binWidth = (double)span / bins;
        outPoints.Capacity = bins * 2;

        for (var bin = 0; bin < bins; bin++)
        {
            var binStart = (int)Math.Floor(startBit + bin * binWidth);
            var binEnd = (int)Math.Floor(binStart + binWidth);
            if (binEnd > endBit) binEnd = endBit;
            if (binEnd <= binStart) continue;

            var hasLow = false;
            var hasHigh = false;

            var i = binStart;
            while (i < binEnd)
            {
                var byteIndex = i >> 3;
                if (byteIndex >= bytes.Length) break;

                if ((i & 7) == 0 && i + 8 <= binEnd)
                {
                    var val = bytes[byteIndex];
                    if (val == 0) hasLow = true;
                    else if (val == 255) hasHigh = true;
                    else
                    {
                        hasLow = true;
                        hasHigh = true;
                    }
                    i += 8;
                }
                else
                {
                    if (BitAt(bytes, i) == 1) hasHigh = true;
                    else hasLow = true;
                    i += 1;
                }

                if (hasLow && hasHigh) break;
            }

            if (hasLow || hasHigh)
            {
                outPoints.Add((binStart, hasLow ? 0 : 255));
                outPoints.Add((Math.Max(binStart, binEnd - 1), hasHigh ? 255 : 0));
            }
        }

        return outPoints;
    }

    private void OnPointerPressed(object sender, Microsoft.UI.Xaml.Input.PointerRoutedEventArgs e)
    {
        _isDragging = true;
        var p = e.GetCurrentPoint(this);
        _dragStartX = p.Position.X;
        _dragStartMin = _xMin;
        _dragStartMax = _xMax;
        CapturePointer(e.Pointer);
    }

    private void OnPointerMoved(object sender, Microsoft.UI.Xaml.Input.PointerRoutedEventArgs e)
    {
        if (!_isDragging) return;
        if (_node == null) return;

        var bytes = !string.IsNullOrWhiteSpace(_sourceKey) ? PlotBufferStore.Shared.GetBytes(_sourceKey) : Array.Empty<byte>();
        var maxBits = bytes.Length * 8.0;
        if (maxBits <= 0) return;

        var p = e.GetCurrentPoint(this);
        var dxPx = p.Position.X - _dragStartX;
        var w = Math.Max(1.0, ActualWidth);
        var span = _dragStartMax - _dragStartMin;

        var dxBits = -(dxPx / w) * span;
        var min = _dragStartMin + dxBits;
        var max = _dragStartMax + dxBits;

        // Clamp.
        if (min < 0)
        {
            max -= min;
            min = 0;
        }
        if (max > maxBits)
        {
            var over = max - maxBits;
            min -= over;
            max = maxBits;
        }
        if (max <= min) max = Math.Min(maxBits, min + 1);

        _xMin = min;
        _xMax = max;
        Redraw();
    }

    private void OnPointerReleased(object sender, Microsoft.UI.Xaml.Input.PointerRoutedEventArgs e)
    {
        if (!_isDragging) return;
        _isDragging = false;
        ReleasePointerCapture(e.Pointer);
        FireViewportChange();
    }

    private void OnPointerWheelChanged(object sender, Microsoft.UI.Xaml.Input.PointerRoutedEventArgs e)
    {
        if (_node == null) return;

        var bytes = !string.IsNullOrWhiteSpace(_sourceKey) ? PlotBufferStore.Shared.GetBytes(_sourceKey) : Array.Empty<byte>();
        var maxBits = bytes.Length * 8.0;
        if (maxBits <= 0) return;

        // We implement our own horizontal zooming. Mark the event handled so parent
        // containers (e.g. ScrollViewer with ZoomMode enabled) don't also apply a
        // uniform zoom/scroll that feels like the chart is zooming vertically.
        e.Handled = true;

        var delta = e.GetCurrentPoint(this).Properties.MouseWheelDelta;
        var zoom = delta > 0 ? 0.85 : 1.15;

        var w = Math.Max(1.0, ActualWidth);
        var px = e.GetCurrentPoint(this).Position.X;
        var t = Math.Clamp(px / w, 0.0, 1.0);
        var center = _xMin + (_xMax - _xMin) * t;
        var span = (_xMax - _xMin) * zoom;
        span = Math.Clamp(span, 8, maxBits);

        var min = center - span * t;
        var max = min + span;

        // Clamp.
        if (min < 0)
        {
            max -= min;
            min = 0;
        }
        if (max > maxBits)
        {
            var over = max - maxBits;
            min -= over;
            max = maxBits;
        }
        if (max <= min) max = Math.Min(maxBits, min + 1);

        _xMin = min;
        _xMax = max;
        Redraw();
        FireViewportChange();
    }

    private void FireViewportChange()
    {
        if (_node == null || _invokeHandler == null) return;
        var token = _node.Props.HandlerId(ScriptEventType.Viewport);
        if (string.IsNullOrWhiteSpace(token)) return;

        var payload = new Dictionary<string, object?>
        {
            ["min"] = (int)Math.Round(_xMin),
            ["max"] = (int)Math.Round(_xMax),
        };

        _invokeHandler(token!, new object?[] { payload });
    }
}
