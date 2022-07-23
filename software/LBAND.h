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
 
#ifndef __LBAND_H__
#define __LBAND_H__

#include "LOG.h"
#include "GNSS.h"

const int LBAND_DETECT_RETRY    = 1000;  //!< Try to detect the received with this intervall
const int LBAND_I2C_ADR         = 0x43;  //!< NEO-D9S I2C address

// helper macros to handle the receiver configuration 
#define LBAND_CHECK_INIT        int _step = 0; bool _ok = true
#define LBAND_CHECK_OK          (_ok)
#define LBAND_CHECK             if (_ok) _step ++, _ok 
#define LBAND_CHECK_EVAL(txt)   if (!_ok) Log.error(txt ", sequence failed at step %d", _step)

#define LBAND_FREQ_NONE          0
#define LBAND_FREQ_NOUPDATE     -1

class LBAND : public SFE_UBLOX_GNSS {
public:

  LBAND () {
    online = false;
    freq = LBAND_FREQ_NONE;
    ttagNextTry = millis();
  }

  bool detect() {
    bool ok = begin(UbxWire, LBAND_I2C_ADR );
    if (ok)
    {
      Log.info("LBAND detect receiver detected");
      freq = Config.getFreq();

      String fwver = ubxVersion("LBAND", this);
/* #*/LBAND_CHECK_INIT;
      if (fwver.startsWith("QZS")){ // NEO-D9C
        freq = LBAND_FREQ_NOUPDATE; // prevents freq update
#ifdef UBX_RXM_QZSSL6_DATALEN
        setRXMQZSSL6messageCallbackPtr(onRXMQZSSL6data);
/* 1*/  LBAND_CHECK = setVal(UBLOX_CFG_MSGOUT_UBX_RXM_QZSSL6_I2C, 1,                      VAL_LAYER_RAM);    
        // prepare the UART 2
/* 2*/  LBAND_CHECK = setVal(UBLOX_CFG_MSGOUT_UBX_RXM_QZSSL6_UART2, 1,                    VAL_LAYER_RAM);
/* 3*/  LBAND_CHECK = setVal32(UBLOX_CFG_UART2_BAUDRATE,         38400,                   VAL_LAYER_RAM); // match baudrate with ZED default
#else
        Log.info("LBAND NEO-D9C receiver not supported by Sparkfun library, please update library");
#endif
      } else
      { // NEO-D9S
        freq = (freq == LBAND_FREQ_NOUPDATE) ? LBAND_FREQ_NONE : freq;
        setRXMPMPmessageCallbackPtr(onRXMPMPdata);
/* 1*/  LBAND_CHECK = setVal16(UBLOX_CFG_PMP_SEARCH_WINDOW,      2200,                    VAL_LAYER_RAM); 
/* 2*/  LBAND_CHECK = setVal8(UBLOX_CFG_PMP_USE_SERVICE_ID,      0,                       VAL_LAYER_RAM); // Default 1 
/* 3*/  LBAND_CHECK = setVal16(UBLOX_CFG_PMP_SERVICE_ID,         21845,                   VAL_LAYER_RAM); // Default 50851
/* 4*/  LBAND_CHECK = setVal16(UBLOX_CFG_PMP_DATA_RATE,          2400,                    VAL_LAYER_RAM); 
/* 5*/  LBAND_CHECK = setVal8(UBLOX_CFG_PMP_USE_DESCRAMBLER,     1,                       VAL_LAYER_RAM); 
/* 6*/  LBAND_CHECK = setVal16(UBLOX_CFG_PMP_DESCRAMBLER_INIT,   26969,                   VAL_LAYER_RAM); // Default 23560
/* 7*/  LBAND_CHECK = setVal8(UBLOX_CFG_PMP_USE_PRESCRAMBLING,   0,                       VAL_LAYER_RAM); 
/* 8*/  LBAND_CHECK = setVal64(UBLOX_CFG_PMP_UNIQUE_WORD,        16238547128276412563ull, VAL_LAYER_RAM); 
/* 9*/  LBAND_CHECK = setVal32(UBLOX_CFG_PMP_CENTER_FREQUENCY,   freq,                    VAL_LAYER_RAM);
/*10*/  LBAND_CHECK = setVal(UBLOX_CFG_MSGOUT_UBX_RXM_PMP_I2C,   1,                       VAL_LAYER_RAM);
        // prepare the UART 2
/*11*/  LBAND_CHECK = setVal(UBLOX_CFG_MSGOUT_UBX_RXM_PMP_UART2, 1,                       VAL_LAYER_RAM);
/*12*/  LBAND_CHECK = setVal32(UBLOX_CFG_UART2_BAUDRATE,         38400,                   VAL_LAYER_RAM); // match baudrate with ZED default
      }
      online = ok = LBAND_CHECK_OK;
      LBAND_CHECK_EVAL("LBAND detect configuration");
      if (ok) {
        Log.info("LBAND detect configuration complete, receiver online");
      }
    }
    return ok;
  }

  void poll(void) {
    HW_DBG_HI(HW_DBG_LBAND);
    if (ttagNextTry <= millis()) {
      ttagNextTry = millis() + LBAND_DETECT_RETRY;
      if (!online) {
        detect();
      }
      
      // do update the ferquency from time to time
      int newFreq = Config.getFreq();
      if ((newFreq != LBAND_FREQ_NONE) && (freq != LBAND_FREQ_NOUPDATE) && (freq != newFreq)) {
        bool ok = true;
        bool changed = false;
        if (online) {
          ok = setVal32(UBLOX_CFG_PMP_CENTER_FREQUENCY, newFreq, VAL_LAYER_RAM);
          if (ok) {
            freq = newFreq;
            changed = true;
            softwareResetGNSSOnly(); // do a restart
          }
          else {
            online = false;
          }
        }
        if (!ok) { 
          Log.error("LBAND updateFreq to %d failed", newFreq);
        } else if (changed) {
          Log.info("LBAND updateFreq to %d", newFreq);
        }
      }
    }
    if (online) {
      checkUblox(); 
      checkCallbacks();
    }
    HW_DBG_LO(HW_DBG_LBAND);
  }
  
protected:
  static void onRXMPMPdata(UBX_RXM_PMP_message_data_t *pmpData)
  {
    if (NULL != pmpData) {
      GNSS::MSG msg;
      uint16_t size = ((uint16_t)pmpData->lengthMSB << 8) | (uint16_t)pmpData->lengthLSB;
      msg.size = size + 8;
      msg.data = new uint8_t[msg.size];
      if (NULL != msg.data) {
        msg.source = GNSS::SOURCE::LBAND;
        memcpy(msg.data, &pmpData->sync1, size + 6);
        memcpy(&msg.data[size + 6], &pmpData->checksumA, 2);
        Log.info("LBAND received RXM-PMP with %d bytes Eb/N0 %.1f dB", msg.size, 0.125 * pmpData->payload[22]);
        Gnss.inject(msg); // Push the sync chars, class, ID, length and payload
      } else {
        Log.error("LBAND received RXM-PMP with %d bytes Eb/N0 %.1f dB, no memory", msg.size, 0.125 * pmpData->payload[22]);
      }
    }
  }
#ifdef UBX_RXM_QZSSL6_DATALEN
  static void onRXMQZSSL6data(UBX_RXM_QZSSL6_message_data_t *qzssData)
  {
    if (NULL != qzssData) {
      GNSS::MSG msg;
      uint16_t size = ((uint16_t)qzssData->lengthMSB << 8) | (uint16_t)qzssData->lengthLSB;
      msg.size = size + 8;
      msg.data = new uint8_t[msg.size];
      double cno = 0.00390625 * qzssData->payload[2] + qzssData->payload[3];
      if (NULL != msg.data) {
        msg.source = GNSS::SOURCE::LBAND;
        memcpy(msg.data, &qzssData->sync1, size + 6);
        memcpy(&msg.data[size + 6], &qzssData->checksumA, 2);
        Log.info("LBAND received RXM-QZSSL6 with %d bytes prn %d C/N0 %.1f dB", msg.size, qzssData->payload[1], cno);
        Gnss.inject(msg); // Push the sync chars, class, ID, length and payload
      } else {
        Log.error("LBAND received RXM-QZSSL6 with %d bytes prn %d C/N0 %.1f dB, no memory", msg.size, qzssData->payload[1], cno);
      }
    }
  }
#endif
  long freq;
  bool online;
  long ttagNextTry;
};

LBAND LBand;

#endif // __LBAND_H__
