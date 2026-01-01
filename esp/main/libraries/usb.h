/*
 * EMWaver Firmware - USB Interface
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

#ifndef USB_H
#define USB_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

void usb_register_commands(void);
void usb_install(void);
int usb_send_report(uint8_t modifiers, const uint8_t *keycodes, uint8_t key_count);
int usb_send_string(const char *str);
void usb_set_char_delay(uint32_t char_delay);

#ifdef __cplusplus
}
#endif

#endif // USB_H