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
 
#ifndef __UBXFILE_H__
#define __UBXFILE_H__

#include <Wire.h>
#include <SPI.h> 
#include <SD.h>
#include <cbuf.h> 

const int UBXSERIAL_BUFFER_SIZE   =      0*1024;  //!< Size of circular buffer, typically AT modem gets bursts upto 9kB of MQTT data, but 2kB is also fine
const int UBXWIRE_BUFFER_SIZE     =     12*1024;  //!< Size of circular buffer, typically we see about 2.5kBs coming from the GNSS
const int UBXFILE_BLOCK_SIZE      =        1024;  //!< Size of the blocks used to pull from the GNSS and send to the File. 

#define   UBXSD_DIR                       "/LOG"  //!< Directory on the SD card to store logfiles in 
#define   UBXSD_UBXFORMAT        "/HPG-%04d.UBX"  //!< The UBX logfiles name format
#define   UBXSD_ATFORMAT         "/HPG-%04d.TXT"  //!< The AT command logfiles name format
const int UBXSD_MAXFILE           =        9999;  //!< the max number to try to open (should be smaller or fit the format above) 
const int UBXSD_NODATA_DELAY      =         100;  //!< If no data is in the buffer wait so much time until we write new to the buffer, 
const int UBXSD_DETECT_RETRY      =        2000;  //!< Delay between SD card detection trials 
const int UBXSD_SDCARDFREQ        =     4000000;  //!< Frequency of the SD card

/* ATTENTION: 
 * in older arduino_esp32 SD.begin calls sdcard_mount which creates a work area of 4k on the stack for f_mkfs
 * either apply this patch https://github.com/espressif/arduino-esp32/pull/6745 or increase the stack to 6kB 
 */
const char* UBXSD_TASK_NAME       =     "UbxSd";  //!< UBXSD task name
const int UBXSD_STACK_SIZE        =      3*1024;  //!< UBXSD task stack size
const int UBXSD_TASK_PRIO         =           1;  //!< UBXSD task priority
const int UBXSD_TASK_CORE         =           1;  //!< UBXSD task MCU code

/** This class encapsulates all UBXFILEE functions. 
*/
class UBXFILE {

public:

  /** constructor
   *  \param size  the circular buffer size
   */
  UBXFILE(size_t size) : buffer{size} {
    mutex = xSemaphoreCreateMutex();
    opened = false;
    size = 0;
  }

  /** Open a new file, will seach the current files and use the next best by 
   *  incrementing the file name index.
   *  \param format  the name format test and open. 
   *  \param max     the maximum file name index
   */
  void open(const char* format, int max) {
    if (buffer.size() > 1) {
      char fn[20];
      for (int i = 0; (i <= max) && !opened; i ++) {
        sprintf(fn, format, i);
        if (!SD.exists(fn)) {
          if (file = SD.open(fn, FILE_WRITE)) {
            log_i("UBXFILE created file \"%s\"", fn);
            opened = true;
            size = 0;
          }
        }
      }
    }
  }

  /** check if file is open
   *  \return  true if it is open. 
   */
  bool isOpen(void) {
    return opened;
  }

  /** close the file 
   */
  void close(void) {
    if (opened) {
      log_e("UBXFILE \"%s\" closed after %d bytes", file.name(), size);
      file.close();
      opened = false;
    }
  }
  
  /** store that data from the circular buffer in the file
   *  \return  the bytes stored in this call. 
   */
  size_t store(void) {
    size_t wrote = 0;
    if (opened) {
      bool loop;
      do {
        loop = false;
        if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
          uint8_t temp[UBXFILE_BLOCK_SIZE];
          size_t len = buffer.read((char*)temp, sizeof(temp));
          xSemaphoreGive(mutex);
          if (0 < len) {
#if 0
            int ret = file.write(temp, len);
#else
            // Retry multiple times in case we run low on memory due to a temprorary large 
            // buffer in the queue and hope this gets freed quite soon. 
            long start = millis();
            int ret = 0;
            while(true) {
              ret = file.write(temp, len);
              if ((ret != 0) || (millis() - start > 400))
                break;
              // just wait a bit
              vTaskDelay(10);
            }
#endif
            if (len == ret) {
              log_d("UBXFILE \"%s\" writing %d bytes", file.name(), len);
              size += len;
              wrote += len;
              loop = (len == sizeof(temp)); // likely more data
            } else { 
              log_e("UBXFILE \"%s\" writing %d bytes, failed and write returned %d", file.name(), len, ret);
            }
          }
        }
        vTaskDelay(0); // Yield
      } while (loop);
      if ((0 < wrote) && opened) {
        file.flush();
      } 
    }
    return size;
  }
  
protected:
  
  SemaphoreHandle_t mutex;  //!< protects cbuf from concurnet access by tasks. 
  cbuf buffer;              //!< the circular local buffer
  bool opened;              //!< flag open status
  File file;                //!< the file
  size_t size;              //!< the files size
};

/** older versions of ESP32_Arduino do not yet support flow control, but we need this for the modem. 
 *  The following flag will make sure code is added for this,
 */
#include "driver/uart.h" // for flow control
#if !defined(HW_FLOWCTRL_CTS_RTS) || !defined(ESP_ARDUINO_VERSION) || !defined(ESP_ARDUINO_VERSION_VAL)
 #define UBXSERIAL_OVERRIDE_FLOWCONTROL  
#elif (ESP_ARDUINO_VERSION <= ESP_ARDUINO_VERSION_VAL(2, 0, 3))
 #define UBXSERIAL_OVERRIDE_FLOWCONTROL
#endif

/** This class encapsulates all UBXSERIAL functions. the class can be used as alternative to a 
 *  normal Serial port, but add full RX and TX logging capability. 
*/
class UBXSERIAL : public HardwareSerial, public UBXFILE {
public:

  /** constructor
   *  \param size      the circular buffer size
   *  \param uart_num  the hardware uart number
   */
  UBXSERIAL(size_t size, uint8_t uart_num) 
        : HardwareSerial{uart_num}, UBXFILE{size} {
    setRxBufferSize(256);
  }

  // --------------------------------------------------------------------------------------
  // STREAM interface: https://github.com/arduino/ArduinoCore-API/blob/master/api/Stream.h
  // --------------------------------------------------------------------------------------
 
  /** The character written is also passed into the circular buffer
   *  \param ch  character to write
   *  \return    the bytes written
   */ 
  size_t write(uint8_t ch) override {
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      if (buffer.size() > 1) { 
        buffer.write((const char*)&ch, 1);
      }
      xSemaphoreGive(mutex);
    }
    return HardwareSerial::write(ch);
  }
  
  /** All data written is also passed into the circular buffer
   *  \param ptr   pointer to buffer to write
   *  \param size  number of bytes in ptr to write
   *  \return      the bytes written
   */ 
  size_t write(const uint8_t *ptr, size_t size) override {
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      if (buffer.size() > 1) { 
        buffer.write((const char*)ptr, size);
      } 
      xSemaphoreGive(mutex);
    }
    return HardwareSerial::write(ptr, size);  
  }

  /** The character read is also passed in also passed into the circular buffer.
   *  \return  the character read
   */ 
  int read(void) override {
    int ch = HardwareSerial::read();
    if (-1 != ch) {
      if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
        if (buffer.size() > 1) { 
          buffer.write((const char*)&ch, 1);
        } 
        xSemaphoreGive(mutex);
      }
    }
    return ch;
  }
  
#ifdef UBXSERIAL_OVERRIDE_FLOWCONTROL
  // The arduino_esp32 core has a bug that some pins are swapped in the setPins function. 
  // PR https://github.com/espressif/arduino-esp32/pull/6816#pullrequestreview-987757446 was issued
  // We will override as we cannot rely on that bugfix being applied in the users environment. 

  // extend the flow control API while on older arduino_ESP32 revisions
  // we keep the API forward compatible so that when the new platform is released it just works
  void setPins(int8_t rxPin, int8_t txPin, int8_t ctsPin, int8_t rtsPin) {
    uart_set_pin((uart_port_t)_uart_nr, txPin, rxPin, rtsPin, ctsPin);
  }
  
  void setHwFlowCtrlMode(uint8_t mode, uint8_t threshold) {
    uart_set_hw_flow_ctrl((uart_port_t)_uart_nr, (uart_hw_flowcontrol_t) mode, threshold);
  }
  
 #ifndef HW_FLOWCTRL_CTS_RTS
  #define HW_FLOWCTRL_CTS_RTS UART_HW_FLOWCTRL_CTS_RTS
 #endif
#endif
};

UBXSERIAL UbxSerial(UBXSERIAL_BUFFER_SIZE, UART_NUM_1); //!< The global UBXSERIAL peripherial object (replaces Serial1)

/** This class encapsulates all UBXWIRESERIAL functions. the class can be used as alternative 
 *  to a normal Wire port, but add full RX and TX logging capability of the data stream filtering 
 *  out I2C register set and stream length reads at address 0xFD and 0xFE.  
 */
class UBXWIRE : public TwoWire, public UBXFILE {

public:

  /** constructor
   *  \param size     the circular buffer size
   *  \param bus_num  the hardware I2C/Wire bus number
   */
  UBXWIRE(size_t size, uint8_t bus_num) 
        : TwoWire{bus_num}, UBXFILE{size} {
    state = READ;
    lenLo = 0;
  }
  
  /** The character written is also passed into the circular buffer
   *  \param ch  character to write
   *  \return    the bytes written
   */ 
  size_t write(uint8_t ch) override {
    if (state == READFD) {
      if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
        if (buffer.size() > 1) {
          buffer.write(0xFD);  // seems we ar just writing after assumed address set to length field
          buffer.write(ch);
        } 
        xSemaphoreGive(mutex);
      }
    } else if (state == READFE) {
      if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
        if (buffer.size() > 1) {
          buffer.write(0xFD);     // quite unusal should never happen 
          buffer.write(lenLo);     // we set register address and read part of the length 
          buffer.write(ch);       // now we write again
        }
        xSemaphoreGive(mutex);
      }
    }
    else if (ch == 0xFD) {
      state = READFD;
      // do not write this now
    } else {
      state = WRITE;
      if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
        if (buffer.size() > 1) {
          buffer.write(ch);
        } 
        xSemaphoreGive(mutex);
      }
    }
    return TwoWire::write(ch);
  }
  
  /** All data written is also passed into the circular buffer
   *  \param ptr   pointer to buffer to write
   *  \param size  number of bytes in ptr to write
   *  \return      the bytes written
   */ 
  size_t write(const uint8_t *ptr, size_t size) override {
    if ((1 == size) && (0xFD == *ptr)) {
      state = READFD;
    } else {
      if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
        if (buffer.size() > 1) {
          if (state == READFD) {
            buffer.write(0xFD);
          }
          buffer.write((const char*)ptr, size);
        } 
        xSemaphoreGive(mutex);
      }
      state = WRITE;
    }
    return TwoWire::write(ptr, size);  
  }

  /** The character read is also passed in also passed into the circular buffer.
   *  \return  the character read
   */ 
  int read(void) override {
    int ch = TwoWire::read();
    if (state == READFD) {
      state = READFE;
      lenLo = ch;
    } else if (state == READFE) {
      state = READ;
      //lenHi = ch;
    } else {
      if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
        if (buffer.size() > 1) {
          buffer.write(ch);
        } 
        xSemaphoreGive(mutex);
      }
    }
    return ch;
  }
  
protected:
  enum { READFD, READFE, READ, WRITE } state; //!< state of the I2C traffic filter 
  uint8_t lenLo;                              //!> backup of lenLo 
};

UBXWIRE UbxWire(UBXWIRE_BUFFER_SIZE, 0); //!< The global UBXWIRE peripherial object (replaces Wire)

/** This class encapsulates all UBXSD functions that are responsible for managing the 
 *  SD card and its log files. 
 */
class UBXSD {

public:

  /** constructor
   */
  UBXSD() {
    if (MICROSD_PWR_EN != PIN_INVALID) {
      digitalWrite(MICROSD_PWR_EN, MICROSD_PWR_EN_INVERTED ? HIGH : LOW);
      pinMode(MICROSD_PWR_EN, OUTPUT);
      digitalWrite(MICROSD_PWR_EN, MICROSD_PWR_EN_INVERTED ? HIGH : LOW);
    }
    if (MICROSD_DET != PIN_INVALID) {
      pinMode(MICROSD_DET, INPUT);
    }
  }

  /** immediately spin out into a task
   */
  void init() {
    xTaskCreatePinnedToCore(task, UBXSD_TASK_NAME, UBXSD_STACK_SIZE, this, UBXSD_TASK_PRIO, NULL, UBXSD_TASK_CORE);
  }
      
protected: 

  typedef enum                        {  UNKNOWN,   REMOVED,   INSERTED,   MOUNTED, NUM } STATE;  //!< Card state
  const char* STATE_LUT[STATE::NUM] = { "unknown", "removed", "inserted", "mounted",    };        //!< Card state text conversion helper 

  /** get the state of the SD card using the holder detect pin
   */
  STATE getState(void) {
    STATE state = UNKNOWN;
    if (MICROSD_DET != PIN_INVALID) {
      state = (digitalRead(MICROSD_DET) == MICROSD_DET_REMOVED) ? REMOVED : INSERTED;
    }
    return state;
  }

  /* FreeRTOS static task function, will just call the objects task function  
   * \param pvParameters the Lte object (this)
   */
  static void task(void * pvParameters) {
    ((UBXSD*) pvParameters)->task();
  }

  /** This task handling the whole SDCARD state machine  
   */
  void task(void) {
    STATE oldState = (MICROSD_DET != PIN_INVALID) ? REMOVED : UNKNOWN;
    while(true) {
      STATE state = getState();
      if (state != oldState) {
        oldState = state; 
        log_i("UBXSD card state changed %d (%s)", state, STATE_LUT[state]);
        if (state == REMOVED) {
          SD.end();
          SPI.end();
        }
      }
      if ((state == INSERTED) || (state == UNKNOWN)) {
        if ((MICROSD_SCK != SCK) || (MICROSD_SDI != MISO) || (MICROSD_SDO != MOSI) || (PIN_INVALID == MICROSD_CS)) {
          log_e("UBXSD sck %d sck %d sdi %d miso %d sdo %d mosi %d cs %d pins bad", 
                    MICROSD_SCK, SCK, MICROSD_SDI, MISO, MICROSD_SDO, MOSI, MICROSD_CS);
        } else if (SD.begin(MICROSD_CS, SPI, UBXSD_SDCARDFREQ)) {
          state = MOUNTED;
          log_i("UBXSD card state changed %d (%s)", state, STATE_LUT[state]);
          uint8_t cardType = SD.cardType();
          const char* strType = (cardType == CARD_MMC) ? "MMC" :
                                (cardType == CARD_SD)  ? "SDSC" : 
                                (cardType == CARD_SDHC) ? "SDHC" : "UNKNOWN";
          int cardSize  = (int)(SD.cardSize() >> 20); // bytes -> MB
          int cardUsed  = (int)(SD.usedBytes() >> 20);
          int cardTotal = (int)(SD.totalBytes() >> 20);
          log_i("UBXSD card type %s size %d MB (used %d MB, total %d MB)", strType, cardSize, cardUsed, cardTotal);
        }
      }
      if (state == MOUNTED) {
        if (!SD.exists(UBXSD_DIR) ? SD.mkdir(UBXSD_DIR) : true) {
          UbxSerial.open(UBXSD_DIR UBXSD_ATFORMAT, UBXSD_MAXFILE);
          UbxWire.open(UBXSD_DIR UBXSD_UBXFORMAT, UBXSD_MAXFILE);
          while (getState() != REMOVED) {
            UbxSerial.store();
            UbxWire.store();
            vTaskDelay(UBXSD_NODATA_DELAY);
          } 
          UbxSerial.close();
          UbxWire.close();
        }
        oldState = state = getState();
        log_d("UBXSD stack free %d total %d", uxTaskGetStackHighWaterMark(0), UBXSD_STACK_SIZE);
        log_i("UBXSD card state changed %d (%s)", state, STATE_LUT[state]);
        SD.end();
        SPI.end();
      }
      vTaskDelay(UBXSD_DETECT_RETRY); // wait a bit before 
    }
  }
};

UBXSD UbxSd; //!< The global UBXSD peripherial object

#endif // __UBXFILE_H__
