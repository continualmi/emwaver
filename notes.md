# Some tasks left to do

* The Android implementation of Buttons requires this MakeHex which is in C++. For iOS, we might not be able to do this native-C++ trick to import it. Let's rewrite the whole thing instead in Java and then Swift.

* ISM fragment is not using `sendCommand` properly again on iOS. It seems the background threading is more difficult than on Android. Can't quite get `BLEManager` to function the same as `BLEService` in Android.

* Retransmission over and over on iOS also fails a bit, needs a bit more work.

* Probably need some sort of universal indicator of the connection to the device, rather than having it on every single Fragment.

* Need to write README file properly too, including the EMWaver logo there, and basic repo instructions.

* Need to write a markdown `.md` file containing lots of info for any LLM to aid in development and modifications in the codebase.

* Write firmware update code for OTA in ESP32

* Further write Template Fragment

* Settings fragment also needs to have some stuff, not sure what

* Bad-USB fragment still needs to be written

* Buttons fragment needs to be written

* Remove test button from ISM Fragment. Add progress bar for all those register writes and reads

* Need to have BLE connection be as automatic as possible

* Implement some 2.4 GHz basic functionality on 2.4 GHz fragment

* Need a detection/warning for when any hardware is missing, cc1101, mfrc522, nrf24. Basic checks and warnings on chip status etc

* See why RFID range is really bad for some reason using the cheap module. Not sure if it's a board issue since I never tested it even with old USB CDC Protocol