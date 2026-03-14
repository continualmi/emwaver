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
#include <string.h>

#include "command_registry.h"
#include "driver/gpio.h"
#include "driver/ledc.h"
#include "driver/timer.h"
#include "esp_err.h"
#include "esp_intr_alloc.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "hal/ledc_ll.h"
#include "usb.h"

#define SAMPLER_RING_LANES 16u
#define SAMPLER_RING_MASK (SAMPLER_RING_LANES - 1u)
#define SAMPLER_TIMER_GROUP TIMER_GROUP_0
#define SAMPLER_TIMER TIMER_0
#define TRANSMIT_TIMER TIMER_1
#define DEFAULT_TICK_US 10u
#define MIN_TICK_US 5u
#define TRANSMISSION_TIMEOUT_MS 2000u
#define TRANSMISSION_IDLE_EXIT_MS 100u
#define TRANSMISSION_START_FILL_BYTES 250u
#define MONITOR_CHECK_INTERVAL_MS 10u
#define TRANSMIT_PWM_DEFAULT_FREQ_HZ 38000u
#define TRANSMIT_PWM_DEFAULT_DUTY_PERCENT 50u
#define TRANSMIT_PWM_MAX_FREQ_HZ 1000000u
#define TRANSMIT_PWM_MIN_FREQ_HZ 1u

static const char *TAG = "SAMPLER";

static portMUX_TYPE s_sampler_lock = portMUX_INITIALIZER_UNLOCKED;

static volatile uint8_t sampler_ring[SAMPLER_RING_LANES][EMW_USB_CMD_LANE_SIZE];
static volatile uint8_t sampler_overflow_lane[EMW_USB_CMD_LANE_SIZE];
static volatile uint8_t sampler_ring_head;
static volatile uint8_t sampler_ring_tail;
static volatile uint8_t sampler_ring_count;
static volatile uint8_t sampler_overflow_active;
static volatile uint8_t sampler_bit_index;
static volatile uint8_t sampler_byte_index;
static volatile uint8_t sampler_current_byte;

static volatile uint8_t tx_bit_index;
static volatile uint8_t tx_current_byte;
static volatile uint8_t tx_out_enabled;

static intr_handle_t sampling_timer_isr_handle;
static intr_handle_t transmission_timer_isr_handle;
static TaskHandle_t sampler_task_handle;
static TaskHandle_t transmission_monitor_task_handle;

static uint16_t sampler_pin;
static bool sampling_active;
static bool transmission_active;
static uint32_t sampling_tick_us;
static uint32_t transmit_tick_us;
static bool transmit_use_pwm;
static uint32_t transmit_pwm_freq_hz;
static uint8_t transmit_pwm_duty_percent;
static bool transmit_pwm_configured;
static bool transmit_pwm_enabled_state;
static ledc_mode_t transmit_ledc_speed_mode = LEDC_LOW_SPEED_MODE;
static ledc_timer_t transmit_ledc_timer = LEDC_TIMER_0;
static ledc_channel_t transmit_ledc_channel = LEDC_CHANNEL_0;

static void sampler_start_command(int pin);
static void sampler_stop_command(void);
static void transmit_start_command(int pin, bool pwm, int freq_hz, int duty_percent);
static void transmit_stop_command(void);
static void sampler_task(void *pv_parameters);
static void transmission_monitor_task(void *pv_parameters);
static void sampling_isr(void *arg);
static void transmission_isr(void *arg);
static bool sampler_start_impl(int pin, uint8_t tick_us, const char **err_msg);
static bool sampler_stop_impl(const char **err_msg);
static bool transmit_start_impl(int pin, bool pwm, int freq_hz, int duty_percent, uint8_t tick_us, const char **err_msg);
static bool transmit_stop_impl(const char **err_msg);
static bool transmit_pwm_configure(gpio_num_t gpio, uint32_t freq_hz, uint8_t duty_percent, const char **err_msg);
static void transmit_pwm_set_enabled_isr(bool enabled);
static void transmit_pwm_stop(void);
static void configure_timer(timer_group_t group, timer_idx_t timer, uint32_t interval_us, bool auto_reload);
static uint32_t normalize_tick_us(uint8_t requested_us);
static void reset_sampler_state(void);
static void reset_transmission_state(void);

void sampler_module_init(void)
{
    sampling_timer_isr_handle = NULL;
    transmission_timer_isr_handle = NULL;
    sampler_task_handle = NULL;
    transmission_monitor_task_handle = NULL;
    sampling_active = false;
    transmission_active = false;
    sampler_pin = 0;
    sampling_tick_us = DEFAULT_TICK_US;
    transmit_tick_us = DEFAULT_TICK_US;
    transmit_use_pwm = true;
    transmit_pwm_freq_hz = TRANSMIT_PWM_DEFAULT_FREQ_HZ;
    transmit_pwm_duty_percent = TRANSMIT_PWM_DEFAULT_DUTY_PERCENT;
    transmit_pwm_configured = false;
    transmit_pwm_enabled_state = false;
    reset_sampler_state();
    reset_transmission_state();
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

static void configure_timer(timer_group_t group, timer_idx_t timer, uint32_t interval_us, bool auto_reload)
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

static uint32_t normalize_tick_us(uint8_t requested_us)
{
    if (requested_us == 0u) {
        return DEFAULT_TICK_US;
    }
    if (requested_us < MIN_TICK_US) {
        return MIN_TICK_US;
    }
    return requested_us;
}

static void reset_sampler_state(void)
{
    portENTER_CRITICAL(&s_sampler_lock);
    sampler_ring_head = 0;
    sampler_ring_tail = 0;
    sampler_ring_count = 0;
    sampler_overflow_active = 0;
    sampler_bit_index = 0;
    sampler_byte_index = 0;
    sampler_current_byte = 0;
    memset((void *)sampler_ring, 0, sizeof(sampler_ring));
    memset((void *)sampler_overflow_lane, 0, sizeof(sampler_overflow_lane));
    portEXIT_CRITICAL(&s_sampler_lock);
}

static void reset_transmission_state(void)
{
    tx_bit_index = 0;
    tx_current_byte = 0;
    tx_out_enabled = 0;
}

static void sampler_start_command(int pin)
{
    const char *err = NULL;
    if (!sampler_start_impl(pin, DEFAULT_TICK_US, &err)) {
        ESP_LOGW(TAG, "sample start failed: %s", err ? err : "unknown");
    }
}

static void sampler_stop_command(void)
{
    const char *err = NULL;
    if (!sampler_stop_impl(&err)) {
        ESP_LOGW(TAG, "sample stop failed: %s", err ? err : "unknown");
    }
}

static void transmit_start_command(int pin, bool pwm, int freq_hz, int duty_percent)
{
    const char *err = NULL;
    if (!transmit_start_impl(pin, pwm, freq_hz, duty_percent, DEFAULT_TICK_US, &err)) {
        ESP_LOGW(TAG, "transmit start failed: %s", err ? err : "unknown");
    }
}

static void transmit_stop_command(void)
{
    const char *err = NULL;
    if (!transmit_stop_impl(&err)) {
        ESP_LOGW(TAG, "transmit stop failed: %s", err ? err : "unknown");
    }
}

static void sampler_task(void *pv_parameters)
{
    (void)pv_parameters;

    for (;;) {
        uint32_t notification = 0;
        if (xTaskNotifyWait(0, ULONG_MAX, &notification, pdMS_TO_TICKS(1)) == pdTRUE && notification == 1u) {
            break;
        }

        if (sampling_active) {
            uint8_t lane_index = 0;
            bool has_lane = false;

            portENTER_CRITICAL(&s_sampler_lock);
            if (sampler_ring_count > 0u) {
                lane_index = sampler_ring_tail;
                has_lane = true;
            }
            portEXIT_CRITICAL(&s_sampler_lock);

            if (has_lane) {
                if (usb_send_stream_lane((const uint8_t *)sampler_ring[lane_index], true) == ESP_OK) {
                    portENTER_CRITICAL(&s_sampler_lock);
                    if (sampler_ring_count > 0u) {
                        sampler_ring_tail = (uint8_t)((sampler_ring_tail + 1u) & SAMPLER_RING_MASK);
                        sampler_ring_count--;
                    }
                    portEXIT_CRITICAL(&s_sampler_lock);
                }
            }
        }

        usb_poll_tx();
    }

    sampler_task_handle = NULL;
    vTaskDelete(NULL);
}

static void transmission_monitor_task(void *pv_parameters)
{
    (void)pv_parameters;

    uint16_t last_bytes_available = 0;
    uint32_t unchanged_time_ms = 0;
    uint32_t idle_zero_time_ms = 0;
    uint32_t fill_wait_time_ms = 0;
    bool timer_started = false;

    while (transmission_active) {
        uint16_t current_bytes_available = usb_get_rx_buffer_bytes_available();

        if (!timer_started) {
            if (current_bytes_available >= TRANSMISSION_START_FILL_BYTES ||
                fill_wait_time_ms >= TRANSMISSION_TIMEOUT_MS) {
                timer_start(SAMPLER_TIMER_GROUP, TRANSMIT_TIMER);
                timer_started = true;
                unchanged_time_ms = 0;
                idle_zero_time_ms = 0;
                last_bytes_available = current_bytes_available;
            } else {
                fill_wait_time_ms += MONITOR_CHECK_INTERVAL_MS;
            }
        } else {
            if (current_bytes_available == 0u) {
                idle_zero_time_ms += MONITOR_CHECK_INTERVAL_MS;
                if (idle_zero_time_ms >= TRANSMISSION_IDLE_EXIT_MS) {
                    ESP_LOGI(TAG, "Transmission complete (buffer drained)");
                    (void)transmit_stop_impl(NULL);
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
                    (void)transmit_stop_impl(NULL);
                    break;
                }
            }
        }

        usb_poll_tx();
        vTaskDelay(pdMS_TO_TICKS(MONITOR_CHECK_INTERVAL_MS));
    }

    transmission_monitor_task_handle = NULL;
    vTaskDelete(NULL);
}

static void IRAM_ATTR sampling_isr(void *arg)
{
    (void)arg;
    timer_group_clr_intr_status_in_isr(SAMPLER_TIMER_GROUP, SAMPLER_TIMER);

    uint8_t level = (uint8_t)gpio_get_level((gpio_num_t)sampler_pin);
    if (level != 0u) {
        sampler_current_byte |= (uint8_t)(1u << sampler_bit_index);
    }

    sampler_bit_index++;
    if (sampler_bit_index < 8u) {
        timer_group_enable_alarm_in_isr(SAMPLER_TIMER_GROUP, SAMPLER_TIMER);
        return;
    }

    sampler_bit_index = 0;

    uint8_t *lane = sampler_overflow_active ? (uint8_t *)sampler_overflow_lane
                                            : (uint8_t *)sampler_ring[sampler_ring_head];
    lane[sampler_byte_index] = sampler_current_byte;
    sampler_current_byte = 0;
    sampler_byte_index++;
    if (sampler_byte_index < EMW_USB_CMD_LANE_SIZE) {
        timer_group_enable_alarm_in_isr(SAMPLER_TIMER_GROUP, SAMPLER_TIMER);
        return;
    }

    sampler_byte_index = 0;

    if (sampler_overflow_active) {
        if (sampler_ring_count < SAMPLER_RING_LANES) {
            sampler_overflow_active = 0;
        }
        timer_group_enable_alarm_in_isr(SAMPLER_TIMER_GROUP, SAMPLER_TIMER);
        return;
    }

    if (sampler_ring_count >= SAMPLER_RING_LANES) {
        sampler_overflow_active = 1;
        timer_group_enable_alarm_in_isr(SAMPLER_TIMER_GROUP, SAMPLER_TIMER);
        return;
    }

    sampler_ring_count = (uint8_t)(sampler_ring_count + 1u);
    sampler_ring_head = (uint8_t)((sampler_ring_head + 1u) & SAMPLER_RING_MASK);
    if (sampler_ring_count >= SAMPLER_RING_LANES) {
        sampler_overflow_active = 1;
    }

    timer_group_enable_alarm_in_isr(SAMPLER_TIMER_GROUP, SAMPLER_TIMER);
}

static void IRAM_ATTR transmission_isr(void *arg)
{
    (void)arg;
    timer_group_clr_intr_status_in_isr(SAMPLER_TIMER_GROUP, TRANSMIT_TIMER);

    if (usb_get_rx_buffer_bytes_available() > 0u) {
        if (tx_bit_index == 0u) {
            if (usb_read_rx_buffer((uint8_t *)&tx_current_byte, 1) != EMW_USB_RX_BUFFER_OK) {
                timer_group_enable_alarm_in_isr(SAMPLER_TIMER_GROUP, TRANSMIT_TIMER);
                return;
            }
        }

        bool bit = ((tx_current_byte >> tx_bit_index) & 1u) != 0u;
        if (transmit_use_pwm && transmit_pwm_configured) {
            transmit_pwm_set_enabled_isr(bit);
            if (!bit) {
                gpio_set_level((gpio_num_t)sampler_pin, 0);
            }
        } else {
            gpio_set_level((gpio_num_t)sampler_pin, bit ? 1 : 0);
        }

        tx_bit_index = (uint8_t)(tx_bit_index + 1u);
        if (tx_bit_index >= 8u) {
            tx_bit_index = 0u;
        }
    } else {
        if (transmit_use_pwm && transmit_pwm_configured) {
            transmit_pwm_set_enabled_isr(false);
        }
        gpio_set_level((gpio_num_t)sampler_pin, 0);
        tx_bit_index = 0u;
    }

    timer_group_enable_alarm_in_isr(SAMPLER_TIMER_GROUP, TRANSMIT_TIMER);
}

static bool sampler_start_impl(int pin, uint8_t tick_us, const char **err_msg)
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
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);

    sampler_pin = (uint16_t)pin;
    sampling_tick_us = normalize_tick_us(tick_us);
    reset_sampler_state();
    usb_set_buffer_type(EMW_BUFFER_DOUBLE);
    configure_timer(SAMPLER_TIMER_GROUP, SAMPLER_TIMER, sampling_tick_us, true);

    esp_err_t err = timer_isr_register(SAMPLER_TIMER_GROUP,
                                       SAMPLER_TIMER,
                                       sampling_isr,
                                       NULL,
                                       ESP_INTR_FLAG_IRAM,
                                       &sampling_timer_isr_handle);
    if (err != ESP_OK) {
        if (err_msg) {
            *err_msg = "sample start: isr";
        }
        return false;
    }

    sampling_active = true;
    timer_start(SAMPLER_TIMER_GROUP, SAMPLER_TIMER);

    if (sampler_task_handle == NULL) {
        if (xTaskCreate(sampler_task, "sampler", 4096, NULL, 5, &sampler_task_handle) != pdPASS) {
            sampling_active = false;
            timer_pause(SAMPLER_TIMER_GROUP, SAMPLER_TIMER);
            timer_disable_intr(SAMPLER_TIMER_GROUP, SAMPLER_TIMER);
            esp_intr_free(sampling_timer_isr_handle);
            sampling_timer_isr_handle = NULL;
            usb_set_buffer_type(EMW_BUFFER_PACKET);
            if (err_msg) {
                *err_msg = "sample start: task";
            }
            return false;
        }
    }

    ESP_LOGI(TAG, "Sampling started on pin %d (tick=%luus)", pin, (unsigned long)sampling_tick_us);
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

    sampling_active = false;
    usb_set_buffer_type(EMW_BUFFER_PACKET);
    reset_sampler_state();

    if (sampler_task_handle) {
        xTaskNotify(sampler_task_handle, 1u, eSetValueWithOverwrite);
    }

    ESP_LOGI(TAG, "Sampling stopped");
    return true;
}

static bool transmit_start_impl(int pin, bool pwm, int freq_hz, int duty_percent, uint8_t tick_us, const char **err_msg)
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

    uint32_t effective_freq_hz = (freq_hz > 0) ? (uint32_t)freq_hz : TRANSMIT_PWM_DEFAULT_FREQ_HZ;
    uint8_t effective_duty_percent = (duty_percent > 0) ? (uint8_t)duty_percent : TRANSMIT_PWM_DEFAULT_DUTY_PERCENT;

    if (effective_freq_hz < TRANSMIT_PWM_MIN_FREQ_HZ || effective_freq_hz > TRANSMIT_PWM_MAX_FREQ_HZ) {
        if (err_msg) {
            *err_msg = "transmit start: freq";
        }
        return false;
    }
    if (effective_duty_percent < 1u || effective_duty_percent > 100u) {
        if (err_msg) {
            *err_msg = "transmit start: duty";
        }
        return false;
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
    transmit_tick_us = normalize_tick_us(tick_us);
    transmit_pwm_freq_hz = effective_freq_hz;
    transmit_pwm_duty_percent = effective_duty_percent;
    reset_transmission_state();

    transmit_pwm_configured = false;
    if (transmit_use_pwm) {
        if (!transmit_pwm_configure((gpio_num_t)pin, transmit_pwm_freq_hz, transmit_pwm_duty_percent, err_msg)) {
            return false;
        }
    }

    usb_init_rx_buffer();
    usb_set_buffer_type(EMW_BUFFER_CIRCULAR);
    configure_timer(SAMPLER_TIMER_GROUP, TRANSMIT_TIMER, transmit_tick_us, true);

    esp_err_t err = timer_isr_register(SAMPLER_TIMER_GROUP,
                                       TRANSMIT_TIMER,
                                       transmission_isr,
                                       NULL,
                                       ESP_INTR_FLAG_IRAM,
                                       &transmission_timer_isr_handle);
    if (err != ESP_OK) {
        usb_set_buffer_type(EMW_BUFFER_PACKET);
        if (transmit_pwm_configured) {
            transmit_pwm_stop();
        }
        if (err_msg) {
            *err_msg = "transmit start: isr";
        }
        return false;
    }

    transmission_active = true;
    if (transmission_monitor_task_handle == NULL) {
        if (xTaskCreate(transmission_monitor_task, "tx_monitor", 4096, NULL, 5,
                        &transmission_monitor_task_handle) != pdPASS) {
            transmission_active = false;
            timer_pause(SAMPLER_TIMER_GROUP, TRANSMIT_TIMER);
            timer_disable_intr(SAMPLER_TIMER_GROUP, TRANSMIT_TIMER);
            esp_intr_free(transmission_timer_isr_handle);
            transmission_timer_isr_handle = NULL;
            usb_set_buffer_type(EMW_BUFFER_PACKET);
            usb_free_rx_buffer();
            if (transmit_pwm_configured) {
                transmit_pwm_stop();
            }
            if (err_msg) {
                *err_msg = "transmit start: task";
            }
            return false;
        }
    }

    ESP_LOGI(TAG, "Transmission initialized on pin %d (pwm=%d freq=%lu duty=%u%% tick=%luus)",
             pin,
             transmit_use_pwm ? 1 : 0,
             (unsigned long)transmit_pwm_freq_hz,
             (unsigned int)transmit_pwm_duty_percent,
             (unsigned long)transmit_tick_us);
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

    transmission_active = false;
    if (transmit_pwm_configured) {
        transmit_pwm_stop();
    }
    gpio_set_level((gpio_num_t)sampler_pin, 0);
    usb_set_buffer_type(EMW_BUFFER_PACKET);
    usb_flush_rx_buffer();
    usb_free_rx_buffer();
    reset_transmission_state();

    ESP_LOGI(TAG, "Transmission stopped");
    return true;
}

bool sampler_start_sampling(int pin, uint8_t tick_us)
{
    return sampler_start_impl(pin, tick_us, NULL);
}

bool sampler_stop_sampling(void)
{
    return sampler_stop_impl(NULL);
}

bool sampler_start_transmission(int pin, uint8_t duty_percent, int freq_hz, uint8_t tick_us)
{
    return transmit_start_impl(pin, true, freq_hz, duty_percent, tick_us, NULL);
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

    ledc_timer_config_t timer_conf = {
        .speed_mode = transmit_ledc_speed_mode,
        .timer_num = transmit_ledc_timer,
        .duty_resolution = LEDC_TIMER_10_BIT,
        .freq_hz = freq_hz,
        .clk_cfg = LEDC_AUTO_CLK,
    };
    esp_err_t err = ledc_timer_config(&timer_conf);
    if (err != ESP_OK) {
        if (err_msg) {
            *err_msg = "transmit pwm: timer";
        }
        return false;
    }

    uint32_t max_duty = (1u << LEDC_TIMER_10_BIT) - 1u;
    uint32_t duty = (max_duty * (uint32_t)duty_percent) / 100u;

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
        if (err_msg) {
            *err_msg = "transmit pwm: channel";
        }
        return false;
    }

    ledc_ll_set_idle_level(LEDC_LL_GET_HW(), transmit_ledc_speed_mode, transmit_ledc_channel, 0);
    ledc_stop(transmit_ledc_speed_mode, transmit_ledc_channel, 0);
    transmit_pwm_enabled_state = false;
    transmit_pwm_configured = true;
    return true;
}

static void transmit_pwm_set_enabled_isr(bool enabled)
{
    if (!transmit_pwm_configured || enabled == transmit_pwm_enabled_state) {
        return;
    }

    if (enabled) {
        ledc_ll_ls_channel_update(LEDC_LL_GET_HW(), transmit_ledc_speed_mode, transmit_ledc_channel);
        ledc_ll_set_sig_out_en(LEDC_LL_GET_HW(), transmit_ledc_speed_mode, transmit_ledc_channel, true);
    } else {
        ledc_ll_set_sig_out_en(LEDC_LL_GET_HW(), transmit_ledc_speed_mode, transmit_ledc_channel, false);
    }
    transmit_pwm_enabled_state = enabled;
    tx_out_enabled = enabled ? 1u : 0u;
}

static void transmit_pwm_stop(void)
{
    ledc_stop(transmit_ledc_speed_mode, transmit_ledc_channel, 0);
    transmit_pwm_enabled_state = false;
    transmit_pwm_configured = false;
    tx_out_enabled = 0u;
}
