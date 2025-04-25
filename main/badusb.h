#ifndef BADUSB_H
#define BADUSB_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize the BadUSB HID keyboard emulation.
 *
 * @return 0 on success, negative on error.
 */
int badusb_init(void);

/**
 * @brief Deinitialize the BadUSB HID keyboard emulation.
 */
void badusb_deinit(void);

/**
 * @brief Send a HID keyboard report (press or release keys).
 *
 * @param modifiers Modifier keys (bitmask, e.g., CTRL, SHIFT).
 * @param keycodes  Array of up to 6 keycodes (USB HID usage IDs).
 * @param key_count Number of keycodes in the array (max 6).
 * @return 0 on success, negative on error.
 */
int badusb_send_report(uint8_t modifiers, const uint8_t* keycodes, uint8_t key_count);

/**
 * @brief Send a string as keyboard input (ASCII to HID translation, blocking).
 *
 * @param str Null-terminated ASCII string.
 * @return 0 on success, negative on error.
 */
int badusb_send_string(const char* str);

/**
 * @brief Install and initialize the BadUSB HID keyboard emulation (TinyUSB driver).
 */
void badusb_install(void);

#ifdef __cplusplus
}
#endif

#endif // BADUSB_H 