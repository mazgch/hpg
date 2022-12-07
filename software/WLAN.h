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

#include<base64.h>

#include "LOG.h"
#include "HW.h"
#include "CONFIG.h"
#include "WEBSOCKET.h"
#include "GNSS.h"

extern class WLAN Wlan;

#define WLAN_RESETPORTAL_TIME     10000       // Hold Boot pin down for this time to restart AP and captive portal 

const int WIFI_INIT_RETRY       = 60000;
const int WIFI_RECONNECT_RETRY  = 60000;
const int WIFI_CONNECT_RETRY    = 10000;
const int WIFI_PROVISION_RETRY  = 10000;
const int WIFI_1S_RETRY         =  1000;

const int WIFI_NTRIP_RETRY      = 60000;
const int WIFI_NTRIP_GGARATE    = 20000;

const int WLAN_STACK_SIZE       = 7*1024;      //!< Stack size of WLAN task
const int WLAN_TASK_PRIO        = 1;
const int WLAN_TASK_CORE        = 0;

const int LED_STACK_SIZE        =   1024;      //!< Stack size of LED task
const int LED_TASK_PRIO         = 2;
const int LED_TASK_CORE         = 1;

#define HERO_COLOR              "rgb(255, 76, 0)"
                
class WLAN {
public:
  WLAN() : mqttClient(wifiClient) {
    memset(parameters, 0, sizeof(parameters));
    state = INIT;
    wasOnline = false;
    ttagPinChange = ttagNextTry = millis();
    lastPinLvl = HIGH;
    if (PIN_INVALID != LED) {
      pinMode(LED, OUTPUT);
      setLedPattern();
    }
  }

  void init(void) {
    xTaskCreatePinnedToCore(task,    "Wlan", WLAN_STACK_SIZE, this, WLAN_TASK_PRIO, NULL, WLAN_TASK_CORE);
    xTaskCreatePinnedToCore(taskLed, "Led",  LED_STACK_SIZE,  this, LED_TASK_PRIO,  NULL, LED_TASK_CORE);
  }
  
  void _init(void) {
    WiFi.mode(WIFI_STA);
    // configure the MQTT client
    mqttClient.onMessage(mqttMessageHandler);
    mqttClient.setKeepAliveInterval(60 * 1000);
    mqttClient.setConnectionTimeout( 5 * 1000);
    // consfigure and start wifi manager
    int p = 0;
    String name = Config.getDeviceName();
    const char* nameStr = name.c_str();
    //manager.resetSettings();
    manager.setDebugOutput(false, "WLAN MGR");
    manager.setAPCallback(apCallback);
    manager.setWebServerCallback(std::bind(&WLAN::bindCallback, this)); 
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
#ifdef __WEBSOCKET__H__
      "custom", 
#endif
      "param", 
      "wifi", 
      "info", 
      "sep", 
      "restart", 
      "exit" 
    };
    manager.setMenu(menu);
    manager.setCustomHeadElement("\
<style>\
  .wrap{max-width:800px;}\
  a,a:hover{color:" HERO_COLOR ";}\
  button,.msg{border-radius:0;}\
  input[type='file'],input,select{border-radius:0;border:2px solid #ccc;outline:none;}\
  input[type='file']:focus,input:focus{border: 2px solid #555;}input[readonly]:focus{border: 2px solid #ccc;}\
  button,input[type='button'],input[type='submit']{background-color:" HERO_COLOR ";}\
</style>\
<script>\
  function _l(_i){\
    var _r = new FileReader();\
    function _s(_n,_v,_h){ \
      var _e=document.getElementById(_n);\
      if (!_e) {\
        _e=document.createElement('input');\
        if (_e) {\
          _e.id=_n;\
          _i.appendChild(_e);\
        }\
      }\
      if (_e) {\
        _e.name=_n;\
        _e.value=_v;\
      }\
      if (_e && (null != _h)) _h ? _e.setAttribute('hidden','') : _e.removeAttribute('hidden')\
    }\
    _r.onload = function _d(){\
      try {\
        var _j = JSON.parse(_r.result);\
        var _c = _j.MQTT.Connectivity;\
        var _o = { };\
        _s('clientId', _c.ClientID);\
        _s('brokerHost', _c.ServerURI.match(/\\s*:\\/\\/(.*):\\d+/)[1]);\
        _c = _c.ClientCredentials;\
        _s('clientKey', _c.Key, true);\
        _s('clientCert', _c.Cert, true);\
        _s('rootCa', _c.RootCA, true);\
        _s('stream', _j.MQTT.Subscriptions.Key.KeyTopics[0].match(/.{2}$/)[0]);\
        _s('ztpToken', '');\
        _i.value = '';\
      } catch(e) { alert('bad json content'); }\
    };\
    if (_i.files[0]) _r.readAsText(_i.files[0]);\
  };\
</script>\
");
    new (&parameters[p++]) WiFiManagerParameter("<p style=\"font-weight:Bold;\">PointPerfect configuration</p>"
            "<p>Don't have a device profile or u-center-config.json? Visit the <a href=\"https://portal.thingstream.io/app/location-services\">Thingstream Portal</a> to create one.</p>");
    new (&parameters[p++]) WiFiManagerParameter(CONFIG_VALUE_ZTPTOKEN, "<a href=\"#\" onclick=\"document.getElementById('file').click();\">Load JSON</a> file or enter a Device Profile Token.<input hidden accept=\".json,.csv\" type=\"file\" id=\"file\" onchange=\"_l(this);\"/>", 
            Config.getValue(CONFIG_VALUE_ZTPTOKEN).c_str(), 36, " type=\"password\" pattern=\"[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}\"");
    updateManagerParameters();
    new (&parameters[p++]) WiFiManagerParameter(bufParam);
    new (&parameters[p++]) WiFiManagerParameter(CONFIG_VALUE_LTEAPN, "APN", Config.getValue(CONFIG_VALUE_LTEAPN).c_str(), 64);
    new (&parameters[p++]) WiFiManagerParameter(CONFIG_VALUE_SIMPIN, "SIM pin", Config.getValue(CONFIG_VALUE_SIMPIN).c_str(), 8, " type=\"password\"");
    new (&parameters[p++]) WiFiManagerParameter("<p style=\"font-weight:Bold;\">NTRIP configuration</p>"
             "<p>To use NTRIP you need to set Correction source to none.</p>");
    new (&parameters[p++]) WiFiManagerParameter(CONFIG_VALUE_NTRIP_SERVER, "Server:Port", Config.getValue(CONFIG_VALUE_NTRIP_SERVER).c_str(), 64);
    new (&parameters[p++]) WiFiManagerParameter(CONFIG_VALUE_NTRIP_MOUNTPT, "Mount point", Config.getValue(CONFIG_VALUE_NTRIP_MOUNTPT).c_str(), 64);  
    new (&parameters[p++]) WiFiManagerParameter(CONFIG_VALUE_NTRIP_USERNAME, "Username", Config.getValue(CONFIG_VALUE_NTRIP_USERNAME).c_str(), 64);
    new (&parameters[p++]) WiFiManagerParameter(CONFIG_VALUE_NTRIP_PASSWORD, "Password", Config.getValue(CONFIG_VALUE_NTRIP_PASSWORD).c_str(), 64, " type=\"password\"");
    for (int i = 0; i < p; i ++) {
      manager.addParameter(&parameters[i]);
    }
#ifdef __WEBSOCKET__H__
    Websocket.setup(manager);
#endif    
      
    Log.info("WLAN init autoconnect using wifi/hostname \"%s\"", nameStr);
    manager.autoConnect(nameStr);  
    setState(SEARCHING);
  }

  void _poll(void) {
    HW_DBG_HI(HW_DBG_WLAN);
    // press a pin for a selected time to extern back into captive portal
    if (PIN_INVALID != BOOT) {
      int level = digitalRead(BOOT);
      long now = millis();
      if (lastPinLvl != level) {
        ttagPinChange = now;
        lastPinLvl  = level;
      } else if ((level == LOW) && ((now - ttagPinChange) > WLAN_RESETPORTAL_TIME)) {
        if  (state > SEARCHING) {
          Log.info("WLAN poll disconnect and reset settings");
          manager.disconnect();
          manager.resetSettings();
          mqttStop();
          setState(SEARCHING);
        }
      }
    }
    
    HW_DBG_HI(HW_DBG_WLAN_MGR);
    manager.process();
    HW_DBG_LO(HW_DBG_WLAN_MGR);
    
    if (mqttClient.connected()) {
      mqttClient.poll();
    }
    
    long now = millis();
    bool online = WiFi.status() == WL_CONNECTED;
    if (!online && wasOnline) {
      Log.warning("WLAN poll lost connection");
      wasOnline = false;
      ttagNextTry = now;
    } else if (!wasOnline && online) {
      Log.info("WLAN poll got connection");
      ttagNextTry = now;
    }
    wasOnline = online;

#ifdef __WEBSOCKET__H__
    Websocket.poll();
#endif
 
    if (ttagNextTry <= now) {
      bool online = WiFi.status() == WL_CONNECTED;
      String id = Config.getValue(CONFIG_VALUE_CLIENTID);
      String ntrip = Config.getValue(CONFIG_VALUE_NTRIP_SERVER);
      String useSrc = Config.getValue(CONFIG_VALUE_USESOURCE);
      bool useWlan = (-1 != useSrc.indexOf("WLAN"));
      bool useNtrip = (-1 != useSrc.indexOf("none")); // we can use nTrip on WLAN
      switch (state) {
        case INIT:
          ttagNextTry = now + WIFI_INIT_RETRY;
          _init();
          break;
        case SEARCHING:
          ttagNextTry = now + WIFI_RECONNECT_RETRY;
          if (online) {
            String hostname = WiFi.getHostname();
            String ip = WiFi.localIP().toString();
            int rssi = WiFi.RSSI();
            Log.info("WLAN poll connected with hostname \"%s\" at IP %s RSSI %d dBm", hostname.c_str(), ip.c_str(), rssi);
            Log.info("WLAN poll visit portal at \"http://%s/\" or \"http://%s/\"", ip.c_str(), hostname.c_str());
            manager.startWebPortal();
            setState(CONNECTED); // allow some time for dns to resolve. 
          }
          break;
        case CONNECTED:
          ttagNextTry = now + WIFI_1S_RETRY;
          if (online) 
          { 
            IPAddress ip;
            if (WiFi.hostByName(AWSTRUST_SERVER, ip)) {
              setState(ONLINE);
            }
          }
          break;
        case ONLINE:
          ttagNextTry = now + WIFI_1S_RETRY;
          if (useNtrip) {
            if (ntrip.length()) {
              setState(NTRIP);
            } 
          } else if (id.length()) {
            setState(PROVISIONED);
          } else {
            ttagNextTry = now + WIFI_PROVISION_RETRY;
            String ztpReq = Config.ztpRequest();
            if (ztpReq.length()) {
              // Fetch the AWS Root CA
              HTTPClient http;
              http.begin(AWSTRUST_ROOTCAURL);
              Log.info("WLAN HTTP get to \"%s\"", AWSTRUST_ROOTCAURL);
              int httpResponseCode = http.GET();
              String rootCa = http.getString();
              http.end();
              if (httpResponseCode != 200) {
                Log.error("WLAN HTTP AWS response error %d %s", httpResponseCode, rootCa.c_str());
              } else {
                Log.debug("WLAN HTTP AWS response %s", rootCa.c_str());
                
                // Perform PointPerfect ZTP 
                wifiClient.setCACert(rootCa.c_str());
                http.begin(THINGSTREAM_ZTPURL);
                http.addHeader(F("Content-Type"), F("application/json"));
                Log.info("WLAN HTTP ZTP connect to \"%s\" and post \"%s\"", THINGSTREAM_ZTPURL, ztpReq.c_str());
                int httpResponseCode = http.POST(ztpReq.c_str());
                String ztp = http.getString();
                http.end();
                if (httpResponseCode != 200) {
                  Log.error("WLAN HTTP ZTP response error %d %s", httpResponseCode, ztp.c_str());
                } else {
                  Log.debug("WLAN HTTP ZTP response %s", ztp.c_str());
                  id = Config.setZtp(ztp, rootCa); 
                  if (id.length()) {
                    setState(PROVISIONED);
                  }
                }
              }
            }
          }
          break;
        case PROVISIONED:
          ttagNextTry = now + WIFI_CONNECT_RETRY;
          if (!id.length() || useNtrip) {
            setState(ONLINE);
          } else {
            if (useWlan) {
              String broker = Config.getValue(CONFIG_VALUE_BROKERHOST);
              String rootCa = Config.getValue(CONFIG_VALUE_ROOTCA);
              String cert = Config.getValue(CONFIG_VALUE_CLIENTCERT);
              String key = Config.getValue(CONFIG_VALUE_CLIENTKEY);
              wifiClient.setCACert(rootCa.c_str());
              wifiClient.setCertificate(cert.c_str());
              wifiClient.setPrivateKey(key.c_str());
              const char* idStr = id.c_str();
              const char* brokerStr = broker.c_str();
              mqttClient.setId(idStr);
              if (mqttClient.connect(brokerStr, MQTT_BROKER_PORT)) {
                Log.info("WLAN MQTT connect to \"%s\":%d as client \"%s\"", brokerStr, MQTT_BROKER_PORT, idStr);
                setState(MQTT_CONNECTED);
              } else {
                int err = mqttClient.connectError(); 
                const char* LUT[] = { "REFUSED", "TIMEOUT", "OK", "PROT VER", "ID BAD", "SRV NA", "BAD USER/PWD", "NOT AUTH" };
                Log.error("WLAN MQTT connect to \"%s\":%d as client \"%s\" failed with error %d(%s)",
                          brokerStr, MQTT_BROKER_PORT, idStr, err, LUT[err + 2]);
              }
            }
          }
          break;
        case STATE::MQTT_CONNECTED:
          {
            ttagNextTry = now + WIFI_1S_RETRY;
            if (!id.length() /*|| !mqttCon */ || !useWlan || useNtrip) {
              mqttStop();
              setState(ONLINE);
            } else {
              std::vector<String> newTopics = Config.getTopics();
              // filter out the common ones that need no change 
              for (auto rit = topics.rbegin(); rit != topics.rend(); rit = std::next(rit)) {
                String topic = *rit;
                std::vector<String>::iterator pos = std::find(newTopics.begin(), newTopics.end(), topic);
                if (pos != topics.end()) {
                  newTopics.erase(pos);
                } else {
                  Log.info("WLAN MQTT unsubscribe \"%s\"", topic.c_str());
                  if (mqttClient.unsubscribe(topic)) {
                    topics.erase(std::next(rit).base());
                  }
                }
              }
              for(int n = 0; n < newTopics.size(); n ++) {
                String topic = newTopics[n];
                Log.info("WLAN MQTT subscribe \"%s\"", topic.c_str());
                if (mqttClient.subscribe(topic)) {
                  topics.push_back(topic);
                }
              } 
            }
            //Log.info("WLAN stack free %d total %d\n", uxTaskGetStackHighWaterMark(0), WLAN_STACK_SIZE);
          }
          break;
        case NTRIP: 
          if (!useNtrip || !ntrip.length()) {
            setState(ONLINE);
          } else {
            ttagNextTry = now + WIFI_NTRIP_RETRY;
            int pos = ntrip.indexOf(':');
            String server = (-1 == pos) ? ntrip : ntrip.substring(0,pos);
            uint16_t port = (-1 == pos) ? NTRIP_SERVER_PORT : ntrip.substring(pos+1).toInt();
            Log.info("WLAN NTRIP connecting to \"%s:%d\"", server.c_str(), port);
            int ok = ntripWifiClient.connect(server.c_str(), port);
            if (!ok) {
              Log.error("WLAN NTRIP connect to \"%s:%d\" failed with error", server.c_str(), port);
            } else {
              Log.info("WLAN NTRIP connected to \"%s:%d", server.c_str(), port);
              String mntpnt = Config.getValue(CONFIG_VALUE_NTRIP_MOUNTPT);
              String user = Config.getValue(CONFIG_VALUE_NTRIP_USERNAME);
              String pwd = Config.getValue(CONFIG_VALUE_NTRIP_PASSWORD);
              String authEnc;
              String authHead;
              if (0 < user.length() && 0 < pwd.length()) {
                authEnc = base64::encode(user + ":" + pwd);
                authHead = "Authorization: Basic ";
                authHead += authEnc + "\r\n";
              }                    
              const char* expectedReply;
              unsigned long timeout;
              if (0 == mntpnt.length()) {
                timeout = 5000;
                expectedReply = "SOURCETABLE 200 OK\r\n";
              } else {
                timeout = 20000;
                expectedReply = "ICY 200 OK\r\n";
              }
              Log.info("WLAN NTRIP GET \"/%s\" auth \"%s\"", mntpnt.c_str(), authEnc.c_str());
              ntripWifiClient.printf("GET /%s HTTP/1.0\r\n"
                        "User-Agent: " CONFIG_DEVICE_TITLE "\r\n"
                        "%s\r\n", mntpnt.c_str(), authHead.c_str());
              int len = 0;
              unsigned long start = millis();
              while (ntripWifiClient.connected() && ((millis() - start) < timeout) && (expectedReply[len] != 0) && ok) {
                if (ntripWifiClient.available()) {
                  char ch = ntripWifiClient.read();
                  ok = (expectedReply[len] == ch) && ok;
                  if (!ok) Log.warning("WLAN NTRIP %d got '%c' %02X != '%c'", len, ch, ch, expectedReply[len]);
                  len ++;
                } else { 
                  delay(0);
                }
              }
              ok = (expectedReply[len] == 0) && ok;
              if (ok) { 
                Log.info("WLAN NTRIP got expected reply \"%.*s\\r\\n\"", len-2, expectedReply);
                ntripGgaMs = now;
                setState(NTRIP_CONNECTED);
              }
              else {
                int lenReply = strlen(expectedReply);
                Log.error("WLAN NTRIP expected reply \"%.*s\\r\\n\" failed after %d bytes and %d ms", lenReply-2, expectedReply, len, millis() - start);
                ntripWifiClient.stop();
              }
            } 
          }  
          break;
        case NTRIP_CONNECTED: 
          if (!useNtrip || !ntrip.length() || !ntripWifiClient.connected()) {
            ntripWifiClient.stop();
            setState(ONLINE);
          } else {
            ttagNextTry = now + WIFI_1S_RETRY;
            int len = 0;
            int total = 0;
            uint8_t buf[512];
            while (ntripWifiClient.available()) {
              uint8_t ch = ntripWifiClient.read();
              buf[len++] = ch;
              if (len == sizeof(buf)) {
                total += len;
                Gnss.inject(buf, len, GNSS::SOURCE::WLAN);
                len = 0;
              }  
            }
            if(0 < len) {
              total += len;
              Gnss.inject(buf, len, GNSS::SOURCE::WLAN);
            }
            if (0 < total) {
              Log.info("WLAN NTRIP got %d bytes", len);
            }
            if (ntripGgaMs - now <= 0) {
              ntripGgaMs = now + WIFI_NTRIP_GGARATE;
              String gga = Config.getValue(CONFIG_VALUE_NTRIP_GGA);
              if (0 < gga.length()) {
                const char* strGga = gga.c_str();
                int wrote = ntripWifiClient.println(strGga);
                if (wrote != gga.length())
                  Log.info("WLAN NTRIP println \"%s\" %d bytes", strGga, wrote);
                else
                  Log.error("WLAN NTRIP println \"%s\" %d bytes, failed", strGga, wrote);
              }
            }
          }
          break;
        default:
          break;
      }
    }
    HW_DBG_LO(HW_DBG_WLAN);
  }
  
protected:
  static void task(void * pvParameters) {
    ((WLAN*) pvParameters)->task();
  }
  void task(void) {
    _init();
    while(true) {
      _poll();
      vTaskDelay(50);
    }
  }
  
  void bindCallback(void) {
    Log.debug("WLAN bind server");
#ifdef __WEBSOCKET__H__
    Websocket.bind();
#endif
  }
  
  static void apCallback(WiFiManager *pManager) {
    String ip = WiFi.softAPIP().toString();
    
    Log.info("WLAN apCallback config portal started with IP %s", ip.c_str());
  }

  void saveConfigCallback() {
    Log.info("WLAN saveConfigCallback settings changed and connection sucessful");
  }

  void saveParamCallback() {
    int args = Wlan.manager.server->args();
    bool save = false;
    bool reconnect = false;
    for (uint8_t i = 0; i < args; i++) {
      String param = Wlan.manager.server->argName(i);
      String value = Wlan.manager.server->arg(param);
      Log.debug("WIFI saveParamCallback \"%s\" \"%s\"", param.c_str(), value.c_str());
      if (param.equals(CONFIG_VALUE_ROOTCA) || param.equals(CONFIG_VALUE_CLIENTCERT) || param.equals(CONFIG_VALUE_CLIENTKEY)) {
        String tag = param.equals(CONFIG_VALUE_CLIENTKEY) ? "RSA PRIVATE KEY" : "CERTIFICATE";
        String out = "-----BEGIN " + tag + "-----\n";
        while (value.length()) {
          out += value.substring(0,64) + "\n";
          value = value.substring(64);
        }
        out += "-----END " + tag + "-----\n";
        value = out;
        reconnect = true;
      }
      bool changed = Config.setValue(param.c_str(), value);
      if (changed) {
        save = true;
        if (param.equals(CONFIG_VALUE_ZTPTOKEN) && (value.length()>0)) {
          reconnect = true;
          Config.delZtp();      
        }
      }
    }
    if (save) {
      Config.save();
      Wlan.updateManagerParameters();
    }
    if (reconnect) {
      Log.info("WIFI saveParamCallback reconnect MQTT/ZTP due to setting change");
      if (Wlan.state > SEARCHING) { 
        Wlan.mqttStop();
        Wlan.setState(SEARCHING);
      }
      /* Need to reset LTE here / rely on user to reset device
      if (Lte.connected) {
        Lte.disconnectMQTT();
      }*/
    }
  }

  void updateManagerParameters(void) {
    String name = Config.getDeviceName();
    int len = sprintf(bufParam, "<label>Hardware Id</label><br><input maxlength=\"20\" value=\"%s\" readonly>", name.c_str());
    String clientId = Config.getValue(CONFIG_VALUE_CLIENTID);
    len += sprintf(&bufParam[len], "<label for=\"%s\">Client Id</label><br>"
                                     "<input id=\"%s\" value=\"%s\" readonly>", 
                                      CONFIG_VALUE_CLIENTID, CONFIG_VALUE_CLIENTID, clientId.c_str());
    len += sprintf(&bufParam[len], //"<p style=\"font-weight:Bold;\">GNSS configuration</p>"
                                   "<label for=\"%s\">Correction source</label><br>"
                                   "<select id=\"%s\" name=\"%s\">", CONFIG_VALUE_USESOURCE, CONFIG_VALUE_USESOURCE, CONFIG_VALUE_USESOURCE);
    String selected = Config.getValue(CONFIG_VALUE_USESOURCE); 
    const char *optSource[] = { "WLAN + LTE + LBAND", "WLAN + LBAND", "LTE + LBAND", "WLAN", "LTE", "LBAND", "none" };
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

  static void mqttMessageHandler(int messageSize) {
    if (messageSize) {
      String topic = Wlan.mqttClient.messageTopic();
      GNSS::MSG msg;
      msg.data = new uint8_t[messageSize];
      if (NULL != msg.data) {
        msg.size = Wlan.mqttClient.read(msg.data, messageSize);
        if (msg.size == messageSize) {
          msg.source = GNSS::SOURCE::WLAN;
          Log.info("WLAN MQTT topic \"%s\" with %d bytes", topic.c_str(), msg.size); 
          if (topic.startsWith(MQTT_TOPIC_KEY_FORMAT)) {
            msg.source = GNSS::SOURCE::OTHER; // inject key as other
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
          Log.error("WLAN MQTT topic \"%s\" with %d bytes failed reading after %d", topic.c_str(), messageSize, msg.size); 
          delete [] msg.data;
        }
      } else {
        Log.error("WLAN MQTT topic \"%s\" with %d bytes failed, no memory", topic.c_str(), msg.size);
      }
    }
  }

  void mqttStop(void) {
    for (auto it = topics.begin(); it != topics.end(); it = std::next(it)) {
      String topic = *it;
      Log.info("WLAN MQTT unsubscribe \"%s\"", topic.c_str());
      mqttClient.unsubscribe(topic);
    }
    topics.clear();
    if (mqttClient.connected()) {
      Log.info("WLAN MQTT disconnect");
      mqttClient.stop();
    }
  }

  typedef enum {
    // on / off
    LED_PATTERN_OFF = 0x00000000,
    LED_PATTERN_ON  = 0xFFFFFFFF,
    // variable frequency
    LED_PATTERN_4s  = 0x0000FFFF,
    LED_PATTERN_2s  = 0x00FF00FF,
    LED_PATTERN_1s  = 0x0F0F0F0F,
    LED_PATTERN_1Hz = LED_PATTERN_1s,
    LED_PATTERN_2Hz = 0x33333333,
    LED_PATTERN_4Hz = 0x55555555,
    // variable number pulses
    LED_PATTERN_1pulse = 0x00000003,
    LED_PATTERN_2pulse = 0x00000033,
    LED_PATTERN_3pulse = 0x00000333,
    LED_PATTERN_4pulse = 0x00003333,
    LED_PATTERN_5pulse = 0x00033333,
    LED_PATTERN_6pulse = 0x00333333,
    LED_PATTERN_7pulse = 0x03333333,
    // special pattern
    LED_PATTERN_SOS = 0x01599995,
  } LED_PATTERN; 

  static void taskLed(void * pvParameters) {
    ((WLAN*) pvParameters)->taskLed();
  }
  
  void taskLed(void) {
    while (true) {
      long now = millis();
      if ((msNextLed - (now << 5)) <= 0) {
        msNextLed += ledDelay;
        ledBit = (ledBit + 1) % 32;
        digitalWrite(LED, ((ledPattern >> ledBit) & 1) ? HIGH : LOW);
      }
      vTaskDelay(50);
    }
  }

  void setLedPattern(LED_PATTERN newPattern = LED_PATTERN_OFF, int newDelay = 4000) {
    msNextLed = (millis() << 5) + newDelay;
    if (PIN_INVALID != LED) {
      digitalWrite(LED, (newPattern & 1) ? HIGH : LOW);  
    }  
    ledPattern = newPattern;
    ledDelay = newDelay;
    ledBit = 0;    
  }
  typedef enum { INIT = 0, SEARCHING, CONNECTED, ONLINE, PROVISIONED, MQTT_CONNECTED, NTRIP, NTRIP_CONNECTED, NUM_STATE } STATE;
  typedef const struct { const char* name; LED_PATTERN pattern; } STATE_LUT_TYPE; 
  static STATE_LUT_TYPE STATE_LUT[NUM_STATE];
  void setState(STATE value, long delay = 0) {
    if (state != value) {
      Log.info("WIFI state change %d(%s)", value, STATE_LUT[value].name);
      setLedPattern(STATE_LUT[value].pattern);
      state = value;
    }
    ttagNextTry = millis() + delay; 
  }
  STATE state;
  bool wasOnline;
  long ttagNextTry;
  long ttagPinChange;
  int lastPinLvl;
  int ledBit;
  LED_PATTERN ledPattern;
  int ledDelay;
  int msNextLed;
  
  WiFiManager manager;
  WiFiManagerParameter parameters[10];
  char bufParam[512*4];

  WiFiClientSecure wifiClient;
  MqttClient mqttClient;
  std::vector<String> topics;
  
  WiFiClient ntripWifiClient;
  long ntripGgaMs;
};

WLAN::STATE_LUT_TYPE WLAN::STATE_LUT[NUM_STATE] = { 
  { "init",           LED_PATTERN_OFF },
  { "searching",      LED_PATTERN_4Hz }, 
  { "connected",      LED_PATTERN_2Hz }, 
  { "online",         LED_PATTERN_2Hz },
  { "provisioned",    LED_PATTERN_1Hz },
  { "mqtt connected", LED_PATTERN_2s  },
  { "ntrip",          LED_PATTERN_1Hz },
  { "ntrip connected",LED_PATTERN_2s  }
}; 

WLAN Wlan;

#endif // __WLAN_H__
