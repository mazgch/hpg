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
 
#ifndef __WLAN_H__

#include <base64.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoMqttClient.h>
#include <WiFiManager.h>

#if defined(ARDUINO_UBLOX_NORA_W10) && defined(ESP_ARDUINO_VERSION) && (ESP_ARDUINO_VERSION < ESP_ARDUINO_VERSION_VAL(2,0,5))
  #error The WiFiManager triggers a race condition with ESP core > 2.3.0 -> please use Arduino_esp32 2.0.5 and 
#endif

#include <SparkFun_u-blox_SARA-R5_Arduino_Library.h>

#include "HW.h"
#include "CONFIG.h"
#include "WEBSOCKET.h"
#include "GNSS.h"

const int WLAN_1S_RETRY           =        1000;  //!< standard 1s retry
const int WLAN_RESETPORTAL_TIME   =       10000;  //!< Hold Boot pin down for this time to restart AP and captive portal 
const int WLAN_INIT_RETRY         =       60000;  //!< delay between detect/autoconnect attempts
const int WLAN_RECONNECT_RETRY    =       60000;  //!< delay between re-connection attempts for wifi
const int WLAN_PROVISION_RETRY    =       10000;  //!< delay between provisioning attempts, provisioning may consume data
const int WLAN_CONNECT_RETRY      =       10000;  //!< delay between server connection attempts to correction severs

const char WLAN_NTP_SERVER[]   = "pool.ntp.org";  //!< NTP server

const char* WLAN_TASK_NAME        =      "Wlan";  //!< Wlan task name
const int WLAN_STACK_SIZE         =        6000;  //!< Wlan task stack size
const int WLAN_TASK_PRIO          =           1;  //!< Wlan task priority
const int WLAN_TASK_CORE          =           1;  //!< Wlan task MCU code

extern class WLAN Wlan;  //!< Forward declaration of class

/** This class encapsulates all WLAN functions. 
*/
class WLAN {
  
public:

  /** constructor
   */
  WLAN() : mqttClient(mqttWifiClient) {
    state = STATE::INIT;
    ttagNextTry = millis();
    wasOnline = false;
    
    pinInit();
  }

  /** initialize the object, this spins of a worker task for the WIFI and LED
   */
  void init(void) {
    xTaskCreatePinnedToCore(task,    WLAN_TASK_NAME, WLAN_STACK_SIZE, this, WLAN_TASK_PRIO, NULL, WLAN_TASK_CORE);
  }
  
protected:
  
  // -----------------------------------------------------------------------
  // PORTAL
  // -----------------------------------------------------------------------

  WiFiManager manager;                  //!< the wifi manager provides the captive portal
  static const char PORTAL_HTML[];      //!< the additional HTML added to the header
  WiFiManagerParameter parameters[10];  //!< list of configuration settings 
  char bufParam[512*4];                 //!< buffer with the parameters. 
  
  /** initialize the portal and websocket 
   */
  void portalInit(void) {
    WiFi.mode(WIFI_STA);
    // consfigure and start wifi manager
    int p = 0;
    String name = Config.getDeviceName();
    const char* nameStr = name.c_str();
    //manager.resetSettings();
    manager.setDebugOutput(false, "WLAN MGR");
    manager.setAPCallback(std::bind(&WLAN::apCallback, this, std::placeholders::_1));
    manager.setSaveConfigCallback(std::bind(&WLAN::saveConfigCallback, this));
    manager.setSaveParamsCallback(std::bind(&WLAN::saveParamCallback, this));
    manager.setConfigPortalBlocking(false);  // default = true
    manager.setWebPortalClientCheck(false);  // default = true
    manager.setConfigPortalTimeout(0);
    manager.setConnectTimeout(0);
    manager.setWiFiAutoReconnect(true);    // default = true
    manager.setDisableConfigPortal(false);
    manager.setTitle(CONFIG_DEVICE_TITLE);
    manager.setHostname(name);
    manager.setShowInfoUpdate(false);
    manager.setShowInfoErase(true);
    manager.setParamsPage(true);
    std::vector<const char *> menu = { 
      "custom", 
      "param", 
      "wifi", 
      "info", 
      "sep", 
      "restart", 
      "exit" 
    };
    manager.setMenu(menu);
    manager.setCustomHeadElement(PORTAL_HTML);
    memset(parameters, 0, sizeof(parameters));
    new (&parameters[p++]) WiFiManagerParameter("<p style=\"font-weight:Bold;\">PointPerfect configuration</p>"
            "<p>Don't have a device profile or u-center-config.json? Visit the <a href=\"https://portal.thingstream.io/app/location-services\">Thingstream Portal</a> to create one.</p>");
    new (&parameters[p++]) WiFiManagerParameter(CONFIG_VALUE_ZTPTOKEN, 
            "Device Profile Token or load a <a href=\"#\" onclick=\"document.getElementById('file').click();\">JSON</a> file<input hidden accept=\".json,.csv\" type=\"file\" id=\"file\" onchange=\"_l(this);\"/>", 
            Config.getValue(CONFIG_VALUE_ZTPTOKEN).c_str(), 36, " onkeyup=\"_s('" CONFIG_VALUE_CLIENTID "','');\" type=\"password\" placeholder=\"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxxx\" pattern=\"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\"");
    updateManagerParameters();
    new (&parameters[p++]) WiFiManagerParameter(bufParam);
    new (&parameters[p++]) WiFiManagerParameter(CONFIG_VALUE_LTEAPN, "APN", Config.getValue(CONFIG_VALUE_LTEAPN).c_str(), 64);
    new (&parameters[p++]) WiFiManagerParameter(CONFIG_VALUE_SIMPIN, "SIM pin", Config.getValue(CONFIG_VALUE_SIMPIN).c_str(), 8, " type=\"password\"");
    new (&parameters[p++]) WiFiManagerParameter("<p style=\"font-weight:Bold;\">NTRIP configuration</p>"
             "<p>To use NTRIP you need to set Correction source to one of the NTRIP options.</p>");
    new (&parameters[p++]) WiFiManagerParameter(CONFIG_VALUE_NTRIP_SERVER, "NTRIP correction service", Config.getValue(CONFIG_VALUE_NTRIP_SERVER).c_str(), 64, 
             " placeholder=\"server.com:2101/MountPoint\" pattern=\"^([0-9a-zA-Z_\\-]+\\.)+([0-9a-zA-Z_\\-]{2,})(:[0-9]+)?\\/[0-9a-zA-Z_\\-]+$\"");
    new (&parameters[p++]) WiFiManagerParameter(CONFIG_VALUE_NTRIP_USERNAME, "Username", Config.getValue(CONFIG_VALUE_NTRIP_USERNAME).c_str(), 64);
    new (&parameters[p++]) WiFiManagerParameter(CONFIG_VALUE_NTRIP_PASSWORD, "Password", Config.getValue(CONFIG_VALUE_NTRIP_PASSWORD).c_str(), 64, " type=\"password\"");
    for (int i = 0; i < p; i ++) {
      manager.addParameter(&parameters[i]);
    }
    Websocket.setup(manager);
    manager.setWebServerCallback(std::bind(&WEBSOCKET::bind, &Websocket)); 
      
    log_i("autoconnect using wifi/hostname \"%s\"", nameStr);
    manager.autoConnect(nameStr);
  } 
  
  /** start the portal and report the IP
   */
  void portalStart() {
    String hostname = WiFi.getHostname();
    String ip = WiFi.localIP().toString();
    int rssi = WiFi.RSSI();
    log_i("connected with hostname \"%s\" at IP %s RSSI %d dBm", hostname.c_str(), ip.c_str(), rssi);
    log_i("visit portal at \"http://%s/\" or \"http://%s/\"", ip.c_str(), hostname.c_str());
    manager.startWebPortal();
  }         

  /** reset the portal, this disconnects the correction clients
   */
  void portalReset(void) {
    log_i("disconnect and reset settings");
    manager.disconnect();
    manager.resetSettings();
    mqttStop();
    ntripStop();
  }
   
  /** just report that AP was started
   */
  void apCallback(WiFiManager *pManager) {
    String ip = WiFi.softAPIP().toString();    
    log_i("config portal started with IP %s", ip.c_str());
  }

  /** just report that config was saved
   */
  void saveConfigCallback() {
    log_i("settings changed and connection sucessful");
  }

  /** parse the parameters from the server and apply them or take actions
   */
  void saveParamCallback(void) {
    int args = manager.server->args();
    bool changed = false;
    CONFIG::USE_SOURCE useSrc = Config.getUseSource();
    for (uint8_t i = 0; i < args; i++) {
      String param = manager.server->argName(i);
      String value = manager.server->arg(param);
      log_d("\"%s\" \"%s\"", param.c_str(), value.c_str());
      if (param.equals(CONFIG_VALUE_ROOTCA) || param.equals(CONFIG_VALUE_CLIENTCERT) || param.equals(CONFIG_VALUE_CLIENTKEY)) {
        // convert the certificates and keys into the appropriate format 
        String tag = param.equals(CONFIG_VALUE_CLIENTKEY) ? "RSA PRIVATE KEY" : "CERTIFICATE";
        String out = "-----BEGIN " + tag + "-----\n";
        while (value.length()) {
          out += value.substring(0,64) + "\n";
          value = value.substring(64);
        }
        out += "-----END " + tag + "-----\n";
        value = out;
      }
      if (param.equals(CONFIG_VALUE_USESOURCE)) {
        useSrc = (CONFIG::USE_SOURCE)value.toInt();
        changed = true;
      } else if (Config.setValue(param.c_str(), value)) {
        changed = true;
        if (param.equals(CONFIG_VALUE_ZTPTOKEN)) {
          Config.delZtp();      
        }
      }
    }
    if (changed) {
      if (Config.setUseSource(useSrc)) {
        changed = true;
      }
    }
    if (changed) {
      updateManagerParameters();
    }
  }

  /** Update the html buffer used for parameters of the configuration manager 
   */
  void updateManagerParameters(void) {
    String name = Config.getDeviceName();
    int len = sprintf(bufParam, "<label>Hardware Id</label><br><input maxlength=\"20\" value=\"%s\" readonly>", name.c_str());
    String clientId = Config.getValue(CONFIG_VALUE_CLIENTID);
    len += sprintf(&bufParam[len], "<label for=\"%s\">Client Id</label><br>"
                                     "<input id=\"%s\" value=\"%s\" readonly>", 
                                      CONFIG_VALUE_CLIENTID, CONFIG_VALUE_CLIENTID, clientId.c_str());
    len += sprintf(&bufParam[len], "<p style=\"font-weight:Bold;\">Correction Source</p>"
                                   "<label for=\"%s\">Service type and interface</label><br>"
                                   "<select id=\"%s\" name=\"%s\">", CONFIG_VALUE_USESOURCE, CONFIG_VALUE_USESOURCE, CONFIG_VALUE_USESOURCE);
    const char* NTRIP = "NTRIP";
    const char* POINTPERFECT = "PointPerfect";
    const struct { const char* service; const char* value; } optSource[] = { 
      { NULL,         "none"                },
      //              ---- PointPerfect ---- 
      { POINTPERFECT, "WLAN + LTE + LBAND", },
      { POINTPERFECT, "WLAN + LBAND",       }, 
      { POINTPERFECT, "WLAN + LTE",         },
      { POINTPERFECT, "WLAN",               },
      { POINTPERFECT, "LTE + LBAND",        }, 
      { POINTPERFECT, "LTE",                },
      { POINTPERFECT, "LBAND",              },
      //              ---- NTRIP -----
      { NTRIP,        "WLAN + LTE",         },
      { NTRIP,        "WLAN",               },
      { NTRIP,        "LTE",                },
    };
    CONFIG::USE_SOURCE curUseSrc = (CONFIG::USE_SOURCE)(Config.getUseSource() & CONFIG::USE_SOURCE::CONFIG_MASK); 
    const char* service = NULL;
    for (int i = 0; i < sizeof(optSource)/sizeof(*optSource); i ++) {
      if (optSource[i].service && (service != optSource[i].service)) {
        len += sprintf(&bufParam[len], "<option disabled>---- %s ----</option>", optSource[i].service); 
      }
      CONFIG::USE_SOURCE useSrc = (CONFIG::USE_SOURCE)( 
              ((optSource[i].service == POINTPERFECT) ? CONFIG::USE_SOURCE::USE_POINTPERFECT : 0) |  
              ((optSource[i].service == NTRIP)        ? CONFIG::USE_SOURCE::USE_NTRIP        : 0) |
              (strstr(optSource[i].value, "WLAN")     ? CONFIG::USE_SOURCE::USE_WLAN         : 0) |
              (strstr(optSource[i].value, "LTE")      ? CONFIG::USE_SOURCE::USE_LTE          : 0) |
              (strstr(optSource[i].value, "LBAND")    ? CONFIG::USE_SOURCE::USE_LBAND        : 0) );
      len += sprintf(&bufParam[len], "<option%s value=\"%d\">%s</option>", 
              (curUseSrc == useSrc) ? " selected" : "", useSrc, optSource[i].value);
      service = optSource[i].service;
    }
    
    len += sprintf(&bufParam[len],  "</select>"
                            "<p style=\"font-weight:bold;\">LTE configuration</p>"
                            "<label for=\"%s\">MNO Profile</label><br>"
                            "<select id=\"%s\" name=\"%s\">", CONFIG_VALUE_MNOPROF, CONFIG_VALUE_MNOPROF, CONFIG_VALUE_MNOPROF);
    const struct { mobile_network_operator_t mno; const char* str; } optMno[] = {   
      { MNO_SIM_ICCID,      "SIM ICCID"               },
      { MNO_GLOBAL,         "Global"                  },
      { MNO_STD_EUROPE,     "Standard Europe"         },
      { MNO_STD_EU_NOEPCO,  "Standard Europe No-ePCO" },
      { MNO_ATT,            "AT&T"                    },
      { MNO_VERIZON ,       "Verizon"                 },
      { MNO_TMO,            "T-Mobile US"             },
      { MNO_US_CELLULAR,    "US Cellular"             },
      { MNO_TELSTRA,        "Telstra"                 },
      { MNO_SPRINT,         "Sprint"                  },
      { MNO_VODAFONE,       "Vodaphone"               },
      { MNO_DT,             "Deutsche Telekom"        },
      { MNO_TELUS,          "Telus"                   },
      { MNO_NTT_DOCOMO,     "NTT Docomo"              },
      { MNO_SOFTBANK,       "Softbank"                },
      { MNO_SKT,            "SKT"                     },
      { MNO_CT,             "China Telecom"           },
      { MNO_SW_DEFAULT,     "Undefined / regulatory"  }
    };
    String strMno = Config.getValue(CONFIG_VALUE_MNOPROF);
    mobile_network_operator_t curMno = strMno.length() ? (mobile_network_operator_t)strMno.toInt() : MNO_GLOBAL;
    for (int i = 0; i < sizeof(optMno)/sizeof(*optMno); i ++) {
      len += sprintf(&bufParam[len], "<option%s value=\"%d\">%s</option>", (curMno == optMno[i].mno) ? " selected" : "", optMno[i].mno, optMno[i].str);
    } 
    len += sprintf(&bufParam[len], "</select>");
  }
  
  // -----------------------------------------------------------------------
  // MQTT / PointPerfect
  // -----------------------------------------------------------------------

  std::vector<String> topics;       //!< vector with current subscribed topics
  WiFiClientSecure mqttWifiClient;  //!< the secure wifi client used for MQTT 
  MqttClient mqttClient;            //!< the secure MQTT client 
   
  /** Try to provision the PointPerfect to that we can start the MQTT server. This involves: 
   *  1) HTTPS request is made to AWS to GET theri ROOT CA
   *  2) HTTPS request to Thingstream POSTing the device tocken to get the credentials and client cert, key and ID
   *  \return provision sucess status;
   */
  bool mqttProvision(void) {
    String id = Config.getValue(CONFIG_VALUE_CLIENTID);
    if (0 < id.length()) {
      return true;
    }
    String ztpReq = Config.ztpRequest();
    if (0 < ztpReq.length()) {
      // Fetch the AWS Root CA
      HTTPClient http;
      http.begin(AWSTRUST_ROOTCAURL);
      http.setConnectTimeout(5000);
      log_i("HTTP AWS \"%s\" get", AWSTRUST_ROOTCAURL);
      int httpResponseCode = http.GET();
      String rootCa = http.getString();
      http.end();
      if (httpResponseCode != HTTP_CODE_OK) {
        log_e("HTTP AWS response error %d %s", httpResponseCode, rootCa.c_str());
      } else {
        log_d("HTTP AWS response %s", rootCa.c_str());
        mqttWifiClient.setCACert(rootCa.c_str());
        
        // Perform PointPerfect ZTP 
        http.begin(THINGSTREAM_ZTPURL);
        http.setConnectTimeout(5000);
        http.addHeader(F("Content-Type"), F("application/json"));
        log_i("HTTP ZTP \"%s\" post \"%s\"", THINGSTREAM_ZTPURL, ztpReq.c_str());
        int httpResponseCode = http.POST(ztpReq.c_str());
        String ztp = http.getString();
        http.end();
        if (httpResponseCode != HTTP_CODE_OK) {
          log_e("HTTP ZTP response error %d %s", httpResponseCode, ztp.c_str());
        } else {
          log_d("HTTP ZTP response %s", ztp.c_str());
          if (Config.setZtp(ztp, rootCa)) {
            updateManagerParameters();
            return true;
          }
        }
      }
    }
    return false;
  }
  
  /** Connect to the Thingstream PointPerfect server using the credentials from ZTP process
   *  \return  success status
   */
  bool mqttConnect(void) {
    String id = Config.getValue(CONFIG_VALUE_CLIENTID);
    if (0 < id.length()) {
      String broker = Config.getValue(CONFIG_VALUE_BROKERHOST);
      String rootCa = Config.getValue(CONFIG_VALUE_ROOTCA);
      String cert = Config.getValue(CONFIG_VALUE_CLIENTCERT);
      String key = Config.getValue(CONFIG_VALUE_CLIENTKEY);
      mqttWifiClient.setCACert(rootCa.c_str());
      mqttWifiClient.setCertificate(cert.c_str());
      mqttWifiClient.setPrivateKey(key.c_str());
      const char* idStr = id.c_str();
      const char* brokerStr = broker.c_str();
      mqttClient.setId(idStr);
      mqttClient.onMessage(onMQTTStatic);
      mqttClient.setKeepAliveInterval(60 * 1000);
      mqttClient.setConnectionTimeout( 5 * 1000);
      if (mqttClient.connect(brokerStr, MQTT_BROKER_PORT)) {
        log_i("server \"%s:%d\" as client \"%s\"", brokerStr, MQTT_BROKER_PORT, idStr);
      } else {
        int err = mqttClient.connectError(); 
        const char* LUT[] = { "REFUSED", "TIMEOUT", "OK", "PROT VER", "ID BAD", "SRV NA", "BAD USER/PWD", "NOT AUTH" };
        log_e("server \"%s\":%d as client \"%s\" failed with error %d(%s)",
                  brokerStr, MQTT_BROKER_PORT, idStr, err, LUT[err + 2]);
        if (err == MQTT_CONNECTION_REFUSED) {
          log_i("%d bytes free, heap memory may be too low for SSL client, try remove features like BLUETOOTH", ESP.getFreeHeap());
        }
      }
      return mqttClient.connected();
    }
    return false;
  }
  
  /** Disconnect and cleanup the MQTT connection
   */
  void mqttStop(void) {
    for (auto it = topics.begin(); it != topics.end(); it = std::next(it)) {
      String topic = *it;
      log_i("unsubscribe \"%s\"", topic.c_str());
      mqttClient.unsubscribe(topic);
    }
    topics.clear();
    if (mqttClient.connected()) {
      log_i("disconnect");
      mqttClient.stop();
    }
  }

  /** The MQTT task is responsible for:
   *  1) subscribing to topics
   *  2) unsubscribing from topics 
   */
  void mqttTask(void) {
    std::vector<String> newTopics = Config.getMqttTopics();
    // filter out the common ones that need no change 
    for (auto rit = topics.rbegin(); rit != topics.rend(); rit = std::next(rit)) {
      String topic = *rit;
      std::vector<String>::iterator pos = std::find(newTopics.begin(), newTopics.end(), topic);
      if (pos != topics.end()) {
        newTopics.erase(pos);
      } else {
        log_i("unsubscribe \"%s\"", topic.c_str());
        if (mqttClient.unsubscribe(topic)) {
          topics.erase(std::next(rit).base());
        }
      }
    }
    for(int n = 0; n < newTopics.size(); n ++) {
      String topic = newTopics[n];
      log_i("subscribe \"%s\"", topic.c_str());
      if (mqttClient.subscribe(topic)) {
        topics.push_back(topic);
      }
    } 
  }
  
  /** The MQTT callback processes is responsible for reading the data
   *  \param messageSize the bytes pending top be read
   */
  void onMQTT(int messageSize) {
    if (messageSize) {
      String topic = mqttClient.messageTopic();
      MSG::HINT hint = 
            topic.startsWith(MQTT_TOPIC_KEY_FORMAT)  ? MSG::HINT::KEYS : 
            topic.startsWith(MQTT_TOPIC_FREQ)        ? MSG::HINT::CONFIG :
            topic.startsWith(MQTT_TOPIC_MGA)         ? MSG::HINT::UBX : 
                                                       MSG::HINT::SPARTN;
      MSG msg(messageSize, MSG::SRC::WLAN, hint);
      if (msg) {
        log_i("topic \"%s\" with %d bytes", topic.c_str(), msg.size); 
        msg.size = mqttClient.read(msg.data, msg.size);
        if (msg.size == messageSize) {
          if (hint == MSG::HINT::CONFIG) {
            Config.updateLbandFreqs(msg.data, msg.size);
            // do not send this message anywhere
          } else {
            if (hint == MSG::HINT::KEYS) {
              Config.setValue(CONFIG_VALUE_KEY, msg.data, msg.size);
            }
            queueToCommTask.sendParsed(msg); 
          }
        } else { 
          log_e("topic \"%s\" with %d bytes failed reading after %d", topic.c_str(), messageSize, msg.size); 
        }
      } else {
        log_e("topic \"%s\" dropped %d bytes, no memory", topic.c_str(), messageSize); 
      }
    }
  }
  //! static callback helper, onMQTT will do the real work
  static void onMQTTStatic(int messageSize) {
    Wlan.onMQTT(messageSize);
  }
  
  // -----------------------------------------------------------------------
  // NTRIP / RTCM
  // -----------------------------------------------------------------------
  
  int32_t ntripGgaMs;           //!< time tag (millis()) of next GGA to be sent
  WiFiClient ntripWifiClient;   //!< the wifi client used for ntrip
  
  /** Connect to a NTRIP server
   *  \return       connection success
   */
  bool ntripConnect(void) {
    String ntrip = Config.getValue(CONFIG_VALUE_NTRIP_SERVER);
    int pos1 = ntrip.indexOf(':');
    int pos2 = ntrip.indexOf('/');
    pos1 = (-1 == pos1) ? pos2 : pos1;
    String server = (-1   == pos1) ? ""                : ntrip.substring(0,pos1);
    uint16_t port = (pos1 == pos2) ? NTRIP_SERVER_PORT : ntrip.substring(pos1+1,pos2).toInt();
    String mntpnt = (-1   == pos2) ? ""                : ntrip.substring(pos2+1);
    if ((0 == server.length()) || (0 == mntpnt.length())) return false;
    int ok = ntripWifiClient.connect(server.c_str(), port);
    if (!ok) {
      log_e("server \"%s:%d\" failed", server.c_str(), port);
    } else {
      String user = Config.getValue(CONFIG_VALUE_NTRIP_USERNAME);
      String pwd = Config.getValue(CONFIG_VALUE_NTRIP_PASSWORD);
      String authEnc;
      String authHead;
      if (0 < user.length() && 0 < pwd.length()) {
        authEnc = base64::encode(user + ":" + pwd);
        authHead = "Authorization: Basic ";
        authHead += authEnc + "\r\n";
      }                    
      log_i("server \"%s:%d\" GET \"/%s\" auth \"%s\"", server.c_str(), port, mntpnt.c_str(), authEnc.c_str());
      ntripWifiClient.printf("GET /%s HTTP/1.0\r\n"
                "User-Agent: " CONFIG_DEVICE_TITLE "\r\n"
                "%s\r\n", mntpnt.c_str(), authHead.c_str());
      // now get the response
      int ixSrc = 0;
      int ixIcy = 0;
      int32_t start = millis();
      do {
        if (ntripWifiClient.available()) {
          char ch = ntripWifiClient.read();
          ixSrc = (NTRIP_RESPONSE_SOURCETABLE[ixSrc] == ch) ? ixSrc + 1 : 0;
          ixIcy = (NTRIP_RESPONSE_ICY[ixIcy]         == ch) ? ixIcy + 1 : 0;
        } else { 
          vTaskDelay(1);
        }
      } while ( (NTRIP_RESPONSE_SOURCETABLE[ixSrc] != '\0') && (NTRIP_RESPONSE_ICY[ixIcy] != '\0') && 
                ntripWifiClient.connected() && (0 < (start + NTRIP_CONNECT_TIMEOUT - millis())) );
      // evaluate the response
      if (NTRIP_RESPONSE_ICY[ixIcy] == '\0') { 
        log_i("connected");
        ntripGgaMs = millis();
        return true;
      } else if (NTRIP_RESPONSE_SOURCETABLE[ixSrc] == '\0') {
        log_i("got source table, please provide a mountpoint");
        String str = ntripWifiClient.readStringUntil('\n');
      } else {
        log_e("protocol failure after %d ms ix %d %d", millis() - start, ixSrc, ixIcy);
      }
      ntripWifiClient.stop();
    }
    return false;
  }
  
  /** Stop and cleanup the NTRIP connection 
   */
  void ntripStop(void)
  {
    if (ntripWifiClient.connected()) {
      log_i("disconnect");
      ntripWifiClient.stop();
    }
  } 
  
  /** The NTRIP task is responsible for:
   *  1) reading NTRIP data from the wifi and inject it into the GNSS receiver.
   *  2) sending a GGA from time to time to allow VRS services to adjust their correction stream 
   */
  void ntripTask(void)
  {
    int messageSize = ntripWifiClient.available();
    if (0 < messageSize) {
      MSG msg(messageSize, MSG::SRC::WLAN, MSG::HINT::RTCM);
      if (msg) {
        msg.size = ntripWifiClient.read(msg.data, msg.size);
        if (msg.size == messageSize) {
          log_i("read %d bytes", messageSize);
          queueToCommTask.sendParsed(msg); 
        } else {
          log_e("read %d bytes failed reading after %d", messageSize, msg.size); 
        }
      } else {
        log_e("dropped %d bytes, no memory",  messageSize); 
      }
    }
    long now = millis();
    if (ntripGgaMs - now <= 0) {
      ntripGgaMs = now + NTRIP_GGA_RATE;
      String gga;
      if (Config.getGga(gga)) {
        const char* strGga = gga.c_str();
        int wrote = ntripWifiClient.println(strGga);
        if (wrote != gga.length()) {
          log_i("println \"%s\" %d bytes", strGga, wrote);
        } else {
          log_e("println \"%s\" %d bytes, failed", strGga, wrote);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // PIN
  // -----------------------------------------------------------------------
  
  int32_t ttagPinChange;  //!< time tag (millis()) of last pin change
  int lastPinLvl;         //!< last pin level
  
  /** init the pin function 
   */
  void pinInit(void) {
    ttagPinChange = millis();
    lastPinLvl = HIGH;
    // attachInterrupt(digitalPinToInterrupt(BOOT), blink, CHANGE);
  }

  /** check if the pin was pressed for a long time
   *  \return true if it was pressed for WLAN_RESETPORTAL_TIME seconds 
   */
  bool pinCheck(void) {
    if (PIN_INVALID != BOOT) {
      int level = digitalRead(BOOT);
      int32_t now = millis();
      if (lastPinLvl != level) {
        ttagPinChange = now;
        lastPinLvl  = level;
      } else if ((level == LOW) && (0 >= (ttagPinChange + WLAN_RESETPORTAL_TIME - now))) {
        return true;
      }
    }
    return false;
  }  
  
  // -----------------------------------------------------------------------
  // STATEMACHINE
  // -----------------------------------------------------------------------
  
  //! states of the statemachine 
  enum class STATE { 
    INIT = 0, 
    SEARCHING, 
    CONNECTED, 
    ONLINE, 
    MQTT, 
    NTRIP, 
    NUM 
  } state;                //!< the current state
  int32_t ttagNextTry;    //!< time tag when to call the state machine again
  bool wasOnline;         //!< a flag indicating if we were online 
  
  /** advance the state and report transitions
   *  \param newState  the new state
   *  \param delay     schedule delay
   */
  void setState(STATE newState, int32_t delay = 0) {
    if (state != newState) {
      const struct 
        { const char* text; STATUSLED::PATTERN pattern;   } lut[] = { 
        { "init",           STATUSLED::PATTERN::OFF       },
        { "searching",      STATUSLED::PATTERN::BLINK_4Hz }, 
        { "connected",      STATUSLED::PATTERN::BLINK_2Hz }, 
        { "online",         STATUSLED::PATTERN::BLINK_1Hz },
        { "mqtt",           STATUSLED::PATTERN::BLINK_2s  },
        { "ntrip",          STATUSLED::PATTERN::BLINK_2s  }
      }; 
      size_t ix = (size_t)newState;
      log_i("state change %s", lut[ix].text);
      StatusLed.pattern = lut[ix].pattern;
      state = newState;
    }
    ttagNextTry = millis() + delay; 
  }

  /** FreeRTOS static task function, will just call the objects task function  
   *  \param pvParameters the Lte object (this)
   */
  static void task(void * pvParameters) {
    ((WLAN*) pvParameters)->task();
  }
  
  /** This task handling the whole WIFI state machine, here is where different activities are scheduled 
   *  and where the code decides what actions to perform.  
   */
  void task(void) {
    portalInit();  
    setState(STATE::SEARCHING);
    
    while(true) {
      // press a pin for a selected time to extern back into captive portal
      if (pinCheck() && (state != STATE::SEARCHING) && (state != STATE::INIT)) {
        portalReset();
        setState(STATE::SEARCHING);
      }
      manager.process();
      if (mqttClient.connected()) {
        mqttClient.poll();
      }
      int32_t now = millis();
      bool onlineWlan  = WiFi.status() == WL_CONNECTED;
      if (!onlineWlan && wasOnline) {
        log_w("lost connection");
        wasOnline = false;
        ttagNextTry = now;
      } else if (!wasOnline && onlineWlan) {
        log_i("got connection");
        ttagNextTry = now;
      }
      wasOnline = onlineWlan;
      if (0 >= (ttagNextTry - now)) {
        ttagNextTry = now + WLAN_1S_RETRY;
        CONFIG::USE_SOURCE useSrc = Config.getUseSource();
        bool useWlan   = (useSrc & CONFIG::USE_SOURCE::USE_WLAN) && onlineWlan;
        bool useNtrip = useWlan && (useSrc & CONFIG::USE_SOURCE::USE_NTRIP);
        bool useMqtt  = useWlan && (useSrc & CONFIG::USE_SOURCE::USE_POINTPERFECT);
        switch (state) {
          case STATE::INIT:
            ttagNextTry = now + WLAN_INIT_RETRY;
            portalInit();  
            setState(STATE::SEARCHING);
            break;
          case STATE::SEARCHING:
            ttagNextTry = now + WLAN_RECONNECT_RETRY;
            if (onlineWlan) {
              portalStart();
              setState(STATE::CONNECTED); // allow some time for dns to resolve. 
            }
            break;
          case STATE::CONNECTED:
            if (onlineWlan) { 
              // test if we have access to the internet
              IPAddress ip;
              if (WiFi.hostByName(AWSTRUST_SERVER, ip)) {
               configTime(0, 0, WLAN_NTP_SERVER);
               setState(STATE::ONLINE);
              }
            }
            break;
          case STATE::ONLINE:
            if (useMqtt) {
              if (useSrc & CONFIG::USE_SOURCE::USE_CLIENTID) {
                ttagNextTry = now + WLAN_CONNECT_RETRY;
                if (mqttConnect()) {
                  setState(STATE::MQTT);
                }
              } else if (useSrc & CONFIG::USE_SOURCE::USE_ZTPTOKEN) {
                ttagNextTry = now + WLAN_PROVISION_RETRY;
                if (mqttProvision()) {
                  setState(STATE::ONLINE);
                }
              }
            } else if (useNtrip) {
              if (useSrc & CONFIG::USE_SOURCE::USE_NTRIP_SERVER) {
                ttagNextTry = now + WLAN_CONNECT_RETRY;
                if (ntripConnect()) {
                  setState(STATE::NTRIP);
                }
              }
            }
            break;
          case STATE::MQTT:
            if (useMqtt && (useSrc & CONFIG::USE_SOURCE::USE_CLIENTID) && mqttClient.connected()) {
              mqttTask();
            } else {
              mqttStop();
              setState(STATE::ONLINE);
            } 
            break;
          case STATE::NTRIP: 
            if (useNtrip && (useSrc & CONFIG::USE_SOURCE::USE_NTRIP_SERVER) && ntripWifiClient.connected()) {
              ntripTask();
            } else {
              ntripStop();
              setState(STATE::ONLINE);
            }
            break;
          default:
            break;
        }
      }
      vTaskDelay(50);
    }
  }
};

WLAN Wlan; //!< The global WLAN peripherial object

// --------------------------------------------------------------------------------------
// Resources served
// --------------------------------------------------------------------------------------

//! the additional HTML added to the header
const char WLAN::PORTAL_HTML[] = R"html(
<style>
  .wrap{max-width:800px;}
  a,a:hover{color:rgb(255,76,0);}
  button,.msg{border-radius:0;}
  input[type='file'],input,select{border-radius:0;border:2px solid #ccc;outline:none;}
  input[type='file']:focus,input:focus{border: 2px solid #555;}input[readonly]:focus{border: 2px solid #ccc;}
  button,input[type='button'],input[type='submit']{background-color:rgb(255,76,0);}
</style>
<script>
  function _s(_n,_v,_h){
    var _e=document.getElementById(_n);
    if (!_e) {
      _e=document.createElement('input');
      if (_e) {
        _e.id=_n;
        _i.appendChild(_e);
      }
    }
    if (_e) {
      _e.value=_v;
      _e.name=_n;
      if (_h) {
        _e.setAttribute('hidden','');
      } else { 
        _e.removeAttribute('hidden');
      }
    }
  }
  function _d(){
    try {
      var _j = JSON.parse(_r.result);
      var _c = _j.MQTT.Connectivity;
      var _o = { };
      _s('clientId', _c.ClientID);
      _s('brokerHost', _c.ServerURI.match(/\s*:\/\/(.*):\d+/)[1]);
      _c = _c.ClientCredentials;
      _s('clientKey', _c.Key, true);
      _s('clientCert', _c.Cert, true);
      _s('rootCa', _c.RootCA, true);
      _s('stream', _j.MQTT.Subscriptions.Key.KeyTopics[0].match(/.{2}$/)[0]);
      _s('ztpToken', '');
      _i.value = '';
    } catch(e) { alert('bad json content'); }
  };
  function _l(_i){
    var _r = new FileReader();
    _r.onload = _d;
    if (_i.files[0]) _r.readAsText(_i.files[0]);
  };
</script>
)html";

#endif // __WLAN_H__
