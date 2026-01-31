using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using System;
using System.Collections.Generic;
using Windows.UI;
using Windows.UI.Text;

namespace EMWaver.Scripting.Render;

internal static class ScriptPropParsers
{
    internal static double? GetDouble(Dictionary<string, object?> raw, string key)
    {
        if (!raw.TryGetValue(key, out var v) || v == null) return null;
        if (v is double d) return d;
        if (v is float f) return f;
        if (v is int i) return i;
        if (v is long l) return l;
        if (v is decimal m) return (double)m;
        if (v is string s && double.TryParse(s, out var parsed)) return parsed;
        return null;
    }

    internal static int? GetInt(Dictionary<string, object?> raw, string key)
    {
        if (!raw.TryGetValue(key, out var v) || v == null) return null;
        if (v is int i) return i;
        if (v is long l) return (int)l;
        if (v is double d) return (int)d;
        if (v is string s && int.TryParse(s, out var parsed)) return parsed;
        return null;
    }

    internal static bool? GetBool(Dictionary<string, object?> raw, string key)
    {
        if (!raw.TryGetValue(key, out var v) || v == null) return null;
        if (v is bool b) return b;
        if (v is string s && bool.TryParse(s, out var parsed)) return parsed;
        if (v is int i) return i != 0;
        if (v is long l) return l != 0;
        if (v is double d) return Math.Abs(d) > double.Epsilon;
        return null;
    }

    internal static string? GetString(Dictionary<string, object?> raw, string key)
    {
        if (!raw.TryGetValue(key, out var v) || v == null) return null;
        return v as string ?? v.ToString();
    }

    internal static Thickness? GetPadding(Dictionary<string, object?> raw)
    {
        if (!raw.TryGetValue("padding", out var v) || v == null) return null;
        if (v is double d) return new Thickness(d);
        if (v is int i) return new Thickness(i);
        if (v is Dictionary<string, object?> dict)
        {
            var top = GetDouble(dict, "top") ?? 0;
            var bottom = GetDouble(dict, "bottom") ?? 0;
            var leading = GetDouble(dict, "leading") ?? 0;
            var trailing = GetDouble(dict, "trailing") ?? 0;
            return new Thickness(leading, top, trailing, bottom);
        }
        return null;
    }

    internal static HorizontalAlignment? GetHorizontalAlignment(Dictionary<string, object?> raw)
    {
        var value = GetString(raw, "alignment");
        if (string.IsNullOrWhiteSpace(value)) return null;
        switch (value.Trim().ToLowerInvariant())
        {
            case "leading":
            case "start":
                return HorizontalAlignment.Left;
            case "trailing":
            case "end":
                return HorizontalAlignment.Right;
            case "center":
                return HorizontalAlignment.Center;
            default:
                return null;
        }
    }

    internal static SolidColorBrush? ParseBrush(Dictionary<string, object?> raw, string key)
    {
        var value = GetString(raw, key);
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (TryParseColor(value.Trim(), out var color))
        {
            return new SolidColorBrush(color);
        }
        return null;
    }

    internal static bool TryParseColor(string raw, out Color color)
    {
        color = Color.FromArgb(0, 0, 0, 0);
        if (string.IsNullOrWhiteSpace(raw)) return false;
        var s = raw.Trim();

        if (s.StartsWith("#", StringComparison.Ordinal))
        {
            return TryParseHex(s.Substring(1), out color);
        }
        if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
        {
            return TryParseHex(s.Substring(2), out color);
        }

        switch (s.ToLowerInvariant())
        {
            case "blue": color = Color.FromArgb(255, 0, 120, 212); return true;
            case "green": color = Color.FromArgb(255, 16, 124, 16); return true;
            case "red": color = Color.FromArgb(255, 232, 17, 35); return true;
            case "orange": color = Color.FromArgb(255, 247, 99, 12); return true;
            case "yellow": color = Color.FromArgb(255, 255, 185, 0); return true;
            case "pink": color = Color.FromArgb(255, 231, 72, 86); return true;
            case "purple": color = Color.FromArgb(255, 136, 23, 152); return true;
            case "gray": color = Color.FromArgb(255, 128, 128, 128); return true;
            case "white": color = Color.FromArgb(255, 255, 255, 255); return true;
            case "black": color = Color.FromArgb(255, 0, 0, 0); return true;
            case "teal": color = Color.FromArgb(255, 0, 153, 188); return true;
            case "cyan": color = Color.FromArgb(255, 0, 255, 255); return true;
            case "indigo": color = Color.FromArgb(255, 75, 0, 130); return true;
            case "brown": color = Color.FromArgb(255, 130, 100, 74); return true;
            default:
                return false;
        }
    }

    private static bool TryParseHex(string hex, out Color color)
    {
        color = Color.FromArgb(0, 0, 0, 0);
        var cleaned = hex.Replace("_", "").Replace(" ", "");
        if (cleaned.Length != 6 && cleaned.Length != 8) return false;
        if (!uint.TryParse(cleaned, System.Globalization.NumberStyles.HexNumber, null, out var value)) return false;

        if (cleaned.Length == 6)
        {
            var r = (byte)((value & 0xFF0000) >> 16);
            var g = (byte)((value & 0x00FF00) >> 8);
            var b = (byte)(value & 0x0000FF);
            color = Color.FromArgb(255, r, g, b);
            return true;
        }
        else
        {
            var r = (byte)((value & 0xFF000000) >> 24);
            var g = (byte)((value & 0x00FF0000) >> 16);
            var b = (byte)((value & 0x0000FF00) >> 8);
            var a = (byte)(value & 0x000000FF);
            color = Color.FromArgb(a, r, g, b);
            return true;
        }
    }

    internal static double GetSpacing(Dictionary<string, object?> raw, double fallback)
    {
        return GetDouble(raw, "spacing") ?? fallback;
    }

    internal static void ApplyCommonFrameworkProps(FrameworkElement element, Dictionary<string, object?> raw)
    {
        var fillsWidth = GetBool(raw, "fillsWidth") ?? true;
        if (fillsWidth)
        {
            element.HorizontalAlignment = HorizontalAlignment.Stretch;
        }

        var width = GetDouble(raw, "width");
        var height = GetDouble(raw, "height");
        if (width.HasValue) element.Width = width.Value;
        if (height.HasValue) element.Height = height.Value;

        var minWidth = GetDouble(raw, "minWidth");
        var maxWidth = GetDouble(raw, "maxWidth");
        var minHeight = GetDouble(raw, "minHeight");
        var maxHeight = GetDouble(raw, "maxHeight");
        if (minWidth.HasValue) element.MinWidth = minWidth.Value;
        if (maxWidth.HasValue) element.MaxWidth = maxWidth.Value;
        if (minHeight.HasValue) element.MinHeight = minHeight.Value;
        if (maxHeight.HasValue) element.MaxHeight = maxHeight.Value;

        var align = GetHorizontalAlignment(raw);
        if (align.HasValue) element.HorizontalAlignment = align.Value;
    }

    internal static void ApplyTextProps(Microsoft.UI.Xaml.Controls.TextBlock text, Dictionary<string, object?> raw)
    {
        var font = GetString(raw, "font");
        if (!string.IsNullOrWhiteSpace(font))
        {
            switch (font.Trim().ToLowerInvariant())
            {
                case "largetitle": text.FontSize = 34; break;
                case "title": text.FontSize = 28; break;
                case "title2": text.FontSize = 22; break;
                case "title3": text.FontSize = 20; break;
                case "headline": text.FontSize = 18; break;
                case "subheadline": text.FontSize = 16; break;
                case "body": text.FontSize = 14; break;
                case "callout": text.FontSize = 14; break;
                case "caption": text.FontSize = 12; break;
                case "caption2": text.FontSize = 11; break;
                case "footnote": text.FontSize = 12; break;
            }
        }

        var weight = GetString(raw, "fontWeight");
        if (!string.IsNullOrWhiteSpace(weight))
        {
            switch (weight.Trim().ToLowerInvariant())
            {
            case "ultralight": text.FontWeight = new FontWeight { Weight = 200 }; break;
            case "thin": text.FontWeight = new FontWeight { Weight = 250 }; break;
            case "light": text.FontWeight = new FontWeight { Weight = 300 }; break;
            case "regular": text.FontWeight = new FontWeight { Weight = 400 }; break;
            case "medium": text.FontWeight = new FontWeight { Weight = 500 }; break;
            case "semibold": text.FontWeight = new FontWeight { Weight = 600 }; break;
            case "bold": text.FontWeight = new FontWeight { Weight = 700 }; break;
            case "heavy": text.FontWeight = new FontWeight { Weight = 800 }; break;
            case "black": text.FontWeight = new FontWeight { Weight = 900 }; break;
            }
        }

        var brush = ParseBrush(raw, "foregroundColor");
        if (brush != null) text.Foreground = brush;
    }
}
