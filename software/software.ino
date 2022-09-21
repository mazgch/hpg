
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
// After that select Board u-blox NINA-W10 series and configure the target CPU: 240MHz, Flash: 80MHz, 4MB, Minimal or Minimal SPIFFS
// Board Manager URL:    https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
// Github Repository:    https://github.com/espressif/arduino-esp32 

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPIFFS.h>
#include <SPI.h> 
#include <SD.h>
#include <Wire.h>
#ifndef ESP_ARDUINO_VERSION
  #include <core_version.h>
#endif

// Third parties libraries
//-----------------------------------

// ArduinoMqttClient by Arduino, version 0.1.5
// Library Manager:    http://librarymanager/All#ArduinoMqttClient   
// Github Repository:  https://github.com/arduino-libraries/ArduinoMqttClient 
#include <ArduinoMqttClient.h>

// ArduinoWebsockets by Gil Maimon, version 0.5.3
// Library Manager:    http://librarymanager/All#ArduinoWebsockets   
// Github Repository:  https://github.com/gilmaimon/ArduinoWebsockets
#include <ArduinoWebsockets.h>

// ArduinoJson by Benoit Blanchon, version 6.19.4
// Library Manager:    http://librarymanager/All#ArduinoJson      
// Github Repository:  https://github.com/bblanchon/ArduinoJson
#include <ArduinoJson.h>

// WiFiManager by Tapzu, version 2.0.13-beta
// Library Manager:    http://librarymanager/All#tzapu,WiFiManager  
// Github Repository:  https://github.com/tzapu/WiFiManager
#include <WiFiManager.h>
#if defined(ARDUINO_UBLOX_NORA_W10) && defined(ESP_ARDUINO_VERSION) && (ESP_ARDUINO_VERSION < ESP_ARDUINO_VERSION_VAL(2,0,5))
  #error The WiFiManager triggers a race condition with ESP core > 2.3.0 -> please use Arduino_esp32 2.0.5 and 
#endif

// Sparkfun libraries
//-----------------------------------

// SparkFun u-blox GNSS Arduino Library by Sparkfun Electronics, version 2.2.15
// Library Manager:    http://librarymanager/All#SparkFun_u-blox_GNSS_Arduino_Library
// Github Repository:  https://github.com/sparkfun/SparkFun_u-blox_GNSS_Arduino_Library
#include <SparkFun_u-blox_GNSS_Arduino_Library.h>

// SparkFun u-blox SARA-R5 Arduino Library by Sparkfun Electronics, version 1.1.3
// Library Manager:    http://librarymanager/All#SparkFun_u-blox_SARA-R5_Arduino_Library
// Github Repository:  https://github.com/sparkfun/SparkFun_u-blox_SARA-R5_Arduino_Library
#include <SparkFun_u-blox_SARA-R5_Arduino_Library.h>

// UBXLIB 
//-----------------------------------
// Github Repository:  https://github.com/u-blox/ubxlib
// Execute: cd port/platform/arduino 
//          python3 u_arduino.py -o <ArduinoLibPath>/libraries/ubxlib
/* So for me this will do the job
   rm -rf /Users/michaelammann/Documents/Arduino/libraries/ubxlib
   cd /Users/michaelammann/Documents/GitHub/ubxlib_priv/port/platform/arduino
   python3 u_arduino.py -o /Users/michaelammann/Documents/Arduino/libraries/ubxlib
*/
#include <ubxlib.h>

// Header files of this project
//-----------------------------------
#include "HW.h"
#include "LOG.h"
#include "CONFIG.h"
#include "UBXFILE.h"
#include "WLAN.h"
#include "GNSS.h"
#include "LBAND.h"
#include "LTE.h"
//#include "CANBUS.h"

// ====================================================================================
// MAIN setup / loop
// ====================================================================================

void setup()
{
  // initialisation --------------------------------
  // serial port
#if ((CDC_RX != RX) || (CDC_TX != TX))
  Serial.begin(115200, SERIAL_8N1, CDC_RX, CDC_TX);
#else
  Serial.begin(115200);
#endif
  while (!Serial);
    /*nothing*/;
  //Log.init(LOG::LOG_LEVEL_DEBUG, &Serial);
  Log.info("-------------------------------------------------------------------");
  Config.init();
  Log.info("mazg.ch %s (%s)", Config.getDeviceTitle().c_str(), Config.getDeviceName().c_str());  
#ifndef ESP_ARDUINO_VERSION
  Log.info("Version IDF %s Arduino_esp32 %s", esp_get_idf_version(), ARDUINO_ESP32_RELEASE);
#else
  Log.info("Version IDF %s Arduino_esp32 %d.%d.%d", esp_get_idf_version(),
        ESP_ARDUINO_VERSION_MAJOR,ESP_ARDUINO_VERSION_MINOR,ESP_ARDUINO_VERSION_PATCH);
#endif
  // SD card 
  UbxSd.init(); // handling SD card and files runs in a task

  Wlan.init(); // WLAN runs in a tasks, creates an additional LED task 

#ifdef SPARKFUN_SARA_R5_ARDUINO_LIBRARY_H
  //Lte.enableDebugging(Serial);
  //Lte.enableAtDebugging(Serial); // we use UbxSerial for data logging instead
#ifdef WEBSOCKET_STREAM
  //Lte.enableAtDebugging(Websocket); // forward all messages
#endif  
  Lte.init();  // LTE runs in a task
#endif

#ifdef SPARKFUN_UBLOX_ARDUINO_LIBRARY_H
  // i2c wire
  UbxWire.begin(I2C_SDA, I2C_SCL); // Start I2C
  UbxWire.setClock(400000); //Increase I2C clock speed to 400kHz
#else
  uPortInit();
  uPortI2cInit(); // You only need this if an I2C interface is used
  uDeviceInit();
#endif
  if (!Gnss.detect()) { 
    Log.warning("GNSS ZED-F9 not detected, check wiring");
  }
  if (!LBand.detect()) {
    Log.warning("LBAND NEO-D9 not detected, check wiring");
  }

#ifdef __CANBUS_H__
  Canbus.init();
#endif
}

void loop()
{
  LBand.poll();
  Gnss.poll();
#ifdef __CANBUS_H__
  Canbus.poll();
#endif
#ifdef __CANBUS_H__
  delay(10);
#else
  delay(50);
#endif
}
