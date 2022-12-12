#ifndef __BLUETOOTH_H__
#define __BLUETOOTH_H__

#include <NimBLEDevice.h>

const int BLUETOOTH_PACKET_DELAY  =    10;
const int BLUETOOTH_NODATA_DELAY  =    30;

const int BLUETOOTH_MAX_NOTIFY    =    252;
const int BLUETOOTH_BUFFER_SIZE   = 2*1024;
const int BLUETOOTH_STACK_SIZE    = 3*1024; //!< Stack size of Bluetooth Logging task
const int BLUETOOTH_TASK_PRIO     =      1;
const int BLUETOOTH_TASK_CORE     =      1;
const char* BLUETOOTH_TASK_NAME   = "Bluetooth";

class BLUETOOTH : public BLECharacteristicCallbacks, public BLEServerCallbacks, public Stream {
public:
  BLUETOOTH(size_t size) : buffer{size} {
    mutex = xSemaphoreCreateMutex();
    txChar = NULL;
    rxChar = NULL;
    connected = false;
  }
    
  void init(String name) {
    BLEDevice::init(std::string(name.c_str()));
    //NimBLEDevice::setPower(ESP_PWR_LVL_P9); /** +9db */
    BLEServer *server = BLEDevice::createServer();    
    if (server) {
      
      server->setCallbacks(this);
      BLEService *service = server->createService(UART_SERVICE_UUID);
      if (service) {
        txChar = service->createCharacteristic(TX_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::NOTIFY);
        rxChar = service->createCharacteristic(RX_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::WRITE);
        if (rxChar) {
          rxChar->setCallbacks(this);
        }
        service->start();
      }
      BLEAdvertising *advertising = server->getAdvertising(); 
      if (advertising) {
        advertising->addServiceUUID(UART_SERVICE_UUID);
        advertising->start();        
      }
      log_i("device \"%s\"", name.c_str());
      xTaskCreatePinnedToCore(task, BLUETOOTH_TASK_NAME, BLUETOOTH_STACK_SIZE, this, BLUETOOTH_TASK_PRIO, NULL, BLUETOOTH_TASK_CORE);
    }
  }

  // Stream
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
  void flush(void)    override { /* nothing */ }
  int available(void) override { return 0; };
  int read(void)      override { return -1; } 
  int peek(void)      override { return -1; }

protected:

  static void task(void * pvParameters) {
    ((BLUETOOTH*) pvParameters)->task();
  }

  void task(void) {
    while(true) {
      size_t wrote = 0;
      bool loop = (NULL != txChar);
      while (loop) {
        if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
          uint8_t temp[BLUETOOTH_MAX_NOTIFY]; // limit 
          size_t len = buffer.read((char*)temp, sizeof(temp));
          xSemaphoreGive(mutex);
          if (connected && (0 < len)) {
            txChar->setValue(temp, len);
            txChar->notify(true);
            wrote += len;
          }
          vTaskDelay(BLUETOOTH_PACKET_DELAY); // Yield
          loop = (len == sizeof(temp));
        }
      }
      if (0 < wrote) {
        log_d("wrote %d bytes", wrote);
      }
      vTaskDelay(BLUETOOTH_NODATA_DELAY); // Yield
    }
  }
  
  void onConnect(NimBLEServer *pServer) {
    log_i("connected");
    connected = true;
  }
  
  void onDisconnect(NimBLEServer *pServer) {
    log_i("disconnected");
    connected = false;
    //pServer->startAdvertising();
  }
    
  void onWrite(BLECharacteristic *pCharacteristic) {
    if (pCharacteristic == rxChar) {
      std::string value = pCharacteristic->getValue();
      extern size_t GNSSINJECT_BLUETOOTH(const void* ptr, size_t len);
      int read = GNSSINJECT_BLUETOOTH(value.c_str(), value.length());
      log_d("read %d bytes", read); (void)read;
    }
  }
  
  SemaphoreHandle_t mutex;
  cbuf buffer;
  BLECharacteristic *txChar;
  BLECharacteristic *rxChar;
  volatile bool connected;
  
  const char *UART_SERVICE_UUID      = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
  const char *RX_CHARACTERISTIC_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E";
  const char *TX_CHARACTERISTIC_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E";
};

BLUETOOTH Bluetooth(BLUETOOTH_BUFFER_SIZE);

#endif // __BLUETOOTH_H__
