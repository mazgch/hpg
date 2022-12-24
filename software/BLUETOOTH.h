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
 
#ifndef __BLUETOOTH_H__
#define __BLUETOOTH_H__

#include <NimBLEDevice.h>

/** Flag to select the BLE serial service
 *  true:  u-blox SPS service (SPS_SERVICE_UUID) 
 *  false: Nordic BLE Uart (NUS_SERVICE_UUID)
 *  
 *  \note  if you use SPS but like to disable flow control change the init() function
 */
#define BLUETOOTH_SERVICE         (false ? SPS_SERVICE_UUID : NUS_SERVICE_UUID)

const int BLUETOOTH_PACKET_DELAY  =           1;  //!< Delay notifys by this not to overload the BLE stack  
const int BLUETOOTH_TX_SIZE       =         512;  //!< Preferred (max) size of tx characteristics  
const int BLUETOOTH_MTU_OVERHEAD  =           3;  //!< MTU overhead = 1 attribute opcode + 2 client receive MTU size 

const char* BLUETOOTH_TASK_NAME   = "Bluetooth";  //!< Bluetooth task name
const int BLUETOOTH_STACK_SIZE    =      2*1024;  //!< Bluetooth task stack size
const int BLUETOOTH_TASK_PRIO     =           1;  //!< Bluetooth task priority
const int BLUETOOTH_TASK_CORE     =           1;  //!< Bluetooth task MCU code

/** This class encapsulates all BLUETOOTH functions. 
*/
class BLUETOOTH : public BLECharacteristicCallbacks, public BLEServerCallbacks {

public:

  /** constructor
   *  \param size the size of the local cicular buffer
   */
  BLUETOOTH() {
    txChar = NULL;
    rxChar = NULL;
    creditsChar = NULL;
    txSize = BLUETOOTH_TX_SIZE;
    txCredits = SPS_CREDITS_DISCONNECT;
    connected = false;
  }
    
  /** initialize the object, this configures the peripherial and spins of a worker task. 
   *  \param name the device name
   */
  void init(String name) {
    BLEDevice::init(std::string(name.c_str()));
    NimBLEDevice::setPower(ESP_PWR_LVL_P9); /** +9db */
    NimBLEDevice::setMTU(BLUETOOTH_TX_SIZE + BLUETOOTH_MTU_OVERHEAD);
    BLEAdvertising *advertising = NULL;
    BLEServer *server = BLEDevice::createServer();    
    if (server) {
      server->setCallbacks(this); 
      BLEService *service = server->createService(BLUETOOTH_SERVICE);
      if (service) {
        if (BLUETOOTH_SERVICE == SPS_SERVICE_UUID) {
          const uint32_t properties = NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR | NIMBLE_PROPERTY::NOTIFY;
          // the SPS uses the same characteristics for RX and TX channels
          rxChar = txChar = service->createCharacteristic(SPS_FIFO_CHARACTERISTIC_UUID, properties);
          // credits are optional and only needed for SPS with flow control
          creditsChar = service->createCharacteristic(SPS_CREDITS_CHARACTERISTIC_UUID, properties); // [optional]
          if (creditsChar) {
            creditsChar->setCallbacks(this);
          }
        } else {
          txChar = service->createCharacteristic(NUS_TX_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::NOTIFY);
          rxChar = service->createCharacteristic(NUS_RX_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::WRITE);
        }        
        if (rxChar) {
          rxChar->setCallbacks(this);
        }
        service->start();
        advertising = server->getAdvertising();
      }
    }
    if (txChar && rxChar && advertising) {
      advertising->addServiceUUID(BLUETOOTH_SERVICE);
      advertising->start();        
      log_i("device \"%s\" mode \"%s\"", name.c_str(), (BLUETOOTH_SERVICE == SPS_SERVICE_UUID) ? "SPS" : "NUS");
    } else {
      log_e("setup failed");
    }
    xTaskCreatePinnedToCore(task, BLUETOOTH_TASK_NAME, BLUETOOTH_STACK_SIZE, this, BLUETOOTH_TASK_PRIO, NULL, BLUETOOTH_TASK_CORE);
  }

protected:

  /* FreeRTOS static task function, will just call the objects task function  
   * \param pvParameters the Bluetooth object  (this)
   */
  static void task(void * pvParameters) {
    ((BLUETOOTH*) pvParameters)->task();
  }

  /* This task is pulling data from the circular buffer and sending it to the 
   * connected clients usining Bluetooth. 
   */
  void task(void) {
    MSG msg;
    while (queueToBluetooth.receive(msg)) {
      size_t index = 0;
      while ((index < msg.size) && (txSize > 0) && connected && (!creditsChar || (SPS_CREDITS_DISCONNECT != txCredits))) {
        if (!creditsChar || (0 < txCredits)) {
          int len = msg.size - index;
          if (len > txSize) len = txSize;
          if (len >= 0) {
            if (0 < len) {
              txChar->setValue(msg.data + index, len);
              txChar->notify(true);
              if (creditsChar && (0 < len)) {
                  txCredits --;
              }
              index += len;
            }
          }
        }
        vTaskDelay(pdMS_TO_TICKS(BLUETOOTH_PACKET_DELAY)); // Yield
      }
    }
    // will never get here ...
  }

  /* Callback to inform about connections  
   * \param pServer pointer to the server 
   */
  void onConnect(NimBLEServer *pServer) {
    log_i("connected");
    connected = true;
  }
  
  /* Callback to inform about disconnections  
   * \param pServer pointer to the server 
   */
  void onDisconnect(NimBLEServer *pServer) {
    log_i("disconnected");
    connected = pServer->getConnectedCount();
    // pServer->startAdvertising();
  }
    
  /* Callback informing on MTU changes, this is needed to adjust the tx size
   * \param MTU   the maximum transmission unit, includes a 3 byte overhead
   * \param desc  the BLE GAP connection description 
   */
  void onMTUChange(uint16_t MTU, ble_gap_conn_desc* desc) {
    txSize = MTU - BLUETOOTH_MTU_OVERHEAD;
    log_i("mtu %d for id %d", MTU, desc->conn_handle);
  }
  
  /* Callback to inform about data receive 
   * \param pCharacteristic pointer to the characteristic 
   */
  void onWrite(BLECharacteristic *pCharacteristic) {
    if (pCharacteristic) {
      if (pCharacteristic == creditsChar) {
        int8_t credits = pCharacteristic->getValue<uint8_t>();
        if (SPS_CREDITS_DISCONNECT == credits) {
          txCredits = SPS_CREDITS_DISCONNECT;
          log_d("disconnect");
        } else if (SPS_CREDITS_DISCONNECT == txCredits) {
          // upon connection we send our credits 
          creditsChar->setValue(SPS_CREDITS_MAX);
          creditsChar->notify(true);
          txCredits = credits;
          log_d("credits %d", txCredits);
        } else  {
          txCredits += credits;
          log_d("credits %d added %d", txCredits, credits);
        } 
      } else if (pCharacteristic == rxChar) {
        size_t len = pCharacteristic->getDataLength();
        MSG msg(pCharacteristic->getValue().c_str(), len, MSG::SRC::BLUETOOTH, MSG::CONTENT::CORRECTIONS);
        queueToGnss.send(msg);
        if (creditsChar)  {
          // we consumed a packed, give a credit back
          creditsChar->setValue(1);
          creditsChar->notify(true);
        }
        log_v("read %d bytes", len);
      }
    }
  }

  size_t txSize;                   //!< Requested max size of tx characteristics (depends on MTU from client)
  volatile int8_t txCredits;       //!< the number of packet credits we are allowed to send 
  volatile bool connected;         //!< True if a client is connected. 
  BLECharacteristic *txChar;       //!< the TX characteristics of the Nordic BLE Uart / fifo characteristics of the u-blox BLE SPS service
  BLECharacteristic *rxChar;       //!< the RX characteristics of the Nordic BLE Uart / fifo characteristics of the u-blox BLE SPS service
  BLECharacteristic *creditsChar;  //!< the Credits characteristics of the u-blox BLE Uart
 
  // SPS - u-blox Bluetooth Low Energy Serial Port Service
  const int8_t SPS_CREDITS_MAX                = 32;   //!< the we can receive a lot of data, just set the max value, -1 means reject/disconnect 
  const int8_t SPS_CREDITS_DISCONNECT         = -1; //!< credit value that indicates a disconnect
  const char *SPS_SERVICE_UUID                = "2456e1b9-26e2-8f83-e744-f34f01e9d701"; //!< SPS UUID
  const char *SPS_FIFO_CHARACTERISTIC_UUID    = "2456e1b9-26e2-8f83-e744-f34f01e9d703"; //!< SPS FIFO UUID
  const char *SPS_CREDITS_CHARACTERISTIC_UUID = "2456e1b9-26e2-8f83-e744-f34f01e9d704"; //!< SPS Credits UUID
  // NUS - Nordic Bluetooth LE GATT Nordic UART Service
  const char *NUS_SERVICE_UUID                = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"; //!< NUS UUID
  const char *NUS_RX_CHARACTERISTIC_UUID      = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"; //!< NUS RX UUID
  const char *NUS_TX_CHARACTERISTIC_UUID      = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"; //!< NUS TX UUID
};

BLUETOOTH Bluetooth; //!< The global Bluetooth / BLE peripherial object

#endif // __BLUETOOTH_H__
