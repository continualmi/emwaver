#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "command_registry.h"

#define EMW_TRANSPORT_SOURCE_NONE EMW_COMMAND_SOURCE_UNKNOWN

#define EMW_TRANSPORT_SESSION_STATUS 0x00u
#define EMW_TRANSPORT_SESSION_CONNECT 0x01u
#define EMW_TRANSPORT_SESSION_DISCONNECT 0x02u
#define EMW_TRANSPORT_SESSION_HEARTBEAT 0x03u

bool transport_session_allows_command(const command_t *cmd);
bool transport_session_allows_stream(uint8_t source);
uint8_t transport_session_active_source(void);
bool transport_session_connect(uint8_t source);
bool transport_session_disconnect(uint8_t source);
bool transport_session_heartbeat(uint8_t source);
