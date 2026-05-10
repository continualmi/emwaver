#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

void transport_debug_register_commands(void);
bool transport_debug_is_enabled(void);
void transport_debug_log_lane(uint8_t source,
                              const char *direction,
                              const uint8_t *lane,
                              size_t lane_len);
