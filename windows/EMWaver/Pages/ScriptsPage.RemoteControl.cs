using EMWaver.Services.Cloud;
using EMWaver.Scripting;
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;

namespace EMWaver.Pages;

public sealed partial class ScriptsPage
{
    private sealed class RemoteControlDelegate : RemoteControlHostService.IDelegate
    {
        private readonly ScriptsPage _page;

        public RemoteControlDelegate(ScriptsPage page)
        {
            _page = page;
        }

        public void OnRemoteControlActiveChanged(bool active)
        {
            _ = _page.DispatcherQueue.TryEnqueue(() =>
            {
                _page.SetRemoteControlUiState(active, _page._remoteActiveScriptName);
            });
        }

        public async Task RunRemoteScriptAsync(string source, string? name, string scriptInstanceId)
        {
            await _page.RunOnUiAsync(async () =>
            {
                try
                {
                    // Show preview mode and run the provided source.
                    _page.SetPreviewMode(true);

                    // Populate editor buffer for transparency (so user can see what is running).
                    var scriptName = !string.IsNullOrWhiteSpace(name) ? name : "Remote Script";

                    _page._suppressEditorChanged = true;
                    try { _page.EditorBox.Text = source; }
                    finally { _page._suppressEditorChanged = false; }

                    // Best-effort: set current selection label (does not persist to repo).
                    // ScriptInfo is a record with ctor args; FileName is derived from Name.
                    _page._current = new Models.ScriptInfo(
                        Name: scriptName,
                        FullPath: "(remote)",
                        IsBundled: true,
                        ShadowsBundled: false
                    );

                    _page.SetRemoteControlUiState(true, scriptName);

                    // Execute.
                    _page._scriptEngine.Execute(source);

                    await Task.CompletedTask;
                }
                catch { }
            });
        }

        public async Task DispatchRemoteUiEventAsync(string scriptInstanceId, string targetNodeId, string eventName, JsonElement payload)
        {
            await _page.RunOnUiAsync(async () =>
            {
                try
                {
                    if (_page._lastRenderedTree == null) return;
                    if (!ScriptEventTypeExtensions.TryFromRaw(eventName, out var ev)) return;

                    var node = FindNodeById(_page._lastRenderedTree.Root, targetNodeId);
                    if (node == null) return;
                    var token = node.Props.HandlerId(ev);
                    if (string.IsNullOrWhiteSpace(token)) return;

                    var args = new List<object?>();
                    if (ev == ScriptEventType.Change || ev == ScriptEventType.Select || ev == ScriptEventType.Submit)
                    {
                        if (payload.ValueKind != JsonValueKind.Undefined && payload.ValueKind != JsonValueKind.Null)
                        {
                            if (payload.TryGetProperty("value", out var v))
                            {
                                args.Add(JsonToObject(v));
                            }
                        }
                    }

                    _page._scriptEngine.Invoke(token!, args);
                    await Task.CompletedTask;
                }
                catch { }
            });
        }

        public ScriptTree? GetActiveScriptTree() => _page._lastRenderedTree;

        public string GetHostSessionId() => AppServices.HostSession.HostSessionId;

        private static ScriptNode? FindNodeById(ScriptNode node, string id)
        {
            if (node.Id == id) return node;
            foreach (var c in node.Children)
            {
                var found = FindNodeById(c, id);
                if (found != null) return found;
            }
            return null;
        }

        private static object? JsonToObject(JsonElement el)
        {
            try
            {
                return el.ValueKind switch
                {
                    JsonValueKind.String => el.GetString(),
                    JsonValueKind.Number => el.TryGetInt64(out var l) ? l : el.GetDouble(),
                    JsonValueKind.True => true,
                    JsonValueKind.False => false,
                    JsonValueKind.Object => JsonSerializer.Deserialize<Dictionary<string, object?>>(el.GetRawText()),
                    JsonValueKind.Array => JsonSerializer.Deserialize<List<object?>>(el.GetRawText()),
                    _ => null,
                };
            }
            catch
            {
                return null;
            }
        }
    }

    private ScriptTree? _lastRenderedTree;

    private void RenderPreviewWithRemoteMirror(ScriptTree tree)
    {
        _lastRenderedTree = tree;
    }
}
