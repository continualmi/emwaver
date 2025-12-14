idf_component_register(SRCS "main.c" "init.c" "usb.c" "ble_server.c" "command_registry.c" "spi.c" "sampler.c" "rfm69.c" "cc1101.c" "libraries/mfrc522.c"
                    PRIV_REQUIRES spi_flash driver usb bt tinyusb
                    INCLUDE_DIRS "." "libraries"
                    REQUIRES esp_timer nvs_flash)
