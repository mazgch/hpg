
/*
 * Copyright 2022 by Michael Ammann (@mazgch)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// ESP32 libraries, version 2.0.5
//-----------------------------------
// Follow instruction on: https://docs.espressif.com/projects/arduino-esp32/en/latest/installing.html
// Install Arduino -> Preferences -> AdditionalBoard Manager URL, then in Board Manager add esp32 by EspressIf, 
// After that select Board u-blox NINA-W10 series and configure the target CPU: 240MHz, Flash: 80MHz, 4MB, Minimal SPIFFS
// Board Manager URL:    https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
// Github Repository:    https://github.com/espressif/arduino-esp32 

// Third parties libraries
//-----------------------------------

// ArduinoMqttClient by Arduino, version 0.1.5
// Library Manager:    http://librarymanager/All#ArduinoMqttClient   
// Github Repository:  https://github.com/arduino-libraries/ArduinoMqttClient 

// ArduinoWebsockets by Gil Maimon, version 0.5.3
// Library Manager:    http://librarymanager/All#ArduinoWebsockets   
// Github Repository:  https://github.com/gilmaimon/ArduinoWebsockets

// ArduinoJson by Benoit Blanchon, version 6.19.4
// Library Manager:    http://librarymanager/All#ArduinoJson      
// Github Repository:  https://github.com/bblanchon/ArduinoJson

// WiFiManager by Tapzu, version 2.0.13-beta
// Library Manager:    http://librarymanager/All#tzapu,WiFiManager  
// Github Repository:  https://github.com/tzapu/WiFiManager

// Arduino CAN by sandeepmistry, version 0.3.1
// Library Manager:   http://librarymanager/All#arduino-CAN
// Github Repository: https://github.com/sandeepmistry/arduino-CAN

// NimBLE-Arduino by h2zero, version 1.4.1
// Library Manager:   http://librarymanager/All#NimBLE-Arduino
// Github Repository: https://github.com/h2zero/NimBLE-Arduino

// Sparkfun libraries
//-----------------------------------

// SparkFun u-blox GNSS Arduino Library by Sparkfun Electronics, version 2.2.20
// Library Manager:    http://librarymanager/All#SparkFun_u-blox_GNSS_Arduino_Library
// Github Repository:  https://github.com/sparkfun/SparkFun_u-blox_GNSS_Arduino_Library

// SparkFun u-blox SARA-R5 Arduino Library by Sparkfun Electronics, version 1.1.5
// Library Manager:    http://librarymanager/All#SparkFun_u-blox_SARA-R5_Arduino_Library
// Github Repository:  https://github.com/sparkfun/SparkFun_u-blox_SARA-R5_Arduino_Library

// Header files of this project
//-----------------------------------
#include "LOG.h"        // Comment this if you do not want a separate log level for this application 
#include "HW.h"
#include "CONFIG.h"
#include "UBXFILE.h"
#include "BLUETOOTH.h"  // Comment this to save memory if not needed 
#include "WLAN.h"
#include "GNSS.h"
#include "LBAND.h"
#include "LTE.h"
#include "CANBUS.h"     // Comment this if not needed 

// ====================================================================================
// MAIN setup / loop
// ====================================================================================

/** Main Arduino setup function, initilizes all functions which spins off various tasks
*/
void setup(void) {
  // initialisation --------------------------------
  // serial port
  Serial.begin(115200);
  while (!Serial);
    /*nothing*/;
  log_i("-------------------------------------------------------------------");
  Config.init();
  String hwName = Config.getDeviceName();
  log_i("mazg.ch %s (%s)", Config.getDeviceTitle().c_str(), hwName.c_str());  
  logVersion();
  // SD card 
  UbxSd.init(); // handling SD card and files runs in a task
#ifdef __BLUETOOTH_H__
  Bluetooth.init(hwName);
#endif
  Wlan.init(); // WLAN runs in a tasks, creates an additional LED task 
  //Lte.enableDebugging(Serial);
  //Lte.enableAtDebugging(Serial); // we use UbxSerial for data logging instead
  //Lte.enableAtDebugging(Websocket); // forward all messages
  Lte.init();  // LTE runs in a task
  // i2c wire
  UbxWire.begin(I2C_SDA, I2C_SCL); // Start I2C
  UbxWire.setClock(400000); //Increase I2C clock speed to 400kHz
  if (!Gnss.detect()) { 
    log_w("GNSS ZED-F9 not detected, check wiring");
  }
  if (!LBand.detect()) {
    log_w("LBAND NEO-D9 not detected, check wiring");
  }
  
#ifdef __CANBUS_H__
  Canbus.init();
#endif
}

/** Main Arduino loop function is used to manage the GPS and LBAND communication 
*/
void loop(void) {
  LBand.poll();
  Gnss.poll();
  delay(50);

  logMemUsage();
}

// ====================================================================================
// Helpers
// ====================================================================================

#ifndef ESP_ARDUINO_VERSION
  #include <core_version.h>
#endif

/** Print the version number of the Arduino and ESP core. 
 */
void logVersion(void) {
#ifndef ESP_ARDUINO_VERSION
  log_i("Version IDF %s Arduino_esp32 %s", esp_get_idf_version(), ARDUINO_ESP32_RELEASE);
#else
  log_i("Version IDF %s Arduino_esp32 %d.%d.%d", esp_get_idf_version(),
        ESP_ARDUINO_VERSION_MAJOR,ESP_ARDUINO_VERSION_MINOR,ESP_ARDUINO_VERSION_PATCH);
#endif
}

const int DUMP_STACK_INTERVAL = 10000; //!< Dump interval in ms, set to 0 to disable
  
/** Helper function to diagnose the health of this application dumping the free stacks and heap.
*/
void logMemUsage(void) {
  int32_t now = millis();      
  static int32_t lastMs = 0;    
  // this code allows to print all the stacks of the different tasks
  if (DUMP_STACK_INTERVAL && (0 >= (lastMs - now))) {
    lastMs = millis() + DUMP_STACK_INTERVAL;
    char buf[128];
    int len = 0;
    const char* tasks[] = { pcTaskGetName(NULL), "Lte", "Wlan", "Bluetooth", "Led", "Can", "UbxSd" };
    for (int i = 0; i < sizeof(tasks)/sizeof(*tasks); i ++) {
      const char *name = tasks[i];
      TaskHandle_t h = xTaskGetHandle(name);
      if (h) {
        uint32_t stack = uxTaskGetStackHighWaterMark(h);
        len += sprintf(&buf[len], " %s %u", tasks[i], stack);
      }
    }
    log_i("tasks: %d stacks:%s heap: min %d cur %d size %d", uxTaskGetNumberOfTasks(), buf, ESP.getMinFreeHeap(), ESP.getFreeHeap(), ESP.getHeapSize());
  }
}
