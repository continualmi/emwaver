idf_component_register(SRCS "main.c" "libraries/init.c" "libraries/usb.c" "libraries/ble_server.c" "libraries/wifi_transport.c" "libraries/ota_ble.c" "libraries/ota_ble_gatt.c" "libraries/ota_core.c" "libraries/ota_status.c" "libraries/ota_wifi.c" "libraries/command_registry.c" "libraries/spi.c" "libraries/sampler.c" "libraries/rfm69.c" "libraries/cc1101.c" "libraries/gpio_commands.c" "libraries/mfrc522.c"
                    PRIV_REQUIRES spi_flash driver usb bt tinyusb app_update mbedtls esp_wifi esp_netif esp_event esp_http_server esp_adc mdns
                    INCLUDE_DIRS "." "libraries"
                    REQUIRES esp_timer nvs_flash)
