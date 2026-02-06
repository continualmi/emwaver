/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.scripts;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.text.method.PasswordTransformationMethod;
import android.util.AttributeSet;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.GridLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Space;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.button.MaterialButtonToggleGroup;
import com.google.android.material.divider.MaterialDivider;
import com.google.android.material.progressindicator.LinearProgressIndicator;
import com.google.android.material.slider.Slider;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class ScriptRenderView extends FrameLayout {

    public interface EventListener {
        void onEvent(String handlerToken, List<Object> arguments);
    }

    /**
     * Remote UI event dispatch (v1).
     *
     * When attached to a remote host, we dispatch UI events by (nodeId,eventType,value)
     * and let the host resolve handler tokens against its own active ScriptTree.
     */
    public interface RemoteEventListener {
        void onRemoteEvent(@NonNull String targetNodeId, @NonNull ScriptEventType eventType, @Nullable Object value);
    }

    private enum Orientation {
        VERTICAL,
        HORIZONTAL
    }

    private EventListener eventListener;
    private RemoteEventListener remoteEventListener;
    private final float density;
    public ScriptRenderView(@NonNull Context context) {
        this(context, null);
    }

    public ScriptRenderView(@NonNull Context context, @Nullable AttributeSet attrs) {
        super(context, attrs);
        density = context.getResources().getDisplayMetrics().density;
        setLayoutParams(new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
    }

    public void setEventListener(@Nullable EventListener listener) {
        this.eventListener = listener;
    }

    public void setRemoteEventListener(@Nullable RemoteEventListener listener) {
        this.remoteEventListener = listener;
    }

    public void clear() {
        removeAllViews();
    }

    public void render(@Nullable ScriptTree tree) {
        removeAllViews();
        if (tree == null || tree.getRoot() == null) {
            return;
        }
        View root = buildView(tree.getRoot(), null);
        if (root != null) {
            LayoutParams params = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
            addView(root, params);
        }
    }

    private View buildView(ScriptNode node, @Nullable Orientation parentOrientation) {
        switch (node.getType()) {
            case COLUMN:
                return buildColumn(node);
            case ROW:
                return buildRow(node);
            case TEXT:
                return buildText(node);
            case BUTTON:
                return buildButton(node);
            case SLIDER:
                return buildSlider(node);
            case LOG_VIEWER:
                return buildLogViewer(node);
            case SCROLL:
                return buildScroll(node);
            case TEXT_FIELD:
                return buildTextField(node);
            case TEXT_EDITOR:
                return buildTextEditor(node);
            case PICKER:
                return buildPicker(node);
            case GRID:
                return buildGrid(node);
            case SPACER:
                return buildSpacer(node, parentOrientation);
            case DIVIDER:
                return buildDivider(node);
            case PROGRESS:
                return buildProgress(node);
            default:
                return new View(getContext());
        }
    }

    private View buildColumn(ScriptNode node) {
        LinearLayout layout = new LinearLayout(getContext());
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setLayoutParams(new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        configureAlignment(layout, node.getProps(), Orientation.VERTICAL);
        int spacingPx = spacingPx(node.getProps());
        for (ScriptNode child : node.getChildren()) {
            View childView = buildView(child, Orientation.VERTICAL);
            if (childView == null) {
                continue;
            }
            LinearLayout.LayoutParams params = buildChildLayoutParams(child.getProps(), Orientation.VERTICAL);
            if (spacingPx > 0 && layout.getChildCount() > 0) {
                params.topMargin = spacingPx;
            }
            applySizeConstraints(childView, child.getProps());
            layout.addView(childView, params);
        }
        applyCommonStyles(layout, node.getProps());
        return layout;
    }

    private View buildRow(ScriptNode node) {
        LinearLayout layout = new LinearLayout(getContext());
        layout.setOrientation(LinearLayout.HORIZONTAL);
        layout.setLayoutParams(new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        configureAlignment(layout, node.getProps(), Orientation.HORIZONTAL);
        int spacingPx = spacingPx(node.getProps());
        for (ScriptNode child : node.getChildren()) {
            View childView = buildView(child, Orientation.HORIZONTAL);
            if (childView == null) {
                continue;
            }
            LinearLayout.LayoutParams params = buildChildLayoutParams(child.getProps(), Orientation.HORIZONTAL);
            if (spacingPx > 0 && layout.getChildCount() > 0) {
                params.leftMargin = spacingPx;
            }
            applySizeConstraints(childView, child.getProps());
            layout.addView(childView, params);
        }
        applyCommonStyles(layout, node.getProps());
        return layout;
    }

    private View buildText(ScriptNode node) {
        ScriptNodeProps props = node.getProps();
        TextView textView = new TextView(getContext());
        String text = props.getString("text");
        if (text == null) {
            text = props.getString("label");
        }
        textView.setText(text != null ? text : "");
        applyTextAppearance(textView, props);
        applyCommonStyles(textView, props);
        return textView;
    }

    private View buildButton(ScriptNode node) {
        ScriptNodeProps props = node.getProps();
        MaterialButton button = new MaterialButton(getContext());

        String label = props.getString("label");
        button.setText(label != null ? label : "Button");

        configureButtonAppearance(button, props);

        String token = props.getHandlerToken(ScriptEventType.TAP);
        if (token != null) {
            button.setOnClickListener(v -> {
                if (remoteEventListener != null) {
                    remoteEventListener.onRemoteEvent(node.getId(), ScriptEventType.TAP, null);
                } else {
                    dispatchEvent(token, Collections.emptyList());
                }
            });
        }

        applyCommonStyles(button, props);
        return button;
    }

    private View buildSlider(ScriptNode node) {
        ScriptNodeProps props = node.getProps();
        LinearLayout container = new LinearLayout(getContext());
        container.setOrientation(LinearLayout.VERTICAL);
        container.setLayoutParams(new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        String label = props.getString("label");
        if (label != null && !label.isEmpty()) {
            TextView labelView = new TextView(getContext());
            labelView.setText(label);
            labelView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            labelView.setTextColor(Color.GRAY);
            container.addView(labelView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }

        Slider slider = new Slider(getContext());
        Double min = props.getDouble("min");
        Double max = props.getDouble("max");
        Double value = props.getDouble("value");
        slider.setValueFrom(min != null ? min.floatValue() : 0f);
        slider.setValueTo(max != null ? max.floatValue() : 1f);
        slider.setStepSize(0.0f);
        slider.setValue(value != null ? value.floatValue() : 0f);

        String token = props.getHandlerToken(ScriptEventType.CHANGE);
        if (token != null) {
            slider.addOnChangeListener((s, v, fromUser) -> {
                if (!fromUser) {
                    return;
                }
                if (remoteEventListener != null) {
                    remoteEventListener.onRemoteEvent(node.getId(), ScriptEventType.CHANGE, (double) v);
                } else {
                    dispatchEvent(token, Collections.singletonList((double) v));
                }
            });
        }

        container.addView(slider, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        applyCommonStyles(container, props);
        return container;
    }

    private View buildLogViewer(ScriptNode node) {
        ScriptNodeProps props = node.getProps();
        ScrollView scrollView = new ScrollView(getContext());
        TextView logText = new TextView(getContext());
        String explicitText = props.getString("text");
        logText.setText(explicitText != null ? explicitText : "");
        logText.setTypeface(Typeface.MONOSPACE);
        logText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        logText.setPadding(dpToPx(12), dpToPx(12), dpToPx(12), dpToPx(12));

        Integer foregroundColor = ScriptValueUtils.parseColor(props.get("foregroundColor"));
        if (foregroundColor != null) {
            logText.setTextColor(foregroundColor);
        }

        Double minHeight = props.getDouble("minHeight");
        if (minHeight != null) {
            scrollView.setMinimumHeight(dpToPx(minHeight));
        }

        scrollView.addView(logText, new ScrollView.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        applyCommonStyles(scrollView, props);
        return scrollView;
    }

    private View buildScroll(ScriptNode node) {
        ScriptNodeProps props = node.getProps();
        String axis = props.getString("axis");
        View content;
        if (axis != null && axis.equalsIgnoreCase("horizontal")) {
            HorizontalScrollView scrollView = new HorizontalScrollView(getContext());
            LinearLayout inner = new LinearLayout(getContext());
            inner.setOrientation(LinearLayout.HORIZONTAL);
            int spacingPx = spacingPx(props);
            for (ScriptNode child : node.getChildren()) {
                View childView = buildView(child, Orientation.HORIZONTAL);
                if (childView == null) {
                    continue;
                }
                LinearLayout.LayoutParams params = buildChildLayoutParams(child.getProps(), Orientation.HORIZONTAL);
                if (spacingPx > 0 && inner.getChildCount() > 0) {
                    params.leftMargin = spacingPx;
                }
                applySizeConstraints(childView, child.getProps());
                inner.addView(childView, params);
            }
            scrollView.addView(inner, new HorizontalScrollView.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));
            content = scrollView;
        } else {
            ScrollView scrollView = new ScrollView(getContext());
            LinearLayout inner = new LinearLayout(getContext());
            inner.setOrientation(LinearLayout.VERTICAL);
            int spacingPx = spacingPx(props);
            for (ScriptNode child : node.getChildren()) {
                View childView = buildView(child, Orientation.VERTICAL);
                if (childView == null) {
                    continue;
                }
                LinearLayout.LayoutParams params = buildChildLayoutParams(child.getProps(), Orientation.VERTICAL);
                if (spacingPx > 0 && inner.getChildCount() > 0) {
                    params.topMargin = spacingPx;
                }
                applySizeConstraints(childView, child.getProps());
                inner.addView(childView, params);
            }
            scrollView.addView(inner, new ScrollView.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
            content = scrollView;
        }
        applyCommonStyles(content, props);
        return content;
    }

    private View buildTextField(ScriptNode node) {
        ScriptNodeProps props = node.getProps();
        LinearLayout container = new LinearLayout(getContext());
        container.setOrientation(LinearLayout.VERTICAL);
        String label = props.getString("label");
        if (label != null && !label.isEmpty()) {
            TextView labelView = new TextView(getContext());
            labelView.setText(label);
            labelView.setTypeface(Typeface.DEFAULT_BOLD);
            container.addView(labelView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }

        TextInputLayout inputLayout = new TextInputLayout(getContext(), null, com.google.android.material.R.attr.textInputOutlinedStyle);
        TextInputEditText editText = new TextInputEditText(inputLayout.getContext());
        editText.setText(props.getString("value") != null ? props.getString("value") : "");
        String placeholder = props.getString("placeholder");
        if (placeholder != null) {
            inputLayout.setHint(placeholder);
        }
        configureInputType(editText, props);

        String changeToken = props.getHandlerToken(ScriptEventType.CHANGE);
        if (changeToken != null) {
            editText.addTextChangedListener(new FocusAwareTextWatcher(editText) {
                @Override
                public void onTextChanged(String value) {
                    if (remoteEventListener != null) {
                        remoteEventListener.onRemoteEvent(node.getId(), ScriptEventType.CHANGE, value);
                    } else {
                        dispatchEvent(changeToken, Collections.singletonList(value));
                    }
                }
            });
        }

        String submitToken = props.getHandlerToken(ScriptEventType.SUBMIT);
        if (submitToken != null) {
            editText.setOnEditorActionListener((v, actionId, event) -> {
                String value = v.getText() != null ? v.getText().toString() : "";
                if (remoteEventListener != null) {
                    remoteEventListener.onRemoteEvent(node.getId(), ScriptEventType.SUBMIT, value);
                } else {
                    dispatchEvent(submitToken, Collections.singletonList(value));
                }
                return false;
            });
        }

        inputLayout.addView(editText, new TextInputLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        container.addView(inputLayout, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        applyCommonStyles(container, props);
        return container;
    }

    private View buildTextEditor(ScriptNode node) {
        ScriptNodeProps props = node.getProps();
        LinearLayout container = new LinearLayout(getContext());
        container.setOrientation(LinearLayout.VERTICAL);
        String label = props.getString("label");
        if (label != null && !label.isEmpty()) {
            TextView labelView = new TextView(getContext());
            labelView.setText(label);
            labelView.setTypeface(Typeface.DEFAULT_BOLD);
            container.addView(labelView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }

        TextInputLayout inputLayout = new TextInputLayout(getContext(), null, com.google.android.material.R.attr.textInputOutlinedStyle);
        TextInputEditText editText = new TextInputEditText(inputLayout.getContext());
        editText.setMinLines(4);
        editText.setMaxLines(Integer.MAX_VALUE);
        editText.setGravity(Gravity.TOP | Gravity.START);
        editText.setText(props.getString("value") != null ? props.getString("value") : "");
        editText.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        String placeholder = props.getString("placeholder");
        if (placeholder != null) {
            inputLayout.setHint(placeholder);
        }

        String changeToken = props.getHandlerToken(ScriptEventType.CHANGE);
        if (changeToken != null) {
            editText.addTextChangedListener(new FocusAwareTextWatcher(editText) {
                @Override
                public void onTextChanged(String value) {
                    if (remoteEventListener != null) {
                        remoteEventListener.onRemoteEvent(node.getId(), ScriptEventType.CHANGE, value);
                    } else {
                        dispatchEvent(changeToken, Collections.singletonList(value));
                    }
                }
            });
        }

        inputLayout.addView(editText, new TextInputLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        container.addView(inputLayout, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        applyCommonStyles(container, props);
        return container;
    }

    private View buildPicker(ScriptNode node) {
        ScriptNodeProps props = node.getProps();
        List<PickerOption> options = parseOptions(props.getList("options"));
        String selectedValue = props.getString("selected");
        String token = props.getHandlerToken(ScriptEventType.CHANGE);
        String style = props.getString("style");

        if (style != null && style.equalsIgnoreCase("segmented")) {
            MaterialButtonToggleGroup group = new MaterialButtonToggleGroup(getContext());
            group.setSingleSelection(true);
            final boolean[] suppress = {true};
            int selectedId = View.NO_ID;
            for (PickerOption option : options) {
                MaterialButton button = new MaterialButton(getContext(), null, com.google.android.material.R.attr.materialButtonOutlinedStyle);
                button.setText(option.label);
                int viewId = View.generateViewId();
                button.setId(viewId);
                group.addView(button, new MaterialButtonToggleGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                if (option.value.equals(selectedValue)) {
                    selectedId = viewId;
                }
                button.setTag(option.value);
            }
            if (selectedId != View.NO_ID) {
                group.check(selectedId);
            }
            suppress[0] = false;
            if (token != null) {
                group.addOnButtonCheckedListener((toggleGroup, checkedId, isChecked) -> {
                    if (suppress[0] || !isChecked) {
                        return;
                    }
                    View checkedButton = toggleGroup.findViewById(checkedId);
                    if (checkedButton != null) {
                        Object tag = checkedButton.getTag();
                        Object value = tag != null ? tag : "";
                        if (remoteEventListener != null) {
                            remoteEventListener.onRemoteEvent(node.getId(), ScriptEventType.CHANGE, value);
                        } else {
                            dispatchEvent(token, Collections.singletonList(value));
                        }
                    }
                });
            }
            applyCommonStyles(group, props);
            return group;
        } else {
            Spinner spinner = new Spinner(getContext());
            List<String> labels = new ArrayList<>();
            int selectedIndex = 0;
            for (int i = 0; i < options.size(); i++) {
                PickerOption option = options.get(i);
                labels.add(option.label);
                if (option.value.equals(selectedValue)) {
                    selectedIndex = i;
                }
            }
            ArrayAdapter<String> adapter = new ArrayAdapter<>(getContext(), android.R.layout.simple_spinner_item, labels);
            adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
            spinner.setAdapter(adapter);
            spinner.setSelection(selectedIndex, false);
            if (token != null) {
                final boolean[] suppress = {true};
                final int initialIndex = selectedIndex;
                spinner.setOnItemSelectedListener(new SimpleItemSelectedListener() {
                    @Override
                    public void onItemSelected(int position) {
                        if (suppress[0]) {
                            suppress[0] = false;
                            if (position == initialIndex) {
                                return;
                            }
                        }
                        Object value = options.get(position).value;
                        if (remoteEventListener != null) {
                            remoteEventListener.onRemoteEvent(node.getId(), ScriptEventType.CHANGE, value);
                        } else {
                            dispatchEvent(token, Collections.singletonList(value));
                        }
                    }
                });
            }
            applyCommonStyles(spinner, props);
            return spinner;
        }
    }

    private View buildGrid(ScriptNode node) {
        ScriptNodeProps props = node.getProps();
        int columns = props.getDouble("columns") != null ? props.getDouble("columns").intValue() : 2;
        int spacingPx = spacingPx(props);
        GridLayout grid = new GridLayout(getContext());
        grid.setColumnCount(Math.max(columns, 1));
        grid.setLayoutParams(new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        grid.setUseDefaultMargins(false);
        List<ScriptNode> children = node.getChildren();
        for (int index = 0; index < children.size(); index++) {
            ScriptNode child = children.get(index);
            View childView = buildView(child, null);
            if (childView == null) {
                continue;
            }
            GridLayout.LayoutParams params = new GridLayout.LayoutParams();
            params.width = 0;
            params.height = ViewGroup.LayoutParams.WRAP_CONTENT;
            params.columnSpec = GridLayout.spec(index % Math.max(columns, 1), 1f);
            params.rowSpec = GridLayout.spec(index / Math.max(columns, 1));
            if (spacingPx > 0) {
                params.setMargins(spacingPx / 2, spacingPx / 2, spacingPx / 2, spacingPx / 2);
            }
            applySizeConstraints(childView, child.getProps());
            grid.addView(childView, params);
        }
        applyCommonStyles(grid, props);
        return grid;
    }

    private View buildSpacer(ScriptNode node, @Nullable Orientation parentOrientation) {
        ScriptNodeProps props = node.getProps();
        Space space = new Space(getContext());
        Double minLength = props.getDouble("minLength");
        if (minLength != null) {
            if (parentOrientation == Orientation.HORIZONTAL) {
                space.setMinimumWidth(dpToPx(minLength));
            } else {
                space.setMinimumHeight(dpToPx(minLength));
            }
        }
        return space;
    }

    private View buildDivider(ScriptNode node) {
        ScriptNodeProps props = node.getProps();
        MaterialDivider divider = new MaterialDivider(getContext());
        divider.setLayoutParams(new LayoutParams(LayoutParams.MATCH_PARENT, dpToPx(1)));
        Integer color = ScriptValueUtils.parseColor(props.get("backgroundColor"));
        if (color != null) {
            divider.setDividerColor(color);
        }
        applyCommonStyles(divider, props);
        return divider;
    }

    private View buildProgress(ScriptNode node) {
        ScriptNodeProps props = node.getProps();
        LinearLayout container = new LinearLayout(getContext());
        container.setOrientation(LinearLayout.VERTICAL);

        String label = props.getString("label");
        if (label != null && !label.isEmpty()) {
            TextView labelView = new TextView(getContext());
            labelView.setText(label);
            labelView.setTypeface(Typeface.DEFAULT_BOLD);
            container.addView(labelView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }

        LinearProgressIndicator indicator = new LinearProgressIndicator(getContext());
        Double value = props.getDouble("value");
        Double total = props.getDouble("total");
        if (value != null && total != null && total > 0) {
            indicator.setIndeterminate(false);
            indicator.setProgressCompat((int) Math.round((value / total) * indicator.getMax()), true);
        } else {
            indicator.setIndeterminate(true);
        }
        container.addView(indicator, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        String detail = props.getString("detail");
        if (detail != null && !detail.isEmpty()) {
            TextView detailView = new TextView(getContext());
            detailView.setText(detail);
            detailView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            detailView.setTextColor(Color.GRAY);
            container.addView(detailView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }

        applyCommonStyles(container, props);
        return container;
    }

    private void configureAlignment(LinearLayout layout, ScriptNodeProps props, Orientation orientation) {
        String alignment = props.getString("alignment");
        if (alignment == null) {
            return;
        }
        switch (alignment.toLowerCase(Locale.US)) {
            case "center":
                if (orientation == Orientation.VERTICAL) {
                    layout.setGravity(Gravity.CENTER_HORIZONTAL);
                } else {
                    layout.setGravity(Gravity.CENTER_VERTICAL);
                }
                break;
            case "trailing":
            case "end":
                if (orientation == Orientation.VERTICAL) {
                    layout.setGravity(Gravity.END);
                } else {
                    layout.setGravity(Gravity.BOTTOM);
                }
                break;
            case "leading":
            case "start":
                if (orientation == Orientation.VERTICAL) {
                    layout.setGravity(Gravity.START);
                } else {
                    layout.setGravity(Gravity.TOP);
                }
                break;
            default:
                break;
        }
    }

    private LinearLayout.LayoutParams buildChildLayoutParams(ScriptNodeProps props, Orientation parentOrientation) {
        int width = ViewGroup.LayoutParams.WRAP_CONTENT;
        int height = ViewGroup.LayoutParams.WRAP_CONTENT;
        float weight = 0f;

        Boolean fillsWidth = props.getBoolean("fillsWidth");
        boolean fill = fillsWidth != null ? fillsWidth : parentOrientation == Orientation.VERTICAL;

        if (parentOrientation == Orientation.VERTICAL) {
            if (fill) {
                width = ViewGroup.LayoutParams.MATCH_PARENT;
            }
            Double flex = firstNonNull(props.getDouble("flex"), props.getDouble("layoutPriority"));
            if (flex != null && flex > 0) {
                height = 0;
                weight = flex.floatValue();
            }
        } else {
            if (fill) {
                width = 0;
                weight = 1f;
            }
            Double flex = firstNonNull(props.getDouble("flex"), props.getDouble("layoutPriority"));
            if (flex != null && flex > 0) {
                width = 0;
                weight = flex.floatValue();
            }
        }

        Double explicitWidth = props.getDouble("width");
        if (explicitWidth != null) {
            width = dpToPx(explicitWidth);
            if (parentOrientation == Orientation.HORIZONTAL) {
                weight = 0f;
            }
        }
        Double explicitHeight = props.getDouble("height");
        if (explicitHeight != null) {
            height = dpToPx(explicitHeight);
            weight = 0f;
        }

        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width, height);
        params.weight = weight;
        return params;
    }

    private void applySizeConstraints(View view, ScriptNodeProps props) {
        Double minWidth = props.getDouble("minWidth");
        if (minWidth != null) {
            view.setMinimumWidth(dpToPx(minWidth));
        }
        Double minHeight = props.getDouble("minHeight");
        if (minHeight != null) {
            view.setMinimumHeight(dpToPx(minHeight));
        }
    }

    private void applyCommonStyles(View view, ScriptNodeProps props) {
        applyPadding(view, props);
        applyBackground(view, props);
    }

    private void applyPadding(View view, ScriptNodeProps props) {
        Object paddingObj = props.get("padding");
        if (paddingObj == null) {
            return;
        }
        int top = 0;
        int bottom = 0;
        int start = 0;
        int end = 0;
        if (paddingObj instanceof Number) {
            int value = dpToPx(((Number) paddingObj).doubleValue());
            top = bottom = start = end = value;
        } else if (paddingObj instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> map = (Map<String, Object>) paddingObj;
            top = dpToPx(ScriptValueUtils.asDouble(map.get("top"), 0d));
            bottom = dpToPx(ScriptValueUtils.asDouble(map.get("bottom"), 0d));
            start = dpToPx(ScriptValueUtils.asDouble(map.get("leading"), 0d));
            end = dpToPx(ScriptValueUtils.asDouble(map.get("trailing"), 0d));
        }
        view.setPaddingRelative(start, top, end, bottom);
    }

    private void applyBackground(View view, ScriptNodeProps props) {
        Integer backgroundColor = ScriptValueUtils.parseColor(props.get("backgroundColor"));
        Double cornerRadius = props.getDouble("cornerRadius");
        if (backgroundColor == null && cornerRadius == null) {
            return;
        }
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(backgroundColor != null ? backgroundColor : Color.TRANSPARENT);
        if (cornerRadius != null) {
            drawable.setCornerRadius((float) (cornerRadius * density));
        }
        view.setBackground(drawable);
    }

    private void applyTextAppearance(TextView textView, ScriptNodeProps props) {
        String font = props.getString("font");
        if (font != null) {
            switch (font.toLowerCase(Locale.US)) {
                case "largetitle":
                    textView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
                    break;
                case "title":
                    textView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
                    break;
                case "title2":
                    textView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
                    break;
                case "title3":
                    textView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
                    break;
                case "headline":
                    textView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
                    break;
                case "subheadline":
                    textView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
                    break;
                case "callout":
                    textView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
                    break;
                case "caption":
                    textView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
                    break;
                case "caption2":
                    textView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
                    break;
                case "footnote":
                    textView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
                    break;
                default:
                    textView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
                    break;
            }
        }

        String fontWeight = props.getString("fontWeight");
        if (fontWeight != null) {
            switch (fontWeight.toLowerCase(Locale.US)) {
                case "bold":
                    textView.setTypeface(null, Typeface.BOLD);
                    break;
                case "semibold":
                case "medium":
                    textView.setTypeface(null, Typeface.BOLD);
                    break;
                case "light":
                case "thin":
                    textView.setTypeface(null, Typeface.NORMAL);
                    break;
                default:
                    textView.setTypeface(null, Typeface.NORMAL);
                    break;
            }
        }

        Integer foregroundColor = ScriptValueUtils.parseColor(props.get("foregroundColor"));
        if (foregroundColor != null) {
            textView.setTextColor(foregroundColor);
        }
    }

    private void configureButtonAppearance(MaterialButton button, ScriptNodeProps props) {
        Integer backgroundColor = ScriptValueUtils.parseColor(props.get("backgroundColor"));
        Integer foregroundColor = ScriptValueUtils.parseColor(props.get("foregroundColor"));
        Double cornerRadius = props.getDouble("cornerRadius");
        if (backgroundColor != null) {
            button.setBackgroundTintList(ColorStateList.valueOf(backgroundColor));
        }
        if (foregroundColor != null) {
            button.setTextColor(foregroundColor);
        }
        if (cornerRadius != null) {
            button.setCornerRadius((int) (cornerRadius * density));
        }

        String buttonStyle = props.getString("buttonStyle");
        if (buttonStyle != null) {
            switch (buttonStyle.toLowerCase(Locale.US)) {
                case "plain":
                    button.setBackgroundTintList(ColorStateList.valueOf(Color.TRANSPARENT));
                    button.setStrokeWidth(0);
                    break;
                case "bordered":
                    button.setBackgroundTintList(ColorStateList.valueOf(Color.TRANSPARENT));
                    button.setStrokeWidth(dpToPx(1));
                    button.setStrokeColor(ColorStateList.valueOf(foregroundColor != null ? foregroundColor : Color.GRAY));
                    break;
                case "borderedprominent":
                    if (backgroundColor == null) {
                        button.setBackgroundTintList(ColorStateList.valueOf(fetchAccentColor()));
                    }
                    break;
                case "automatic":
                default:
                    break;
            }
        }
    }

    private int fetchAccentColor() {
        TypedValue value = new TypedValue();
        boolean resolved = getContext().getTheme().resolveAttribute(com.google.android.material.R.attr.colorPrimary, value, true);
        if (resolved) {
            return value.data;
        }
        return Color.parseColor("#1D4ED8");
    }

    private void configureInputType(EditText editText, ScriptNodeProps props) {
        String keyboard = props.getString("keyboard");
        int inputType = InputType.TYPE_CLASS_TEXT;
        if (keyboard != null) {
            switch (keyboard.toLowerCase(Locale.US)) {
                case "number":
                    inputType = InputType.TYPE_CLASS_NUMBER;
                    break;
                case "decimal":
                    inputType = InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL;
                    break;
                case "email":
                    inputType = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS;
                    break;
                case "url":
                    inputType = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI;
                    break;
                case "phone":
                    inputType = InputType.TYPE_CLASS_PHONE;
                    break;
                case "password":
                    inputType = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD;
                    break;
                case "ascii":
                    inputType = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS;
                    break;
                default:
                    inputType = InputType.TYPE_CLASS_TEXT;
                    break;
            }
        }

        String autocap = props.getString("autocapitalize");
        if (autocap != null) {
            switch (autocap.toLowerCase(Locale.US)) {
                case "none":
                    inputType &= ~InputType.TYPE_TEXT_FLAG_CAP_SENTENCES;
                    inputType &= ~InputType.TYPE_TEXT_FLAG_CAP_WORDS;
                    inputType &= ~InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS;
                    inputType |= InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS;
                    break;
                case "words":
                    inputType |= InputType.TYPE_TEXT_FLAG_CAP_WORDS;
                    break;
                case "sentences":
                    inputType |= InputType.TYPE_TEXT_FLAG_CAP_SENTENCES;
                    break;
                case "characters":
                    inputType |= InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS;
                    break;
                default:
                    break;
            }
        }
        editText.setInputType(inputType);

        Boolean secure = props.getBoolean("secure");
        if (secure != null && secure) {
            editText.setTransformationMethod(PasswordTransformationMethod.getInstance());
        }
    }

    private void dispatchEvent(String token, List<Object> arguments) {
        if (eventListener != null) {
            android.util.Log.d("ScriptRenderView", "dispatching event token=" + token + " args=" + arguments);
            eventListener.onEvent(token, arguments);
        }
    }

    private int dpToPx(double value) {
        return (int) Math.round(value * density);
    }

    private Double firstNonNull(Double first, Double second) {
        return first != null ? first : second;
    }

    private int spacingPx(ScriptNodeProps props) {
        Double spacing = props.getDouble("spacing");
        return spacing != null ? dpToPx(spacing) : 0;
    }

    private List<PickerOption> parseOptions(List<Object> rawOptions) {
        List<PickerOption> options = new ArrayList<>();
        for (Object option : rawOptions) {
            if (option instanceof Map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> map = (Map<String, Object>) option;
                String label = map.get("label") != null ? String.valueOf(map.get("label")) : "Option";
                String value = map.get("value") != null ? String.valueOf(map.get("value")) : label;
                options.add(new PickerOption(label, value));
            }
        }
        return options;
    }

    private abstract static class FocusAwareTextWatcher implements TextWatcher {
        private final View target;

        FocusAwareTextWatcher(View target) {
            this.target = target;
        }

        @Override
        public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

        @Override
        public void onTextChanged(CharSequence s, int start, int before, int count) {}

        @Override
        public void afterTextChanged(Editable s) {
            if (target.hasFocus()) {
                onTextChanged(s != null ? s.toString() : "");
            }
        }

        public abstract void onTextChanged(String value);
    }

    private abstract static class SimpleItemSelectedListener implements android.widget.AdapterView.OnItemSelectedListener {
        @Override
        public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
            onItemSelected(position);
        }

        @Override
        public void onNothingSelected(android.widget.AdapterView<?> parent) {}

        public abstract void onItemSelected(int position);
    }

    private static final class PickerOption {
        final String label;
        final String value;

        PickerOption(String label, String value) {
            this.label = label;
            this.value = value;
        }
    }
}
