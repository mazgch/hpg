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

#include <CAN.h>
 
uint8_t BUTTON            = 2; // if HIGH ouputs 0 speed, if LOW outputs a sine wave
uint8_t CAN_RX            = 4; // connect this to a Can PHY
uint8_t CAN_TX            = 5; // connect this to a Can PHY
const long CAN_FREQ       = 500000;
const int CAN_RATE        = 100; // 10 Hz
const int CAN_MESSAGE_ID  = 416; // BMW speed message id

long ms;
int ang = 0;

void setup() {
  Serial.begin(115200);
  while (!Serial)
    /*nothing*/;
  Serial.print("CAN emulator\n"); 
  pinMode(BUTTON, INPUT_PULLUP);
              
  ms = millis();
  CAN.setPins(CAN_RX, CAN_TX);
  if (!CAN.begin(CAN_FREQ)) {
    Serial.println("CAN init failed");
  } else {
    Serial.printf("CAN init %d successful\n", CAN_FREQ);
  }
}

void loop() {
  if (millis() - ms >= CAN_RATE) {
    ms += CAN_RATE;
    if (digitalRead(BUTTON) == HIGH) {
      ang = 0;
    }
    int speed = (int) (512.0 * sin(0.1 * ang));
    ang ++;
    uint8_t packet[8];
    memset(packet, 0, sizeof(packet));
    if (speed < 0) {
      speed = -speed;
      packet[1] |= 0x10;
    }
    packet[0] = speed & 0xFF;
    packet[1] |= ((speed >> 8) & 0x0F);
    Serial.printf("CAN write %d %02X %02X\n", ms, packet[0], packet[1]);
    CAN.beginPacket(CAN_MESSAGE_ID);
    CAN.write(packet, sizeof(packet));
    CAN.endPacket();
  }
  delay(0);
  
}
