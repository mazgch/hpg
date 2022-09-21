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

#ifdef SPARKFUN_UBLOX_ARDUINO_LIBRARY_H

#else

static const uDeviceCfg_t rxCfgLband = {
    .version = 0,
    .deviceType = U_DEVICE_TYPE_GNSS,
    .deviceCfg = {
        .cfgGnss = {
            .version = 0,
            .moduleType = U_GNSS_MODULE_TYPE_M9,
            .pinEnablePower = PIN_INVALID,
            .pinDataReady = PIN_INVALID, // Not used
            .includeNmea = true,
            .i2cAddress = U_GNSS_I2C_ADDRESS+1,
        },
    },
    .transportType = U_DEVICE_TRANSPORT_TYPE_I2C,
    .transportCfg = {
        .cfgI2c = {
            .version = 0,
            .i2c = 0,
            .pinSda = I2C_SDA,
            .pinScl = I2C_SCL,
            .clockHertz = 400000,
            .alreadyOpen = true
        },
    },
};

// NETWORK configuration for LBAND
static const uNetworkCfgGnss_t gNetworkCfgLband = {
    .version = 0,
    .type = U_NETWORK_TYPE_GNSS,
    .moduleType = U_GNSS_MODULE_TYPE_M9,
    .devicePinPwr = PIN_INVALID,
    .devicePinDataReady = PIN_INVALID
};

static void messageReceiveCallbackLband(uDeviceHandle_t gnssHandle,
                                    const uGnssMessageId_t *pMessageId,
                                    int32_t size,
                                    void *pCallbackParam)
{
  if (size > 0) {
    GNSS::MSG msg;
    msg.size = size;
    msg.data = new uint8_t[size];
    msg.source = GNSS::SOURCE::LBAND;
    if (NULL != msg.data) {
      bool send = false;
      if (uGnssMsgReceiveCallbackRead(gnssHandle, (char*)msg.data, msg.size) == size) {
       if ((msg.data[2] == 0x02/*RXM*/) && (msg.data[3] == 0x72/*PMP*/)) {
          Log.info("LBAND received RXM-PMP with %d bytes Eb/N0 %.1f dB", msg.size, 0.125 * msg.data[6+22]);
          send = true;
        } else if ((msg.data[2] == 0x02/*RXM*/) && (msg.data[3] == 0x73/*QZSS*/))  {
          int svid = msg.data[6+1];
          double cno = 0.00390625 * msg.data[6+2] + msg.data[6+3];
          Log.info("LBAND received RXM-QZSSL6 with %d bytes prn %d C/N0 %.1f dB", msg.size, svid, cno);
          send = true;
        }
      } 
      if (send) {
        Gnss.inject(msg);
      } else {
        delete [] msg.data;
      }
     }
   }
 }
 
#endif

class LBAND {
public:

  LBAND () {
    online = false;
    freq = LBAND_FREQ_NONE;
    ttagNextTry = millis();
  }

  bool detect() {
#ifdef SPARKFUN_UBLOX_ARDUINO_LIBRARY_H
    //rx.enableDebugging();
#ifdef WEBSOCKET_STREAM
    rx.setOutputPort(Websocket); // forward all messages
#endif  
    bool ok = rx.begin(UbxWire, LBAND_I2C_ADR);
#else
    bool ok = 0 <= uDeviceOpen(&rxCfgLband, &devHandleLband);
#endif
    if (ok)
    {
      Log.info("LBAND detect receiver detected");
      freq = Config.getFreq();

#ifdef SPARKFUN_UBLOX_ARDUINO_LIBRARY_H
      String fwver = ubxVersion("LBAND", &rx);
/* #*/LBAND_CHECK_INIT;
      bool qzss = fwver.startsWith("QZS");
      if (qzss){ // NEO-D9C
        freq = LBAND_FREQ_NOUPDATE; // prevents freq update
#ifdef UBX_RXM_QZSSL6_NUM_CHANNELS
        rx.setRXMQZSSL6messageCallbackPtr(onRXMQZSSL6data);
/* 1*/  LBAND_CHECK = rx.setVal(UBLOX_CFG_MSGOUT_UBX_RXM_QZSSL6_I2C,    1,                   VAL_LAYER_RAM);    
        // prepare the UART 2
/* 2*/  LBAND_CHECK = rx.setVal(UBLOX_CFG_MSGOUT_UBX_RXM_QZSSL6_UART2,  1,                   VAL_LAYER_RAM);
/* 3*/  LBAND_CHECK = rx.setVal32(UBLOX_CFG_UART2_BAUDRATE,         38400,                   VAL_LAYER_RAM); // match baudrate with ZED default
#else
        Log.info("LBAND NEO-D9C receiver not supported by this Sparkfun library, please update library");
#endif
      } else
      { // NEO-D9S
        freq = (freq == LBAND_FREQ_NOUPDATE) ? LBAND_FREQ_NONE : freq;
        rx.setRXMPMPmessageCallbackPtr(onRXMPMPdata);
/* 1*/  LBAND_CHECK = rx.setVal16(UBLOX_CFG_PMP_SEARCH_WINDOW,      2200,                    VAL_LAYER_RAM); 
/* 2*/  LBAND_CHECK = rx.setVal8(UBLOX_CFG_PMP_USE_SERVICE_ID,      0,                       VAL_LAYER_RAM); // Default 1 
/* 3*/  LBAND_CHECK = rx.setVal16(UBLOX_CFG_PMP_SERVICE_ID,         21845,                   VAL_LAYER_RAM); // Default 50851
/* 4*/  LBAND_CHECK = rx.setVal16(UBLOX_CFG_PMP_DATA_RATE,          2400,                    VAL_LAYER_RAM); 
/* 5*/  LBAND_CHECK = rx.setVal8(UBLOX_CFG_PMP_USE_DESCRAMBLER,     1,                       VAL_LAYER_RAM); 
/* 6*/  LBAND_CHECK = rx.setVal16(UBLOX_CFG_PMP_DESCRAMBLER_INIT,   26969,                   VAL_LAYER_RAM); // Default 23560
/* 7*/  LBAND_CHECK = rx.setVal8(UBLOX_CFG_PMP_USE_PRESCRAMBLING,   0,                       VAL_LAYER_RAM); 
/* 8*/  LBAND_CHECK = rx.setVal64(UBLOX_CFG_PMP_UNIQUE_WORD,        16238547128276412563ull, VAL_LAYER_RAM); 
/* 9*/  LBAND_CHECK = rx.setVal32(UBLOX_CFG_PMP_CENTER_FREQUENCY,   freq,                    VAL_LAYER_RAM);
/*10*/  LBAND_CHECK = rx.setVal(UBLOX_CFG_MSGOUT_UBX_RXM_PMP_I2C,   1,                       VAL_LAYER_RAM);
        // prepare the UART 2
/*11*/  LBAND_CHECK = rx.setVal(UBLOX_CFG_MSGOUT_UBX_RXM_PMP_UART2, 1,                       VAL_LAYER_RAM);
/*12*/  LBAND_CHECK = rx.setVal32(UBLOX_CFG_UART2_BAUDRATE,         38400,                   VAL_LAYER_RAM); // match baudrate with ZED default
      }
#else
      uGnssSetUbxMessagePrint(devHandleLband, false);
      uGnssVersionType_t version;
      LBAND_CHECK_INIT;
      LBAND_CHECK = 0 <= uGnssInfoGetVersions(devHandleLband, &version);
      Log.info("LBAND detect receiver detected, version %s hw %s rom %s fw %s prot %s mod %s.", version.ver, version.hw, 
              version.rom, version.fw, version.prot, version.mod);
      String fwver = version.fw;
      bool qzss = fwver.startsWith("QZS");
      if (qzss){ // NEO-D9C
          freq = LBAND_FREQ_NOUPDATE; // prevents freq update
          LBAND_CHECK = U_GNSS_CFG_SET_VAL(devHandleLband, MSGOUT_UBX_RXM_QZSSL6_I2C_U1,   1, U_GNSS_CFG_VAL_LAYER_RAM);    
          // prepare the UART 2
          LBAND_CHECK = U_GNSS_CFG_SET_VAL(devHandleLband, MSGOUT_UBX_RXM_QZSSL6_UART2_U1, 1, U_GNSS_CFG_VAL_LAYER_RAM);    
          LBAND_CHECK = U_GNSS_CFG_SET_VAL(devHandleLband, UART2_BAUDRATE_U4,          38400, U_GNSS_CFG_VAL_LAYER_RAM); 
        } else
        { // NEO-D9S
          freq = (freq == LBAND_FREQ_NOUPDATE) ? LBAND_FREQ_NONE : freq;
          LBAND_CHECK = 0 <= U_GNSS_CFG_SET_VAL(devHandleLband, PMP_SEARCH_WINDOW_U2,        2200, U_GNSS_CFG_VAL_LAYER_RAM);    
          LBAND_CHECK = 0 <= U_GNSS_CFG_SET_VAL(devHandleLband, PMP_USE_SERVICE_ID_L,           0, U_GNSS_CFG_VAL_LAYER_RAM);    
          LBAND_CHECK = 0 <= U_GNSS_CFG_SET_VAL(devHandleLband, PMP_SERVICE_ID_U2,          21845, U_GNSS_CFG_VAL_LAYER_RAM);    
          LBAND_CHECK = 0 <= U_GNSS_CFG_SET_VAL(devHandleLband, PMP_DATA_RATE_E2,            2400, U_GNSS_CFG_VAL_LAYER_RAM);    
          LBAND_CHECK = 0 <= U_GNSS_CFG_SET_VAL(devHandleLband, PMP_USE_DESCRAMBLER_L,          1, U_GNSS_CFG_VAL_LAYER_RAM);    
          LBAND_CHECK = 0 <= U_GNSS_CFG_SET_VAL(devHandleLband, PMP_DESCRAMBLER_INIT_U2,    26969, U_GNSS_CFG_VAL_LAYER_RAM);    
          LBAND_CHECK = 0 <= U_GNSS_CFG_SET_VAL(devHandleLband, PMP_USE_PRESCRAMBLING_L,        0, U_GNSS_CFG_VAL_LAYER_RAM);    
          LBAND_CHECK = 0 <= U_GNSS_CFG_SET_VAL(devHandleLband, PMP_UNIQUE_WORD_U8, 16238547128276412563ull, U_GNSS_CFG_VAL_LAYER_RAM);    
          LBAND_CHECK = 0 <= U_GNSS_CFG_SET_VAL(devHandleLband, PMP_CENTER_FREQUENCY_U4,     freq, U_GNSS_CFG_VAL_LAYER_RAM);    
          LBAND_CHECK = 0 <= U_GNSS_CFG_SET_VAL(devHandleLband, MSGOUT_UBX_RXM_PMP_I2C_U1,      1, U_GNSS_CFG_VAL_LAYER_RAM);    
          LBAND_CHECK = 0 <= U_GNSS_CFG_SET_VAL(devHandleLband, MSGOUT_UBX_RXM_PMP_UART2_U1,    1, U_GNSS_CFG_VAL_LAYER_RAM);    
          LBAND_CHECK = 0 <= U_GNSS_CFG_SET_VAL(devHandleLband, UART2_BAUDRATE_U4,          38400, U_GNSS_CFG_VAL_LAYER_RAM); 
      }
      LBAND_CHECK = 0 <= uNetworkInterfaceUp(devHandleLband, U_NETWORK_TYPE_GNSS, &gNetworkCfgLband);  
      uGnssMessageId_t messageId;
      messageId.type = U_GNSS_PROTOCOL_ALL;
      asyncHandleLband = uGnssMsgReceiveStart(devHandleLband, &messageId,
                                                messageReceiveCallbackLband,
                                                (void*)"LBAND");
#endif
      online = ok = LBAND_CHECK_OK;
      LBAND_CHECK_EVAL("LBAND detect configuration");
      if (ok) {
        Log.info("LBAND detect configuration complete, %sreceiver online, freq %d", qzss ? "CLAS " : "", freq);
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
#ifdef SPARKFUN_UBLOX_ARDUINO_LIBRARY_H
          ok = rx.setVal32(UBLOX_CFG_PMP_CENTER_FREQUENCY, newFreq, VAL_LAYER_RAM);
#else
          ok = 0 <= U_GNSS_CFG_SET_VAL(devHandleLband, PMP_CENTER_FREQUENCY_U4, newFreq, U_GNSS_CFG_VAL_LAYER_RAM); 
#endif
          if (ok) {
            freq = newFreq;
            changed = true;
#ifdef SPARKFUN_UBLOX_ARDUINO_LIBRARY_H
            rx.softwareResetGNSSOnly(); // do a restart
#endif
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
#ifdef SPARKFUN_UBLOX_ARDUINO_LIBRARY_H
      rx.checkUblox(); 
      rx.checkCallbacks();
#endif
    }
    HW_DBG_LO(HW_DBG_LBAND);
  }
  
protected:
#ifdef SPARKFUN_UBLOX_ARDUINO_LIBRARY_H
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
        Log.info("LBAND received RXM-QZSSL6 with %d bytes prn %d C/N0 %.1f dB", msg.size, svid, cno);
        Gnss.inject(msg); // Push the sync chars, class, ID, length and payload
      } else {
        Log.error("LBAND received RXM-QZSSL6 with %d bytes prn %d C/N0 %.1f dB, no memory", msg.size, svid, cno);
      }
    }
  }
#endif
#endif
  long freq;
  bool online;
  long ttagNextTry;
#ifdef SPARKFUN_UBLOX_ARDUINO_LIBRARY_H
  SFE_UBLOX_GNSS rx;
#else
  uDeviceHandle_t devHandleLband;
  int32_t asyncHandleLband;
#endif

};

LBAND LBand;

#endif // __LBAND_H__
