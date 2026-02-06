/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.ui.hosts;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;

import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.cloud.RemoteControlClientService;
import com.emwaver.emwaverandroidapp.scripts.ScriptEventType;
import com.emwaver.emwaverandroidapp.scripts.ScriptRenderView;
import com.emwaver.emwaverandroidapp.scripts.ScriptTree;

import java.util.List;

public final class RemoteHostControlActivity extends Activity {

    public static final String EXTRA_HOST_ID = "host_session_id";

    private String hostId;

    private TextView status;
    private TextView error;

    private EditText name;
    private EditText source;

    private FrameLayout uiHost;
    private ScriptRenderView renderView;

    private String scriptInstanceId;
    private int uiRev;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_remote_host_control);

        hostId = getIntent() != null ? getIntent().getStringExtra(EXTRA_HOST_ID) : null;
        if (hostId == null) hostId = "";

        status = findViewById(R.id.remote_status);
        error = findViewById(R.id.remote_error);
        name = findViewById(R.id.remote_name);
        source = findViewById(R.id.remote_source);
        uiHost = findViewById(R.id.remote_ui_host);

        source.setText("UI.render(UI.column({ children: [ UI.text({ text: 'Hello from Android controller' }), UI.button({ label: 'Tap', onTap: () => UI.render(UI.text({ text: 'Tapped' })) }) ] }))");

        Button connect = findViewById(R.id.remote_connect);
        Button run = findViewById(R.id.remote_run);

        ensureRenderView();

        connect.setOnClickListener(v -> connect());
        run.setOnClickListener(v -> run());

        connect();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        RemoteControlClientService.getInstance().setDelegate(null);
    }

    private void ensureRenderView() {
        if (renderView != null) return;
        renderView = new ScriptRenderView(this);
        renderView.setEventListener((token, arguments) -> {
            // Translate token -> nodeId/eventType using the client service helper.
            RemoteControlClientService.getInstance().invokeToken(scriptInstanceId, uiRev, token, arguments);
        });
        uiHost.removeAllViews();
        uiHost.addView(renderView);
    }

    private void connect() {
        error.setText("");
        if (TextUtils.isEmpty(hostId)) {
            error.setText("Missing host id");
            return;
        }

        RemoteControlClientService.getInstance().setDelegate(new RemoteControlClientService.Delegate() {
            @Override
            public void onStatus(String s) {
                runOnUiThread(() -> status.setText("WS: " + s));
            }

            @Override
            public void onAttached(String hostSessionId) {
                runOnUiThread(() -> status.setText("Attached"));
            }

            @Override
            public void onScriptStarted(String hostSessionId, String scriptId, @Nullable String scriptName) {
                scriptInstanceId = scriptId;
                uiRev = 0;
                runOnUiThread(() -> status.setText("Running: " + (scriptName != null ? scriptName : scriptId)));
            }

            @Override
            public void onUiSnapshot(String hostSessionId, String scriptId, int rev, @Nullable ScriptTree tree) {
                scriptInstanceId = scriptId;
                uiRev = rev;
                runOnUiThread(() -> {
                    ensureRenderView();
                    if (tree != null) {
                        renderView.render(tree);
                    } else {
                        renderView.clear();
                    }
                });
            }

            @Override
            public void onError(String message) {
                runOnUiThread(() -> error.setText(message));
            }
        });

        RemoteControlClientService.getInstance().connectAndAttach(this, hostId);
    }

    private void run() {
        error.setText("");
        String n = String.valueOf(name.getText() != null ? name.getText() : "remote.emw");
        String src = String.valueOf(source.getText() != null ? source.getText() : "");
        RemoteControlClientService.getInstance().runScript(n, src);
    }

    public static void start(Activity a, String hostSessionId) {
        Intent i = new Intent(a, RemoteHostControlActivity.class);
        i.putExtra(EXTRA_HOST_ID, hostSessionId);
        a.startActivity(i);
    }
}
