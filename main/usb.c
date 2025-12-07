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

static const char *TAG = "USB";

static bool usb_driver_installed = false;
static void usb_command(const char *action, const char *data);

// Delays in milliseconds - press release is fixed, character delay is configurable
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

// Basic ASCII to HID keycode lookup table (US QWERTY layout)
// Needs expansion for full character set and handling modifiers (Shift)
const uint8_t ascii_to_hid[128][2] = {
    {0, 0},             // NUL
    {0, 0},             // SOH
    {0, 0},             // STX
    {0, 0},             // ETX
    {0, 0},             // EOT
    {0, 0},             // ENQ
    {0, 0},             // ACK
    {0, 0},             // BEL
    {HID_KEY_BACKSPACE, 0}, // BS BACKSPACE
    {HID_KEY_TAB, 0},       // TAB
    {HID_KEY_ENTER, 0},     // LF ENTER
    {0, 0},             // VT
    {0, 0},             // FF
    {HID_KEY_ENTER, 0},     // CR ENTER
    {0, 0},             // SO
    {0, 0},             // SI
    {0, 0},             // DLE
    {0, 0},             // DC1
    {0, 0},             // DC2
    {0, 0},             // DC3
    {0, 0},             // DC4
    {0, 0},             // NAK
    {0, 0},             // SYN
    {0, 0},             // ETB
    {0, 0},             // CAN
    {0, 0},             // EM
    {0, 0},             // SUB
    {HID_KEY_ESCAPE, 0},    // ESC
    {0, 0},             // FS
    {0, 0},             // GS
    {0, 0},             // RS
    {0, 0},             // US

    {HID_KEY_SPACE, 0}, // ' '
    {HID_KEY_1, KEYBOARD_MODIFIER_LEFTSHIFT}, // !
    {HID_KEY_APOSTROPHE, KEYBOARD_MODIFIER_LEFTSHIFT}, // "
    {HID_KEY_3, KEYBOARD_MODIFIER_LEFTSHIFT}, // #
    {HID_KEY_4, KEYBOARD_MODIFIER_LEFTSHIFT}, // $
    {HID_KEY_5, KEYBOARD_MODIFIER_LEFTSHIFT}, // %
    {HID_KEY_7, KEYBOARD_MODIFIER_LEFTSHIFT}, // &
    {HID_KEY_APOSTROPHE, 0}, // '
    {HID_KEY_9, KEYBOARD_MODIFIER_LEFTSHIFT}, // (
    {HID_KEY_0, KEYBOARD_MODIFIER_LEFTSHIFT}, // )
    {HID_KEY_8, KEYBOARD_MODIFIER_LEFTSHIFT}, // *
    {HID_KEY_EQUAL, KEYBOARD_MODIFIER_LEFTSHIFT}, // +
    {HID_KEY_COMMA, 0}, // ,
    {HID_KEY_MINUS, 0}, // -
    {HID_KEY_PERIOD, 0}, // .
    {HID_KEY_SLASH, 0}, // /
    {HID_KEY_0, 0}, // 0
    {HID_KEY_1, 0}, // 1
    {HID_KEY_2, 0}, // 2
    {HID_KEY_3, 0}, // 3
    {HID_KEY_4, 0}, // 4
    {HID_KEY_5, 0}, // 5
    {HID_KEY_6, 0}, // 6
    {HID_KEY_7, 0}, // 7
    {HID_KEY_8, 0}, // 8
    {HID_KEY_9, 0}, // 9
    {HID_KEY_SEMICOLON, KEYBOARD_MODIFIER_LEFTSHIFT}, // :
    {HID_KEY_SEMICOLON, 0}, // ;
    {HID_KEY_COMMA, KEYBOARD_MODIFIER_LEFTSHIFT}, // <
    {HID_KEY_EQUAL, 0}, // =
    {HID_KEY_PERIOD, KEYBOARD_MODIFIER_LEFTSHIFT}, // >
    {HID_KEY_SLASH, KEYBOARD_MODIFIER_LEFTSHIFT}, // ?
    {HID_KEY_2, KEYBOARD_MODIFIER_LEFTSHIFT}, // @
    {HID_KEY_A, KEYBOARD_MODIFIER_LEFTSHIFT}, // A
    {HID_KEY_B, KEYBOARD_MODIFIER_LEFTSHIFT}, // B
    {HID_KEY_C, KEYBOARD_MODIFIER_LEFTSHIFT}, // C
    {HID_KEY_D, KEYBOARD_MODIFIER_LEFTSHIFT}, // D
    {HID_KEY_E, KEYBOARD_MODIFIER_LEFTSHIFT}, // E
    {HID_KEY_F, KEYBOARD_MODIFIER_LEFTSHIFT}, // F
    {HID_KEY_G, KEYBOARD_MODIFIER_LEFTSHIFT}, // G
    {HID_KEY_H, KEYBOARD_MODIFIER_LEFTSHIFT}, // H
    {HID_KEY_I, KEYBOARD_MODIFIER_LEFTSHIFT}, // I
    {HID_KEY_J, KEYBOARD_MODIFIER_LEFTSHIFT}, // J
    {HID_KEY_K, KEYBOARD_MODIFIER_LEFTSHIFT}, // K
    {HID_KEY_L, KEYBOARD_MODIFIER_LEFTSHIFT}, // L
    {HID_KEY_M, KEYBOARD_MODIFIER_LEFTSHIFT}, // M
    {HID_KEY_N, KEYBOARD_MODIFIER_LEFTSHIFT}, // N
    {HID_KEY_O, KEYBOARD_MODIFIER_LEFTSHIFT}, // O
    {HID_KEY_P, KEYBOARD_MODIFIER_LEFTSHIFT}, // P
    {HID_KEY_Q, KEYBOARD_MODIFIER_LEFTSHIFT}, // Q
    {HID_KEY_R, KEYBOARD_MODIFIER_LEFTSHIFT}, // R
    {HID_KEY_S, KEYBOARD_MODIFIER_LEFTSHIFT}, // S
    {HID_KEY_T, KEYBOARD_MODIFIER_LEFTSHIFT}, // T
    {HID_KEY_U, KEYBOARD_MODIFIER_LEFTSHIFT}, // U
    {HID_KEY_V, KEYBOARD_MODIFIER_LEFTSHIFT}, // V
    {HID_KEY_W, KEYBOARD_MODIFIER_LEFTSHIFT}, // W
    {HID_KEY_X, KEYBOARD_MODIFIER_LEFTSHIFT}, // X
    {HID_KEY_Y, KEYBOARD_MODIFIER_LEFTSHIFT}, // Y
    {HID_KEY_Z, KEYBOARD_MODIFIER_LEFTSHIFT}, // Z
    {HID_KEY_BRACKET_LEFT, 0}, // [
    {HID_KEY_BACKSLASH, 0}, // backslash
    {HID_KEY_BRACKET_RIGHT, 0}, // ]
    {HID_KEY_6, KEYBOARD_MODIFIER_LEFTSHIFT}, // ^
    {HID_KEY_MINUS, KEYBOARD_MODIFIER_LEFTSHIFT}, // _
    {HID_KEY_GRAVE, 0}, // `
    {HID_KEY_A, 0}, // a
    {HID_KEY_B, 0}, // b
    {HID_KEY_C, 0}, // c
    {HID_KEY_D, 0}, // d
    {HID_KEY_E, 0}, // e
    {HID_KEY_F, 0}, // f
    {HID_KEY_G, 0}, // g
    {HID_KEY_H, 0}, // h
    {HID_KEY_I, 0}, // i
    {HID_KEY_J, 0}, // j
    {HID_KEY_K, 0}, // k
    {HID_KEY_L, 0}, // l
    {HID_KEY_M, 0}, // m
    {HID_KEY_N, 0}, // n
    {HID_KEY_O, 0}, // o
    {HID_KEY_P, 0}, // p
    {HID_KEY_Q, 0}, // q
    {HID_KEY_R, 0}, // r
    {HID_KEY_S, 0}, // s
    {HID_KEY_T, 0}, // t
    {HID_KEY_U, 0}, // u
    {HID_KEY_V, 0}, // v
    {HID_KEY_W, 0}, // w
    {HID_KEY_X, 0}, // x
    {HID_KEY_Y, 0}, // y
    {HID_KEY_Z, 0}, // z
    {HID_KEY_BRACKET_LEFT, KEYBOARD_MODIFIER_LEFTSHIFT}, // {
    {HID_KEY_BACKSLASH, KEYBOARD_MODIFIER_LEFTSHIFT}, // |
    {HID_KEY_BRACKET_RIGHT, KEYBOARD_MODIFIER_LEFTSHIFT}, // }
    {HID_KEY_GRAVE, KEYBOARD_MODIFIER_LEFTSHIFT}, // ~
    {0, 0}              // DEL
};

// --- Descriptors for Keyboard HID --- //

#define TUSB_DESC_TOTAL_LEN (TUD_CONFIG_DESC_LEN + TUD_HID_DESC_LEN)

/**
 * @brief HID report descriptor (Keyboard only)
 */
static const uint8_t kbd_hid_report_descriptor[] = {
    TUD_HID_REPORT_DESC_KEYBOARD()
};

/**
 * @brief String descriptor
 */
static const char* kbd_hid_string_descriptor[] = {
    // array of pointer to string descriptors
    (char[]){0x09, 0x04},          // 0: is supported language is English (0x0409)
    "EMWaver",                 // 1: Manufacturer
    "EMWaver BadUSB Keyboard", // 2: Product
    "123456",                  // 3: Serials, should use chip ID
    "Keyboard Interface",      // 4: HID
};

/**
 * @brief Configuration descriptor (Keyboard only)
 */
static const uint8_t kbd_hid_configuration_descriptor[] = {
    // Config number, interface count, string index, total length, attribute, power in mA
    TUD_CONFIG_DESCRIPTOR(1, 1, 0, TUSB_DESC_TOTAL_LEN, TUSB_DESC_CONFIG_ATT_REMOTE_WAKEUP, 100),

    // Interface number, string index, boot protocol KBD, report descriptor len, EP In address, size & polling interval
    TUD_HID_DESCRIPTOR(0, 4, false, sizeof(kbd_hid_report_descriptor), 0x81, 16, 10),
};

/**
 * @brief Install TinyUSB driver for BadUSB Keyboard
 */
void usb_install(void)
{
    if (usb_driver_installed) {
        ESP_LOGW(TAG, "usb: driver already installed");
        return;
    }

    ESP_LOGI(TAG, "usb: initialization");
    const tinyusb_config_t tusb_cfg = {
        .device_descriptor = NULL, // Use default
        .string_descriptor = kbd_hid_string_descriptor,
        .string_descriptor_count = sizeof(kbd_hid_string_descriptor) / sizeof(kbd_hid_string_descriptor[0]),
        .external_phy = false,
        .configuration_descriptor = kbd_hid_configuration_descriptor,
#if (TUD_OPT_HIGH_SPEED)
        .hs_configuration_descriptor = kbd_hid_configuration_descriptor,
        .qualifier_descriptor = NULL,
#endif // TUD_OPT_HIGH_SPEED
    };

    ESP_ERROR_CHECK(tinyusb_driver_install(&tusb_cfg));
    usb_driver_installed = true;
    ESP_LOGI(TAG, "usb: initialization done");
}

int usb_send_report(uint8_t modifiers, const uint8_t *keycodes, uint8_t key_count)
{
    if (!usb_driver_installed) {
        ESP_LOGE(TAG, "usb: driver not installed");
        return -1;
    }

    uint8_t report_codes[6] = {0};
    uint8_t count = (key_count > 6) ? 6 : key_count;
    if (keycodes && count > 0) {
        memcpy(report_codes, keycodes, count);
    }

    // Wait until HID is ready
    uint32_t start_ms = esp_log_timestamp();
    while (!tud_hid_ready()) {
        // Allow other tasks to run
        vTaskDelay(pdMS_TO_TICKS(10));
        // Timeout after 5 seconds
        if (esp_log_timestamp() - start_ms > 5000) {
            ESP_LOGE(TAG, "usb: HID interface timeout");
            return -1; // Indicate timeout/error
        }
    }

    // Send the keyboard report directly
    return tud_hid_keyboard_report(0, modifiers, report_codes) ? 0 : -1;
}

int usb_send_string(const char *str)
{
    if (!usb_driver_installed) {
        ESP_LOGE(TAG, "usb: driver not installed");
        return -1;
    }

    // Check if USB is mounted
    if (!tud_mounted()) {
        ESP_LOGE(TAG, "usb: not mounted by host");
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
            // Send key press report using the direct TinyUSB function
            ESP_LOGI(TAG, "usb: keycode 0x%02X modifier 0x%02X '%c'",
                     keycode[0], modifier, c);
            
            // Send key press
            tud_hid_keyboard_report(0, modifier, keycode);
            
            // Fixed minimal delay between press and release
            vTaskDelay(pdMS_TO_TICKS(usb_press_delay_ms));
            
            // Send key release report using NULL keycodes (all keys up)
            tud_hid_keyboard_report(0, 0, NULL);
            
            // Configurable delay between characters
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
            ESP_LOGI(TAG, "usb: delay %d ms", delay_ms);
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

// --- TinyUSB HID required callbacks for keyboard emulation ---
// Callback to provide the HID report descriptor
uint8_t const * tud_hid_descriptor_report_cb(uint8_t instance)
{
    (void)instance; // Only one instance
    return kbd_hid_report_descriptor; // Return keyboard descriptor
}

// Callback for GET_REPORT (not used, just return zero)
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

// Callback for SET_REPORT (not used, just ignore)
void tud_hid_set_report_cb(uint8_t instance, uint8_t report_id,
                           hid_report_type_t report_type,
                           uint8_t const* buffer, uint16_t bufsize)
{
    (void) instance;
    (void) report_id;
    (void) report_type;
    (void) buffer;
    (void) bufsize;
    // No action needed for keyboard
} 