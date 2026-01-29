use slint::SharedString;

use crate::script_engine::{ScriptNode, ScriptOption};

#[derive(Clone, Default)]
pub struct PreviewItem {
    pub kind: SharedString,
    pub id: SharedString,
    pub text: SharedString,

    pub token_tap: SharedString,
    pub token_change: SharedString,
    pub token_submit: SharedString,

    pub progress: f32,

    pub picker_index: i32,
    pub options_labels: Vec<SharedString>,
    pub options_values: Vec<SharedString>,

    pub value: f32,
    pub minimum: f32,
    pub maximum: f32,
    pub step: f32,

    pub checked: bool,

    pub input_text: SharedString,
    pub placeholder: SharedString,
}

pub fn flatten_preview(root: &ScriptNode) -> Vec<PreviewItem> {
    let mut out = Vec::new();
    push_node(&mut out, root);
    out
}

fn push_node(out: &mut Vec<PreviewItem>, node: &ScriptNode) {
    match node.node_type.as_str() {
        "column" | "row" | "scroll" | "grid" => {
            for child in &node.children {
                push_node(out, child);
            }
        }
        "card" => {
            let title = node
                .title
                .clone()
                .or_else(|| node.label.clone())
                .or_else(|| node.text.clone())
                .unwrap_or_else(|| "Card".to_string());
            if !title.is_empty() {
                out.push(PreviewItem {
                    kind: SharedString::from("text"),
                    id: SharedString::from(node.id.clone()),
                    text: SharedString::from(title),
                    ..Default::default()
                });
            }
            if let Some(sub) = node.subtitle.as_deref() {
                if !sub.is_empty() {
                    out.push(PreviewItem {
                        kind: SharedString::from("text"),
                        id: SharedString::from(format!("{}:subtitle", node.id)),
                        text: SharedString::from(sub.to_string()),
                        ..Default::default()
                    });
                }
            }
            for child in &node.children {
                push_node(out, child);
            }
            out.push(PreviewItem {
                kind: SharedString::from("divider"),
                id: SharedString::from(format!("{}:divider", node.id)),
                ..Default::default()
            });
        }
        "tile" => {
            let title = node
                .title
                .clone()
                .or_else(|| node.label.clone())
                .or_else(|| node.text.clone())
                .unwrap_or_else(|| "Tile".to_string());
            let value = node
                .value_str
                .clone()
                .or_else(|| node.value_num.map(|n| format!("{n}")))
                .unwrap_or_default();
            let line = if value.is_empty() {
                title
            } else {
                format!("{title}: {value}")
            };
            let disabled = node.disabled.unwrap_or(false);
            let token = node.handlers.get("tap").cloned().unwrap_or_default();
            if disabled || token.is_empty() {
                out.push(PreviewItem {
                    kind: SharedString::from("text"),
                    id: SharedString::from(node.id.clone()),
                    text: SharedString::from(line),
                    ..Default::default()
                });
            } else {
                out.push(PreviewItem {
                    kind: SharedString::from("button"),
                    id: SharedString::from(node.id.clone()),
                    text: SharedString::from(line),
                    token_tap: SharedString::from(token),
                    ..Default::default()
                });
            }
        }
        "modal" => {
            if node.open.unwrap_or(false) {
                let title = node
                    .title
                    .clone()
                    .or_else(|| node.label.clone())
                    .or_else(|| node.text.clone())
                    .unwrap_or_else(|| "Modal".to_string());
                out.push(PreviewItem {
                    kind: SharedString::from("text"),
                    id: SharedString::from(node.id.clone()),
                    text: SharedString::from(format!("{title} (modal)")),
                    ..Default::default()
                });

                if let Some(close_token) = node.handlers.get("close") {
                    if !close_token.is_empty() {
                        out.push(PreviewItem {
                            kind: SharedString::from("button"),
                            id: SharedString::from(format!("{}:close", node.id)),
                            text: SharedString::from("Close"),
                            token_tap: SharedString::from(close_token.clone()),
                            ..Default::default()
                        });
                    }
                }

                for child in &node.children {
                    push_node(out, child);
                }
                out.push(PreviewItem {
                    kind: SharedString::from("divider"),
                    id: SharedString::from(format!("{}:divider", node.id)),
                    ..Default::default()
                });
            }
        }
        "plot" => {
            let points = node.plot_points.unwrap_or(0);
            let range = match (node.min, node.max) {
                (Some(a), Some(b)) => format!(" [{a}..{b}]"),
                _ => "".to_string(),
            };
            out.push(PreviewItem {
                kind: SharedString::from("text"),
                id: SharedString::from(node.id.clone()),
                text: SharedString::from(format!("Plot: {points} points{range}")),
                ..Default::default()
            });
            if let Some(t) = node.overlay_text.as_deref() {
                if !t.is_empty() {
                    out.push(PreviewItem {
                        kind: SharedString::from("text"),
                        id: SharedString::from(format!("{}:overlay", node.id)),
                        text: SharedString::from(t.to_string()),
                        ..Default::default()
                    });
                }
            }
            if let Some(t) = node.error_text.as_deref() {
                if !t.is_empty() {
                    out.push(PreviewItem {
                        kind: SharedString::from("text"),
                        id: SharedString::from(format!("{}:error", node.id)),
                        text: SharedString::from(format!("Error: {t}")),
                        ..Default::default()
                    });
                }
            }
        }
        "text" => {
            let text = node
                .text
                .clone()
                .or_else(|| node.label.clone())
                .unwrap_or_default();
            if text.is_empty() {
                return;
            }
            out.push(PreviewItem {
                kind: SharedString::from("text"),
                id: SharedString::from(node.id.clone()),
                text: SharedString::from(text),
                ..Default::default()
            });
        }
        "button" => {
            let label = node.label.clone().unwrap_or_else(|| "Button".to_string());
            out.push(PreviewItem {
                kind: SharedString::from("button"),
                id: SharedString::from(node.id.clone()),
                text: SharedString::from(label),
                token_tap: SharedString::from(
                    node.handlers.get("tap").cloned().unwrap_or_default(),
                ),
                ..Default::default()
            });
        }
        "picker" => {
            let title = node
                .label
                .clone()
                .or_else(|| node.text.clone())
                .unwrap_or_else(|| infer_title_from_id(&node.id));

            let (labels, values) = picker_labels_values(&node.options);
            let picker_index = node
                .selected
                .as_deref()
                .and_then(|sel| values.iter().position(|v| v.as_str() == sel))
                .unwrap_or(0) as i32;

            out.push(PreviewItem {
                kind: SharedString::from("picker"),
                id: SharedString::from(node.id.clone()),
                text: SharedString::from(title),
                token_change: SharedString::from(
                    node.handlers.get("change").cloned().unwrap_or_default(),
                ),
                picker_index,
                options_labels: labels,
                options_values: values,
                ..Default::default()
            });
        }
        "slider" => {
            let title = node
                .label
                .clone()
                .or_else(|| node.text.clone())
                .unwrap_or_else(|| infer_title_from_id(&node.id));

            let min = node.min.unwrap_or(0.0) as f32;
            let max = node.max.unwrap_or(100.0) as f32;
            let step = node.step.unwrap_or(1.0) as f32;
            let value = node.value_num.unwrap_or(min as f64) as f32;

            out.push(PreviewItem {
                kind: SharedString::from("slider"),
                id: SharedString::from(node.id.clone()),
                text: SharedString::from(title),
                token_change: SharedString::from(
                    node.handlers.get("change").cloned().unwrap_or_default(),
                ),
                token_submit: SharedString::from(
                    node.handlers.get("submit").cloned().unwrap_or_default(),
                ),
                value,
                minimum: min,
                maximum: max,
                step,
                ..Default::default()
            });
        }
        "toggle" => {
            let title = node
                .label
                .clone()
                .or_else(|| node.text.clone())
                .unwrap_or_else(|| infer_title_from_id(&node.id));

            out.push(PreviewItem {
                kind: SharedString::from("toggle"),
                id: SharedString::from(node.id.clone()),
                text: SharedString::from(title),
                token_change: SharedString::from(
                    node.handlers.get("change").cloned().unwrap_or_default(),
                ),
                checked: node.checked.unwrap_or(false),
                ..Default::default()
            });
        }
        "textField" => {
            let title = node
                .label
                .clone()
                .or_else(|| node.text.clone())
                .unwrap_or_else(|| infer_title_from_id(&node.id));
            out.push(PreviewItem {
                kind: SharedString::from("textField"),
                id: SharedString::from(node.id.clone()),
                text: SharedString::from(title),
                token_change: SharedString::from(
                    node.handlers.get("change").cloned().unwrap_or_default(),
                ),
                token_submit: SharedString::from(
                    node.handlers.get("submit").cloned().unwrap_or_default(),
                ),
                input_text: SharedString::from(node.value_str.clone().unwrap_or_default()),
                placeholder: SharedString::from(node.placeholder.clone().unwrap_or_default()),
                ..Default::default()
            });
        }
        "textEditor" => {
            let title = node
                .label
                .clone()
                .or_else(|| node.text.clone())
                .unwrap_or_else(|| infer_title_from_id(&node.id));
            out.push(PreviewItem {
                kind: SharedString::from("textEditor"),
                id: SharedString::from(node.id.clone()),
                text: SharedString::from(title),
                token_change: SharedString::from(
                    node.handlers.get("change").cloned().unwrap_or_default(),
                ),
                token_submit: SharedString::from(
                    node.handlers.get("submit").cloned().unwrap_or_default(),
                ),
                input_text: SharedString::from(node.value_str.clone().unwrap_or_default()),
                placeholder: SharedString::from(node.placeholder.clone().unwrap_or_default()),
                ..Default::default()
            });
        }
        "divider" => {
            out.push(PreviewItem {
                kind: SharedString::from("divider"),
                id: SharedString::from(node.id.clone()),
                ..Default::default()
            });
        }
        "spacer" => {
            out.push(PreviewItem {
                kind: SharedString::from("spacer"),
                id: SharedString::from(node.id.clone()),
                ..Default::default()
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
                id: SharedString::from(node.id.clone()),
                text: SharedString::from(label),
                progress: pct,
                ..Default::default()
            });
        }
        "logViewer" => {
            let text = node.text.clone().unwrap_or_default();
            if !text.is_empty() {
                out.push(PreviewItem {
                    kind: SharedString::from("logViewer"),
                    id: SharedString::from(node.id.clone()),
                    text: SharedString::from("Log"),
                    input_text: SharedString::from(text),
                    ..Default::default()
                });
            }
        }
        _ => {
            // Keep the preview forgiving: unknown nodes don't crash the renderer.
            for child in &node.children {
                push_node(out, child);
            }
        }
    }
}

fn infer_title_from_id(id: &str) -> String {
    let leaf = id.rsplit('.').next().unwrap_or(id);
    if leaf.is_empty() {
        return "".to_string();
    }
    let mut chars = leaf.chars();
    let Some(first) = chars.next() else {
        return leaf.to_string();
    };
    let mut out = String::new();
    out.push(first.to_ascii_uppercase());
    out.push_str(chars.as_str());
    out
}

fn picker_labels_values(options: &[ScriptOption]) -> (Vec<SharedString>, Vec<SharedString>) {
    let mut labels = Vec::new();
    let mut values = Vec::new();
    for opt in options {
        labels.push(SharedString::from(opt.label.clone()));
        values.push(SharedString::from(opt.value.clone()));
    }
    if labels.is_empty() {
        labels.push(SharedString::from("(empty)"));
        values.push(SharedString::from(""));
    }
    (labels, values)
}
