#include "command_registry.h"

#include <stdlib.h>
#include <string.h>

#include "usbd_cdc_if.h"

#define COMMAND_REGISTRY_MAX 64

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
    const char *verb;
    const cmd_arg_spec_t *args;
    void (*handler)(void);
} command_entry_t;

static command_entry_t registry[COMMAND_REGISTRY_MAX];
static size_t registry_count = 0;

static bool parse_cli_command(const command_t *cmd, cli_command_t *out);
static const char *cli_get_arg(const cli_command_t *cmd, const char *key);
static bool cli_parse_int(const char *str, int *out_value);
static bool cli_parse_bool(const char *str, bool *out_value);
static bool cli_parse_hex_bytes(const char *str, uint8_t *out, size_t max_len, size_t *out_len);
static command_entry_t *find_entry(const char *verb);
static void invoke_handler(const command_entry_t *entry,
                           const cmd_arg_type_t *types,
                           size_t argc,
                           const command_arg_value_t *values);

void command_registry_init(void)
{
    memset(registry, 0, sizeof(registry));
    registry_count = 0;
}

bool register_command(const char *verb,
                      void *handler,
                      const cmd_arg_spec_t *args)
{
    if (!verb || !handler) {
        return false;
    }

    if (registry_count >= COMMAND_REGISTRY_MAX) {
        return false;
    }

    for (size_t i = 0; i < registry_count; ++i) {
        if (registry[i].verb && strcmp(registry[i].verb, verb) == 0) {
            return false;
        }
    }

    registry[registry_count].verb = verb;
    registry[registry_count].args = args;
    registry[registry_count].handler = (void (*)(void))handler;
    registry_count++;
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
    for (size_t i = 0; i < registry_count; ++i) {
        if (registry[i].verb && strcmp(registry[i].verb, verb) == 0) {
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
        command_send_err(NULL);
        return;
    }

    command_entry_t *entry = NULL;
    if (parsed.positional_count > 0) {
        char composite[CLI_VERB_MAX + CLI_VALUE_MAX + 2];
        size_t verb_len = strnlen(parsed.verb, CLI_VERB_MAX);
        size_t pos_len = strnlen(parsed.positional[0], CLI_VALUE_MAX);
        if (verb_len > 0 && pos_len > 0 && (verb_len + 1 + pos_len) < sizeof(composite)) {
            memcpy(composite, parsed.verb, verb_len);
            composite[verb_len] = ' ';
            memcpy(composite + verb_len + 1, parsed.positional[0], pos_len);
            composite[verb_len + 1 + pos_len] = '\0';

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
        entry = find_entry(parsed.verb);
    }
    if (!entry) {
        command_send_err(NULL);
        return;
    }

    command_arg_value_t values[CLI_MAX_ARGS];
    memset(values, 0, sizeof(values));

    uint8_t hex_buffers[CLI_MAX_ARGS][CLI_VALUE_MAX];
    cmd_arg_type_t types[CLI_MAX_ARGS];
    size_t argc = 0;
    size_t positional_index = 0;

    for (const cmd_arg_spec_t *spec = entry->args; spec && spec->type != CMD_ARG_DONE; ++spec) {
        if (argc >= CLI_MAX_ARGS) {
            command_send_err(NULL);
            return;
        }

        const char *raw = NULL;
        if (spec->name == NULL) {
            if (positional_index < parsed.positional_count) {
                raw = parsed.positional[positional_index];
            }
            positional_index++;
        } else {
            raw = cli_get_arg(&parsed, spec->name);
        }

        if (!raw) {
            if (spec->required) {
                command_send_err(NULL);
                return;
            }

            types[argc] = spec->type;
            switch (spec->type) {
                case CMD_ARG_INT:
                    values[argc].int_val = 0;
                    break;
                case CMD_ARG_STRING:
                    values[argc].str_val = "";
                    break;
                case CMD_ARG_BOOL:
                    values[argc].bool_val = false;
                    break;
                case CMD_ARG_HEX:
                    values[argc].hex_val.data = NULL;
                    values[argc].hex_val.length = 0;
                    break;
                default:
                    break;
            }
            argc++;
            continue;
        }

        types[argc] = spec->type;
        switch (spec->type) {
            case CMD_ARG_INT: {
                int value = 0;
                if (!cli_parse_int(raw, &value)) {
                    command_send_err(NULL);
                    return;
                }
                values[argc].int_val = value;
                break;
            }
            case CMD_ARG_STRING:
                values[argc].str_val = raw;
                break;
            case CMD_ARG_BOOL: {
                bool value = false;
                if (!cli_parse_bool(raw, &value)) {
                    command_send_err(NULL);
                    return;
                }
                values[argc].bool_val = value;
                break;
            }
            case CMD_ARG_HEX: {
                size_t length = 0;
                if (!cli_parse_hex_bytes(raw, hex_buffers[argc], CLI_VALUE_MAX, &length)) {
                    command_send_err(NULL);
                    return;
                }
                values[argc].hex_val.data = hex_buffers[argc];
                values[argc].hex_val.length = length;
                break;
            }
            default:
                command_send_err(NULL);
                return;
        }
        argc++;
    }

    invoke_handler(entry, types, argc, values);
}

void command_send_ok(const uint8_t *data, size_t len)
{
    if (data && len > 0) {
        (void)CDC_SendResponsePkt_FS((uint8_t *)data, (uint16_t)len, 100);
        return;
    }
    const uint8_t ok = 0x00;
    (void)CDC_SendResponsePkt_FS((uint8_t *)&ok, 1, 100);
}

void command_send_err(const char *msg)
{
    (void)msg;
    const uint8_t err = 0xFF;
    (void)CDC_SendResponsePkt_FS((uint8_t *)&err, 1, 100);
}

#define CALL_HANDLER(entry, signature, ...)     (((signature)((entry)->handler))(__VA_ARGS__))

static bool types_match(const cmd_arg_type_t *types,
                        size_t actual_count,
                        const cmd_arg_type_t *expected,
                        size_t expected_count)
{
    if (actual_count != expected_count) {
        return false;
    }
    for (size_t i = 0; i < expected_count; ++i) {
        if (types[i] != expected[i]) {
            return false;
        }
    }
    return true;
}

static void invoke_handler(const command_entry_t *entry,
                           const cmd_arg_type_t *types,
                           size_t argc,
                           const command_arg_value_t *values)
{
    if (argc == 0) {
        CALL_HANDLER(entry, void (*)(void));
        return;
    }

    if (types_match(types, argc, (const cmd_arg_type_t[]){CMD_ARG_INT}, 1)) {
        CALL_HANDLER(entry, void (*)(int), values[0].int_val);
        return;
    }

    if (types_match(types, argc, (const cmd_arg_type_t[]){CMD_ARG_INT, CMD_ARG_INT}, 2)) {
        CALL_HANDLER(entry, void (*)(int, int), values[0].int_val, values[1].int_val);
        return;
    }

    if (types_match(types, argc, (const cmd_arg_type_t[]){CMD_ARG_INT, CMD_ARG_HEX}, 2)) {
        CALL_HANDLER(entry, void (*)(int, const command_hex_arg_t *),
                     values[0].int_val, &values[1].hex_val);
        return;
    }

    if (types_match(types, argc, (const cmd_arg_type_t[]){CMD_ARG_STRING}, 1)) {
        CALL_HANDLER(entry, void (*)(const char *), values[0].str_val);
        return;
    }

    if (types_match(types, argc, (const cmd_arg_type_t[]){CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_INT}, 5)) {
        CALL_HANDLER(entry, void (*)(int, int, int, int, int),
                     values[0].int_val, values[1].int_val, values[2].int_val, values[3].int_val, values[4].int_val);
        return;
    }

    if (types_match(types, argc, (const cmd_arg_type_t[]){CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_BOOL}, 5)) {
        CALL_HANDLER(entry, void (*)(int, int, int, int, bool),
                     values[0].int_val, values[1].int_val, values[2].int_val, values[3].int_val, values[4].bool_val);
        return;
    }

    if (types_match(types, argc, (const cmd_arg_type_t[]){CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_INT}, 4)) {
        CALL_HANDLER(entry, void (*)(int, int, int, int),
                     values[0].int_val, values[1].int_val, values[2].int_val, values[3].int_val);
        return;
    }

    command_send_err(NULL);
}

static void skip_spaces(const uint8_t *buf, size_t len, size_t *pos)
{
    while (*pos < len) {
        uint8_t ch = buf[*pos];
        if (ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n') {
            (*pos)++;
            continue;
        }
        break;
    }
}

static bool copy_token(const uint8_t *buf, size_t len, size_t *pos, char *out, size_t out_len)
{
    skip_spaces(buf, len, pos);
    if (*pos >= len) {
        return false;
    }

    size_t start = *pos;
    while (*pos < len) {
        uint8_t ch = buf[*pos];
        if (ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n') {
            break;
        }
        (*pos)++;
    }

    size_t tok_len = *pos - start;
    if (tok_len == 0) {
        return false;
    }

    if (tok_len >= out_len) {
        tok_len = out_len - 1;
    }
    memcpy(out, &buf[start], tok_len);
    out[tok_len] = '\0';
    return true;
}

static bool parse_cli_command(const command_t *cmd, cli_command_t *out)
{
    if (!cmd || !out) {
        return false;
    }

    memset(out, 0, sizeof(*out));

    size_t pos = 0;
    if (!copy_token(cmd->data, cmd->length, &pos, out->verb, sizeof(out->verb))) {
        return false;
    }

    while (pos < cmd->length) {
        char token[CLI_VALUE_MAX + CLI_KEY_MAX + 4];
        if (!copy_token(cmd->data, cmd->length, &pos, token, sizeof(token))) {
            break;
        }

        if (strncmp(token, "--", 2) == 0) {
            const char *key = token + 2;
            const char *value = NULL;
            char *eq = strchr(token + 2, '=');
            if (eq) {
                *eq = '\0';
                value = eq + 1;
            } else {
                // Support `--key value` and bare bool flags like `--open`.
                size_t saved_pos = pos;
                char next[CLI_VALUE_MAX + 4];
                if (copy_token(cmd->data, cmd->length, &pos, next, sizeof(next))) {
                    if (strncmp(next, "--", 2) == 0) {
                        pos = saved_pos;
                        value = "1";
                    } else {
                        value = next;
                    }
                } else {
                    value = "1";
                }
            }
            if (out->arg_count >= CLI_MAX_ARGS) {
                continue;
            }
            strncpy(out->args[out->arg_count].key, key, CLI_KEY_MAX - 1);
            out->args[out->arg_count].key[CLI_KEY_MAX - 1] = '\0';
            strncpy(out->args[out->arg_count].value, value ? value : "", CLI_VALUE_MAX - 1);
            out->args[out->arg_count].value[CLI_VALUE_MAX - 1] = '\0';
            out->arg_count++;
        } else {
            if (out->positional_count >= CLI_MAX_POSITIONAL) {
                continue;
            }
            strncpy(out->positional[out->positional_count], token, CLI_VALUE_MAX - 1);
            out->positional[out->positional_count][CLI_VALUE_MAX - 1] = '\0';
            out->positional_count++;
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
        if (strcmp(cmd->args[i].key, key) == 0) {
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
    char *end = NULL;
    long value = strtol(str, &end, 0);
    if (end == str || (end && *end != '\0')) {
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
    if (strcmp(str, "1") == 0 || strcmp(str, "true") == 0 || strcmp(str, "on") == 0) {
        *out_value = true;
        return true;
    }
    if (strcmp(str, "0") == 0 || strcmp(str, "false") == 0 || strcmp(str, "off") == 0) {
        *out_value = false;
        return true;
    }
    return false;
}

static int from_hex(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
    if (c >= 'A' && c <= 'F') return 10 + (c - 'A');
    return -1;
}

static bool cli_parse_hex_bytes(const char *str, uint8_t *out, size_t max_len, size_t *out_len)
{
    if (!str || !out || !out_len) {
        return false;
    }
    size_t len = strlen(str);
    if (len % 2 != 0) {
        return false;
    }
    size_t bytes = len / 2;
    if (bytes > max_len) {
        return false;
    }
    for (size_t i = 0; i < bytes; ++i) {
        int hi = from_hex(str[i * 2]);
        int lo = from_hex(str[i * 2 + 1]);
        if (hi < 0 || lo < 0) {
            return false;
        }
        out[i] = (uint8_t)((hi << 4) | lo);
    }
    *out_len = bytes;
    return true;
}
