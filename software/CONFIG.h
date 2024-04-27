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

// -----------------------------------------------------------------------
// MQTT / PointPerfect settings 
// -----------------------------------------------------------------------

/** settings for ZTP request that use HTTPS protocol  
 */
#define    THINGSTREAM_SERVER     "api.thingstream.io"            //!< the thingstream Rest API server domain        
#define    THINGSTREAM_ZTPPATH    "/ztp/pointperfect/credentials" //!< ZTP rest api
const char THINGSTREAM_ZTPURL[]   = "https://" THINGSTREAM_SERVER THINGSTREAM_ZTPPATH; // full ZTP url

/** settings for Amazon root CA request (not really needed, as long as we dont verify the certificates)  
 */
#define    AWSTRUST_SERVER        "www.amazontrust.com"             //!< the AWS trust server domain    
#define    AWSTRUST_ROOTCAPATH    "/repository/AmazonRootCA1.pem"   //!< the AWS root CA path
const char AWSTRUST_ROOTCAURL[]   = "https://" AWSTRUST_SERVER AWSTRUST_ROOTCAPATH; // full AWS root CA url

/** this table defines the recional coverage (by a bounding box and its region tag and frequency
 *  the lower the higher the priority and more targeted the lat/lon region should be
 *  PointPerfect LBAND satellite augmentation service EU / US LBAND frequencies taken from: 
 *  https://developer.thingstream.io/guides/location-services/pointperfect-service-description
 */
struct { const char* region; short lon1; short lon2; short lat1; short lat2; long freq; } POINTPERFECT_REGIONS[] = {
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

const unsigned short MQTT_BROKER_PORT     =              8883;  //!< MQTTS port
const int MQTT_MAX_MSG_SIZE               =            9*1024;  //!< the max size of a MQTT pointperfect topic

#define MQTT_TOPIC_MGA                          "/pp/ubx/mga"   //!< GNSS assistance topic 
const char MQTT_TOPIC_KEY_FORMAT[]        =   "/pp/ubx/0236/";  //!< LBAND decryption keys topic
const char MQTT_TOPIC_FREQ[]           = "/pp/frequencies/Lb";  //!< LBAND frequency topic 
const char MQTT_TOPIC_IP_FORMAT[]         =            "/pp/";  //!< correction stream topic prefix, format: /pp/<stream>/<region>/<msg>

const char MQTT_TOPIC_IP_GAD[]            =            "/gad";  //!< geographic area defintion
const char MQTT_TOPIC_IP_HPAC[]           =           "/hpac";  //!< high precision atmospheric corrections
const char MQTT_TOPIC_IP_OCB[]            =            "/ocb";  //!< orbit, clock and bias
const char MQTT_TOPIC_IP_CLK[]            =            "/clk";  //!< clock correction

const char MQTT_STREAM_LBAND[]            =              "Lb";  //!< LBAND stream identifier 
const char MQTT_STREAM_IP[]               =              "ip";  //!< IP stream identifier

const char MQTT_TOPIC_MGA_GPS[]       = MQTT_TOPIC_MGA "/gps";  //!< GPS (US)
const char MQTT_TOPIC_MGA_GLO[]       = MQTT_TOPIC_MGA "/glo";  //!< Glonass (RU)
const char MQTT_TOPIC_MGA_GAL[]       = MQTT_TOPIC_MGA "/gal";  //!< Galileo (EU)
const char MQTT_TOPIC_MGA_BDS[]       = MQTT_TOPIC_MGA "/bds";  //!< Beidou (CN)

// -----------------------------------------------------------------------
// NTRIP settings 
// -----------------------------------------------------------------------

const int NTRIP_GGA_RATE                  =             20000;  //!< rate at which we send GGA messages 
const int NTRIP_CONNECT_TIMEOUT           =              5000;  //!< initial response timeout 
const unsigned short NTRIP_SERVER_PORT    =              2101;  //!< NTRIP default port
const char* NTRIP_VERSION_1               =       "Ntrip/1.0";  //!< NTRIP version 1
const char* NTRIP_VERSION_2               =       "Ntrip/2.0";  //!< NTRIP version 2 
const char* NTRIP_VERSION                 =   NTRIP_VERSION_2;  //!< the NTRIP version to use 
#define NTRIP_USE_HTTP10                                false   //!< set true if HTTP 1.0 should be used

// -----------------------------------------------------------------------
// CONFIGURATION keys
// -----------------------------------------------------------------------

#define    CONFIG_DEVICE_TITLE                 "HPG solution"   //!< a used friendly name
#define    CONFIG_DEVICE_NAMEPREFIX                     "hpg"   //!< a hostname compatible prefix, only a-z, 0-9 and -

const char CONFIG_FFS_FILE[]              =     "/config.ffs";  //!< the file in the FFS where we store the config json
const int  CONFIG_JSON_MAXSIZE            =            7*1024;  //!< maximun size of config JSON file

// PointPerfect configuration 
const char CONFIG_VALUE_ZTPTOKEN[]        =        "ztpToken";  //!< config key for ZTP tocken
const char CONFIG_VALUE_BROKERHOST[]      =      "brokerHost";  //!< config key for brocker host
const char CONFIG_VALUE_STREAM[]          =          "stream";  //!< config key for stream
const char CONFIG_VALUE_ROOTCA[]          =          "rootCa";  //!< config key for root certificate
const char CONFIG_VALUE_CLIENTCERT[]      =      "clientCert";  //!< config key for client certificate
const char CONFIG_VALUE_CLIENTKEY[]       =       "clientKey";  //!< config key for client keys
const char CONFIG_VALUE_CLIENTID[]        =        "clientId";  //!< config key for client id

// NTRIP setting
const char CONFIG_VALUE_NTRIP_SERVER[]    =     "ntripServer";  //!< config key for NTRIP server
const char CONFIG_VALUE_NTRIP_MOUNTPT[]   = "ntripMountpoint";  //!< config key for NTRIP mount point
const char CONFIG_VALUE_NTRIP_USERNAME[]  =   "ntripUsername";  //!< config key for NTRIP user name
const char CONFIG_VALUE_NTRIP_PASSWORD[]  =   "ntripPassword";  //!< config key for NTRIP password
const char CONFIG_VALUE_NTRIP_GGA[]       =        "ntripGga";  //!< config key for current GGA sentence (temprorary)

// temporary settings
const char CONFIG_VALUE_REGION[]          =          "region";  //!< config key for current PointPerfect region (temprorary)        
const char CONFIG_VALUE_FREQ[]            =            "freq";  //!< config key for current LBAND frequency (temprorary)
const char CONFIG_VALUE_KEY[]             =           "ppKey";  //!< config key for current LBAND keys (temprorary)
const char CONFIG_VALUE_USESOURCE[]       =       "useSource";  //!< config key for current correction source in use (temprorary)

// Modem setting
const char CONFIG_VALUE_LTEAPN[]          =          "LteApn";  //!< config key for modem APN
const char CONFIG_VALUE_SIMPIN[]          =          "simPin";  //!< config key for SIM PIN
const char CONFIG_VALUE_MNOPROF[]         =      "mnoProfile";  //!< config key for modem MNO profile
                          
/** This class encapsulates all WLAN functions. 
*/
class CONFIG {
  
public:

  /** constructor
   */
  CONFIG() {
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
    wlanReconnect = false;
    lteReconnect = false;
  }

  /** get a name of the device
   *  \return the device name 
   */
  String getDeviceName(void)  { 
    return name;
  }    
  
  /** get a friendly name of the device
   *  \return the friendly device title 
   */
  String getDeviceTitle(void) { 
    return title; 
  } 
  
  /** init the file system
   *  \return  true if file system and config file is ready 
   */
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

  /** delete the configuration file from the file system  
   */
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
  
  /** save the local copy to the file system  
   *  \return  the succcess of the operation
   */
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

  /** read the config file system into the local buffer
   *  \return  the succcess of the operation
   */
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

  /** get the value of a config key  
   *  \param key  the parameter key    
   *  \return     the parameter value
   */
  String getValue(const char *key) {
    String str;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      str = json.containsKey(key) ? json[key] : String();
      xSemaphoreGive(mutex);
    }
    log_v("key %s is \"%s\"", key, str.c_str());
    return str;
  }
  
  /** set the value of a config key 
   *  \param key    the parameter key    
   *  \param value  the parameter value
   *  \return       true if value was changed
   */
  bool setValue(const char *key, String value) {
    String old;
    bool changed = false;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) { 
      old = json.containsKey(key) ? json[key] : String();
      changed = !old.equals(value);
      if (changed) {
        json[String(key)] = value;
      }
      xSemaphoreGive(mutex); 
    }
    if (changed) {
      log_v("key %s changed from \"%s\" to \"%s\"", key, old.c_str(), value.c_str()); 
    } else {
      log_v("key %s keep \"%s\" as unchanged", key, old.c_str()); 
    }
    return changed;
  } 

  /** delete the value of a config key 
   *  \param key    the parameter key    
   *  \return       true if changed, key was removed
   */
  bool delValue(const char *key) {
    bool changed = false;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      changed = json.containsKey(key);
      if (changed) {
        json.remove(key);
      }
      xSemaphoreGive(mutex); 
    }
    if (changed) {
      log_v("key %s", key);
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
      changed = setValue(key, String((const char*)encBuf)); 
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
  
  /** get the topics to subscribe  
   *  \return  a vector with all the topics
   */
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
    //topics.push_back(MQTT_TOPIC_MGA_GPS);
    //topics.push_back(MQTT_TOPIC_MGA_GLO);
    //topics.push_back(MQTT_TOPIC_MGA_GAL);
    //topics.push_back(MQTT_TOPIC_MGA_BDS);
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
  
  /** get the LBAND frequency  
   *  \return  the frequency or 0 if no suitable frequency
   */
  int getFreq(void) {
    int freq = 0;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      freq = json.containsKey(CONFIG_VALUE_FREQ) ? json[CONFIG_VALUE_FREQ] : POINTPERFECT_REGIONS[0].freq;
      xSemaphoreGive(mutex); 
    }
    return freq;
  }
  
  /** extract the lband freuqencies for all supported regions from the json buffer 
   *  \param buf  the buffer with the json message
   *  \param size the size of the json buffer
   */
  void setLbandFreqs(const uint8_t *buf, size_t size) {
    JsonDocument json;
    DeserializationError error = deserializeJson(json, buf, size);
    if (DeserializationError::Ok != error) {
      log_e("deserializeJson failed with error %d", error);
    } else {
      for (int i = 0; i < sizeof(POINTPERFECT_REGIONS)/sizeof(*POINTPERFECT_REGIONS); i ++) {
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

  /** set current location, this will set the region and LBAND frequency
   *  \param lat  the current latitude
   *  \param lon  the current longitude
   */
  void updateLocation(int lat, int lon) {
    // the highest entries have highest priority
    long freq = 0;
    const char* region = NULL;
    for (int i = 0; i < sizeof(POINTPERFECT_REGIONS)/sizeof(*POINTPERFECT_REGIONS); i ++) {
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
      xSemaphoreGive(mutex); 
    }
    if (changed) {
      log_i("region \"%s\" freq %d", region ? region : "", freq);
      save();
    }
  }
 
  /** delete the zero touch provisioning credentials
   */
  void delZtp(void) {
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      json.remove(CONFIG_VALUE_BROKERHOST);
      json.remove(CONFIG_VALUE_STREAM);
      json.remove(CONFIG_VALUE_ROOTCA);
      json.remove(CONFIG_VALUE_CLIENTCERT);
      json.remove(CONFIG_VALUE_CLIENTKEY);
      json.remove(CONFIG_VALUE_CLIENTID);
      xSemaphoreGive(mutex); 
    }
    log_i("ZTP deleted");
  }

  /** set the pointperfect credentials and certificates from the ZTP process
   *  \param ztp     the ZTP JSON response 
   *  \param rootCa  the AWS root certificate
   *  \return        the clinet id of the board
   */
  String setZtp(String &ztp, String &rootCa) {
    String id;
    JsonDocument filter;
    filter["clientId"] = true;
    filter["certificate"] = true;
    filter["privateKey"] = true;
    filter["brokerHost"] = true;
    filter["supportsLband"] = true;
    JsonDocument jsonZtp;
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
          xSemaphoreGive(mutex); 
        }
        save();
      } else {
        log_e("some json fields missing");
      }
    }
    return id;
  }

  /** create a ZTP request to be sent to thingstream JSON API
   *  \return  the ZTP request string to POST
   */
  String ztpRequest(void) {
    String token;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      token = json.containsKey(CONFIG_VALUE_ZTPTOKEN) ? json[CONFIG_VALUE_ZTPTOKEN] : String();
      xSemaphoreGive(mutex); 
    }
    String str;
    if (token.length()) {
      JsonDocument json;
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
 
  bool wlanReconnect; //!< a change in configuration happened, this is used to notify WLAN FSM
  bool lteReconnect;  //!< a change in configuration happened, this is used to notify LTE FSM

protected:
  
  /** initialize the file system 
   *  \return  sucess of operation
   */
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

  JsonDocument json;   //!< a local copy of the json buffer
  SemaphoreHandle_t mutex;    //!< protects json and FFS
  bool ffsOk;                 //!< flag if the FFS is ok
  String title;               //!< the title of the device
  String name;                //!< the name of the device
};
   
CONFIG Config; //!< The global CONFIG object

#endif // __CONFIG_H__
