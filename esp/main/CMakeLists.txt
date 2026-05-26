set(EMWAVER_ESP_SRCS
    "main.c"
    "libraries/init.c"
    "libraries/transport_session.c"
    "libraries/transport_debug.c"
    "libraries/wifi_transport.c"
    "libraries/ota_core.c"
    "libraries/ota_status.c"
    "libraries/ota_wifi.c"
    "libraries/command_registry.c"
    "libraries/spi.c"
    "libraries/sampler.c"
    "libraries/rfm69.c"
    "libraries/cc1101.c"
    "libraries/gpio_commands.c"
    "libraries/mfrc522.c")

set(EMWAVER_ESP_PRIV_REQUIRES
    spi_flash
    driver
    app_update
    mbedtls
    esp_wifi
    esp_netif
    esp_event
    esp_http_server
    esp_adc
    mdns)

set(EMWAVER_ESP_REQUIRES
    esp_timer
    nvs_flash)

# USB OTG (TinyUSB): only on targets with native USB hardware
if(IDF_TARGET STREQUAL "esp32s2" OR IDF_TARGET STREQUAL "esp32s3")
    list(APPEND EMWAVER_ESP_SRCS "libraries/usb.c")
    list(APPEND EMWAVER_ESP_PRIV_REQUIRES usb tinyusb)
else()
    list(APPEND EMWAVER_ESP_SRCS "libraries/usb_stub.c")
endif()

if(IDF_TARGET STREQUAL "esp32" OR IDF_TARGET STREQUAL "esp32s3")
    list(APPEND EMWAVER_ESP_REQUIRES bt)
endif()

# BLE (NimBLE): available on ESP32 and ESP32-S3 when enabled in sdkconfig
if((IDF_TARGET STREQUAL "esp32" OR IDF_TARGET STREQUAL "esp32s3") AND CONFIG_BT_NIMBLE_ENABLED)
    list(APPEND EMWAVER_ESP_SRCS
        "libraries/ble_server.c"
        "libraries/ota_ble.c"
        "libraries/ota_ble_gatt.c")
else()
    list(APPEND EMWAVER_ESP_SRCS "libraries/ble_server_stub.c")
endif()

idf_component_register(SRCS ${EMWAVER_ESP_SRCS}
                    PRIV_REQUIRES ${EMWAVER_ESP_PRIV_REQUIRES}
                    INCLUDE_DIRS "." "libraries"
                    REQUIRES ${EMWAVER_ESP_REQUIRES})
