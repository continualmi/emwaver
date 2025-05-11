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
* See why RFID range is really bad for some reason using the cheap module. Not sure if it's a board issue since I never tested it even with old USB CDC Protocol
* Need a detection/warning for when any hardware is missing, cc1101, mfrc522, nrf24. Basic checks and warnings on chip status etc (actually just the mfrc522 is needed)
* Clean out nrf24 code from esp32. Nrf24 is advanced functionality and not required here
* Need to write README file properly too, including the EMWaver logo there, and basic repo instructions. (stil may require some modifications)
* Need to write a markdown `.md` file containing lots of info for any LLM to aid in development and modifications in the codebase.
* Need to revisit and refactor the command structure. Things like the cc1101 commands should start with cc1101 in the string, same with rfid commands. Like the current usb commands work. 
* Remove all fragments that were removed on android, 2.4 ghz, bad usb, firmwre update, template.
* Rename BLE fragment to EMwwaver fragment.
* Migrate to new esp32 command structure, rfid, cc1101 and mfrc522 nomenclature 
* ISM fragment is not using `sendCommand` properly again on iOS. It seems the background threading is more difficult than on Android. Can't quite get `BLEManager` to function the same as `BLEService` in Android.
* Implement Buttons fragment working for CC1101 and BLEService scripts
* Need better UI pattern. Lets start with Console View, and try and get it to look like Console Fragment a bit more . Collapsible views
* The navigation needs attention. There is "back" button that opens the side drawer, why? we need a three dashes icon like android. (fixed the status bar but kept the back arrow UI)
* RFID view UI is not great, the response command is at the bottom. In fact all views are not great, title occupies a lot of space and etc. (its fine, with the title gone there is some space)
* Get rid of the connect UI on each view, only connect UI is on EMWaver view
* EMWaver view using more GPIO pins than necessary, only need the ones on the board. same with sampler, fixed
* Might be good to do GPIO control on a dedicated fragment. In fact that makes a lot of sense now that I think about it. With the version checking button, testing commands is easy on EMWaver fragment, so we dont need the GPIO testing there either (done on IOS)
* Fix small issue with navigation on android, cant go back to emwaver fragment
* ISM Fragment should show registers immediatly, remove the "actions" ui
* Add versioning to IOS and fix EMWaver fragment
* Need to fix the freezing that happens when we are loading the registers on ISM View
* Fix the scrolling on Sampler view not working if finger on charts
* Editing keys on Console View does not work, the page it brings up is blank
* Implement Load From Storage on IOS, both Console and Buttons
On console and buttons fragments on android, we have a way to save files and load them from storage, be it signals or scripts. On IOS, is this possible to achieve? (done on Console)
* UX on buttons view is not great, clicking stuff often does nothing. Needs attention
* When opening keyboards on IOS, we need to be careful since it has no back button, so we need a way to close it, perhaps this feature already exists on the keyboard just needs to be added
* Add automatic connection on IOS
* Implement encodeIR logic, ported from android
On the android side, we ported the encodeIR logic into Java, which came from a repo called MakeHex. Anyway, we need to do the same for IOS, so we can use it on the Console fragment with scripting. Start by porting the classes exactly the same from java to swift, since they work fine on java. Port the full code, complete port.
* Implement and test IRDB loading of remotes and using generated encodeIR scripts
On android, on the Buttons fragment, we have an option to load remotes from IRDB, which works well. Lets do that on IOS as well, adding it to the Buttons view. Notice how it works on android. We take a link from the github, and then pull the remote from there, creating the final json with all the scripts. Each button has a specific script that encodes the signal into byte form, and then sends it over using the same routine we have on the sampler transmit, and selecting the correct GPIO.
* on buttons, need to fix the script to send a single code, and remove the test infrared scripts from console
* Fix on buttons view, when we have too many buttons, the UX becomes unusable
* Add feedback to Convert to IR button
* Integrate buffer transmission and encode ir into buttons fragment when loading from IRDB, the script
* Retransmission over and over on iOS also fails a bit, needs a bit more work. (its fine, it was the buffer thing)
* Consider having the BLE service check for connections periodically even on other fragments (done)
* Make Sampler, RFID and ISM have the same gray background as the nicely done console and buttons fragments. Requires some prompting with 2.5 pro to get the same styling in. (nah)
* Need to find a way to cross check all functionality, like see if editng settings in cc1101 is working, and writing rfid cards etc. Need a set of compreensive testing that targets all possibilities (building that list bellow)
* Make sure tuo update default IR script on buttons IRDB, adding the 0x20 missing from the transmit command
* Clean up dependencies from old USB Serial libraries
On the android, we have a redatacted imports for USB Serial libraries. In fact, clean up all USB functionality from android, since we only use BLE now

# Not Done

* Settings fragment also needs to have some stuff, not sure what
* Lots of polishing required for the apps to then be accepted on App Store and Google Play Store. Bugs cleaning compreensively across every fragment and feature.
* Cross examine ISM Fragment, test it thorougly
* Resolve warnings in firmware
* Add help link to documentation website (where there are videos and stuff) on Settings Activity. Add also there the Project repository perhaps link
* Add "?" help button UI to every non obvious function. Make UI in sampler more intuitive using this and also labling for example the spinner for selecting a pin
* Need to fully write the techincal implementation 1:1 according to the entire codebase. At that point, the commands should all be listed in a section for better readability. Simplicity is the best approach. We keep a single md file for the technical docs.
* Consider adding a OpenRouter LLM key setting, and a button to prompt and generate console scripts
* Just need to test the app without debuggin mode to avoid hangs, see if it rolls good then
* Implement external storage for signals on sampler
* Fix zoom on Sampler
* Need to understand the current BLE command structure on IOS, in order to document it etc
* To ensure compatibility between Android and IOS scriptng, need to ensure all scripts that run on IOS run the same on Android
* Note on code clean up: lots of printing, useless functionality deep in the code base. need to inspect codebase with some time
* Consider adding a warning when we try to retransmit on the IR RX pin, since it does seem to crash it
* EMWaver icon instead of home icon on IOS
* Look into if its a problem it not transmitting when we dont have half buffer on sampler, requiring multiple fills
* Minor: add help button explaining what the convert to IR is, android and ios
On both android and IOS, lets add help buttons on the Sampler, on convert IR button 
* Minor: Referesh chart after clearing it to make signal go away
* Dark mode colors on buttons fragment are not good, border the same color ar background
* On android ISM , we should have a dialog show up for the loading, and empty parameters if we are not connected and it doestn load, so its not blank, like IOS
* Minor improvement on android Sampler: make the record/stop a single button, side by side with transmit, like on OIS
* Be able to change individual register values in ISM view
* Disconnect button does nothing since it reconnects automatically straight away


## Hardware

* Noticed on x ray reports that the USB male port pads as not aligning with the component. Also noticed that from the 2 prototype boards, one does not work in reverse cable connection. This might suggest a soldering problem. May need to draw my own footprint
* Interestingly, currently I dont have a 5V pin on the GPIO headers. However, there is value in powering EMWaver with a battery, taking advantage of the power pins. But with only the 3V3 pin, it would not work, as the IR LEDs use 5V.

## List of tests that need to pass (and running them provides more bugs to fix):

RFID:
* Read/Write rfid cards without a issue. Edit and play around with keys and access control as per mifare protocol. Clone cards easily.
ISM:
* Capture Tesla signal, Retransmit, check RTL-SDR for integrity
* On console scripts, must be able to do the same but packetized Tesla signal
* Must be able to change individual registers on ism view. try one that we can verify with certainty that it worked
IR:
* Record and retransmit IR signals after conversion (already working)
* Import a toshiba tv remote and test (already working)
CONSOLE:
* Must be able to send various characters such as CTRL, SHIFT, etc. Must have a working Never gonna give you up script
* Must be able to access all other fuctionality through javascripts that are the same on both IOS and android. This requires functions and porting to javascript of all functionality on both sides

  


## Build Commands

esptool.py --chip esp32s3 merge_bin \
  -o emwaver-v1.bin \
  --flash_mode dio --flash_freq 40m --flash_size 4MB \
  0x0     build/bootloader/bootloader.bin \
  0x8000  build/partition_table/partition-table.bin \
  0x10000 build/emwaveresp.bin