/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.scripts;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class ScriptSourceTranspiler {
    private static final Pattern NAMED_IMPORT = Pattern.compile("^import\\s+\\{([^}]+)\\}\\s+from\\s+[\"']([^\"']+)[\"'];?\\s*$");
    private static final Pattern NAMESPACE_IMPORT = Pattern.compile("^import\\s+\\*\\s+as\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s+from\\s+[\"']([^\"']+)[\"'];?\\s*$");
    private static final Pattern SIDE_EFFECT_IMPORT = Pattern.compile("^import\\s+[\"']([^\"']+)[\"'];?\\s*$");

    private ScriptSourceTranspiler() {}

    static String transpile(String source) {
        return new JsxParser(transpileImports(source != null ? source : "")).transpile();
    }

    private static String transpileImports(String source) {
        String[] lines = source.split("\\R", -1);
        StringBuilder out = new StringBuilder(source.length() + 128);
        int moduleIndex = 0;
        for (int i = 0; i < lines.length; i++) {
            String transformed = transformImportLine(lines[i], moduleIndex);
            if (transformed != null) {
                moduleIndex += 1;
                out.append(transformed);
            } else {
                out.append(lines[i]);
            }
            if (i < lines.length - 1) out.append('\n');
        }
        return out.toString();
    }

    private static String transformImportLine(String line, int moduleIndex) {
        String trimmed = line.trim();
        if (!trimmed.startsWith("import ")) return null;

        String leading = leadingWhitespace(line);
        Matcher named = NAMED_IMPORT.matcher(trimmed);
        if (named.matches()) {
            String moduleVar = "__emw_mod_" + moduleIndex;
            StringBuilder out = new StringBuilder(leading)
                    .append("var ")
                    .append(moduleVar)
                    .append(" = require(\"")
                    .append(named.group(2))
                    .append("\");");
            for (String binding : named.group(1).split(",")) {
                String part = binding.trim();
                if (part.isEmpty()) continue;
                String[] pieces = part.split("\\s+");
                String exported;
                String local;
                if (pieces.length == 1) {
                    exported = pieces[0];
                    local = pieces[0];
                } else if (pieces.length == 3 && "as".equals(pieces[1])) {
                    exported = pieces[0];
                    local = pieces[2];
                } else {
                    throw new IllegalArgumentException("Unsupported import binding: " + part);
                }
                out.append(" var ").append(local).append(" = ").append(moduleVar).append(".").append(exported).append(";");
            }
            return out.toString();
        }

        Matcher namespace = NAMESPACE_IMPORT.matcher(trimmed);
        if (namespace.matches()) {
            return leading + "var " + namespace.group(1) + " = require(\"" + namespace.group(2) + "\");";
        }

        Matcher sideEffect = SIDE_EFFECT_IMPORT.matcher(trimmed);
        if (sideEffect.matches()) {
            return leading + "require(\"" + sideEffect.group(1) + "\");";
        }

        throw new IllegalArgumentException("Unsupported import syntax: " + trimmed);
    }

    private static String leadingWhitespace(String value) {
        int i = 0;
        while (i < value.length() && (value.charAt(i) == ' ' || value.charAt(i) == '\t')) i += 1;
        return value.substring(0, i);
    }

    private static final class JsxParser {
        private final String source;
        private int index;

        JsxParser(String source) {
            this.source = source;
        }

        String transpile() {
            StringBuilder out = new StringBuilder(source.length() + 128);
            while (!isAtEnd()) {
                if (startsLineComment()) out.append(consumeLineComment());
                else if (startsBlockComment()) out.append(consumeBlockComment());
                else if (current() == '"' || current() == '\'' || current() == '`') out.append(consumeQuotedString(current()));
                else if (current() == '<' && looksLikeJsxElementStart(index)) out.append(parseElement());
                else out.append(advance());
            }
            return out.toString();
        }

        private String parseElement() {
            consume('<');
            String tag = parseTagName();
            if (tag.isEmpty()) throw new IllegalArgumentException("unterminated JSX element");

            List<String[]> attributes = new ArrayList<>();
            boolean selfClosing = false;
            while (!isAtEnd()) {
                skipWhitespace();
                if (startsWith("/>")) {
                    index += 2;
                    selfClosing = true;
                    break;
                }
                if (current() == '>') {
                    advance();
                    break;
                }
                attributes.add(parseAttribute());
            }

            List<String> children = new ArrayList<>();
            boolean closed = selfClosing;
            while (!selfClosing && !isAtEnd()) {
                if (startsWith("</")) {
                    index += 2;
                    String closingTag = parseTagName();
                    skipWhitespace();
                    consume('>');
                    if (!closingTag.equals(tag)) {
                        throw new IllegalArgumentException("mismatched JSX closing tag: expected </" + tag + ">, found </" + closingTag + ">");
                    }
                    closed = true;
                    break;
                }
                if (current() == '<' && looksLikeJsxElementStart(index)) {
                    children.add(parseElement());
                    continue;
                }
                if (current() == '{') {
                    String expression = parseBraceExpression();
                    if (!expression.trim().isEmpty()) children.add(expression);
                    continue;
                }
                String normalized = normalizeText(parseTextChild());
                if (!normalized.isEmpty()) children.add(jsStringLiteral(normalized));
            }
            if (!closed) throw new IllegalArgumentException("unterminated JSX element <" + tag + ">");

            List<String> args = new ArrayList<>();
            args.add(tagReference(tag));
            args.add(makeProps(attributes));
            args.addAll(children);
            return "JSX.h(" + String.join(", ", args) + ")";
        }

        private String[] parseAttribute() {
            String name = parseAttributeName();
            if (name.isEmpty()) throw new IllegalArgumentException("unsupported JSX attribute near " + current());
            skipWhitespace();
            if (current() != '=') return new String[] { name, "true" };
            advance();
            skipWhitespace();
            if (current() == '{') return new String[] { name, parseBraceExpression() };
            if (current() == '"' || current() == '\'') return new String[] { name, consumeQuotedString(current()) };
            int start = index;
            while (!isAtEnd() && !Character.isWhitespace(current()) && current() != '>' && !startsWith("/>")) advance();
            return new String[] { name, source.substring(start, index) };
        }

        private String parseBraceExpression() {
            consume('{');
            int start = index;
            int depth = 1;
            while (!isAtEnd()) {
                if (startsLineComment()) {
                    consumeLineComment();
                    continue;
                }
                if (startsBlockComment()) {
                    consumeBlockComment();
                    continue;
                }
                if (current() == '"' || current() == '\'' || current() == '`') {
                    consumeQuotedString(current());
                    continue;
                }
                char c = advance();
                if (c == '{') depth += 1;
                else if (c == '}') {
                    depth -= 1;
                    if (depth == 0) return source.substring(start, index - 1);
                }
            }
            throw new IllegalArgumentException("unterminated JSX expression");
        }

        private String parseTextChild() {
            int start = index;
            while (!isAtEnd() && current() != '<' && current() != '{') advance();
            return source.substring(start, index);
        }

        private String parseTagName() {
            int start = index;
            while (!isAtEnd() && isTagNameCharacter(current())) advance();
            return source.substring(start, index);
        }

        private String parseAttributeName() {
            int start = index;
            while (!isAtEnd() && isAttributeNameCharacter(current())) advance();
            return source.substring(start, index);
        }

        private String makeProps(List<String[]> attributes) {
            if (attributes.isEmpty()) return "null";
            List<String> pairs = new ArrayList<>();
            for (String[] attribute : attributes) pairs.add(propertyKey(attribute[0]) + ": " + attribute[1]);
            return "{ " + String.join(", ", pairs) + " }";
        }

        private String propertyKey(String name) {
            return isIdentifier(name) ? name : jsStringLiteral(name);
        }

        private String tagReference(String tag) {
            return isIdentifier(tag) ? tag : jsStringLiteral(tag);
        }

        private String normalizeText(String text) {
            return text.trim().replaceAll("\\s+", " ");
        }

        private String jsStringLiteral(String value) {
            StringBuilder out = new StringBuilder("\"");
            for (int i = 0; i < value.length(); i++) {
                char c = value.charAt(i);
                switch (c) {
                    case '"': out.append("\\\""); break;
                    case '\\': out.append("\\\\"); break;
                    case '\n': out.append("\\n"); break;
                    case '\r': out.append("\\r"); break;
                    case '\t': out.append("\\t"); break;
                    default:
                        if (c < 0x20) out.append(String.format(Locale.US, "\\u%04X", (int) c));
                        else out.append(c);
                }
            }
            return out.append('"').toString();
        }

        private boolean isAtEnd() { return index >= source.length(); }
        private char current() { return isAtEnd() ? '\0' : source.charAt(index); }
        private char peek() { int next = index + 1; return next < source.length() ? source.charAt(next) : '\0'; }
        private char advance() { return source.charAt(index++); }
        private boolean startsLineComment() { return current() == '/' && peek() == '/'; }
        private boolean startsBlockComment() { return current() == '/' && peek() == '*'; }
        private boolean startsWith(String text) { return source.startsWith(text, index); }
        private void skipWhitespace() { while (!isAtEnd() && Character.isWhitespace(current())) advance(); }
        private void consume(char expected) {
            if (current() != expected) throw new IllegalArgumentException("expected " + expected);
            advance();
        }

        private String consumeLineComment() {
            int start = index;
            while (!isAtEnd() && current() != '\n') advance();
            if (!isAtEnd()) advance();
            return source.substring(start, index);
        }

        private String consumeBlockComment() {
            int start = index;
            index += 2;
            while (!isAtEnd()) {
                if (current() == '*' && peek() == '/') {
                    index += 2;
                    break;
                }
                advance();
            }
            return source.substring(start, index);
        }

        private String consumeQuotedString(char quote) {
            int start = index;
            advance();
            while (!isAtEnd()) {
                char c = advance();
                if (c == '\\') {
                    if (!isAtEnd()) advance();
                    continue;
                }
                if (c == quote) break;
            }
            return source.substring(start, index);
        }

        private boolean looksLikeJsxElementStart(int start) {
            if (start >= source.length() || source.charAt(start) != '<') return false;
            int cursor = start + 1;
            if (cursor >= source.length() || !Character.isUpperCase(source.charAt(cursor))) return false;
            while (cursor < source.length() && isTagNameCharacter(source.charAt(cursor))) cursor += 1;
            while (cursor < source.length() && Character.isWhitespace(source.charAt(cursor))) cursor += 1;
            if (cursor >= source.length()) return false;
            char c = source.charAt(cursor);
            if (c == '>') return true;
            if (c == '/') return cursor + 1 < source.length() && source.charAt(cursor + 1) == '>';
            return isAttributeNameStart(c);
        }

        private boolean isTagNameCharacter(char c) { return Character.isLetterOrDigit(c) || c == '_' || c == '.'; }
        private boolean isAttributeNameCharacter(char c) { return Character.isLetterOrDigit(c) || c == '_' || c == '-' || c == ':'; }
        private boolean isAttributeNameStart(char c) { return Character.isLetter(c) || c == '_' || c == ':'; }
        private boolean isIdentifier(String value) {
            if (value == null || value.isEmpty()) return false;
            char first = value.charAt(0);
            if (!Character.isLetter(first) && first != '_' && first != '$') return false;
            for (int i = 1; i < value.length(); i++) {
                char c = value.charAt(i);
                if (!Character.isLetterOrDigit(c) && c != '_' && c != '$') return false;
            }
            return true;
        }
    }
}
