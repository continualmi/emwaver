/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.agent;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.util.List;
import java.util.Map;

public abstract class AgentToolJSON {

    public static AgentToolJSON of(@Nullable String value) {
        return value == null ? new NullValue() : new StringValue(value);
    }

    public static AgentToolJSON of(double value) { return new NumberValue(value); }
    public static AgentToolJSON of(boolean value) { return new BoolValue(value); }

    public static AgentToolJSON of(@Nullable Map<String, AgentToolJSON> value) {
        return value == null ? new NullValue() : new ObjectValue(value);
    }

    public static AgentToolJSON ofArray(@Nullable List<AgentToolJSON> value) {
        return value == null ? new NullValue() : new ArrayValue(value);
    }

    public static final AgentToolJSON NULL = new NullValue();

    @Nullable public String asString() { return null; }
    @Nullable public Double asNumber() { return null; }
    @Nullable public Boolean asBool() { return null; }
    @Nullable public Map<String, AgentToolJSON> asObject() { return null; }
    @Nullable public List<AgentToolJSON> asArray() { return null; }
    public boolean isNull() { return false; }

    public static final class StringValue extends AgentToolJSON {
        @NonNull public final String value;
        public StringValue(@NonNull String value) { this.value = value; }
        @Override public String asString() { return value; }
        @Override public String toString() { return "\"" + value + "\""; }
        @Override public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof StringValue)) return false;
            return value.equals(((StringValue) o).value);
        }
        @Override public int hashCode() { return value.hashCode(); }
    }

    public static final class NumberValue extends AgentToolJSON {
        public final double value;
        public NumberValue(double value) { this.value = value; }
        @Override public Double asNumber() { return value; }
        @Override public String asString() { return String.valueOf(value); }
        @Override public String toString() {
            if (value == Math.floor(value) && Math.abs(value) < 1e15) return String.valueOf((long) value);
            return String.valueOf(value);
        }
        @Override public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof NumberValue)) return false;
            return Double.compare(((NumberValue) o).value, value) == 0;
        }
        @Override public int hashCode() { return Double.hashCode(value); }
    }

    public static final class BoolValue extends AgentToolJSON {
        public final boolean value;
        public BoolValue(boolean value) { this.value = value; }
        @Override public Boolean asBool() { return value; }
        @Override public String asString() { return value ? "true" : "false"; }
        @Override public String toString() { return value ? "true" : "false"; }
        @Override public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof BoolValue)) return false;
            return ((BoolValue) o).value == value;
        }
        @Override public int hashCode() { return Boolean.hashCode(value); }
    }

    public static final class ObjectValue extends AgentToolJSON {
        @NonNull public final Map<String, AgentToolJSON> value;
        public ObjectValue(@NonNull Map<String, AgentToolJSON> value) { this.value = value; }
        @Override public Map<String, AgentToolJSON> asObject() { return value; }
        @Override public String toString() { return value.toString(); }
        @Override public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof ObjectValue)) return false;
            return value.equals(((ObjectValue) o).value);
        }
        @Override public int hashCode() { return value.hashCode(); }
    }

    public static final class ArrayValue extends AgentToolJSON {
        @NonNull public final List<AgentToolJSON> value;
        public ArrayValue(@NonNull List<AgentToolJSON> value) { this.value = value; }
        @Override public List<AgentToolJSON> asArray() { return value; }
        @Override public String toString() { return value.toString(); }
        @Override public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof ArrayValue)) return false;
            return value.equals(((ArrayValue) o).value);
        }
        @Override public int hashCode() { return value.hashCode(); }
    }

    public static final class NullValue extends AgentToolJSON {
        @Override public boolean isNull() { return true; }
        @Override public String toString() { return "null"; }
        @Override public boolean equals(Object o) { return o instanceof NullValue; }
        @Override public int hashCode() { return 0; }
    }
}
