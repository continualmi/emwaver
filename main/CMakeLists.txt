idf_component_register(SRCS "main.c" "cc1101.c" "ble_server.c" "mfrc522.c" "badusb.c"
                    PRIV_REQUIRES spi_flash driver usb bt tinyusb
                    INCLUDE_DIRS ""
                    REQUIRES esp_timer nvs_flash)
