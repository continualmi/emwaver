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

#ifndef COMMAND_REGISTRY_H
#define COMMAND_REGISTRY_H

#include <stddef.h>
#include <stdbool.h>
#include <stdint.h>

#define CLI_VERB_MAX 16
#define CLI_KEY_MAX 16
#define CLI_VALUE_MAX 64
#define CLI_MAX_ARGS 10
#define CLI_MAX_POSITIONAL 16
#define CLI_COMMAND_BUFFER 256
#define CLI_RESPONSE_MAX 512

typedef struct {
    uint8_t data[256];
    uint16_t length;
} command_t;

typedef struct {
    const uint8_t *data;
    size_t length;
} command_hex_arg_t;

typedef enum {
    CMD_ARG_DONE = 0,
    CMD_ARG_INT,
    CMD_ARG_STRING,
    CMD_ARG_HEX,
    CMD_ARG_BOOL,
} cmd_arg_type_t;

typedef struct {
    const char *name;      // flag name, NULL terminates list
    cmd_arg_type_t type;
    bool required;
} cmd_arg_spec_t;

void command_registry_init(void);
bool register_command(const char *verb,
                      void *handler,
                      const cmd_arg_spec_t *args);

bool command_registry_is_ascii(const command_t *cmd);
void command_registry_handle(const command_t *cmd);

void command_send_ok(const uint8_t *data, size_t len);
void command_send_err(const char *msg);

#endif /* COMMAND_REGISTRY_H */
