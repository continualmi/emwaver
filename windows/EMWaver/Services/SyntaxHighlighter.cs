using System;
using System.Collections.Generic;

namespace EMWaver.Services;

internal static class SyntaxHighlighter
{
    internal enum TokenKind
    {
        Default,
        Comment,
        String,
        Number,
        Keyword,
        Ident,
    }

    internal readonly record struct Span(int Start, int Length, TokenKind Kind);

    // Very small, safe lexer: single-pass, no allocations beyond span list.
    internal static List<Span> Tokenize(string text)
    {
        var spans = new List<Span>(128);
        if (string.IsNullOrEmpty(text)) return spans;

        int i = 0;
        int n = text.Length;

        bool IsIdentStart(char c) => char.IsLetter(c) || c == '_' || c == '$';
        bool IsIdentPart(char c) => char.IsLetterOrDigit(c) || c == '_' || c == '$';

        while (i < n)
        {
            var c = text[i];

            // Line comment //...
            if (c == '/' && i + 1 < n && text[i + 1] == '/')
            {
                int start = i;
                i += 2;
                while (i < n && text[i] != '\n') i++;
                spans.Add(new Span(start, i - start, TokenKind.Comment));
                continue;
            }

            // Block comment /* ... */
            if (c == '/' && i + 1 < n && text[i + 1] == '*')
            {
                int start = i;
                i += 2;
                while (i + 1 < n)
                {
                    if (text[i] == '*' && text[i + 1] == '/') { i += 2; break; }
                    i++;
                }
                spans.Add(new Span(start, i - start, TokenKind.Comment));
                continue;
            }

            // Strings: '...' or "..." (no template strings for now)
            if (c == '\'' || c == '"')
            {
                int start = i;
                char quote = c;
                i++;
                while (i < n)
                {
                    var ch = text[i];
                    if (ch == '\\') { i += 2; continue; }
                    i++;
                    if (ch == quote) break;
                }
                spans.Add(new Span(start, i - start, TokenKind.String));
                continue;
            }

            // Numbers
            if (char.IsDigit(c))
            {
                int start = i;
                i++;
                while (i < n && (char.IsDigit(text[i]) || text[i] == '.' || text[i] == '_')) i++;
                spans.Add(new Span(start, i - start, TokenKind.Number));
                continue;
            }

            // Ident / keyword
            if (IsIdentStart(c))
            {
                int start = i;
                i++;
                while (i < n && IsIdentPart(text[i])) i++;
                var word = text.AsSpan(start, i - start);

                if (IsKeyword(word))
                {
                    spans.Add(new Span(start, i - start, TokenKind.Keyword));
                }
                // else: we don't style idents yet

                continue;
            }

            i++;
        }

        return spans;
    }

    private static bool IsKeyword(ReadOnlySpan<char> w)
    {
        // Keep this tiny and stable. Add more later.
        return w.SequenceEqual("export".AsSpan())
            || w.SequenceEqual("default".AsSpan())
            || w.SequenceEqual("function".AsSpan())
            || w.SequenceEqual("return".AsSpan())
            || w.SequenceEqual("if".AsSpan())
            || w.SequenceEqual("else".AsSpan())
            || w.SequenceEqual("for".AsSpan())
            || w.SequenceEqual("while".AsSpan())
            || w.SequenceEqual("true".AsSpan())
            || w.SequenceEqual("false".AsSpan())
            || w.SequenceEqual("null".AsSpan());
    }
}
