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
 
#ifndef __CANBUS_H__
#define __CANBUS_H__

// Arduino CAN by sandeepmistry, version 0.3.1
// Library Manager:   http://librarymanager/All#arduino-CAN
// Github Repository: https://github.com/sandeepmistry/arduino-CAN
#include <CAN.h>

const int CAN_TEST_ID  = 0x55;
const int CAN_SPEED_ID = 0x55;

class CANBUS {
public: 
  void init() {
    // start the CAN bus at 500kbps
    const int freq = 500E3; // use 250kbps in the Logic analyzer? unclear why
    CAN.setPins(CAN_RX, CAN_TX);
    if (!CAN.begin(freq)) {
      Log.warning("CAN init failed");
    } else {
      Log.info("CAN init %d successful", freq);
    }
    CAN.observe();
    // ATTENTION the callback is executed from an ISR only do essential things
    CAN.onReceive(onPushESFMeas); 
  }

  void poll() {
    //writeTestPacket(); // need to remove the CAN.observe mode above
  }

protected:
  void onPushESFMeas(int packetSize) {
    if (!CAN.packetRtr() && (CAN.packetId() == CAN_SPEED_ID)) {
      uint32_t ttag = millis();
      uint8_t packet[packetSize];
      for (int i = 0; i < packetSize; i ++) {
        packet[i] = CAN.read();
      }
      uint32_t speed = ((0xF & packet[1]) << 8) + packet[0];  // speed  12 bits from 0
      bool reverse = (0x10 & packet[1]) >> 4;        // bit 12 == moving reverse
      Gnss.pushEsfMeas(ttag, speed, reverse);
    }
  }

#if 0
  void onPacketDump(int packetSize) {
    char txt[packetSize+1] = "";
    if (!CAN.packetRtr()) {
      for (int i = 0; i < packetSize; i ++) {
        char ch = CAN.read();
        txt[i] = isprint(ch) ? ch : '?';
      }
    }
    else {
      packetSize = CAN.packetDlc();
      strcpy(txt, "RTR");
    } 
    Log.info("CAN read 0x%0*X %d \"%s\"", CAN.packetExtended() ? 8 : 3, CAN.packetId(), packetSize, txt);
  }

  void writeTestPacket(void) {
    int id = CAN_TEST_ID;
    uint8_t test[9];
    static uint8_t cnt = 0;
    int len = sprintf((char*)test, "mazgch%02X", cnt++); 
    CAN.beginPacket(id);
    CAN.write(test, len);
    CAN.endPacket();
    Log.info("CAN write 0x%03X %d \"%s\"", id, len, test);
  }
#endif
};

CANBUS Canbus;

#endif // __CANBUS_H__
