/*
 * EMWaver Firmware - Command Registry
 * Copyright (C) 2025 Luís Marnoto
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

#include "command_registry.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "ble_server.h"
#include "esp_log.h"

// NOTE: Keep this comfortably above the total number of registered commands
// across modules (spi/rfm69/sampler/usb/core/etc.). We currently exceed 16.
#define COMMAND_REGISTRY_MAX 64
#define COMMAND_MAX_ARGS CLI_MAX_ARGS

typedef struct {
    char key[CLI_KEY_MAX];
    char value[CLI_VALUE_MAX];
} cli_arg_t;

typedef struct {
    char verb[CLI_VERB_MAX];
    cli_arg_t args[CLI_MAX_ARGS];
    size_t arg_count;
    char positional[CLI_MAX_POSITIONAL][CLI_VALUE_MAX];
    size_t positional_count;
} cli_command_t;

typedef union {
    int int_val;
    bool bool_val;
    const char *str_val;
    command_hex_arg_t hex_val;
} command_arg_value_t;

typedef struct {
    bool in_use;
    const char *verb;
    size_t argc;
    cmd_arg_type_t types[COMMAND_MAX_ARGS];
    bool required[COMMAND_MAX_ARGS];
    const char *names[COMMAND_MAX_ARGS];
    int positional_index[COMMAND_MAX_ARGS];
    void (*handler)(void);
} command_entry_t;

static const char *TAG = "CMD_REG";
static command_entry_t registry[COMMAND_REGISTRY_MAX];

static bool parse_cli_command(const command_t *cmd, cli_command_t *out);
static const char *cli_get_arg(const cli_command_t *cmd, const char *key);
static bool cli_parse_int(const char *str, int *out_value);
static bool cli_parse_bool(const char *str, bool *out_value);
static bool cli_parse_hex_bytes(const char *str, uint8_t *out, size_t max_len, size_t *out_len);
static command_entry_t *find_entry(const char *verb);
static void invoke_handler(const command_entry_t *entry,
                           const command_arg_value_t *values);

void command_registry_init(void)
{
    memset(registry, 0, sizeof(registry));
}

bool register_command(const char *verb,
                      void *handler,
                      const cmd_arg_spec_t *args)
{
    if (!verb || !handler) {
        return false;
    }

    size_t argc = 0;
    cmd_arg_type_t types[COMMAND_MAX_ARGS] = {0};
    bool required[COMMAND_MAX_ARGS] = {0};
    const char *names[COMMAND_MAX_ARGS] = {0};
    int positional_index[COMMAND_MAX_ARGS];
    int positional_count = 0;

    for (size_t i = 0; i < COMMAND_MAX_ARGS; ++i) {
        positional_index[i] = -1;
    }

    if (args) {
        while (args[argc].type != CMD_ARG_DONE) {
            if (argc >= COMMAND_MAX_ARGS) {
                ESP_LOGE(TAG, "command '%s' has too many args (max %d)", verb, COMMAND_MAX_ARGS);
                return false;
            }
            types[argc] = args[argc].type;
            required[argc] = args[argc].required;
            names[argc] = args[argc].name;
            if (args[argc].name == NULL) {
                if (positional_count >= (int)CLI_MAX_POSITIONAL) {
                    ESP_LOGE(TAG, "command '%s' exceeds positional limit", verb);
                    return false;
                }
                positional_index[argc] = positional_count++;
            } else {
                positional_index[argc] = -1;
            }
            argc++;
        }
    }

    command_entry_t *slot = NULL;
    for (size_t i = 0; i < COMMAND_REGISTRY_MAX; ++i) {
        if (registry[i].in_use) {
            if (strncmp(registry[i].verb, verb, CLI_VERB_MAX) == 0) {
                ESP_LOGW(TAG, "command '%s' already registered", verb);
                return false;
            }
        } else if (!slot) {
            slot = &registry[i];
        }
    }

    if (!slot) {
        ESP_LOGE(TAG, "command registry full");
        return false;
    }

    memset(slot, 0, sizeof(*slot));
    slot->in_use = true;
    slot->verb = verb;
    slot->argc = argc;
    slot->handler = (void (*)(void))handler;

    for (size_t i = 0; i < argc; ++i) {
        slot->names[i] = names[i];
        slot->types[i] = types[i];
        slot->required[i] = required[i];
        slot->positional_index[i] = positional_index[i];
    }

    ESP_LOGI(TAG, "registered command '%s' (%zu args)", verb, argc);
    return true;
}

bool command_registry_is_ascii(const command_t *cmd)
{
    if (!cmd || cmd->length == 0) {
        return false;
    }
    for (uint16_t i = 0; i < cmd->length; ++i) {
        uint8_t ch = cmd->data[i];
        if (ch == '\r' || ch == '\n' || ch == '\t' || ch == ' ') {
            continue;
        }
        if (ch < 0x20 || ch > 0x7E) {
            return false;
        }
    }
    return true;
}

static command_entry_t *find_entry(const char *verb)
{
    if (!verb) {
        return NULL;
    }
    for (size_t i = 0; i < COMMAND_REGISTRY_MAX; ++i) {
        if (registry[i].in_use && strcmp(registry[i].verb, verb) == 0) {
            return &registry[i];
        }
    }
    return NULL;
}

void command_registry_handle(const command_t *cmd)
{
    if (!cmd) {
        return;
    }

    cli_command_t parsed;
    if (!parse_cli_command(cmd, &parsed)) {
        command_send_err("parse error");
        return;
    }

    command_entry_t *entry = find_entry(parsed.verb);

    if (!entry && parsed.positional_count > 0) {
        char composite[CLI_VERB_MAX + CLI_VALUE_MAX + 2];
        int written = snprintf(composite, sizeof(composite), "%s %s", parsed.verb, parsed.positional[0]);
        if (written > 0 && (size_t)written < sizeof(composite)) {
            entry = find_entry(composite);
            if (entry) {
                if (parsed.positional_count > 1) {
                    memmove(parsed.positional[0],
                            parsed.positional[1],
                            (parsed.positional_count - 1) * sizeof(parsed.positional[0]));
                }
                parsed.positional_count -= 1;
                parsed.positional[parsed.positional_count][0] = '\0';
            }
        }
    }
    if (!entry) {
        command_send_err("unknown command");
        return;
    }

    command_arg_value_t values[COMMAND_MAX_ARGS];
    memset(values, 0, sizeof(values));

    uint8_t hex_buffers[COMMAND_MAX_ARGS][CLI_VALUE_MAX];

    for (size_t i = 0; i < entry->argc; ++i) {
        const char *raw = NULL;
        if (entry->positional_index[i] >= 0) {
            size_t pos_index = (size_t)entry->positional_index[i];
            if (pos_index < parsed.positional_count) {
                raw = parsed.positional[pos_index];
            }
        } else if (entry->names[i]) {
            raw = cli_get_arg(&parsed, entry->names[i]);
        }

        if (!raw) {
            if (entry->required[i]) {
                command_send_err("missing arg");
                return;
            }

            switch (entry->types[i]) {
                case CMD_ARG_INT:
                    values[i].int_val = 0;
                    break;
                case CMD_ARG_STRING:
                    values[i].str_val = "";
                    break;
                case CMD_ARG_BOOL:
                    values[i].bool_val = false;
                    break;
                case CMD_ARG_HEX:
                    values[i].hex_val.data = NULL;
                    values[i].hex_val.length = 0;
                    break;
                default:
                    break;
            }
            continue;
        }

        if ((entry->types[i] == CMD_ARG_BOOL) && raw[0] == '\0') {
            values[i].bool_val = true;
            continue;
        }

        switch (entry->types[i]) {
            case CMD_ARG_INT: {
                int parsed_int = 0;
                if (!cli_parse_int(raw, &parsed_int)) {
                    command_send_err("invalid int");
                    return;
                }
                values[i].int_val = parsed_int;
                break;
            }
            case CMD_ARG_STRING:
                values[i].str_val = raw;
                break;
            case CMD_ARG_BOOL: {
                bool parsed_bool = false;
                if (!cli_parse_bool(raw, &parsed_bool)) {
                    command_send_err("invalid bool");
                    return;
                }
                values[i].bool_val = parsed_bool;
                break;
            }
            case CMD_ARG_HEX: {
                size_t length = 0;
                if (!cli_parse_hex_bytes(raw, hex_buffers[i], sizeof(hex_buffers[i]), &length)) {
                    command_send_err("invalid hex");
                    return;
                }
                values[i].hex_val.data = hex_buffers[i];
                values[i].hex_val.length = length;
                break;
            }
            default:
                command_send_err("unsupported type");
                return;
        }
    }

    invoke_handler(entry, values);
}

void command_send_ok(const uint8_t *data, size_t len)
{
    // Raw response protocol:
    // - Success with payload: send payload bytes as-is.
    // - Success with no payload: send a single 0x00 byte as ACK.
    if (data && len > 0) {
        ble_server_notify(data, (uint16_t)len);
        return;
    }
    const uint8_t ok = 0x00;
    ble_server_notify(&ok, 1);
}

void command_send_err(const char *msg)
{
    (void)msg;
    // Raw response protocol:
    // - Error: send a single 0xFF byte.
    const uint8_t err = 0xFF;
    ble_server_notify(&err, 1);
}

#define CALL_HANDLER(entry, signature, ...)     (((signature)((entry)->handler))(__VA_ARGS__))

static bool types_match(const command_entry_t *entry,
                        const cmd_arg_type_t *types,
                        size_t count)
{
    if (entry->argc != count) {
        return false;
    }
    for (size_t i = 0; i < count; ++i) {
        if (entry->types[i] != types[i]) {
            return false;
        }
    }
    return true;
}

static void invoke_handler(const command_entry_t *entry,
                           const command_arg_value_t *values)
{
    if (entry->argc == 0) {
        CALL_HANDLER(entry, void (*)(void));
        return;
    }

    if (entry->argc == 1) {
        switch (entry->types[0]) {
            case CMD_ARG_INT:
                CALL_HANDLER(entry, void (*)(int), values[0].int_val);
                return;
            case CMD_ARG_STRING:
                CALL_HANDLER(entry, void (*)(const char *), values[0].str_val);
                return;
            case CMD_ARG_BOOL:
                CALL_HANDLER(entry, void (*)(bool), values[0].bool_val);
                return;
            case CMD_ARG_HEX:
                CALL_HANDLER(entry, void (*)(const command_hex_arg_t *), &values[0].hex_val);
                return;
            default:
                break;
        }
        ESP_LOGE(TAG, "Unsupported signature for '%s': argc=%d, arg types don't match any 1-arg pattern", entry->verb, entry->argc);
        command_send_err("unsupported signature");
        return;
    }

    if (entry->argc == 2) {
        const cmd_arg_type_t pattern[][2] = {
            {CMD_ARG_INT, CMD_ARG_INT},
            {CMD_ARG_INT, CMD_ARG_STRING},
            {CMD_ARG_INT, CMD_ARG_BOOL},
            {CMD_ARG_INT, CMD_ARG_HEX},
            {CMD_ARG_STRING, CMD_ARG_INT},
            {CMD_ARG_STRING, CMD_ARG_STRING},
            {CMD_ARG_STRING, CMD_ARG_BOOL},
            {CMD_ARG_STRING, CMD_ARG_HEX},
            {CMD_ARG_BOOL, CMD_ARG_INT},
            {CMD_ARG_BOOL, CMD_ARG_STRING},
            {CMD_ARG_BOOL, CMD_ARG_BOOL},
            {CMD_ARG_BOOL, CMD_ARG_HEX},
            {CMD_ARG_HEX, CMD_ARG_INT},
            {CMD_ARG_HEX, CMD_ARG_STRING},
            {CMD_ARG_HEX, CMD_ARG_BOOL},
            {CMD_ARG_HEX, CMD_ARG_HEX},
        };

        for (size_t i = 0; i < sizeof(pattern) / sizeof(pattern[0]); ++i) {
            if (types_match(entry, pattern[i], 2)) {
                switch (pattern[i][0]) {
                    case CMD_ARG_INT:
                        switch (pattern[i][1]) {
                            case CMD_ARG_INT:
                                CALL_HANDLER(entry, void (*)(int, int), values[0].int_val, values[1].int_val);
                                return;
                            case CMD_ARG_STRING:
                                CALL_HANDLER(entry, void (*)(int, const char *), values[0].int_val, values[1].str_val);
                                return;
                            case CMD_ARG_BOOL:
                                CALL_HANDLER(entry, void (*)(int, bool), values[0].int_val, values[1].bool_val);
                                return;
                            case CMD_ARG_HEX:
                                CALL_HANDLER(entry, void (*)(int, const command_hex_arg_t *), values[0].int_val, &values[1].hex_val);
                                return;
                            default:
                                break;
                        }
                        break;
                    case CMD_ARG_STRING:
                        switch (pattern[i][1]) {
                            case CMD_ARG_INT:
                                CALL_HANDLER(entry, void (*)(const char *, int), values[0].str_val, values[1].int_val);
                                return;
                            case CMD_ARG_STRING:
                                CALL_HANDLER(entry, void (*)(const char *, const char *), values[0].str_val, values[1].str_val);
                                return;
                            case CMD_ARG_BOOL:
                                CALL_HANDLER(entry, void (*)(const char *, bool), values[0].str_val, values[1].bool_val);
                                return;
                            case CMD_ARG_HEX:
                                CALL_HANDLER(entry, void (*)(const char *, const command_hex_arg_t *), values[0].str_val, &values[1].hex_val);
                                return;
                            default:
                                break;
                        }
                        break;
                    case CMD_ARG_BOOL:
                        switch (pattern[i][1]) {
                            case CMD_ARG_INT:
                                CALL_HANDLER(entry, void (*)(bool, int), values[0].bool_val, values[1].int_val);
                                return;
                            case CMD_ARG_STRING:
                                CALL_HANDLER(entry, void (*)(bool, const char *), values[0].bool_val, values[1].str_val);
                                return;
                            case CMD_ARG_BOOL:
                                CALL_HANDLER(entry, void (*)(bool, bool), values[0].bool_val, values[1].bool_val);
                                return;
                            case CMD_ARG_HEX:
                                CALL_HANDLER(entry, void (*)(bool, const command_hex_arg_t *), values[0].bool_val, &values[1].hex_val);
                                return;
                            default:
                                break;
                        }
                        break;
                    case CMD_ARG_HEX:
                        switch (pattern[i][1]) {
                            case CMD_ARG_INT:
                                CALL_HANDLER(entry, void (*)(const command_hex_arg_t *, int), &values[0].hex_val, values[1].int_val);
                                return;
                            case CMD_ARG_STRING:
                                CALL_HANDLER(entry, void (*)(const command_hex_arg_t *, const char *), &values[0].hex_val, values[1].str_val);
                                return;
                            case CMD_ARG_BOOL:
                                CALL_HANDLER(entry, void (*)(const command_hex_arg_t *, bool), &values[0].hex_val, values[1].bool_val);
                                return;
                            case CMD_ARG_HEX:
                                CALL_HANDLER(entry, void (*)(const command_hex_arg_t *, const command_hex_arg_t *), &values[0].hex_val, &values[1].hex_val);
                                return;
                            default:
                                break;
                        }
                        break;
                    default:
                        break;
                }
            }
        }

        ESP_LOGE(TAG, "Unsupported signature for '%s': argc=%d, arg types don't match any 2-arg pattern", entry->verb, entry->argc);
        command_send_err("unsupported signature");
        return;
    }

    if (types_match(entry, (cmd_arg_type_t[]){CMD_ARG_STRING, CMD_ARG_HEX, CMD_ARG_INT}, 3)) {
        CALL_HANDLER(entry, void (*)(const char *, const command_hex_arg_t *, int),
                     values[0].str_val, &values[1].hex_val, values[2].int_val);
        return;
    }

    if (types_match(entry, (cmd_arg_type_t[]){CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_HEX}, 3)) {
        CALL_HANDLER(entry, void (*)(int, int, const command_hex_arg_t *),
                     values[0].int_val, values[1].int_val, &values[2].hex_val);
        return;
    }

    if (types_match(entry, (cmd_arg_type_t[]){CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_HEX, CMD_ARG_HEX}, 4)) {
        CALL_HANDLER(entry, void (*)(int, int, const command_hex_arg_t *, const command_hex_arg_t *),
                     values[0].int_val, values[1].int_val, &values[2].hex_val, &values[3].hex_val);
        return;
    }

    if (types_match(entry, (cmd_arg_type_t[]){CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_INT}, 5)) {
        CALL_HANDLER(entry, void (*)(int, int, int, int, int),
                     values[0].int_val, values[1].int_val, values[2].int_val, values[3].int_val, values[4].int_val);
        return;
    }

    if (types_match(entry,
                    (cmd_arg_type_t[]){CMD_ARG_STRING, CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_INT,
                                       CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_INT},
                    8)) {
        CALL_HANDLER(entry, void (*)(const char *, int, int, int, int, int, int, int),
                     values[0].str_val,
                     values[1].int_val,
                     values[2].int_val,
                     values[3].int_val,
                     values[4].int_val,
                     values[5].int_val,
                     values[6].int_val,
                     values[7].int_val);
        return;
    }

    if (types_match(entry,
                    (cmd_arg_type_t[]){CMD_ARG_STRING, CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_INT,
                                       CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_INT,
                                       CMD_ARG_INT},
                    9)) {
        CALL_HANDLER(entry, void (*)(const char *, int, int, int, int, int, int, int, int),
                     values[0].str_val,
                     values[1].int_val,
                     values[2].int_val,
                     values[3].int_val,
                     values[4].int_val,
                     values[5].int_val,
                     values[6].int_val,
                     values[7].int_val,
                     values[8].int_val);
        return;
    }

    ESP_LOGE(TAG, "Unsupported signature for '%s': argc=%d (no matching pattern found)", entry->verb, entry->argc);
    for (int i = 0; i < entry->argc && i < CLI_MAX_ARGS; i++) {
        ESP_LOGE(TAG, "  arg[%d]: type=%d, required=%d, name=%s", 
                 i, entry->types[i], entry->required[i], entry->names[i]);
    }
    command_send_err("unsupported signature");
}

static bool parse_cli_command(const command_t *cmd, cli_command_t *out)
{
    if (!cmd || !out || cmd->length == 0) {
        return false;
    }

    memset(out, 0, sizeof(*out));

    char buffer[CLI_COMMAND_BUFFER];
    size_t copy_len = cmd->length;
    if (copy_len >= sizeof(buffer)) {
        copy_len = sizeof(buffer) - 1;
    }
    memcpy(buffer, cmd->data, copy_len);
    buffer[copy_len] = '\0';

    char *saveptr = NULL;
    char *token = strtok_r(buffer, " \t\r\n", &saveptr);
    if (!token) {
        return false;
    }

    strncpy(out->verb, token, CLI_VERB_MAX - 1);
    out->verb[CLI_VERB_MAX - 1] = '\0';

    while ((token = strtok_r(NULL, " \t\r\n", &saveptr)) != NULL) {
        if (token[0] == '-' && token[1] == '-') {
            token += 2;
            char *eq = strchr(token, '=');
            if (eq) {
                size_t key_len = (size_t)(eq - token);
                if (key_len >= CLI_KEY_MAX) {
                    key_len = CLI_KEY_MAX - 1;
                }
                strncpy(out->args[out->arg_count].key, token, key_len);
                out->args[out->arg_count].key[key_len] = '\0';
                strncpy(out->args[out->arg_count].value, eq + 1, CLI_VALUE_MAX - 1);
                out->args[out->arg_count].value[CLI_VALUE_MAX - 1] = '\0';
                out->arg_count += 1;
            } else {
                strncpy(out->args[out->arg_count].key, token, CLI_KEY_MAX - 1);
                out->args[out->arg_count].key[CLI_KEY_MAX - 1] = '\0';
                out->args[out->arg_count].value[0] = '\0';
                out->arg_count += 1;
            }
            if (out->arg_count >= CLI_MAX_ARGS) {
                break;
            }
        } else {
            strncpy(out->positional[out->positional_count], token, CLI_VALUE_MAX - 1);
            out->positional[out->positional_count][CLI_VALUE_MAX - 1] = '\0';
            out->positional_count += 1;
            if (out->positional_count >= CLI_MAX_POSITIONAL) {
                break;
            }
        }
    }

    return true;
}

static const char *cli_get_arg(const cli_command_t *cmd, const char *key)
{
    if (!cmd || !key) {
        return NULL;
    }
    for (size_t i = 0; i < cmd->arg_count; ++i) {
        if (strncmp(cmd->args[i].key, key, CLI_KEY_MAX) == 0) {
            return cmd->args[i].value;
        }
    }
    return NULL;
}

static bool cli_parse_int(const char *str, int *out_value)
{
    if (!str || !out_value) {
        return false;
    }
    char *endptr = NULL;
    long value = strtol(str, &endptr, 0);
    if (endptr == str || *endptr != '\0') {
        return false;
    }
    *out_value = (int)value;
    return true;
}

static bool cli_parse_bool(const char *str, bool *out_value)
{
    if (!str || !out_value) {
        return false;
    }

    if (strcmp(str, "0") == 0) {
        *out_value = false;
        return true;
    }
    if (strcmp(str, "1") == 0) {
        *out_value = true;
        return true;
    }

    char lowered[8];
    size_t len = strlen(str);
    if (len >= sizeof(lowered)) {
        return false;
    }
    for (size_t i = 0; i < len; ++i) {
        lowered[i] = (char)tolower((unsigned char)str[i]);
    }
    lowered[len] = '\0';

    if (strcmp(lowered, "true") == 0) {
        *out_value = true;
        return true;
    }
    if (strcmp(lowered, "false") == 0) {
        *out_value = false;
        return true;
    }

    return false;
}

static bool cli_parse_hex_bytes(const char *str, uint8_t *out, size_t max_len, size_t *out_len)
{
    if (!str || !out || max_len == 0) {
        return false;
    }

    char buffer[CLI_VALUE_MAX];
    strncpy(buffer, str, CLI_VALUE_MAX - 1);
    buffer[CLI_VALUE_MAX - 1] = '\0';

    char *saveptr = NULL;
    char *token = strtok_r(buffer, ",: ", &saveptr);
    size_t count = 0;

    while (token != NULL) {
        if (count >= max_len) {
            return false;
        }
        char *endptr = NULL;
        long value = strtol(token, &endptr, 0);
        if (endptr == token || *endptr != '\0') {
            return false;
        }
        out[count++] = (uint8_t)(value & 0xFF);
        token = strtok_r(NULL, ",: ", &saveptr);
    }

    if (out_len) {
        *out_len = count;
    }

    return true;
}
