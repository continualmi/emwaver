Some tasks left to do:


- the android implementation of Buttons requires this MakeHex which is in cpp. For IOS, we might not be able to do this native-cpp trick to import it. Lets rewrite the whole thing instead in java and then swift

- ISM fragment is not using sendCommand properly again on IOS. It seems the background threding is more difficult than on Android. Cant quite get BLEManager to function the same as BLEService in android.