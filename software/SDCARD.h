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
 
#ifndef __SDCARD_H__
#define __SDCARD_H__

#include <Wire.h>
#include <SPI.h> 
#include <SD.h>
#include <cbuf.h> 

#define   SDCARD_DIR                       "/LOG"  //!< Directory on the SD card to store logfiles in 
#define   SDCARD_UBXFORMAT        "/HPG-%04d.UBX"  //!< The UBX logfiles name format
#define   SDCARD_ATFORMAT         "/HPG-%04d.TXT"  //!< The AT command logfiles name format
const int SDCARD_MAXFILE           =        9999;  //!< the max number to try to open (should be smaller or fit the format above) 
const int SDCARD_READ_TIMEOUT      =         100;  //!< If no data is in the buffer wait so much time until we write new to the buffer, 
const int SDCARD_1S_RETRY          =        1000;  //!< Delay between SD card detection trials 
const int SDCARD_SDCARDFREQ        =     4000000;  //!< Frequency of the SD card

/* ATTENTION: 
 * in older arduino_esp32 SD.begin calls sdcard_mount which creates a work area of 4k on the stack for f_mkfs
 * either apply this patch https://github.com/espressif/arduino-esp32/pull/6745 or increase the stack to 6kB 
 */
const char* SDCARD_TASK_NAME       =     "Sdcard";  //!< SDCARD task name
const int SDCARD_STACK_SIZE        =      3*1024;  //!< SDCARD task stack size
const int SDCARD_TASK_PRIO         =           2;  //!< SDCARD task priority
const int SDCARD_TASK_CORE         =           1;  //!< SDCARD task MCU code

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
    state = STATE::READ;
    lenLo = 0;
  }
  
  /** The character written is also passed into the circular buffer
   *  \param ch  character to write
   *  \return    the bytes written
   */ 
  size_t write(uint8_t ch) override {
    if (state == STATE::READFD) {
      // seems we ar just writing after assumed address set to length field
      const uint8_t mem[] = { REG_ADR_SIZE, ch };
      pipeWireToSdcard.write(mem, sizeof(mem));
    } else if (state == STATE::READFE) {
      // quite unusal should never happen 
      const uint8_t mem[] = { REG_ADR_SIZE, lenLo, ch };
      // we set register address and read part of the length, now we write again
      pipeWireToSdcard.write(mem, sizeof(mem));
    }
    else if (ch == REG_ADR_SIZE) {
      state = STATE::READFD;
      // do not write this now
    } else {
      state = STATE::WRITE;
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
    if ((1 == size) && (REG_ADR_SIZE == *ptr)) {
      state = STATE::READFD;
    } else {
      if (state == STATE::READFD) {
        pipeWireToSdcard.write(REG_ADR_SIZE);
      }
      pipeWireToSdcard.write(ptr, size);
      state = STATE::WRITE;
    }
    return TwoWire::write(ptr, size);  
  }

  /** The character read is also passed in also passed into the circular buffer.
   *  \return  the character read
   */ 
  int read(void) override {
    int ch = TwoWire::read();
    if (state == STATE::READFD) {
      state = STATE::READFE;
      lenLo = ch;
    } else if (state == STATE::READFE) {
      state = STATE::READ;
      //lenHi = ch;
    } else {
      pipeWireToSdcard.write(ch);
    }
    return ch;
  }
  
protected:
  enum class STATE { READFD, READFE, READ, WRITE } state; //!< state of the I2C traffic filter 
  const uint8_t REG_ADR_SIZE = 0xFD;                      //!< the first address of the size register (2 bytes)
  uint8_t lenLo;                                          //!> backup of lenLo 
};

UBXWIRE UbxWire(0); //!< The global UBXWIRE peripherial object (replaces Wire)

class SDCARDFILE {

public:

  SDCARDFILE() {
    size = 0;
    isOpen = false;
    isDirty = false;
  }

  bool open(const char* format) {
    char fn[20];
    for (int ix = 0; !isOpen && (ix <= SDCARD_MAXFILE); ix ++) {
      sprintf(fn, format, ix);
      if (!SD.exists(fn)) {
        if (file = SD.open(fn, FILE_WRITE)) {
          log_i("file \"%s\"", fn);
          size = 0;
          isDirty = false;
          isOpen = true;
        }
      }
    }
    if (!isOpen) {  
      log_e("format \"%s\" maxIx %d failed, delete files on card", format, SDCARD_MAXFILE);
    }
    return isOpen;
  }
  
  size_t write(const uint8_t* ptr, size_t len) {
    size_t wrote = 0;
    wrote = file.write(ptr, len);
    size += wrote;
    if (len == wrote) {
      isDirty = true;
    } else {
      log_e("%s failed after %d of %d bytes", file.name(), wrote, len); 
    }
    return wrote;  
  }
  
  void flush(void) {
    if (isDirty) {
      file.flush();
      isDirty = false;
    }
  }
    
  void close(void) {
    log_i("\"%s\" size %d", file.name(), size);
    file.close();
    size = 0;
    isDirty = false;
    isOpen = false;
  }

  operator bool() const {
    return isOpen;  
  }
  
protected:
  File file;
  size_t size;
  bool isOpen;
  bool isDirty;
};
  
/** This class encapsulates all SDCARD functions that are responsible for managing the 
 *  SD card and its log files. 
 */
class SDCARD {

public:

  /** constructor
   */
  SDCARD() {
    if (MICROSD_PWR_EN != PIN_INVALID) {
      digitalWrite(MICROSD_PWR_EN, LOW);
      pinMode(MICROSD_PWR_EN, OUTPUT);
      digitalWrite(MICROSD_PWR_EN, LOW);
    }
    if ((MICROSD_DET != PIN_INVALID) && (MICROSD_DET != MICROSD_CS)) {
      // on the Modular board we reuse the chip select also as a detect pin so keep it 
      pinMode(MICROSD_DET, INPUT);
    }
    if (MICROSD_CS != PIN_INVALID) {
      pinMode(MICROSD_CS, INPUT_PULLUP);
    }
    ttagNextTry = millis();
    if ((MICROSD_SCK != SCK) || (MICROSD_SDI != MISO) || (MICROSD_SDO != MOSI) || (PIN_INVALID == MICROSD_CS)) {
      log_e("bad pins: sck %d sck %d, sdi %d miso, %d sdo %d, mosi %d cs %d det %d", 
              MICROSD_SCK, SCK, MICROSD_SDI, MISO, MICROSD_SDO, MOSI, MICROSD_CS, MICROSD_DET);
      state = STATE::ERROR;
    } else {
      state = getCardState();
    }
  }

  /** immediately spin out into a task
   */
  void init() {
    xTaskCreatePinnedToCore(task, SDCARD_TASK_NAME, SDCARD_STACK_SIZE, this, SDCARD_TASK_PRIO, NULL, SDCARD_TASK_CORE);
  }
      
protected: 

  enum class STATE {
    UNKNOWN = 0,   
    REMOVED,   
    INSERTED,   
    MOUNTED,
    ERROR,
    NUM 
  } state;                        //!< Card state
  int32_t ttagNextTry;            //!< time tag when to call the state machine again
  
  void setState(STATE newState, int32_t delay = 0) {
    if (state != newState) {
      const char* lut[] = { "UNKNOWN", "REMOVED", "INSERTED", "MOUNTED",  "ERROR" };
      size_t ix = (size_t)newState;
      log_i("state change %s", lut[ix]);
      state = newState;
    }
    ttagNextTry = millis() + delay; 
  }
  
  /** get the state of the SD card using the holder detect pin
   */
  STATE getCardState(void) {
    STATE state;
    if (MICROSD_DET == PIN_INVALID) {
      state = STATE::UNKNOWN;
    } else if (digitalRead(MICROSD_DET) == MICROSD_DET_REMOVED) {
      state = STATE::REMOVED;
    } else {
      state = STATE::INSERTED;
    }
    return state;
  }

  /* FreeRTOS static task function, will just call the objects task function  
   * \param pvParameters the Lte object (this)
   */
  static void task(void * pvParameters) {
    ((SDCARD*) pvParameters)->task();
  }

  /** This task handling the whole SDCARD state machine  
   */
  void task(void) {
    while(true) {
      int32_t now = millis();
      if (0 >= (ttagNextTry - now)) {
        ttagNextTry = now + SDCARD_1S_RETRY;
        switch (state) {
          case STATE::REMOVED:
            if (getCardState() == STATE::INSERTED) {
              setState(STATE::INSERTED);
            }
            break;
          case STATE::UNKNOWN:
          case STATE::INSERTED:
            if (SD.begin(MICROSD_CS, SPI, SDCARD_SDCARDFREQ)) {
              uint8_t cardType = SD.cardType();
              const char* strType = (cardType == CARD_MMC) ? "MMC" :
                                    (cardType == CARD_SD)  ? "SDSC" : 
                                    (cardType == CARD_SDHC) ? "SDHC" : "UNKNOWN";
              int cardSize  = (int)(SD.cardSize() >> 20); // bytes -> MB
              int cardUsed  = (int)(SD.usedBytes() >> 20);
              int cardTotal = (int)(SD.totalBytes() >> 20);
              log_i("SD card type %s size %d MB (used %d MB, total %d MB)", strType, cardSize, cardUsed, cardTotal);
              bool ok = SD.exists(SDCARD_DIR);
              if (!ok) {
                ok = SD.mkdir(SDCARD_DIR);
              }
              if (ok) {
                fileGnss.open(SDCARD_DIR SDCARD_UBXFORMAT);
                fileLte.open(SDCARD_DIR SDCARD_ATFORMAT);
                setState(STATE::MOUNTED);
              } else {
                log_e("create directory \"%s\" failed", SDCARD_DIR);
                setState(STATE::ERROR);
              }
            } else {
              cleanup();
            }
            break;
          case STATE::MOUNTED:
            if (getCardState() == STATE::REMOVED) {
              cleanup();
            }
            break;
          case STATE::ERROR:
          default:
            break;
        }
      }
      MSG msg;
      bool ok = true;
      while (queueToSdcard.receive(msg, ok ? pdMS_TO_TICKS(SDCARD_READ_TIMEOUT) : 0)) {
        if (ok && (state == STATE::MOUNTED)) {
          if ((msg.src == MSG::SRC::GNSS) && fileGnss) {
            size_t wrote = fileGnss.write(msg.data, msg.size);
            ok = (wrote == msg.size);
          } else if ((msg.src == MSG::SRC::LTE) && fileLte) {
            size_t wrote = fileLte.write(msg.data, msg.size);
            ok = (wrote == msg.size);
          }
        }
      }
      if (ok) {
        if (fileGnss) {
          fileGnss.flush();
        }
        if (fileLte) {
          fileLte.flush(); 
        }
      } else {
        cleanup();
      }
    }
  }

  void cleanup(void) {
    if (fileGnss) {
      fileGnss.close();
    }
    if (fileLte) {
      fileLte.close();
    }
    SD.end();
    SPI.end();
    if (MICROSD_CS != PIN_INVALID) {
      pinMode(MICROSD_CS, INPUT_PULLUP);
    } 
    // need some delay here 
    setState(getCardState());
  }      
      
protected:
  
  SDCARDFILE fileLte;
  SDCARDFILE fileGnss;
};

SDCARD Sdcard; //!< The global SDCARD peripherial object

#endif // __SDCARD_H__
