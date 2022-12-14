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

#include <SparkFun_u-blox_GNSS_Arduino_Library.h>

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

// helper macro for source handling (selection in the receiver)
#define GNSS_SPARTAN_USESOURCE(source)      ((source == LBAND) ?  1      : 0)           //!< convert from internal source to USE_SOUCRE value
#define GNSS_SPARTAN_USESOURCE_TXT(source)  ((source == LBAND) ? "1-PMP" : "0-SPARTAN") //!< convert from internal source to text 

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
    queue = xQueueCreate( 10, sizeof( MSG ) );
    online = false;
    ttagNextTry = millis();
    curSource = NONE;
    for (int i = 0; i < SOURCE::NUM; i ++) {
      ttagSource[i] = ttagNextTry;
    }
  }

  /** get, decode and dump the version
   *  \param tag  the receiver tag as this function is reused by LBAND
   *  \param pRx  handle to the receiver
   *  \return     the extracted firmware version string
   */
  static String version(const char* tag, SFE_UBLOX_GNSS* pRx) {
    String fwver; 
    struct { char sw[30]; char hw[10]; char ext[10][30]; } info;
    ubxPacket cfg = { UBX_CLASS_MON, UBX_MON_VER, 0, 0, 0, (uint8_t*)&info, 0, 0, SFE_UBLOX_PACKET_VALIDITY_NOT_DEFINED, SFE_UBLOX_PACKET_VALIDITY_NOT_DEFINED};
    pRx->setPacketCfgPayloadSize(sizeof(info)+8);
    if (pRx->sendCommand(&cfg, 300) == SFE_UBLOX_STATUS_DATA_RECEIVED) {
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
  
  /** detect and configure the receiver, inject saved keys
   *  \return  true if receiver is sucessfully detected, false if not
   */
  bool detect(void) {
    //rx.enableDebugging();
    rx.setOutputPort(Websocket);    // forward all messages
#ifdef __BLUETOOTH_H__
    rx.setNMEAOutputPort(Bluetooth); // forward NMEA messages
#endif
    bool ok = rx.begin(UbxWire, GNSS_I2C_ADR); //Connect to the Ublox module using Wire port
    if (ok) {
      log_i("receiver detected");

      String fwver = version("GNSS", &rx);
      if ((fwver.substring(4).toDouble() <= 1.30) && !fwver.substring(4).equals("1.30")) { 
        // ZED-F9R/P old release firmware, no Spartan 2.0 support
        log_e("firmware \"%s\" is old, please update firmware to release \"HPS 1.30\"", fwver.c_str());
      } 
      GNSS_CHECK_INIT;
      GNSS_CHECK(1) = rx.setAutoPVTcallbackPtr(onPVT);
      GNSS_CHECK(2) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_NAV_PVT_I2C,        1, VAL_LAYER_RAM); // required for this app and the monitor web page
      // add some usefull messages to store in the logfile
      GNSS_CHECK(3) = rx.setVal(UBLOX_CFG_NMEA_HIGHPREC,                 1, VAL_LAYER_RAM); // make sure we enable extended accuracy in NMEA protocol
      GNSS_CHECK(4) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_NAV_SAT_I2C,        1, VAL_LAYER_RAM); 
      GNSS_CHECK(5) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_NAV_HPPOSLLH_I2C,   1, VAL_LAYER_RAM);
      GNSS_CHECK(6) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_RXM_COR_I2C,        1, VAL_LAYER_RAM);
      if ((fwver.substring(4).toDouble() > 1.30) || fwver.substring(4).equals("1.30")) {
        GNSS_CHECK(7) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_NAV_PL_I2C,       1, VAL_LAYER_RAM);
      }
      if (fwver.startsWith("HPS ")) {
        GNSS_CHECK(8) = rx.setVal(UBLOX_CFG_MSGOUT_UBX_ESF_STATUS_I2C,   1, VAL_LAYER_RAM);
        if (GNSS_DYNAMIC_MODEL != DYN_MODEL_UNKNOWN) {
          GNSS_CHECK(9) = rx.setVal(UBLOX_CFG_NAVSPG_DYNMODEL, GNSS_DYNAMIC_MODEL, VAL_LAYER_RAM);
          if (GNSS_DYNAMIC_MODEL == DYN_MODEL_PORTABLE) {
            log_i("dynModel PORTABLE, disable DR/SF modes");
            // disable sensor fusion mode in case we use a portable dynamic model
            GNSS_CHECK(10) = rx.setVal(UBLOX_CFG_SFCORE_USE_SF,           0, VAL_LAYER_RAM);
          } else if (GNSS_DYNAMIC_MODEL == DYN_MODEL_MOWER) {
            log_i("dynModel MOWER");
            GNSS_CHECK(11) = rx.setVal32(UBLOX_CFG_SFODO_FACTOR, GNSS_ODO_FACTOR, VAL_LAYER_RAM);
            GNSS_CHECK(12) = rx.setVal(UBLOX_CFG_SFODO_COMBINE_TICKS,     1, VAL_LAYER_RAM);
            GNSS_CHECK(13) = rx.setVal(UBLOX_CFG_SFODO_DIS_AUTODIRPINPOL, 1, VAL_LAYER_RAM);
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
            GNSS_CHECK(14) = rx.setVal(UBLOX_CFG_SFODO_DIS_AUTOSW,        0, VAL_LAYER_RAM); // enable it
          } else {
            log_i("dynModel %d", GNSS_DYNAMIC_MODEL);
          }
        } 
      }
      online = ok = GNSS_CHECK_OK;
      GNSS_CHECK_EVAL("configuration");
      if (ok) {
        log_i("configuration complete, receiver online");
        uint8_t key[64];
        int keySize = Config.getValue(CONFIG_VALUE_KEY, key, sizeof(key));
        if (keySize > 0) {
          log_i("inject saved keys");
          inject(key, keySize, KEYS);
        }
      }
    }
    return ok;
  }

  typedef enum                          {  WLAN = 0, LTE,   LBAND,   KEYS,   WEBSOCKET,   BLUETOOTH,   NONE, NUM } SOURCE; //!< source enum for MSG 
  const char* SOURCE_LUT[SOURCE::NUM] = { "WLAN",   "LTE", "LBAND", "KEYS", "WEBSOCKET", "BLUETOOTH", "-"        };  //!< source to text conversion
  typedef struct { 
    SOURCE source;      //!< source of data 
    uint8_t* data;      //!< data buffer, allocated by calling task and released  by consumers  
    size_t size;        //!< data size
  } MSG;                //!< queue element
  xQueueHandle queue;   //!< queue to hold the different data to be sent to the receiver

  /** inject a message into the queue to be sent to the receiver, 
   *  \param msg  message to be added, this msg.data is freed by  
   *  return      number of bytes sucessfully written to the queue, will be sent later
   */
  size_t inject(MSG& msg) {
    if (xQueueSendToBack(queue, &msg, 0/*portMAX_DELAY*/) == pdPASS) {
      return msg.size;
    }
    delete [] msg.data;
    msg.data = NULL;
    log_e("%d bytes from %s source failed, queue full", msg.size, SOURCE_LUT[msg.source]);
    return 0;
  }
  
  /** inject a message into the queue to be sent to the receiver, 
   *  \param ptr   pointer to data that will be copied and sent  
   *  \param size  number of bytes in data that will be copied and sent  
   *  \param src   the source of data
   *  return       number of bytes sucessfully written to the queue, will be sent later
   */
  size_t inject(const uint8_t* ptr, size_t len, SOURCE src) {
    MSG msg;
    msg.data = new uint8_t[len];
    if (NULL != msg.data) {
      memcpy(msg.data, ptr, len);
      msg.size = len;
      msg.source = src;
      return inject(msg);
    }
    log_e("%d bytes from %s source failed, no memory", msg.size, SOURCE_LUT[msg.source]);
    return 0;
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
      // send the queue 
      int len = 0;
      MSG msg;
      while (xQueueReceive(queue, &msg, 0/*portMAX_DELAY*/) == pdPASS) {
        if (online) {
          checkSpartanUseSourceCfg(msg.source);
          online = rx.pushRawData(msg.data, msg.size);
          if (online) {
            len += msg.size;
            log_d("%d bytes from %s source", msg.size, SOURCE_LUT[msg.source]);
          } else {
            log_e("%d bytes from %s source failed", msg.size, SOURCE_LUT[msg.source]);
          }
        }
        // Forward also messages from the IP services (LTE and WIFI) to the GUI though the WEBSOCKET
        // LBAND and GNSS are already sent directly, and we dont want KEYS and WEBSOCKET injections to loop back to the GUI
        if ((msg.source == WLAN) || (msg.source == LTE)) {
          Websocket.write(msg.data, msg.size, (msg.source == LTE)  ? WEBSOCKET::SOURCE::LTE : WEBSOCKET::SOURCE::WLAN);
        }
        delete [] msg.data;
        msg.data = NULL;
      }
    }
  }

protected:

  SOURCE curSource;                   //!< current source in use of correction data
  uint32_t ttagSource[SOURCE::NUM];   //!< the time (millis()) of last correction data reception for each source
  
  /** Check the current source of data and make sure the receiver is configured correctly so that it can process the protocol / data.
   *  \param source  the source of which it got correction data. 
   *  \return        true if this is the souce is the chosen source. 
   */
  bool checkSpartanUseSourceCfg(SOURCE source) {
    if ((source == WLAN) || (source == LTE) || (source == LBAND)) {
      // manage correction stream selection 
      int32_t now = millis();
      ttagSource[source] = millis() + GNSS_CORRECTION_TIMEOUT;
      if (source != curSource) { // source would change
        if (  (curSource == NONE) || // just use any source, if we never set it. 
             ((curSource == LBAND) && (source != LBAND)) || // prefer any IP source over LBAND
             ((curSource != LBAND) && (0 >= (ttagSource[curSource] - now)) ) ) { // let IP source timeout before switching to any other source 
          // we are not switching to an error here, sometimes this command is not acknowledged, so we will just retry next time. 
          bool ok/*online*/ = rx.setVal8(UBLOX_CFG_SPARTN_USE_SOURCE, GNSS_SPARTAN_USESOURCE(source), VAL_LAYER_RAM);
          if (ok) {
            log_i("useSource %s from source %s", GNSS_SPARTAN_USESOURCE_TXT(source), SOURCE_LUT[source]);
            curSource = source;
          } else {
            // WORKAROUND: for some reson the spartanUseSource command fails, reason is unknow, we dont realy worry here and will do it just again next time 
            log_w("useSource  %s from source %s failed", GNSS_SPARTAN_USESOURCE_TXT(source), SOURCE_LUT[source]);
          }
        }
      }
    }
    return curSource == source;
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
      log_i("%d.%d.%d %02d:%02d:%02d lat %.7f lon %.7f msl %.3f fix %d(%s) carr %d(%s) hacc %.3f source %s", 
            ubxDataStruct->day, ubxDataStruct->month, ubxDataStruct->year, ubxDataStruct->hour, ubxDataStruct->min,ubxDataStruct->sec, 
            fLat, fLon, 1e-3 * ubxDataStruct->hMSL, fixType, fixLut[fixType & 7], carrSoln, carrLut[carrSoln & 3], 
            1e-3*ubxDataStruct->hAcc, Gnss.SOURCE_LUT[Gnss.curSource]);
            
      // update the pointperfect topic and lband frequency depending on region we are in
      if ((fixType != 0) && (ubxDataStruct->flags.bits.gnssFixOK)) {
        Config.updateLocation(fLat, fLon);
      }
      // forward a message to the websocket for the simple built in monitor
      char string[128];
      snprintf(string, sizeof(string), "%02d:%02d:%02d %s %s %s %.3f %.7f %.7f %.3f\r\n",
            ubxDataStruct->hour, ubxDataStruct->min,ubxDataStruct->sec, Gnss.SOURCE_LUT[Gnss.curSource], 
            fixLut[fixType & 7], carrLut[carrSoln & 3], 1e-3*ubxDataStruct->hAcc, fLat, fLon, 1e-3 * ubxDataStruct->hMSL);
      Websocket.write(string, WEBSOCKET::SOURCE::GNSS);
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
      Config.setValue(CONFIG_VALUE_NTRIP_GGA, string);
    }
  } 
  
  bool online;            //!< flag that indicates if the receiver is connected
  int32_t ttagNextTry;    //!< time tag when to call the state machine again
  SFE_UBLOX_GNSS rx;      //!< the receiver object
};

GNSS Gnss; //!< The global GNSS peripherial object

/** Static function that can be easily called from the WEBSOCKET modules avoiding include dependencies
 *  \param ptr  data to inject
 *  \param len  size of data
 *  \return     the sucessfully injected size of data
*/
#define GNSS_INJECT(source) \
      size_t GNSS_INJECT_##source (const void* ptr, size_t len) { \
        return Gnss.inject((const uint8_t*)ptr, len, GNSS::SOURCE::source); \
      }

GNSS_INJECT(WEBSOCKET)  //!< easy inject function for WEBSOCKET source
GNSS_INJECT(BLUETOOTH)  //!< easy inject function for BLUETOOTH source
  
#endif // __GNSS_H__
