/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import SwiftUI
import WebKit

#if canImport(AppKit)
import AppKit

/// Monaco Editor wrapper for macOS using WKWebView
public struct EmwCodeEditor: NSViewRepresentable {
    @Binding private var text: String
    private let isEditable: Bool
    private let wrapLines: Bool
    
    public init(text: Binding<String>, isEditable: Bool = true, wrapLines: Bool = false) {
        _text = text
        self.isEditable = isEditable
        self.wrapLines = wrapLines
    }
    
    public func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.preferences.javaScriptEnabled = true
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        
        // Set up message handlers before creating the web view
        config.userContentController.add(context.coordinator, name: "textChanged")
        config.userContentController.add(context.coordinator, name: "editorReady")
        
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")
        
        context.coordinator.webView = webView
        
        // Load Monaco editor
        let html = Self.createMonacoHTML()
        webView.loadHTMLString(html, baseURL: nil)
        
        return webView
    }
    
    public func updateNSView(_ nsView: WKWebView, context: Context) {
        context.coordinator.isEditable = isEditable
        context.coordinator.wrapLines = wrapLines
        
        // Update content if it changed from Swift side
        if context.coordinator.lastKnownText != text {
            let escapedText = text
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
                .replacingOccurrences(of: "\n", with: "\\n")
                .replacingOccurrences(of: "\r", with: "\\r")
                .replacingOccurrences(of: "\"", with: "\\\"")
            
            let js = "if (window.editor) { window.editor.setValue('\(escapedText)'); }"
            nsView.evaluateJavaScript(js, completionHandler: nil)
            context.coordinator.lastKnownText = text
        }
        
        // Update editable state
        let editableJS = "if (window.editor) { window.editor.updateOptions({ readOnly: \(!isEditable) }); }"
        nsView.evaluateJavaScript(editableJS, completionHandler: nil)
        
        // Update word wrap
        let wrapJS = "if (window.editor) { window.editor.updateOptions({ wordWrap: '\(wrapLines ? "on" : "off")' }); }"
        nsView.evaluateJavaScript(wrapJS, completionHandler: nil)
    }
    
    public func makeCoordinator() -> Coordinator {
        Coordinator(text: $text, isEditable: isEditable, wrapLines: wrapLines)
    }
    
    private static func createMonacoHTML() -> String {
        return """
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body, html {
                    margin: 0;
                    padding: 0;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                    background: #1e1e1e;
                }
                #container {
                    width: 100%;
                    height: 100%;
                }
            </style>
            <script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/loader.js"></script>
        </head>
        <body>
            <div id="container"></div>
            <script>
                require.config({ paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' }});
                
                window.MonacoEnvironment = {
                    getWorkerUrl: function(workerId, label) {
                        return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
                            self.MonacoEnvironment = {
                                baseUrl: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/'
                            };
                            importScripts('https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/base/worker/workerMain.js');
                        `)}`;
                    }
                };
                
                require(['vs/editor/editor.main'], function() {
                    window.editor = monaco.editor.create(document.getElementById('container'), {
                        value: '',
                        language: 'javascript',
                        theme: 'vs-dark',
                        automaticLayout: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: 13,
                        fontFamily: 'SF Mono, Monaco, Menlo, monospace',
                        lineNumbers: 'on',
                        roundedSelection: true,
                        renderLineHighlight: 'line',
                        selectOnLineNumbers: true,
                        wordWrap: 'off',
                        readOnly: false,
                        contextmenu: true,
                        mouseWheelZoom: true,
                        smoothScrolling: true,
                        cursorBlinking: 'smooth',
                        cursorSmoothCaretAnimation: 'on',
                        bracketPairColorization: { enabled: true },
                        guides: {
                            bracketPairs: true,
                            indentation: true
                        }
                    });
                    
                    // Notify Swift that editor is ready
                    if (window.webkit && window.webkit.messageHandlers) {
                        window.webkit.messageHandlers.editorReady.postMessage('ready');
                    }
                    
                    // Listen for content changes
                    window.editor.onDidChangeModelContent(function(e) {
                        var value = window.editor.getValue();
                        if (window.webkit && window.webkit.messageHandlers) {
                            window.webkit.messageHandlers.textChanged.postMessage(value);
                        }
                    });
                });
            </script>
        </body>
        </html>
        """
    }
    
    public class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        @Binding private var text: String
        var isEditable: Bool
        var wrapLines: Bool
        var lastKnownText: String = ""
        weak var webView: WKWebView?
        
        init(text: Binding<String>, isEditable: Bool, wrapLines: Bool) {
            _text = text
            self.isEditable = isEditable
            self.wrapLines = wrapLines
            self.lastKnownText = text.wrappedValue
        }
        
        public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // Set initial content
            let escapedText = lastKnownText
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
                .replacingOccurrences(of: "\n", with: "\\n")
                .replacingOccurrences(of: "\r", with: "\\r")
                .replacingOccurrences(of: "\"", with: "\\\"")
            
            let js = """
                if (window.editor) {
                    window.editor.setValue('\(escapedText)');
                    window.editor.updateOptions({ readOnly: \(!isEditable), wordWrap: '\(wrapLines ? "on" : "off")' });
                }
            """
            webView.evaluateJavaScript(js, completionHandler: nil)
        }
        
        public func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            switch message.name {
            case "textChanged":
                if let newText = message.body as? String {
                    DispatchQueue.main.async {
                        self.lastKnownText = newText
                        self.text = newText
                    }
                }
            case "editorReady":
                print("Monaco Editor is ready")
            default:
                break
            }
        }
    }
}

#endif
