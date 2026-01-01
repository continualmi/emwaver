/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.emwaver.emwaverandroidapp.github;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class GitHubDiffUtil {
    
    public static class DiffLine {
        public enum Type {
            CONTEXT,    // Unchanged line (shown in white)
            REMOVED,    // Line removed (shown in red)
            ADDED       // Line added (shown in green)
        }
        
        public Type type;
        public int oldLineNum;  // Line number in old file (0 if added)
        public int newLineNum;  // Line number in new file (0 if removed)
        public String content;
        
        public DiffLine(Type type, int oldLineNum, int newLineNum, String content) {
            this.type = type;
            this.oldLineNum = oldLineNum;
            this.newLineNum = newLineNum;
            this.content = content;
        }
    }
    
    public static class DiffResult {
        public int linesAdded;
        public int linesRemoved;
        public int linesChanged;
        public List<String> previewLines; // Formatted diff lines with line numbers
        public List<DiffLine> diffLines; // Raw diff lines for better formatting
        
        public DiffResult() {
            this.linesAdded = 0;
            this.linesRemoved = 0;
            this.linesChanged = 0;
            this.previewLines = new ArrayList<>();
            this.diffLines = new ArrayList<>();
        }
    }
    
    private static final int CONTEXT_LINES = 2; // Show 2 lines before and after changes
    
    /**
     * Calculate diff between two strings and return statistics with context
     * @param oldContent The old/existing content (destination)
     * @param newContent The new content (source)
     */
    public static DiffResult calculateDiff(String oldContent, String newContent) {
        DiffResult result = new DiffResult();
        
        boolean oldIsEmpty = (oldContent == null || oldContent.isEmpty());
        boolean newIsEmpty = (newContent == null || newContent.isEmpty());
        
        // If both are empty, no changes
        if (oldIsEmpty && newIsEmpty) {
            return result;
        }
        
        // If old is empty, entire file is being added
        if (oldIsEmpty && !newIsEmpty) {
            String[] newLines = newContent.split("\n", -1);
            result.linesAdded = newLines.length;
            for (int i = 0; i < newLines.length; i++) {
                result.diffLines.add(new DiffLine(DiffLine.Type.ADDED, 0, i + 1, newLines[i]));
            }
            formatDiffLines(result);
            return result;
        }
        
        // If new is empty, entire file is being removed
        if (!oldIsEmpty && newIsEmpty) {
            String[] oldLines = oldContent.split("\n", -1);
            result.linesRemoved = oldLines.length;
            for (int i = 0; i < oldLines.length; i++) {
                result.diffLines.add(new DiffLine(DiffLine.Type.REMOVED, i + 1, 0, oldLines[i]));
            }
            formatDiffLines(result);
            return result;
        }
        
        // Both have content - compare line by line
        String[] oldLines = oldContent.split("\n", -1);
        String[] newLines = newContent.split("\n", -1);
        
        // First pass: identify changed lines
        Set<Integer> changedOldLines = new HashSet<>();
        Set<Integer> changedNewLines = new HashSet<>();
        
        int maxLines = Math.max(oldLines.length, newLines.length);
        for (int i = 0; i < maxLines; i++) {
            String oldLine = i < oldLines.length ? oldLines[i] : null;
            String newLine = i < newLines.length ? newLines[i] : null;
            
            if (oldLine == null && newLine != null) {
                // Line added
                result.linesAdded++;
                changedNewLines.add(i);
            } else if (oldLine != null && newLine == null) {
                // Line removed
                result.linesRemoved++;
                changedOldLines.add(i);
            } else if (oldLine != null && newLine != null && !oldLine.equals(newLine)) {
                // Line changed
                result.linesChanged++;
                changedOldLines.add(i);
                changedNewLines.add(i);
            }
        }
        
        // Second pass: build diff with context
        Set<Integer> linesToShow = new HashSet<>();
        
        // Add changed lines and context
        for (int i = 0; i < maxLines; i++) {
            if (changedOldLines.contains(i) || changedNewLines.contains(i)) {
                // Add context before
                for (int j = Math.max(0, i - CONTEXT_LINES); j < i; j++) {
                    linesToShow.add(j);
                }
                // Add the changed line
                linesToShow.add(i);
                // Add context after
                for (int j = i + 1; j <= Math.min(maxLines - 1, i + CONTEXT_LINES); j++) {
                    linesToShow.add(j);
                }
            }
        }
        
        // Build diff lines
        for (int i = 0; i < maxLines; i++) {
            if (!linesToShow.contains(i)) {
                continue;
            }
            
            String oldLine = i < oldLines.length ? oldLines[i] : null;
            String newLine = i < newLines.length ? newLines[i] : null;
            
            if (oldLine == null && newLine != null) {
                // Line added
                result.diffLines.add(new DiffLine(DiffLine.Type.ADDED, 0, i + 1, newLine));
            } else if (oldLine != null && newLine == null) {
                // Line removed
                result.diffLines.add(new DiffLine(DiffLine.Type.REMOVED, i + 1, 0, oldLine));
            } else if (oldLine != null && newLine != null) {
                if (!oldLine.equals(newLine)) {
                    // Line changed
                    result.diffLines.add(new DiffLine(DiffLine.Type.REMOVED, i + 1, 0, oldLine));
                    result.diffLines.add(new DiffLine(DiffLine.Type.ADDED, 0, i + 1, newLine));
                } else {
                    // Context line (unchanged)
                    result.diffLines.add(new DiffLine(DiffLine.Type.CONTEXT, i + 1, i + 1, oldLine));
                }
            }
        }
        
        formatDiffLines(result);
        return result;
    }
    
    /**
     * Format diff lines with line numbers for display
     */
    private static void formatDiffLines(DiffResult result) {
        for (DiffLine diffLine : result.diffLines) {
            String prefix;
            String lineNumStr;
            
            switch (diffLine.type) {
                case ADDED:
                    prefix = "+";
                    if (diffLine.newLineNum > 0) {
                        lineNumStr = String.format("%4d", diffLine.newLineNum);
                    } else {
                        lineNumStr = "    ";
                    }
                    result.previewLines.add(lineNumStr + " " + prefix + " " + diffLine.content);
                    break;
                case REMOVED:
                    prefix = "-";
                    if (diffLine.oldLineNum > 0) {
                        lineNumStr = String.format("%4d", diffLine.oldLineNum);
                    } else {
                        lineNumStr = "    ";
                    }
                    result.previewLines.add(lineNumStr + " " + prefix + " " + diffLine.content);
                    break;
                case CONTEXT:
                    prefix = " ";
                    if (diffLine.oldLineNum > 0) {
                        lineNumStr = String.format("%4d", diffLine.oldLineNum);
                    } else {
                        lineNumStr = "    ";
                    }
                    result.previewLines.add(lineNumStr + " " + prefix + " " + diffLine.content);
                    break;
            }
        }
    }
    
    /**
     * Get summary text for diff result
     */
    public static String getDiffSummary(DiffResult diff) {
        List<String> parts = new ArrayList<>();
        if (diff.linesAdded > 0) {
            parts.add(diff.linesAdded + " added");
        }
        if (diff.linesRemoved > 0) {
            parts.add(diff.linesRemoved + " removed");
        }
        if (diff.linesChanged > 0) {
            parts.add(diff.linesChanged + " changed");
        }
        
        if (parts.isEmpty()) {
            return "No changes";
        }
        return String.join(", ", parts);
    }
}
