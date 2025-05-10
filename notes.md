# Tasks

## Done

* The Android implementation of Buttons requires this MakeHex which is in C++. For iOS, we might not be able to do this native-C++ trick to import it. Let's rewrite the whole thing instead in Java and then Swift.
* Write firmware update code for OTA in ESP32
* Build website with MKDocs and add ESP Web Tools to it
* Probably need some sort of universal indicator of the connection to the device, rather than having it on every single Fragment.
* Remove test button from ISM Fragment. Add progress bar for all those register writes and reads
* Buttons fragment needs to be written
* Remembering the pin chosen on the spinners, things like that are always nice
* Change pin choices to match the available on the latest EMWaver hardware
* EMWaver logo on BLE connection notification
* Change BLE Fragment to EMWaver fragment
* Remove firmware update fragment. Instead, add versioning of EMWaver firmware, and then on BLE connected, check version and alert users for possible update
* Need to fix the RAM issue when recording for too long. Need a normal disk writing buffer strategy, maybe double buffer on RAM, this is for both IOS and Android (solution: added limit)
* Look into maybe increasing throughput from 100kbps to 200kbps just to get better resolution on recordings of 5us instead of 10us between samples. Not strictly needed as seen on IR transmission and so on, but something with some value to have (looked and no need really)
* Further write Template Fragment (no need)
* Remove nrf24 fragment (nrf24 will be for forking and custom implementations)
* Make the feel of the console fragment UI betters
* Make the feel of the buttons fragment UI better
* Implement Bad-USB functionality through Console fragment scripting. Much cleaner than doing my own Bas USB fragment!
* Remove bad usb fragment
* Remove template fragment. If people want to create a new fragment, there is no need for a template fragment i don't think. We think about it down the line
* Implement some 2.4 GHz basic functionality on 2.4 GHz fragment (no need)
* For BAD-USB, we need to write a NVS functionality as well, to make the ESP32 boot and immediatly inject payload that was saved to Non volatile storage NVS (we dont because we are just going to be doing ephemeral bad usb and remotely)
* Consider adding using built in NFC and IR blaster on phones that have it (might be a bad idea because IOS doesnt, though NFC built-in has more protocols and standards than mifare. Best decision might be to not support any built in functions, also because we don't know how useful other NFC protocols are)

## Not Done

* The Android implementation of Buttons now uses a Java rewrite of MakeHex. For iOS, we still need to implement the equivalent logic in Swift, since native C++ import is not feasible.
* ISM fragment is not using `sendCommand` properly again on iOS. It seems the background threading is more difficult than on Android. Can't quite get `BLEManager` to function the same as `BLEService` in Android.
* Retransmission over and over on iOS also fails a bit, needs a bit more work.
* Settings fragment also needs to have some stuff, not sure what
* Lots of polishing required for the apps to then be accepted on App Store and Google Play Store. Bugs cleaning compreensively across every fragment and feature.
* Cross examine ISM Fragment, test it thorougly
* Resolve warnings in firmware
* Consider having the BLE service check for connections periodically even on other fragments


* See why RFID range is really bad for some reason using the cheap module. Not sure if it's a board issue since I never tested it even with old USB CDC Protocol
* Need a detection/warning for when any hardware is missing, cc1101, mfrc522, nrf24. Basic checks and warnings on chip status etc (actually just the mfrc522 is needed)
* Clean out nrf24 code from esp32
* Need to write README file properly too, including the EMWaver logo there, and basic repo instructions.
* Need to write a markdown `.md` file containing lots of info for any LLM to aid in development and modifications in the codebase.


## Hardware

* Noticed on x ray reports that the USB male port pads as not aligning with the component. Also noticed that from the 2 prototype boards, one does not work in reverse cable connection. This might suggest a soldering problem. May need to draw my own footprint

## Build Commands

esptool.py --chip esp32s3 merge_bin \
  -o emwaver-v1.bin \
  --flash_mode dio --flash_freq 40m --flash_size 4MB \
  0x0     build/bootloader/bootloader.bin \
  0x8000  build/partition_table/partition-table.bin \
  0x10000 build/emwaveresp.bin


  