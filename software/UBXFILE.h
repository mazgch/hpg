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

#define   UBXSD_DIR                       "/LOG"  //!< Directory on the SD card to store logfiles in 
#define   UBXSD_UBXFORMAT        "/HPG-%04d.UBX"  //!< The UBX logfiles name format
#define   UBXSD_ATFORMAT         "/HPG-%04d.TXT"  //!< The AT command logfiles name format
const int UBXSD_MAXFILE           =         999;  //!< the max number to try to open (should be smaller or fit the format above) 
const int UBXSD_CHECKCARD_DELAY   =         100;  //!< If no data is in the buffer wait so much time until we write new to the buffer, 
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
class UBXSERIAL : public HardwareSerial {
public:

  /** constructor
   *  \param size      the circular buffer size
   *  \param uart_num  the hardware uart number
   */
  UBXSERIAL(uint8_t uart_num) : HardwareSerial{uart_num} {
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
    pipeSerialToSdcard.write(ch);
    return HardwareSerial::write(ch);
  }
  
  /** All data written is also passed into the circular buffer
   *  \param ptr   pointer to buffer to write
   *  \param size  number of bytes in ptr to write
   *  \return      the bytes written
   */ 
  size_t write(const uint8_t *ptr, size_t size) override {
    pipeSerialToSdcard.write(ptr, size);
    return HardwareSerial::write(ptr, size);  
  }

  /** The character read is also passed in also passed into the circular buffer.
   *  \return  the character read
   */ 
  int read(void) override {
    int ch = HardwareSerial::read();
    if (-1 != ch) {
      pipeSerialToSdcard.write(ch);
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

UBXSERIAL UbxSerial(UART_NUM_1); //!< The global UBXSERIAL peripherial object (replaces Serial1)

/** This class encapsulates all UBXWIRESERIAL functions. the class can be used as alternative 
 *  to a normal Wire port, but add full RX and TX logging capability of the data stream filtering 
 *  out I2C register set and stream length reads at address 0xFD and 0xFE.  
 */
class UBXWIRE : public TwoWire {

public:

  /** constructor
   *  \param size     the circular buffer size
   *  \param bus_num  the hardware I2C/Wire bus number
   */
  UBXWIRE(uint8_t bus_num) : TwoWire{bus_num} {
    state = READ;
    lenLo = 0;
  }
  
  /** The character written is also passed into the circular buffer
   *  \param ch  character to write
   *  \return    the bytes written
   */ 
  size_t write(uint8_t ch) override {
    if (state == READFD) {
      const uint8_t mem[] = { 0xFD, ch };
      pipeWireToSdcard.write(mem, sizeof(mem));  // seems we ar just writing after assumed address set to length field
    } else if (state == READFE) {
      // quite unusal should never happen 
      const uint8_t mem[] = { 0xFD, lenLo, ch };
      pipeWireToSdcard.write(mem, sizeof(mem)); // we set register address and read part of the length, now we write again
    }
    else if (ch == 0xFD) {
      state = READFD;
      // do not write this now
    } else {
      state = WRITE;
      pipeWireToSdcard.write(ch);
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
      if (state == READFD) {
        pipeWireToSdcard.write(0xFD);
      }
      pipeWireToSdcard.write(ptr, size);
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
      pipeWireToSdcard.write(ch);
    }
    return ch;
  }
  
protected:
  enum { READFD, READFE, READ, WRITE } state; //!< state of the I2C traffic filter 
  uint8_t lenLo;                              //!> backup of lenLo 
};

UBXWIRE UbxWire(0); //!< The global UBXWIRE peripherial object (replaces Wire)

/** This class encapsulates all UBXSD functions that are responsible for managing the 
 *  SD card and its log files. 
 */
class UBXSD {

public:

  /** constructor
   */
  UBXSD() {
    if (MICROSD_PWR_EN != PIN_INVALID) {
      digitalWrite(MICROSD_PWR_EN, LOW);
      pinMode(MICROSD_PWR_EN, OUTPUT);
      digitalWrite(MICROSD_PWR_EN, LOW);
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
  const int MICROSD_DET_REMOVED     = (HW_TARGET == MAZGCH_HPG_MODULAR_V01) ? LOW : HIGH;         //!< true if card is removed  

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
          File file[2];
          size_t fileSize[2] = { 0, 0 }; 
          open(file[0], UBXSD_DIR UBXSD_UBXFORMAT, UBXSD_MAXFILE);
          open(file[1], UBXSD_DIR UBXSD_ATFORMAT,  UBXSD_MAXFILE);
          while ((getState() != REMOVED) && (file[0] || file[1])) {
            MSG msg;
            while (queueToSdcard.receive(msg, pdMS_TO_TICKS(UBXSD_CHECKCARD_DELAY))) {
              int ix = (msg.src == MSG::SRC::GNSS) ? 0 : 
                       (msg.src == MSG::SRC::LTE)  ? 1 : -1;
              if ((0 <= ix) && file[ix]) {
                size_t size = file[ix].write(msg.data, msg.size);
                fileSize[ix] += size;
                if (msg.size != size) {
                  log_e("closed file %s size %d, due to error", file[ix].name(), fileSize[ix]); 
                  file[ix].close();
                }
              }
            }
            for (int ix = 0; ix < 2; ix ++) {
              if (file[ix]) {
                file[ix].flush();
              }
            }
          } 
          for (int ix = 0; ix < 2; ix ++) {
            if (file[ix]) {
              log_i("closed file %s size %d", file[ix].name(), fileSize[ix]); 
              file[ix].close();
            }
          }
        }
        oldState = state = getState();
        log_i("card state changed %d (%s)", state, STATE_LUT[state]);
        SD.end();
        SPI.end();
      }
      for (int i = 0; i < 10; i ++) { // empty the pipe here
        MSG msg;
        while (queueToSdcard.receive(msg, 0)) {
        }
        vTaskDelay(UBXSD_DETECT_RETRY/10); // wait a bit before 
      }
    }
  }

  bool open(File &file, const char* format, int max) {
    char fn[20];
    for (int i = 0; (i <= max); i ++) {
      sprintf(fn, format, i);
      if (!SD.exists(fn)) {
        if (file = SD.open(fn, FILE_WRITE)) {
          log_i("created file \"%s\"", fn);
          return true;
        }
      }
    }
    return false;
  }
};

UBXSD UbxSd; //!< The global UBXSD peripherial object

#endif // __UBXFILE_H__
