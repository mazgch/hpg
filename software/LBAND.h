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

#include "GNSS.h" // required vor version, defines or macros

const int LBAND_I2C_ADR           =        0x43;  //!< NEO-D9S I2C address

//! because rx.softwareEnableGNSS(en) is not yet available in the sparkfun library 
#define softwareEnableGNSS(en) setVal(qzss ? UBLOX_CFG_MSGOUT_UBX_RXM_QZSSL6_I2C \
                                           : UBLOX_CFG_MSGOUT_UBX_RXM_PMP_I2C, en, VAL_LAYER_RAM)

/** This class encapsulates all LBAND functions. 
*/
class LBAND {
  
public:

  /** constructor
   */
  LBAND () {
    online = false;
    qzss = false;
    curFreq = 0;
    curPower = false;
    ttagNextTry = millis();
  }

  /** detect and configure the receiver, inject saved keys
   *  \return  true if receiver is sucessfully detected, false if not
   */
  bool detect(void) {
    //rx.enableDebugging()
#ifndef USE_UBXWIRE
    rx.setOutputPort(pipeWireToCommTask);
#endif
    bool ok = rx.begin(UbxWire, LBAND_I2C_ADR);
    if (ok) {
      log_i("receiver detected");
      String region;
      curFreq = 0;
      Config.getLbandCfg(region, curFreq);
      String fwver = GNSS::version("LBAND", &rx);
      qzss = fwver.startsWith("QZS");
      GNSS_CHECK_INIT;
      GNSS_CHECK(1) = rx.setVal32(UBLOX_CFG_UART2_BAUDRATE,         38400, VAL_LAYER_RAM);
      if (qzss) { // NEO-D9C
        rx.setRXMQZSSL6messageCallbackPtr(onRXMQZSSL6);
        // prepare the UART 2
        GNSS_CHECK(2) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_RXM_QZSSL6_UART2,  1, VAL_LAYER_RAM);
        // prepare I2C
        GNSS_CHECK(3) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_RXM_QZSSL6_I2C,    1, VAL_LAYER_RAM);  
        curPower = region.equals("jp");
      } else { // NEO-D9S
        rx.setRXMPMPmessageCallbackPtr(onRXMPMP);
        // prepare the UART 2
        GNSS_CHECK(4) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_RXM_PMP_UART2,     1, VAL_LAYER_RAM);
        // prepare I2C
        GNSS_CHECK(5) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_RXM_PMP_I2C,       1, VAL_LAYER_RAM);
        GNSS_CHECK(6) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_MON_PMP_I2C,       1, VAL_LAYER_RAM);
        // contact support@thingstream.io to get NEO-D9S configuration parameters for PointPerfect LBAND satellite augmentation service in EU / US
        // https://developer.thingstream.io/guides/location-services/pointperfect-getting-started/pointperfect-l-band-configuration
        GNSS_CHECK(7) = rx.setVal8(0x10b10016,                            0, VAL_LAYER_RAM);
        GNSS_CHECK(8) = rx.setVal16(0x30b10015,                      0x6959, VAL_LAYER_RAM);
        if (curFreq) {
          GNSS_CHECK(9)= rx.setVal32(UBLOX_CFG_PMP_CENTER_FREQUENCY,curFreq, VAL_LAYER_RAM);
        }
        curPower = (0 < curFreq);
      }
      online = ok = GNSS_CHECK_OK;
      GNSS_CHECK_EVAL("configuration");
      if (ok) {
        CONFIG::USE_SOURCE useSrc = Config.getUseSource();
        curPower = ((useSrc & CONFIG::USE_SOURCE::USE_LBAND) && (useSrc & CONFIG::USE_SOURCE::USE_POINTPERFECT)) ? curPower : false;
        rx.softwareEnableGNSS(curPower);
        if (qzss) {
          log_i("configuration complete, receiver online, %s", curPower ? "started" : "stopped");
        } else { 
          log_i("configuration complete, receiver online, freq %d %s", curFreq, curPower ? "started" : "stopped");
        }
      }
    }
    return ok;
  }

  /** This needs to be called from a task periodically, it makes sure the receiver is detected 
   *  and callbacks are processed. 
   */
  void poll(void) {
    int32_t now = millis();
    if (0 >= (ttagNextTry - now)) {
      ttagNextTry = now + GNSS_DETECT_RETRY;
      if (!online) {
        detect();
      } else {
        config();
      }
    }
    if (online) {
      rx.checkUblox(); 
      rx.checkCallbacks();
    }
  }
  
protected:

  /** process the UBX-RXM-PMP message, extract information for the console and inject to the GNSS
   *  \param pmpData  the UBX-RXM-PMP payload
   */
  static void onRXMPMP(UBX_RXM_PMP_message_data_t *pmpData)
  {
    if (NULL != pmpData) {
      double ebn0 = 0.125 * pmpData->payload[22];
      uint16_t serviceId = pmpData->payload[16] + ((uint16_t)pmpData->payload[17] << 8);
      uint16_t size = ((uint16_t)pmpData->lengthMSB << 8) | (uint16_t)pmpData->lengthLSB;
      MSG msg(size + 8, MSG::SRC::LBAND, MSG::CONTENT::CORRECTIONS);
      if (msg) {
        memcpy(msg.data, &pmpData->sync1, size + 6);
        memcpy(msg.data + size + 6, &pmpData->checksumA, 2);
        log_i("received RXM-PMP with %d bytes Eb/N0 %.1f dB id 0x%04X", msg.size, ebn0, serviceId);
        queueToGnss.send(msg); // Push the sync chars, class, ID, length and payload
      } else {
        log_e("received RXM-PMP with %d bytes Eb/N0 %.1f dB id 0x%04X, no memory", msg.size, ebn0, serviceId);
      }
    }
  }
  
  /** process the UBX-RXM-QZSSL6 message, extract information for the console and inject to the GNSS
   *  \param qzssData  the UBX-RXM-QZSSL6 payload
   */
  static void onRXMQZSSL6(UBX_RXM_QZSSL6_message_data_t *qzssData)
  {
    if (NULL != qzssData) {
      int svid = qzssData->payload[1];
      double cno = 0.00390625 * qzssData->payload[2] + qzssData->payload[3];
      uint16_t size = ((uint16_t)qzssData->lengthMSB << 8) | (uint16_t)qzssData->lengthLSB;
      MSG msg(size + 8, MSG::SRC::LBAND, MSG::CONTENT::CORRECTIONS);
      if (msg) {
        memcpy(msg.data, &qzssData->sync1, size + 6);
        memcpy(msg.data + size + 6, &qzssData->checksumA, 2);
        log_i("received RXM-QZSSL6 with %d bytes prn %d C/N0 %.1f dB", msg.size, svid, cno);
        queueToGnss.send(msg); // Push the sync chars, class, ID, length and payload
      } else {
        log_e("received RXM-QZSSL6 with %d bytes prn %d C/N0 %.1f dB, no memory", msg.size, svid, cno);
      }
    }
  }

  /** Make sure that the receiver has the right frequency configured, this depends on the region/location and 
   *  switch power off if the region does not support the signal or have a LBAND frequency to recive
   */
  void config(void) {
    // do update the ferquency from time to time
    bool newPower = false;
    CONFIG::USE_SOURCE useSrc = Config.getUseSource();
    if ((useSrc & CONFIG::USE_SOURCE::USE_LBAND) && (useSrc & CONFIG::USE_SOURCE::USE_POINTPERFECT)) {
      String region;
      uint32_t newFreq = 0;
      if (Config.getLbandCfg(region, newFreq)) {
        if (qzss) {
          newPower = region.equals("jp");
        } else {
          newPower = (0 < newFreq);
          if (newPower && (curFreq != newFreq)) {
            if (rx.setVal32(UBLOX_CFG_PMP_CENTER_FREQUENCY, newFreq, VAL_LAYER_RAM)) {
              curFreq = newFreq;
              if (curPower) {
                rx.softwareResetGNSSOnly();
                log_i("config freq %lu, reset", newFreq);
              } else {
                rx.softwareEnableGNSS(true);
                curPower = true;
                log_i("config freq %lu, started", newFreq);
              }
            } else {
              log_w("config freq %lu, failed, retry later", newFreq);
              newPower = curPower; // don't change the power in that case
            }
          }
        }
      }
    }
    if (curPower != newPower) {
      rx.softwareEnableGNSS(newPower);
      curPower = newPower;
      log_i("%s", newPower ? "started" : "stopped");
    }
  }
  
  bool online;            //!< flag that indicates if the receiver is connected
  int32_t ttagNextTry;    //!< time tag when to call the state machine again
  SFE_UBLOX_GNSS rx;      //!< the receiver object
  uint32_t curFreq;       //!< the current configured frequency
  bool curPower;          //!< the current power mode
  bool qzss;              //!<true if the receiver is a NEO-D9C 
};

LBAND LBand; //!< The global GNSS peripherial object

#endif // __LBAND_H__
