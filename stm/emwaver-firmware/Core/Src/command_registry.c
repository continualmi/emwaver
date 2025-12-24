#include "command_registry.h"

#include <stdlib.h>
#include <string.h>

#include "usbd_cdc_if.h"

// STM32F042 has very limited RAM; keep registry metadata tiny and store
// command tables in flash (rodata).
#define COMMAND_REGISTRY_TABLES_MAX 5

typedef struct {
    const char *key;
    const char *value;
} cli_arg_view_t;

typedef struct {
    char *verb;
    cli_arg_view_t args[CLI_MAX_ARGS];
    size_t arg_count;
    char *positional[CLI_MAX_POSITIONAL];
    size_t positional_count;
} cli_command_view_t;

typedef union {
    int int_val;
    bool bool_val;
    const char *str_val;
    command_hex_arg_t hex_val;
} command_arg_value_t;

static const command_entry_t *registry_tables[COMMAND_REGISTRY_TABLES_MAX];
static size_t registry_table_counts[COMMAND_REGISTRY_TABLES_MAX];
static size_t registry_table_count = 0;

// The STM32F042 linker script reserves a small stack; keep command dispatch stack
// usage low by using static scratch buffers (single-threaded firmware).
static char scratch_line[CLI_COMMAND_BUFFER + 1];
static cli_command_view_t scratch_parsed;
static command_arg_value_t scratch_values[CLI_MAX_ARGS];
static cmd_arg_type_t scratch_types[CLI_MAX_ARGS];
static uint8_t scratch_hex_buffer[CLI_VALUE_MAX];

static bool parse_cli_command_inplace(char *line, cli_command_view_t *out);
static const char *cli_get_arg_view(const cli_command_view_t *cmd, const char *key);
static bool cli_parse_int(const char *str, int *out_value);
static bool cli_parse_bool(const char *str, bool *out_value);
static bool cli_parse_hex_bytes(const char *str, uint8_t *out, size_t max_len, size_t *out_len);
static const command_entry_t *find_entry(const char *verb);
static void invoke_handler(const command_entry_t *entry,
                           const cmd_arg_type_t *types,
                           size_t argc,
                           const command_arg_value_t *values);

void command_registry_init(void)
{
    memset(registry_tables, 0, sizeof(registry_tables));
    memset(registry_table_counts, 0, sizeof(registry_table_counts));
    registry_table_count = 0;
}

bool command_registry_add_table(const command_entry_t *entries, size_t count)
{
    if (!entries || count == 0) {
        return false;
    }

    if (registry_table_count >= COMMAND_REGISTRY_TABLES_MAX) {
        return false;
    }

    registry_tables[registry_table_count] = entries;
    registry_table_counts[registry_table_count] = count;
    registry_table_count++;
    return true;
}

bool command_registry_is_ascii(const command_t *cmd)
{
    if (!cmd || cmd->length == 0) {
        return false;
    }
    for (uint16_t i = 0; i < cmd->length; ++i) {
        uint8_t ch = cmd->data[i];
        if (ch == '\0') {
            break;
        }
        if (ch == '\r' || ch == '\n' || ch == '\t' || ch == ' ') {
            continue;
        }
        if (ch < 0x20 || ch > 0x7E) {
            return false;
        }
    }
    return true;
}

static const command_entry_t *find_entry(const char *verb)
{
    if (!verb) {
        return NULL;
    }

    for (size_t table_index = 0; table_index < registry_table_count; ++table_index) {
        const command_entry_t *table = registry_tables[table_index];
        size_t count = registry_table_counts[table_index];
        if (!table || count == 0) {
            continue;
        }
        for (size_t entry_index = 0; entry_index < count; ++entry_index) {
            if (table[entry_index].verb && strcmp(table[entry_index].verb, verb) == 0) {
                return &table[entry_index];
            }
        }
    }
    return NULL;
}

void command_registry_handle(const command_t *cmd)
{
    if (!cmd) {
        return;
    }

    size_t line_len = cmd->length;
    for (uint16_t i = 0; i < cmd->length; ++i) {
        if (cmd->data[i] == '\0') {
            line_len = i;
            break;
        }
    }
    if (line_len > CLI_COMMAND_BUFFER) {
        line_len = CLI_COMMAND_BUFFER;
    }
    memcpy(scratch_line, cmd->data, line_len);
    scratch_line[line_len] = '\0';

    if (!parse_cli_command_inplace(scratch_line, &scratch_parsed)) {
        command_send_err(NULL);
        return;
    }

    const command_entry_t *entry = NULL;
    if (scratch_parsed.positional_count > 0) {
        char composite[CLI_VERB_MAX + CLI_VALUE_MAX + 2];
        size_t verb_len = strnlen(scratch_parsed.verb, CLI_VERB_MAX);
        size_t pos_len = strnlen(scratch_parsed.positional[0], CLI_VALUE_MAX);
        if (verb_len > 0 && pos_len > 0 && (verb_len + 1 + pos_len) < sizeof(composite)) {
            memcpy(composite, scratch_parsed.verb, verb_len);
            composite[verb_len] = ' ';
            memcpy(composite + verb_len + 1, scratch_parsed.positional[0], pos_len);
            composite[verb_len + 1 + pos_len] = '\0';

            entry = find_entry(composite);
            if (entry) {
                if (scratch_parsed.positional_count > 1) {
                    memmove(&scratch_parsed.positional[0],
                            &scratch_parsed.positional[1],
                            (scratch_parsed.positional_count - 1) * sizeof(scratch_parsed.positional[0]));
                }
                scratch_parsed.positional_count -= 1;
                scratch_parsed.positional[scratch_parsed.positional_count] = NULL;
            }
        }
    }
    if (!entry) {
        entry = find_entry(scratch_parsed.verb);
    }
    if (!entry) {
        command_send_err(NULL);
        return;
    }

    memset(scratch_values, 0, sizeof(scratch_values));
    bool hex_buffer_used = false;

    size_t argc = 0;
    size_t positional_index = 0;

    for (const cmd_arg_spec_t *spec = entry->args; spec && spec->type != CMD_ARG_DONE; ++spec) {
        if (argc >= CLI_MAX_ARGS) {
            command_send_err(NULL);
            return;
        }

        const char *raw = NULL;
        if (spec->name == NULL) {
            if (positional_index < scratch_parsed.positional_count) {
                raw = scratch_parsed.positional[positional_index];
            }
            positional_index++;
        } else {
            raw = cli_get_arg_view(&scratch_parsed, spec->name);
        }

        if (!raw) {
            if (spec->required) {
                command_send_err(NULL);
                return;
            }

            scratch_types[argc] = spec->type;
            switch (spec->type) {
                case CMD_ARG_INT:
                    scratch_values[argc].int_val = 0;
                    break;
                case CMD_ARG_STRING:
                    scratch_values[argc].str_val = "";
                    break;
                case CMD_ARG_BOOL:
                    scratch_values[argc].bool_val = false;
                    break;
                case CMD_ARG_HEX:
                    scratch_values[argc].hex_val.data = NULL;
                    scratch_values[argc].hex_val.length = 0;
                    break;
                default:
                    break;
            }
            argc++;
            continue;
        }

        scratch_types[argc] = spec->type;
        switch (spec->type) {
            case CMD_ARG_INT: {
                int value = 0;
                if (!cli_parse_int(raw, &value)) {
                    command_send_err(NULL);
                    return;
                }
                scratch_values[argc].int_val = value;
                break;
            }
            case CMD_ARG_STRING:
                scratch_values[argc].str_val = raw;
                break;
            case CMD_ARG_BOOL: {
                bool value = false;
                if (!cli_parse_bool(raw, &value)) {
                    command_send_err(NULL);
                    return;
                }
                scratch_values[argc].bool_val = value;
                break;
            }
            case CMD_ARG_HEX: {
                size_t length = 0;
                if (hex_buffer_used) {
                    command_send_err(NULL);
                    return;
                }
                if (!cli_parse_hex_bytes(raw, scratch_hex_buffer, CLI_VALUE_MAX, &length)) {
                    command_send_err(NULL);
                    return;
                }
                hex_buffer_used = true;
                scratch_values[argc].hex_val.data = scratch_hex_buffer;
                scratch_values[argc].hex_val.length = length;
                break;
            }
            default:
                command_send_err(NULL);
                return;
        }
        argc++;
    }

    invoke_handler(entry, scratch_types, argc, scratch_values);
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
    // Historically we used 0xFF as a generic error byte, but that collides with
    // legitimate register values (e.g., CC1101 reads) and makes debugging harder.
    // For the STM32 firmware we treat errors as best-effort no-ops and always
    // respond with the same success byte as command_send_ok(NULL, 0).
    const uint8_t ok = 0x00;
    (void)CDC_SendResponsePkt_FS((uint8_t *)&ok, 1, 100);
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

    if (types_match(types, argc, (const cmd_arg_type_t[]){CMD_ARG_HEX}, 1)) {
        CALL_HANDLER(entry, void (*)(const command_hex_arg_t *), &values[0].hex_val);
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

    if (types_match(types, argc, (const cmd_arg_type_t[]){CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_INT}, 3)) {
        CALL_HANDLER(entry, void (*)(int, int, int),
                     values[0].int_val, values[1].int_val, values[2].int_val);
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

    if (types_match(types, argc, (const cmd_arg_type_t[]){CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_STRING}, 3)) {
        CALL_HANDLER(entry, void (*)(int, int, const char *),
                     values[0].int_val, values[1].int_val, values[2].str_val);
        return;
    }

    if (types_match(types, argc, (const cmd_arg_type_t[]){CMD_ARG_INT, CMD_ARG_INT, CMD_ARG_STRING, CMD_ARG_STRING}, 4)) {
        CALL_HANDLER(entry, void (*)(int, int, const char *, const char *),
                     values[0].int_val, values[1].int_val, values[2].str_val, values[3].str_val);
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

static bool is_cli_space(char ch)
{
    return ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n';
}

static char *next_token(char **cursor)
{
    if (!cursor || !*cursor) {
        return NULL;
    }

    char *p = *cursor;
    while (*p && is_cli_space(*p)) {
        p++;
    }
    if (!*p) {
        *cursor = p;
        return NULL;
    }

    char *start = p;
    while (*p && !is_cli_space(*p)) {
        p++;
    }
    if (*p) {
        *p = '\0';
        p++;
    }
    *cursor = p;
    return start;
}

static bool parse_cli_command_inplace(char *line, cli_command_view_t *out)
{
    if (!line || !out) {
        return false;
    }

    memset(out, 0, sizeof(*out));

    char *cursor = line;
    char *verb = next_token(&cursor);
    if (!verb) {
        return false;
    }
    out->verb = verb;

    char *pending = NULL;
    while (1) {
        char *token = pending ? pending : next_token(&cursor);
        pending = NULL;
        if (!token) {
            break;
        }

        if (strncmp(token, "--", 2) == 0) {
            char *key = token + 2;
            const char *value = NULL;
            char *eq = strchr(key, '=');
            if (eq) {
                *eq = '\0';
                value = eq + 1;
            } else {
                // Support `--key value` and bare bool flags like `--open`.
                char *next = next_token(&cursor);
                if (!next) {
                    value = "1";
                } else if (strncmp(next, "--", 2) == 0) {
                    value = "1";
                    pending = next;
                } else {
                    value = next;
                }
            }
            if (out->arg_count < CLI_MAX_ARGS) {
                out->args[out->arg_count].key = key;
                out->args[out->arg_count].value = value ? value : "";
                out->arg_count++;
            }
        } else {
            if (out->positional_count < CLI_MAX_POSITIONAL) {
                out->positional[out->positional_count] = token;
                out->positional_count++;
            }
        }
    }

    return true;
}

static const char *cli_get_arg_view(const cli_command_view_t *cmd, const char *key)
{
    if (!cmd || !key) {
        return NULL;
    }
    for (size_t i = 0; i < cmd->arg_count; ++i) {
        if (cmd->args[i].key && strcmp(cmd->args[i].key, key) == 0) {
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

    size_t written = 0;
    int pending = -1;

    for (const char *p = str; *p; ++p) {
        char c = *p;

        if (c == '0' && (p[1] == 'x' || p[1] == 'X')) {
            ++p;
            continue;
        }

        if (c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == ',' || c == ':' || c == '_' || c == '-') {
            continue;
        }

        int nib = from_hex(c);
        if (nib < 0) {
            return false;
        }

        if (pending < 0) {
            pending = nib;
        } else {
            if (written >= max_len) {
                return false;
            }
            out[written++] = (uint8_t)((pending << 4) | nib);
            pending = -1;
        }
    }

    if (pending >= 0) {
        return false;
    }

    *out_len = written;
    return true;
}
