using System;
using System.Collections.Generic;

namespace EMWaver.Scripting;

public enum ScriptNodeType
{
    Column,
    Row,
    Card,
    Tile,
    Text,
    Button,
    Slider,
    LogViewer,
    Scroll,
    TextField,
    TextEditor,
    Picker,
    Toggle,
    Grid,
    Plot,
    Modal,
    Spacer,
    Divider,
    Progress,
}

public static class ScriptNodeTypeExtensions
{
    public static bool TryFromRaw(string? raw, out ScriptNodeType type)
    {
        type = default;
        if (string.IsNullOrWhiteSpace(raw)) return false;
        switch (raw.Trim())
        {
            case "column": type = ScriptNodeType.Column; return true;
            case "row": type = ScriptNodeType.Row; return true;
            case "card": type = ScriptNodeType.Card; return true;
            case "tile": type = ScriptNodeType.Tile; return true;
            case "text": type = ScriptNodeType.Text; return true;
            case "button": type = ScriptNodeType.Button; return true;
            case "slider": type = ScriptNodeType.Slider; return true;
            case "logViewer": type = ScriptNodeType.LogViewer; return true;
            case "scroll": type = ScriptNodeType.Scroll; return true;
            case "textField": type = ScriptNodeType.TextField; return true;
            case "textEditor": type = ScriptNodeType.TextEditor; return true;
            case "picker": type = ScriptNodeType.Picker; return true;
            case "toggle": type = ScriptNodeType.Toggle; return true;
            case "grid": type = ScriptNodeType.Grid; return true;
            case "plot": type = ScriptNodeType.Plot; return true;
            case "modal": type = ScriptNodeType.Modal; return true;
            case "spacer": type = ScriptNodeType.Spacer; return true;
            case "divider": type = ScriptNodeType.Divider; return true;
            case "progress": type = ScriptNodeType.Progress; return true;
            default: return false;
        }
    }

    public static string ToRaw(this ScriptNodeType type)
    {
        return type switch
        {
            ScriptNodeType.Column => "column",
            ScriptNodeType.Row => "row",
            ScriptNodeType.Card => "card",
            ScriptNodeType.Tile => "tile",
            ScriptNodeType.Text => "text",
            ScriptNodeType.Button => "button",
            ScriptNodeType.Slider => "slider",
            ScriptNodeType.LogViewer => "logViewer",
            ScriptNodeType.Scroll => "scroll",
            ScriptNodeType.TextField => "textField",
            ScriptNodeType.TextEditor => "textEditor",
            ScriptNodeType.Picker => "picker",
            ScriptNodeType.Toggle => "toggle",
            ScriptNodeType.Grid => "grid",
            ScriptNodeType.Plot => "plot",
            ScriptNodeType.Modal => "modal",
            ScriptNodeType.Spacer => "spacer",
            ScriptNodeType.Divider => "divider",
            ScriptNodeType.Progress => "progress",
            _ => "",
        };
    }
}

public enum ScriptEventType
{
    Tap,
    Change,
    Submit,
    Viewport,
    Select,
    Cursor,
    Close,
}

public static class ScriptEventTypeExtensions
{
    public static bool TryFromRaw(string? raw, out ScriptEventType type)
    {
        type = default;
        if (string.IsNullOrWhiteSpace(raw)) return false;
        switch (raw.Trim())
        {
            case "tap": type = ScriptEventType.Tap; return true;
            case "change": type = ScriptEventType.Change; return true;
            case "submit": type = ScriptEventType.Submit; return true;
            case "viewport": type = ScriptEventType.Viewport; return true;
            case "select": type = ScriptEventType.Select; return true;
            case "cursor": type = ScriptEventType.Cursor; return true;
            case "close": type = ScriptEventType.Close; return true;
            default: return false;
        }
    }

    public static string ToRaw(this ScriptEventType type)
    {
        return type switch
        {
            ScriptEventType.Tap => "tap",
            ScriptEventType.Change => "change",
            ScriptEventType.Submit => "submit",
            ScriptEventType.Viewport => "viewport",
            ScriptEventType.Select => "select",
            ScriptEventType.Cursor => "cursor",
            ScriptEventType.Close => "close",
            _ => "",
        };
    }
}

public sealed class ScriptNodeProps
{
    public Dictionary<string, object?> Raw { get; }
    public Dictionary<ScriptEventType, string> EventHandlers { get; }

    public ScriptNodeProps(Dictionary<string, object?> raw, Dictionary<ScriptEventType, string>? handlers = null)
    {
        Raw = raw;
        EventHandlers = handlers ?? new Dictionary<ScriptEventType, string>();
    }

    public string? HandlerId(ScriptEventType eventType)
    {
        return EventHandlers.TryGetValue(eventType, out var token) ? token : null;
    }
}

public sealed class ScriptNode
{
    public required string Id { get; init; }
    public required ScriptNodeType Type { get; init; }
    public required ScriptNodeProps Props { get; init; }
    public List<ScriptNode> Children { get; init; } = new();
}

public sealed class ScriptTree
{
    public required ScriptNode Root { get; init; }
    public Dictionary<string, object?> Metadata { get; init; } = new();
}
