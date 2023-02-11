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

// ESP32 libraries, version 2.0.6
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

// ArduinoJson by Benoit Blanchon, version 6.20.1
// Library Manager:    http://librarymanager/All#ArduinoJson
// Github Repository:  https://github.com/bblanchon/ArduinoJson

// WiFiManager by Tapzu, version 2.0.14-beta
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

// SparkFun u-blox GNSS Arduino Library - v3 by Sparkfun Electronics, version 3.0.0
// Library Manager:    http://librarymanager/All#SparkFun_u-blox_GNSS_v3
// Github Repository:  https://github.com/sparkfun/SparkFun_u-blox_GNSS_v3

// SparkFun u-blox SARA-R5 Arduino Library by Sparkfun Electronics, version 1.1.5
// Library Manager:    http://librarymanager/All#SparkFun_u-blox_SARA-R5_Arduino_Library
// Github Repository:  https://github.com/sparkfun/SparkFun_u-blox_SARA-R5_Arduino_Library

// Header files of this project
//-----------------------------------
#include "LOG.h"        // Comment this if you do not want a separate log level for this application 
#include "HW.h"
#include "IPC.h"
#include "UBXIO.h"
#include "CONFIG.h"
#include "SDCARD.h"
#include "GNSS.h"
#include "LBAND.h"
#if (CAN_RX != PIN_INVALID) || (CAN_TX != PIN_INVALID)
 #include "CANBUS.h"     // Comment this if not on vehicle using the CAN interface
#endif
#include "BLUETOOTH.h"  // Comment this to save memory if not needed, choose the flash size 4MB and suitable partition, see line 22 above
#include "WLAN.h"
#include "LTE.h"

// ====================================================================================
// Helpers
// ====================================================================================

#ifndef ESP_ARDUINO_VERSION
  #include <core_version.h>
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

TickType_t cpuLastTicks[10] = { 0,0,0,0,0, 0,0,0,0,0 };
TickType_t cpuMaxTicks[10]  = { 0,0,0,0,0, 0,0,0,0,0 };

#define CPU_MEASURE(ix, code) \
    do { \
      TickType_t _tickstart = xTaskGetTickCount(); \
      code; \
      TickType_t _tickdelta = xTaskGetTickCount() - _tickstart; \
      if (cpuMaxTicks[ix] < _tickdelta) { \
        cpuMaxTicks[ix] = _tickdelta; \
      } \
      if (cpuLastTicks[ix] < _tickdelta) { \
        cpuLastTicks[ix] = _tickdelta; \
      } \
    } while (0)
    
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
    const char* tasks[] = { 
      pcTaskGetName(NULL), 
      WLAN_TASK_NAME, 
      LTE_TASK_NAME, 
#ifdef __CANBUS_H__
      CAN_TASK_NAME, 
#endif
    };
    for (int i = 0; i < sizeof(tasks)/sizeof(*tasks); i ++) {
      const char *name = tasks[i];
      TaskHandle_t h = xTaskGetHandle(name);
      if (h) {
        uint32_t stack = uxTaskGetStackHighWaterMark(h);
        len += sprintf(&buf[len], " %s %u", tasks[i], stack);
      }
    }
    len += sprintf(&buf[len], " ticks:");
    for (int i = 0; i < 10; i ++) {
      len += sprintf(&buf[len], " %u/%u", cpuLastTicks[i]/portTICK_RATE_MS, cpuMaxTicks[i]/portTICK_RATE_MS);
    }
    memset(cpuLastTicks,0,sizeof(cpuLastTicks));
    log_i("stacks:%s "
          "heap: min %d cur %d size %d "
          "queue: %d "
          "tasks: %d", buf, 
          ESP.getMinFreeHeap(), ESP.getFreeHeap(), ESP.getHeapSize(), 
          queueToCommTask.getMinFree(), 
          uxTaskGetNumberOfTasks());
  }
}
    
// ====================================================================================
// MAIN setup / loop
// ====================================================================================

const int LOOP_TASK_PRIO     =           2;  //!< Loop Task task priority
const int LOOP_TASK_RATE     =          50;  //!< 

/** Main Arduino setup function, initilizes all functions which spins off various tasks
*/
void setup(void) {
  // initialisation --------------------------------
  // serial port
  Serial.begin(115200);
  while (!Serial);
    /*nothing*/;
  log_i("-------------------------------------------------------------------");
  String hwName = Config.getDeviceName();
  log_i("hpg.mazg.ch %s (%s)", Config.getDeviceTitle().c_str(), hwName.c_str());  
  espVersion();
  Config.init();
  Wlan.init();            // runs in a task
  Lte.init();             // runs in a task

  if (!Gnss.detect()) { 
    log_w("GNSS ZED-F9 not detected, check wiring");
  }
  if (!LBand.detect()) {
    log_w("LBAND NEO-D9 not detected, check wiring");
  } 
#ifdef __CANBUS_H__
  Canbus.init();
#endif
  vTaskPrioritySet(NULL, LOOP_TASK_PRIO);
}

/** Main Arduino loop function is used to manage the GPS and LBAND communication 
*/

void loop(void) {
#ifdef __BLUETOOTH_H__
  CPU_MEASURE(0, Bluetooth.checkConfig());
#endif
  CPU_MEASURE(1, Websocket.checkClients());
  CPU_MEASURE(2, Sdcard.checkCard());
  CPU_MEASURE(3, LBand.poll());
  CPU_MEASURE(4, Gnss.poll());
  pipeWireToCommTask.flush();
  
  memUsage();
  
  MSG msg;
  int32_t endMs = millis() + LOOP_TASK_RATE;
  TickType_t ticks = pdMS_TO_TICKS(LOOP_TASK_RATE);
  while (queueToCommTask.receive(msg, ticks)) {
    //log_i("comm %s", msg.dump().c_str());
    // Any data from source Wire (this includes GNSS and LBAND data captured with setOutputPort) or SERIAL (RX / TX from LTE)
    if ((msg.src == MSG::SRC::WIRE) || (msg.hint == MSG::HINT::AT)) { 
      if (msg.src == MSG::SRC::WIRE) {
#ifdef __BLUETOOTH_H__
        CPU_MEASURE(5, Bluetooth.sendToClients(msg));
#endif
        CPU_MEASURE(6, Websocket.sendToClients(msg));
      }
      CPU_MEASURE(7, Sdcard.writeLogFiles(msg));
    } else {
      // text can only be sent to the websocket, anything else will go to the GNSS 
      if (msg.hint != MSG::HINT::TEXT) { 
        CPU_MEASURE(8, Gnss.sendToGnssParsed(msg));
      }
      // don't forward the KEYS (to avoid leaking) or any data from (LBAND / PMP-QZSSL6 (is already in the WIRE data from GNSS) 
      if (msg.hint != MSG::HINT::KEYS) {
        CPU_MEASURE(6, Websocket.sendToClients(msg)); // this may be useful to debug RTCM or SPARTN in the Monitor GUI
      }
    }
    int32_t timeout = endMs - millis();
    ticks = (timeout < 0) ? 0 : pdMS_TO_TICKS(timeout);
  }
}
