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

// ESP32 libraries, version 2.0.9 (2.0.10 and higher crashes)
//-----------------------------------
// Follow instruction on: https://docs.espressif.com/projects/arduino-esp32/en/latest/installing.html
// Install Arduino -> Preferences -> AdditionalBoard Manager URL, then in Board Manager add esp32 by EspressIf, 
// After that select Board u-blox NINA-W10 series and configure the target CPU: 240MHz, Flash: 80MHz, 4MB, Minimal SPIFFS
// For the SparkFun RTK Everywhere: select the "ESP32 Wrover Module" and the "Huge APP" partition scheme
// Board Manager URL:    https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
// Github Repository:    https://github.com/espressif/arduino-esp32 

// Third parties libraries
//-------------------------------------------------------------------------------------

// ArduinoMqttClient by Arduino, version 0.1.8
// Library Manager:    http://librarymanager/All#ArduinoMqttClient   
// Github Repository:  https://github.com/arduino-libraries/ArduinoMqttClient 

// ArduinoWebsockets by Gil Maimon, version 0.5.3
// Library Manager:    http://librarymanager/All#ArduinoWebsockets   
// Github Repository:  https://github.com/gilmaimon/ArduinoWebsockets

// ArduinoJson by Benoit Blanchon, version 7.0.4
// Library Manager:    http://librarymanager/All#ArduinoJson      
// Github Repository:  https://github.com/bblanchon/ArduinoJson

// WiFiManager by Tzapu/Tablatronix, version 2.0.17
// Library Manager:    http://librarymanager/All#tzapu,WiFiManager  
// Github Repository:  https://github.com/tzapu/WiFiManager

// Arduino CAN by sandeepmistry, version 0.3.1
// Library Manager:   http://librarymanager/All#arduino-CAN
// Github Repository: https://github.com/sandeepmistry/arduino-CAN

// NimBLE-Arduino by h2zero, version 1.4.1
// Library Manager:   http://librarymanager/All#NimBLE-Arduino
// Github Repository: https://github.com/h2zero/NimBLE-Arduino

// Sparkfun libraries
//-------------------------------------------------------------------------------------

// SparkFun u-blox GNSS Arduino Library by Sparkfun Electronics, version 2.2.25
// Library Manager:    http://librarymanager/All#SparkFun_u-blox_GNSS_Arduino_Library
// Github Repository:  https://github.com/sparkfun/SparkFun_u-blox_GNSS_Arduino_Library

// SparkFun u-blox SARA-R5 Arduino Library by Sparkfun Electronics, version 1.1.11
// Library Manager:    http://librarymanager/All#SparkFun_u-blox_SARA-R5_Arduino_Library
// Github Repository:  https://github.com/sparkfun/SparkFun_u-blox_SARA-R5_Arduino_Library

// Header files of this project
// to remove LTE, BLUETOOTH, LBAND, CANBUS fucnztion simply comment to save memory, the 
// peripherial is however not put into low power mode or its pins remain uncontrolled 
//-------------------------------------------------------------------------------------
#include "LOG.h"          // Comment this if you do not want a separate log level for this application 
#include "HW.h"
#include "CONFIG.h"
#include "UBXFILE.h"
//#include "BLUETOOTH.h"  // Optional, Comment this to save memory if not needed, choose the flash size 4MB and suitable partition
#include "WLAN.h"
#include "GNSS.h"
#include "LBAND.h"        // Optional, comment this if not needed
#include "LTE.h"          // Optional, comment this if not needed,
//#include "CANBUS.h"     // Optional, comment this if not on vehicle using the CAN interface, CAN PHY is reqired 

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
  //              NINA-VCC / ADC-BITS * (R30  + R31)  / R31 * ADC-reading
  log_i("VIN: %.2fV", (3.3 / 4095.0   * (22e3 + 33e3) / 33e3) * analogRead(VIN));
  
  espVersion();
  // SD card 
  UbxSd.init(); // handling SD card and files runs in a task
#ifdef __BLUETOOTH_H__
  Bluetooth.init(hwName);
#endif
  Wlan.init(); // WLAN runs in a tasks, creates an additional LED task 
#ifdef __LTE_H__
  //Lte.enableDebugging(Serial);
  //Lte.enableAtDebugging(Serial); // we use UbxSerial for data logging instead
  //Lte.enableAtDebugging(Websocket); // forward all messages
  Lte.init();  // LTE runs in a task
#endif
  // i2c wire
  UbxWire.begin(I2C_SDA, I2C_SCL); // Start I2C
  UbxWire.setClock(400000); //Increase I2C clock speed to 400kHz
  if (!Gnss.detect()) { 
    log_w("GNSS ZED-F9 not detected, check wiring");
  }
#ifdef __LBAND_H__
  if (!LBand.detect()) {
    log_w("LBAND NEO-D9 not detected, check wiring");
  }
#endif  
#ifdef __CANBUS_H__
  Canbus.init();
#endif
}

/** Main Arduino loop function is used to manage the GPS and LBAND communication 
*/
void loop(void) {
#ifdef __LBAND_H__
  LBand.poll();
#endif
  Gnss.poll();
  delay(50);

  memUsage();
}

// ====================================================================================
// Helpers
// ====================================================================================

#ifndef ESP_ARDUINO_VERSION
  #include <core_version.h>
#endif
#if defined(ARDUINO_UBLOX_NINA_W10) && defined(ESP_ARDUINO_VERSION)
  #if (ESP_ARDUINO_VERSION > ESP_ARDUINO_VERSION_VAL(2, 0, 9))
    #error "Please downgrade your Arduino-esp32 to version 2.0.9 using the Board Manager"
    // for some reason 2.0.10 and at least until 2.0.15 crashes on NINA-W10 after boot with a flash CRC error
    // E (452) spi_flash: Detected size(128k) smaller than the size in the binary image header(2048k). Probe failed.
    // assert failed: do_core_init startup.c:328 (flash_ret == ESP_OK)
    // might be related to https://github.com/espressif/esp-idf/issues/12222
  #endif
#endif

/** Print the version number of the Arduino and ESP core. 
 */
void espVersion(void) {
#ifndef ESP_ARDUINO_VERSION
  log_i("Version IDF %s Arduino_esp32 %s", esp_get_idf_version(), ARDUINO_ESP32_RELEASE);
#else
  log_i("Version IDF %s Arduino_esp32 %d.%d.%d", esp_get_idf_version(),
        ESP_ARDUINO_VERSION_MAJOR,ESP_ARDUINO_VERSION_MINOR,ESP_ARDUINO_VERSION_PATCH);
#endif
}

const int MEM_USAGE_INTERVAL = 10000; //!< Dump interval in ms, set to 0 to disable
  
/** Helper function to diagnose the health of this application dumping the free stacks and heap.
*/
void memUsage(void) {
  int32_t now = millis();      
  static int32_t lastMs = now;    
  // this code allows to print all the stacks of the different tasks
  if (MEM_USAGE_INTERVAL && (0 >= (lastMs - now))) {
    lastMs = now + MEM_USAGE_INTERVAL;
    char buf[128];
    int len = 0;
    const char* tasks[] = { pcTaskGetName(NULL), "Lte", "Wlan", "Bluetooth", "UbxSd", "Led", "Can" };
    for (int i = 0; i < sizeof(tasks)/sizeof(*tasks); i ++) {
      const char *name = tasks[i];
      TaskHandle_t h = 0;
#if (ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(2, 0, 5))
      h = xTaskGetHandle(name);
#endif
      if (h) {
        uint32_t stack = uxTaskGetStackHighWaterMark(h);
        len += sprintf(&buf[len], " %s %u", tasks[i], stack);
      }
    }
    log_i("stacks:%s heap: min %d cur %d size %d tasks: %d", buf, 
          ESP.getMinFreeHeap(), ESP.getFreeHeap(), ESP.getHeapSize(), uxTaskGetNumberOfTasks());
  }
}
