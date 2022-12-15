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

const char* WLAN_TASK_NAME        =      "Wlan";  //!< Wlan task name
const int WLAN_STACK_SIZE         =      6*1024;  //!< Wlan task stack size
const int WLAN_TASK_PRIO          =           1;  //!< Wlan task priority
const int WLAN_TASK_CORE          =           1;  //!< Wlan task MCU code

const char* LED_TASK_NAME         =       "Led";  //!< Led task name
const int LED_STACK_SIZE          =      1*1024;  //!< led task stack size
const int LED_TASK_PRIO           =           2;  //!< led task priority
const int LED_TASK_CORE           =           1;  //!< led task MCU code

extern class WLAN Wlan;  //!< Forward declaration of class

/** This class encapsulates all WLAN functions. 
*/
class WLAN {
  
public:

  /** constructor
   */
  WLAN() : mqttClient(mqttWifiClient) {
    state = INIT;
    wasOnline = false;
    
    pinInit();
    ledInit();
  }

  /** initialize the object, this spins of a worker task for the WIFI and LED
   */
  void init(void) {
    xTaskCreatePinnedToCore(task,    WLAN_TASK_NAME, WLAN_STACK_SIZE, this, WLAN_TASK_PRIO, NULL, WLAN_TASK_CORE);
    xTaskCreatePinnedToCore(ledTask, LED_TASK_NAME,  LED_STACK_SIZE,  this, LED_TASK_PRIO,  NULL, LED_TASK_CORE);
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
            Config.getValue(CONFIG_VALUE_ZTPTOKEN).c_str(), 36, " type=\"password\" placeholder=\"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxxx\" pattern=\"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\"");
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
    bool save = false;
    for (uint8_t i = 0; i < args; i++) {
      String param = manager.server->argName(i);
      String value = manager.server->arg(param);
      log_d("\"%s\" \"%s\"", param.c_str(), value.c_str());
      if (param.equals(CONFIG_VALUE_ROOTCA) || param.equals(CONFIG_VALUE_CLIENTCERT) || param.equals(CONFIG_VALUE_CLIENTKEY)) {
        String tag = param.equals(CONFIG_VALUE_CLIENTKEY) ? "RSA PRIVATE KEY" : "CERTIFICATE";
        String out = "-----BEGIN " + tag + "-----\n";
        while (value.length()) {
          out += value.substring(0,64) + "\n";
          value = value.substring(64);
        }
        out += "-----END " + tag + "-----\n";
        value = out;
      }
      bool changed = Config.setValue(param.c_str(), value);
      if (changed) {
        save = true;
        if (param.equals(CONFIG_VALUE_ZTPTOKEN) && (value.length()>0)) {
          Config.delZtp();      
        }
      }
    }
    if (save) {
      Config.save();
      updateManagerParameters();
      // something has changed - we should issue a restart for the WIFI (and LTE) state machines  
      if ((state == NTRIP) || (state== MQTT)) {
        ntripStop();
        mqttStop();
        setState(ONLINE);
      }
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
    String selected = Config.getValue(CONFIG_VALUE_USESOURCE); 
    const char *optSource[] = { "WLAN + LTE + LBAND", "WLAN + LBAND", "LTE + LBAND", "WLAN", "LTE", "LBAND", 
                                "NTRIP: WLAN + LTE", "NTRIP: WLAN", "NTRIP: LTE", "none" };
    if (!selected.length()) {
      selected = optSource[0]; 
      Config.setValue(CONFIG_VALUE_USESOURCE, optSource[0]);
    }
    for (int i = 0; i < sizeof(optSource)/sizeof(*optSource); i ++) {
      len += sprintf(&bufParam[len], "<option%s value=\"%s\">%s</option>", selected.equals(optSource[i]) ? " selected" : "", optSource[i], optSource[i]);
    }
    len += sprintf(&bufParam[len],  "</select>"
                            "<p style=\"font-weight:Bold;\">LTE configuration</p>"
                            "<label for=\"%s\">MNO Profile</label><br>"
                            "<select id=\"%s\" name=\"%s\">", CONFIG_VALUE_MNOPROF, CONFIG_VALUE_MNOPROF, CONFIG_VALUE_MNOPROF);
    const struct { uint8_t val; const char* str; } optMno[] = {   
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
    uint8_t mno = MNO_GLOBAL;
    selected = Config.getValue(CONFIG_VALUE_MNOPROF);
    if (selected.length()) {
      mno = (mobile_network_operator_t)selected.toInt();
    } else {
      mno = MNO_GLOBAL;
      Config.setValue(CONFIG_VALUE_MNOPROF, String(mno));
    }
    for (int i = 0; i < sizeof(optMno)/sizeof(*optMno); i ++) {
      len += sprintf(&bufParam[len], "<option%s value=\"%d\">%s</option>", (mno == optMno[i].val) ? " selected" : "", optMno[i].val, optMno[i].str);
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
   *  \return the client id assigned to this board
   */
  String mqttProvision(void) {
    String id; 
    String ztpReq = Config.ztpRequest();
    if (ztpReq.length()) {
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
          id = Config.setZtp(ztp, rootCa);
        }
      }
    }
    return id;
  }
  
  /** Connect to the Thingstream PointPerfect server using the credentials from ZTP process
   *  \param id  the client ID for this device
   */
  bool mqttConnect(String id) {
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
    std::vector<String> newTopics = Config.getTopics();
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
      GNSS::MSG msg;
      msg.data = new uint8_t[messageSize];
      if (NULL != msg.data) {
        msg.size = mqttClient.read(msg.data, messageSize);
        if (msg.size == messageSize) {
          msg.source = GNSS::SOURCE::WLAN;
          log_i("topic \"%s\" with %d bytes", topic.c_str(), msg.size); 
          if (topic.startsWith(MQTT_TOPIC_KEY_FORMAT)) {
            msg.source = GNSS::SOURCE::KEYS;
            if (Config.setValue(CONFIG_VALUE_KEY, msg.data, msg.size)) {
              Config.save();
            }
          }
          if (topic.equals(MQTT_TOPIC_FREQ)) {
            Config.setLbandFreqs(msg.data, msg.size);
            delete [] msg.data; // not injecting to queue to the GNSS, so we need to delete the buffer here
          } else {
            Gnss.inject(msg); // we do not have to delete msg.data here, this is done by receiving side of the queue 
          }
        } else { 
          log_e("topic \"%s\" with %d bytes failed reading after %d", topic.c_str(), messageSize, msg.size); 
          delete [] msg.data;
        }
      } else {
        log_e("topic \"%s\" with %d bytes failed, no memory", topic.c_str(), msg.size);
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
   *  \param ntrip  the server:port/mountpoint to connect
   *  \return       connection success
   */
  bool ntripConnect(String ntrip) {
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
      GNSS::MSG msg;
      msg.data = new uint8_t[messageSize];
      if (NULL != msg.data) {
        msg.size = ntripWifiClient.read(msg.data, messageSize);
        if (msg.size == messageSize) {
          msg.source = GNSS::SOURCE::WLAN;
          log_i("read %d bytes", messageSize);
          Gnss.inject(msg);
        } else {
          log_e("read %d bytes failed reading after %d", messageSize, msg.size); 
          delete [] msg.data;
        }
      } else {
        log_e("read %d bytes failed, no memory",  messageSize);
      }
    }
    long now = millis();
    if (ntripGgaMs - now <= 0) {
      ntripGgaMs = now + NTRIP_GGA_RATE;
      String gga = Config.getValue(CONFIG_VALUE_NTRIP_GGA);
      if (0 < gga.length()) {
        const char* strGga = gga.c_str();
        int wrote = ntripWifiClient.println(strGga);
        if (wrote != gga.length())
          log_i("println \"%s\" %d bytes", strGga, wrote);
        else
          log_e("println \"%s\" %d bytes, failed", strGga, wrote);
      }
    }
  }

  // -----------------------------------------------------------------------
  // LED
  // -----------------------------------------------------------------------

  //! some usefull LED pattern that allow you to incicate different states of the application. 
  typedef enum {
    // on / off
    LED_PATTERN_OFF     = 0x00000000,
    LED_PATTERN_ON      = 0xFFFFFFFF,
    // variable frequency
    LED_PATTERN_4s      = 0x0000FFFF,
    LED_PATTERN_2s      = 0x00FF00FF,
    LED_PATTERN_1s      = 0x0F0F0F0F,
    LED_PATTERN_1Hz     = LED_PATTERN_1s,
    LED_PATTERN_2Hz     = 0x33333333,
    LED_PATTERN_4Hz     = 0x55555555,
    // variable number pulses
    LED_PATTERN_1pulse  = 0x00000003,
    LED_PATTERN_2pulse  = 0x00000033,
    LED_PATTERN_3pulse  = 0x00000333,
    LED_PATTERN_4pulse  = 0x00003333,
    LED_PATTERN_5pulse  = 0x00033333,
    LED_PATTERN_6pulse  = 0x00333333,
    LED_PATTERN_7pulse  = 0x03333333,
    // special pattern
    LED_PATTERN_SOS     = 0x01599995,
  } LED_PATTERN; 
  
  static const int32_t LED_CYCLE_PERIOD = 4000;  //!< the default cycle time where the pattern repeats 
  
  LED_PATTERN ledPattern;   //!< the current selected LED pattern
  int32_t ledDelay;         //!< the current cycle time
  int32_t msNextLed;        //!< the time of last LED gpio change
  int ledBit;               //!< the current bit to process
  
  /* initialize the LED pins
   */
  void ledInit(void) {
    if (PIN_INVALID != LED) {
      pinMode(LED, OUTPUT);
      ledSet();
    }
  }
  
  /* FreeRTOS static task function, will just call the objects task function  
   * \param pvParameters the Wlan object (this)
   */
  static void ledTask(void * pvParameters) {
    ((WLAN*) pvParameters)->ledTask();
  }
  
  /** this task is flashing the led based on the selected pattern
   */
  void ledTask(void) {
    while (true) {
      int32_t now = millis();
      if (0 >= (msNextLed - (now << 5))) {
        msNextLed += ledDelay;
        ledBit = (ledBit + 1) % 32;
        digitalWrite(LED, ((ledPattern >> ledBit) & 1) ? HIGH : LOW);
      }
      vTaskDelay(50);
    }
  }

  /** set a new pattern for the led
   *  \param newPattern  the selected pattern sequence
   *  \param newDelay    the period until the pattern repeats
   */
  void ledSet(LED_PATTERN newPattern = LED_PATTERN_OFF, int32_t newDelay = LED_CYCLE_PERIOD) {
    msNextLed = (millis() << 5) + newDelay;
    if (PIN_INVALID != LED) {
      digitalWrite(LED, (newPattern & 1) ? HIGH : LOW);  
    }  
    ledPattern = newPattern;
    ledDelay = newDelay;
    ledBit = 0;    
  }

  // -----------------------------------------------------------------------
  // PIN
  // -----------------------------------------------------------------------
  
  int32_t ttagPinChange;  //!< time tag (millis()) of last pin change
  int lastPinLvl;         //!< last pin level
  
  /** init the pin function 
   */
  void pinInit(void) {
    ttagPinChange = ttagNextTry = millis();
    lastPinLvl = HIGH;
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
  typedef enum { 
    INIT = 0, 
    SEARCHING, 
    CONNECTED, 
    ONLINE, 
    MQTT, 
    NTRIP, 
    NUM 
  } STATE;
  //! string conversion helper table, must be aligned and match with STATE
  const struct { const char* name; LED_PATTERN pattern; } STATE_LUT[STATE::NUM] = { 
    { "init",           LED_PATTERN_OFF },
    { "searching",      LED_PATTERN_4Hz }, 
    { "connected",      LED_PATTERN_2Hz }, 
    { "online",         LED_PATTERN_1Hz },
    { "mqtt",           LED_PATTERN_2s  },
    { "ntrip",          LED_PATTERN_2s  }
  }; 
  STATE state;            //!< the current state
  int32_t ttagNextTry;    //!< time tag when to call the state machine again
  bool wasOnline;         //!< a flag indicating if we were online 
  
  /** advance the state and report transitions
   *  \param newState  the new state
   *  \param delay     schedule delay
   */
  void setState(STATE value, int32_t delay = 0) {
    if (state != value) {
      log_i("state change %d(%s)", value, STATE_LUT[value].name);
      ledSet(STATE_LUT[value].pattern);
      state = value;
    }
    ttagNextTry = millis() + delay; 
  }

  /* FreeRTOS static task function, will just call the objects task function  
   * \param pvParameters the Lte object (this)
   */
  static void task(void * pvParameters) {
    ((WLAN*) pvParameters)->task();
  }
  
  /** This task handling the whole WIFI state machine, here is where different activities are scheduled 
   *  and where the code decides what actions to perform.  
   */
  void task(void) {
    portalInit();  
    setState(SEARCHING);
    
    while(true) {
      // press a pin for a selected time to extern back into captive portal
      if (pinCheck() && (state > SEARCHING)) {
        portalReset();
        setState(SEARCHING);
      }
      manager.process();
      if (mqttClient.connected()) {
        mqttClient.poll();
      }
      int32_t now = millis();
      bool online  = WiFi.status() == WL_CONNECTED;
      if (!online && wasOnline) {
        log_w("lost connection");
        wasOnline = false;
        ttagNextTry = now;
      } else if (!wasOnline && online) {
        log_i("got connection");
        ttagNextTry = now;
      }
      wasOnline = online;
      Websocket.poll();
      if (0 >= (ttagNextTry - now)) {
        ttagNextTry = now + WLAN_1S_RETRY;
        String id     = Config.getValue(CONFIG_VALUE_CLIENTID);
        String ntrip  = Config.getValue(CONFIG_VALUE_NTRIP_SERVER);
        String useSrc = Config.getValue(CONFIG_VALUE_USESOURCE);
        bool useWlan  = (-1 != useSrc.indexOf("WLAN"));
        bool useNtrip = useWlan && useSrc.startsWith("NTRIP:");
        bool useMqtt  = useWlan && !useNtrip;
        switch (state) {
          case INIT:
            ttagNextTry = now + WLAN_INIT_RETRY;
            portalInit();  
            setState(SEARCHING);
            break;
          case SEARCHING:
            ttagNextTry = now + WLAN_RECONNECT_RETRY;
            if (online) {
              portalStart();
              setState(CONNECTED); // allow some time for dns to resolve. 
            }
            break;
          case CONNECTED:
            if (online) { 
              // test if we have access to the internet
              IPAddress ip;
              if (WiFi.hostByName(AWSTRUST_SERVER, ip)) {
                setState(ONLINE);
              }
            }
            break;
          case ONLINE:
            if (useMqtt) {
              if (0 == id.length()) {
                ttagNextTry = now + WLAN_PROVISION_RETRY;
                id = mqttProvision();
              }
              // we may now have a id if ZTP was sucessful
              if (0 < id.length()){
                ttagNextTry = now + WLAN_CONNECT_RETRY;
                if (mqttConnect(id)) {
                  setState(MQTT);
                }
              } 
            } else if (useNtrip) {
              if (0 < ntrip.length()) {
                ttagNextTry = now + WLAN_CONNECT_RETRY;
                if (ntripConnect(ntrip)) {
                  setState(NTRIP);
                }
              }
            }
            break;
          case MQTT:
            if (!useMqtt || (0 == id.length()) || !mqttClient.connected()) {
              mqttStop();
              setState(ONLINE);
            } else {
              mqttTask();
            }
            break;
          case NTRIP: 
            if (!useNtrip || (0 == ntrip.length()) || !ntripWifiClient.connected()) {
              ntripStop();
              setState(ONLINE);
            } else {
              ntripTask();
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
  function _l(_i){
    var _r = new FileReader();
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
        _e.name=_n;
        _e.value=_v;
      }
      if (_e && (null != _h)) _h ? _e.setAttribute('hidden','') : _e.removeAttribute('hidden')
    }
    _r.onload = function _d(){
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
    if (_i.files[0]) _r.readAsText(_i.files[0]);
  };
</script>
)html";

#endif // __WLAN_H__
