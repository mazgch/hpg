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
 *  e.g. example based on dbc file for BMW 
 *  https://github.com/commaai/opendbc/blob/master/bmw_e9x_e8x.dbc
 */
const long CAN_FREQ               =      500000;  //!< the frequency used on the CAN BUS
const int CAN_MESSAGE_ID          =         416;  //!< message ID used  
#define CAN_SPEED(p)                  ( 1e3/3.6 * /* km/h => mm/s */ \
                                          0.103 * /* unit => km/h */ \
                                     ( ((p[1] & 0x0F) << 8) | p[0]) ) //!< Speed value
#define CAN_REVERSE(p)                ( (p[1] & 0x10) == 0x10 )       //!< Reverse flag 

/*  This code converts the CAN packet into a ESF message. There are two options to inject CAN data: 
 *  1) We can't use the I2C in this case as I2C is loaded with other data being read and sent this may  
 *     introduce a large latency into this critical speed measurements. the code will put a message 
 *     infront of the IPC queue so that it is not delayed by other traffic. 
 *  2) Using UART/Serial interface to the ZED. For this you need to specify the serial port with 
 *     #CAN_ESF_MEAS_SERIAL and the TXD pin to use with #CAN_ESF_MEAS_TXO. A high prio task is used 
 *     to send this to the serial port. Maybe you can also dens it from the ISR directly to avoid 
 *     the extra memory.
 */

#define CAN_ESF_MEAS_SIZE(num)     (16+4*(num))

//#define CAN_ESF_MEAS_SERIAL             Serial2   //!< Serial port to use, comment this if you like the IPC and Wire

#ifdef CAN_ESF_MEAS_SERIAL
const int CAN_ESF_MEAS_BAUDRATE   =       38400;  //!< Baudrate used, ZED default is 38400 
#define CAN_ESF_MEAS_TXO                LTE_DTR   //!< Make a connection from this pin to ZED-RXI

const char* CAN_TASK_NAME         =       "Can";  //!< Can task name
const int CAN_STACK_SIZE          =      1*1024;  //!< Can task stack size
const int CAN_TASK_PRIO           =           4;  //!< Can task priority
const int CAN_TASK_CORE           =           1;  //!< Can task MCU code
#endif

extern class CANBUS Canbus;                       //!< Forward declaration of class

/** This class encapsulates all CAN functions. 
*/
class CANBUS {

public: 
  
  /** initialize the object, this configures the peripherial and spins of a worker task. 
   */
  void init(void) {
#ifdef CAN_ESF_MEAS_SERIAL
    queue = NULL;
    CAN_ESF_MEAS_SERIAL.begin(CAN_ESF_MEAS_BAUDRATE, SERIAL_8N1, -1/*no input*/, CAN_ESF_MEAS_TXO);
#endif
    CAN.setPins(CAN_RX, CAN_TX);
    if (!CAN.begin(CAN_FREQ)) {
      log_w("freq %d, failed", CAN_FREQ);
    } else {
      log_i("freq %d", CAN_FREQ);
#ifdef CAN_ESF_MEAS_SERIAL
      queue = xQueueCreate(2, sizeof(ESF_QUEUE_STRUCT));
      xTaskCreatePinnedToCore(task, CAN_TASK_NAME, CAN_STACK_SIZE, this, CAN_TASK_PRIO, NULL, CAN_TASK_CORE);
#endif
      CAN.observe(); // make sure we never write
      CAN.onReceive(onPushESFMeasFromISR);
    }
  }

protected:

#ifdef CAN_ESF_MEAS_SERIAL
  //! We need a simple struct to communicate the measuement and a ttag to the 
  typedef struct { 
    uint32_t ttag;    //!< time of can frame reception, sampled millis() 
    uint32_t data;    //!< the measurement in ESF-MEAS format
  } ESF_QUEUE_STRUCT; //!< struct used by teh queue
  xQueueHandle queue; //!< queue between ISR and task 
 
  /** FreeRTOS static task function, will just call the objects task function  
   *  \param pvParameters the Can object (this)
   */
  static void task(void * pvParameters) {
    ((CANBUS*) pvParameters)->task();
  }
  
  /* This task is pulling data from the queue and sending it as ESF-MEAS to the serial port
   */
  void task(void) {
    while (true) {
      ESF_QUEUE_STRUCT meas;
      if( xQueueReceive(queue,&meas,portMAX_DELAY) == pdPASS ) {
        uint8_t msg[CAN_ESF_MEAS_SIZE(1)];
        esfMeas(msg, meas.ttag, &meas.data, 1);
        CAN_ESF_MEAS_SERIAL.write(msg, sizeof(msg));
        log_v("esfMeas %d %08X", meas.ttag, meas.data);
      }
    }
  }
#endif

  /* ISR callback extracts the nedeed CAN frame and its measuremnts 
   * \note This callback is executed from an ISR only do essential things, so no log_x calls please.
   * \param packetSize the number of bytes in this frame
   */
  static void onPushESFMeasFromISR(int packetSize) {
    if (!CAN.packetRtr() && (CAN.packetId() == CAN_MESSAGE_ID) && (packetSize > 0) && (packetSize <= 8)) {
      // read the frame
      uint32_t ttag = millis();
      uint8_t packet[packetSize];
      for (int i = 0; i < packetSize; i ++) {
        packet[i] = CAN.read();
      }
      // convert the data buffer into a usable measurement, you may need to change this 
      uint32_t speed = CAN_SPEED(packet);
      bool reverse = CAN_REVERSE(packet);

      speed = reverse ? -speed : speed;
      uint32_t data = (11/*SPEED*/ << 24) | (speed & 0xFFFFFF);
#ifdef USE CAN_ESF_MEAS_SERIAL
      ESF_QUEUE_STRUCT msg = { ttag, data };
      // add it to a queue so that a task can take care. 
      BaseType_t xHigherPriorityTaskWoken;
      if (xQueueSendToBackFromISR(Canbus.queue,&msg,&xHigherPriorityTaskWoken) == pdPASS ) {
        if(xHigherPriorityTaskWoken) {
          portYIELD_FROM_ISR();
        }
      }
#else   
      // alloc a message buffer
      MSG msg(CAN_ESF_MEAS_SIZE(1), MSG::SRC::CANBUS, MSG::HINT::ESFMEAS);
      // create the UBX-ESF-MEAS message 
      esfMeas(msg.data, ttag, &data, 1);
      // and sent it to the front of the queue so that the have a very low delay into the receiver
      queueToCommTask.sendFrontIsr(msg);
#endif
    }
  }

  /* Output a ESF-MEAS message to the a port.  
   * \note This callback is executed from an ISR only do essential things, so no log_x calls please.
   * \param ptr   pointer to hold the ESF-MEAS message size buffer with CAN_ESF_MEAS_SIZE macro
   * \param ttag  time of can frame reception, sampled millis() 
   * \param pMeas pointer to measurements in ESF-MEAS format
   * \param nMeas number of measurements in pMeas
   * \return      the number of bytes written 
   */
  static size_t esfMeas(uint8_t *ptr, uint32_t ttag, uint32_t* pMeas, size_t nMeas) {
    size_t i = 0;
    ptr[i++] = 0xB5; // µ
    ptr[i++] = 0x62; // b
    ptr[i++] = 0x10; // ESF
    ptr[i++] = 0x02; // MEAS
    uint16_t esfSize = (8 + 4 * nMeas);
    ptr[i++] = esfSize >> 0; 
    ptr[i++] = esfSize >> 8;
    ptr[i++] = ttag >> 0;
    ptr[i++] = ttag >> 8;
    ptr[i++] = ttag >> 16;
    ptr[i++] = ttag >> 24;
    uint16_t esfFlags = nMeas << 11;
    ptr[i++] = esfFlags >> 0;
    ptr[i++] = esfFlags >> 8;
    uint16_t esfProvider = 0;
    ptr[i++] = esfProvider >> 0;
    ptr[i++] = esfProvider >> 8;
    for (int s = 0; s < nMeas; s ++) {
      ptr[i++] = pMeas[s] >> 0;
      ptr[i++] = pMeas[s] >> 8;
      ptr[i++] = pMeas[s] >> 16;
      ptr[i++] = pMeas[s] >> 24;
    }
    uint8_t cka = 0;
    uint8_t ckb = 0;
    for (int c = 2; c < i; c++) {
      cka += ptr[c];
      ckb += cka;
    }
    ptr[i++] = cka;
    ptr[i++] = ckb;
    return i;
  }

};

CANBUS Canbus; //!< The global CAN peripherial object

#endif // __CANBUS_H__
