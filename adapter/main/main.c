/*
 * SPDX-FileCopyrightText: 2017-2023 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#include "sdkconfig.h"

#include "esp_log.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOSConfig.h"
/* BLE */
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "console/console.h"
#include "services/gap/ble_svc_gap.h"
#include "ble_cts_prph.h"
#include "services/cts/ble_svc_cts.h"
#include "usb/usb_host.h"
#include "usb/cdc_acm_host.h"

#define USB_HOST_PRIORITY   20
#define TARGET_USB_VID     CONFIG_ADAPTER_USB_VID
#define TARGET_USB_PID     CONFIG_ADAPTER_USB_PID

#if CONFIG_EXAMPLE_EXTENDED_ADV
static uint8_t ext_adv_pattern_1[] = {
    0x02, 0x01, 0x06,
    0x03, 0x03, 0xab, 0xcd,
    0x03, 0x03, 0x05, 0x18,
    0x12, 0X09, 'n', 'i', 'm', 'b', 'l', 'e', '-', 'c', 't', 's', '-', 'p', 'r', 'p', 'h', '-', 'e',
};
#endif

static const char *tag = "BLE_WAVER_ADAPTER";
static const char *device_name = CONFIG_ADAPTER_BLE_DEVICE_NAME;

static int ble_cts_prph_gap_event(struct ble_gap_event *event, void *arg);

static uint8_t ble_cts_prph_addr_type;

static SemaphoreHandle_t device_disconnected_sem;
static cdc_acm_dev_hdl_t current_cdc_dev = NULL;
static QueueHandle_t ble_data_queue;

static void usb_lib_task(void *arg);
static bool handle_rx(const uint8_t *data, size_t data_len, void *arg);
static void handle_event(const cdc_acm_host_dev_event_data_t *event, void *user_ctx);

/**
 * Utility function to log an array of bytes.
 */
void
print_bytes(const uint8_t *bytes, int len)
{
    int i;
    for (i = 0; i < len; i++) {
        MODLOG_DFLT(INFO, "%s0x%02x", i != 0 ? ":" : "", bytes[i]);
    }
}

void
print_addr(const void *addr)
{
    const uint8_t *u8p;

    u8p = addr;
    MODLOG_DFLT(INFO, "%02x:%02x:%02x:%02x:%02x:%02x",
                u8p[5], u8p[4], u8p[3], u8p[2], u8p[1], u8p[0]);
}

#if CONFIG_EXAMPLE_EXTENDED_ADV
/**
 * Enables advertising with the following parameters:
 *     o General discoverable mode.
 *     o Undirected connectable mode.
 */
static void
ext_ble_cts_prph_advertise(void)
{
    struct ble_gap_ext_adv_params params;
    struct os_mbuf *data;
    uint8_t instance = 0;
    int rc;

    /* First check if any instance is already active */
    if (ble_gap_ext_adv_active(instance)) {
        return;
    }

    /* use defaults for non-set params */
    memset (&params, 0, sizeof(params));

    /* enable connectable advertising */
    params.connectable = 1;

    /* advertise using random addr */
    params.own_addr_type = BLE_OWN_ADDR_PUBLIC;

    params.primary_phy = BLE_HCI_LE_PHY_1M;
    params.secondary_phy = BLE_HCI_LE_PHY_2M;
    params.sid = 1;

    params.itvl_min = BLE_GAP_ADV_FAST_INTERVAL1_MIN;
    params.itvl_max = BLE_GAP_ADV_FAST_INTERVAL1_MIN;

    /* configure instance 0 */
    rc = ble_gap_ext_adv_configure(instance, &params, NULL,
                                   ble_cts_prph_gap_event, NULL);
    assert (rc == 0);

    /* in this case only scan response is allowed */

    /* get mbuf for scan rsp data */
    data = os_msys_get_pkthdr(sizeof(ext_adv_pattern_1), 0);
    assert(data);

    /* fill mbuf with scan rsp data */
    rc = os_mbuf_append(data, ext_adv_pattern_1, sizeof(ext_adv_pattern_1));
    assert(rc == 0);

    rc = ble_gap_ext_adv_set_data(instance, data);
    assert (rc == 0);

    /* start advertising */
    rc = ble_gap_ext_adv_start(instance, 0, 0);
    assert (rc == 0);
}
#else

static void
ble_cts_prph_advertise(void)
{
    struct ble_gap_adv_params adv_params;
    struct ble_hs_adv_fields fields;
    int rc;

    memset(&fields, 0, sizeof(fields));

    fields.flags = BLE_HS_ADV_F_DISC_GEN |
                   BLE_HS_ADV_F_BREDR_UNSUP;

    fields.tx_pwr_lvl_is_present = 1;
    fields.tx_pwr_lvl = BLE_HS_ADV_TX_PWR_LVL_AUTO;

    fields.name = (uint8_t *)device_name;
    fields.name_len = strlen(device_name);
    fields.name_is_complete = 1;

    rc = ble_gap_adv_set_fields(&fields);
    if (rc != 0) {
        MODLOG_DFLT(ERROR, "error setting advertisement data; rc=%d\n", rc);
        return;
    }

    memset(&adv_params, 0, sizeof(adv_params));
    adv_params.conn_mode = BLE_GAP_CONN_MODE_UND;
    adv_params.disc_mode = BLE_GAP_DISC_MODE_GEN;
    rc = ble_gap_adv_start(ble_cts_prph_addr_type, NULL, BLE_HS_FOREVER,
                           &adv_params, ble_cts_prph_gap_event, NULL);
    if (rc != 0) {
        MODLOG_DFLT(ERROR, "error enabling advertisement; rc=%d\n", rc);
        return;
    }
}
#endif

static int
ble_cts_prph_gap_event(struct ble_gap_event *event, void *arg)
{
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        if (event->connect.status == 0) {
            // Connection established - save the connection handle
            gatt_svr_set_notify_conn_handle(event->connect.conn_handle);
            MODLOG_DFLT(INFO, "Connection established\n");
        } else {
            gatt_svr_set_notify_conn_handle(BLE_HS_CONN_HANDLE_NONE);
            MODLOG_DFLT(INFO, "Connection failed (error: %d)\n", event->connect.status);
            // Resume advertising on connection failure
#if CONFIG_EXAMPLE_EXTENDED_ADV
            ext_ble_cts_prph_advertise();
#else
            ble_cts_prph_advertise();
#endif
        }
        break;

    case BLE_GAP_EVENT_DISCONNECT:
        gatt_svr_set_notify_conn_handle(BLE_HS_CONN_HANDLE_NONE);
        MODLOG_DFLT(INFO, "disconnect; reason=%d\n", event->disconnect.reason);

        /* Connection terminated; resume advertising */
#if CONFIG_EXAMPLE_EXTENDED_ADV
        ext_ble_cts_prph_advertise();
#else
        ble_cts_prph_advertise();
#endif

        break;

    case BLE_GAP_EVENT_ADV_COMPLETE:
        MODLOG_DFLT(INFO, "adv complete\n");
#if CONFIG_EXAMPLE_EXTENDED_ADV
        ext_ble_cts_prph_advertise();
#else
        ble_cts_prph_advertise();
#endif
        break;

    case BLE_GAP_EVENT_SUBSCRIBE:
        MODLOG_DFLT(INFO, "subscribe event; cur_notify=%d\n value handle; "
                    "val_handle=%d\n",
                    event->subscribe.cur_notify, event->subscribe.attr_handle);

        break;

    case BLE_GAP_EVENT_MTU:
        MODLOG_DFLT(INFO, "mtu update event; conn_handle=%d mtu=%d\n",
                    event->mtu.conn_handle,
                    event->mtu.value);
        break;

    }

    return 0;
}

static void
ble_cts_prph_on_sync(void)
{
    int rc;

    rc = ble_hs_id_infer_auto(0, &ble_cts_prph_addr_type);
    assert(rc == 0);

    uint8_t addr_val[6] = {0};
    rc = ble_hs_id_copy_addr(ble_cts_prph_addr_type, addr_val, NULL);

    MODLOG_DFLT(INFO, "Device Address: ");
    print_addr(addr_val);
    MODLOG_DFLT(INFO, "\n");

    /* Begin advertising */
#if CONFIG_EXAMPLE_EXTENDED_ADV
    ext_ble_cts_prph_advertise();
#else
    ble_cts_prph_advertise();
#endif
}

static void
ble_cts_prph_on_reset(int reason)
{
    MODLOG_DFLT(ERROR, "Resetting state; reason=%d\n", reason);
}

void ble_cts_prph_host_task(void *param)
{
    ESP_LOGI(tag, "BLE Host Task Started");
    /* This function will return only when nimble_port_stop() is executed */
    nimble_port_run();

    nimble_port_freertos_deinit();
}

static void ble_to_usb_task(void *arg)
{
    char received_data[100];
    
    while (1) {
        if (xQueueReceive(ble_data_queue, received_data, portMAX_DELAY) == pdTRUE) {
            if (current_cdc_dev != NULL) {
                size_t len = strlen(received_data);
                esp_err_t err = cdc_acm_host_data_tx_blocking(current_cdc_dev, 
                                                            (const uint8_t *)received_data, 
                                                            len, 
                                                            1000);
                if (err == ESP_OK) {
                    ESP_LOGI("BLE_USB", "Forwarded to STM32: %s", received_data);
                } else {
                    ESP_LOGE("BLE_USB", "Failed to forward data: %d", err);
                }
            }
        }
    }
}

static void usb_lib_task(void *arg) {
    while (1) {
        uint32_t event_flags;
        usb_host_lib_handle_events(portMAX_DELAY, &event_flags);
        if (event_flags & USB_HOST_LIB_EVENT_FLAGS_NO_CLIENTS) {
            ESP_ERROR_CHECK(usb_host_device_free_all());
        }
    }
}

static bool handle_rx(const uint8_t *data, size_t data_len, void *arg) {
    char buf[100];
    if (data_len >= sizeof(buf)) {
        data_len = sizeof(buf) - 1;
    }
    memcpy(buf, data, data_len);
    buf[data_len] = '\0';
    
    printf("Received data from STM32: %s\n", buf);
    
    // Forward the data to BLE client
    gatt_svr_notify(buf);
    return true;
}

static void handle_event(const cdc_acm_host_dev_event_data_t *event, void *user_ctx) {
    switch (event->type) {
    case CDC_ACM_HOST_ERROR:
        ESP_LOGE(tag, "CDC-ACM error has occurred, err_no = %i", event->data.error);
        break;
    case CDC_ACM_HOST_DEVICE_DISCONNECTED:
        ESP_LOGI(tag, "Device suddenly disconnected");
        current_cdc_dev = NULL;  // Clear the device handle
        ESP_ERROR_CHECK(cdc_acm_host_close(event->data.cdc_hdl));
        xSemaphoreGive(device_disconnected_sem);
        break;
    default:
        break;
    }
}

void app_main(void)
{
    // Create queue for BLE data
    ble_data_queue = xQueueCreate(10, 100);
    assert(ble_data_queue != NULL);
    
    // Pass queue to GATT server
    gatt_svr_set_queue(ble_data_queue);

    // Initialize NVS
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // Initialize BLE
    ret = nimble_port_init();
    if (ret != ESP_OK) {
        ESP_LOGE("MAIN", "Failed to init nimble %d", ret);
        return;
    }

    // Initialize BLE host
    ble_hs_cfg.sync_cb = ble_cts_prph_on_sync;
    ble_hs_cfg.reset_cb = ble_cts_prph_on_reset;
    ble_hs_cfg.sm_bonding = 1;
    ble_hs_cfg.sm_our_key_dist |= BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
    ble_hs_cfg.sm_their_key_dist |= BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
    ble_hs_cfg.sm_sc = 1;
    ble_hs_cfg.sm_mitm = 1;

    // Initialize GATT server
    ret = gatt_svr_init();
    assert(ret == 0);

    // Set device name
    ret = ble_svc_gap_device_name_set(device_name);
    assert(ret == 0);

    // Initialize USB Host
    device_disconnected_sem = xSemaphoreCreateBinary();
    assert(device_disconnected_sem);

    ESP_LOGI("MAIN", "Installing USB Host");
    const usb_host_config_t host_config = {
        .skip_phy_setup = false,
        .intr_flags = ESP_INTR_FLAG_LEVEL1,
    };
    ESP_ERROR_CHECK(usb_host_install(&host_config));

    // Create tasks
    xTaskCreate(usb_lib_task, "usb_lib", 4096, NULL, USB_HOST_PRIORITY, NULL);
    xTaskCreate(ble_to_usb_task, "ble_to_usb", 4096, NULL, 5, NULL);
    nimble_port_freertos_init(ble_cts_prph_host_task);

    // Install CDC-ACM driver
    ESP_ERROR_CHECK(cdc_acm_host_install(NULL));

    // Start USB device detection loop
    const cdc_acm_host_device_config_t dev_config = {
        .connection_timeout_ms = 1000,
        .out_buffer_size = 64,
        .in_buffer_size = 64,
        .user_arg = NULL,
        .event_cb = handle_event,
        .data_cb = handle_rx
    };

    // USB device detection loop
    while (true) {
        ESP_LOGI("MAIN", "Waiting for STM32 device...");
        esp_err_t err = cdc_acm_host_open(TARGET_USB_VID, TARGET_USB_PID, 0, &dev_config, &current_cdc_dev);
        if (err == ESP_OK) {
            ESP_LOGI("MAIN", "STM32 device connected!");
            
            cdc_acm_line_coding_t line_coding = {
                .dwDTERate = CONFIG_ADAPTER_USB_BAUD,
                .bCharFormat = 0,
                .bParityType = 0,
                .bDataBits = 8
            };
            ESP_ERROR_CHECK(cdc_acm_host_line_coding_set(current_cdc_dev, &line_coding));
            ESP_ERROR_CHECK(cdc_acm_host_set_control_line_state(current_cdc_dev, true, false));

            xSemaphoreTake(device_disconnected_sem, portMAX_DELAY);
            current_cdc_dev = NULL;
        }
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
