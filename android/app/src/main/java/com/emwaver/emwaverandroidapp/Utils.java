/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Log;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import androidx.appcompat.app.ActionBar;
import androidx.appcompat.app.AppCompatActivity;
import androidx.fragment.app.Fragment;
import androidx.preference.PreferenceManager;

import java.util.ArrayList;
import java.util.Arrays;

public class Utils {

    private Context context;
    private Handler mainHandler;

    public Utils() {
        // Initialize mainHandler with the main looper
        this.mainHandler = new Handler(Looper.getMainLooper());
    }

    public void setContext(Context context) {
        this.context = context;
    }

    public static byte[] convertTimingsToBinary(float[] timings) {
        ArrayList<Byte> binaryDataList = new ArrayList<>();
        int currentByte = 0;
        int bitPosition = 0;

        // Alternate starting with high (1) for the first timing
        boolean state = true;

        for (float timing : timings) {
            int length = (int) Math.round(timing / 10); // Convert from 1us to 10us intervals

            for (int i = 0; i < length; i++) {
                if (state) {
                    currentByte |= (1 << (bitPosition % 8)); // Set bits from LSB to MSB
                }
                bitPosition++;
                if (bitPosition % 8 == 0) {
                    binaryDataList.add((byte) currentByte);
                    currentByte = 0;
                }
            }
            state = !state; // Toggle state for each timing
        }

        // Add the last byte if it's not empty
        if (bitPosition % 8 != 0) {
            binaryDataList.add((byte) currentByte);
        }

        byte[] binaryData = new byte[binaryDataList.size()];
        for (int i = 0; i < binaryData.length; i++) {
            binaryData[i] = binaryDataList.get(i);
        }

        return binaryData;
    }

    private String bytesToHex(byte[] bytes) {
        StringBuilder hexString = new StringBuilder();
        for (byte b : bytes) {
            String hex = Integer.toHexString(0xFF & b);
            if (hex.length() == 1) {
                hexString.append('0');
            }
            hexString.append(hex);
        }
        return hexString.toString();
    }

    public void delay(int delay_ms) {
        try {
            Thread.sleep(delay_ms);
        } catch (InterruptedException e) {
            throw new RuntimeException(e);
        }
    }

    public static byte[] getSignedBytes(int[] unsignedBytes) {
        byte[] signedBytes = new byte[unsignedBytes.length];
        for (int i = 0; i < unsignedBytes.length; i++) {
            signedBytes[i] = (byte) (unsignedBytes[i] & 0xFF);
        }
        return signedBytes;
    }

    public static String bytesToHexString(byte[] bytes) { //todo: verify change to static does not break anything
        StringBuilder hexString = new StringBuilder();
        for (byte b : bytes) {
            String hex = Integer.toHexString(0xFF & b);
            if (hex.length() == 1) {
                hexString.append('0');
            }
            hexString.append(hex);
        }
        return hexString.toString();
    }
    public static byte[] convertHexStringToByteArray(String hexString) {
        // Remove any non-hex characters (like spaces) if present
        hexString = hexString.replaceAll("[^0-9A-Fa-f]", "");
        Log.i("Hex Conversion", hexString);

        // Check if the string has an even number of characters
        if (hexString.length() % 2 != 0) {
            Log.e("Hex Conversion", "Invalid hex string");
            return null; // Return null or throw an exception as appropriate
        }

        byte[] bytes = new byte[hexString.length() / 2];

        StringBuilder hex_string = new StringBuilder();

        for (int i = 0; i < bytes.length; i++) {
            int index = i * 2;
            int value = Integer.parseInt(hexString.substring(index, index + 2), 16);
            bytes[i] = (byte) value;
            hex_string.append(String.format("%02X ", bytes[i]));
        }

        Log.i("Payload bytes", hex_string.toString());

        return bytes;
    }

    public static String toHexStringWithHexPrefix(byte[] array) {
        if (array == null) {
            return "[null]";
        }
        
        if (array.length == 0) {
            return "[]";
        }
        
        StringBuilder hexString = new StringBuilder("[");
        for (int i = 0; i < array.length; i++) {
            // Convert the byte to a hex string with a leading zero, then take the last two characters
            // (in case of negative bytes, which result in longer hex strings)
            String hex = "0x" + Integer.toHexString(array[i] & 0xFF).toUpperCase();

            hexString.append(hex);

            // Append comma and space if this is not the last byte
            if (i < array.length - 1) {
                hexString.append(", ");
            }
        }
        hexString.append("]");
        return hexString.toString();
    }

    public void showToast(final String message) {
        if (context == null) {
            throw new IllegalStateException("Context is not set. Call setContext() before using showToast().");
        }
        mainHandler.post(() -> Toast.makeText(context, message, Toast.LENGTH_SHORT).show());
    }

    public static void updateActionBarStatus(Fragment fragment, String status) {
        updateActionBarStatus(fragment, status, false);
    }

    public static void updateActionBarStatus(Fragment fragment, String status, boolean hasUnsavedChanges) {
        if (fragment.getActivity() instanceof AppCompatActivity) {
            AppCompatActivity activity = (AppCompatActivity) fragment.getActivity();
            ActionBar actionBar = activity.getSupportActionBar();
            if (actionBar != null) {
                String subtitle = hasUnsavedChanges ? status + " *" : status;
                actionBar.setSubtitle(subtitle);
            }
        }
    }

    public void logTimings(float[] timings) {
        if (timings == null) {
            Log.e("Utils", "Timings array is null");
            return;
        }

        StringBuilder sb = new StringBuilder("IR Timings: [");
        for (int i = 0; i < timings.length; i++) {
            sb.append(String.format("%.2f", timings[i]));
            if (i < timings.length - 1) {
                sb.append(", ");
            }
            // Break the line every 10 elements for readability
            if ((i + 1) % 10 == 0) {
                sb.append("\n");
            }
        }
        sb.append("]");

        Log.d("Utils", sb.toString());
    }

    /**
     * Converts an array of unsigned integers (0-255) to signed bytes (-128 to 127)
     * @param unsignedValues Array of integers representing unsigned bytes
     * @return Array of signed bytes
     */
    public static byte[] toSignedBytes(int[] unsignedValues) {
        byte[] signedBytes = new byte[unsignedValues.length];
        for (int i = 0; i < unsignedValues.length; i++) {
            signedBytes[i] = (byte)(unsignedValues[i] & 0xFF);
        }
        return signedBytes;
    }

    /**
     * Converts a single unsigned integer (0-255) to a signed byte (-128 to 127)
     * @param unsignedValue Integer representing unsigned byte
     * @return Signed byte
     */
    public static byte toSignedByte(int unsignedValue) {
        return (byte)(unsignedValue & 0xFF);
    }

    private static final String TAG = "EMWaver";

    public void log(String message) {
        Log.d(TAG, message);
    }

    public void log(String tag, String message) {
        Log.d(tag, message);
    }

    public void logError(String message) {
        Log.e(TAG, message);
    }

    public void logError(String tag, String message) {
        Log.e(tag, message);
    }

    public void logArray(String message, float[] array) {
        if (array == null) {
            Log.d(TAG, message + ": null");
            return;
        }
        StringBuilder sb = new StringBuilder(message).append(": [");
        for (int i = 0; i < array.length; i++) {
            sb.append(String.format("%.2f", array[i]));
            if (i < array.length - 1) {
                sb.append(", ");
            }
            // Break the line every 10 elements for readability
            if ((i + 1) % 10 == 0) {
                sb.append("\n");
            }
        }
        sb.append("]");
        Log.d(TAG, sb.toString());
    }

    /**
     * Converts a buffer to a 38kHz IR carrier pattern (10us resolution).
     * @param buffer The input buffer (raw signal)
     * @return The IR-modulated buffer
     */
    public static byte[] convertToIRBuffer(byte[] buffer) {
        if (buffer == null || buffer.length == 0) {
            return buffer;
        }
        byte[] irBuffer = new byte[buffer.length];
        boolean[] carrierPattern = new boolean[100];
        for (int i = 0; i < 100; i++) {
            double cyclePosition = (i * 38.0) / 100.0;
            double fractionalPart = cyclePosition - Math.floor(cyclePosition);
            carrierPattern[i] = fractionalPart < 0.5;
        }
        int patternIndex = 0;
        for (int i = 0; i < buffer.length; i++) {
            byte currentByte = buffer[i];
            byte newByte = 0;
            for (int bit = 0; bit < 8; bit++) {
                boolean isHigh = ((currentByte >> bit) & 1) != 0;
                if (isHigh) {
                    if (carrierPattern[patternIndex]) {
                        newByte |= (1 << bit);
                    }
                    patternIndex = (patternIndex + 1) % 100;
                }
            }
            irBuffer[i] = newByte;
        }
        return irBuffer;
    }

}
