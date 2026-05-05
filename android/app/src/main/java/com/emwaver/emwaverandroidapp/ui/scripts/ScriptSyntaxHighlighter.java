/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.ui.scripts;

import android.text.Editable;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;

import androidx.annotation.ColorInt;
import androidx.annotation.NonNull;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Very small, dependency-free syntax highlighter for JS-like scripts.
 *
 * Notes:
 * - Debounce at the call-site; this runs regex passes over the whole buffer.
 * - This intentionally avoids clever incremental parsing; it is good enough for
 *   short-to-medium scripts.
 */
public final class ScriptSyntaxHighlighter {

    private static final Pattern BLOCK_COMMENT = Pattern.compile("/\\*[\\s\\S]*?\\*/");
    private static final Pattern LINE_COMMENT = Pattern.compile("//.*$", Pattern.MULTILINE);
    private static final Pattern DOUBLE_QUOTED = Pattern.compile("\"(?:\\\\.|[^\\\\\"])*\"");
    private static final Pattern SINGLE_QUOTED = Pattern.compile("'(?:\\\\.|[^\\\\'])*'");
    private static final Pattern TEMPLATE = Pattern.compile("`(?:\\\\.|[^\\\\`])*`");

    private static final Pattern NUMBER = Pattern.compile("\\b\\d+(?:\\.\\d+)?\\b");

    // Keep this list tight; scripts in EMWaver are sync-only but authored in a JS-like style.
    private static final Pattern KEYWORD = Pattern.compile(
            "\\b(?:" +
                    "const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|" +
                    "try|catch|finally|throw|class|new|import|from|export|default|" +
                    "true|false|null|undefined" +
                    ")\\b"
    );

    private static final class Range {
        final int start;
        final int end;

        Range(int start, int end) {
            this.start = start;
            this.end = end;
        }

        boolean contains(int index) {
            return index >= start && index < end;
        }
    }

    private final int keywordColor;
    private final int stringColor;
    private final int numberColor;
    private final int commentColor;

    public ScriptSyntaxHighlighter(
            @ColorInt int keywordColor,
            @ColorInt int stringColor,
            @ColorInt int numberColor,
            @ColorInt int commentColor
    ) {
        this.keywordColor = keywordColor;
        this.stringColor = stringColor;
        this.numberColor = numberColor;
        this.commentColor = commentColor;
    }

    public void applyTo(@NonNull Editable editable) {
        String text = editable.toString();
        if (text.isEmpty()) {
            clearSpans(editable);
            return;
        }

        clearSpans(editable);

        List<Range> protectedRanges = new ArrayList<>();

        // Comments
        collectAndApply(editable, text, BLOCK_COMMENT, commentColor, protectedRanges);
        collectAndApply(editable, text, LINE_COMMENT, commentColor, protectedRanges);

        // Strings
        collectAndApply(editable, text, DOUBLE_QUOTED, stringColor, protectedRanges);
        collectAndApply(editable, text, SINGLE_QUOTED, stringColor, protectedRanges);
        collectAndApply(editable, text, TEMPLATE, stringColor, protectedRanges);

        // Keywords / numbers (skip inside comments/strings).
        applySkippingProtected(editable, text, KEYWORD, keywordColor, protectedRanges, true);
        applySkippingProtected(editable, text, NUMBER, numberColor, protectedRanges, false);
    }

    private static void clearSpans(@NonNull Editable editable) {
        ForegroundColorSpan[] colors = editable.getSpans(0, editable.length(), ForegroundColorSpan.class);
        for (ForegroundColorSpan span : colors) {
            editable.removeSpan(span);
        }
        StyleSpan[] styles = editable.getSpans(0, editable.length(), StyleSpan.class);
        for (StyleSpan span : styles) {
            editable.removeSpan(span);
        }
    }

    private static void collectAndApply(
            @NonNull Editable editable,
            @NonNull String text,
            @NonNull Pattern pattern,
            @ColorInt int color,
            @NonNull List<Range> outRanges
    ) {
        Matcher m = pattern.matcher(text);
        while (m.find()) {
            int start = m.start();
            int end = m.end();
            if (start < 0 || end <= start || end > editable.length()) {
                continue;
            }
            outRanges.add(new Range(start, end));
            editable.setSpan(new ForegroundColorSpan(color), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
    }

    private static void applySkippingProtected(
            @NonNull Editable editable,
            @NonNull String text,
            @NonNull Pattern pattern,
            @ColorInt int color,
            @NonNull List<Range> protectedRanges,
            boolean bold
    ) {
        Matcher m = pattern.matcher(text);
        while (m.find()) {
            int start = m.start();
            int end = m.end();
            if (start < 0 || end <= start || end > editable.length()) {
                continue;
            }
            if (isProtected(start, protectedRanges)) {
                continue;
            }
            editable.setSpan(new ForegroundColorSpan(color), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            if (bold) {
                editable.setSpan(new StyleSpan(android.graphics.Typeface.BOLD), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
        }
    }

    private static boolean isProtected(int start, @NonNull List<Range> protectedRanges) {
        for (Range r : protectedRanges) {
            if (r.contains(start)) {
                return true;
            }
        }
        return false;
    }
}
