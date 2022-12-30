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

#include <SPI.h> 
#include <SD.h>

#define   SDCARD_DIR                       "/LOG"  //!< Directory on the SD card to store logfiles in 
#define   SDCARD_UBXFORMAT        "/HPG-%04d.UBX"  //!< The UBX logfiles name format
//#define   SDCARD_ATFORMAT         "/HPG-%04d.TXT"  //!< The AT command logfiles name format, comment if not needed. 
const int SDCARD_MAXFILE           =        9999;  //!< the max number to try to open (should be smaller or fit the format above) 
const int SDCARD_READ_TIMEOUT      =         100;  //!< If no data is in the buffer wait so much time until we write new to the buffer, 
const int SDCARD_1S_RETRY          =        1000;  //!< Delay between SD card detection trials 
const int SDCARD_SDCARDFREQ        =    25000000;  //!< Frequency of the SD card, 40Mhz, 25Mhz default 4MHz

/** class to handle a sd card file
 */
class SDCARDFILE {

public:

  /** constructor
   */
  SDCARDFILE() {
    size = 0;
    isOpen = false;
    isDirty = false;
  }

  /** destructor
   */
  ~SDCARDFILE() {
    if (isOpen) {
      file.close();
      isOpen = false;
    }
  }

  /** open a new non-existent file with the specified name format 
   *  \param format  the path of the file, must contain a %04d that will be replaced by a incrementing index 
   *  \return the success status
   */
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
  
  /** write data to file
   *  \param ptr   pointer to buffer to write
   *  \param len   number of bytes in ptr to write
   *  \return      the bytes written
   */ 
  size_t write(const uint8_t* ptr, size_t len) {
    size_t wrote = file.write(ptr, len);
    size += wrote;
    if (len == wrote) {
      isDirty = true;
    } else {
      log_e("%s failed after %d of %d bytes", file.name(), wrote, len); 
    }
    return wrote;  
  }
  
  /** flush any written data to the card
   */ 
  void flush(void) {
    if (isDirty) {
      file.flush();
      isDirty = false;
    }
  }
    
  /** close the file 
  */ 
  void close(void) {
    log_i("\"%s\" size %d", file.name(), size);
    file.close();
    size = 0;
    isDirty = false;
    isOpen = false;
  }

  /** check if file is open
   *  \return  open status
   */
  operator bool() const {
    return isOpen;  
  }
  
protected:
  File file;     //!< the file
  size_t size;   //!< it's total size 
  bool isOpen;   //!< open status
  bool isDirty;  //!< dirty flag, set by write, reset by flush
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

  void writeLogFiles(MSG &msg) {
    if (state == STATE::MOUNTED) {
      if (msg.hint == MSG::HINT::AT) {
        if (fileLte) {
          const size_t wrote = fileLte.write(msg.data, msg.size);
          if (wrote != msg.size) {
            state = STATE::ERROR;
          }
        }
      } else {
        if (fileUbx) {
          const size_t wrote = fileUbx.write(msg.data, msg.size);
          if (wrote != msg.size) {
            state = STATE::ERROR;
          }
        }
      } 
    }
  }

  void checkCard(void) {
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
          if (SD.begin(MICROSD_CS, SPI, SDCARD_SDCARDFREQ, "/sd", 2)) {
            uint8_t cardType = SD.cardType();
            const char* strType = (cardType == CARD_MMC)      ? "MMC"  :
                                  (cardType == CARD_SD)       ? "SDSC" : 
                                  (cardType == CARD_SDHC)     ? "SDHC" :
                                  (cardType == CARD_NONE)     ? "none" : 
                                /*(cardType == CARD_UNKNOWN)*/  "unknown";
            int cardSize  = (int)(SD.cardSize() >> 20); // bytes -> MB
            int cardUsed  = (int)(SD.usedBytes() >> 20);
            int cardTotal = (int)(SD.totalBytes() >> 20);
            log_i("SD card type %s size %d MB (used %d MB, total %d MB)", strType, cardSize, cardUsed, cardTotal);
            bool ok = SD.exists(SDCARD_DIR);
            if (!ok) {
              ok = SD.mkdir(SDCARD_DIR);
            }
#ifdef SDCARD_UBXFORMAT
            if (ok) {
              ok = fileUbx.open(SDCARD_DIR SDCARD_UBXFORMAT);
            }
#endif
#ifdef SDCARD_ATFORMAT
            if (ok) {
              ok = fileLte.open(SDCARD_DIR SDCARD_ATFORMAT);
            }
#endif          
            if (ok) {
              setState(STATE::MOUNTED);
            } else {
              log_e("create files in directory \"%s\" failed", SDCARD_DIR);
              setState(STATE::ERROR);
            }
          } else {
            cleanup();
          }
          break;
        case STATE::MOUNTED:
          if (getCardState() == STATE::REMOVED) {
            cleanup();
            // read state again, it may have changed as we did the cleanup and release the pins  
            setState(getCardState());
          }
          break;
        case STATE::ERROR:
          cleanup();
          // read state again, it may have changed as we did the cleanup and release the pins  
          setState(getCardState());
          break;
        default:
          break;
      }
    }
  }
  
protected: 

  enum class STATE {
    UNKNOWN = 0,   
    REMOVED,   
    INSERTED,   
    MOUNTED,
    ERROR,
    NUM 
  } state;                        //!< the statemachine state
  int32_t ttagNextTry;            //!< time tag when to call the state machine again
  
  /** advance the state and report transitions
   *  \param newState  the new state
   *  \param delay     schedule delay
   */
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
   *  \return  the status to the card detect pin 
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

  /** Cleanup the files, filesystem, Sdcard and SPI reset the CS pin to input pull-up. 
   */
  void cleanup(void) {
    if (fileUbx) {
      fileUbx.close();
    }
    if (fileLte) {
      fileLte.close();
    }
    SD.end();
    SPI.end();
    if (MICROSD_CS != PIN_INVALID) {
      pinMode(MICROSD_CS, INPUT_PULLUP);
    } 
  }      
      
protected:
  
  SDCARDFILE fileLte;   //!< the file to store a AT command logfile
  SDCARDFILE fileUbx;  //!< the file to store a UBX logfile
   
};

SDCARD Sdcard; //!< The global SDCARD peripherial object

#endif // __SDCARD_H__
