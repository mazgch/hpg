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
 
#ifndef __LOG_H__
#define __LOG_H__

class LOG {
public:
  
  LOG() { 
    mutex = xSemaphoreCreateMutex();
    init();
  }

  typedef enum {
    LOG_LEVEL_NONE = 0,
    LOG_LEVEL_ERROR,
    LOG_LEVEL_WARNING,
    LOG_LEVEL_INFO,
    LOG_LEVEL_DEBUG
  } LOG_LEVEL;

  void init(LOG_LEVEL l = LOG_LEVEL_INFO, Stream* s = &Serial){
    level = l;
    stream = s;
  }
  
  int error(const char *format, ...) {
    va_list arg;
    va_start(arg, format);
    int len = vlog(LOG_LEVEL_ERROR, format, arg);
    va_end(arg);
    return len;
  }
  
  int warning(const char *format, ...) {
    va_list arg;
    va_start(arg, format);
    int len = vlog(LOG_LEVEL_WARNING, format, arg);
    va_end(arg);
    return len;
  }
  
  int info(const char *format, ...) {
    va_list arg;
    va_start(arg, format);
    int len = vlog(LOG_LEVEL_INFO, format, arg);
    va_end(arg);
    return len;
  }
  
  int debug(const char *format, ...) {
    va_list arg;
    va_start(arg, format);
    int len = vlog(LOG_LEVEL_DEBUG, format, arg);
    va_end(arg);
    return len;
  }
  
  int log(LOG_LEVEL level, const char *format, ...) {
    va_list arg;
    va_start(arg, format);
    int len = vlog(level, format, arg);
    va_end(arg);
    return len;
  }

  void poll() {
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      if (Serial.available()) {
        Serial1.write("ATE1\r\n");
        while (true) {
          if (Serial.available()) {
            char ch = Serial.read();
            Serial1.write(ch);
          }
          if (Serial1.available()) {
            char ch = Serial1.read();
            Serial.write(ch);
          }
        }
      }
      xSemaphoreGive(mutex);
    }
  }
  
protected:

  size_t vlog(LOG_LEVEL l, const char *format, va_list arg) {
    if (l <= level) {
      char temp[128];
      char* buf = temp;
      va_list arg2;
      va_copy(arg2, arg);
      size_t len = vsnprintf(buf, sizeof(temp), format, arg2);
      va_end(arg2);
      if (len > sizeof(temp)-1) {
        buf = (char *) malloc(len+1);
        if (buf) {
          len = vsnprintf(buf, len+1, format, arg);
        } else {
          len = sizeof(temp); // truncate, add elipses 
          buf = temp;
          temp[len-3] = temp[len-2] = temp[len-1] = '.';
        }
      }
      if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
        if (NULL != stream) {
          if (l <= LOG_LEVEL_WARNING) {
            HW_DBG_HI(HW_DBG_LOG_ERR);
          }
          if      (l == LOG_LEVEL_ERROR)   stream->print(F("ERROR: "));
          else if (l == LOG_LEVEL_WARNING) stream->print(F("WARNING:  "));
          else if (l == LOG_LEVEL_INFO)    stream->print(F("INFO:  "));
          else if (l == LOG_LEVEL_DEBUG)   stream->print(F("DEBUG: "));
          stream->write(buf, len);
          stream->println();
          HW_DBG_LO(HW_DBG_LOG_ERR);
        }
        xSemaphoreGive(mutex);
      }
      if (buf != temp) {
          free(buf);
      }
      return len;
    }
    return 0;
  }
  
  LOG_LEVEL level;
  Stream* stream;
  SemaphoreHandle_t mutex; // protects the access to stream 
};

LOG Log;

#endif // __LOG_H__
