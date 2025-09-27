package com.emwaver.emwaverandroidapp.ui.buttons;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.IBinder;
import android.provider.OpenableColumns;
import android.text.InputType;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.view.MenuHost;
import androidx.core.view.MenuProvider;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.Lifecycle;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.BLEService;
import com.emwaver.emwaverandroidapp.Utils;
import com.emwaver.emwaverandroidapp.ir.IrEncoderWrapper;
import com.emwaver.emwaverandroidapp.ui.ism.CC1101;
import com.emwaver.emwaverandroidapp.wavelets.WaveletEngine;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.HashMap;
import java.util.Map;

public class ButtonsFragment extends Fragment {

    private List<String> remotes = new ArrayList<>();
    private ArrayAdapter<String> remotesAdapter;
    private ListView remotesListView;
    private RecyclerView buttonGrid;
    private ButtonAdapter buttonAdapter;
    private String currentRemote;
    private String tempExportContent;
    private ActivityResultLauncher<Intent> createFileLauncher = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(),
        result -> {
            if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                Uri uri = result.getData().getData();
                if (uri != null) {
                    saveJsonToUri(uri);
                }
            }
        }
    );

    private ActivityResultLauncher<Intent> openFileLauncher;
    private WaveletEngine waveletEngine;
    private BLEService bleService;
    private CC1101 cc1101;
    private boolean isServiceBound = false;
    private IrEncoderWrapper irEncoderWrapper;

    // Views for collapsible sections
    private TextView remotesListTitle;
    private androidx.cardview.widget.CardView remotesListCard;
    private TextView buttonGridTitle;
    private androidx.cardview.widget.CardView buttonGridCard;

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName className, IBinder service) {
            BLEService.LocalBinder binder = (BLEService.LocalBinder) service;
            bleService = binder.getService();
            cc1101 = new CC1101(bleService);
            isServiceBound = true;
            Log.i("ButtonsFragment", "BLE Service connected");
            initializeWaveletEngine();
        }

        @Override
        public void onServiceDisconnected(ComponentName arg0) {
            isServiceBound = false;
            Log.i("ButtonsFragment", "BLE Service disconnected");
        }
    };

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        createFileLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                    Uri uri = result.getData().getData();
                    if (uri != null) {
                        saveJsonToUri(uri);
                    }
                }
            }
        );

        openFileLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                    Uri uri = result.getData().getData();
                    if (uri != null) {
                        loadJsonFromUri(uri);
                    }
                }
            }
        );

        Utils utils = new Utils();
        irEncoderWrapper = new IrEncoderWrapper();
        waveletEngine = null;
    }

    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_buttons, container, false);

        remotesListView = view.findViewById(R.id.remotes_list_view);
        buttonGrid = view.findViewById(R.id.button_grid);

        // Initialize collapsible section views
        remotesListTitle = view.findViewById(R.id.remotes_list_title);
        remotesListCard = view.findViewById(R.id.remotes_list_card);
        buttonGridTitle = view.findViewById(R.id.button_grid_title);
        buttonGridCard = view.findViewById(R.id.button_grid_card);
        
        setupRemotesList();
        loadRemotes();
        setupButtonGrid();
        setupMenu();
        setupCollapsibleSections(); // Call a new method to setup collapsible behavior

        return view;
    }

    private void setupCollapsibleSections() {
        // Set initial visibility and arrows
        updateArrow(remotesListTitle, remotesListCard.getVisibility() == View.VISIBLE);
        updateArrow(buttonGridTitle, buttonGridCard.getVisibility() == View.VISIBLE);

        remotesListTitle.setOnClickListener(v -> {
            toggleVisibility(remotesListCard);
            updateArrow((TextView) v, remotesListCard.getVisibility() == View.VISIBLE);
        });

        buttonGridTitle.setOnClickListener(v -> {
            toggleVisibility(buttonGridCard);
            updateArrow((TextView) v, buttonGridCard.getVisibility() == View.VISIBLE);
        });
    }

    private void toggleVisibility(View view) {
        if (view.getVisibility() == View.VISIBLE) {
            view.setVisibility(View.GONE);
        } else {
            view.setVisibility(View.VISIBLE);
        }
    }

    private void updateArrow(TextView titleView, boolean isExpanded) {
        if (isExpanded) {
            titleView.setCompoundDrawablesWithIntrinsicBounds(0, 0, R.drawable.ic_arrow_up_black, 0);
        } else {
            titleView.setCompoundDrawablesWithIntrinsicBounds(0, 0, R.drawable.ic_arrow_down_black, 0);
        }
    }

    private void setupMenu() {
        MenuHost menuHost = requireActivity();
        menuHost.addMenuProvider(new MenuProvider() {
            @Override
            public void onCreateMenu(@NonNull Menu menu, @NonNull MenuInflater menuInflater) {
                menuInflater.inflate(R.menu.buttons_menu, menu);
            }

            @Override
            public boolean onMenuItemSelected(@NonNull MenuItem menuItem) {
                int itemId = menuItem.getItemId();
                if (itemId == R.id.action_add_remote) {
                    showAddRemoteDialog();
                    return true;
                } else if (itemId == R.id.action_add_key) {
                    showAddKeyDialog();
                    return true;
                } else if (itemId == R.id.action_load_from_irdb) {
                    showLoadFromIRDBDialog();
                    return true;
                } else if (itemId == R.id.action_load_from_storage) {
                    loadFromStorage();
                    return true;
                }
                return false;
            }
        }, getViewLifecycleOwner(), Lifecycle.State.RESUMED);
    }

    private void setupRemotesList() {
        if (remotesListView != null) {
            remotesAdapter = new ArrayAdapter<>(requireContext(), android.R.layout.simple_list_item_1, remotes);
            remotesListView.setAdapter(remotesAdapter);

            remotesListView.setOnItemClickListener((parent, view, position, id) -> {
                String fileName = remotes.get(position);
                loadButtonsForRemote(fileName);
            });

            remotesListView.setOnItemLongClickListener((parent, view, position, id) -> {
                String fileName = remotes.get(position);
                showRemoteOptionsDialog(fileName);
                return true;
            });
        } else {
            Log.e("ButtonsFragment", "Failed to setup remotes list: remotesListView is null");
        }
    }

    private void setupButtonGrid() {
        buttonAdapter = new ButtonAdapter(new JSONArray());
        buttonGrid.setLayoutManager(new GridLayoutManager(requireContext(), 3));
        buttonGrid.setAdapter(buttonAdapter);

        buttonAdapter.setOnButtonClickListener((position, script) -> {
            if (waveletEngine != null) {
                waveletEngine.execute(script, null);
            } else {
                Toast.makeText(requireContext(), "Wavelet engine not initialized", Toast.LENGTH_SHORT).show();
            }
        });

        buttonAdapter.setOnButtonLongClickListener((position, buttonObject) -> {
            showEditButtonDialog(position, buttonObject);
            return true;
        });
    }

    private void loadRemotes() {
        File directory = requireContext().getFilesDir();
        File[] files = directory.listFiles((dir, name) -> name.endsWith(".json"));

        remotes.clear();
        if (files != null) {
            for (File file : files) {
                remotes.add(file.getName());
            }
        }

        if (remotesAdapter != null) {
            remotesAdapter.notifyDataSetChanged();
        } else {
            Log.e("ButtonsFragment", "remotesAdapter is null in loadRemotes()");
        }
    }

    private void loadButtonsForRemote(String fileName) {
        try {
            File remoteFile = new File(requireContext().getFilesDir(), fileName);
            
            if (!remoteFile.exists()) {
                Toast.makeText(requireContext(), "Remote file not found: " + fileName, Toast.LENGTH_SHORT).show();
                return;
            }

            FileInputStream fis = new FileInputStream(remoteFile);
            byte[] data = new byte[(int) remoteFile.length()];
            fis.read(data);
            fis.close();
            String jsonContent = new String(data, StandardCharsets.UTF_8);

            JSONObject currentRemoteJson = new JSONObject(jsonContent);
            JSONArray buttons = currentRemoteJson.getJSONArray("buttons");
            buttonAdapter.updateButtons(buttons);
            currentRemote = fileName;
            updateButtonGridTitle("Remote: " + fileName);
        } catch (IOException | JSONException e) {
            Log.e("ButtonsFragment", "Error loading remote: " + fileName, e);
            Toast.makeText(requireContext(), "Error loading remote: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void showAddRemoteDialog() {
        AlertDialog.Builder builder = new AlertDialog.Builder(getContext());
        builder.setTitle("Add New Remote");

        final EditText input = new EditText(getContext());
        input.setHint("Remote Name");
        builder.setView(input);

        builder.setPositiveButton("OK", (dialog, which) -> {
            String remoteName = input.getText().toString();
            if (!remoteName.isEmpty()) {
                createNewRemote(remoteName);
            }
        });
        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.cancel());

        builder.show();
    }

    private void showAddKeyDialog() {
        if (currentRemote == null || currentRemote.isEmpty()) {
            Toast.makeText(getContext(), "Please select a remote first", Toast.LENGTH_SHORT).show();
            return;
        }

        AlertDialog.Builder builder = new AlertDialog.Builder(getContext());
        View dialogView = LayoutInflater.from(getContext()).inflate(R.layout.dialog_edit_button, null);

        EditText nameInput = dialogView.findViewById(R.id.buttonNameInput);
        CheckBox redColorCheckbox = dialogView.findViewById(R.id.redColorCheckbox);
        CheckBox greenColorCheckbox = dialogView.findViewById(R.id.greenColorCheckbox);
        EditText scriptInput = dialogView.findViewById(R.id.scriptInput);

        // Ensure only one color checkbox can be selected at a time
        redColorCheckbox.setOnCheckedChangeListener((buttonView, isChecked) -> {
            if (isChecked) {
                greenColorCheckbox.setChecked(false);
            }
        });
        greenColorCheckbox.setOnCheckedChangeListener((buttonView, isChecked) -> {
            if (isChecked) {
                redColorCheckbox.setChecked(false);
            }
        });

        builder.setView(dialogView);
        builder.setTitle("Add New Key");

        builder.setPositiveButton("OK", (dialog, which) -> {
            String name = nameInput.getText().toString();
            String color = redColorCheckbox.isChecked() ? "red" : (greenColorCheckbox.isChecked() ? "green" : "");
            String script = scriptInput.getText().toString();
            if (!name.isEmpty() && !color.isEmpty() && !script.isEmpty()) {
                addKeyToRemote(name, color, script);
            } else {
                Toast.makeText(getContext(), "Please fill all fields", Toast.LENGTH_SHORT).show();
            }
        });
        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.cancel());

        builder.show();
    }

    private void createNewRemote(String remoteName) {
        try {
            String fileName = remoteName.replaceAll("[^a-zA-Z0-9.-]", "_") + ".json";
            JSONObject remoteJson = new JSONObject();
            remoteJson.put("buttons", new JSONArray());

            File file = new File(getContext().getFilesDir(), fileName);
            FileWriter writer = new FileWriter(file);
            writer.write(remoteJson.toString());
            writer.flush();
            writer.close();

            Log.d("ButtonsFragment", "Created new remote file: " + fileName);
            Log.d("ButtonsFragment", "File path: " + file.getAbsolutePath());
            Log.d("ButtonsFragment", "File exists: " + file.exists());

            loadRemotes();
        } catch (JSONException | IOException e) {
            e.printStackTrace();
            Toast.makeText(getContext(), "Error creating remote: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void addKeyToRemote(String name, String color, String script) {
        try {
            File file = new File(getContext().getFilesDir(), currentRemote);
            FileInputStream fis = new FileInputStream(file);
            byte[] data = new byte[(int) file.length()];
            fis.read(data);
            fis.close();
            String json = new String(data, "UTF-8");

            JSONObject jsonObject = new JSONObject(json);
            JSONArray buttons = jsonObject.getJSONArray("buttons");

            JSONObject newButton = new JSONObject();
            newButton.put("name", name);
            newButton.put("color", color);
            newButton.put("script", script);
            buttons.put(newButton);

            String updatedJson = jsonObject.toString();
            FileOutputStream fos = getContext().openFileOutput(currentRemote, Context.MODE_PRIVATE);
            fos.write(updatedJson.getBytes());
            fos.close();

            loadButtonsForRemote(currentRemote);
            Toast.makeText(getContext(), "Key added successfully", Toast.LENGTH_SHORT).show();
        } catch (JSONException | IOException e) {
            e.printStackTrace();
            Toast.makeText(getContext(), "Error adding key: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void showRemoteOptionsDialog(String fileName) {
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        builder.setTitle("Remote Options: " + fileName)
               .setItems(new CharSequence[]{"View JSON", "Rename", "Delete"}, (dialog, which) -> {
                   switch (which) {
                       case 0:
                           showRemoteJson(fileName);
                           break;
                       case 1:
                           showRenameDialog(fileName);
                           break;
                       case 2:
                           deleteRemote(fileName);
                           break;
                   }
               });
        builder.show();
    }

    private void showRemoteJson(String fileName) {
        try {
            File file = new File(requireContext().getFilesDir(), fileName);
            FileInputStream fis = new FileInputStream(file);
            byte[] data = new byte[(int) file.length()];
            fis.read(data);
            fis.close();
            String jsonContent = new String(data, StandardCharsets.UTF_8);

            AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
            View dialogView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_edit_code, null);
            
            TextView titleView = dialogView.findViewById(R.id.dialogTitle);
            TextView codeViewer = dialogView.findViewById(R.id.codeEditor);

            titleView.setText("Remote JSON: " + fileName);
            codeViewer.setText(formatCode(jsonContent));

            // Make the EditText non-editable for viewing purposes
            codeViewer.setKeyListener(null);

            builder.setView(dialogView);
            builder.setPositiveButton("Close", (dialog, which) -> dialog.dismiss());
            builder.setNeutralButton("Export", (dialog, which) -> exportJsonToExternalStorage(fileName, jsonContent));

            AlertDialog dialog = builder.create();
            dialog.show();
        } catch (IOException e) {
            Log.e("ButtonsFragment", "Error reading JSON for remote: " + fileName, e);
            Toast.makeText(requireContext(), "Error reading remote JSON", Toast.LENGTH_SHORT).show();
        }
    }

    private void exportJsonToExternalStorage(String fileName, String jsonContent) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);

        createFileLauncher.launch(intent);

        // Store the content temporarily
        tempExportContent = jsonContent;
    }

    private void saveJsonToUri(Uri uri) {
        try {
            OutputStream outputStream = requireContext().getContentResolver().openOutputStream(uri);
            if (outputStream != null) {
                outputStream.write(tempExportContent.getBytes());
                outputStream.close();
                Toast.makeText(requireContext(), "JSON exported successfully", Toast.LENGTH_SHORT).show();
            }
        } catch (IOException e) {
            Log.e("ButtonsFragment", "Error exporting JSON", e);
            Toast.makeText(requireContext(), "Error exporting JSON: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        } finally {
            tempExportContent = null;
        }
    }

    private void showRenameDialog(String oldFileName) {
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        builder.setTitle("Rename Remote");

        final EditText input = new EditText(requireContext());
        input.setInputType(InputType.TYPE_CLASS_TEXT);
        input.setText(oldFileName.replace(".json", ""));
        builder.setView(input);

        builder.setPositiveButton("OK", (dialog, which) -> {
            String newName = input.getText().toString();
            if (!newName.isEmpty()) {
                renameRemote(oldFileName, newName);
            }
        });
        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.cancel());

        builder.show();
    }

    private void renameRemote(String oldFileName, String newName) {
        File oldFile = new File(requireContext().getFilesDir(), oldFileName);
        String newFileName = newName.endsWith(".json") ? newName : newName + ".json";
        File newFile = new File(requireContext().getFilesDir(), newFileName);

        if (oldFile.renameTo(newFile)) {
            Log.d("ButtonsFragment", "Successfully renamed remote from " + oldFileName + " to " + newFileName);
            loadRemotes();
        } else {
            Log.e("ButtonsFragment", "Failed to rename remote from " + oldFileName + " to " + newFileName);
            Toast.makeText(requireContext(), "Failed to rename remote", Toast.LENGTH_SHORT).show();
        }
    }

    private void deleteRemote(String fileName) {
        File file = new File(requireContext().getFilesDir(), fileName);
        if (file.delete()) {
            Log.d("ButtonsFragment", "Successfully deleted remote: " + fileName);
            
            // Clear the current remote and buttons
            currentRemote = null;
            if (buttonAdapter != null) {
                buttonAdapter.updateButtons(new JSONArray());
            }
            
            // Update UI to reflect no remote selected
            updateButtonGridTitle("No remote selected");
            
            // Refresh the list of remotes
            loadRemotes();
            
            Toast.makeText(requireContext(), "Remote deleted successfully", Toast.LENGTH_SHORT).show();
        } else {
            Log.e("ButtonsFragment", "Failed to delete remote: " + fileName);
            Toast.makeText(requireContext(), "Failed to delete remote", Toast.LENGTH_SHORT).show();
        }
    }

    private void showEditButtonDialog(int position, JSONObject buttonObject) {
        try {
            String name = buttonObject.getString("name");
            String color = buttonObject.getString("color");
            String script = buttonObject.getString("script");

            AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
            View dialogView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_edit_button_name_color, null);
            
            EditText nameInput = dialogView.findViewById(R.id.buttonNameInput);
            CheckBox redColorCheckbox = dialogView.findViewById(R.id.redColorCheckbox);
            CheckBox greenColorCheckbox = dialogView.findViewById(R.id.greenColorCheckbox);
            Button editScriptButton = dialogView.findViewById(R.id.editScriptButton);

            nameInput.setText(name);
            redColorCheckbox.setChecked(color.equals("red"));
            greenColorCheckbox.setChecked(color.equals("green"));

            // Ensure only one color checkbox can be selected at a time
            redColorCheckbox.setOnCheckedChangeListener((buttonView, isChecked) -> {
                if (isChecked) {
                    greenColorCheckbox.setChecked(false);
                }
            });
            greenColorCheckbox.setOnCheckedChangeListener((buttonView, isChecked) -> {
                if (isChecked) {
                    redColorCheckbox.setChecked(false);
                }
            });

            editScriptButton.setOnClickListener(v -> {
                showScriptEditDialog(position, script);
            });

            builder.setView(dialogView);
            builder.setTitle("Edit Button");
            builder.setPositiveButton("Save", (dialog, which) -> {
                String updatedName = nameInput.getText().toString();
                String updatedColor = redColorCheckbox.isChecked() ? "red" : (greenColorCheckbox.isChecked() ? "green" : "");
                if (!updatedName.isEmpty() && !updatedColor.isEmpty()) {
                    updateButtonNameAndColor(position, updatedName, updatedColor);
                } else {
                    Toast.makeText(requireContext(), "Please fill all fields", Toast.LENGTH_SHORT).show();
                }
            });
            builder.setNegativeButton("Cancel", (dialog, which) -> dialog.dismiss());

            AlertDialog dialog = builder.create();
            dialog.show();
        } catch (JSONException e) {
            e.printStackTrace();
            Toast.makeText(requireContext(), "Error reading button data", Toast.LENGTH_SHORT).show();
        }
    }

    private void updateButtonNameAndColor(int position, String updatedName, String updatedColor) {
        try {
            File file = new File(requireContext().getFilesDir(), currentRemote);
            FileInputStream fis = new FileInputStream(file);
            byte[] data = new byte[(int) file.length()];
            fis.read(data);
            fis.close();
            String json = new String(data, StandardCharsets.UTF_8);

            JSONObject jsonObject = new JSONObject(json);
            JSONArray buttons = jsonObject.getJSONArray("buttons");
            JSONObject buttonObject = buttons.getJSONObject(position);
            
            buttonObject.put("name", updatedName);
            buttonObject.put("color", updatedColor);

            FileOutputStream fos = requireContext().openFileOutput(currentRemote, Context.MODE_PRIVATE);
            fos.write(jsonObject.toString().getBytes());
            fos.close();

            Toast.makeText(requireContext(), "Button updated successfully", Toast.LENGTH_SHORT).show();
            
            // Refresh the button grid to reflect changes
            loadButtonsForRemote(currentRemote);
        } catch (JSONException | IOException e) {
            e.printStackTrace();
            Toast.makeText(requireContext(), "Error updating button", Toast.LENGTH_SHORT).show();
        }
    }

    private void updateButtonScript(int position, String updatedScript) {
        try {
            File file = new File(requireContext().getFilesDir(), currentRemote);
            FileInputStream fis = new FileInputStream(file);
            byte[] data = new byte[(int) file.length()];
            fis.read(data);
            fis.close();
            String json = new String(data, StandardCharsets.UTF_8);

            JSONObject jsonObject = new JSONObject(json);
            JSONArray buttons = jsonObject.getJSONArray("buttons");
            JSONObject buttonObject = buttons.getJSONObject(position);
            
            buttonObject.put("script", updatedScript);

            FileOutputStream fos = requireContext().openFileOutput(currentRemote, Context.MODE_PRIVATE);
            fos.write(jsonObject.toString().getBytes());
            fos.close();

            Toast.makeText(requireContext(), "Script updated successfully", Toast.LENGTH_SHORT).show();
            
            // Refresh the button grid to reflect changes
            loadButtonsForRemote(currentRemote);
        } catch (JSONException | IOException e) {
            e.printStackTrace();
            Toast.makeText(requireContext(), "Error updating script", Toast.LENGTH_SHORT).show();
        }
    }

    private void showLoadFromIRDBDialog() {
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        builder.setTitle("Load from IRDB");

        final EditText input = new EditText(requireContext());
        input.setInputType(InputType.TYPE_CLASS_TEXT);
        input.setHint("Enter IRDB link");
        builder.setView(input);

        builder.setPositiveButton("OK", (dialog, which) -> {
            String irdbLink = input.getText().toString();
            if (!irdbLink.isEmpty()) {
                loadRemoteFromIRDB(irdbLink);
            }
        });
        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.cancel());

        builder.show();
    }

    private void loadRemoteFromIRDB(String irdbLink) {
        new Thread(() -> {
            try {
                String cdnLink = convertToCDNLink(irdbLink);
                URL url = new URL(cdnLink);
                String remoteName = extractRemoteNameFromUrl(cdnLink);
                String fileName = remoteName.replaceAll("[^a-zA-Z0-9.-]", "_") + ".json";
                
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("GET");
                connection.connect();

                if (connection.getResponseCode() == HttpURLConnection.HTTP_OK) {
                    BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()));
                    StringBuilder csvContent = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        csvContent.append(line).append("\n");
                    }
                    reader.close();

                    JSONObject remoteJson = convertCsvToJson(csvContent.toString());
                    
                    File file = new File(requireContext().getFilesDir(), fileName);
                    FileWriter writer = new FileWriter(file);
                    writer.write(remoteJson.toString());
                    writer.flush();
                    writer.close();

                    // Update UI on the main thread
                    requireActivity().runOnUiThread(() -> {
                        loadRemotes();  // Refresh the list of remotes
                        Toast.makeText(requireContext(), "Remote loaded successfully: " + remoteName, Toast.LENGTH_SHORT).show();
                    });
                } else {
                    throw new Exception("Server responded with: " + connection.getResponseCode());
                }
                connection.disconnect();
            } catch (Exception e) {
                e.printStackTrace();
                requireActivity().runOnUiThread(() -> 
                    Toast.makeText(requireContext(), "Error loading remote: " + e.getMessage(), Toast.LENGTH_LONG).show()
                );
            }
        }).start();
    }

    private String convertToCDNLink(String link) {
        if (link.startsWith("https://github.com")) {
            // Convert GitHub link to CDN link
            link = link.replace("https://github.com", "https://cdn.jsdelivr.net/gh");
            link = link.replace("/blob/", "@");
            link = link.replace("%2C", ",");  // Replace URL-encoded comma with actual comma
        }
        return link;
    }

    private String extractRemoteNameFromUrl(String url) {
        String[] parts = url.split("/");
        if (parts.length >= 3) {
            // Combine the last three parts of the URL (brand, device type, and model)
            String brand = parts[parts.length - 3];
            String deviceType = parts[parts.length - 2];
            String model = parts[parts.length - 1].split("\\.")[0]; // Remove file extension
            return brand + "_" + deviceType + "_" + model;
        } else {
            // Fallback if the URL doesn't have enough parts
            return parts[parts.length - 1].split("\\.")[0];
        }
    }

    private JSONObject convertCsvToJson(String csvContent) throws JSONException {
        JSONObject remoteJson = new JSONObject();
        JSONArray buttonsArray = new JSONArray();

        String[] lines = csvContent.split("\n");
        for (int i = 1; i < lines.length; i++) { // Skip header row
            String[] tokens = lines[i].split(",");
            if (tokens.length >= 5) {
                JSONObject buttonJson = new JSONObject();
                buttonJson.put("name", tokens[0]);
                buttonJson.put("protocol", tokens[1]);
                buttonJson.put("device", Integer.parseInt(tokens[2]));
                buttonJson.put("subdevice", Integer.parseInt(tokens[3]));
                buttonJson.put("function", Integer.parseInt(tokens[4]));
                buttonJson.put("color", "#FFFFFF"); // Default color
                
                String script = createScriptForButton(tokens[1], Integer.parseInt(tokens[2]), 
                                                        Integer.parseInt(tokens[3]), Integer.parseInt(tokens[4]));
                buttonJson.put("script", script);

                buttonsArray.put(buttonJson);
            }
        }

        remoteJson.put("buttons", buttonsArray);
        return remoteJson;
    }

    private String createScriptForButton(String protocol, int device, int subdevice, int function) {
        // Clean, simplified script with proper ArrayList handling
        StringBuilder script = new StringBuilder();
        script.append("// Script for " + protocol + " IR signal\n");
        script.append("try {\n");
        script.append("    var timings = IrEncoder.encodeIR('").append(protocol).append("', ")
              .append(device).append(", ").append(subdevice).append(", ").append(function).append(");\n");
        
        script.append("    if (timings && timings.size() > 0) {\n");
        script.append("        var arraySize = timings.size();\n");
        script.append("        var floatArray = java.lang.reflect.Array.newInstance(java.lang.Float.TYPE, arraySize);\n");
        
        script.append("        for (var i = 0; i < arraySize; i++) {\n");
        script.append("            floatArray[i] = timings.get(i);\n");
        script.append("        }\n");
        
        script.append("        var signal = Utils.convertTimingsToBinary(floatArray);\n");
        script.append("        var irSignal = Utils.convertToIRBuffer(signal);\n");
        
        script.append("        if (irSignal && irSignal.length > 0) {\n");
        script.append("            BLEService.loadBuffer(irSignal);\n");
        script.append("            var commandBytes = [0x74, 0x72, 0x61, 0x6E, 0x73, 0x6D, 0x69, 0x74, 0x20, 0x04]; // \"transmit\" + type 4 (IR)\n");
        script.append("            BLEService.write(commandBytes);\n");
        script.append("            var status = BLEService.transmitBuffer();\n");
        script.append("            Utils.log('Successfully transmitted " + protocol + " IR signal');\n");
        script.append("        } else {\n");
        script.append("            print('Error: Failed to convert timings to IR buffer');\n");
        script.append("        }\n");
        script.append("    } else {\n");
        script.append("        print('Error: Failed to encode " + protocol + " signal');\n");
        script.append("    }\n");
        script.append("} catch (e) {\n");
        script.append("    print('Script Error: ' + e.message);\n");
        script.append("}\n");

        return script.toString();
    }

    private String formatCode(String code) {
        // Simple formatting for JSON and JavaScript
        if (code.trim().startsWith("{") || code.trim().startsWith("[")) {
            // It's likely JSON, use JSONObject for pretty printing
            try {
                JSONObject jsonObject = new JSONObject(code);
                return jsonObject.toString(2);
            } catch (Exception e) {
                // If parsing fails, return the original string
                return code;
            }
        } else {
            // For JavaScript, we'll just add some basic indentation
            // This is a very simple approach and might not work for all cases
            String[] lines = code.split("\n");
            StringBuilder formatted = new StringBuilder();
            int indentLevel = 0;
            for (String line : lines) {
                line = line.trim();
                if (line.endsWith("}") || line.endsWith("]")) {
                    indentLevel = Math.max(0, indentLevel - 1);
                }
                formatted.append("    ".repeat(indentLevel)).append(line).append("\n");
                if (line.endsWith("{") || line.endsWith("[")) {
                    indentLevel++;
                }
            }
            return formatted.toString();
        }
    }

    private void loadFromStorage() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        openFileLauncher.launch(intent);
    }

    private void loadJsonFromUri(Uri uri) {
        try {
            InputStream inputStream = requireContext().getContentResolver().openInputStream(uri);
            if (inputStream != null) {
                BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream));
                StringBuilder stringBuilder = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    stringBuilder.append(line).append("\n");
                }
                inputStream.close();

                String jsonContent = stringBuilder.toString();
                JSONObject remoteJson = new JSONObject(jsonContent);

                // Validate the JSON structure
                if (!remoteJson.has("buttons") || !(remoteJson.getJSONArray("buttons").length() > 0)) {
                    throw new JSONException("Invalid remote JSON structure");
                }

                // Get the original filename
                String fileName = getFileNameFromUri(uri);
                if (fileName == null || !fileName.endsWith(".json")) {
                    fileName = "remote_" + System.currentTimeMillis() + ".json";
                }

                // Save to internal storage
                FileOutputStream fos = requireContext().openFileOutput(fileName, Context.MODE_PRIVATE);
                fos.write(jsonContent.getBytes());
                fos.close();

                // Refresh the list of remotes
                loadRemotes();

                Toast.makeText(requireContext(), "Remote loaded successfully: " + fileName, Toast.LENGTH_SHORT).show();
            }
        } catch (IOException | JSONException e) {
            Log.e("ButtonsFragment", "Error loading JSON from storage", e);
            Toast.makeText(requireContext(), "Error loading remote: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private String getFileNameFromUri(Uri uri) {
        String result = null;
        if (uri.getScheme().equals("content")) {
            Cursor cursor = requireContext().getContentResolver().query(uri, null, null, null, null);
            try {
                if (cursor != null && cursor.moveToFirst()) {
                    int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (nameIndex >= 0) {
                        result = cursor.getString(nameIndex);
                    }
                }
            } finally {
                if (cursor != null) {
                    cursor.close();
                }
            }
        }
        if (result == null) {
            result = uri.getPath();
            int cut = result.lastIndexOf('/');
            if (cut != -1) {
                result = result.substring(cut + 1);
            }
        }
        return result;
    }

    private void showScriptEditDialog(int position, String script) {
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        View dialogView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_edit_code, null);
        
        TextView titleView = dialogView.findViewById(R.id.dialogTitle);
        TextView codeEditor = dialogView.findViewById(R.id.codeEditor);

        titleView.setText("Edit Script");
        codeEditor.setText(script);

        builder.setView(dialogView);
        builder.setPositiveButton("Save", (dialog, which) -> {
            String updatedScript = codeEditor.getText().toString();
            updateButtonScript(position, updatedScript);
        });
        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.dismiss());

        AlertDialog dialog = builder.create();
        dialog.show();
    }

    private void printToConsole(String message) {
        Log.d("ButtonsFragment", message);
        if (message != null && message.startsWith("Wavelet error") && isAdded()) {
            Toast.makeText(requireContext(), message, Toast.LENGTH_LONG).show();
        }
    }

    private void initializeWaveletEngine() {
        if (isServiceBound && bleService != null) {
            CC1101 cc1101 = new CC1101(bleService);
            Utils utils = new Utils();
            utils.setContext(requireContext());
            irEncoderWrapper = new IrEncoderWrapper();
            Map<String, Object> bindings = new HashMap<>();
            bindings.put("CC1101", cc1101);
            bindings.put("Utils", utils);
            bindings.put("BLEService", bleService);
            bindings.put("IrEncoder", irEncoderWrapper);

            if (waveletEngine != null) {
                waveletEngine.shutdown();
            }
            waveletEngine = new WaveletEngine();
            waveletEngine.setup(this::printToConsole, tree -> {}, bindings);
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        if (isServiceBound && getActivity() != null) {
            getActivity().unbindService(serviceConnection);
            isServiceBound = false;
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (waveletEngine != null) {
            waveletEngine.shutdown();
            waveletEngine = null;
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        if (!isServiceBound && getActivity() != null) {
            Intent intent = new Intent(getActivity(), BLEService.class);
            getActivity().bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // Reset action bar status when entering this fragment
        if (currentRemote != null) {
            updateButtonGridTitle("Remote: " + currentRemote);
        } else {
            updateButtonGridTitle("No remote selected");
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        // Clear action bar status when leaving this fragment
        // No need to clear title here, it will be reset in onResume of the next fragment or this one.
    }

    private void updateButtonGridTitle(String title) {
        if (getActivity() != null && buttonGridTitle != null) {
            getActivity().runOnUiThread(() -> buttonGridTitle.setText(title));
        }
    }

}
