/*
 * Historical USB HID / BadUSB implementation preserved for future exploration.
 *
 * This file is intentionally not compiled in the active USB-MIDI bring-up path.
 * The current transport direction for ESP32-S3 is USB MIDI with STM32-style
 * EMWaver SysEx framing. If HID-based features return later, this file is the
 * starting point instead of reconstructing the old implementation from git.
 */

#include "usb.h"

#include <stdlib.h>
#include <string.h>

#include "class/hid/hid_device.h"
#include "command_registry.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "tinyusb.h"
#include "tusb.h"

static const char *TAG = "USB_HID_LEGACY";

static bool usb_driver_installed = false;
static void usb_command(const char *action, const char *data);

static const uint32_t usb_press_delay_ms = 10;
static uint32_t usb_char_delay_ms = 10;

void usb_register_commands(void)
{
    bool ok = register_command(
        "usb",
        (void *)usb_command,
        (const cmd_arg_spec_t[]){
            {NULL, CMD_ARG_STRING, true},
            {NULL, CMD_ARG_STRING, false},
            {NULL, CMD_ARG_DONE, false},
        });

    if (!ok) {
        ESP_LOGE(TAG, "usb: register failed");
    }
}

void usb_set_char_delay(uint32_t char_delay)
{
    usb_char_delay_ms = char_delay;
    ESP_LOGI(TAG, "usb: character delay %lu ms", (unsigned long)char_delay);
}

const uint8_t ascii_to_hid[128][2] = {
    {0, 0}, {0, 0}, {0, 0}, {0, 0}, {0, 0}, {0, 0}, {0, 0}, {0, 0},
    {HID_KEY_BACKSPACE, 0}, {HID_KEY_TAB, 0}, {HID_KEY_ENTER, 0}, {0, 0},
    {0, 0}, {HID_KEY_ENTER, 0}, {0, 0}, {0, 0}, {0, 0}, {0, 0}, {0, 0}, {0, 0},
    {0, 0}, {0, 0}, {0, 0}, {0, 0}, {0, 0}, {0, 0}, {0, 0}, {HID_KEY_ESCAPE, 0},
    {0, 0}, {0, 0}, {0, 0}, {0, 0},

    {HID_KEY_SPACE, 0},
    {HID_KEY_1, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_APOSTROPHE, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_3, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_4, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_5, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_7, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_APOSTROPHE, 0},
    {HID_KEY_9, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_0, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_8, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_EQUAL, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_COMMA, 0},
    {HID_KEY_MINUS, 0},
    {HID_KEY_PERIOD, 0},
    {HID_KEY_SLASH, 0},
    {HID_KEY_0, 0}, {HID_KEY_1, 0}, {HID_KEY_2, 0}, {HID_KEY_3, 0},
    {HID_KEY_4, 0}, {HID_KEY_5, 0}, {HID_KEY_6, 0}, {HID_KEY_7, 0},
    {HID_KEY_8, 0}, {HID_KEY_9, 0},
    {HID_KEY_SEMICOLON, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_SEMICOLON, 0},
    {HID_KEY_COMMA, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_EQUAL, 0},
    {HID_KEY_PERIOD, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_SLASH, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_2, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_A, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_B, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_C, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_D, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_E, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_F, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_G, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_H, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_I, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_J, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_K, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_L, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_M, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_N, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_O, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_P, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_Q, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_R, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_S, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_T, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_U, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_V, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_W, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_X, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_Y, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_Z, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_BRACKET_LEFT, 0},
    {HID_KEY_BACKSLASH, 0},
    {HID_KEY_BRACKET_RIGHT, 0},
    {HID_KEY_6, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_MINUS, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_GRAVE, 0},
    {HID_KEY_A, 0}, {HID_KEY_B, 0}, {HID_KEY_C, 0}, {HID_KEY_D, 0},
    {HID_KEY_E, 0}, {HID_KEY_F, 0}, {HID_KEY_G, 0}, {HID_KEY_H, 0},
    {HID_KEY_I, 0}, {HID_KEY_J, 0}, {HID_KEY_K, 0}, {HID_KEY_L, 0},
    {HID_KEY_M, 0}, {HID_KEY_N, 0}, {HID_KEY_O, 0}, {HID_KEY_P, 0},
    {HID_KEY_Q, 0}, {HID_KEY_R, 0}, {HID_KEY_S, 0}, {HID_KEY_T, 0},
    {HID_KEY_U, 0}, {HID_KEY_V, 0}, {HID_KEY_W, 0}, {HID_KEY_X, 0},
    {HID_KEY_Y, 0}, {HID_KEY_Z, 0},
    {HID_KEY_BRACKET_LEFT, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_BACKSLASH, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_BRACKET_RIGHT, KEYBOARD_MODIFIER_LEFTSHIFT},
    {HID_KEY_GRAVE, KEYBOARD_MODIFIER_LEFTSHIFT},
    {0, 0}
};

#define TUSB_DESC_TOTAL_LEN (TUD_CONFIG_DESC_LEN + TUD_HID_DESC_LEN)

static const uint8_t kbd_hid_report_descriptor[] = {
    TUD_HID_REPORT_DESC_KEYBOARD()
};

static const char* kbd_hid_string_descriptor[] = {
    (char[]){0x09, 0x04},
    "EMWaver",
    "EMWaver BadUSB Keyboard",
    "123456",
    "Keyboard Interface",
};

static const uint8_t kbd_hid_configuration_descriptor[] = {
    TUD_CONFIG_DESCRIPTOR(1, 1, 0, TUSB_DESC_TOTAL_LEN, TUSB_DESC_CONFIG_ATT_REMOTE_WAKEUP, 100),
    TUD_HID_DESCRIPTOR(0, 4, false, sizeof(kbd_hid_report_descriptor), 0x81, 16, 10),
};

void usb_install(void)
{
    if (usb_driver_installed) {
        ESP_LOGW(TAG, "usb: driver already installed");
        return;
    }

    const tinyusb_config_t tusb_cfg = {
        .device_descriptor = NULL,
        .string_descriptor = kbd_hid_string_descriptor,
        .string_descriptor_count = sizeof(kbd_hid_string_descriptor) / sizeof(kbd_hid_string_descriptor[0]),
        .external_phy = false,
        .configuration_descriptor = kbd_hid_configuration_descriptor,
#if (TUD_OPT_HIGH_SPEED)
        .hs_configuration_descriptor = kbd_hid_configuration_descriptor,
        .qualifier_descriptor = NULL,
#endif
    };

    ESP_ERROR_CHECK(tinyusb_driver_install(&tusb_cfg));
    usb_driver_installed = true;
}

int usb_send_report(uint8_t modifiers, const uint8_t *keycodes, uint8_t key_count)
{
    if (!usb_driver_installed) {
        return -1;
    }

    uint8_t report_codes[6] = {0};
    uint8_t count = (key_count > 6) ? 6 : key_count;
    if (keycodes && count > 0) {
        memcpy(report_codes, keycodes, count);
    }

    uint32_t start_ms = esp_log_timestamp();
    while (!tud_hid_ready()) {
        vTaskDelay(pdMS_TO_TICKS(10));
        if (esp_log_timestamp() - start_ms > 5000) {
            return -1;
        }
    }

    return tud_hid_keyboard_report(0, modifiers, report_codes) ? 0 : -1;
}

int usb_send_string(const char *str)
{
    if (!usb_driver_installed || !tud_mounted()) {
        return -1;
    }

    while (*str) {
        char c = *str++;
        uint8_t keycode[6] = {0};
        uint8_t modifier = 0;

        if ((uint8_t)c < 128) {
            keycode[0] = ascii_to_hid[(uint8_t)c][0];
            modifier = ascii_to_hid[(uint8_t)c][1];
        }

        if (keycode[0] != 0) {
            tud_hid_keyboard_report(0, modifier, keycode);
            vTaskDelay(pdMS_TO_TICKS(usb_press_delay_ms));
            tud_hid_keyboard_report(0, 0, NULL);
            vTaskDelay(pdMS_TO_TICKS(usb_char_delay_ms));
        }
    }

    return 0;
}

static void usb_command(const char *action, const char *data)
{
    if (!action || action[0] == '\0') {
        command_send_err("usb: action");
        return;
    }

    if (!data) {
        data = "";
    }

    if (strcmp(action, "ATTACKMODE") == 0) {
        usb_install();
        command_send_ok(NULL, 0);
        return;
    }

    if (strcmp(action, "STRING_DELAY") == 0) {
        int delay_ms = atoi(data);
        if (delay_ms > 0 && delay_ms < 1000) {
            usb_set_char_delay(delay_ms);
            command_send_ok(NULL, 0);
        } else {
            command_send_err("usb: delay");
        }
        return;
    }

    if (strcmp(action, "STRING") == 0) {
        if (data[0] == '\0') {
            command_send_err("usb: string");
            return;
        }
        usb_install();
        usb_send_string(data);
        command_send_ok(NULL, 0);
        return;
    }

    if (strcmp(action, "DELAY") == 0) {
        command_send_ok(NULL, 0);
        return;
    }

    if (strcmp(action, "ENTER") == 0) {
        usb_install();
        usb_send_string("\n");
        command_send_ok(NULL, 0);
        return;
    }

    usb_install();
    usb_send_string(action);
    if (data[0] != '\0') {
        usb_send_string(" ");
        usb_send_string(data);
    }
    command_send_ok(NULL, 0);
}

uint8_t const * tud_hid_descriptor_report_cb(uint8_t instance)
{
    (void)instance;
    return kbd_hid_report_descriptor;
}

uint16_t tud_hid_get_report_cb(uint8_t instance, uint8_t report_id,
                               hid_report_type_t report_type,
                               uint8_t* buffer, uint16_t reqlen)
{
    (void) instance;
    (void) report_id;
    (void) report_type;
    (void) buffer;
    (void) reqlen;
    return 0;
}

void tud_hid_set_report_cb(uint8_t instance, uint8_t report_id,
                           hid_report_type_t report_type,
                           uint8_t const* buffer, uint16_t bufsize)
{
    (void) instance;
    (void) report_id;
    (void) report_type;
    (void) buffer;
    (void) bufsize;
}
