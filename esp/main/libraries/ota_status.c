/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#include "ota_status.h"

#include <string.h>

#include "ble_server.h"

static uint16_t g_status_attr_handle;

void ota_status_init(void)
{
    g_status_attr_handle = 0;
}

void ota_status_set_attr_handle(uint16_t attr_handle)
{
    g_status_attr_handle = attr_handle;
}

void ota_status_notify(uint8_t status_code, uint8_t err_code, uint32_t received, uint32_t total)
{
    if (g_status_attr_handle == 0) {
        return;
    }

    uint8_t packet[14];
    packet[0] = 'O';
    packet[1] = 'T';
    packet[2] = 'A';
    packet[3] = 1; /* protocol version */
    packet[4] = status_code;

    packet[5] = (uint8_t)(received & 0xFF);
    packet[6] = (uint8_t)((received >> 8) & 0xFF);
    packet[7] = (uint8_t)((received >> 16) & 0xFF);
    packet[8] = (uint8_t)((received >> 24) & 0xFF);

    packet[9] = (uint8_t)(total & 0xFF);
    packet[10] = (uint8_t)((total >> 8) & 0xFF);
    packet[11] = (uint8_t)((total >> 16) & 0xFF);
    packet[12] = (uint8_t)((total >> 24) & 0xFF);

    packet[13] = err_code;

    (void)ble_server_notify_attr(g_status_attr_handle, packet, sizeof(packet));
}

