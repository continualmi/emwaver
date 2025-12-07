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