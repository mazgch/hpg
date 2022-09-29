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

#include "LOG.h"
#include "HW.h"

#include <mbedtls/base64.h>

// HTTPS url for ZTP API request  
#define    THINGSTREAM_SERVER             "api.thingstream.io"
#define    THINGSTREAM_ZTPPATH            "/ztp/pointperfect/credentials"
const char THINGSTREAM_ZTPURL[]         = "https://" THINGSTREAM_SERVER THINGSTREAM_ZTPPATH;

// HTTPS url for Amazon root CA (not really needed, as long as we dont verify the certificates)
#define    AWSTRUST_SERVER                "www.amazontrust.com"
#define    AWSTRUST_ROOTCAPATH            "/repository/AmazonRootCA1.pem"
const char AWSTRUST_ROOTCAURL[]         = "https://" AWSTRUST_SERVER AWSTRUST_ROOTCAPATH;

const unsigned short MQTT_BROKER_PORT   = 8883; 
const int MQTT_MAX_MSG_SIZE             = 9*1024;

// this table defines the recional coverage (by a bounding box and its region tag and frequency
// the lower the higher the priority and more targeted the lat/lon region should be
const struct { const char* region; short lon1; short lon2; short lat1; short lat2; long freq; } POINTPERFECT_REGIONS[] = {
  // Continental
  { "us", -170, -50,   20, 75, 1556290000 }, // Continental US
  { "eu",  -30,  40,   35, 75, 1545260000 }, // Europe
  // Regional / Test 
  { "cn",   75,  135,  15, 60,          0 }, // China
  { "au",  111,  160, -43, -9,          0 }, // Australia
  { "jp",  128,  147,  30, 47,          0 }, // Japan
  { "kr",  126,  130,  34, 39,          0 }, // Korea
  { "sa",   34,   56,  15, 33,          0 } // Saudi Arabia
};

const char MQTT_TOPIC_MGA[]             = "/pp/ubx/mga";
const char MQTT_TOPIC_FREQ[]            = "/pp/frequencies/Lb";
const char MQTT_TOPIC_KEY_FORMAT[]      = "/pp/ubx/0236/";
const char MQTT_TOPIC_IP_FORMAT[]       = "/pp/"; // /stream/region 

const char MQTT_TOPIC_IP_GAD[]          = "/gad";  // geographic area defintion
const char MQTT_TOPIC_IP_HPAC[]         = "/hpac"; // high precision atmospheric corrections
const char MQTT_TOPIC_IP_OCB[]          = "/ocb";  // orbit, clock and bias
const char MQTT_TOPIC_IP_CLK[]          = "/clk";  // clock correction

const char MQTT_STREAM_LBAND[]          = "Lb";
const char MQTT_STREAM_IP[]             = "ip";

const char CONFIG_FFS_FILE[]            = "/config.ffs";

#define    CONFIG_DEVICE_TITLE          "HPG solution"
#define    CONFIG_DEVICE_NAMEPREFIX     "hpg" // a hostname compatible prefix, only a-z, 0-9 and -

const char CONFIG_VALUE_ZTPTOKEN[]      = "ztpToken";
const char CONFIG_VALUE_BROKERHOST[]    = "brokerHost";
const char CONFIG_VALUE_STREAM[]        = "stream";
const char CONFIG_VALUE_ROOTCA[]        = "rootCa";
const char CONFIG_VALUE_CLIENTCERT[]    = "clientCert";
const char CONFIG_VALUE_CLIENTKEY[]     = "clientKey";
const char CONFIG_VALUE_CLIENTID[]      = "clientId";

const char CONFIG_VALUE_USESOURCE[]     = "useSource";

const char CONFIG_VALUE_LTEAPN[]        = "LteApn";
const char CONFIG_VALUE_SIMPIN[]        = "simPin";
const char CONFIG_VALUE_MNOPROF[]       = "mnoProfile";

const char CONFIG_VALUE_REGION[]        = "region";          
const char CONFIG_VALUE_FREQ[]          = "freq";
const char CONFIG_VALUE_KEY[]           = "ppKey";
                  
class CONFIG {
public:

  CONFIG() : json(1024*9) {
    mutex = xSemaphoreCreateMutex();
    ffsOk = false;
    // create a unique name from the mac 
    uint64_t mac = ESP.getEfuseMac();
    const char* p = (const char*)&mac;
    char str[64];
    sprintf(str, CONFIG_DEVICE_TITLE " - %02x%02x%02x", p[3], p[4], p[5]);
    title = str;
    sprintf(str, CONFIG_DEVICE_NAMEPREFIX "-%02x%02x%02x", p[3], p[4], p[5]);
    name = str;
  }

  String getDeviceName()  { return name; }    
  String getDeviceTitle() { return title; }; 
  
  bool init(void) {
    bool cfgOk = false;
    if (ffsInit()) {
      Log.info("CONFIG::init FFS ok");
      cfgOk = read();
      if (cfgOk) {
        Log.info("CONFIG::init \"FFS%s\" read", CONFIG_FFS_FILE);
      } 
    } else {
      Log.error("CONFIG::init FFS failed");
    }
    return cfgOk;
  }

  void reset(void) {
    xSemaphoreTake(mutex, portMAX_DELAY); 
    if (ffsOk) {
      if (SPIFFS.exists(CONFIG_FFS_FILE)) {
        SPIFFS.remove(CONFIG_FFS_FILE);
      }
    }
    xSemaphoreGive(mutex);
  }
  
  bool save(void) {
    int len = -1;
    xSemaphoreTake(mutex, portMAX_DELAY); 
    if (ffsOk) {
      if (SPIFFS.exists(CONFIG_FFS_FILE)) {
        SPIFFS.remove(CONFIG_FFS_FILE);
      }
      File file = SPIFFS.open(CONFIG_FFS_FILE, FILE_WRITE);
      if (file) {
        len = serializeJson(json, file);
        file.close();
      }
    }
    xSemaphoreGive(mutex);
    if (-1 == len) {
      Log.error("CONFIG::save \"FFS%s\" open failed", CONFIG_FFS_FILE);
    } else if (0 == len) {
      Log.error("CONFIG::save \"FFS%s\" serialize and write failed", CONFIG_FFS_FILE);
    } else {
      Log.debug("CONFIG::save size %d", len);
    }
    return (len > 0);
  }

  bool read(void) {
    bool openOk = false;
    DeserializationError err = DeserializationError::EmptyInput;
    xSemaphoreTake(mutex, portMAX_DELAY); 
    if (ffsOk && SPIFFS.exists(CONFIG_FFS_FILE)) {
      File file = SPIFFS.open(CONFIG_FFS_FILE, FILE_READ);
      if (file) {
        openOk = true;
        err = deserializeJson(json, file);
        file.close();
      }
    }
    xSemaphoreGive(mutex);
    if (!openOk) {
      Log.debug("CONFIG::read \"FFS&s\" open failed", CONFIG_FFS_FILE);
    } else if (DeserializationError::Ok != err) {
      Log.error("CONFIG::read \"FFS%s\" deserialze failed with error %d", CONFIG_FFS_FILE, err);
    } else {
      Log.debug("CONFIG::read \"FFS%s\"", CONFIG_FFS_FILE);
    }
    return DeserializationError::Ok == err;
  }

  String getValue(const char *param) {
    xSemaphoreTake(mutex, portMAX_DELAY); 
    String str = json.containsKey(param) ? json[param] : String();
    xSemaphoreGive(mutex);
    Log.debug("CONFIG::getValue %s = \"%s\"", param, str.c_str());
    return str;
  }
  
  bool setValue(const char *param, String value) {
    xSemaphoreTake(mutex, portMAX_DELAY); 
    String old = json.containsKey(param) ? json[param] : String();
    bool changed = !old.equals(value);
    if (changed) {
      json[String(param)] = value;
    }
    xSemaphoreGive(mutex); 
    if (changed) {
      Log.debug("CONFIG::setValue %s changed from \"%s\" to \"%s\"", param, old.c_str(), value.c_str()); 
    } else {
      Log.debug("CONFIG::setValue %s keep \"%s\" as unchanged", param, old.c_str()); 
    }
    return changed;
  } 

  bool delValue(const char *param) {
    bool changed = false;
    xSemaphoreTake(mutex, portMAX_DELAY); 
    changed = json.containsKey(param);
    if (changed) {
      json.remove(param);
    }
    xSemaphoreGive(mutex); 
    if (changed) {
      Log.debug("CONFIG::delValue %s", param);
    }
    return changed;
  }

  bool setValue(const char *param, const uint8_t* buffer, size_t len) {
    bool changed = false;
    size_t encLen = 0;
    mbedtls_base64_encode(NULL, 0, &encLen, buffer, len);
    uint8_t encBuf[encLen];
    if (0 == mbedtls_base64_encode(encBuf, sizeof(encBuf), &encLen, buffer, len)) {
      changed = setValue(param, String((const char*)encBuf)); 
    } 
    return changed;
  }

  int getValue(const char *param, uint8_t* buffer, size_t len) {
    String string = getValue(CONFIG_VALUE_KEY);
    size_t decLen = 0;
    if (0 == mbedtls_base64_decode(buffer, len, &decLen, (const unsigned char *)string.c_str(), string.length())) {
      if (decLen > len)
        decLen = 0;
    } else {
      decLen = 0;
    }
    return decLen;
  }
  
  std::vector<String> getTopics(void)
  { 
    xSemaphoreTake(mutex, portMAX_DELAY); 
    String stream = json.containsKey(CONFIG_VALUE_STREAM) ? json[CONFIG_VALUE_STREAM] : String();
    String region = json.containsKey(CONFIG_VALUE_REGION) ? json[CONFIG_VALUE_REGION] : POINTPERFECT_REGIONS[0].region;
    String source = json.containsKey(CONFIG_VALUE_USESOURCE) ? json[CONFIG_VALUE_USESOURCE] : String();
    xSemaphoreGive(mutex); 
    std::vector<String> topics;
    topics.push_back(MQTT_TOPIC_MGA);
    if (0 < stream.length()) {
      topics.push_back(MQTT_TOPIC_KEY_FORMAT + stream);
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
  
  int getFreq(void) {
    xSemaphoreTake(mutex, portMAX_DELAY); 
    int freq = json.containsKey(CONFIG_VALUE_FREQ) ? json[CONFIG_VALUE_FREQ] : POINTPERFECT_REGIONS[0].freq;
    xSemaphoreGive(mutex); 
    return freq;
  }
  
  void updateLocation(int lat, int lon) {
    // the highest entries have highest priority
    long freq = 0;
    const char* region = NULL;
    for (int i = 0; (i < sizeof(POINTPERFECT_REGIONS)/sizeof(*POINTPERFECT_REGIONS)); i ++) {
      if ((lat >= POINTPERFECT_REGIONS[i].lat1 && lat <= POINTPERFECT_REGIONS[i].lat2) &&
          (lon >= POINTPERFECT_REGIONS[i].lon1 && lon <= POINTPERFECT_REGIONS[i].lon2)) {
        if (POINTPERFECT_REGIONS[i].freq) {
          freq = POINTPERFECT_REGIONS[i].freq;
        }
        if (POINTPERFECT_REGIONS[i].region) {
          region = POINTPERFECT_REGIONS[i].region;
        }
      }
    } 
    xSemaphoreTake(mutex, portMAX_DELAY); 
    bool changed = false;
    if (region) {
      String oldRegion = json.containsKey(CONFIG_VALUE_REGION) ? json[CONFIG_VALUE_REGION] : String();
      if (!oldRegion.equals(region)) {
        json[CONFIG_VALUE_REGION] = region;
        changed = true;
      }
    } else if (json.containsKey(CONFIG_VALUE_REGION)) { // we leave coverage area
      json.remove(CONFIG_VALUE_REGION);
      changed = true;
    }
    if (freq) {
      int oldFreq = json.containsKey(CONFIG_VALUE_FREQ) ? json[CONFIG_VALUE_FREQ] : 0;
      if (freq != oldFreq) {
          json[CONFIG_VALUE_FREQ] = freq;
          changed = true;
      }
    }
    xSemaphoreGive(mutex); 
    if (changed) {
      Log.info("CONFIG::updateLocation \"%s\" freq %d", region ? region : "", freq);
      save();
    }
  }
 
  void delZtp(void) {
    xSemaphoreTake(mutex, portMAX_DELAY); 
    json.remove(CONFIG_VALUE_BROKERHOST);
    json.remove(CONFIG_VALUE_STREAM);
    json.remove(CONFIG_VALUE_ROOTCA);
    json.remove(CONFIG_VALUE_CLIENTCERT);
    json.remove(CONFIG_VALUE_CLIENTKEY);
    json.remove(CONFIG_VALUE_CLIENTID);
    xSemaphoreGive(mutex); 
    Log.info("CONFIG::delZtp");
  }
  
  String setZtp(String &ztp, String &rootCa) {
    String id;
    StaticJsonDocument<200> filter;
    filter["clientId"] = true;
    filter["certificate"] = true;
    filter["privateKey"] = true;
    filter["brokerHost"] = true;
    filter["supportsLband"] = true;
    DynamicJsonDocument jsonZtp(4*1024);
    DeserializationError error = deserializeJson(jsonZtp, ztp.c_str(), DeserializationOption::Filter(filter));
    if (DeserializationError::Ok != error) {
      Log.error("CONFIG::setZtp deserializeJson failed with error %d", error);
    } else {
      id = (const char*)jsonZtp["clientId"];
      String cert = jsonZtp["certificate"];
      String key = jsonZtp["privateKey"];
      String broker = jsonZtp["brokerHost"];
      bool lband = jsonZtp["supportsLband"];
      if (cert.length() && key.length() && id.length() && broker.length() && rootCa.length()) {
        Log.info("CONFIG::setZtp complete clientId is \"%s\"", id.c_str());
        xSemaphoreTake(mutex, portMAX_DELAY); 
        json[CONFIG_VALUE_BROKERHOST] = broker;
        json[CONFIG_VALUE_STREAM]     = lband ? MQTT_STREAM_LBAND : MQTT_STREAM_IP;
        json[CONFIG_VALUE_ROOTCA]     = rootCa;
        json[CONFIG_VALUE_CLIENTCERT] = cert;
        json[CONFIG_VALUE_CLIENTKEY]  = key;
        json[CONFIG_VALUE_CLIENTID]   = id;
        xSemaphoreGive(mutex); 
        save();
      } else {
        Log.error("CONFIG::setZtp some json fields missing");
      }
    }
    return id;
  }

  String ztpRequest(void) {
    xSemaphoreTake(mutex, portMAX_DELAY); 
    String token = json.containsKey(CONFIG_VALUE_ZTPTOKEN) ? json[CONFIG_VALUE_ZTPTOKEN] : String();
    xSemaphoreGive(mutex); 
    String str;
    if (token.length()) {
      DynamicJsonDocument json(256);
      json["tags"][0] = "ztp";
      json["token"]   = token.c_str();
      json["hardwareId"] = getDeviceName();
      json["givenName"] = getDeviceTitle();
      if (0 < serializeJson(json,str)) {
        Log.debug("CONFIG::ztpRequest %s", str.c_str());
      }
    }
    return str;
  }
  
protected:
  
  bool ffsInit(void) {
    if (ffsOk) {
      SPIFFS.end();
    }
    ffsOk = SPIFFS.begin();
    if (!ffsOk) {
      if (!SPIFFS.format()) {
        Log.error("CONFIG::ffsInit format failed");
      } else {
        ffsOk = SPIFFS.begin();
      }
    }
    return ffsOk;
  }    

  bool ffsOk;
  DynamicJsonDocument json;
  String title;
  String name;
  SemaphoreHandle_t mutex; // protects json and FFS
};
   
CONFIG Config;

#endif // __CONFIG_H__
