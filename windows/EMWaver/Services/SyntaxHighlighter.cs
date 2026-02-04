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
        Builtin,
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
                while (i < n && text[i] != '\n' && text[i] != '\r') i++;
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

            // Strings: '...' or "..." or template strings `...`
            if (c == '\'' || c == '"' || c == '`')
            {
                int start = i;
                char quote = c;
                i++;
                while (i < n)
                {
                    var ch = text[i];
                    if (ch == '\\') { i += 2; continue; }

                    // template strings can span newlines; regular quotes typically don't, but we'll just scan safely.
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
                else if (IsBuiltin(word))
                {
                    spans.Add(new Span(start, i - start, TokenKind.Builtin));
                }
                else
                {
                    // Heuristic: highlight identifiers that look like EMWaver UI calls: ui.foo(...)
                    // If we see `.name` and the left side was `ui`, mark the name as Builtin-ish.
                    if (start >= 3 && text[start - 1] == '.')
                    {
                        var j = start - 2;
                        while (j >= 0 && (char.IsLetterOrDigit(text[j]) || text[j] == '_' || text[j] == '$')) j--;
                        var left = text.AsSpan(j + 1, (start - 1) - (j + 1));
                        if (left.SequenceEqual("ui".AsSpan()))
                        {
                            spans.Add(new Span(start, i - start, TokenKind.Builtin));
                        }
                    }
                }

                continue;
            }

            i++;
        }

        return spans;
    }

    private static bool IsKeyword(ReadOnlySpan<char> w)
    {
        // JS/TS-ish keyword list (not exhaustive, but much closer than the previous minimal set).
        return w.SequenceEqual("export".AsSpan())
            || w.SequenceEqual("default".AsSpan())
            || w.SequenceEqual("import".AsSpan())
            || w.SequenceEqual("from".AsSpan())
            || w.SequenceEqual("as".AsSpan())
            || w.SequenceEqual("function".AsSpan())
            || w.SequenceEqual("return".AsSpan())
            || w.SequenceEqual("if".AsSpan())
            || w.SequenceEqual("else".AsSpan())
            || w.SequenceEqual("for".AsSpan())
            || w.SequenceEqual("while".AsSpan())
            || w.SequenceEqual("do".AsSpan())
            || w.SequenceEqual("switch".AsSpan())
            || w.SequenceEqual("case".AsSpan())
            || w.SequenceEqual("break".AsSpan())
            || w.SequenceEqual("continue".AsSpan())
            || w.SequenceEqual("try".AsSpan())
            || w.SequenceEqual("catch".AsSpan())
            || w.SequenceEqual("finally".AsSpan())
            || w.SequenceEqual("throw".AsSpan())
            || w.SequenceEqual("const".AsSpan())
            || w.SequenceEqual("let".AsSpan())
            || w.SequenceEqual("var".AsSpan())
            || w.SequenceEqual("class".AsSpan())
            || w.SequenceEqual("extends".AsSpan())
            || w.SequenceEqual("new".AsSpan())
            || w.SequenceEqual("this".AsSpan())
            || w.SequenceEqual("super".AsSpan())
            || w.SequenceEqual("await".AsSpan())
            || w.SequenceEqual("async".AsSpan())
            || w.SequenceEqual("yield".AsSpan())
            || w.SequenceEqual("typeof".AsSpan())
            || w.SequenceEqual("instanceof".AsSpan())
            || w.SequenceEqual("in".AsSpan())
            || w.SequenceEqual("true".AsSpan())
            || w.SequenceEqual("false".AsSpan())
            || w.SequenceEqual("null".AsSpan())
            || w.SequenceEqual("undefined".AsSpan())
            || w.SequenceEqual("typeof".AsSpan())
            || w.SequenceEqual("void".AsSpan())
            || w.SequenceEqual("delete".AsSpan())
            || w.SequenceEqual("get".AsSpan())
            || w.SequenceEqual("set".AsSpan());
    }

    private static bool IsBuiltin(ReadOnlySpan<char> w)
    {
        // EMWaver script conventions / common JS globals.
        return w.SequenceEqual("ui".AsSpan())
            || w.SequenceEqual("ctx".AsSpan())
            || w.SequenceEqual("console".AsSpan())
            || w.SequenceEqual("Math".AsSpan())
            || w.SequenceEqual("JSON".AsSpan())
            || w.SequenceEqual("Date".AsSpan());
    }
}
