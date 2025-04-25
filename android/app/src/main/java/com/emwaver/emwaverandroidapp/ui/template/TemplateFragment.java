package com.emwaver.emwaverandroidapp.ui.template;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.view.MenuHost;
import androidx.core.view.MenuProvider;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.Lifecycle;

import com.emwaver.emwaverandroidapp.R;

/**
 * Template Fragment for creating custom UI for new hardware devices.
 * This is a minimal implementation that can be used as a starting point.
 */
public class TemplateFragment extends Fragment {
    private Button testButton;
    private TextView outputText;
    private int clickCount = 0;

    @Override
    public View onCreateView(@NonNull LayoutInflater inflater,
                           ViewGroup container, Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_template, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        // Initialize views
        testButton = view.findViewById(R.id.test_button);
        outputText = view.findViewById(R.id.output_text);

        // Set up click listener
        testButton.setOnClickListener(v -> {
            clickCount++;
            outputText.setText("Button clicked " + clickCount + " times");
        });

        // Set up the options menu
        setupMenu();
    }

    private void setupMenu() {
        MenuHost menuHost = requireActivity();
        menuHost.addMenuProvider(new MenuProvider() {
            @Override
            public void onCreateMenu(@NonNull Menu menu, @NonNull MenuInflater menuInflater) {
                menuInflater.inflate(R.menu.template_menu, menu);
            }

            @Override
            public boolean onMenuItemSelected(@NonNull MenuItem menuItem) {
                int itemId = menuItem.getItemId();
                if (itemId == R.id.action_refresh) {
                    clickCount = 0;
                    outputText.setText("Click counter reset");
                    return true;
                } else if (itemId == R.id.action_settings) {
                    outputText.setText("Settings clicked");
                    return true;
                } else if (itemId == R.id.action_help) {
                    outputText.setText("Help clicked");
                    return true;
                }
                return false;
            }
        }, getViewLifecycleOwner(), Lifecycle.State.RESUMED);
    }
} 