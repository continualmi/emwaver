/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.ui.hosts;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.cloud.CloudAuthManager;
import com.emwaver.emwaverandroidapp.cloud.CloudConfig;
import com.emwaver.emwaverandroidapp.cloud.CloudHostsApi;
import com.emwaver.emwaverandroidapp.cloud.HostSession;
import com.emwaver.emwaverandroidapp.ui.auth.SignInBottomSheetDialogFragment;
import com.emwaver.emwaverandroidapp.ui.hosts.RemoteHostControlActivity;
import com.google.android.material.bottomsheet.BottomSheetDialogFragment;

import java.util.ArrayList;
import java.util.List;

import okhttp3.OkHttpClient;

public final class HostsBottomSheetDialogFragment extends BottomSheetDialogFragment {

    private ProgressBar progress;
    private TextView status;
    private RecyclerView list;
    private HostsAdapter adapter;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View v = inflater.inflate(R.layout.fragment_hosts_sheet, container, false);
        progress = v.findViewById(R.id.hosts_progress);
        status = v.findViewById(R.id.hosts_status);
        list = v.findViewById(R.id.hosts_list);

        adapter = new HostsAdapter();
        list.setLayoutManager(new LinearLayoutManager(requireContext()));
        list.setAdapter(adapter);

        v.findViewById(R.id.hosts_refresh).setOnClickListener(btn -> refresh());

        refresh();
        return v;
    }

    private void refresh() {
        if (!isAdded()) return;

        CloudAuthManager auth = CloudAuthManager.getInstance();
        auth.ensureInitialized(requireContext());

        if (!auth.isSignedIn()) {
            status.setText("Please sign in to view hosts.");
            SignInBottomSheetDialogFragment dialog = new SignInBottomSheetDialogFragment();
            dialog.show(getParentFragmentManager(), "SignIn");
            return;
        }

        String baseUrl = CloudConfig.getBackendBaseUrl(requireContext());
        if (baseUrl == null || baseUrl.trim().isEmpty()) {
            status.setText("Backend URL not configured");
            return;
        }

        progress.setVisibility(View.VISIBLE);
        status.setText("Loading…");

        new Thread(() -> {
            try {
                // IMPORTANT: token fetch can require network / binder work. Do it off the UI thread.
                String accessToken = auth.getIdTokenBlocking();
                if (accessToken == null || accessToken.trim().isEmpty()) {
                    requireActivity().runOnUiThread(() -> {
                        progress.setVisibility(View.GONE);
                        status.setText("Agent key is saved, but host sessions are not available.");
                        adapter.setHosts(new ArrayList<>());
                    });
                    return;
                }

                OkHttpClient http = new OkHttpClient.Builder().build();
                CloudHostsApi api = new CloudHostsApi(http);
                final List<HostSession> hostsRaw = api.listHosts(baseUrl, accessToken);
                final List<HostSession> hosts = (hostsRaw != null) ? hostsRaw : new ArrayList<>();

                requireActivity().runOnUiThread(() -> {
                    progress.setVisibility(View.GONE);
                    adapter.setHosts(hosts);
                    status.setText(hosts.isEmpty() ? "No host sessions detected" : "");
                });
            } catch (Exception e) {
                String msg = e.getMessage();
                requireActivity().runOnUiThread(() -> {
                    progress.setVisibility(View.GONE);
                    status.setText(msg != null ? msg : "Failed to load hosts");
                    adapter.setHosts(new ArrayList<>());
                });
            }
        }).start();
    }

    private static final class HostsAdapter extends RecyclerView.Adapter<HostsAdapter.VH> {
        private final List<HostSession> hosts = new ArrayList<>();

        void setHosts(@NonNull List<HostSession> updated) {
            hosts.clear();
            hosts.addAll(updated);
            notifyDataSetChanged();
        }

        @NonNull
        @Override
        public VH onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_host_row, parent, false);
            return new VH(v);
        }

        @Override
        public void onBindViewHolder(@NonNull VH h, int position) {
            HostSession s = hosts.get(position);

            h.itemView.setOnClickListener(v -> {
                try {
                    if (!(v.getContext() instanceof android.app.Activity)) return;
                    android.app.Activity a = (android.app.Activity) v.getContext();
                    RemoteHostControlActivity.start(a, s.id);
                } catch (Exception ignored) {}
            });
            h.title.setText(s.title());
            h.subtitle.setText(s.subtitle());
            h.dot.setBackgroundResource(s.online ? R.drawable.host_dot_green : R.drawable.host_dot_gray);

            String usb = s.usbConnected ? "USB" : "No USB";
            String port = s.connectedPort != null && !s.connectedPort.trim().isEmpty() ? (" · " + s.connectedPort.trim()) : "";
            h.usb.setText(usb + port);

            if (s.scriptRunning) {
                String name = s.activeScriptName != null ? s.activeScriptName.trim() : "";
                h.script.setVisibility(View.VISIBLE);
                h.script.setText(name.isEmpty() ? "Script running" : ("Running: " + name));
            } else {
                h.script.setVisibility(View.GONE);
            }
        }

        @Override
        public int getItemCount() {
            return hosts.size();
        }

        static final class VH extends RecyclerView.ViewHolder {
            final View dot;
            final TextView title;
            final TextView subtitle;
            final TextView usb;
            final TextView script;

            VH(@NonNull View itemView) {
                super(itemView);
                dot = itemView.findViewById(R.id.host_dot);
                title = itemView.findViewById(R.id.host_title);
                subtitle = itemView.findViewById(R.id.host_subtitle);
                usb = itemView.findViewById(R.id.host_usb);
                script = itemView.findViewById(R.id.host_script);
            }
        }
    }
}
