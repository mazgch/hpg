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
 
#ifndef __LTE_H__
#define __LTE_H__

#include <base64.h>

#include "HW.h"
#include "LOG.h"
#include "CONFIG.h"
#include "GNSS.h"
#include "UBXFILE.h"
  
extern class LTE Lte;

const int LTE_DETECT_RETRY        =  5000;
const int LTE_WAITREGISTER_RETRY  =  1000;
const int LTE_CHECKSIM_RETRY      = 60000;
const int LTE_ACTIVATION_RETRY    = 10000;
const int LTE_PROVISION_RETRY     = 60000;
const int LTE_CONNECT_RETRY       = 10000;
const int LTE_1S_RETRY            =  1000;

const int LTE_MQTTCMD_DELAY       =   100; // the client is not happy if multiple commands are sent too fast
const int LTE_BAUDRATE            = 115200; // baudrates 230400, 460800 or 921600 cause issues even when CTS/RTS is enabled

const int LTE_POWER_ON_PULSE        =  2000;
const int LTE_POWER_ON_WAITTIME     =  4000;
const int LTE_POWER_ON_WAITTIME_MAX = 10000;
const int LTE_POWER_ON_WAITSIMREADY =  4000;

const int LTE_PSD_PROFILE         = 0;
const int LTE_HTTP_PROFILE        = 0;
const int LTE_SEC_PROFILE_HTTP    = 1;
const int LTE_SEC_PROFILE_MQTT    = 0;
const char* FILE_REQUEST          = "req.json";
const char* FILE_RESP             = "resp.json";
const char* SEC_ROOT_CA           = "aws-rootCA";
const char* SEC_CLIENT_CERT       = "pp-cert";
const char* SEC_CLIENT_KEY        = "pp-key";
const uint16_t HTTPS_PORT         = 443;

const int LTE_STACK_SIZE          = 5*1024;      //!< Stack size of LTE task
const int LTE_TASK_PRIO           = 1;
const int LTE_TASK_CORE           = 1;

#define LTE_CHECK_INIT            int _step = 0; SARA_R5_error_t _err = SARA_R5_SUCCESS
#define LTE_CHECK_OK              (SARA_R5_SUCCESS == _err)
#define LTE_CHECK                 if (SARA_R5_SUCCESS == _err) _step ++, _err 
#define LTE_CHECK_EVAL(txt)       if (SARA_R5_SUCCESS != _err) Log.error(txt ", AT sequence failed at step %d with error %d", _step, _err)

#define LUT(l, x)                 ((((unsigned int)x) <= (sizeof(l)/sizeof(*l))) ? l[x] : "unknown")

class LTE : public SARA_R5 {
private:
  void beginSerial(unsigned long baud) override
  {
    delay(100);
    UbxSerial.end();
    delay(10);
    Log.debug("LTE baudrate %d pins RXo %d TXi %d CTSo %d RTSi %d", baud, LTE_RXO, LTE_TXI, LTE_CTS, LTE_RTS);
    UbxSerial.begin(baud, SERIAL_8N1, LTE_RXO, LTE_TXI);
    if ((PIN_INVALID != LTE_RTS) && (PIN_INVALID != LTE_CTS)) {
      UbxSerial.setPins(LTE_RXO, LTE_TXI, LTE_CTS, LTE_RTS); 
      UbxSerial.setHwFlowCtrlMode(HW_FLOWCTRL_CTS_RTS, 64);
    }
    delay(100);
  }

public:
  LTE() : SARA_R5{ -1/*LTE_PWR_ON*/, -1/*LTE_RESET*/, 3/*retries*/ } { 
    // The current SARA-R5 library is setting the LTE_RESET and LTE_PWR_ON pins to input after using them, 
    // This is not ideal for the v0.8/v0.9 hardware. Therefore it is prefered to control the LTE_RESET 
    // and LTE_PWR_ON externally in our code here. We also like to have better control of the pins to 
    // support different variants of LTE modems.
         
    // Module     Power On time   Power Off time   Reset
    // SARA-R5    0.1/1-2s        23s + 1.5sReset  0.1s
    // LARA-R6    0.15-3.2s       >1.5s            0.05-6s (10s emergency)
    // LENA-R8    >2s             >3.1s            0.05s
    
    // The LTE_RESET pin is active LOW, HIGH = idle, LOW = in reset
    // The LTE_RESET pin unfortunately does not have a pull up resistor on the v0.8/v0.9 hardware
    if (PIN_INVALID != LTE_RESET) {
      digitalWrite(LTE_RESET, HIGH);
      pinMode(LTE_RESET, OUTPUT);
      digitalWrite(LTE_RESET, HIGH);
    }
    // The LTE_PWR_ON pin is active HIGH, LOW = idle, HIGH timings see table above
    // The LTE_PWR_ON pin has a external pull low resistor on the board. 
    if (PIN_INVALID != LTE_PWR_ON) {
      digitalWrite(LTE_PWR_ON, LOW);
      pinMode(LTE_PWR_ON, OUTPUT);
      digitalWrite(LTE_PWR_ON, LOW);
    }
    if (PIN_INVALID != LTE_TXI) {
      digitalWrite(LTE_TXI, HIGH);
      pinMode(LTE_TXI, OUTPUT);
      digitalWrite(LTE_TXI, HIGH);
    }
    if (PIN_INVALID != LTE_RTS) {
      digitalWrite(LTE_RTS, LOW);
      pinMode(LTE_RTS, OUTPUT);
      digitalWrite(LTE_RTS, LOW);
    }
    if (PIN_INVALID != LTE_DTR) {
      digitalWrite(LTE_DTR, LOW);
      pinMode(LTE_DTR, OUTPUT);
      digitalWrite(LTE_DTR, LOW);
    } 
    // init all other pins here
    if (PIN_INVALID != LTE_ON)  pinMode(LTE_ON,  INPUT);
    if (PIN_INVALID != LTE_RXO) pinMode(LTE_RXO, INPUT);
    if (PIN_INVALID != LTE_CTS) pinMode(LTE_CTS, INPUT);
    if (PIN_INVALID != LTE_DSR) pinMode(LTE_DSR, INPUT);
    if (PIN_INVALID != LTE_DCD) pinMode(LTE_DCD, INPUT); 
    if (PIN_INVALID != LTE_RI)  pinMode(LTE_RI,  INPUT);
    if (PIN_INVALID != LTE_INT) pinMode(LTE_INT, INPUT);
    state = INIT;
    ntripSocket = -1;
  }

  void init(void) {
      xTaskCreatePinnedToCore(task, "Lte", LTE_STACK_SIZE, this, LTE_TASK_PRIO, NULL, LTE_TASK_CORE);
  }

  bool detect(void) {
    // turn on the module 
    #define DETECT_DELAY 100
    int pwrOnTime = -1; // will never trigger
    if (PIN_INVALID != LTE_PWR_ON) {
      if ((PIN_INVALID != LTE_ON) ? LOW != digitalRead(LTE_ON) : true) {
        Log.info("LTE power on");
        digitalWrite(LTE_PWR_ON, HIGH);
        pwrOnTime = LTE_POWER_ON_PULSE / DETECT_DELAY;
      }
    }
    
    bool ready = true;
    char lastCts = -1;
    char lastOn = -1;
    char lastRxo = -1;
    for (int i = 0; i < LTE_POWER_ON_WAITTIME_MAX / DETECT_DELAY; i ++) { 
      ready = (pwrOnTime < 0);
      if (i == pwrOnTime) {
        digitalWrite(LTE_PWR_ON, LOW);
        Log.debug("LTE pin PWR_ON LOW(idle)"); 
        pwrOnTime = -1; // no more
        i = 0; // restart timer
      }
      if (PIN_INVALID != LTE_RXO) {
        char rxo = digitalRead(LTE_RXO);
        if (lastRxo != rxo) {
          Log.debug((rxo == LOW) ? "LTE pin RXO LOW(active)" : "LTE pin RXO HIGH(idle)"); 
          lastRxo = rxo;
        }
        ready = ready && (rxo == HIGH);
      }
      if (PIN_INVALID != LTE_ON) {
        char on = digitalRead(LTE_ON);
        if (on != lastOn) {
          Log.debug((on == LOW) ? "LTE pin ON LOW(on)" : "LTE pin ON HIGH(off)"); 
          lastOn = on;
        }
        ready = ready && (on == LOW);
      }
      if (PIN_INVALID != LTE_CTS) {
        char cts = digitalRead(LTE_CTS);
        if (lastCts != cts) {
          Log.debug((cts == LOW) ? "LTE pin CTS LOW(idle)" : "LTE pin CTS HIGH(wait)"); 
          lastCts = cts;
        }
        ready = ready && (cts == LOW);
      }
      if (ready && (i > LTE_POWER_ON_WAITTIME / DETECT_DELAY)) {
        break;
      }  
      delay(DETECT_DELAY);
    }
    Log.info(ready ? "LTE ready" : "LTE not ready RXO PWRON CTS : %d %d %d != 1 0 0", lastRxo, lastOn, lastCts); 
    
    bool ok = false;
    if (ready) {
      #define PIN_TXT(pin) (PIN_INVALID == pin) ? "" : digitalRead(pin) == LOW ? " LOW" : " HIGH"
      Log.debug("LTE baudrate %d pins RXo %d%s TXi %d%s CTSo %d%s RTSi %d%s", LTE_BAUDRATE, 
        LTE_RXO, PIN_TXT(LTE_RXO), LTE_TXI, PIN_TXT(LTE_TXI),
        LTE_CTS, PIN_TXT(LTE_CTS), LTE_RTS, PIN_TXT(LTE_RTS));
      ok = begin(UbxSerial, LTE_BAUDRATE);
      if (ok) {
        module = getModelID();
        String version = getFirmwareVersion();
        Log.info("LTE config manufacturer \"%s\" model=\"%s\" version=\"%s\"", 
            getManufacturerID().c_str(), module.c_str(), version.c_str());
        if ((version.toDouble() < 0.13) && module.startsWith("LARA-R6")) {
          Log.error("LTE LARA-R6 firmware %s has MQTT limitations, please update firmware", version.c_str());
        }
        else if ((version.toDouble() < 2.00) && module.startsWith("LENA-R8")) {
          Log.error("LTE LENA-R8 firmware %s has limitations, please update firmware", version.c_str());
        }
#if ((HW_TARGET == MAZGCH_HPG_SOLUTION_C214_revA) || (HW_TARGET == MAZGCH_HPG_SOLUTION_V09))
        // enableSIMDetectAndHotswap();
#endif
  
        // wait for the SIM to get ready ... this can take a while (<4s)
        SARA_R5_error_t err = SARA_R5_ERROR_ERROR;
        for (int i = 0; i < LTE_POWER_ON_WAITSIMREADY/100; i ++) {
          err = getSimStatus(NULL);
          if (SARA_R5_ERROR_ERROR != err)
            break;
          delay(100);
        }
        if (SARA_R5_ERROR_ERROR == err) {
          Log.error("LTE SIM card not found, err %d", err);
        }
        setState(CHECKSIM);  
      }
    }    
    return ok;
  }
  
  void poll(void) {
    HW_DBG_HI(HW_DBG_LTE);
    
    if ((PIN_INVALID != LTE_ON) && (state != INIT)) {
      // detect if LTE was turned off
      if (HIGH == digitalRead(LTE_ON)) {
        UbxSerial.end();
        setState(INIT, LTE_DETECT_RETRY);
      }
    }
      
    if (state != INIT) {
      SARA_R5::poll();
    }
    
    long now = millis();
    if (ttagNextTry <= now) {
      String id = Config.getValue(CONFIG_VALUE_CLIENTID);
      String ntrip = Config.getValue(CONFIG_VALUE_NTRIP_SERVER);
      String useSrc = Config.getValue(CONFIG_VALUE_USESOURCE);
      bool onlineWlan = WiFi.status() == WL_CONNECTED;
      bool useWlan   = (-1 != useSrc.indexOf("WLAN")) && onlineWlan;
      bool useLte    = (-1 != useSrc.indexOf("LTE"))  && !useWlan;
      bool useNtrip = useLte && useSrc.startsWith("NTRIP:");
      bool useMqtt  = useLte && !useNtrip;
      switch (state) {
        case INIT:
          {
            ttagNextTry = now + LTE_DETECT_RETRY;
            detect();
          } 
          break;    
        case CHECKSIM:
          {
            ttagNextTry = now + LTE_CHECKSIM_RETRY;
            String code;
/* step */  LTE_CHECK_INIT;
/*  1   */  LTE_CHECK = getSimStatus(&code); 
            if (LTE_CHECK_OK && code.equals("SIM PIN")) {
              String pin = Config.getValue(CONFIG_VALUE_SIMPIN);
              if (pin.length()) {
/*  2   */      LTE_CHECK = setSimPin(pin);
/*  3   */      LTE_CHECK = getSimStatus(&code); // retry get the SIM status
                LTE_CHECK_EVAL("LTE SIM card initialisation");
              }
            }
            if (LTE_CHECK_OK) {
              if (code.equals("READY")) {
                Log.info("LTE SIM card status \"%s\" CCID=\"%s\"", code.c_str(), getCCID().c_str());
                String subNo = getSubscriberNo();
                int from = subNo.indexOf(",\"");
                int to = (-1 != from) ? subNo.indexOf("\"", from + 2) : -1;
                subNo = ((-1 != from) && (-1 != to)) ? subNo.substring(from + 2, to) : "";
                Log.info("LTE IMEI=\"%s\" IMSI=\"%s\" subscriber=\"%s\"", getIMEI().c_str(), getIMSI().c_str(), subNo.c_str());
                setState(SIMREADY);
              }
              else {
                Log.error("LTE SIM card status \"%s\"", code.c_str());
              }
            }   
          }
          break;
        case SIMREADY:
          {
            if (!module.startsWith("LENA-R8")) {
              String mno = Config.getValue(CONFIG_VALUE_MNOPROF);
              if (mno.length()) {
                mobile_network_operator_t eMno = (mobile_network_operator_t)mno.toInt();
                if (!setNetworkProfile(eMno)) {
                  Log.error("LTE detect setting network profile for MNO %d failed", eMno);
                }
              }
            }

/* step */  LTE_CHECK_INIT;
/*  1   */  LTE_CHECK = setEpsRegistrationCallback(epsRegCallback);
/*  2   */  LTE_CHECK = setRegistrationCallback(regCallback);
            String apn = Config.getValue(CONFIG_VALUE_LTEAPN);
            if (apn.length()) {
/*  3   */    LTE_CHECK = setAPN(apn);
            }
            LTE_CHECK_EVAL("LTE callback and apn config");
            
            setState(WAITREGISTER);
          }
          break;
        case WAITREGISTER:
          {
            ttagNextTry = millis() + LTE_WAITREGISTER_RETRY;
            SARA_R5_registration_status_t status = registration(true); // EPS
            if ((status == SARA_R5_REGISTRATION_HOME) || (status == SARA_R5_REGISTRATION_ROAMING)) {
              String op = "";
              getOperator(&op);
              Log.info("LTE EPS registered %d(%s) operator \"%s\" rssi %d clock \"%s\"", 
                      status, LUT(REG_STATUS_LUT, status), op.c_str(), rssi(), clock().c_str());
              setState(REGISTERED);
              // AT+UPSV?
              // AT+CLCK="SC",2
            }
            else {
              Log.debug("LTE EPS registration status %d(%s), waiting ...", status, LUT(REG_STATUS_LUT, status));
            }
          }
          break;
        case REGISTERED:
          if (module.startsWith("LARA-R6")) {
            setState(ONLINE);
          } else if (module.startsWith("LENA-R8")) {
            String apn;
            IPAddress ip(0, 0, 0, 0);
            SARA_R5_pdp_type pdpType = PDP_TYPE_INVALID;
 /* step */ LTE_CHECK_INIT;
 /*  1   */ LTE_CHECK = getAPN(0, &apn, &ip, &pdpType);
            // on LENA-R8 we need to move a IP context 0 to a different context id other than 0
            // ok if these commands fail as the context could be already active ... 
            if (LTE_CHECK_OK && (0 < apn.length()) && (pdpType != PDP_TYPE_NONIP)) {
 /*  2   */   /*LTE_CHECK = */setAPN(apn, 1 /* LENA only has contexts 0 to 7, do not use SARA_R5_NUM_PDP_CONTEXT_IDENTIFIERS-1 */ , pdpType);
            }
 /*  3   */ /*LTE_CHECK =*/ activatePDPcontext(true);           
            LTE_CHECK_EVAL("LTE activate context");
            if (LTE_CHECK_OK) {
              setState(ONLINE);
            }
          } else /* SARA-R5 */ {
            ttagNextTry = now + LTE_ACTIVATION_RETRY;
            performPDPaction(LTE_PSD_PROFILE, SARA_R5_PSD_ACTION_DEACTIVATE);
            for (int cid = 0; cid < SARA_R5_NUM_PDP_CONTEXT_IDENTIFIERS; cid++)
            {
              String apn;
              IPAddress ip(0, 0, 0, 0);
              SARA_R5_pdp_type pdpType = PDP_TYPE_INVALID;
  /* step */  LTE_CHECK_INIT;
  /*  1   */  LTE_CHECK = getAPN(cid, &apn, &ip, &pdpType);
              if ((LTE_CHECK_OK) && (0 < apn.length()) && (PDP_TYPE_INVALID != pdpType))
              {
                // Activate the profile
                Log.info("LTE activate profile for apn \"%s\" with IP %s pdp %d", apn.c_str(), ip.toString().c_str(), pdpType);                
                setPSDActionCallback(psdCallback);
  /*  2   */    LTE_CHECK = setPDPconfiguration(LTE_PSD_PROFILE, SARA_R5_PSD_CONFIG_PARAM_PROTOCOL, pdpType);
  /*  3   */    LTE_CHECK = setPDPconfiguration(LTE_PSD_PROFILE, SARA_R5_PSD_CONFIG_PARAM_MAP_TO_CID, cid);
  /*  4   */    LTE_CHECK = performPDPaction(LTE_PSD_PROFILE, SARA_R5_PSD_ACTION_ACTIVATE);
                LTE_CHECK_EVAL("LTE profile activation");
                if (LTE_CHECK_OK) {
                  break; // abort the loop as we found a good profile
                }
              }
            }
          }
          break;
        case ONLINE:
          ttagNextTry = now + LTE_1S_RETRY;
          if (useNtrip) {
            if (0 < ntrip.length()) {
              ttagNextTry = now + LTE_CONNECT_RETRY;
              int pos = ntrip.indexOf(':');
              String server = (-1 == pos) ? ntrip : ntrip.substring(0,pos);
              uint16_t port = (-1 == pos) ? NTRIP_SERVER_PORT : ntrip.substring(pos+1).toInt();
              String mntpnt = Config.getValue(CONFIG_VALUE_NTRIP_MOUNTPT);
              String user = Config.getValue(CONFIG_VALUE_NTRIP_USERNAME);
              String pwd = Config.getValue(CONFIG_VALUE_NTRIP_PASSWORD);
              //setSocketReadCallbackPlus(&processSocketData);
              //setSocketCloseCallback(&processSocketClose);
              ntripSocket = socketOpen(SARA_R5_TCP);
              if (ntripSocket >= 0) {
                String authEnc;
                String authHead;
                if (0 < user.length() && 0 < pwd.length()) {
                  authEnc = base64::encode(user + ":" + pwd);
                  authHead = "Authorization: Basic ";
                  authHead += authEnc + "\r\n";
                }                    
                const char* expectedReply = 0 == mntpnt.length() ? "SOURCETABLE 200 OK\r\n" : "ICY 200 OK\r\n";
                Log.info("LTE NTRIP connect to \"%s:%d\" and GET \"/%s\" auth \"%s\"", server.c_str(), port, mntpnt.c_str(), authEnc.c_str());
                char buf[256];
                int len = sprintf(buf, "GET /%s HTTP/1.0\r\n"
                          "User-Agent: " CONFIG_DEVICE_TITLE "\r\n"
                          "%s\r\n", mntpnt.c_str(), authHead.c_str());
    /* step */  LTE_CHECK_INIT;
    /*  1   */  LTE_CHECK = socketConnect(ntripSocket, server.c_str(), port);
    /*  2   */  LTE_CHECK = socketWrite(ntripSocket, buf, len);
                int avail = 0;
                len = strlen(expectedReply);
                unsigned long start = millis();
                while (((millis() - start) < NTRIP_CONNECT_TIMEOUT) && (avail < len) && LTE_CHECK_OK) {
    /*  3   */    LTE_CHECK = socketReadAvailable(ntripSocket, &avail);
                  delay(0);
                }
                if (avail >= len) avail = len;
                memset(&buf, 0, len+1);
    /*  4   */  LTE_CHECK = socketRead(ntripSocket, avail, buf, &avail);
                LTE_CHECK_EVAL("LTE NTRIP connect");
                if (LTE_CHECK_OK) {
                  buf[avail] = 0;
                  if ((avail == len) && (0 == strncmp(buf, expectedReply, len))) {
                    Log.info("LTE NTRIP got expected reply \"%.*s\\r\\n\"", len-2, expectedReply);
                    ntripGgaMs = now;
                    setState(NTRIP);
                  } else {
                    Log.error("LTE NTRIP expected reply \"%.*s\\r\\n\" failed after %d ms, got \"%s\"", len-2, expectedReply, millis() - start, buf);
                  }
                }
                // no need to keep the socket open if we are not in NTRIP state
                if ((state != NTRIP) && (ntripSocket >= 0)) {
                  Log.info("LTE NTRIP disconnect");
                  socketClose(ntripSocket);
                  ntripSocket = -1;
                }
              }
            } 
          } else if (useMqtt) {
            String rootCa = Config.getValue(CONFIG_VALUE_ROOTCA);
            if (0 == id.length()) {
              if (0 == rootCa.length()) {
                ttagNextTry = now + LTE_PROVISION_RETRY;
                Log.info("LTE HTTP AWS connect to \"%s:%d\" and GET \"%s\"", AWSTRUST_SERVER, HTTPS_PORT, AWSTRUST_ROOTCAPATH);
                setHTTPCommandCallback(httpCallback); // callback will advance state
    /* step */  LTE_CHECK_INIT;
    /*  1   */  LTE_CHECK = LTE_IGNORE_LENA(resetSecurityProfile(LTE_SEC_PROFILE_HTTP));
    /*  2   */  LTE_CHECK = configSecurityProfile(LTE_SEC_PROFILE_HTTP, SARA_R5_SEC_PROFILE_PARAM_CERT_VAL_LEVEL, SARA_R5_SEC_PROFILE_CERTVAL_OPCODE_NO); // no certificate and url/sni check
    /*  3   */  LTE_CHECK = configSecurityProfile(LTE_SEC_PROFILE_HTTP, SARA_R5_SEC_PROFILE_PARAM_TLS_VER,        SARA_R5_SEC_PROFILE_TLS_OPCODE_VER1_2);
    /*  4   */  LTE_CHECK = configSecurityProfile(LTE_SEC_PROFILE_HTTP, SARA_R5_SEC_PROFILE_PARAM_CYPHER_SUITE,   SARA_R5_SEC_PROFILE_SUITE_OPCODE_PROPOSEDDEFAULT);
    /*  5   */  LTE_CHECK = configSecurityProfileString(LTE_SEC_PROFILE_HTTP, SARA_R5_SEC_PROFILE_PARAM_SNI,      AWSTRUST_SERVER);
    /*  6   */  LTE_CHECK = resetHTTPprofile(LTE_HTTP_PROFILE);
    /*  7   */  LTE_CHECK = setHTTPserverName(LTE_HTTP_PROFILE, AWSTRUST_SERVER);
    /*  8   */  LTE_CHECK = setHTTPserverPort(LTE_HTTP_PROFILE, HTTPS_PORT);
    /*  9   */  LTE_CHECK = setHTTPauthentication(LTE_HTTP_PROFILE, false);
    /* 10   */  LTE_CHECK = setHTTPsecure(LTE_HTTP_PROFILE, true, LTE_SEC_PROFILE_HTTP);
    /* 11   */  LTE_CHECK = sendHTTPGET(LTE_HTTP_PROFILE, AWSTRUST_ROOTCAPATH, FILE_RESP);
                LTE_CHECK_EVAL("LTE HTTP AWS request");
              } else {
                String ztpReq = Config.ztpRequest(); 
                if (0 < ztpReq.length()) {
                  ttagNextTry = now + LTE_PROVISION_RETRY;
                  Log.info("LTE HTTP ZTP connect to \"%s\" and POST \"%s\"", THINGSTREAM_ZTPURL, ztpReq.c_str());
                  setHTTPCommandCallback(httpCallback); // callback will advance state
      /* step */  LTE_CHECK_INIT;
      /*  1   */  LTE_CHECK = setSecurityManager(SARA_R5_SEC_MANAGER_OPCODE_IMPORT, SARA_R5_SEC_MANAGER_ROOTCA,     SEC_ROOT_CA, rootCa);
      /*  2   */  LTE_CHECK = LTE_IGNORE_LENA(resetSecurityProfile(LTE_SEC_PROFILE_HTTP));
      /*  3   */  LTE_CHECK = configSecurityProfile(LTE_SEC_PROFILE_HTTP, SARA_R5_SEC_PROFILE_PARAM_CERT_VAL_LEVEL, SARA_R5_SEC_PROFILE_CERTVAL_OPCODE_YESNOURL);
      /*  4   */  LTE_CHECK = configSecurityProfile(LTE_SEC_PROFILE_HTTP, SARA_R5_SEC_PROFILE_PARAM_TLS_VER,        SARA_R5_SEC_PROFILE_TLS_OPCODE_VER1_2);
      /*  5   */  LTE_CHECK = configSecurityProfile(LTE_SEC_PROFILE_HTTP, SARA_R5_SEC_PROFILE_PARAM_CYPHER_SUITE,   SARA_R5_SEC_PROFILE_SUITE_OPCODE_PROPOSEDDEFAULT);
      /*  6   */  LTE_CHECK = configSecurityProfileString(LTE_SEC_PROFILE_HTTP, SARA_R5_SEC_PROFILE_PARAM_ROOT_CA,  SEC_ROOT_CA);
      /*  7   */  LTE_CHECK = configSecurityProfileString(LTE_SEC_PROFILE_HTTP, SARA_R5_SEC_PROFILE_PARAM_SNI,      THINGSTREAM_SERVER);
                  deleteFile(FILE_REQUEST); // okay if this fails
      /*  8   */  LTE_CHECK = appendFileContents(FILE_REQUEST, ztpReq);
      /*  9   */  LTE_CHECK = resetHTTPprofile(LTE_HTTP_PROFILE);
      /* 10   */  LTE_CHECK = setHTTPserverName(LTE_HTTP_PROFILE, THINGSTREAM_SERVER);
      /* 11   */  LTE_CHECK = setHTTPserverPort(LTE_HTTP_PROFILE, HTTPS_PORT); // make sure port is set
      /* 12   */  LTE_CHECK = setHTTPauthentication(LTE_HTTP_PROFILE, false);
      /* 13   */  LTE_CHECK = setHTTPsecure(LTE_HTTP_PROFILE, true, LTE_SEC_PROFILE_HTTP);
      /* 14   */  LTE_CHECK = sendHTTPPOSTfile(LTE_HTTP_PROFILE, THINGSTREAM_ZTPPATH, FILE_RESP, FILE_REQUEST, SARA_R5_HTTP_CONTENT_APPLICATION_JSON);
                  LTE_CHECK_EVAL("LTE HTTP ZTP request");
                }
              }
            } else {
              ttagNextTry = now + LTE_CONNECT_RETRY;
              String broker = Config.getValue(CONFIG_VALUE_BROKERHOST);
              String cert = Config.getValue(CONFIG_VALUE_CLIENTCERT);
              String key = Config.getValue(CONFIG_VALUE_CLIENTKEY);
              // disconncect must fail here, so that we can connect 
              setMQTTCommandCallback(mqttCallback); // callback will advance state
              // make sure the client is disconnected here
              if (SARA_R5_SUCCESS == disconnectMQTT()) {
                Log.info("LTE MQTT forced disconnect");
              } else {
                Log.info("LTE MQTT connect to \"%s\":%d as client \"%s\"", broker.c_str(), MQTT_BROKER_PORT, id.c_str());
    /* step */  LTE_CHECK_INIT;
    /*  1   */  LTE_CHECK = setSecurityManager(SARA_R5_SEC_MANAGER_OPCODE_IMPORT, SARA_R5_SEC_MANAGER_ROOTCA,         SEC_ROOT_CA,     rootCa);
    /*  2   */  LTE_CHECK = setSecurityManager(SARA_R5_SEC_MANAGER_OPCODE_IMPORT, SARA_R5_SEC_MANAGER_CLIENT_CERT,    SEC_CLIENT_CERT, cert);
    /*  3   */  LTE_CHECK = setSecurityManager(SARA_R5_SEC_MANAGER_OPCODE_IMPORT, SARA_R5_SEC_MANAGER_CLIENT_KEY,     SEC_CLIENT_KEY,  key);
    /*  4   */  LTE_CHECK = LTE_IGNORE_LENA(resetSecurityProfile(LTE_SEC_PROFILE_MQTT));
    /*  5   */  LTE_CHECK = configSecurityProfile(LTE_SEC_PROFILE_MQTT, SARA_R5_SEC_PROFILE_PARAM_CERT_VAL_LEVEL,     SARA_R5_SEC_PROFILE_CERTVAL_OPCODE_YESNOURL);
    /*  6   */  LTE_CHECK = configSecurityProfile(LTE_SEC_PROFILE_MQTT, SARA_R5_SEC_PROFILE_PARAM_TLS_VER,            SARA_R5_SEC_PROFILE_TLS_OPCODE_VER1_2);
    /*  7   */  LTE_CHECK = configSecurityProfile(LTE_SEC_PROFILE_MQTT, SARA_R5_SEC_PROFILE_PARAM_CYPHER_SUITE,       SARA_R5_SEC_PROFILE_SUITE_OPCODE_PROPOSEDDEFAULT);
    /*  8   */  LTE_CHECK = configSecurityProfileString(LTE_SEC_PROFILE_MQTT, SARA_R5_SEC_PROFILE_PARAM_ROOT_CA,      SEC_ROOT_CA);
    /*  9   */  LTE_CHECK = configSecurityProfileString(LTE_SEC_PROFILE_MQTT, SARA_R5_SEC_PROFILE_PARAM_CLIENT_CERT,  SEC_CLIENT_CERT);
    /* 10   */  LTE_CHECK = configSecurityProfileString(LTE_SEC_PROFILE_MQTT, SARA_R5_SEC_PROFILE_PARAM_CLIENT_KEY,   SEC_CLIENT_KEY);
    /* 11   */  LTE_CHECK = configSecurityProfileString(LTE_SEC_PROFILE_MQTT, SARA_R5_SEC_PROFILE_PARAM_SNI,          broker);
    /* 12   */  LTE_CHECK = nvMQTT(SARA_R5_MQTT_NV_RESTORE);
    /* 13   */  LTE_CHECK = setMQTTclientId(id);
    /* 14   */  LTE_CHECK = setMQTTserver(broker, MQTT_BROKER_PORT);
    /* 15   */  LTE_CHECK = setMQTTsecure(true, LTE_SEC_PROFILE_MQTT);
    /* 16   */  LTE_CHECK = connectMQTT();
                LTE_CHECK_EVAL("LTE MQTT setup and connect");
                mqttMsgs = 0;
                topics.clear();
                subTopic = "";
                unsubTopic = "";
              }
            }
          }
          break;
        case MQTT: 
          ttagNextTry = now + LTE_1S_RETRY;
          if (!useLte || (0 == id.length())) {
            SARA_R5_error_t err = disconnectMQTT();
            if (SARA_R5_SUCCESS == err) {
              Log.info("LTE MQTT disconnect");
            } else {
              Log.error("LTE MQTT disconnect, failed with error %d", err);
              setState(ONLINE);
            }
          } else {
            // the LTE modem has difficulties subscribing/unsubscribing more than one topic at the same time
            bool busy = (0 < subTopic.length()) || (0 < unsubTopic.length());
            if (!busy) {
              std::vector<String> newTopics = Config.getTopics();
              // loop through new topics and subscribe to the first topic that is not in our curent topics list. 
              for (auto it = newTopics.begin(); (it != newTopics.end()) && !busy; it = std::next(it)) {
                String topic = *it;
                std::vector<String>::iterator pos = std::find(topics.begin(), topics.end(), topic);
                if (pos == topics.end()) {
                  SARA_R5_error_t err = subscribeMQTTtopic(0,topic);
                  if (SARA_R5_SUCCESS == err) {
                    Log.debug("LTE MQTT subscribe requested topic \"%s\" qos %d", topic.c_str(), 0);
                    subTopic = topic;
                  } else {
                    Log.error("LTE MQTT subscribe request topic \"%s\" qos %d, failed with error %d", topic.c_str(), 0, err);
                  }
                  busy = true;
                }
              }
              // loop through current topics and unsubscribe to the first topic that is not in the new topics list. 
              for (auto it = topics.begin(); (it != topics.end()) && !busy; it = std::next(it)) {
                String topic = *it;
                std::vector<String>::iterator pos = std::find(newTopics.begin(), newTopics.end(), topic);
                if (pos == newTopics.end()) {
                  SARA_R5_error_t err = unsubscribeMQTTtopic(topic);
                  if (SARA_R5_SUCCESS == err) {
                    Log.debug("LTE MQTT unsubscribe requested topic \"%s\"", topic.c_str());
                    unsubTopic = topic;
                  } else {
                    Log.error("LTE MQTT unsubscribe request topic \"%s\", failed with error %d", topic.c_str(), err);
                  }
                  busy = true;
                }
              }
              if (!busy && (0 < mqttMsgs)) {
                Log.debug("LTE MQTT read request %d msg", mqttMsgs);
                uint8_t *buf = new uint8_t[MQTT_MAX_MSG_SIZE];
                if (buf) {
                  String topic;
                  int len = -1;
                  int qos = -1;
                  SARA_R5_error_t err = readMQTT(&qos, &topic, buf, MQTT_MAX_MSG_SIZE, &len);
                  if (SARA_R5_SUCCESS == err) {
                    mqttMsgs = 0; // expect a URC afterwards
                    const char* strTopic = topic.c_str();
                    Log.info("LTE MQTT topic \"%s\" read %d bytes", strTopic, len);
                    GNSS::SOURCE source = GNSS::SOURCE::LTE;
                    if (topic.startsWith(MQTT_TOPIC_KEY_FORMAT)) {
                      source = GNSS::SOURCE::OTHER; // inject key as other
                      if (Config.setValue(CONFIG_VALUE_KEY, buf, len)) {
                        Config.save();
                      }
                    }
                    std::vector<String>::iterator pos = std::find(topics.begin(), topics.end(), topic);
                    if (pos == Lte.topics.end()) {
                      Log.error("LTE MQTT getting data from an unexpected topic \"%s\"", strTopic);
                      if (!busy) {
                        err = unsubscribeMQTTtopic(topic);
                        if (SARA_R5_SUCCESS == err) {
                          Log.debug("LTE MQTT unsubscribe requested for unexpected topic \"%s\"", strTopic);
                          unsubTopic = topic;
                        } else {
                          Log.error("LTE MQTT unsubscribe request for unexpected topic \"%s\", failed with error %d", topic.c_str(), err);
                        }
                        busy = true;
                      }
                    } else if (topic.equals(MQTT_TOPIC_FREQ)) {
                      Config.setLbandFreqs(buf, (size_t)len);
                    } else {
                      len = Gnss.inject(buf, (size_t)len, source);
                    }
                  } else {
                    Log.error("LTE MQTT read failed with error %d", err);
                  }
                  delete [] buf;
                }
              }
            }
          }
          break;
        case NTRIP: 
          ttagNextTry = now + LTE_1S_RETRY;
          if (!useNtrip || (0 == ntrip.length())) {
            if (ntripSocket >= 0) {
              Log.error("LTE NTRIP disconnect");
              socketClose(ntripSocket);
              ntripSocket = -1;
            }
            setState(ONLINE);
          } else {
            int messageSize = 0;
/* step */  LTE_CHECK_INIT;
/*  1   */  LTE_CHECK = socketReadAvailable(ntripSocket, &messageSize);
            if (LTE_CHECK_OK && (0 < messageSize)) {
              GNSS::MSG msg;
              msg.data = new uint8_t[messageSize];
              if (NULL != msg.data) {
                int readSize = 0;
/*  2   */      LTE_CHECK = socketRead(ntripSocket, messageSize, (char*)msg.data, &readSize);
                if (LTE_CHECK_OK && (readSize == messageSize)) {
                  msg.size = readSize;
                  msg.source = GNSS::SOURCE::LTE;
                  Log.info("LTE NTRIP read %d bytes", readSize);
                  Gnss.inject(msg);
                } else {
                  Log.error("LTE NTRIP read %d bytes failed reading after %d", messageSize, readSize); 
                  delete [] msg.data;
                }
              } else {
                Log.error("LTE NTRIP read %d bytes failed, no memory", messageSize);
              }
            }
            LTE_CHECK_EVAL("LTE NTRIP read");
            if (ntripGgaMs - now <= 0) {
              ntripGgaMs = now + NTRIP_GGA_RATE;
              String gga = Config.getValue(CONFIG_VALUE_NTRIP_GGA);
              int len = gga.length();
              if (0 < len) {
                gga += "\r\n";
                const char* strGga = gga.c_str();
    /* step */  LTE_CHECK_INIT;
    /*  1   */  LTE_CHECK = socketWrite(ntripSocket, gga);
                LTE_CHECK_EVAL("LTE NTRIP write");
                if (LTE_CHECK_OK) {
                  Log.info("LTE NTRIP write \"%.*s\\r\\n\" %d bytes",len, strGga, len+2);
                }
              }
            }
          }
          break;
        default:
          setState(INIT);
          break;
      }
    }
    HW_DBG_LO(HW_DBG_LTE);
  }
  
protected:
  static void task(void * pvParameters) {
    ((LTE*) pvParameters)->task();
  }

  void task(void) {
    if (!detect()) {
      Log.warning("LTE LARA-R6/SARA-R5 not detected, check wiring");
    }
    while(true) {
      poll();
      vTaskDelay(30);
    }
  }
  
  static void mqttCallback(int command, int result) {
    Log.debug("LTE mqttCallback %d %d", command, result);
    if (result == 0) {
      int code, code2;
      SARA_R5_error_t err = Lte.getMQTTprotocolError(&code, &code2);
      if (SARA_R5_SUCCESS == err) {
        Log.error("LTE MQTT command %d protocol error code %d code2 %d", command, code, code2);  
      } else {
        Log.error("LTE MQTT command %d protocol error failed with error", command, err);
      }
    } else { 
      switch (command) {
        case SARA_R5_MQTT_COMMAND_LOGIN:
          if (Lte.state != ONLINE) {
            Log.error("LTE MQTT login wrong state");
          } else {
            Log.info("LTE MQTT login");
            Lte.setState(MQTT, LTE_MQTTCMD_DELAY);
          }
          break;
        case SARA_R5_MQTT_COMMAND_LOGOUT:
          if ((Lte.state != MQTT) && (Lte.state != ONLINE)) {
            Log.error("LTE MQTT logout wrong state");
          } else {
            Log.info("LTE MQTT logout");
            Lte.mqttMsgs = 0;
            Lte.topics.clear();
            Lte.subTopic = "";
            Lte.unsubTopic = "";
            Lte.setState(ONLINE, LTE_MQTTCMD_DELAY);
          }
          break;
        case SARA_R5_MQTT_COMMAND_SUBSCRIBE:
          if (Lte.state != MQTT) {
            Log.error("LTE MQTT subscribe wrong state");
          } else if (!Lte.subTopic.length()) {
            Log.error("LTE MQTT subscribe result %d but no topic", result);
          } else {
            Log.info("LTE MQTT subscribe result %d topic \"%s\"", result, Lte.subTopic.c_str());
            Lte.topics.push_back(Lte.subTopic);
            Lte.subTopic = "";
            Lte.setState(MQTT, LTE_MQTTCMD_DELAY);
          }  
          break;
        case SARA_R5_MQTT_COMMAND_UNSUBSCRIBE:
          if (Lte.state != MQTT) {
            Log.error("LTE MQTT unsubscribe wrong state");
          } else if (!Lte.unsubTopic.length()) {
            Log.error("LTE MQTT unsubscribe result %d but no topic", result);
          } else {
            std::vector<String>::iterator pos = std::find(Lte.topics.begin(), Lte.topics.end(), Lte.unsubTopic);
            if (pos == Lte.topics.end()) {
              Lte.topics.erase(pos);
              Log.info("LTE MQTT unsubscribe result %d topic \"%s\"", result, Lte.unsubTopic.c_str());
              Lte.unsubTopic = "";
              Lte.setState(MQTT, LTE_MQTTCMD_DELAY);
            } else {
              Log.error("LTE MQTT unsubscribe result %d topic \"%s\" but topic not in list", result, Lte.unsubTopic.c_str());
            }
          } 
          break;
        case SARA_R5_MQTT_COMMAND_READ: 
          if (Lte.state != MQTT) {
            Log.error("LTE MQTT read wrong state");
          } else {
            Log.debug("LTE MQTT read result %d", result);
            Lte.mqttMsgs = result;
            Lte.setState(MQTT, LTE_MQTTCMD_DELAY);
          }
          break;
        default:
          break;
      }
    }
  }
  
  static void httpCallback(int profile, int command, int result) {
    Log.debug("LTE httpCallback profile %d command %d result %d", profile, command, result);
    if (result == 0) {
      int cls, code;
      SARA_R5_error_t err = Lte.getHTTPprotocolError(profile, &cls, &code);
      if (SARA_R5_SUCCESS == err) {
        Log.error("LTE HTTP protocol error class %d code %d", cls, code);
      } else {
        Log.error("LTE HTTP protocol error failed with error %d", err);
      }
    } else if ((profile == LTE_HTTP_PROFILE) && ((command == SARA_R5_HTTP_COMMAND_GET) || 
                                                 (command == SARA_R5_HTTP_COMMAND_POST_FILE))) {
      String str;
/* #*/LTE_CHECK_INIT;
/* 1*/LTE_CHECK = Lte.getFileContents(FILE_RESP, &str);
/* 2*/LTE_CHECK = Lte.deleteFile(FILE_RESP);
      LTE_CHECK_EVAL("LTE HTTP read");
      if (LTE_CHECK_OK) {
        const char START_TAG[] = "\r\n\r\n";
        int offset = str.indexOf(START_TAG);
        if (offset) {
          str.remove(0, offset + sizeof(START_TAG) - 1);
          if (command == SARA_R5_HTTP_COMMAND_GET) {
            // save the AWS root CA
            Config.setValue(CONFIG_VALUE_ROOTCA, str);
            Lte.setState(ONLINE);
          } else if (command == SARA_R5_HTTP_COMMAND_POST_FILE) {
            // save the ZTP
            String rootCa = Config.getValue(CONFIG_VALUE_ROOTCA);
            String id = Config.setZtp(str, rootCa);
            Lte.setState(ONLINE);
          }
        }
      }
    }
  }

  static void psdCallback(int profile, IPAddress ip) {
    Log.debug("LTE psdCallback profile %d  IP %s", profile, ip.toString().c_str());
    if (profile == LTE_PSD_PROFILE) {
      String id = Config.getValue(CONFIG_VALUE_CLIENTID);
      Lte.setState(ONLINE);
    }
  }

  static const char * REG_STATUS_LUT[11];
  static const char * REG_ACT_LUT[10];
  
  static void epsRegCallback(SARA_R5_registration_status_t status, unsigned int tac, unsigned int ci, int Act) {
    Log.debug("LTE epsRegCallback status %d(%s) tac \"%04X\", ci \"%08X\" Act %d(%s)", status, LUT(REG_STATUS_LUT, status), tac, ci, Act, LUT(REG_ACT_LUT, Act));
    if (((status == SARA_R5_REGISTRATION_HOME) || (status == SARA_R5_REGISTRATION_ROAMING)) && (Lte.state < REGISTERED)) {
      Lte.setState(REGISTERED);
    } else if ((status == SARA_R5_REGISTRATION_SEARCHING) && (Lte.state >= REGISTERED)) {
      Lte.setState(WAITREGISTER);
    }
  }
  
  static void regCallback(SARA_R5_registration_status_t status, unsigned int lac, unsigned int ci, int Act) {
    Log.debug("LTE regCallback status %d(%s) lac \"%04X\", ci \"%04X\" Act %d(%s)", status, LUT(REG_STATUS_LUT, status), lac, ci, Act, LUT(REG_ACT_LUT, Act));
    if (((status == SARA_R5_REGISTRATION_HOME) || (status == SARA_R5_REGISTRATION_ROAMING)) && (Lte.state < REGISTERED)) {
      Lte.setState(REGISTERED);
    } else if ((status == SARA_R5_REGISTRATION_SEARCHING) && (Lte.state >= REGISTERED)) {
      Lte.setState(WAITREGISTER);
    }
  }
  
  SARA_R5_error_t LTE_IGNORE_LENA(SARA_R5_error_t error) { 
    return ((error != SARA_R5_SUCCESS) && module.startsWith("LENA-R8")) ? SARA_R5_SUCCESS : error; 
  }

  typedef enum { INIT = 0, CHECKSIM, SIMREADY, WAITREGISTER, REGISTERED, ONLINE, MQTT, NTRIP, NUM_STATE } STATE;
  static const char* STATE_LUT[NUM_STATE]; 
  void setState(STATE value, long delay = 0) {
    if (state != value) {
      Log.info("LTE state change %d(%s)", value, STATE_LUT[value]);
      state = value;
    }
    ttagNextTry = millis() + delay; 
  }
  STATE state;
  long ttagNextTry;

  String module;
  std::vector<String> topics;
  String subTopic;
  String unsubTopic;
  int mqttMsgs;
  long ntripGgaMs;
  int ntripSocket; 
};

const char * LTE::REG_STATUS_LUT[] = { 
  "not registered", 
  "home", 
  "searching", 
  "denied", 
  "unknown", 
  "roaming", 
  "home sms only", 
  "roaming sms only", 
  "emergency service only",
  "home cfsb not preferred", 
  "roaming cfsb not preferred" 
};
const char * LTE::REG_ACT_LUT[] = { 
  "GSM", 
  "GSM COMPACT", 
  "UTRAN", 
  "GSM/GPRS + EDGE", 
  "UTRAN + HSDPA", 
  "UTRAN + HSUPA", 
  "UTRAN + HSDPA + HSUPA", 
  "E-UTRAN", 
  "EC-GSM-IoT (A/Gb mode)", 
  "E-UTRAN (NB-S1 mode)" 
}; 

const char* LTE::STATE_LUT[NUM_STATE] = {
  "init", 
  "check sim", 
  "sim ready", 
  "wait register", 
  "registered",
  "online",
  "mqtt", 
  "ntrip"
}; 
    
LTE Lte;

#endif // __LTE_H__
