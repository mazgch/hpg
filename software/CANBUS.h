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

#include <CAN.h>

/*  https://github.com/commaai/opendbc/ 
 *  has lots of information on different car models. Extracting CAN data is highly 
 *  vehicle specific and not standardized. You may need to change the code if ticks 
 *  should be used or data spreads accross two messages.  
 *  
 *  e.g. BMW https://github.com/commaai/opendbc/blob/master/bmw_e9x_e8x.dbc
 */
const long CAN_FREQ       = 500000;
const int CAN_MESSAGE_ID  = 416 /* BMW*/; 
#define CAN_SPEED(p)        (1e6/3600 /* kmh => mm/s */ *  0.103/* unit => km/h */ * (((p[1] & 0xF) << 8) | p[0]))
#define CAN_REVERSE(p)      (0x10 == (p[1] & 0x10))
#define CAN_ESF_MEAS_TXO LTE_DTR  // -> make a connection from this pin to ZED-RXI 

const int CAN_STACK_SIZE  = 1*1024; //!< Stack size of Bluetooth Logging task
const int CAN_TASK_PRIO   =      3;
const int CAN_TASK_CORE   =      1;
const char* CAN_TASK_NAME = "Can";

extern class CANBUS Canbus;

class CANBUS {
public: 
  void init() {
    xTaskCreatePinnedToCore(task, CAN_TASK_NAME, CAN_STACK_SIZE, this, CAN_TASK_PRIO, NULL, CAN_TASK_CORE);
  }

protected:
  typedef struct { uint32_t ttag; uint32_t data; } ESF_QUEUE_STRUCT;
  
  static void task(void * pvParameters) {
    Canbus.queue  = xQueueCreate(2, sizeof(ESF_QUEUE_STRUCT));
    if (CAN_ESF_MEAS_TXO != PIN_INVALID) {
      Serial2.begin(38400, SERIAL_8N1, -1/*no input*/, CAN_ESF_MEAS_TXO);
    }
    CAN.setPins(CAN_RX, CAN_TX);
    if (!CAN.begin(CAN_FREQ)) {
      //log_w("CAN init failed");
    } else {
      //log_i("CAN init %d successful", CAN_FREQ);
    }
    CAN.observe(); // make sure we never write
    CAN.onReceive(Canbus.onPushESFMeasFromISR);
    
    for (;;) {
      ESF_QUEUE_STRUCT meas;
      if( xQueueReceive(Canbus.queue,&meas,portMAX_DELAY) == pdPASS ) {
        Canbus.esfMeas(meas.ttag, &meas.data, 1);
        //log_i("CAN rx %d %08X", meas.ttag, meas.data);
      }
    }
  }
  
  // ATTENTION the callback is executed from an ISR only do essential things, no log_x calls please
  static void onPushESFMeasFromISR(int packetSize) {
    if (!CAN.packetRtr() && (CAN.packetId() == CAN_MESSAGE_ID) && (packetSize <= 8)) {
      uint32_t ms = millis();
      uint8_t packet[packetSize];
      for (int i = 0; i < packetSize; i ++) {
        packet[i] = CAN.read();
      }
      uint32_t speed = CAN_SPEED(packet);
      bool reverse = CAN_REVERSE(packet);
      speed = reverse ? -speed : speed;
      ESF_QUEUE_STRUCT meas = { ms, (11/*SPEED*/ << 24)  | (speed & 0xFFFFFF) };
      BaseType_t xHigherPriorityTaskWoken;
      if (xQueueSendToBackFromISR(Canbus.queue,&meas,&xHigherPriorityTaskWoken) == pdPASS ) {
        if(xHigherPriorityTaskWoken) {
          portYIELD_FROM_ISR();
        }
      }
    }
  }

  size_t esfMeas(uint32_t ttag, uint32_t* p, size_t num) {
    size_t i = 0;
    uint8_t m[6 + 8 + (4 * num) + 2];  
    m[i++] = 0xB5; // µ
    m[i++] = 0x62; // b
    m[i++] = 0x10; // ESF
    m[i++] = 0x02; // MEAS
    uint16_t esfSize = (8 + 4 * num);
    m[i++] = esfSize >> 0; 
    m[i++] = esfSize >> 8;
    m[i++] = ttag >> 0;
    m[i++] = ttag >> 8;
    m[i++] = ttag >> 16;
    m[i++] = ttag >> 24;
    uint16_t esfFlags = num << 11;
    m[i++] = esfFlags >> 0;
    m[i++] = esfFlags >> 8;
    uint16_t esfProvider = 0;
    m[i++] = esfProvider >> 0;
    m[i++] = esfProvider >> 8;
    for (int s = 0; s < num; s ++) {
      m[i++] = p[s] >> 0;
      m[i++] = p[s] >> 8;
      m[i++] = p[s] >> 16;
      m[i++] = p[s] >> 24;
    }
    uint8_t cka = 0;
    uint8_t ckb = 0;
    for (int c = 2; c < i; c++) {
      cka += m[c];
      ckb += cka;
    }
    m[i++] = cka;
    m[i++] = ckb;
    if (CAN_ESF_MEAS_TXO != PIN_INVALID) {
      i = Serial2.write(m, i)
    }
    return i;
  }

  xQueueHandle queue;
};

CANBUS Canbus;

#endif // __CANBUS_H__
