# Some tasks left to do

* ~~The Android implementation of Buttons requires this MakeHex which is in C++. For iOS, we might not be able to do this native-C++ trick to import it. Let's rewrite the whole thing instead in Java and then Swift.~~
* The Android implementation of Buttons now uses a Java rewrite of MakeHex. For iOS, we still need to implement the equivalent logic in Swift, since native C++ import is not feasible.

* ISM fragment is not using `sendCommand` properly again on iOS. It seems the background threading is more difficult than on Android. Can't quite get `BLEManager` to function the same as `BLEService` in Android.

* Retransmission over and over on iOS also fails a bit, needs a bit more work.

* Probably need some sort of universal indicator of the connection to the device, rather than having it on every single Fragment.

* Need to write README file properly too, including the EMWaver logo there, and basic repo instructions.

* Need to write a markdown `.md` file containing lots of info for any LLM to aid in development and modifications in the codebase.

* ~~Write firmware update code for OTA in ESP32~~

* Build website with MKDocs and add ESP Web Tools to it

* Further write Template Fragment

* Settings fragment also needs to have some stuff, not sure what

* Bad-USB fragment still needs to be written

* Buttons fragment needs to be written

* Remove test button from ISM Fragment. Add progress bar for all those register writes and reads

* Need to have BLE connection be as automatic as possible

* Implement some 2.4 GHz basic functionality on 2.4 GHz fragment

* Need a detection/warning for when any hardware is missing, cc1101, mfrc522, nrf24. Basic checks and warnings on chip status etc

* See why RFID range is really bad for some reason using the cheap module. Not sure if it's a board issue since I never tested it even with old USB CDC Protocol

* For BAD-USB, we need to write a NVS functionality as well, to make the ESP32 boot and immediatly inject payload that was saved to Non volatile storage NVS

* Lots of polishing required for the apps to then be accepted on App Store and Google Play Store. Bugs cleaning compreensively across every fragment and feature.

* Need to fix the RAM issue when recording for too long. Need a normal disk writing buffer strategy, maybe double buffer on RAM, this is for both IOS and Android

* Look into maybe increasing throughput from 100kbps to 200kbps just to get better resolution on recordings of 5us instead of 10us between samples. Not strictly needed as seen on IR transmission and so on, but something with some value to have




esptool.py --chip esp32s3 merge_bin \
  -o emwaver-v1.bin \
  --flash_mode dio --flash_freq 40m --flash_size 4MB \
  0x0     build/bootloader/bootloader.bin \
  0x8000  build/partition_table/partition-table.bin \
  0x10000 build/emwaveresp.bin


  