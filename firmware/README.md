This is the repo for the EMWaver ESP firmware. EMWaver is a board with an ESP32 S3 and a few functionalities:

- Infrared LED and infrared receiver
- CC1101 transceiver
- USB-C port connected to USB in ESP32-S3
- USB-C port connected to CH340 converter and then to Serial interface in ESP32-S3
- GPIO breakout pins

The special aspect of the EMWaver device is that the USB-C port that connects directly to the ESP interface is a male port, meant to be connected directly to a smartphone, providing power and communications. With this, it is meant to interact with an APP for smartphone, the EMWaver App. 

EMWaver is meant to be a educational tool for enthusiasts. The firmware is simple yet powerful, and is meant to be customizable.

USB and BLE is used to communicate with the smartphone. We utilize the simplest usage of these protocols. For example, with USB we use a simple IN endpoint and OUT endpoint of the type Bulk. And for BLE we have a similar setup with characteristics.

This project was previously built on STM32 platform. This will be an attempt to port it.