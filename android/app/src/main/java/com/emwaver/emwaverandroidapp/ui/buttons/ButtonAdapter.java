package com.emwaver.emwaverandroidapp.ui.buttons;

import android.graphics.Color;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.emwaver.emwaverandroidapp.R;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class ButtonAdapter extends RecyclerView.Adapter<ButtonAdapter.ButtonViewHolder> {

    private JSONArray buttons;
    private OnButtonClickListener clickListener;
    private OnButtonLongClickListener longClickListener;

    public ButtonAdapter(JSONArray buttons) {
        this.buttons = buttons;
    }

    public interface OnButtonClickListener {
        void onButtonClick(int position, String script);
    }

    public interface OnButtonLongClickListener {
        boolean onButtonLongClick(int position, JSONObject buttonObject);
    }

    public void setOnButtonClickListener(OnButtonClickListener listener) {
        this.clickListener = listener;
    }

    public void setOnButtonLongClickListener(OnButtonLongClickListener listener) {
        this.longClickListener = listener;
    }

    @NonNull
    @Override
    public ButtonViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_remote_button, parent, false);
        return new ButtonViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ButtonViewHolder holder, int position) {
        JSONObject buttonObject = buttons.optJSONObject(position);
        if (buttonObject != null) {
            try {
                String name = buttonObject.getString("name");
                String color = buttonObject.getString("color");
                final String script = buttonObject.getString("script");

                holder.button.setText(name);
                
                // Set button color based on the new color scheme
                if (color.equals("red")) {
                    holder.button.setBackgroundColor(Color.RED);
                } else if (color.equals("green")) {
                    holder.button.setBackgroundColor(Color.GREEN);
                }

                holder.button.setOnClickListener(v -> {
                    if (clickListener != null) {
                        clickListener.onButtonClick(position, script);
                    }
                });

                holder.button.setOnLongClickListener(v -> {
                    if (longClickListener != null) {
                        return longClickListener.onButtonLongClick(position, buttonObject);
                    }
                    return false;
                });

            } catch (JSONException e) {
                e.printStackTrace();
            }
        }
    }

    @Override
    public int getItemCount() {
        return buttons.length();
    }

    public void updateButtons(JSONArray newButtons) {
        this.buttons = newButtons;
        notifyDataSetChanged();
    }

    static class ButtonViewHolder extends RecyclerView.ViewHolder {
        Button button;

        ButtonViewHolder(View itemView) {
            super(itemView);
            this.button = itemView.findViewById(R.id.remote_button);
        }
    }
}