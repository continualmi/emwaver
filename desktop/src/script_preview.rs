use slint::SharedString;

use crate::script_engine::ScriptNode;

#[derive(Clone, Default)]
pub struct PreviewItem {
    pub kind: SharedString,
    pub text: SharedString,
    pub token: SharedString,
    pub progress: f32,
}

pub fn flatten_preview(root: &ScriptNode) -> Vec<PreviewItem> {
    let mut out = Vec::new();
    push_node(&mut out, root);
    out
}

fn push_node(out: &mut Vec<PreviewItem>, node: &ScriptNode) {
    match node.node_type.as_str() {
        "column" | "row" | "scroll" | "grid" | "card" | "tile" | "modal" => {
            for child in &node.children {
                push_node(out, child);
            }
        }
        "text" => {
            let text = node
                .text
                .clone()
                .or_else(|| node.label.clone())
                .unwrap_or_default();
            if !text.is_empty() {
                out.push(PreviewItem {
                    kind: SharedString::from("text"),
                    text: SharedString::from(text),
                    token: SharedString::from(""),
                    progress: 0.0,
                });
            }
        }
        "button" => {
            let label = node.label.clone().unwrap_or_else(|| "Button".to_string());
            let token = node.handlers.get("tap").cloned().unwrap_or_default();
            out.push(PreviewItem {
                kind: SharedString::from("button"),
                text: SharedString::from(label),
                token: SharedString::from(token),
                progress: 0.0,
            });
        }
        "progress" => {
            let label = node
                .label
                .clone()
                .or_else(|| node.text.clone())
                .unwrap_or_else(|| "Progress".to_string());
            let pct = node.progress_pct.unwrap_or(0.0).max(0.0).min(100.0);
            out.push(PreviewItem {
                kind: SharedString::from("progress"),
                text: SharedString::from(label),
                token: SharedString::from(""),
                progress: pct,
            });
        }
        "logViewer" => {
            // For now, ignore: the scripts page already shows AppState.log_text.
        }
        _ => {
            // Keep the preview forgiving: unknown nodes don't crash the renderer.
            for child in &node.children {
                push_node(out, child);
            }
        }
    }
}
