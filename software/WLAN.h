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

class ConfigWiFiManagerParameter : public WiFiManagerParameter {
public:
  // helper to set the parameter
  void setCustomHTML(const char* html) {
    _customHTML = html;
  }
};

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
  static const char PORTAL_HTML[];      //!< the additional HTML styles added to the header
  static const char PORTAL_PAGE[];      //!< the additional HTML js added to parameter page
  ConfigWiFiManagerParameter configHtml; 
  ConfigWiFiManagerParameter configParam; 
  String conigParams;
    
  /** initialize the portal and websocket 
   */
  void portalInit(void) {
    WiFi.mode(WIFI_STA);
    // consfigure and start wifi manager
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
      "update", 
      "exit" 
    };
    manager.setMenu(menu);
    manager.setCustomHeadElement(PORTAL_HTML);
    
    configHtml.setCustomHTML(PORTAL_PAGE);
    manager.addParameter( &configHtml );
    updateConfigParams();  
    manager.addParameter( &configParam );
    Websocket.setup(manager);
    manager.setWebServerCallback(std::bind(&WEBSOCKET::bind, &Websocket)); 
      
    log_i("autoconnect using wifi/hostname \"%s\"", nameStr);
    manager.autoConnect(nameStr);
  } 
  
  void updateConfigParams(void) {
    conigParams = "<script>var params = {" CONFIG_VALUE_HARDWAREID ":\"";
    conigParams += Config.getDeviceName();

    conigParams += "\"," CONFIG_VALUE_ZTPTOKEN ":\"";
    conigParams += Config.getValue(CONFIG_VALUE_ZTPTOKEN);
    conigParams += "\"," CONFIG_VALUE_CLIENTID ":\"";
    conigParams += Config.getValue(CONFIG_VALUE_CLIENTID);
    
    conigParams += "\"," CONFIG_VALUE_NTRIP_SERVER ":\"";
    conigParams += Config.getValue(CONFIG_VALUE_NTRIP_SERVER);
    conigParams += "\"," CONFIG_VALUE_NTRIP_USERNAME ":\"";
    conigParams += Config.getValue(CONFIG_VALUE_NTRIP_USERNAME);
    conigParams += "\"," CONFIG_VALUE_NTRIP_PASSWORD ":\"";
    conigParams += Config.getValue(CONFIG_VALUE_NTRIP_PASSWORD);
    conigParams += "\"," CONFIG_VALUE_NTRIP_VERSION ":\"";
    conigParams += Config.getValue(CONFIG_VALUE_NTRIP_VERSION);

    conigParams += "\"," CONFIG_VALUE_USESOURCE ":\"";
    conigParams += Config.getValue(CONFIG_VALUE_USESOURCE);

    conigParams += "\"," CONFIG_VALUE_MNOPROF ":\"";
    conigParams += Config.getValue(CONFIG_VALUE_MNOPROF);
    conigParams += "\"," CONFIG_VALUE_LTEAPN ":\"";
    conigParams += Config.getValue(CONFIG_VALUE_LTEAPN);
    conigParams += "\"," CONFIG_VALUE_SIMPIN ":\"";
    conigParams += Config.getValue(CONFIG_VALUE_SIMPIN);

    conigParams += "\"};</script>";
    configParam.setCustomHTML(conigParams.c_str());
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
      updateConfigParams();
      Config.wlanReconnect = true;
      Config.lteReconnect = true;
    }
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
  
  int32_t ntripGgaMs;                 //!< time tag (millis()) of next GGA to be sent
  HTTPClient ntripHttpClient;
    
  /** Connect to a NTRIP server
   *  \param url  the server:port/mountpoint to connect
   *  \return     connection success
   */
  bool ntripConnect(String url) {
    String user = Config.getValue(CONFIG_VALUE_NTRIP_USERNAME);
    String pwd = Config.getValue(CONFIG_VALUE_NTRIP_PASSWORD);
    String ver = Config.getValue(CONFIG_VALUE_NTRIP_VERSION);
    String gga = Config.getValue(CONFIG_VALUE_NTRIP_GGA);
    ntripHttpClient.begin(url);
    ntripHttpClient.useHTTP10(NTRIP_USE_HTTP10);
    ntripHttpClient.setAuthorization(user.c_str(), pwd.c_str());
    ntripHttpClient.setUserAgent(CONFIG_DEVICE_TITLE);
    if (0 < ver.length()) ntripHttpClient.addHeader(NTRIP_HEADER_VERSION, ver.c_str());
    if (0 < gga.length()) ntripHttpClient.addHeader(NTRIP_HEADER_GGA, gga.c_str());
    int httpCode = ntripHttpClient.GET();
    if (httpCode == HTTP_CODE_OK) {
      log_i("url \"%s\" user \"%s\" pwd \"%s\" ver \"%s\" connected", 
            url.c_str(), user.c_str(), pwd.c_str(), ver);
      ntripGgaMs = millis();
      return true;
    } else {
      String err = HTTPClient::errorToString(httpCode);
      log_e("url \"%s\" user \"%s\" pwd \"%s\" ver \"%s\" failed code %d(%s)", 
            url.c_str(), user.c_str(), pwd.c_str(), ver, httpCode, err.c_str());
      ntripHttpClient.end();
      return false;
    }
  }
  
  /** Stop and cleanup the NTRIP connection 
   */
  void ntripStop(void)
  {
    if (ntripHttpClient.connected()) {
      log_i("disconnect");
      ntripHttpClient.end();
    }
  } 
  
  /** The NTRIP task is responsible for:
   *  1) reading NTRIP data from the wifi and inject it into the GNSS receiver.
   *  2) sending a GGA from time to time to allow VRS services to adjust their correction stream 
   */
  void ntripTask(void)
  {
    Stream &stream = ntripHttpClient.getStream();
    int messageSize = stream.available();
    if (0 < messageSize) {
      GNSS::MSG msg;
      msg.data = new uint8_t[messageSize];
      if (NULL != msg.data) {
        msg.size = stream.readBytes(msg.data, messageSize);
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
    // send the GGA message
    long now = millis();
    if (ntripGgaMs - now <= 0) {
      String gga = Config.getValue(CONFIG_VALUE_NTRIP_GGA);
      int len = gga.length();
      if (0 < len) {
        int wrote = stream.print(gga + "\r\n");
        if (wrote == len + 2) {
          log_i("write \"%s\\r\\n\" %d bytes", gga.c_str(), wrote);
          ntripGgaMs = now + NTRIP_GGA_RATE;
        } else
          log_e("write \"%s\\r\\n\" %d bytes, failed", gga.c_str(), wrote);
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
        bool useMqtt  = useWlan && useSrc.startsWith("PointPerfect:");
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
            Config.wlanReconnect = false;
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
            if (!useMqtt || (0 == id.length()) || !mqttClient.connected() || Config.wlanReconnect) {
              mqttStop();
              setState(ONLINE, WLAN_1S_RETRY);
            } else {
              mqttTask();
            }
            break;
          case NTRIP: 
            if (!useNtrip || (0 == ntrip.length()) || !ntripHttpClient.connected() || Config.wlanReconnect) {
              ntripStop();
              setState(ONLINE, WLAN_1S_RETRY);
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

//! the additional HTML styles added to the header


const char WLAN::PORTAL_HTML[] = R"html(
<style>
  .wrap{max-width:800px;}
  a,a:hover{color:rgb(255,76,0);}
  button,.msg{border-radius:0;}
  input[type='file'],input,select{border-radius:0;border:2px solid #ccc;outline:none;}
  input[type='file']:focus,input:focus{border: 2px solid #555;}input[readonly]:focus{border: 2px solid #ccc;}
  button,input[type='button'],input[type='submit']{background-color:rgb(255,76,0);}
</style>
)html";

const char WLAN::PORTAL_PAGE[] = R"(
<p style="font-weight:Bold;">PointPerfect configuration</p>
<p>Don't have a device profile token or u-center-config.json? Visit the <a href="https://portal.thingstream.io/app/location-services" target="_blank">Thingstream Portal</a> to create one.</p>

<label for=")" CONFIG_VALUE_ZTPTOKEN R"(">Device profile token or load a
  <a href="#" onclick="document.getElementById('selectFile').click();">JSON</a> file</label>
<input id=")" CONFIG_VALUE_ZTPTOKEN R"(" name=")" CONFIG_VALUE_ZTPTOKEN R"(" maxLength="36" type="password" 
  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxxx" 
  pattern="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" />
<input id="selectFile" type="file" hidden accept=".json,.csv" onchange="_jsonLoad(this);" />

<label for=")" CONFIG_VALUE_HARDWAREID R"(">Hardware ID</label>
<input id=")" CONFIG_VALUE_HARDWAREID R"(" readonly />

<label for=")" CONFIG_VALUE_CLIENTID R"(">Client ID</label>
<input id=")" CONFIG_VALUE_CLIENTID R"(" name=")" CONFIG_VALUE_CLIENTID R"(" maxLength="36" readonly
  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxxx" />

<p style="font-weight:Bold;">NTRIP configuration</p>

<label for=")" CONFIG_VALUE_NTRIP_SERVER R"(">NTRIP server</label>
<input id=")" CONFIG_VALUE_NTRIP_SERVER R"(" name=")" CONFIG_VALUE_NTRIP_SERVER R"(" maxLength="64" 
  oninput="addMountpoints(this.value);" list="ntripMountpoints"  
  placeholder="http://hostname:2101/MountPoint" 
  pattern="^https?://([0-9a-zA-Z_\-]+\.)+[0-9a-zA-Z_\-]{2,}:[0-9]+\/[0-9a-zA-Z_\-]+$" />
<datalist id="ntripMountpoints"></datalist>

<label for=")" CONFIG_VALUE_NTRIP_USERNAME R"(">Username</label>
<input id=")" CONFIG_VALUE_NTRIP_USERNAME R"(" name=")" CONFIG_VALUE_NTRIP_USERNAME R"(" maxLength="64" />

<label for=")" CONFIG_VALUE_NTRIP_PASSWORD R"(">Password</label>
<input id=")" CONFIG_VALUE_NTRIP_PASSWORD R"(" name=")" CONFIG_VALUE_NTRIP_PASSWORD R"(" maxLength="64" type="password" />

<label for=")" CONFIG_VALUE_NTRIP_VERSION R"(">Ntrip version</label>
<select id=")" CONFIG_VALUE_NTRIP_VERSION R"(" name=")" CONFIG_VALUE_NTRIP_VERSION R"(" >
  <option value=")" NTRIP_VERSION_2 R"(">)" NTRIP_VERSION_2 R"(</option>
  <option value=")" NTRIP_VERSION_1 R"(">)" NTRIP_VERSION_1 R"(</option>
</select>

<p style="font-weight:Bold;">Correction source</p>
<label for=")" CONFIG_VALUE_USESOURCE R"(">Service type and interface</label>
<select id=")" CONFIG_VALUE_USESOURCE R"(" name=")" CONFIG_VALUE_USESOURCE R"(" >
  <option value="none">none</option>
  <option disabled>---- PointPerfect (MQTT) ----</option>
  <option value="PointPerfect: WLAN + LTE + LBAND">WLAN + LTE + LBAND</option>
  <option value="PointPerfect: WLAN + LBAND">WLAN + LBAND</option>
  <option value="PointPerfect: WLAN + LTE">WLAN + LTE</option>
  <option value="PointPerfect: WLAN">WLAN</option>
  <option value="PointPerfect: LTE + LBAND">LTE + LBAND</option>
  <option value="PointPerfect: LTE">LTE</option>
  <option value="PointPerfect: LBAND">LBAND</option>
  <option disabled>---- NTRIP ----</option>
  <option value="NTRIP: WLAN + LTE">WLAN + LTE</option>
  <option value="NTRIP: WLAN">WLAN</option>
  <option value="NTRIP: LTE">LTE</option>
</select>

)" /* LTE CONFIG : this must match with the enum mobile_network_operator_t */ R"(
<p style="font-weight:Bold;">LTE configuration</p>
<label for=")" CONFIG_VALUE_LTEAPN R"(">APN</label>
<input id=")" CONFIG_VALUE_LTEAPN R"(" name=")" CONFIG_VALUE_LTEAPN R"(" maxLength="64" />

<label for=")" CONFIG_VALUE_SIMPIN R"(">SIM pin </label>
<input id=")" CONFIG_VALUE_SIMPIN R"(" name=")" CONFIG_VALUE_SIMPIN R"(" maxLength="8" type="password" />

<label for=")" CONFIG_VALUE_MNOPROF R"(">MNO profile</label>
<select id=")" CONFIG_VALUE_MNOPROF R"(" name=")" CONFIG_VALUE_MNOPROF R"(" >
  <option value="1">SIM ICCID</option>
  <option value="90">Global</option>
  <option value="100">Standard Europe</option>
  <option value="101">Standard Europe No-ePCO</option>
  <option value="2">AT&amp;T</option>
  <option value="3">Verizon</option>
  <option value="5">T-Mobile US</option>
  <option value="32">US Cellular</option>
  <option value="4">Telstra</option>
  <option value="8">Sprint</option>
  <option value="19">Vodaphone</option>
  <option value="31">Deutsche Telekom</option>
  <option value="21">Telus</option>
  <option value="20">NTT Docomo</option>
  <option value="28">Softbank</option>
  <option value="39">SKT</option>
  <option value="6">China Telecom</option>
  <option value="0">Undefined / regulatory</option>
</select>
  
<script>
  function addMountpoints(url) {
    let m = url.match(/^(https?:\/\/)?(([0-9a-zA-Z_\-]+\.)+[0-9a-zA-Z_\-]{2,})(:[0-9]+)?(\/[0-9a-zA-Z_\-]*)?$/);
    if(m[2]) {
      if (!m[4]) m[4] = ':2101';
      if (!m[1]) {
        ntripSourceTable('http://'  + m[2] + m[4]);
        ntripSourceTable('https://' + m[2] + m[4]);
      } else {
        ntripSourceTable(m[1] + m[2] + m[4]);
      }
    }
    function ntripSourceTable(url) {
      try {
        const xhr = new XMLHttpRequest();
        const usr = _getById(')" CONFIG_VALUE_NTRIP_USERNAME R"(');
        const pwd = _getById(')" CONFIG_VALUE_NTRIP_PASSWORD R"(');
        xhr.open('GET', url, true, usr, pwd);
        xhr.timeout = 5000;
        xhr.setRequestHeader(')" NTRIP_HEADER_VERSION R"(', ')" NTRIP_VERSION_2 R"(');
        xhr.onreadystatechange = _onReadyState;
        xhr.send();
        function _getById(id) { 
          let el = document.getElementById(id);
          return (el && el.value && (el.value != "")) ? el.value : null; 
        } 
        function _onReadyState(data) {
          if (this.readyState == XMLHttpRequest.DONE) {
            const tbl = this.response.split('\r\n').map( c => c.split(';') );
            const lst = document.getElementById('ntripMountpoints');
            tbl.forEach(_insertMountpoint);
            function _insertMountpoint(mp) {
              if ((mp[0] == "STR") && mp[1]) {
                const val = url + "/" + mp[1];
                let found = false;
                for (let i = 0; i < lst.options.length && !found; i++) {
                  found = (lst.options[i].value == val)
                }
                if (!found) {
                  const el = document.createElement('OPTION');
                  el.value = val;
                  lst.appendChild(el);
                }
              }
            }
          }
        }
      } catch (e) { 
        // nothing
      }
    }
  }
  function _jsonLoad(lst){
    const rd = new FileReader();
    rd.onload = function _fileOnLoad(){
      try {
        const j = JSON.parse(rd.result);
        let c = j.MQTT.Connectivity;
        _addInput('clientId',c.ClientID, false);
        _addInput('brokerHost',c.ServerURI.match(/\s*:\/\/(.*):\d+/)[1], true);
        _addInput('stream',j.MQTT.Subscriptions.Key.KeyTopics[0].match(/.{2}$/)[0], true);
        c = c.ClientCredentials;
        _addInput('clientKey',c.Key,true);
        _addInput('clientCert',c.Cert,true);
        _addInput('rootCa',c.RootCA,true);
        _addInput('ztpToken','');
        lst.value = '';
        function _addInput(id,val,hide){
          var el = document.getElementById(id);
          if (!el) {
            el = document.createElement('INPUT');
            if (el) {
              el.id = id;
              lst.insertAdjacentElement('afterend', el);
            }
          }
          if (el) {
            el.name = id;
            el.value = val;
          }
          if (el && (null != hide)) hide ? el.setAttribute('hidden','') : el.removeAttribute('hidden')
        }
      } catch(e) { alert('bad json content'); }
    };
    if (lst.files[0]) rd.readAsText(lst.files[0]);
  };
  window.onload = function _winOnLoad() {
    // initialize the input fields from. params
    if (params) {
      for (const [id, val] of Object.entries(params)) {
        const el = document.getElementById(id);
        if (el) {
          if (el.tagName === 'INPUT') {
              el.value = val;
          } else if (el.tagName === 'SELECT') {
            for (const opt of el.options) {
              opt.selected = (opt.value === val);
            }
          }
        } else { alert('cant set ' + id + ' ' + val); }
      }
    }
    const el = document.getElementById(')" CONFIG_VALUE_NTRIP_SERVER R"(');
    if (el) addMountpoints(el.value);
    addMountpoints('ppntrip.services.u-blox.com');
  }
</script>
)";

#endif // __WLAN_H__
