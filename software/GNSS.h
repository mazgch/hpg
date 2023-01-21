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
 
#ifndef __GNSS_H__
#define __GNSS_H__

#include <SparkFun_u-blox_GNSS_v3.h>

class SFE_UBLOX_GNSS_ex : public SFE_UBLOX_GNSS {

public:
  /** get, decode and dump the version
   *  \param tag  the receiver tag as this function is reused by LBAND
   *  \param pRx  handle to the receiver
   *  \return     the extracted firmware version string
   */
  String version(const char* tag) {
    String fwver; 
    struct { char sw[30]; char hw[10]; char ext[10][30]; } info;
    ubxPacket cfg = { UBX_CLASS_MON, UBX_MON_VER, 0, 0, 0, (uint8_t*)&info, 0, 0, SFE_UBLOX_PACKET_VALIDITY_NOT_DEFINED, SFE_UBLOX_PACKET_VALIDITY_NOT_DEFINED};
    setPacketCfgPayloadSize(sizeof(info)+8);
    if (sendCommand(&cfg, 300) == SFE_UBLOX_STATUS_DATA_RECEIVED) {
      char ext[10*34+6] = "";
      char* p = ext;
      for (int i = 0; cfg.len > (30 * i + 40); i ++) {
        if (*info.ext[i]) {
          p += sprintf(p, "%s \"%s\"", (p==ext) ? " ext" : ",", info.ext[i]);
          if (0 == strncmp(info.ext[i], "FWVER=",6)) {
            fwver = info.ext[i] + 6;
          }
        }
      }
      log_i("receiver %s hw %s sw \"%s\"%s", tag, info.hw, info.sw, ext);
    }
    return fwver;
  } 

protected: 
  bool lock(void) override { 
    return pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY); 
  }
  void unlock(void) override {
    xSemaphoreGive(mutex);
  }
  static SemaphoreHandle_t mutex;
};

SemaphoreHandle_t SFE_UBLOX_GNSS_ex::mutex = xSemaphoreCreateMutex();

/** Configure the dynamic model of the receiver
 *  possible choice is between AUTOMOTIVE, SCOOTER, MOWER, PORTABLE (=no DR), UNKNOWN (= no change)
 */
#define GNSS_DYNAMIC_MODEL     DYN_MODEL_UNKNOWN 

/* Using wtBox.ino as hall sensor to WT converter, ESF-MEAS is injected over ZED-RX1
 *  
 *  example for BOSCH Indigo S+ 500
 *  - wheel diameter:       ~16.5 cm
 *  - wheel circumference:  ~53.0 cm 
 *  - ticks per revolution:  1540 ticks
*/
const int32_t GNSS_ODO_FACTOR = (uint32_t)( 0.53 /* wheel circumference m */ 
                                           * 1e6 /* scale value to unit needed */ 
                                          / 1540 /* ticks per revolution */
                                             / 2 /* left and right wheel */);  //!< set the ODO factor for lawn mower 

const int GNSS_DETECT_RETRY       =        1000;  //!< Try to detect the received with this intervall
const int GNSS_CORRECTION_TIMEOUT =       12000;  //!< If the current correction source has not received data for this period we will switch to the next source that receives data. 
const int GNSS_I2C_ADR            =        0x42;  //!< ZED-F9x I2C address

// helper macros to handle the receiver configuration 
#define GNSS_CHECK_INIT           int _step = 0; bool _ok = true  //!< init variable
#define GNSS_CHECK(s)             if (_ok) _step = s, _ok         //!< record the return result
#define GNSS_CHECK_OK             (_ok)                           //!< interim evaluate
#define GNSS_CHECK_EVAL(txt)      if (!_ok) log_e(txt ", sequence failed at step %d", _step) //!< final verdict and log_e report
            
extern class GNSS Gnss; //!< Forward declaration of class
    
/** This class encapsulates all GNSS functions. 
*/
class GNSS {

public:
  
  /** constructor
   */
  GNSS(void) {
    online = false;
    ttagNextTry = millis();
    spartnUseSource = -1;
    curSrc = MSG::text(MSG::SRC::NONE); 
    ttagSpartn = ttagNextTry;
  }

  /** detect and configure the receiver, inject saved keys
   *  \return  true if receiver is sucessfully detected, false if not
   */
  bool detect(void) {
#ifndef USE_UBXWIRE
    rx.setOutputPort(pipeWireToCommTask);
#endif
    bool ok = rx.begin(UbxWire, GNSS_I2C_ADR); //Connect to the Ublox module using Wire port
    if (ok) {
      log_i("receiver detected");
      if (rx.getModuleInfo()) {
        log_i("receiver detected module \"%s\" firmware \"%s\" version %d.%d protocol %d.%d", 
              rx.getModuleName(), rx.getFirmwareType(),
              rx.getFirmwareVersionHigh(), rx.getFirmwareVersionLow(),
              rx.getProtocolVersionHigh(), rx.getProtocolVersionLow());
      }
      String fwver = rx.version("GNSS");
      if ((fwver.substring(4).toDouble() <= 1.30) && !fwver.substring(4).equals("1.30")) { 
        // ZED-F9R/P old release firmware, no Spartan 2.0 support
        log_e("firmware \"%s\" is old, please update firmware to release \"HPS 1.30\"", fwver.c_str());
      } 
      GNSS_CHECK_INIT;
      GNSS_CHECK(0) = rx.newCfgValset(VAL_LAYER_RAM);
      GNSS_CHECK(1) = rx.setAutoPVTcallbackPtr(onPVT);
      GNSS_CHECK(2) = rx.addCfgValset(UBLOX_CFG_MSGOUT_UBX_NAV_PVT_I2C,        1); // required for this app and the monitor web page
      // add some usefull messages to store in the logfile
      GNSS_CHECK(3) = rx.addCfgValset(UBLOX_CFG_NMEA_HIGHPREC,                 1); // make sure we enable extended accuracy in NMEA protocol
      GNSS_CHECK(4) = rx.addCfgValset(UBLOX_CFG_MSGOUT_UBX_NAV_SAT_I2C,        1); 
      GNSS_CHECK(5) = rx.addCfgValset(UBLOX_CFG_MSGOUT_UBX_NAV_HPPOSLLH_I2C,   1);
      GNSS_CHECK(6) = rx.addCfgValset(UBLOX_CFG_MSGOUT_UBX_RXM_COR_I2C,        1);
      if ((fwver.substring(4).toDouble() > 1.30) || fwver.substring(4).equals("1.30")) {
        GNSS_CHECK(7) = rx.addCfgValset(UBLOX_CFG_MSGOUT_UBX_NAV_PL_I2C,       1);
      }
      if (fwver.startsWith("HPS ")) {
        GNSS_CHECK(8) = rx.addCfgValset(UBLOX_CFG_MSGOUT_UBX_ESF_STATUS_I2C,   1);
        if (GNSS_DYNAMIC_MODEL != DYN_MODEL_UNKNOWN) {
          GNSS_CHECK(9) = rx.addCfgValset(UBLOX_CFG_NAVSPG_DYNMODEL, GNSS_DYNAMIC_MODEL);
          if (GNSS_DYNAMIC_MODEL == DYN_MODEL_PORTABLE) {
            log_i("dynModel PORTABLE, disable DR/SF modes");
            // disable sensor fusion mode in case we use a portable dynamic model
            GNSS_CHECK(10) = rx.addCfgValset(UBLOX_CFG_SFCORE_USE_SF,           0);
          } else if (GNSS_DYNAMIC_MODEL == DYN_MODEL_MOWER) {
            log_i("dynModel MOWER");
            GNSS_CHECK(11) = rx.addCfgValset(UBLOX_CFG_SFODO_FACTOR, GNSS_ODO_FACTOR);
            GNSS_CHECK(12) = rx.addCfgValset(UBLOX_CFG_SFODO_COMBINE_TICKS,     1);
            GNSS_CHECK(13) = rx.addCfgValset(UBLOX_CFG_SFODO_DIS_AUTODIRPINPOL, 1);
          } else if (GNSS_DYNAMIC_MODEL == DYN_MODEL_ESCOOTER) {
            log_i("dynModel ESCOOTER");
            // do whateever you need to do
          } else if (GNSS_DYNAMIC_MODEL == DYN_MODEL_AUTOMOTIVE) {
            log_i("dynModel AUTOMOTIVE");
            /*  We assume we use CANBUS.h to inject speed extracted from the CAN bus as ESF-MEAS 
             *  to the GNSS. if this is not the case change the settings here, if ticks are used, 
             *  you should also set the UBLOX_CFG_SFODO_FACTOR factor. 
             *  
             *  You can use the canEmu.ino to create a test setup for can injecton. 
             */
            GNSS_CHECK(14) = rx.addCfgValset(UBLOX_CFG_SFODO_DIS_AUTOSW,        0); // enable it
          } else {
            log_i("dynModel %d", GNSS_DYNAMIC_MODEL);
          }
        } 
      }
      GNSS_CHECK(10)= rx.sendCfgValset();
      online = ok = GNSS_CHECK_OK;
      GNSS_CHECK_EVAL("configuration");
      if (ok) {
        log_i("configuration complete, receiver online");
        uint8_t keys[MQTT_MAX_KEY_SIZE];
        int size = Config.getValue(CONFIG_VALUE_KEY,keys, MQTT_MAX_KEY_SIZE);
        if (0 < size) {
          log_i("inject saved keys");
          ok = rx.pushRawData(keys, size);
        }
      }
    }
    return ok;
  }

  /** This needs to be called from a task periodically, it makes sure the receiver is detected, 
   *  callbacks are processed and the queue is processed and its data is sent to the reciever.  
   */
  void poll(void) {
    int32_t now = millis();
    if (0 >= (ttagNextTry - now)) {
      ttagNextTry = now + GNSS_DETECT_RETRY;
      if (!online) {
        detect();
      }
    }
    if (online) {
      rx.checkUblox();
      rx.checkCallbacks();
    }
  }

  void sendToGnssParsed(MSG &msg) {
    checkSpartanUseSourceCfg(msg.src, msg.hint);
    uint8_t *p = msg.data;
    size_t size = msg.size; 
    while ((0 < size) && online) {
      MSG::HINT hint = MSG::HINT::NONE;
      size_t len = PROTOCOL::parse(p, size, hint);
      if ((len == PROTOCOL::WAIT) || (len == PROTOCOL::NOTFOUND)) {
        break;
      }
      online = rx.pushRawData(p, len);
      p += len;
      size -= len;
    }
    if ((0 < size) && online) {
      online = rx.pushRawData(p, size);
    }
    if (online) {
      log_d("%d bytes from %s source", msg.size, MSG::text(msg.src));
    } else {
      log_e("%d/%d bytes from %s source failed", msg.size-size, msg.size, MSG::text(msg.src));
    }
  }

  void sendToGnss(MSG &msg) {
    checkSpartanUseSourceCfg(msg.src, msg.hint);
    online = rx.pushRawData(msg.data, msg.size);
    if (online) {
      log_d("%d bytes from %s source", msg.size, MSG::text(msg.src));
    } else {
      log_e("%d bytes from %s source failed", msg.size, MSG::text(msg.src));
    }
  }
  
protected:

  const char* curSrc;
  uint8_t spartnUseSource;  //!< current source in use of correction data
  int32_t ttagSpartn;      //!< the time (millis()) of last correction data reception for lband and IP
  int32_t ttagCorrections;      //!< the time (millis()) of last correction data reception for lband and IP
  
  /** Check the current source of data and make sure the receiver is configured correctly so that it can process the protocol / data.
   *  \param src   the source of which it got correction data. 
   *  \param hint  a hint what kind of data 
   *  \return      true if this is the souce is the chosen source. 
   */
  void checkSpartanUseSourceCfg(MSG::SRC src, MSG::HINT hint) {
    int32_t now = millis();
    enum { USE_RXMPMP = 1, USE_SPARTN = 0 };
    if ((hint == MSG::HINT::SPARTN) || (hint ==  MSG::HINT::RXMPMP)) {
      uint8_t newUseSource = (hint == MSG::HINT::RXMPMP) ? USE_RXMPMP : USE_SPARTN;
      // manage correction stream selection 
      if (hint == MSG::HINT::SPARTN) {
        ttagSpartn = millis() + GNSS_CORRECTION_TIMEOUT;
      }
      if (spartnUseSource != newUseSource) { // source would change
        if ((hint == MSG::HINT::SPARTN) || (0 >= (ttagSpartn - now))) { // stick with spartn SPARTN, unless we did not get a message since a while 
          // we are not switching to an error here, sometimes this command is not acknowledged, so we will just retry next time. 
          GNSS_CHECK_INIT;
          GNSS_CHECK(0) = rx.newCfgValset(VAL_LAYER_RAM);
          GNSS_CHECK(1) = rx.addCfgValset(UBLOX_CFG_SPARTN_USE_SOURCE, newUseSource);
          GNSS_CHECK(2) = rx.sendCfgValset();
          GNSS_CHECK_EVAL("set useSource");
          if (GNSS_CHECK_OK) {
            log_i("spartnUseSource %d from source %s with hint %s", newUseSource, MSG::text(src), MSG::text(hint));
            spartnUseSource = newUseSource;
          } else {
            // WORKAROUND: for some reson the spartanUseSource command fails, reason is unknow, we dont realy worry here and will do it just again next time 
            log_w("spartnUseSource %d from source %s with hint %s failed", newUseSource, MSG::text(src), MSG::text(hint));
          }
        }
      }
    }
    if (hint == MSG::HINT::SPARTN) {
      if (spartnUseSource == USE_SPARTN) {
        curSrc = MSG::text(src);
      }
    } else if (hint == MSG::HINT::RXMPMP) {
      if (spartnUseSource != USE_RXMPMP) {
        curSrc = MSG::text(src);
      }
    } else if (hint == MSG::HINT::RXMQZSSL6) {
      curSrc = "CLAS";
    } else if (hint == MSG::HINT::RTCM) {
      curSrc = MSG::text(src);
    } else if (src == MSG::SRC::BLUETOOTH) {
      // assume ntrip client runs on mobile 
      curSrc = MSG::text(src);
    }
  }
  
  /** process the UBX-NAV-PVT message, extract information for the console, monitor and needed for the correction clients
   *  \param ubxDataStruct  the UBX-NAV-PVT payload
   */
  static void onPVT(UBX_NAV_PVT_data_t *ubxDataStruct) {
    if (ubxDataStruct) {
      const char* fixLut[] = { "No","DR", "2D", "3D", "3D+DR", "TM", "", "" }; 
      const char* carrLut[] = { "No","Float", "Fixed", "" }; 
      uint8_t fixType = ubxDataStruct->fixType; // Print the fix type
      uint8_t carrSoln = ubxDataStruct->flags.bits.carrSoln; // Print the carrier solution
      double fLat = 1e-7 * ubxDataStruct->lat;
      double fLon = 1e-7 * ubxDataStruct->lon;
      log_i("%d.%d.%d %02d:%02d:%02d lat %.7f lon %.7f msl %.3f fix %d(%s)%s carr %d(%s) hacc %.3f svs %d source %s", 
            ubxDataStruct->day, ubxDataStruct->month, ubxDataStruct->year, ubxDataStruct->hour, ubxDataStruct->min,ubxDataStruct->sec, 
            fLat, fLon, 1e-3 * ubxDataStruct->hMSL, fixType, fixLut[fixType & 7], ubxDataStruct->flags.bits.gnssFixOK ? "+OK": "", carrSoln, carrLut[carrSoln & 3], 
            1e-3*ubxDataStruct->hAcc, ubxDataStruct->numSV, Gnss.curSrc);
            
      // update the pointperfect topic and lband frequency depending on region we are in
      if ((fixType != 0) && (ubxDataStruct->flags.bits.gnssFixOK)) {
        Config.updateLocation(fLat, fLon);
      }
      // forward a message to the websocket for the simple built in monitor
      char string[128];
      snprintf(string, sizeof(string), "%02d:%02d:%02d %s %s%s %s %.3f %.7f %.7f %.3f %d\r\n",
            ubxDataStruct->hour, ubxDataStruct->min,ubxDataStruct->sec, Gnss.curSrc, 
            fixLut[fixType & 7], ubxDataStruct->flags.bits.gnssFixOK ? "+OK": "", carrLut[carrSoln & 3], 1e-3*ubxDataStruct->hAcc, fLat, fLon, 1e-3 * ubxDataStruct->hMSL, ubxDataStruct->numSV);
      MSG msg(string, MSG::SRC::GNSS, MSG::HINT::TEXT);
      if (msg) {
        queueToCommTask.send(msg);
      }
      // keep a GGA sentence for the NTRIP client
      saveGGA(ubxDataStruct);
    }
  }

  /** Construct a coarse GGA string form the PVT and safe it for use by the NTRIP clients.
   *  \param ubxDataStruct the UBX-NAV-PVT payload
   */
  static void saveGGA(UBX_NAV_PVT_data_t *ubxDataStruct) {
    if ((ubxDataStruct->fixType != 0) && (ubxDataStruct->flags.bits.gnssFixOK)) {
      char string[128] = "";
      int iLat = ubxDataStruct->lat;
      char chLat = (iLat < 0) ? 'S' : 'N';
      if (iLat < 0) iLat = -iLat;
      int dLat = iLat / 10000000;
      double fLat = (iLat - dLat * 10000000) * 60.0e-7; 
      int iLon = ubxDataStruct->lon;
      char chLon = (iLon < 0) ? 'W' : 'E';
      if (iLon < 0) iLon = -iLon;
      int dLon = iLon / 10000000;
      double fLon = (iLon - dLon * 10000000) * 60.0e-7;
      // https://learn.sparkfun.com/tutorials/gps-rtk-hookup-guide/nmea-and-rtk
      // 1.0 minute = 1855m, 0.1min = 185.5mm, 0.01min = 18.55m, 0.001min = 1.855m, ...
      // we will limit the precision here and round for privacy reasons 
      #define LIMIT_PREC(mins, prec) (mins >= 60.0-prec) ? (60.0 - prec) : (round(mins / prec) * prec);
      fLat = LIMIT_PREC(fLat, 0.1);
      fLon = LIMIT_PREC(fLon, 0.1);
      //                        "$GPGGA,HHMMSS.ss,DDmm.mmm,N/S,DDmm.mmm,E/W,q,sat,dop,alt,M,und,M,age,dgps"
      int len = snprintf(string, sizeof(string), "$GPGGA,%02d%02d%02d.00,%02d%06.3f,%c,%03d%06.3f,%c,%c,%d,%.2f,%.1f,M,%.1f,M,,",
            ubxDataStruct->hour, ubxDataStruct->min,ubxDataStruct->sec, dLat, fLat, chLat, dLon, fLon, chLon, 
            ((ubxDataStruct->fixType != 0) && (ubxDataStruct->flags.bits.gnssFixOK)) ? '1' : '0', ubxDataStruct->numSV, 
            ubxDataStruct->pDOP * 1e-2, ubxDataStruct->hMSL * 1e-3, (ubxDataStruct->height - ubxDataStruct->hMSL) * 1e-3);
      char crc = 0;
      for (int i = 1; i < len; i ++) {
        crc ^= string[i];
      }
      len += sprintf(&string[len], "*%02X", crc);
      String gga = string;
      Config.setGga(gga);
    }
  } 
  
  bool online;            //!< flag that indicates if the receiver is connected
  int32_t ttagNextTry;    //!< time tag when to call the state machine again
  SFE_UBLOX_GNSS_ex rx;      //!< the receiver object
};

GNSS Gnss; //!< The global GNSS peripherial object
  
#endif // __GNSS_H__
