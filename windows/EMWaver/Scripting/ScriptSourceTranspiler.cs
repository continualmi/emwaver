using System.Text;
using System.Text.RegularExpressions;

namespace EMWaver.Scripting;

internal static partial class ScriptSourceTranspiler
{
    internal static string Transpile(string source)
    {
        return new JsxParser(TranspileImports(source ?? string.Empty)).Transpile();
    }

    private static string TranspileImports(string source)
    {
        var lines = source.Split('\n');
        var output = new StringBuilder(source.Length + 128);
        var moduleIndex = 0;

        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i].TrimEnd('\r');
            var transformed = TransformImportLine(line, moduleIndex);
            if (transformed != null)
            {
                moduleIndex += 1;
                output.Append(transformed);
            }
            else
            {
                output.Append(line);
            }
            if (i < lines.Length - 1)
            {
                output.Append('\n');
            }
        }

        return output.ToString();
    }

    private static string? TransformImportLine(string line, int moduleIndex)
    {
        var trimmed = line.Trim();
        if (!trimmed.StartsWith("import ", StringComparison.Ordinal))
        {
            return null;
        }

        var leading = LeadingWhitespace(line);
        var named = NamedImportRegex().Match(trimmed);
        if (named.Success)
        {
            var moduleVar = "__emw_mod_" + moduleIndex.ToString(System.Globalization.CultureInfo.InvariantCulture);
            var output = new StringBuilder()
                .Append(leading)
                .Append("var ")
                .Append(moduleVar)
                .Append(" = require(\"")
                .Append(named.Groups[2].Value)
                .Append("\");");

            foreach (var rawBinding in named.Groups[1].Value.Split(','))
            {
                var binding = rawBinding.Trim();
                if (binding.Length == 0) continue;
                var pieces = binding.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
                string exported;
                string local;
                if (pieces.Length == 1)
                {
                    exported = pieces[0];
                    local = pieces[0];
                }
                else if (pieces.Length == 3 && pieces[1] == "as")
                {
                    exported = pieces[0];
                    local = pieces[2];
                }
                else
                {
                    throw new InvalidOperationException("Unsupported import binding: " + binding);
                }
                output.Append(" var ").Append(local).Append(" = ").Append(moduleVar).Append('.').Append(exported).Append(';');
            }
            return output.ToString();
        }

        var namespaceImport = NamespaceImportRegex().Match(trimmed);
        if (namespaceImport.Success)
        {
            return $"{leading}var {namespaceImport.Groups[1].Value} = require(\"{namespaceImport.Groups[2].Value}\");";
        }

        var sideEffect = SideEffectImportRegex().Match(trimmed);
        if (sideEffect.Success)
        {
            return $"{leading}require(\"{sideEffect.Groups[1].Value}\");";
        }

        throw new InvalidOperationException("Unsupported import syntax: " + trimmed);
    }

    private static string LeadingWhitespace(string value)
    {
        var index = 0;
        while (index < value.Length && (value[index] == ' ' || value[index] == '\t'))
        {
            index += 1;
        }
        return value[..index];
    }

    [GeneratedRegex("^import\\s+\\{([^}]+)\\}\\s+from\\s+[\"']([^\"']+)[\"'];?\\s*$")]
    private static partial Regex NamedImportRegex();

    [GeneratedRegex("^import\\s+\\*\\s+as\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s+from\\s+[\"']([^\"']+)[\"'];?\\s*$")]
    private static partial Regex NamespaceImportRegex();

    [GeneratedRegex("^import\\s+[\"']([^\"']+)[\"'];?\\s*$")]
    private static partial Regex SideEffectImportRegex();

    private sealed class JsxParser
    {
        private readonly string _source;
        private int _index;

        internal JsxParser(string source)
        {
            _source = source;
        }

        internal string Transpile()
        {
            var output = new StringBuilder(_source.Length + 128);
            while (!IsAtEnd)
            {
                if (StartsLineComment) output.Append(ConsumeLineComment());
                else if (StartsBlockComment) output.Append(ConsumeBlockComment());
                else if (Current is '"' or '\'' or '`') output.Append(ConsumeQuotedString(Current));
                else if (Current == '<' && LooksLikeJsxElementStart(_index)) output.Append(ParseElement());
                else output.Append(Advance());
            }
            return output.ToString();
        }

        private string ParseElement()
        {
            Consume('<');
            var tag = ParseTagName();
            if (tag.Length == 0) throw new InvalidOperationException("unterminated JSX element");

            var attributes = new List<(string Name, string Value)>();
            var selfClosing = false;
            while (!IsAtEnd)
            {
                SkipWhitespace();
                if (StartsWith("/>"))
                {
                    _index += 2;
                    selfClosing = true;
                    break;
                }
                if (Current == '>')
                {
                    Advance();
                    break;
                }
                attributes.Add(ParseAttribute());
            }

            var children = new List<string>();
            var closed = selfClosing;
            while (!selfClosing && !IsAtEnd)
            {
                if (StartsWith("</"))
                {
                    _index += 2;
                    var closingTag = ParseTagName();
                    SkipWhitespace();
                    Consume('>');
                    if (closingTag != tag)
                    {
                        throw new InvalidOperationException($"mismatched JSX closing tag: expected </{tag}>, found </{closingTag}>");
                    }
                    closed = true;
                    break;
                }
                if (Current == '<' && LooksLikeJsxElementStart(_index))
                {
                    children.Add(ParseElement());
                    continue;
                }
                if (Current == '{')
                {
                    var expression = ParseBraceExpression();
                    if (!string.IsNullOrWhiteSpace(expression)) children.Add(expression);
                    continue;
                }
                var normalized = NormalizeText(ParseTextChild());
                if (normalized.Length > 0) children.Add(JsStringLiteral(normalized));
            }
            if (!closed) throw new InvalidOperationException($"unterminated JSX element <{tag}>");

            var args = new List<string> { TagReference(tag), MakeProps(attributes) };
            args.AddRange(children);
            return "JSX.h(" + string.Join(", ", args) + ")";
        }

        private (string Name, string Value) ParseAttribute()
        {
            var name = ParseAttributeName();
            if (name.Length == 0) throw new InvalidOperationException("unsupported JSX attribute near " + Current);
            SkipWhitespace();
            if (Current != '=') return (name, "true");
            Advance();
            SkipWhitespace();
            if (Current == '{') return (name, ParseBraceExpression());
            if (Current is '"' or '\'') return (name, ConsumeQuotedString(Current));
            var start = _index;
            while (!IsAtEnd && !char.IsWhiteSpace(Current) && Current != '>' && !StartsWith("/>")) Advance();
            return (name, _source[start.._index]);
        }

        private string ParseBraceExpression()
        {
            Consume('{');
            var start = _index;
            var depth = 1;
            while (!IsAtEnd)
            {
                if (StartsLineComment) { ConsumeLineComment(); continue; }
                if (StartsBlockComment) { ConsumeBlockComment(); continue; }
                if (Current is '"' or '\'' or '`') { ConsumeQuotedString(Current); continue; }
                var c = Advance();
                if (c == '{') depth += 1;
                else if (c == '}')
                {
                    depth -= 1;
                    if (depth == 0) return _source[start..(_index - 1)];
                }
            }
            throw new InvalidOperationException("unterminated JSX expression");
        }

        private string ParseTextChild()
        {
            var start = _index;
            while (!IsAtEnd && Current != '<' && Current != '{') Advance();
            return _source[start.._index];
        }

        private string ParseTagName()
        {
            var start = _index;
            while (!IsAtEnd && IsTagNameCharacter(Current)) Advance();
            return _source[start.._index];
        }

        private string ParseAttributeName()
        {
            var start = _index;
            while (!IsAtEnd && IsAttributeNameCharacter(Current)) Advance();
            return _source[start.._index];
        }

        private string MakeProps(List<(string Name, string Value)> attributes)
        {
            if (attributes.Count == 0) return "null";
            return "{ " + string.Join(", ", attributes.Select(a => PropertyKey(a.Name) + ": " + a.Value)) + " }";
        }

        private string PropertyKey(string name) => IsIdentifier(name) ? name : JsStringLiteral(name);
        private string TagReference(string tag) => IsIdentifier(tag) ? tag : JsStringLiteral(tag);
        private string NormalizeText(string text) => string.Join(" ", text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

        private string JsStringLiteral(string value)
        {
            var output = new StringBuilder("\"");
            foreach (var c in value)
            {
                output.Append(c switch
                {
                    '"' => "\\\"",
                    '\\' => "\\\\",
                    '\n' => "\\n",
                    '\r' => "\\r",
                    '\t' => "\\t",
                    < ' ' => "\\u" + ((int)c).ToString("X4", System.Globalization.CultureInfo.InvariantCulture),
                    _ => c.ToString()
                });
            }
            output.Append('"');
            return output.ToString();
        }

        private bool IsAtEnd => _index >= _source.Length;
        private char Current => IsAtEnd ? '\0' : _source[_index];
        private char Peek => _index + 1 < _source.Length ? _source[_index + 1] : '\0';
        private char Advance() => _source[_index++];
        private bool StartsLineComment => Current == '/' && Peek == '/';
        private bool StartsBlockComment => Current == '/' && Peek == '*';
        private bool StartsWith(string text) => _source.StartsWith(text, _index, StringComparison.Ordinal);
        private void SkipWhitespace() { while (!IsAtEnd && char.IsWhiteSpace(Current)) Advance(); }
        private void Consume(char expected) { if (Current != expected) throw new InvalidOperationException("expected " + expected); Advance(); }

        private string ConsumeLineComment()
        {
            var start = _index;
            while (!IsAtEnd && Current != '\n') Advance();
            if (!IsAtEnd) Advance();
            return _source[start.._index];
        }

        private string ConsumeBlockComment()
        {
            var start = _index;
            _index += 2;
            while (!IsAtEnd)
            {
                if (Current == '*' && Peek == '/') { _index += 2; break; }
                Advance();
            }
            return _source[start.._index];
        }

        private string ConsumeQuotedString(char quote)
        {
            var start = _index;
            Advance();
            while (!IsAtEnd)
            {
                var c = Advance();
                if (c == '\\') { if (!IsAtEnd) Advance(); continue; }
                if (c == quote) break;
            }
            return _source[start.._index];
        }

        private bool LooksLikeJsxElementStart(int start)
        {
            if (start >= _source.Length || _source[start] != '<') return false;
            var cursor = start + 1;
            if (cursor >= _source.Length || !char.IsUpper(_source[cursor])) return false;
            while (cursor < _source.Length && IsTagNameCharacter(_source[cursor])) cursor += 1;
            while (cursor < _source.Length && char.IsWhiteSpace(_source[cursor])) cursor += 1;
            if (cursor >= _source.Length) return false;
            var c = _source[cursor];
            if (c == '>') return true;
            if (c == '/') return cursor + 1 < _source.Length && _source[cursor + 1] == '>';
            return IsAttributeNameStart(c);
        }

        private bool IsTagNameCharacter(char c) => char.IsLetterOrDigit(c) || c == '_' || c == '.';
        private bool IsAttributeNameCharacter(char c) => char.IsLetterOrDigit(c) || c == '_' || c == '-' || c == ':';
        private bool IsAttributeNameStart(char c) => char.IsLetter(c) || c == '_' || c == ':';
        private bool IsIdentifier(string value)
        {
            if (string.IsNullOrEmpty(value)) return false;
            if (!char.IsLetter(value[0]) && value[0] != '_' && value[0] != '$') return false;
            return value.Skip(1).All(c => char.IsLetterOrDigit(c) || c == '_' || c == '$');
        }
    }
}
