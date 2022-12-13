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

#include "HW.h"

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
// PointPerfect LBAND satellite augmentation service EU / US LBAND frequencies taken from: 
// https://developer.thingstream.io/guides/location-services/pointperfect-service-description
typedef struct { const char* region; short lon1; short lon2; short lat1; short lat2; long freq; } POINTPERFECT_REGIONS_t;
POINTPERFECT_REGIONS_t POINTPERFECT_REGIONS[] = {
  // Continental
  { "us", -170, -50,   20, 75, 1556290000 }, // Continental US
  { "eu",  -30,  40,   35, 75, 1545260000 }, // Europe
  // Regional / Test 
  { "cn",   75,  135,  15, 60,          0 }, // China
  { "au",  111,  160, -43, -9,          0 }, // Australia
  { "jp",  128,  147,  30, 47,          0 }, // Japan
  { "kr",  126,  130,  34, 39,          0 }, // Korea
  { "sa",   34,   56,  15, 33,          0 }  // Saudi Arabia
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

const char CONFIG_VALUE_NTRIP_SERVER[]  = "ntripServer";
const char CONFIG_VALUE_NTRIP_MOUNTPT[] = "ntripMountpoint";
const char CONFIG_VALUE_NTRIP_USERNAME[]= "ntripUsername";
const char CONFIG_VALUE_NTRIP_PASSWORD[]= "ntripPassword";
const char CONFIG_VALUE_NTRIP_GGA[]     = "ntripGga";

const unsigned short NTRIP_SERVER_PORT  = 2101;
const int NTRIP_GGA_RATE                = 20000;
const int NTRIP_CONNECT_TIMEOUT         = 20000;
                     
class CONFIG {
  
public:

  CONFIG() : json(1024*7) {
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
      log_i("FFS ok");
      cfgOk = read();
      if (cfgOk) {
        log_i("file \"FFS%s\" read", CONFIG_FFS_FILE);
      } 
    } else {
      log_e("FFS failed");
    }
    return cfgOk;
  }

  void reset(void) {
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      if (ffsOk) {
        if (SPIFFS.exists(CONFIG_FFS_FILE)) {
          SPIFFS.remove(CONFIG_FFS_FILE);
        }
      }
      xSemaphoreGive(mutex);
    }
  }
  
  bool save(void) {
    int len = -1;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
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
    }
    if (-1 == len) {
      log_e("file \"FFS%s\" open failed", CONFIG_FFS_FILE);
    } else if (0 == len) {
      log_e("file \"FFS%s\" serialize and write failed", CONFIG_FFS_FILE);
    } else {
      log_d("file size %d", len);
    }
    return (len > 0);
  }

  bool read(void) {
    bool openOk = false;
    DeserializationError err = DeserializationError::EmptyInput;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      if (ffsOk && SPIFFS.exists(CONFIG_FFS_FILE)) {
        File file = SPIFFS.open(CONFIG_FFS_FILE, FILE_READ);
        if (file) {
          openOk = true;
          err = deserializeJson(json, file);
          file.close();
        }
      }
      xSemaphoreGive(mutex);
    }
    if (!openOk) {
      log_d("file \"FFS&s\" open failed", CONFIG_FFS_FILE);
    } else if (DeserializationError::Ok != err) {
      log_e("file \"FFS%s\" deserialze failed with error %d", CONFIG_FFS_FILE, err);
    } else {
      log_d("file \"FFS%s\"", CONFIG_FFS_FILE);
    }
    return DeserializationError::Ok == err;
  }

  String getValue(const char *param) {
    String str;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      str = json.containsKey(param) ? json[param] : String();
      xSemaphoreGive(mutex);
    }
    log_v("param %s = \"%s\"", param, str.c_str());
    return str;
  }
  
  bool setValue(const char *param, String value) {
    String old;
    bool changed = false;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) { 
      old = json.containsKey(param) ? json[param] : String();
      changed = !old.equals(value);
      if (changed) {
        json[String(param)] = value;
        json.garbageCollect();
      }
      xSemaphoreGive(mutex); 
    }
    if (changed) {
      log_v("param %s changed from \"%s\" to \"%s\"", param, old.c_str(), value.c_str()); 
    } else {
      log_v("param  %s keep \"%s\" as unchanged", param,  old.c_str()); 
    }
    return changed;
  } 

  bool delValue(const char *param) {
    bool changed = false;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      changed = json.containsKey(param);
      if (changed) {
        json.remove(param);
        json.garbageCollect();
      }
      xSemaphoreGive(mutex); 
    }
    if (changed) {
      log_v("param  %s", param);
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
    String stream;
    String region;
    String source;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      stream = json.containsKey(CONFIG_VALUE_STREAM) ? json[CONFIG_VALUE_STREAM] : String();
      region = json.containsKey(CONFIG_VALUE_REGION) ? json[CONFIG_VALUE_REGION] : POINTPERFECT_REGIONS[0].region;
      source = json.containsKey(CONFIG_VALUE_USESOURCE) ? json[CONFIG_VALUE_USESOURCE] : String();
      xSemaphoreGive(mutex); 
    }
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
  
  int getFreq(void) {
    int freq = -1;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      freq = json.containsKey(CONFIG_VALUE_FREQ) ? json[CONFIG_VALUE_FREQ] : POINTPERFECT_REGIONS[0].freq;
      xSemaphoreGive(mutex); 
    }
    return freq;
  }
  
  void updateLocation(int lat, int lon) {
    // the highest entries have highest priority
    long freq = 0;
    const char* region = NULL;
    for (int i = 0; i < sizeof(POINTPERFECT_REGIONS)/sizeof(POINTPERFECT_REGIONS_t); i ++) {
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
    bool changed = false;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
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
      if (changed) 
        json.garbageCollect();
      xSemaphoreGive(mutex); 
    }
    if (changed) {
      log_i("region \"%s\" freq %d", region ? region : "", freq);
      save();
    }
  }
 
  void delZtp(void) {
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      json.remove(CONFIG_VALUE_BROKERHOST);
      json.remove(CONFIG_VALUE_STREAM);
      json.remove(CONFIG_VALUE_ROOTCA);
      json.remove(CONFIG_VALUE_CLIENTCERT);
      json.remove(CONFIG_VALUE_CLIENTKEY);
      json.remove(CONFIG_VALUE_CLIENTID);
      json.garbageCollect();
      xSemaphoreGive(mutex); 
    }
    log_i("ZTP deleted");
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
      log_e("deserializeJson failed with error %d", error);
    } else {
      id = (const char*)jsonZtp["clientId"];
      String cert = jsonZtp["certificate"];
      String key = jsonZtp["privateKey"];
      String broker = jsonZtp["brokerHost"];
      bool lband = jsonZtp["supportsLband"];
      if (cert.length() && key.length() && id.length() && broker.length() && rootCa.length()) {
        log_i("ZTP complete clientId is \"%s\"", id.c_str());
        if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
          json[CONFIG_VALUE_BROKERHOST] = broker;
          json[CONFIG_VALUE_STREAM]     = lband ? MQTT_STREAM_LBAND : MQTT_STREAM_IP;
          json[CONFIG_VALUE_ROOTCA]     = rootCa;
          json[CONFIG_VALUE_CLIENTCERT] = cert;
          json[CONFIG_VALUE_CLIENTKEY]  = key;
          json[CONFIG_VALUE_CLIENTID]   = id;
          json.garbageCollect();
          xSemaphoreGive(mutex); 
        }
        save();
      } else {
        log_e("some json fields missing");
      }
    }
    return id;
  }

  String ztpRequest(void) {
    String token;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      token = json.containsKey(CONFIG_VALUE_ZTPTOKEN) ? json[CONFIG_VALUE_ZTPTOKEN] : String();
      xSemaphoreGive(mutex); 
    }
    String str;
    if (token.length()) {
      DynamicJsonDocument json(256);
      json["tags"][0] = "ztp";
      json["token"]   = token.c_str();
      json["hardwareId"] = getDeviceName();
      json["givenName"] = getDeviceTitle();
      if (0 < serializeJson(json,str)) {
        log_v("ZTP request %s", str.c_str());
      }
    }
    return str;
  }

  void setLbandFreqs(const uint8_t *buf, size_t size) {
    DynamicJsonDocument json(512);
    DeserializationError error = deserializeJson(json, buf, size);
    if (DeserializationError::Ok != error) {
      log_e("deserializeJson failed with error %d", error);
    } else {
      for (int i = 0; i < sizeof(POINTPERFECT_REGIONS)/sizeof(POINTPERFECT_REGIONS_t); i ++) {
        const char* region = POINTPERFECT_REGIONS[i].region;
        if (region && json["frequencies"].containsKey(region)) {
          String str = json["frequencies"][region]["current"]["value"];
          if (0 < str.length()) {
            long freq = (long)(1e6 * str.toDouble());
            if (POINTPERFECT_REGIONS[i].freq != freq) {
              log_w("region %s update freq to %li from %li", region, freq, POINTPERFECT_REGIONS[i].freq);
              POINTPERFECT_REGIONS[i].freq = freq; 
            }
          }
        }
      }
    }
  }

protected:
  
  bool ffsInit(void) {
    if (ffsOk) {
      SPIFFS.end();
    }
    ffsOk = SPIFFS.begin();
    if (!ffsOk) {
      log_i("formating");
      if (!SPIFFS.format()) {
        log_e("format failed");
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
