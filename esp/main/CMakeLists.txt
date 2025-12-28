idf_component_register(SRCS "main.c" "init.c" "usb.c" "ble_server.c" "ota_ble.c" "ota_core.c" "ota_status.c" "ota_wifi.c" "command_registry.c" "spi.c" "sampler.c" "rfm69.c" "cc1101.c" "gpio_commands.c" "libraries/mfrc522.c"
                    PRIV_REQUIRES spi_flash driver usb bt tinyusb app_update mbedtls esp_wifi esp_netif esp_event esp_http_server
                    INCLUDE_DIRS "." "libraries"
                    REQUIRES esp_timer nvs_flash)
