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
 
#ifndef __CONFIG_H__
#define __CONFIG_H__

#include <SPIFFS.h>
#include <vector>
#include <mbedtls/base64.h>
#include <ArduinoJson.h>
#include <Preferences.h>

#include "HW.h"

/** this table defines the recional coverage (by a bounding box and its region tag and frequency
 *  the lower the higher the priority and more targeted the lat/lon region should be
 */
const struct { const char* region; short lon1; short lon2; short lat1; short lat2; } POINTPERFECT_REGIONS[] = {
  // Continental
  { "us", -170, -50,   20, 75 }, // Continental US + Canada
  { "eu",  -30,  40,   35, 75 }, // Europe
  // Regional / Test 
  { "cn",   75,  135,  15, 60 }, // China
  { "au",  111,  160, -43, -9 }, // Australia
  { "jp",  128,  147,  30, 47 }, // Japan
  { "kr",  126,  130,  34, 39 }, // Korea
  { "sa",   34,   56,  15, 33 }  // Saudi Arabia
};

// -----------------------------------------------------------------------
// MQTT / PointPerfect settings 
// -----------------------------------------------------------------------

// settings for ZTP request that use HTTPS protocol  
#define    THINGSTREAM_SERVER     "api.thingstream.io"            //!< the thingstream Rest API server domain        
#define    THINGSTREAM_ZTPPATH    "/ztp/pointperfect/credentials" //!< ZTP rest api
const char THINGSTREAM_ZTPURL[]   = "https://" THINGSTREAM_SERVER THINGSTREAM_ZTPPATH; // full ZTP url

// settings for Amazon root CA request (not really needed, as long as we dont verify the certificates)  
#define    AWSTRUST_SERVER        "www.amazontrust.com"             //!< the AWS trust server domain    
#define    AWSTRUST_ROOTCAPATH    "/repository/AmazonRootCA1.pem"   //!< the AWS root CA path
const char AWSTRUST_ROOTCAURL[]   = "https://" AWSTRUST_SERVER AWSTRUST_ROOTCAPATH; // full AWS root CA url

const unsigned short MQTT_BROKER_PORT     =              8883;  //!< MQTTS port
const int MQTT_MAX_MSG_SIZE               =            9*1024;  //!< the max size of a MQTT pointperfect topic
const int MQTT_MAX_KEY_SIZE               =                60;

const char MQTT_TOPIC_MGA[]               =     "/pp/ubx/mga";  //!< GNSS assistance topic 
const char MQTT_TOPIC_KEY_FORMAT[]        =   "/pp/ubx/0236/";  //!< LBAND decryption keys topic
const char MQTT_TOPIC_FREQ[]           = "/pp/frequencies/Lb";  //!< LBAND frequency topic 

const char MQTT_TOPIC_IP_FORMAT[]         =            "/pp/";  //!< correction stream topic prefix, format: /pp/<stream>/<region>/<msg>

const char MQTT_STREAM_LBAND[]            =              "Lb";  //!< LBAND stream identifier 
const char MQTT_STREAM_IP[]               =              "ip";  //!< IP stream identifier

const char MQTT_TOPIC_IP_GAD[]            =            "/gad";  //!< geographic area defintion
const char MQTT_TOPIC_IP_HPAC[]           =           "/hpac";  //!< high precision atmospheric corrections
const char MQTT_TOPIC_IP_OCB[]            =            "/ocb";  //!< orbit, clock and bias
const char MQTT_TOPIC_IP_CLK[]            =            "/clk";  //!< clock correction

// -----------------------------------------------------------------------
// NTRIP settings 
// -----------------------------------------------------------------------

const int NTRIP_GGA_RATE                  =             20000;  //!< rate at which we send GGA messages 
const int NTRIP_CONNECT_TIMEOUT           =              5000;  //!< initial response timeout 
const unsigned short NTRIP_SERVER_PORT    =              2101;  //!< NTRIP default port
const char* NTRIP_RESPONSE_ICY            =  "ICY 200 OK\r\n";  //!< correction data response 
const char* NTRIP_RESPONSE_SOURCETABLE    = "SOURCETABLE 200 OK\r\n";  //!< source table response

// -----------------------------------------------------------------------
// CONFIGURATION keys
// -----------------------------------------------------------------------

#define    CONFIG_DEVICE_TITLE                 "HPG solution"   //!< a used friendly name
#define    CONFIG_DEVICE_NAMEPREFIX                     "hpg"   //!< a hostname compatible prefix, only a-z, 0-9 and -

// PointPerfect configuration 
const char CONFIG_VALUE_ZTPTOKEN[]        =        "ztpToken";  //!< config key for ZTP tocken
const char CONFIG_VALUE_BROKERHOST[]      =      "brokerHost";  //!< config key for brocker host
const char CONFIG_VALUE_STREAM[]          =          "stream";  //!< config key for stream
const char CONFIG_VALUE_ROOTCA[]          =          "rootCa";  //!< config key for root certificate
const char CONFIG_VALUE_CLIENTCERT[]      =      "clientCert";  //!< config key for client certificate
const char CONFIG_VALUE_CLIENTKEY[]       =       "clientKey";  //!< config key for client keys
#define CONFIG_VALUE_CLIENTID                      "clientId"   //!< config key for client id
const char CONFIG_FORMAT_FREQ[]            =    "%sLbandFreq";  //!< config key for current LBAND frequencys 
const char CONFIG_VALUE_KEY[]             =           "ppKey";  //!< config key for current LBAND keys (temprorary)

// NTRIP setting
const char CONFIG_VALUE_NTRIP_SERVER[]    =     "ntripServer";  //!< config key for NTRIP server
const char CONFIG_VALUE_NTRIP_MOUNTPT[]   = "ntripMountpoint";  //!< config key for NTRIP mount point
const char CONFIG_VALUE_NTRIP_USERNAME[]  =   "ntripUsername";  //!< config key for NTRIP user name
const char CONFIG_VALUE_NTRIP_PASSWORD[]  =   "ntripPassword";  //!< config key for NTRIP password

// Modem setting
const char CONFIG_VALUE_LTEAPN[]          =          "LteApn";  //!< config key for modem APN
const char CONFIG_VALUE_SIMPIN[]          =          "simPin";  //!< config key for SIM PIN
const char CONFIG_VALUE_MNOPROF[]         =      "mnoProfile";  //!< config key for modem MNO profile

// temporary settings
const char CONFIG_VALUE_REGION[]          =          "region";  //!< config key for current service region
const char CONFIG_VALUE_USESOURCE[]       =       "useSource";  //!< config key for current correction source / communication technology to use

/** This class encapsulates all WLAN functions. 
*/
class CONFIG {
  
public:

  /** constructor
   */
  CONFIG(void) {
    mutex = xSemaphoreCreateMutex();
    uint64_t mac = ESP.getEfuseMac();
    const char* p = (const char*)&mac;
    char str[64];
    sprintf(str, CONFIG_DEVICE_TITLE " - %02x%02x%02x", p[3], p[4], p[5]);
    title = str;
    sprintf(str, CONFIG_DEVICE_NAMEPREFIX "-%02x%02x%02x", p[3], p[4], p[5]);
    name = str;
    useSource = USE_NONE;
    lbandFreq = 0;
  }
  
  /** constructor
   */
  bool init(void) {
    // create a unique name from the mac 
    if (nvs.begin(CONFIG_DEVICE_NAMEPREFIX)) {
      if (nvs.isKey(CONFIG_VALUE_USESOURCE)) {
        useSource = (USE_SOURCE)nvs.getULong(CONFIG_VALUE_USESOURCE);
        log_d("key %s get 0x%04X", CONFIG_VALUE_USESOURCE, useSource);
      } else {
        useSource = USE_NONE;
        log_d("key %s empty", CONFIG_VALUE_USESOURCE);
      }
      servceRegion  = getValue(CONFIG_VALUE_REGION, ""); 
      mqttStream    = getValue(CONFIG_VALUE_STREAM, "");  
      mqttTopics    = updateTopics(mqttStream, servceRegion);
      lbandFreq     = getLbandFreq(servceRegion.c_str()); 
      ntripGga      = ""; // wipe the gga string
      return true;
    }
    return false;
  }

  /** get a name of the device
   *  \return the device name 
   */
  String getDeviceName(void)  { 
    String value;
    copy(name, value);
    return value;
  }    
  
  /** get a friendly name of the device
   *  \return the friendly device title 
   */
  String getDeviceTitle(void) { 
    String value;
    copy(title, value);
    return value;
  } 

  /** get the topics to subscribe  
   *  \return  a vector with all the topics
   */
  std::vector<String> getMqttTopics(void) {
   std::vector<String> topics; 
   if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      topics = mqttTopics;
      xSemaphoreGive(mutex); 
   }
   return topics;
  }

  /** get the LBAND frequency  
   *  \return 
   */
  bool getLbandCfg(String& region, uint32_t &freq) {
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      region = servceRegion;
      freq = lbandFreq;
      xSemaphoreGive(mutex); 
      return true;
    }
    return false;
  }
  
  /** get the value of a config key  
   *  \param key      the parameter key    
   *  \param default  the value to return when reading failes
   *  \return         the parameter value
   */
  String getValue(const char *key, const char *defaultValue = "") {
    String value;
    if (nvs.isKey(key)) {
      value = nvs.getString(key, defaultValue);
      log_d("key %s get \"%s\"", key, value.c_str());
    } else { 
      value = defaultValue;
      log_d("key %s default \"%s\"", key, defaultValue);
    }
    return value;
  }

  /** get the value of a config key  
   *  \param key    the parameter key    
   *  \param value  the returned value    
   *  \return       successful read status
   */
  bool getValue(const char *key, String& value) {
    bool ok;
    if (nvs.isKey(key)) {
      value = nvs.getString(key);
      log_d("key %s get \"%s\"", key, value.c_str());
      ok = true;
    } else { 
      log_d("key %s empty", key);
      ok = false;
    } 
    return ok;
  }
  
  /** set the value of a config key 
   *  \param key    the parameter key    
   *  \param value  the parameter value
   *  \return       true if value was changed
   */
  bool setValue(const char *key, String &value) {
    bool changed = false;
    if (nvs.isKey(key)) {
      String oldValue = nvs.getString(key);
      if (!oldValue.equals(value)) {
        if (0 < value.length()) {
          changed = nvs.putString(key, value);
          if (changed) {
            log_d("key %s changed from \"%s\" to \"%s\"", key, oldValue.c_str(), value.c_str());
          }
        } else {
          changed = nvs.remove(key);
          if (changed) {
            log_d("key %s removed \"%s\"", key, oldValue.c_str());
          }
        }
      }
    } else if (0 < value.length()) {
      changed = nvs.putString(key, value);
      if (changed) {
        log_d("key %s set to \"%s\"", key, value.c_str()); 
      }
    }
    return changed;
  }

  /** set the value of a config key 
   *  \param key     the parameter key    
   *  \param buffer  the buffer to store the key
   *  \param len     the length of the output buffer
   *  \return        true if value was changed
   */
  bool setValue(const char *key, const uint8_t* buffer, size_t len) {
    bool changed = false;
    size_t encLen = 0;
    mbedtls_base64_encode(NULL, 0, &encLen, buffer, len);
    uint8_t encBuf[encLen];
    if (0 == mbedtls_base64_encode(encBuf, sizeof(encBuf), &encLen, buffer, len)) {
      String value = (const char*)encBuf;
      changed = setValue(key, value); 
    } 
    return changed;
  }

  /** get the value of a config key  
   *  \param key     the parameter key    
   *  \param buffer  the buffer to store the key
   *  \param len     the length of the output buffer
   *  \return        the length actualy put in the buffer
   */
  int getValue(const char *key, uint8_t* buffer, size_t len) {
    String string = getValue(key);
    size_t decLen = 0;
    if (0 == mbedtls_base64_decode(buffer, len, &decLen, (const unsigned char *)string.c_str(), string.length())) {
      if (decLen > len)
        decLen = 0;
    } else {
      decLen = 0;
    }
    return decLen;
  }
  
  /** extract the lband freuqencies for all supported regions from the json buffer 
   *  \param buf  the buffer with the json message
   *  \param size the size of the json buffer
   */
  void updateLbandFreqs(const uint8_t *buf, size_t size) {
    DynamicJsonDocument json(512);
    DeserializationError error = deserializeJson(json, buf, size);
    if (DeserializationError::Ok != error) {
      log_e("deserializeJson failed with error %d", error);
    } else if (json.containsKey("frequencies")) {
      if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
        bool changed = false;
        for (int i = 0; i < sizeof(POINTPERFECT_REGIONS)/sizeof(*POINTPERFECT_REGIONS); i ++) {
          const char *curRegion = POINTPERFECT_REGIONS[i].region;
          if (json["frequencies"].containsKey(curRegion)) {
            double freq = json["frequencies"][curRegion]["current"]["value"].as<double>();
            uint32_t newFreq = (uint32_t)(1e6 * freq);
            // adjust the current freq if region is the same
            if ((newFreq != lbandFreq) && servceRegion.equals(curRegion)) {
              lbandFreq = newFreq;
              changed = true;
            }
            // keep track in the nvs
            char key[16];
            sprintf(key, CONFIG_FORMAT_FREQ, curRegion);
            if (nvs.isKey(key)) {
              uint32_t oldFreq =  nvs.getULong(key);
              if (newFreq != oldFreq) {
                if (nvs.putULong(key, newFreq)) {
                  changed = true;
                  log_i("region %s changed lbandFreq from %li to %li", curRegion, oldFreq, newFreq);
                }
              }
            } else if (nvs.putULong(key, newFreq)) {
              changed = true;
              log_i("region %s set to %li", curRegion, newFreq);
            }
          }
        }
        xSemaphoreGive(mutex);
        if (changed) {
          log_i("changed freq %lu", lbandFreq); 
        }
      }
    }
  }

  /** set current location, this will set the region and LBAND frequency
   *  \param lat  the current latitude
   *  \param lon  the current longitude
   */
  void updateLocation(int lat, int lon) {
    // the highest entries have highest priority
   const char* region = "";
    for (int i = 0; i < sizeof(POINTPERFECT_REGIONS)/sizeof(*POINTPERFECT_REGIONS); i ++) {
      if ((lat >= POINTPERFECT_REGIONS[i].lat1 && lat <= POINTPERFECT_REGIONS[i].lat2) &&
          (lon >= POINTPERFECT_REGIONS[i].lon1 && lon <= POINTPERFECT_REGIONS[i].lon2)) {
        if (POINTPERFECT_REGIONS[i].region) {
          region = POINTPERFECT_REGIONS[i].region;
        }
      }
    } 
    bool changed = false;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      if (!servceRegion.equals(region)) {
        changed = nvs.putString(CONFIG_VALUE_REGION, region);
        servceRegion = region;
        lbandFreq = getLbandFreq(region);
      }
      xSemaphoreGive(mutex); 
    }
    if (changed) {
      log_i("region \"%s\" lbandFreq %lu", region, lbandFreq);
    }
  }
 
  /** delete the zero touch provisioning credentials
   */
  void delZtp(void) {
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      if (nvs.isKey(CONFIG_VALUE_BROKERHOST)) nvs.remove(CONFIG_VALUE_BROKERHOST);
      if (nvs.isKey(CONFIG_VALUE_STREAM))     nvs.remove(CONFIG_VALUE_STREAM);
      if (nvs.isKey(CONFIG_VALUE_ROOTCA))     nvs.remove(CONFIG_VALUE_ROOTCA);
      if (nvs.isKey(CONFIG_VALUE_CLIENTCERT)) nvs.remove(CONFIG_VALUE_CLIENTCERT);
      if (nvs.isKey(CONFIG_VALUE_CLIENTKEY))  nvs.remove(CONFIG_VALUE_CLIENTKEY);
      if (nvs.isKey(CONFIG_VALUE_CLIENTID))   nvs.remove(CONFIG_VALUE_CLIENTID);
      mqttStream = "";
      USE_SOURCE newUseSource = (USE_SOURCE)(useSource & ~USE_CLIENTID); // remove the ready bit
      if (newUseSource != useSource) {
        nvs.putULong(CONFIG_VALUE_USESOURCE, newUseSource);
        log_i("key %s changed from 0x%04X to 0x%04X", CONFIG_VALUE_USESOURCE, useSource, newUseSource);
        useSource = newUseSource;
      }
      mqttTopics = updateTopics(mqttStream, servceRegion);
      xSemaphoreGive(mutex); 
    }
    log_i("ZTP deleted");
  }

  /** set the pointperfect credentials and certificates from the ZTP process
   *  \param ztp     the ZTP JSON response 
   *  \param rootCa  the AWS root certificate
   *  \return        the decoding success
   */
  bool setZtp(String &ztp, String &rootCa) {
    const int   JSON_ZTP_MAXSIZE        = 4*1024;
    const char* JSON_ZTP_CLIENTID       = "clientId";
    const char* JSON_ZTP_CERTIFICATE    = "certificate";
    const char* JSON_ZTP_PRIVATEKEY     = "privateKey";
    const char* JSON_ZTP_BROKERHOST     = "brokerHost";
    const char* JSON_ZTP_SUPPORTSLBAND  = "supportsLband";
    StaticJsonDocument<200> filter;
    filter[JSON_ZTP_CLIENTID]       = true;
    filter[JSON_ZTP_CERTIFICATE]    = true;
    filter[JSON_ZTP_PRIVATEKEY]     = true;
    filter[JSON_ZTP_BROKERHOST]     = true;
    filter[JSON_ZTP_SUPPORTSLBAND]  = true;
    DynamicJsonDocument jsonZtp(JSON_ZTP_MAXSIZE);
    DeserializationError error = deserializeJson(jsonZtp, ztp.c_str(), DeserializationOption::Filter(filter));
    if (DeserializationError::Ok != error) {
      log_e("deserializeJson failed with error %d", error);
    } else {
      const char* clientId = jsonZtp[JSON_ZTP_CLIENTID].as<const char*>();
      if (*clientId) {
        log_i("ZTP complete clientId is \"%s\"", clientId);
        if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
          mqttStream = jsonZtp[JSON_ZTP_SUPPORTSLBAND].as<bool>() ? MQTT_STREAM_LBAND : MQTT_STREAM_IP;
          nvs.putString(CONFIG_VALUE_CLIENTID,    clientId);
          nvs.putString(CONFIG_VALUE_ROOTCA,      rootCa);
          nvs.putString(CONFIG_VALUE_CLIENTCERT,  jsonZtp[JSON_ZTP_CERTIFICATE].as<const char*>());
          nvs.putString(CONFIG_VALUE_CLIENTKEY,   jsonZtp[JSON_ZTP_PRIVATEKEY].as<const char*>());
          nvs.putString(CONFIG_VALUE_BROKERHOST,  jsonZtp[JSON_ZTP_BROKERHOST].as<const char*>());
          nvs.putString(CONFIG_VALUE_STREAM,      mqttStream);
          USE_SOURCE newUseSource = (USE_SOURCE)(useSource | USE_CLIENTID);
          if (useSource != newUseSource) {
            nvs.putULong(CONFIG_VALUE_USESOURCE, newUseSource);
            log_i("key %s changed from 0x%04X to 0x%04X", CONFIG_VALUE_USESOURCE, useSource, newUseSource);
            useSource = newUseSource;
          }
          mqttTopics = updateTopics(mqttStream, servceRegion);
          xSemaphoreGive(mutex); 
        }
        return true;
      } else {
        log_e("ZTP content");
      }
    }
    return false;
  }

  /** create a ZTP request to be sent to thingstream JSON API
   *  \return  the ZTP request string to POST
   */
  String ztpRequest(void) {
    String token;
    String jsonString;
    if (getValue(CONFIG_VALUE_ZTPTOKEN, token)) {
      DynamicJsonDocument json(256);
      json["tags"][0] = "ztp";
      json["token"]   = token.c_str();
      json["hardwareId"] = getDeviceName();
      json["givenName"] = getDeviceTitle();
      if (0 < serializeJson(json,jsonString)) {
        log_d("ZTP request %s", jsonString.c_str());
      }
    }
    return jsonString;
  }

  typedef enum { 
    WLAN  = 0,
    LTE   = 1,
    LBAND = 2
  } SOURCE;
  
  typedef enum {
    USE_NONE            = 0x0000,
    // Communication Channel
    USE_WLAN            = 1 << WLAN,
    USE_LTE             = 1 << LTE,
    USE_LBAND           = 1 << LBAND,
    // Services 
    USE_POINTPERFECT    = 0x0100,
    USE_NTRIP           = 0x0200,
    // mask off comms channel and services
    CONFIG_MASK         = 0x0FFF,
    // Status indicating valid configuration  
    USE_ZTPTOKEN        = 0x1000,
    USE_CLIENTID        = 0x2000,
    USE_NTRIP_SERVER    = 0x4000,
  } USE_SOURCE;

  USE_SOURCE getUseSource(void) {
    return useSource;
  }

  bool setUseSource(USE_SOURCE newUseSource) {
    bool changed = false;
    newUseSource = (USE_SOURCE)((newUseSource & CONFIG_MASK) | 
                                (nvs.isKey(CONFIG_VALUE_ZTPTOKEN)     ? USE_ZTPTOKEN      : 0) | 
                                (nvs.isKey(CONFIG_VALUE_CLIENTID)     ? USE_CLIENTID      : 0) | 
                                (nvs.isKey(CONFIG_VALUE_NTRIP_SERVER) ? USE_NTRIP_SERVER  : 0));
    if (newUseSource != useSource) {
      log_i("key %s changed from 0x%04X to 0x%04X", CONFIG_VALUE_USESOURCE, useSource, newUseSource);
      changed = nvs.putULong(CONFIG_VALUE_USESOURCE, newUseSource);
      useSource = newUseSource;
    }
    return changed;
  }
  
  void setGga(String& value) {
    copy(value, ntripGga);
  }
  
  bool getGga(String& value) {
    return copy(ntripGga, value);;
  }

  bool getRegion(String& value) {
    return copy(servceRegion, value);;
  }

protected:

  bool copy(String& fromStr, String& toStr) {
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      toStr = fromStr;
      xSemaphoreGive(mutex); 
    }
    return toStr.length() > 0;
  }

  std::vector<String> updateTopics(String &stream, String &region) {
    std::vector<String> topics;
    topics.push_back(MQTT_TOPIC_MGA);
    if (0 < stream.length()) {
      topics.push_back(MQTT_TOPIC_KEY_FORMAT + stream);
      if (stream.equals(MQTT_STREAM_LBAND)) {
        topics.push_back(MQTT_TOPIC_FREQ);
      }
      if (0 < region.length()) {
        //topics.push_back(MQTT_TOPIC_IP_FORMAT + stream + "/" + region);
        // subscribe individually to subtopics, as this should speedup time to first fix
        topics.push_back(MQTT_TOPIC_IP_FORMAT + stream + "/" + region + MQTT_TOPIC_IP_GAD);
        topics.push_back(MQTT_TOPIC_IP_FORMAT + stream + "/" + region + MQTT_TOPIC_IP_HPAC);
        topics.push_back(MQTT_TOPIC_IP_FORMAT + stream + "/" + region + MQTT_TOPIC_IP_OCB);
        topics.push_back(MQTT_TOPIC_IP_FORMAT + stream + "/" + region + MQTT_TOPIC_IP_CLK);
      }
    }
    return topics;
  }    

  uint32_t getLbandFreq(const char* region) {
    uint32_t freq = 0;
    if (*region) {
      char key[16];
      sprintf(key, CONFIG_FORMAT_FREQ, region);
      if (nvs.isKey(key)) {
        freq = nvs.getULong(key);
      }
    }
    return freq; 
  }
  
  String title;                     //!< the title of the device
  String name;                      //!< the name of the device
  
  Preferences nvs;                  
  USE_SOURCE useSource;
  uint32_t lbandFreq;
  
  SemaphoreHandle_t mutex;          //!< protects nvs and variables below
  String servceRegion;              //!< service Region 
  String mqttStream;
  String ntripGga;                  //!< gga String
  std::vector<String> mqttTopics;
};
   
CONFIG Config; //!< The global CONFIG object

#endif // __CONFIG_H__
