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

#include <SparkFun_u-blox_GNSS_Arduino_Library.h>

#include "GNSS.h"

const int LBAND_DETECT_RETRY    = 1000;  //!< Try to detect the received with this intervall
const int LBAND_I2C_ADR         = 0x43;  //!< NEO-D9S I2C address

// helper macros to handle the receiver configuration 
#define LBAND_CHECK_INIT        int _step = 0; bool _ok = true
#define LBAND_CHECK_OK          (_ok)
#define LBAND_CHECK(x)          if (_ok) _step = x, _ok 
#define LBAND_CHECK_EVAL(txt)   if (!_ok) log_e(txt ", sequence failed at step %d", _step)

#define LBAND_FREQ_NONE          0
#define LBAND_FREQ_NOUPDATE     -1

class LBAND {
public:

  LBAND () {
    online = false;
    freq = LBAND_FREQ_NONE;
    ttagNextTry = millis();
  }

  bool detect() {
    //rx.enableDebugging()
#ifdef WEBSOCKET_STREAM
    rx.setOutputPort(Websocket); // forward all messages
#endif  
    bool ok = rx.begin(UbxWire, LBAND_I2C_ADR);
    if (ok)
    {
      log_i("LBAND detect receiver detected");
      freq = Config.getFreq();

      String fwver = GNSS::version("LBAND", &rx);
/* #*/LBAND_CHECK_INIT;
      bool qzss = fwver.startsWith("QZS");
      if (qzss){ // NEO-D9C
        freq = LBAND_FREQ_NOUPDATE; // prevents freq update
#ifdef UBX_RXM_QZSSL6_NUM_CHANNELS
        rx.setRXMQZSSL6messageCallbackPtr(onRXMQZSSL6data);
        LBAND_CHECK(1) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_RXM_QZSSL6_I2C,    1, VAL_LAYER_RAM);    
        // prepare the UART 2
        LBAND_CHECK(2) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_RXM_QZSSL6_UART2,  1, VAL_LAYER_RAM);
        LBAND_CHECK(3) = rx.setVal32(UBLOX_CFG_UART2_BAUDRATE,         38400, VAL_LAYER_RAM);
#else
        log_i("LBAND NEO-D9C receiver not supported by this Sparkfun library, please update library");
#endif
      } else
      { // NEO-D9S
        freq = (freq == LBAND_FREQ_NOUPDATE) ? LBAND_FREQ_NONE : freq;
        rx.setRXMPMPmessageCallbackPtr(onRXMPMPdata);
        // contact support@thingstream.io to get NEO-D9S configuration parameters for PointPerfect LBAND satellite augmentation service in EU / US
        // https://developer.thingstream.io/guides/location-services/pointperfect-getting-started/pointperfect-l-band-configuration
        LBAND_CHECK(1) = rx.setVal8(0x10b10016,                            0, VAL_LAYER_RAM);
        LBAND_CHECK(2) = rx.setVal16(0x30b10015,                      0x6959, VAL_LAYER_RAM);
        LBAND_CHECK(3) = rx.setVal32(UBLOX_CFG_PMP_CENTER_FREQUENCY,    freq, VAL_LAYER_RAM);
        LBAND_CHECK(4) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_RXM_PMP_I2C,       1, VAL_LAYER_RAM);
        LBAND_CHECK(5) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_MON_PMP_I2C,       1, VAL_LAYER_RAM);
        // prepare the UART 2
        LBAND_CHECK(6) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_RXM_PMP_UART2,     1, VAL_LAYER_RAM);
        LBAND_CHECK(7) = rx.setVal32(UBLOX_CFG_UART2_BAUDRATE,         38400, VAL_LAYER_RAM);
      }
      online = ok = LBAND_CHECK_OK;
      LBAND_CHECK_EVAL("LBAND detect configuration");
      if (ok) {
        log_i("LBAND detect configuration complete, %sreceiver online, freq %d", qzss ? "CLAS " : "", freq);
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
          ok = rx.setVal32(UBLOX_CFG_PMP_CENTER_FREQUENCY, newFreq, VAL_LAYER_RAM);
          if (ok) {
            freq = newFreq;
            changed = true;
            rx.softwareResetGNSSOnly(); // do a restart
          }
          else {
            online = false;
          }
        }
        if (!ok) { 
          log_e("LBAND updateFreq to %d failed", newFreq);
        } else if (changed) {
          log_i("LBAND updateFreq to %d", newFreq);
        }
      }
    }
    if (online) {
      rx.checkUblox(); 
      rx.checkCallbacks();
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
      double ebn0 = 0.125 * pmpData->payload[22];
      uint16_t serviceId = pmpData->payload[16] + ((uint16_t)pmpData->payload[17] << 8);
      if (NULL != msg.data) {
        msg.source = GNSS::SOURCE::LBAND;
        memcpy(msg.data, &pmpData->sync1, size + 6);
        memcpy(&msg.data[size + 6], &pmpData->checksumA, 2);
        log_i("LBAND received RXM-PMP with %d bytes Eb/N0 %.1f dB id 0x%04X", msg.size, ebn0, serviceId);
        Gnss.inject(msg); // Push the sync chars, class, ID, length and payload
      } else {
        log_e("LBAND received RXM-PMP with %d bytes Eb/N0 %.1f dB id 0x%04X, no memory", msg.size, ebn0, serviceId);
      }
    }
  }
#ifdef UBX_RXM_QZSSL6_NUM_CHANNELS
  static void onRXMQZSSL6data(UBX_RXM_QZSSL6_message_data_t *qzssData)
  {
    if (NULL != qzssData) {
      GNSS::MSG msg;
      uint16_t size = ((uint16_t)qzssData->lengthMSB << 8) | (uint16_t)qzssData->lengthLSB;
      msg.size = size + 8;
      msg.data = new uint8_t[msg.size];
      int svid = qzssData->payload[1];
      double cno = 0.00390625 * qzssData->payload[2] + qzssData->payload[3];
      if (NULL != msg.data) {
        msg.source = GNSS::SOURCE::LBAND;
        memcpy(msg.data, &qzssData->sync1, size + 6);
        memcpy(&msg.data[size + 6], &qzssData->checksumA, 2);
        log_i("LBAND received RXM-QZSSL6 with %d bytes prn %d C/N0 %.1f dB", msg.size, svid, cno);
        Gnss.inject(msg); // Push the sync chars, class, ID, length and payload
      } else {
        log_e("LBAND received RXM-QZSSL6 with %d bytes prn %d C/N0 %.1f dB, no memory", msg.size, svid, cno);
      }
    }
  }
#endif
  long freq;
  bool online;
  long ttagNextTry;
  SFE_UBLOX_GNSS rx;
};

LBAND LBand;

#endif // __LBAND_H__
