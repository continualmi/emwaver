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

#include "sampler.h"

#include <limits.h>
#include <stdlib.h>
#include <string.h>

#include "ble_server.h"
#include "command_registry.h"
#include "driver/gpio.h"
#include "driver/ledc.h"
#include "driver/timer.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_intr_alloc.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "hal/ledc_ll.h"
#include "soc/timer_group_reg.h"
#include "soc/timer_group_struct.h"

#define SAMPLER_BUFFER_SIZE 256
#define SAMPLER_TIMER_GROUP TIMER_GROUP_0
#define SAMPLER_TIMER TIMER_0
#define TRANSMIT_TIMER TIMER_1
#define SAMPLER_TIMER_INTERVAL_US 10
#define TRANSMIT_INTERVAL_US 10
#define TRANSMISSION_TIMEOUT_MS 2000
#define TRANSMISSION_IDLE_EXIT_MS 100
#define MONITOR_CHECK_INTERVAL_MS 10
#define BLE_RX_BUFFER_SIZE 4096
#define TRANSMIT_PWM_DEFAULT_FREQ_HZ 38000
#define TRANSMIT_PWM_DEFAULT_DUTY_PERCENT 50
#define TRANSMIT_PWM_MAX_FREQ_HZ 1000000
#define TRANSMIT_PWM_MIN_FREQ_HZ 1

static const char *TAG = "SAMPLER";

static volatile uint8_t *buffer_a = NULL;
static volatile uint8_t *buffer_b = NULL;
static volatile uint8_t *current_buffer = NULL;
static volatile uint8_t *transmit_buffer = NULL;
static volatile int buffer_index = 0;
static SemaphoreHandle_t buffer_ready_sem = NULL;
static TaskHandle_t sampler_task_handle = NULL;

static intr_handle_t sampling_timer_isr_handle = NULL;
static intr_handle_t transmission_timer_isr_handle = NULL;
static TaskHandle_t transmission_monitor_task_handle = NULL;

static uint16_t sampler_pin = 0;
static bool sampling_active = false;
static bool transmission_active = false;

static void sampler_start_command(int pin);
static void sampler_stop_command(void);
static void transmit_start_command(int pin, bool pwm, int freq_hz, int duty_percent);
static void transmit_stop_command(void);
static void sampler_task(void *pv_parameters);
static void transmission_monitor_task(void *pv_parameters);

static void IRAM_ATTR sampling_isr(void *arg);
static void IRAM_ATTR transmission_isr(void *arg);
static bool sampler_start_impl(int pin, const char **err_msg);
static bool sampler_stop_impl(const char **err_msg);
static bool transmit_start_impl(int pin, bool pwm, int freq_hz, int duty_percent, const char **err_msg);
static bool transmit_stop_impl(const char **err_msg);

static bool transmit_pwm_configure(gpio_num_t gpio, uint32_t freq_hz, uint8_t duty_percent, const char **err_msg);
static void transmit_pwm_set_enabled_isr(bool enabled);
static void transmit_pwm_stop(void);

static bool transmit_use_pwm = false;
static uint32_t transmit_pwm_freq_hz = TRANSMIT_PWM_DEFAULT_FREQ_HZ;
static uint8_t transmit_pwm_duty_percent = TRANSMIT_PWM_DEFAULT_DUTY_PERCENT;
static bool transmit_pwm_configured = false;
static bool transmit_pwm_enabled_state = false;
static ledc_mode_t transmit_ledc_speed_mode = LEDC_LOW_SPEED_MODE;
static ledc_timer_t transmit_ledc_timer = LEDC_TIMER_0;
static ledc_channel_t transmit_ledc_channel = LEDC_CHANNEL_0;

void sampler_module_init(void)
{
    buffer_ready_sem = NULL;
    sampler_task_handle = NULL;
    sampling_timer_isr_handle = NULL;
    transmission_timer_isr_handle = NULL;
    transmission_monitor_task_handle = NULL;
    sampling_active = false;
    transmission_active = false;

    transmit_use_pwm = false;
    transmit_pwm_freq_hz = TRANSMIT_PWM_DEFAULT_FREQ_HZ;
    transmit_pwm_duty_percent = TRANSMIT_PWM_DEFAULT_DUTY_PERCENT;
    transmit_pwm_configured = false;
    transmit_pwm_enabled_state = false;
}

void sampler_register_commands(void)
{
    bool ok = true;
    ok &= register_command(
        "sample start",
        (void *)sampler_start_command,
        (const cmd_arg_spec_t[]){
            {"pin", CMD_ARG_INT, true},
            {NULL, CMD_ARG_DONE, false},
        });
    ok &= register_command(
        "sample stop",
        (void *)sampler_stop_command,
        (const cmd_arg_spec_t[]){
            {NULL, CMD_ARG_DONE, false},
        });
    ok &= register_command(
        "transmit start",
        (void *)transmit_start_command,
        (const cmd_arg_spec_t[]){
            {"pin", CMD_ARG_INT, true},
            {"pwm", CMD_ARG_BOOL, false},
            {"freq", CMD_ARG_INT, false},
            {"duty", CMD_ARG_INT, false},
            {NULL, CMD_ARG_DONE, false},
        });
    ok &= register_command(
        "transmit stop",
        (void *)transmit_stop_command,
        (const cmd_arg_spec_t[]){
            {NULL, CMD_ARG_DONE, false},
        });
    if (!ok) {
        ESP_LOGE(TAG, "failed to register sampler commands");
    }
}

bool sampler_is_sampling(void)
{
    return sampling_active;
}

bool sampler_is_transmitting(void)
{
    return transmission_active;
}

void sampler_stop_all(void)
{
    sampler_stop_sampling();
    sampler_stop_transmission();
}

static void configure_timer(timer_group_t group,
                            timer_idx_t timer,
                            uint32_t interval_us,
                            bool auto_reload)
{
    timer_config_t config = {
        .divider = 80,
        .counter_dir = TIMER_COUNT_UP,
        .counter_en = TIMER_PAUSE,
        .alarm_en = TIMER_ALARM_EN,
        .auto_reload = auto_reload,
    };

    timer_init(group, timer, &config);
    timer_set_counter_value(group, timer, 0);
    timer_set_alarm_value(group, timer, interval_us);
    timer_enable_intr(group, timer);
}

static void sampler_start_command(int pin)
{
    const char *err = NULL;
    if (sampler_start_impl(pin, &err)) {
        // Sampler streaming is started in fire-and-forget mode; do not emit a command
        // response packet to avoid contaminating the capture stream on the client.
        // Errors are logged; clients should infer failure by lack of stream data.
    } else {
        ESP_LOGW(TAG, "sample start failed: %s", err ? err : "unknown");
    }
}

static void sampler_stop_command(void)
{
    const char *err = NULL;
    if (sampler_stop_impl(&err)) {
        // Fire-and-forget (see sampler_start_command).
    } else {
        ESP_LOGW(TAG, "sample stop failed: %s", err ? err : "unknown");
    }
}

static void transmit_start_command(int pin, bool pwm, int freq_hz, int duty_percent)
{
    const char *err = NULL;
    if (transmit_start_impl(pin, pwm, freq_hz, duty_percent, &err)) {
        // Fire-and-forget: do not emit ok/err responses. During retransmission the
        // client expects the notification channel to be reserved for BS flow-control
        // packets (and for sampler streaming), not command-response framing.
    } else {
        ESP_LOGW(TAG, "transmit start failed: %s", err ? err : "unknown");
    }
}

static void transmit_stop_command(void)
{
    const char *err = NULL;
    if (transmit_stop_impl(&err)) {
        // Fire-and-forget (see transmit_start_command).
    } else {
        ESP_LOGW(TAG, "transmit stop failed: %s", err ? err : "unknown");
    }
}

static void sampler_task(void *pv_parameters)
{
    bool stop_requested = false;

    while (!stop_requested) {
        uint32_t notification = 0;
        if (xTaskNotifyWait(0, ULONG_MAX, &notification, 0) == pdTRUE) {
            if (notification == 1) {
                stop_requested = true;
                break;
            }
        }

        if (buffer_ready_sem && xSemaphoreTake(buffer_ready_sem, pdMS_TO_TICKS(1)) == pdTRUE) {
            if (transmit_buffer) {
                ble_server_notify((uint8_t *)transmit_buffer, SAMPLER_BUFFER_SIZE);
                vTaskDelay(pdMS_TO_TICKS(15));
            }
        } else {
            vTaskDelay(pdMS_TO_TICKS(1));
        }
    }

    sampler_task_handle = NULL;
    if (buffer_ready_sem) {
        vSemaphoreDelete(buffer_ready_sem);
        buffer_ready_sem = NULL;
    }

    vTaskDelete(NULL);
}

static void transmission_monitor_task(void *pv_parameters)
{
    uint16_t last_bytes_available = 0;
    uint16_t current_bytes_available = 0;
    uint32_t unchanged_time_ms = 0;
    uint32_t idle_zero_time_ms = 0;
    uint32_t fill_wait_time_ms = 0;
    bool timer_started = false;

    while (transmission_active) {
        current_bytes_available = ble_get_rx_bytes_available();

        if (!timer_started) {
            // Match STM32 semantics: wait for a small initial fill (or timeout),
            // then start draining the circular RX buffer in the transmit ISR.
            if (current_bytes_available >= 1000 || fill_wait_time_ms >= TRANSMISSION_TIMEOUT_MS) {
                timer_start(SAMPLER_TIMER_GROUP, TRANSMIT_TIMER);
                timer_started = true;
                unchanged_time_ms = 0;
                idle_zero_time_ms = 0;
                last_bytes_available = current_bytes_available;
            } else {
                fill_wait_time_ms += MONITOR_CHECK_INTERVAL_MS;
            }
        }

        if (timer_started) {
            if (current_bytes_available == 0) {
                idle_zero_time_ms += MONITOR_CHECK_INTERVAL_MS;
                // Mimic STM32 behavior: once the RX ring has drained, leave transmitter
                // mode promptly so the command channel can resume normal parsing.
                if (idle_zero_time_ms >= TRANSMISSION_IDLE_EXIT_MS) {
                    ESP_LOGI(TAG, "Transmission complete (buffer drained)");
                    transmit_stop_impl(NULL);
                    break;
                }
            } else {
                idle_zero_time_ms = 0;
            }

            if (current_bytes_available != last_bytes_available) {
                unchanged_time_ms = 0;
                last_bytes_available = current_bytes_available;
            } else {
                unchanged_time_ms += MONITOR_CHECK_INTERVAL_MS;
                if (unchanged_time_ms >= TRANSMISSION_TIMEOUT_MS) {
                    ESP_LOGI(TAG, "Transmission timeout");
                    transmit_stop_impl(NULL);
                    break;
                }
            }
        }

        vTaskDelay(pdMS_TO_TICKS(MONITOR_CHECK_INTERVAL_MS));
    }

    transmission_monitor_task_handle = NULL;
    vTaskDelete(NULL);
}

static void IRAM_ATTR sampling_isr(void *arg)
{
    timer_group_clr_intr_status_in_isr(SAMPLER_TIMER_GROUP, SAMPLER_TIMER);

    static uint8_t bit_index = 0;
    static uint8_t current_byte = 0;

    uint8_t level = gpio_get_level(sampler_pin);
    if (level) {
        current_byte |= (1U << bit_index);
    } else {
        current_byte &= ~(1U << bit_index);
    }

    bit_index++;
    if (bit_index >= 8) {
        current_buffer[buffer_index] = current_byte;
        buffer_index++;
        bit_index = 0;
        current_byte = 0;

        if (buffer_index >= SAMPLER_BUFFER_SIZE) {
            transmit_buffer = current_buffer;
            current_buffer = (current_buffer == buffer_a) ? buffer_b : buffer_a;
            buffer_index = 0;
            BaseType_t woken = pdFALSE;
            if (buffer_ready_sem) {
                xSemaphoreGiveFromISR(buffer_ready_sem, &woken);
            }
            if (woken == pdTRUE) {
                portYIELD_FROM_ISR();
            }
        }
    }

    timer_group_enable_alarm_in_isr(SAMPLER_TIMER_GROUP, SAMPLER_TIMER);
}

static void IRAM_ATTR transmission_isr(void *arg)
{
    timer_group_clr_intr_status_in_isr(SAMPLER_TIMER_GROUP, TRANSMIT_TIMER);

    static uint8_t bit_index = 0;
    static uint8_t current_byte = 0;
    static bool need_new_byte = true;

    if (bit_index == 0 && need_new_byte) {
        if (ble_get_rx_bytes_available() > 0) {
            ble_read_rx_buffer(&current_byte, 1);
            need_new_byte = false;
        } else {
            gpio_set_level(sampler_pin, 0);
            timer_group_enable_alarm_in_isr(SAMPLER_TIMER_GROUP, TRANSMIT_TIMER);
            return;
        }
    }

    bool bit_set = (current_byte & (1U << bit_index)) != 0;
    if (transmit_use_pwm && transmit_pwm_configured) {
        transmit_pwm_set_enabled_isr(bit_set);
        if (!bit_set) {
            gpio_set_level(sampler_pin, 0);
        }
    } else {
        gpio_set_level(sampler_pin, bit_set ? 1 : 0);
    }

    bit_index++;
    if (bit_index >= 8) {
        bit_index = 0;
        need_new_byte = true;
    }

    timer_group_enable_alarm_in_isr(SAMPLER_TIMER_GROUP, TRANSMIT_TIMER);
}

static bool sampler_start_impl(int pin, const char **err_msg)
{
    if (err_msg) {
        *err_msg = NULL;
    }

    if (pin < 0) {
        if (err_msg) {
            *err_msg = "sample start: pin";
        }
        return false;
    }

    if (sampling_active) {
        if (err_msg) {
            *err_msg = "sample start: active";
        }
        return false;
    }

    gpio_config_t io_conf = {
        .pin_bit_mask = 1ULL << pin,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLUP_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);

    buffer_a = (uint8_t *)malloc(SAMPLER_BUFFER_SIZE);
    buffer_b = (uint8_t *)malloc(SAMPLER_BUFFER_SIZE);
    if (!buffer_a || !buffer_b) {
        free((void *)buffer_a);
        free((void *)buffer_b);
        buffer_a = buffer_b = NULL;
        if (err_msg) {
            *err_msg = "sample start: mem";
        }
        return false;
    }

    memset((void *)buffer_a, 0, SAMPLER_BUFFER_SIZE);
    memset((void *)buffer_b, 0, SAMPLER_BUFFER_SIZE);

    current_buffer = buffer_a;
    transmit_buffer = NULL;
    buffer_index = 0;
    sampler_pin = (uint16_t)pin;

    if (buffer_ready_sem == NULL) {
        buffer_ready_sem = xSemaphoreCreateBinary();
        if (!buffer_ready_sem) {
            free((void *)buffer_a);
            free((void *)buffer_b);
            buffer_a = buffer_b = NULL;
            if (err_msg) {
                *err_msg = "sample start: sem";
            }
            return false;
        }
    }

    configure_timer(SAMPLER_TIMER_GROUP, SAMPLER_TIMER, SAMPLER_TIMER_INTERVAL_US, true);

    esp_err_t err = timer_isr_register(SAMPLER_TIMER_GROUP,
                                       SAMPLER_TIMER,
                                       sampling_isr,
                                       NULL,
                                       ESP_INTR_FLAG_IRAM,
                                       &sampling_timer_isr_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "timer_isr_register failed: %s", esp_err_to_name(err));
        timer_disable_intr(SAMPLER_TIMER_GROUP, SAMPLER_TIMER);
        timer_pause(SAMPLER_TIMER_GROUP, SAMPLER_TIMER);
        free((void *)buffer_a);
        free((void *)buffer_b);
        buffer_a = buffer_b = NULL;
        current_buffer = NULL;
        transmit_buffer = NULL;
        buffer_index = 0;
        if (err_msg) {
            *err_msg = "sample start: isr";
        }
        return false;
    }

    timer_start(SAMPLER_TIMER_GROUP, SAMPLER_TIMER);

    if (sampler_task_handle == NULL) {
        if (xTaskCreate(sampler_task, "sampler", 4096, NULL, 5, &sampler_task_handle) != pdPASS) {
            timer_pause(SAMPLER_TIMER_GROUP, SAMPLER_TIMER);
            timer_disable_intr(SAMPLER_TIMER_GROUP, SAMPLER_TIMER);
            esp_intr_free(sampling_timer_isr_handle);
            sampling_timer_isr_handle = NULL;
            free((void *)buffer_a);
            free((void *)buffer_b);
            buffer_a = buffer_b = NULL;
            current_buffer = NULL;
            transmit_buffer = NULL;
            buffer_index = 0;
            if (err_msg) {
                *err_msg = "sample start: task";
            }
            return false;
        }
    }

    sampling_active = true;
    ESP_LOGI(TAG, "Sampling started on pin %d", pin);
    return true;
}

static bool sampler_stop_impl(const char **err_msg)
{
    if (err_msg) {
        *err_msg = NULL;
    }

    if (!sampling_active) {
        return true;
    }

    timer_pause(SAMPLER_TIMER_GROUP, SAMPLER_TIMER);
    timer_disable_intr(SAMPLER_TIMER_GROUP, SAMPLER_TIMER);

    if (sampling_timer_isr_handle) {
        esp_intr_free(sampling_timer_isr_handle);
        sampling_timer_isr_handle = NULL;
    }

    if (sampler_task_handle) {
        xTaskNotify(sampler_task_handle, 1, eSetValueWithOverwrite);
    }

    if (buffer_ready_sem) {
        xSemaphoreGive(buffer_ready_sem);
    }

    free((void *)buffer_a);
    free((void *)buffer_b);
    buffer_a = buffer_b = NULL;
    current_buffer = NULL;
    transmit_buffer = NULL;
    buffer_index = 0;

    sampling_active = false;
    ESP_LOGI(TAG, "Sampling stopped");
    return true;
}

static bool transmit_start_impl(int pin, bool pwm, int freq_hz, int duty_percent, const char **err_msg)
{
    if (err_msg) {
        *err_msg = NULL;
    }

    if (pin < 0) {
        if (err_msg) {
            *err_msg = "transmit start: pin";
        }
        return false;
    }

    if (transmission_active) {
        if (err_msg) {
            *err_msg = "transmit start: active";
        }
        return false;
    }

    uint32_t effective_freq_hz = transmit_pwm_freq_hz;
    uint8_t effective_duty_percent = transmit_pwm_duty_percent;

    if (freq_hz > 0) {
        if (freq_hz < TRANSMIT_PWM_MIN_FREQ_HZ || freq_hz > TRANSMIT_PWM_MAX_FREQ_HZ) {
            if (err_msg) {
                *err_msg = "transmit start: freq";
            }
            return false;
        }
        effective_freq_hz = (uint32_t)freq_hz;
    }

    if (duty_percent > 0) {
        if (duty_percent < 1 || duty_percent > 100) {
            if (err_msg) {
                *err_msg = "transmit start: duty";
            }
            return false;
        }
        effective_duty_percent = (uint8_t)duty_percent;
    }

    gpio_config_t io_conf = {
        .pin_bit_mask = 1ULL << pin,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_ENABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);

    sampler_pin = (uint16_t)pin;
    transmit_use_pwm = pwm;
    transmit_pwm_freq_hz = effective_freq_hz;
    transmit_pwm_duty_percent = effective_duty_percent;

    transmit_pwm_configured = false;
    if (transmit_use_pwm) {
        if (!transmit_pwm_configure((gpio_num_t)pin, transmit_pwm_freq_hz, transmit_pwm_duty_percent, err_msg)) {
            transmit_use_pwm = false;
            return false;
        }
    }

    ble_set_transmitter_mode(1);

    configure_timer(SAMPLER_TIMER_GROUP, TRANSMIT_TIMER, TRANSMIT_INTERVAL_US, true);

    esp_err_t err = timer_isr_register(SAMPLER_TIMER_GROUP,
                                       TRANSMIT_TIMER,
                                       transmission_isr,
                                       NULL,
                                       ESP_INTR_FLAG_IRAM,
                                       &transmission_timer_isr_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "transmit isr register failed: %s", esp_err_to_name(err));
        timer_disable_intr(SAMPLER_TIMER_GROUP, TRANSMIT_TIMER);
        timer_pause(SAMPLER_TIMER_GROUP, TRANSMIT_TIMER);
        ble_set_transmitter_mode(0);
        if (err_msg) {
            *err_msg = "transmit start: isr";
        }
        return false;
    }

    transmission_active = true;

    if (transmission_monitor_task_handle == NULL) {
        if (xTaskCreate(transmission_monitor_task, "tx_monitor", 4096, NULL, 5,
                        &transmission_monitor_task_handle) != pdPASS) {
            timer_pause(SAMPLER_TIMER_GROUP, TRANSMIT_TIMER);
            timer_disable_intr(SAMPLER_TIMER_GROUP, TRANSMIT_TIMER);
            esp_intr_free(transmission_timer_isr_handle);
            transmission_timer_isr_handle = NULL;
            ble_set_transmitter_mode(0);
            transmission_active = false;
            if (err_msg) {
                *err_msg = "transmit start: task";
            }
            return false;
        }
    }

    ESP_LOGI(TAG, "Transmission initialized on pin %d (pwm=%d freq=%lu duty=%u%%)",
             pin, transmit_use_pwm ? 1 : 0, (unsigned long)transmit_pwm_freq_hz, (unsigned int)transmit_pwm_duty_percent);
    return true;
}

static bool transmit_stop_impl(const char **err_msg)
{
    if (err_msg) {
        *err_msg = NULL;
    }

    if (!transmission_active) {
        return true;
    }

    timer_pause(SAMPLER_TIMER_GROUP, TRANSMIT_TIMER);
    timer_disable_intr(SAMPLER_TIMER_GROUP, TRANSMIT_TIMER);

    if (transmission_timer_isr_handle) {
        esp_intr_free(transmission_timer_isr_handle);
        transmission_timer_isr_handle = NULL;
    }

    if (transmit_pwm_configured) {
        transmit_pwm_stop();
    }
    gpio_set_level(sampler_pin, 0);
    ble_set_transmitter_mode(0);
    transmission_active = false;

    ESP_LOGI(TAG, "Transmission stopped");
    return true;
}

bool sampler_start_sampling(int pin)
{
    return sampler_start_impl(pin, NULL);
}

bool sampler_stop_sampling(void)
{
    return sampler_stop_impl(NULL);
}

bool sampler_start_transmission(int pin)
{
    return transmit_start_impl(pin, false, 0, 0, NULL);
}

bool sampler_stop_transmission(void)
{
    return transmit_stop_impl(NULL);
}

static bool transmit_pwm_configure(gpio_num_t gpio, uint32_t freq_hz, uint8_t duty_percent, const char **err_msg)
{
    if (err_msg) {
        *err_msg = NULL;
    }

    if (duty_percent == 0 || duty_percent > 100) {
        if (err_msg) {
            *err_msg = "transmit pwm: duty";
        }
        return false;
    }

    ledc_timer_config_t timer_conf = {
        .speed_mode = transmit_ledc_speed_mode,
        .timer_num = transmit_ledc_timer,
        .duty_resolution = LEDC_TIMER_10_BIT,
        .freq_hz = (uint32_t)freq_hz,
        .clk_cfg = LEDC_AUTO_CLK,
    };
    esp_err_t err = ledc_timer_config(&timer_conf);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "ledc_timer_config failed: %s", esp_err_to_name(err));
        if (err_msg) {
            *err_msg = "transmit pwm: timer";
        }
        return false;
    }

    uint32_t max_duty = (1U << LEDC_TIMER_10_BIT) - 1U;
    uint32_t duty = (max_duty * (uint32_t)duty_percent) / 100U;

    ledc_channel_config_t ch_conf = {
        .gpio_num = (int)gpio,
        .speed_mode = transmit_ledc_speed_mode,
        .channel = transmit_ledc_channel,
        .intr_type = LEDC_INTR_DISABLE,
        .timer_sel = transmit_ledc_timer,
        .duty = duty,
        .hpoint = 0,
    };
    err = ledc_channel_config(&ch_conf);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "ledc_channel_config failed: %s", esp_err_to_name(err));
        if (err_msg) {
            *err_msg = "transmit pwm: channel";
        }
        return false;
    }

    ledc_ll_set_idle_level(LEDC_LL_GET_HW(), transmit_ledc_speed_mode, transmit_ledc_channel, 0);
    ledc_ll_set_sig_out_en(LEDC_LL_GET_HW(), transmit_ledc_speed_mode, transmit_ledc_channel, false);
    ledc_ll_ls_channel_update(LEDC_LL_GET_HW(), transmit_ledc_speed_mode, transmit_ledc_channel);

    gpio_set_level(gpio, 0);
    transmit_pwm_configured = true;
    transmit_pwm_enabled_state = false;
    return true;
}

static void IRAM_ATTR transmit_pwm_set_enabled_isr(bool enabled)
{
    if (enabled == transmit_pwm_enabled_state) {
        return;
    }
    transmit_pwm_enabled_state = enabled;
    ledc_ll_set_sig_out_en(LEDC_LL_GET_HW(), transmit_ledc_speed_mode, transmit_ledc_channel, enabled);
    ledc_ll_ls_channel_update(LEDC_LL_GET_HW(), transmit_ledc_speed_mode, transmit_ledc_channel);
}

static void transmit_pwm_stop(void)
{
    ledc_ll_set_sig_out_en(LEDC_LL_GET_HW(), transmit_ledc_speed_mode, transmit_ledc_channel, false);
    ledc_ll_ls_channel_update(LEDC_LL_GET_HW(), transmit_ledc_speed_mode, transmit_ledc_channel);
    ledc_stop(transmit_ledc_speed_mode, transmit_ledc_channel, 0);
    transmit_pwm_configured = false;
    transmit_pwm_enabled_state = false;
}
