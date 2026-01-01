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

import Foundation
import SwiftUI

struct DiffResult {
    var originalLines: [String]
    var newLines: [String]
    var previewLines: [String]
    var linesAdded: Int
    var linesRemoved: Int
}

class GitHubDiffUtil {
    
    static func calculateDiff(original: String, new: String) -> DiffResult {
        let originalLines = original.components(separatedBy: .newlines)
        let newLines = new.components(separatedBy: .newlines)
        
        // Very basic diff implementation
        // For a real Myers diff, we'd need a complex algorithm.
        // For now, we'll try to match lines and show simple add/remove.
        
        // This is a placeholder for a robust diff algorithm.
        // It simply checks line by line.
        
        var previewLines: [String] = []
        var added = 0
        var removed = 0
        
        // Use a standard diff library if possible, but manual implementation here:
        // We'll use the Longest Common Subsequence (LCS) logic simplified or just a simple scanner.
        // Let's do a simple comparison for now to unblock features.
        
        // Fast approach: standard LCS for lines
        let diff = simpleDiff(oldLines: originalLines, newLines: newLines)
        
        for change in diff {
            switch change {
            case .insert(let line):
                previewLines.append("+ \(line)")
                added += 1
            case .delete(let line):
                previewLines.append("- \(line)")
                removed += 1
            case .equal(let line):
                previewLines.append("  \(line)")
            }
        }
        
        return DiffResult(
            originalLines: originalLines,
            newLines: newLines,
            previewLines: previewLines,
            linesAdded: added,
            linesRemoved: removed
        )
    }
    
    enum DiffChange {
        case insert(String)
        case delete(String)
        case equal(String)
    }
    
    // Simple LCS-based Diff
    private static func simpleDiff(oldLines: [String], newLines: [String]) -> [DiffChange] {
        let n = oldLines.count
        let m = newLines.count
        
        // Matrix for LCS length
        var matrix = Array(repeating: Array(repeating: 0, count: m + 1), count: n + 1)
        
        for i in 1...n {
            for j in 1...m {
                if oldLines[i-1] == newLines[j-1] {
                    matrix[i][j] = matrix[i-1][j-1] + 1
                } else {
                    matrix[i][j] = max(matrix[i-1][j], matrix[i][j-1])
                }
            }
        }
        
        // Backtrack
        var changes: [DiffChange] = []
        var i = n
        var j = m
        
        while i > 0 || j > 0 {
            if i > 0 && j > 0 && oldLines[i-1] == newLines[j-1] {
                changes.append(.equal(oldLines[i-1]))
                i -= 1
                j -= 1
            } else if j > 0 && (i == 0 || matrix[i][j-1] >= matrix[i-1][j]) {
                changes.append(.insert(newLines[j-1]))
                j -= 1
            } else if i > 0 && (j == 0 || matrix[i][j-1] < matrix[i-1][j]) {
                changes.append(.delete(oldLines[i-1]))
                i -= 1
            }
        }
        
        return changes.reversed()
    }
}
