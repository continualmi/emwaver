using EMWaver.Services;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Diagnostics;
using Microsoft.UI;
using Microsoft.UI.Text;

namespace EMWaver.Pages;

public sealed partial class ScriptsPage
{
    private void EnsureHighlightTimer()
    {
        if (_highlightTimer != null)
        {
            return;
        }

        _highlightTimer = DispatcherQueue.CreateTimer();
        _highlightTimer.Interval = TimeSpan.FromMilliseconds(200);
        _highlightTimer.IsRepeating = false;
        _highlightTimer.Tick += (_, __) =>
        {
            _highlightTimer?.Stop();
            ApplyHighlightingSafe();
        };
    }

    private void ScheduleHighlight()
    {
        if (_editorMode != EditorMode.Code)
        {
            return;
        }

        EnsureHighlightTimer();
        _highlightTimer!.Stop();
        _highlightTimer!.Start();
    }

    private void OnRichEditorTextChanged(object sender, RoutedEventArgs e)
    {
        if (_suppressRichChanged || _editorMode != EditorMode.Code)
        {
            return;
        }

        _richTextCache = GetRichEditorText();

        if (_current == null || _current.IsBundled)
        {
            return;
        }

        var now = NormalizeLineEndings(_richTextCache).TrimEnd('\n');
        var dirty = !string.Equals(now, _loadedTextNormalized, StringComparison.Ordinal);
        if (dirty != _isDirty)
        {
            _isDirty = dirty;
            UpdateCommandStates();
        }

        ScheduleHighlight();
    }

    private string GetRichEditorText()
    {
        try
        {
            RichEditor.Document.GetText(TextGetOptions.None, out var text);
            return text ?? string.Empty;
        }
        catch
        {
            return string.Empty;
        }
    }

    private void SetRichEditorText(string text)
    {
        _suppressRichChanged = true;
        var prevReadOnly = RichEditor.IsReadOnly;
        try
        {
            if (prevReadOnly)
            {
                // RichEditTextDocument.SetText can throw UnauthorizedAccessException when read-only.
                RichEditor.IsReadOnly = false;
            }

            RichEditor.Document.SetText(TextSetOptions.None, text ?? string.Empty);
            _richTextCache = text ?? string.Empty;
        }
        catch (Exception ex)
        {
            Debug.WriteLine("[EMWaver][Windows][RichEdit] SetText failed: " + ex.Message);
            _richTextCache = text ?? string.Empty;
        }
        finally
        {
            try { RichEditor.IsReadOnly = prevReadOnly; } catch { }
            _suppressRichChanged = false;
        }
    }

    private void ApplyHighlightingSafe()
    {
        if (_editorMode != EditorMode.Code)
        {
            return;
        }

        // NOTE: formatting operations can fire TextChanged, which can cause an infinite
        // highlight loop. Suppress change handling while we apply formatting.
        var prevSuppress = _suppressRichChanged;
        _suppressRichChanged = true;
        try
        {
            // IMPORTANT: RichEdit uses CR (\r) line separators; tokenize exactly what the document returns.
            var text = GetRichEditorText();
            _richTextCache = text;
            var spans = SyntaxHighlighter.Tokenize(text);

            Debug.WriteLine($"[EMWaver][Windows][RichEdit] highlight: len={text.Length} spans={spans.Count}");

            // Snapshot selection.
            var sel = RichEditor.Document.Selection;
            var selStart = sel.StartPosition;
            var selEnd = sel.EndPosition;

            // Reset formatting across full doc.
            var all = RichEditor.Document.GetRange(0, text.Length);
            all.CharacterFormat.ForegroundColor = Colors.Gainsboro;

            foreach (var sp in spans)
            {
                var end = Math.Min(text.Length, sp.Start + sp.Length);
                if (end <= sp.Start) continue;

                var range = RichEditor.Document.GetRange(sp.Start, end);
                range.CharacterFormat.ForegroundColor = sp.Kind switch
                {
                    SyntaxHighlighter.TokenKind.Comment => Microsoft.UI.ColorHelper.FromArgb(0xFF, 0x6A, 0x99, 0x55),
                    SyntaxHighlighter.TokenKind.String => Microsoft.UI.ColorHelper.FromArgb(0xFF, 0xCE, 0x91, 0x78),
                    SyntaxHighlighter.TokenKind.Number => Microsoft.UI.ColorHelper.FromArgb(0xFF, 0xB5, 0xCE, 0xA8),
                    SyntaxHighlighter.TokenKind.Keyword => Microsoft.UI.ColorHelper.FromArgb(0xFF, 0x56, 0x9C, 0xD6),
                    _ => Colors.Gainsboro,
                };
            }

            // Restore selection.
            var sel2 = RichEditor.Document.Selection;
            sel2.SetRange(selStart, selEnd);
        }
        catch (Exception ex)
        {
            Debug.WriteLine("[EMWaver][Windows][RichEdit] highlight failed: " + ex.Message);
        }
        finally
        {
            _suppressRichChanged = prevSuppress;
        }
    }
}
