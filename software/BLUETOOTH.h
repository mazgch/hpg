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

const int BLUETOOTH_PACKET_DELAY  =          10; //!< Delay notifys by this not to overload the BLE stack  
const int BLUETOOTH_NODATA_DELAY  =          30; //!< Yield time to allow new data to become available 

const int BLUETOOTH_TX_SIZE       =         512; //!< Preferred (max) size of tx characteristics  
const int BLUETOOTH_BUFFER_SIZE   =      2*1024; //!< Local circular buffer to keep the data until we can send it. 
const int BLUETOOTH_MTU_OVERHEAD  =           3; //!< MTU overhead = 1 attribute opcode + 2 client receive MTU size 

const char* BLUETOOTH_TASK_NAME   = "Bluetooth"; //!< Bluetooth task name
const int BLUETOOTH_STACK_SIZE    =      3*1024; //!< Bluetooth task stack size
const int BLUETOOTH_TASK_PRIO     =           1; //!< Bluetooth task priority
const int BLUETOOTH_TASK_CORE     =           1; //!< Bluetooth task MCU code

/** This class encapsulates all BLUETOOTH functions. 
*/
class BLUETOOTH : public BLECharacteristicCallbacks, public BLEServerCallbacks, public Stream {

public:

  /** constructor
   *  \param size the size of the local cicular buffer
   */
  BLUETOOTH(size_t size) : buffer{size} {
    mutex = xSemaphoreCreateMutex();
    txChar = NULL;
    rxChar = NULL;
#ifdef UBLOX_UART
    fifoChar = NULL;
    creditChar = NULL;
#endif
    txSize = BLUETOOTH_TX_SIZE;
    connected = false;
  }
    
  /** initialize the object, this configures the peripherial and spins of a worker task. 
   *  \param name the device name
   */
  void init(String name) {
    BLEDevice::init(std::string(name.c_str()));
    NimBLEDevice::setPower(ESP_PWR_LVL_P9); /** +9db */
    NimBLEDevice::setMTU(BLUETOOTH_TX_SIZE + BLUETOOTH_MTU_OVERHEAD);
    BLEServer *server = BLEDevice::createServer();    
    if (server) {
      server->setCallbacks(this);
      BLEService *serNordic = server->createService(NORDIC_UART_SERVICE_UUID);
      if (serNordic) {
        txChar = serNordic->createCharacteristic(NORDIC_TX_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::NOTIFY);
        rxChar = serNordic->createCharacteristic(NORDIC_RX_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::WRITE);
        if (rxChar) {
          rxChar->setCallbacks(this);
        }
        serNordic->start();
      }
#ifdef UBLOX_UART
      BLEService *serUblox = server->createService(UBLOX_UART_SERVICE_UUID);
      if (serUblox) {
        fifoChar = serUblox->createCharacteristic(UBLOX_FIFO_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::NOTIFY);
        if (fifoChar) {
          fifoChar->setCallbacks(this);
        }
        creditChar = serUblox->createCharacteristic(UBLOX_CREDITS_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::NOTIFY);
        if (creditChar) {
          creditChar->setCallbacks(this);
        }
        serUblox->start();
      }
#endif
      BLEAdvertising *advertising = server->getAdvertising(); 
      if (advertising) {
        advertising->addServiceUUID(NORDIC_UART_SERVICE_UUID);
#ifdef UBLOX_UART
        advertising->addServiceUUID(UBLOX_UART_SERVICE_UUID);
#endif
        advertising->start();        
      }
      log_i("device \"%s\"", name.c_str());
      xTaskCreatePinnedToCore(task, BLUETOOTH_TASK_NAME, BLUETOOTH_STACK_SIZE, this, BLUETOOTH_TASK_PRIO, NULL, BLUETOOTH_TASK_CORE);
    }
  }

  // --------------------------------------------------------------------------------------
  // STREAM interface defined by Arduino
  // https://github.com/arduino/ArduinoCore-API/blob/master/api/Stream.h
  // --------------------------------------------------------------------------------------
  size_t write(uint8_t ch) override {
    int wrote = 0;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      if (buffer.size() > 1) { 
        wrote = buffer.write(ch);
      }
      xSemaphoreGive(mutex);
    }
    return wrote;
  }
  size_t write(const uint8_t *ptr, size_t size) override {
    int wrote = 0;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      if (buffer.size() > 1) { 
        wrote = buffer.write((const char*)ptr, size);
      }
      xSemaphoreGive(mutex);
    }
    return wrote;
  }
  void flush(void)    override { /*nothing*/ }
  int available(void) override { return   0; }
  int read(void)      override { return  -1; }
  int peek(void)      override { return  -1; }

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
    while(true) {
      size_t wrote = 0;
      bool loop = (NULL != txChar);
      while (loop) {
        if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
          uint8_t temp[txSize]; 
          size_t len = buffer.read((char*)temp, sizeof(temp));
          xSemaphoreGive(mutex);
          if (connected && (0 < len)) {
            if (NULL != txChar) {
              txChar->setValue(temp, len);
              txChar->notify(true);
            }
#ifdef UBLOX_UART
            if (NULL != creditChar) {
              uint8_t credits = 0xFE;
              creditChar->setValue(credits);
              creditChar->notify(true);
            }
            if (NULL != fifoChar) {
              fifoChar->setValue(temp, len);
              fifoChar->notify(true);
            }
#endif
            wrote += len;
          }
          loop = (len == sizeof(temp));
          vTaskDelay(BLUETOOTH_PACKET_DELAY); // Yield
        }
      }
      if (0 < wrote) {
        log_d("wrote %d bytes", wrote);
      }
      
      vTaskDelay(BLUETOOTH_NODATA_DELAY); // Yield
    }
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
    
  /* Callback to inform about data receive 
   * \param pCharacteristic pointer to the characteristic 
   */
  void onWrite(BLECharacteristic *pCharacteristic) {
    if (NULL != pCharacteristic) {
#ifdef UBLOX_UART
      if (pCharacteristic == creditChar) {
        uint8_t value = pCharacteristic->getValue<uint8_t>();
        log_i("credits %d", value); (void)value;
      } else if ((pCharacteristic == rxChar) || (pCharacteristic == fifoChar)) {
#else
      if (pCharacteristic == rxChar) {
#endif
        std::string value = pCharacteristic->getValue();
        extern size_t GNSS_INJECT_BLUETOOTH(const void* ptr, size_t len);
        int read = GNSS_INJECT_BLUETOOTH(value.c_str(), value.length());
        log_d("read %d bytes", read); (void)read;
      }
    }
  }

  /* Callback informing on MTU changes, this is needed to adjust the tx size
   * \param MTU   the maximum transmission unit, includes a 3 byte overhead
   * \param desc  the BLE GAP connection description 
   */
  void onMTUChange(uint16_t MTU, ble_gap_conn_desc* desc) {
    txSize = MTU - BLUETOOTH_MTU_OVERHEAD;
    log_i("mtu %d for id %d", MTU, desc->conn_handle);
  }
  
  SemaphoreHandle_t mutex;        //!< Protect the cbuf from cross task access
  cbuf buffer;                    //!< Local circular buffer to keep the data until we can send it. 
  int txSize;                     //!< Requested max size of tx characteristics (depends on MTU from client)
  volatile bool connected;        //!< True if a client is connected. 
  BLECharacteristic *txChar;      //!< the TX characteristics of the Nordic BLE Uart
  BLECharacteristic *rxChar;      //!< the RX characteristics of the Nordic BLE Uart
#ifdef UBLOX_UART
  BLECharacteristic *fifoChar;    //!< the FIFO characteristics of the u-blox BLE Uart
  BLECharacteristic *creditChar;  //!< the Credits characteristics of the u-blox BLE Uart
#endif
  
  const char *NORDIC_UART_SERVICE_UUID          = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"; //!< Nordic BLE Uart UUID
  const char *NORDIC_RX_CHARACTERISTIC_UUID     = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"; //!< Nordic BLE Uart RX UUID
  const char *NORDIC_TX_CHARACTERISTIC_UUID     = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"; //!< Nordic BLE Uart TX UUID
#ifdef UBLOX_UART
  const char *UBLOX_UART_SERVICE_UUID           = "2456e1b9-26e2-8f83-e744-f34f01e9d701"; //!< u-blox BLE Uart UUID
  const char *UBLOX_FIFO_CHARACTERISTIC_UUID    = "2456e1b9-26e2-8f83-e744-f34f01e9d703"; //!< u-blox BLE Uart FIFO UUID
  const char *UBLOX_CREDITS_CHARACTERISTIC_UUID = "2456e1b9-26e2-8f83-e744-f34f01e9d704"; //!< u-blox BLE Uart Credits UUID
#endif
};

BLUETOOTH Bluetooth(BLUETOOTH_BUFFER_SIZE); //!< The global Bluetooth / BLE peripherial object

#endif // __BLUETOOTH_H__
