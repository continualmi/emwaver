/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.scripts;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.google.gson.Gson;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public final class SimulatorScriptDeviceBridge implements ScriptDeviceBridge {
    private static final int STATUS_OK = 0x80;
    private static final int STATUS_ERROR = 0x81;

    private final SimulatorFixture fixture;
    private final Set<Integer> pins = new HashSet<>();
    private final Set<Integer> pwmPins = new HashSet<>();
    private final Map<Integer, Integer> gpioLevels = new HashMap<>();
    private final Map<Integer, String> gpioModes = new HashMap<>();
    private byte[] buffer = new byte[0];

    private SimulatorScriptDeviceBridge(@NonNull SimulatorFixture fixture) {
        this.fixture = fixture;
        if (fixture.gpio != null && fixture.gpio.pins != null) {
            for (GpioPin pin : fixture.gpio.pins) {
                pins.add(pin.number & 0xff);
                gpioLevels.put(pin.number & 0xff, Math.min(Math.max(pin.initialLevel, 0), 1));
                gpioModes.put(pin.number & 0xff, "input");
            }
        }
        if (fixture.pwm != null && fixture.pwm.pins != null) {
            for (Integer pin : fixture.pwm.pins) {
                if (pin != null) {
                    pwmPins.add(pin & 0xff);
                }
            }
        }
    }

    @NonNull
    public static SimulatorScriptDeviceBridge fromFixtureJson(@NonNull String source) {
        SimulatorFixture fixture = new Gson().fromJson(source, SimulatorFixture.class);
        if (fixture == null || fixture.board == null || fixture.board.type == null || fixture.board.type.trim().isEmpty()) {
            throw new IllegalArgumentException("Invalid EMWaver simulator fixture.");
        }
        return new SimulatorScriptDeviceBridge(fixture);
    }

    @Override
    public boolean isConnected() {
        return true;
    }

    @Nullable
    @Override
    public synchronized byte[] sendPacket(byte[] data, int timeoutMs) {
        try {
            return handle(data != null ? data : new byte[0]);
        } catch (Exception ex) {
            return new byte[]{(byte) STATUS_ERROR};
        }
    }

    @Override
    public synchronized void transmitBuffer() {
    }

    @Override
    public synchronized void clearBuffer() {
        buffer = new byte[0];
    }

    @Override
    public synchronized int getBufferLength() {
        return buffer.length;
    }

    @Nullable
    @Override
    public synchronized byte[] getBuffer() {
        return Arrays.copyOf(buffer, buffer.length);
    }

    @Override
    public synchronized void loadBuffer(byte[] data) {
        buffer = data != null ? Arrays.copyOf(data, data.length) : new byte[0];
    }

    private byte[] handle(byte[] command) {
        if (command.length == 0) {
            throw new IllegalArgumentException("simulator_empty_command");
        }

        int opcode = u8(command[0]);
        switch (opcode) {
            case 0x01:
                return new byte[]{
                        (byte) STATUS_OK,
                        (byte) safeFirmwareVersion().major,
                        (byte) safeFirmwareVersion().minor,
                        (byte) safeFirmwareVersion().patch
                };
            case 0x02:
                return ok();
            case 0x04:
                return okText(fixture.board.name);
            case 0x09:
                return okText(fixture.board.type);
            case 0x10:
                return handleGpio(command);
            case 0x20:
                return handleAdc(command);
            case 0x30:
                return handleUart(command);
            case 0x40:
                return handleI2c(command);
            case 0x50:
                return handleSpi(command);
            case 0x70:
                return handlePwm(command);
            default:
                throw new IllegalArgumentException("simulator_unsupported_opcode");
        }
    }

    private byte[] handleGpio(byte[] command) {
        int subcommand = byteAt(command, 1, "gpio subcommand missing");
        int pin = byteAt(command, 2, "gpio pin missing");
        requirePin(pin);

        switch (subcommand) {
            case 0x00:
                gpioModes.put(pin, "input");
                return ok();
            case 0x01:
                gpioModes.put(pin, "output");
                return ok();
            case 0x02:
                return new byte[]{(byte) STATUS_OK, (byte) intValue(gpioLevels.get(pin), 0)};
            case 0x03:
                gpioLevels.put(pin, 1);
                return ok();
            case 0x04:
                gpioLevels.put(pin, 0);
                return ok();
            case 0x05:
            case 0x06:
                return ok();
            default:
                throw new IllegalArgumentException("simulator_unsupported_gpio_subcommand");
        }
    }

    private byte[] handleAdc(byte[] command) {
        int source = byteAt(command, 1, "adc source missing");
        int pin = command.length > 2 ? u8(command[2]) : 0;
        int value;
        switch (source) {
            case 0x00:
                requirePin(pin);
                value = intMapValue(safeAdc().pinValues, String.valueOf(pin), 0);
                break;
            case 0x01:
                value = intMapValue(safeAdc().internalSources, "temp", 0);
                break;
            case 0x02:
                value = intMapValue(safeAdc().internalSources, "vrefint", 0);
                break;
            case 0x03:
                value = intMapValue(safeAdc().internalSources, "vbat", 0);
                break;
            default:
                throw new IllegalArgumentException("simulator_unsupported_adc_source");
        }
        return new byte[]{(byte) STATUS_OK, (byte) (value & 0xff), (byte) ((value >> 8) & 0xff)};
    }

    private byte[] handleUart(byte[] command) {
        int subcommand = byteAt(command, 1, "uart subcommand missing");
        switch (subcommand) {
            case 0x00:
            case 0x01:
                return ok();
            case 0x02:
                return new byte[]{(byte) STATUS_OK, (byte) (command.length > 8 ? u8(command[8]) : 0)};
            case 0x03:
                int length = Math.min(command.length > 8 ? u8(command[8]) : 0, 63);
                byte[] readBytes = intListToBytes(safeSerial().readBytes);
                byte[] payload = Arrays.copyOf(readBytes, Math.min(length, readBytes.length));
                return concat(new byte[]{(byte) STATUS_OK, (byte) payload.length}, payload);
            default:
                throw new IllegalArgumentException("simulator_unsupported_uart_subcommand");
        }
    }

    private byte[] handleI2c(byte[] command) {
        int subcommand = byteAt(command, 1, "i2c subcommand missing");
        switch (subcommand) {
            case 0x00:
            case 0x01:
            case 0x02:
                return ok();
            case 0x03:
            case 0x04:
                int address = command.length > 8 ? (u8(command[8]) & 0x7f) : 0;
                int lengthIndex = subcommand == 0x03 ? 9 : 10;
                int length = Math.min(command.length > lengthIndex ? u8(command[lengthIndex]) : 0, 63);
                I2cAddress addressFixture = safeI2c().addresses != null
                        ? safeI2c().addresses.get(String.valueOf(address))
                        : null;
                byte[] configured = addressFixture != null ? intListToBytes(addressFixture.readBytes) : new byte[0];
                return concat(new byte[]{(byte) STATUS_OK}, repeatedReply(configured, safeI2c().defaultReadByte, length));
            default:
                throw new IllegalArgumentException("simulator_unsupported_i2c_subcommand");
        }
    }

    private byte[] handleSpi(byte[] command) {
        int rxLength = Math.min(command.length > 2 ? u8(command[2]) : 0, 62);
        int txLength = Math.min(command.length > 3 ? u8(command[3]) : 0, Math.max(0, command.length - 4));
        byte[] tx = txLength > 0 ? Arrays.copyOfRange(command, 4, 4 + txLength) : new byte[0];
        int wanted = rxLength > 0 ? rxLength : txLength;
        byte[] configured = safeSpi().transfers != null
                ? intListToBytes(safeSpi().transfers.get(hexKey(tx)))
                : new byte[0];

        if (configured.length == 0 && rxLength == 0) {
            return concat(new byte[]{(byte) STATUS_OK}, tx);
        }
        return concat(new byte[]{(byte) STATUS_OK}, repeatedReply(configured, safeSpi().defaultReadByte, wanted));
    }

    private byte[] handlePwm(byte[] command) {
        int subcommand = byteAt(command, 1, "pwm subcommand missing");
        int pin = byteAt(command, 2, "pwm pin missing");
        requirePin(pin);
        if (!pwmPins.contains(pin)) {
            throw new IllegalArgumentException("simulator_pin_does_not_support_pwm");
        }
        switch (subcommand) {
            case 0x00:
            case 0x01:
            case 0x02:
                return ok();
            default:
                throw new IllegalArgumentException("simulator_unsupported_pwm_subcommand");
        }
    }

    private void requirePin(int pin) {
        if (!pins.contains(pin)) {
            throw new IllegalArgumentException("simulator_unknown_pin");
        }
    }

    private int byteAt(byte[] command, int index, String message) {
        if (command.length <= index) {
            throw new IllegalArgumentException(message);
        }
        return u8(command[index]);
    }

    private byte[] ok() {
        return new byte[]{(byte) STATUS_OK};
    }

    private byte[] okText(String text) {
        return concat(ok(), (text != null ? text : "").getBytes(StandardCharsets.UTF_8));
    }

    private byte[] repeatedReply(byte[] configured, int fill, int count) {
        byte[] out = new byte[Math.max(0, count)];
        for (int i = 0; i < out.length; i += 1) {
            out[i] = i < configured.length ? configured[i] : (byte) (fill & 0xff);
        }
        return out;
    }

    private String hexKey(byte[] bytes) {
        StringBuilder builder = new StringBuilder();
        for (byte b : bytes) {
            builder.append(String.format(Locale.US, "%02X", u8(b)));
        }
        return builder.toString();
    }

    private byte[] intListToBytes(@Nullable List<Integer> values) {
        if (values == null || values.isEmpty()) {
            return new byte[0];
        }
        byte[] out = new byte[values.size()];
        for (int i = 0; i < values.size(); i += 1) {
            out[i] = (byte) intValue(values.get(i), 0);
        }
        return out;
    }

    private byte[] concat(byte[] a, byte[] b) {
        byte[] out = Arrays.copyOf(a, a.length + b.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    private int u8(byte value) {
        return value & 0xff;
    }

    private int intValue(@Nullable Integer value, int fallback) {
        return value != null ? value : fallback;
    }

    private int intMapValue(@Nullable Map<String, Integer> map, String key, int fallback) {
        if (map == null) {
            return fallback;
        }
        Integer value = map.get(key);
        return value != null ? value : fallback;
    }

    private FirmwareVersion safeFirmwareVersion() {
        if (fixture.board.firmwareVersion == null) {
            fixture.board.firmwareVersion = new FirmwareVersion();
        }
        return fixture.board.firmwareVersion;
    }

    private AdcFixture safeAdc() {
        if (fixture.adc == null) {
            fixture.adc = new AdcFixture();
        }
        return fixture.adc;
    }

    private SerialFixture safeSerial() {
        if (fixture.serial == null) {
            fixture.serial = new SerialFixture();
        }
        return fixture.serial;
    }

    private I2cFixture safeI2c() {
        if (fixture.i2c == null) {
            fixture.i2c = new I2cFixture();
        }
        return fixture.i2c;
    }

    private SpiFixture safeSpi() {
        if (fixture.spi == null) {
            fixture.spi = new SpiFixture();
        }
        return fixture.spi;
    }

    private static final class SimulatorFixture {
        BoardFixture board;
        GpioFixture gpio;
        AdcFixture adc;
        PwmFixture pwm;
        SerialFixture serial;
        I2cFixture i2c;
        SpiFixture spi;
    }

    private static final class BoardFixture {
        String type;
        String name;
        FirmwareVersion firmwareVersion;
        String hardwareUid;
        int protocolVersion;
    }

    private static final class FirmwareVersion {
        int major;
        int minor;
        int patch;
    }

    private static final class GpioFixture {
        List<GpioPin> pins = new ArrayList<>();
    }

    private static final class GpioPin {
        int number;
        String name;
        List<String> modes = new ArrayList<>();
        int initialLevel;
    }

    private static final class AdcFixture {
        Map<String, Integer> pinValues = new HashMap<>();
        Map<String, Integer> internalSources = new HashMap<>();
    }

    private static final class PwmFixture {
        int defaultFrequencyHz;
        List<Integer> pins = new ArrayList<>();
    }

    private static final class SerialFixture {
        List<Integer> readBytes = new ArrayList<>();
    }

    private static final class I2cFixture {
        int defaultReadByte;
        Map<String, I2cAddress> addresses = new HashMap<>();
    }

    private static final class I2cAddress {
        List<Integer> readBytes = new ArrayList<>();
    }

    private static final class SpiFixture {
        int defaultReadByte;
        Map<String, List<Integer>> transfers = new HashMap<>();
    }
}
