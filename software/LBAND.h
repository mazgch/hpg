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

#define LBAND_FREQ_NONE                       0   
#define LBAND_FREQ_NOUPDATE                  -1

/** This class encapsulates all LBAND functions. 
*/
class LBAND {
  
public:

  /** constructor
   */
  LBAND () {
    online = false;
    curFreq = LBAND_FREQ_NONE;
    ttagNextTry = millis();
  }

  /** detect and configure the receiver, inject saved keys
   *  \return  true if receiver is sucessfully detected, false if not
   */
  bool detect(void) {
    //rx.enableDebugging()
    rx.setOutputPort(Websocket); // forward all messages
    bool ok = rx.begin(UbxWire, LBAND_I2C_ADR);
    if (ok)
    {
      log_i("receiver detected");
      curFreq = Config.getFreq();

      String fwver = GNSS::version("LBAND", &rx);
      GNSS_CHECK_INIT;
      bool qzss = fwver.startsWith("QZS");
      if (qzss){ // NEO-D9C
        curFreq = LBAND_FREQ_NOUPDATE; // prevents freq update
#ifdef UBX_RXM_QZSSL6_NUM_CHANNELS
        rx.setRXMQZSSL6messageCallbackPtr(onRXMQZSSL6);
        GNSS_CHECK(1) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_RXM_QZSSL6_I2C,    1, VAL_LAYER_RAM);    
        // prepare the UART 2
        GNSS_CHECK(2) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_RXM_QZSSL6_UART2,  1, VAL_LAYER_RAM);
        GNSS_CHECK(3) = rx.setVal32(UBLOX_CFG_UART2_BAUDRATE,         38400, VAL_LAYER_RAM);
#else
        log_i("NEO-D9C receiver not supported by this Sparkfun library, please update library");
#endif
      } else
      { // NEO-D9S
        curFreq = (curFreq == LBAND_FREQ_NOUPDATE) ? LBAND_FREQ_NONE : curFreq;
        rx.setRXMPMPmessageCallbackPtr(onRXMPMP);
        // contact support@thingstream.io to get NEO-D9S configuration parameters for PointPerfect LBAND satellite augmentation service in EU / US
        // https://developer.thingstream.io/guides/location-services/pointperfect-getting-started/pointperfect-l-band-configuration
        GNSS_CHECK(1) = rx.setVal8(0x10b10016,                            0, VAL_LAYER_RAM);
        GNSS_CHECK(2) = rx.setVal16(0x30b10015,                      0x6959, VAL_LAYER_RAM);
        GNSS_CHECK(3) = rx.setVal32(UBLOX_CFG_PMP_CENTER_FREQUENCY, curFreq, VAL_LAYER_RAM);
        GNSS_CHECK(4) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_RXM_PMP_I2C,       1, VAL_LAYER_RAM);
        GNSS_CHECK(5) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_MON_PMP_I2C,       1, VAL_LAYER_RAM);
        // prepare the UART 2
        GNSS_CHECK(6) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_RXM_PMP_UART2,     1, VAL_LAYER_RAM);
        GNSS_CHECK(7) = rx.setVal32(UBLOX_CFG_UART2_BAUDRATE,         38400, VAL_LAYER_RAM);
      }
      online = ok = GNSS_CHECK_OK;
      GNSS_CHECK_EVAL("configuration");
      if (ok) {
        log_i("configuration complete, %sreceiver online, freq %d", qzss ? "CLAS " : "", curFreq);
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
      }
      updateFreq();
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
        log_e("received RXM-PMP with %d bytes Eb/N0 %.1f dB id 0x%04X, no memory", msg.size, ebn0, serviceId);
      }
    }
  }
  
#ifdef UBX_RXM_QZSSL6_NUM_CHANNELS
  /** process the UBX-RXM-QZSSL6 message, extract information for the console and inject to the GNSS
   *  \param qzssData  the UBX-RXM-QZSSL6 payload
   */
  static void onRXMQZSSL6(UBX_RXM_QZSSL6_message_data_t *qzssData)
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
        log_i("received RXM-QZSSL6 with %d bytes prn %d C/N0 %.1f dB", msg.size, svid, cno);
        Gnss.inject(msg); // Push the sync chars, class, ID, length and payload
      } else {
        log_e("received RXM-QZSSL6 with %d bytes prn %d C/N0 %.1f dB, no memory", msg.size, svid, cno);
      }
    }
  }
#endif

  /** Make sure that the receiver has the right frequency configured, this depends on the region/location
   */
  void updateFreq(void) {
    // do update the ferquency from time to time
    int newFreq = Config.getFreq();
    if ((newFreq != LBAND_FREQ_NONE) && (curFreq != LBAND_FREQ_NOUPDATE) && (curFreq != newFreq)) {
      bool ok = true;
      bool changed = false;
      if (online) {
        ok = rx.setVal32(UBLOX_CFG_PMP_CENTER_FREQUENCY, newFreq, VAL_LAYER_RAM);
        if (ok) {
          curFreq = newFreq;
          changed = true;
          rx.softwareResetGNSSOnly(); // do a restart
        }
        else {
          online = false;
        }
      }
      if (!ok) { 
        log_e("config freq %d, failed", newFreq);
      } else if (changed) {
        log_i("config freq %d", newFreq);
      }
    }
  }
  
  bool online;            //!< flag that indicates if the receiver is connected
  int32_t ttagNextTry;    //!< time tag when to call the state machine again
  SFE_UBLOX_GNSS rx;      //!< the receiver object
  uint32_t curFreq;       //!< the current configured requency
};

LBAND LBand; //!< The global GNSS peripherial object

#endif // __LBAND_H__
