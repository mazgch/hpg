#ifndef __BLUETOOTH_H__
#define __BLUETOOTH_H__

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>

const int BLUETOOTH_BUFFER_SIZE = 2*1024;
const int BLUETOOTH_STACK_SIZE  = 2*1024;      //!< Stack size of Bluetooth Logging task
const int BLUETOOTH_TASK_PRIO   =      1;
const int BLUETOOTH_TASK_CORE   =      1;

class BLUETOOTH : public BLECharacteristicCallbacks, public BLEServerCallbacks, public Stream {
public:
  BLUETOOTH(size_t size) : buffer{size} {
    mutex = xSemaphoreCreateMutex();
    maxLen = 0;
    idle = true;
    rxChar = NULL;
    txChar = NULL;
  }
    
  void init(String name) {
    BLEDevice::init(std::string(name.c_str()));
    BLEServer *server = BLEDevice::createServer();
    if (server) {
      server->setCallbacks(this);
      
      BLEService *service = server->createService(SERVICE_UUID);
      if (service) {
        rxChar = service->createCharacteristic(RXCHAR_UUID, BLECharacteristic::PROPERTY_WRITE);
        if (rxChar) {
          rxChar->setAccessPermissions(ESP_GATT_PERM_WRITE_ENCRYPTED);
          rxChar->addDescriptor(new BLE2902());
          rxChar->setWriteProperty(true);
          rxChar->setCallbacks(this);
        }
        txChar = service->createCharacteristic(TXCHAR_UUID, BLECharacteristic::PROPERTY_NOTIFY);
        if (txChar) {
          txChar->setAccessPermissions(ESP_GATT_PERM_READ_ENCRYPTED);
          txChar->addDescriptor(new BLE2902());
          txChar->setReadProperty(true);
          txChar->setCallbacks(this);
        }
        service->start();
      }
      BLEAdvertising *advertising = BLEDevice::getAdvertising(); 
      if (advertising) {
        advertising->addServiceUUID(SERVICE_UUID);
        advertising->setScanResponse(true);
        advertising->setMinPreferred(0x06); // functions that help with iPhone connections issue
        advertising->setMinPreferred(0x12);
        advertising->start();        
      }

      log_i("BLUETOOTH \"%s\" %d", name.c_str());
      xTaskCreatePinnedToCore(task, "Bluetooth", BLUETOOTH_STACK_SIZE, this, BLUETOOTH_TASK_PRIO, NULL, BLUETOOTH_TASK_CORE);
    }
  }

  static void task(void * pvParameters) {
    ((BLUETOOTH*) pvParameters)->task();
  }

  size_t task(void) {
    while(true) {
      size_t wrote = 0;
      bool loop;
      if (maxLen && (NULL != txChar)) {
        do {
          loop = false;
          if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
            uint8_t temp[512];
            size_t len = buffer.read((char*)temp, sizeof(temp));
            xSemaphoreGive(mutex);
            /*while (!idle)
              vTaskDelay(0);
            */
            if (0 < len) {
              idle = false;
              txChar->setValue(temp, len);
              txChar->notify(true);
              wrote += len;
            }
            loop = (len == sizeof(temp));
          }
          vTaskDelay(10); // Yield
        } while (loop);
        if (0 < wrote) {
          //Log.info("BLUETOOTH wrote %d bytes", wrote);
        } 
      }
      vTaskDelay(100); // Yield
    }
    return 0;
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
  void flush() override { /* nothing */ }
  int available() override { return 0; };
  int read() override { return -1; } 
  int peek() override  { return -1; }

protected:
  
  void onConnect(BLEServer *pServer)
  {
    int id = pServer->getConnId();
    maxLen = pServer->getPeerMTU(id) - 5;
    log_i("BLUETOOTH connected %d", maxLen);
  }
  
  void onDisconnect(BLEServer *pServer)
  {
    log_i("BLUETOOTH discconected");
    pServer->startAdvertising();
  }
  
  void onWrite(BLECharacteristic *pCharacteristic)
  {
    if (pCharacteristic->getUUID().toString() == RXCHAR_UUID)
    {
      std::string value = pCharacteristic->getValue();
      extern size_t GNSSINJECT_BLUETOOTH(const void* ptr, size_t len);
      GNSSINJECT_BLUETOOTH(value.c_str(), value.length());
    }
  }
  
protected:
  SemaphoreHandle_t mutex;
  cbuf buffer;
  BLECharacteristic *txChar;
  BLECharacteristic *rxChar;
  int maxLen;
  volatile bool idle;
  
  const char *SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const char *RXCHAR_UUID  = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
  const char *TXCHAR_UUID   = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
};

BLUETOOTH Bluetooth(BLUETOOTH_BUFFER_SIZE);

#endif // __BLUETOOTH_H__
