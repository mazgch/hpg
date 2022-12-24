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
 
#ifndef __IPC_H__
#define __IPC_H__

class MSG {

public: 

  MSG() {
    clear();
  }
  
  ~MSG() {
    free();
  }

  enum class CONTENT { NONE, TEXT, BINARY, KEYS, CORRECTIONS, CONFIG, NUM };
  
  static const char* text(CONTENT content) {
    static const char* text[] = { "none", "TEXT", "BINARY", "KEYS", "CORRECTIONS", "CONFIG" };
    size_t ix = (size_t)content;
    return (ix < sizeof(text)/sizeof(*text)) ? text[ix] : "??";
  }
  
  enum class SRC { NONE, WLAN, LTE, LBAND, GNSS, BLUETOOTH, WEBSOCKET, SDCARD, UART, CANBUS, APP, NUM };
  
  static const char* text(SRC src) {
    static const char* text[] = { "none", "WLAN", "LTE", "LBAND", "GNSS", "BLUETOOTH", "WEBSOCKET", "SDCARD", "UART",  "CANBUS", "APP" };
    size_t ix = (size_t)src;
    return (ix < sizeof(text)/sizeof(*text)) ? text[ix] : "??";
  }

  MSG(const void* ptr, size_t size, SRC src, CONTENT content = CONTENT::BINARY) {
    init(ptr, size, src, content);
  }
  
  MSG(const char* string, SRC src, CONTENT _content = CONTENT::TEXT) {
    size_t len = (NULL != string) ? strlen(string) : 0;
    init(string, len, src, _content);
  }
  
  MSG(size_t size, SRC src, CONTENT content = CONTENT::BINARY) {
    init(NULL, size, src, content);
  }
  
  operator bool() const {
    return data != NULL;
  }

  operator String() const {
    return dump();
  }

  String dump(int maxLength = 100) const {
    char string[maxLength];
    int len = snprintf(string, sizeof(string), "src %s content %s size %d data", 
              text(src), text(content), size);
    if (NULL == data) {
      len += snprintf(&string[len], sizeof(string) - len, " null");
    } else if (content == CONTENT::TEXT) {
      if (sizeof(string) - (len + 4/* space, 2 quotes and \0 */) >= size) {
        len += snprintf(&string[len], sizeof(string) - len, " \"%.*s\"", size, data);
      } else {
        len += snprintf(&string[len], sizeof(string) - len, " \"%.*s...\"", sizeof(string) - 
                (len + 7/* space, 2 quotes, 3 dots and \0 */), data);
      } 
    } else {
      size_t ix = 0;
      while (((ix < size) && (sizeof(string) - 7 >= len)) || (ix + 1 == size)) { // 
        len += snprintf(&string[len], sizeof(string) - len, " %02X", data[ix++]);
      }
      if (ix < size) {
        len += snprintf(&string[len], sizeof(string) - len, "...");
      }
    }
    return string;
  }

  void malloc(size_t len) {
    data = (uint8_t*)::malloc(len);
    size = (NULL != data) ? len : 0;
  }         

  void shrink(size_t newSize) {
    uint8_t* newData = (uint8_t*)::realloc(data, newSize);
    if (NULL != newData) {
      data = newData;
      size = newSize;
    }
  }

  void free(void) {
    if (NULL != data) {
      ::free(data);
      clear(); 
    }
  }
  
  void clear(void) {
    data = NULL;
    size = 0;
    src = SRC::NONE;
    content = CONTENT::NONE; 
  }

  int write(const void* ptr, size_t len, size_t index = 0){
    if ((index + len) > size) {
      len = (index < size) ? size - index : 0;
    }
    if (0 < len) {
      memcpy(&data[index], ptr, len);
    }
    return len;
  }
  
  uint8_t* data;
  size_t size;
  CONTENT content;
  SRC src; 

protected:

  void init(const void* ptr, size_t len, SRC _src, CONTENT _content) {
    malloc(len);
    if (NULL != data) {
      if (NULL != ptr) {
        memcpy(data, ptr, len);
      }
      src = _src;
      content = _content;
    } else {
      src = SRC::NONE;
      content = CONTENT::NONE;
    }
  }
  
};

class QUEUE {

public: 

  QUEUE(size_t num, MSG::SRC _dest) {
    queue = xQueueCreate(num, sizeof(MSG));
    dest = _dest;
  }

  ~QUEUE() {
    if (NULL != queue) {
      MSG msg;
      // remove all msgs from the queue
      while (xQueueReceive(queue, &msg, 0) == pdTRUE) {
        msg.free();
      }
      vQueueDelete(queue);
    }
    queue = NULL;
  }

  bool send(MSG &msg, TickType_t ticks = portMAX_DELAY) {
    if ((NULL != queue) && msg) {
      log_v("dest %s %s", MSG::text(dest), msg.dump().c_str());
      if (xQueueSendToBack(queue, &msg, ticks) == pdTRUE) {
        msg.clear(); // the msg with its data is now in the queue, wipe it
        return true;
      }
    }
    log_e("dest %s dropped %s", MSG::text(dest), msg.dump().c_str());
    return false;
  }

  bool sendFront(MSG &msg, TickType_t ticks = portMAX_DELAY) {
    if ((NULL != queue) && msg) {
      log_v("dest %s %s", MSG::text(dest), msg.dump().c_str());
      if (xQueueSendToFront(queue, &msg, ticks) == pdTRUE) {
        msg.clear(); // the msg with its data is now in the queue, wipe it
        return true;
      }
    }
    log_e("dest %s dropped %s", MSG::text(dest), msg.dump().c_str());
    return false;
  }
  
  bool receive(MSG &msg, TickType_t ticks = portMAX_DELAY) {
    // first relase any buffer still attached to the msg
    msg.free();
    if (NULL != queue) {
      if (xQueueReceive(queue, &msg, ticks) == pdTRUE){
        log_v("dest %s %s", MSG::text(dest), msg.dump().c_str());
        return true;
      }
    }
    return false;
  }
 
protected:

  xQueueHandle queue;
  MSG::SRC dest;
  
};

//#define PIPE_PRINT //!< enable this to remove the Stream read interface

/** You can attach a PIPE to a QUEUE and this allos you to read and write like a buffered loopback stream 
 *  only one task should write and read this stream.
 */
#ifndef PIPE_PRINT
class PIPE : public Stream {
#else
class PIPE : public Print {
#endif

public: 

  PIPE(QUEUE &queue, MSG::SRC src, MSG::CONTENT content = MSG::CONTENT::BINARY) : wrSrc{src}, wrContent{content} {
    pQueue = &queue;
    wrIndex = 0; 
#ifndef PIPE_PRINT
    rdIndex = 0;
#endif
  }

  ~PIPE() {
    wr.free();
    wrIndex = 0;
#ifndef PIPE_PRINT
    do {
      rd.free();
    } while (pQueue->receive(rd, 0));
    rdIndex = 0;
#endif
  }

  // --------------------------------------------------------------------------------------
  // Print interface: https://github.com/arduino/ArduinoCore-API/blob/master/api/Print.h
  // --------------------------------------------------------------------------------------
 
  size_t write(uint8_t ch) override { 
    return write(&ch, 1);
  }
  
  size_t write(const uint8_t *data, size_t size) override { 
    size_t wrote = 0;
    while (0 < size) { 
      // check if we have already memory 
      if (NULL == wr.data) {
        // just allocate at least a minimal sized memory
        size_t allocSize = (size > minAllocSize) ? size : minAllocSize;
        wr.malloc(allocSize);
        // ok this failed, retry with a smaller chunk
        if ((NULL == wr.data) && (maxAllocSize < allocSize)) {
          wr.malloc(maxAllocSize);
        }
        wr.src = wrSrc;
        wr.content = wrContent;
        if (NULL == wr.data) {
          // dropping bytes here
          log_e("dropping %d", size);
          size = 0;
        }
      }
      size_t len = wr.size - wrIndex;     // limit available space in memory
      len = (size < len) ? size : len; // limnit to size we need to write
      if (0 < len) {
        // copy the data and advance data, and size to write
        memcpy(&wr.data[wrIndex], data, len);
        data += len;
        size -= len;
        wrote += len;  // keep track of total bytes added 
        wrIndex += len;  // increment the data index
        // if buffer is full then, flush it to add it to the queue
        if ((wrIndex == wr.size) && (0 == size)) {
          // try to send it but do not block
          if (pQueue->send(wr, 0)) {
            wrIndex = 0;
          }
        }
      } else if ((NULL != wr.data) && (wrIndex == wr.size)) {
        if (!pQueue->send(wr, portMAX_DELAY)) {
          // we tried waiting forever for the queue to get empty but it still failed
          // so drop it and finish the whole write command, wrote may be wrong in this case
          wr.free();
          size = 0;
        }
        wrIndex = 0;
      }
    } 
    return wrote; 
  }

  int availableForWrite(void) override {
    // for sure we can write what is left free in our local buffer 
    return (NULL != wr.data) ? wr.size - wrIndex : 0;
  }
  
  /** override flush functions of the stream interface 
   */
  void flush(void) override { 
    if (0 < wrIndex) {      // check if we have any pending data
      if (wrIndex < wr.size) {
        wr.shrink(wrIndex); // adjust the data size
      }
      if (!pQueue->send(wr, portMAX_DELAY)) {
        // we tried waiting forever for the queue to get empty but it still failed, so drop it
        wr.free();
      }
      wrIndex = 0;
    }
  }

#ifndef PIPE_PRINT
  // --------------------------------------------------------------------------------------
  // Stream interface: https://github.com/arduino/ArduinoCore-API/blob/master/api/Stream.h
  // --------------------------------------------------------------------------------------
 
  /** override available functions of the stream interface 
   *  \return  nothing available
   */
  int available(void) override {
    if (NULL == rd.data) {
      pQueue->receive(rd, pdMS_TO_TICKS(_timeout));
    }
    return rd.size - rdIndex;
  }
  
  /** override read functions of the stream interface 
   *  \return  the character
   */
  int read(void) override {
    int ch;
    if (0 == available()) {
      ch = BAD_CH;
    } else {
      // read the character
      ch = rd.data[rdIndex++];
      if (rdIndex == rd.size) {
        // if we have consumed it all, free the data 
        rd.free();
        rdIndex = 0;
      }
    }
    return ch;
  }
  
  /** override peek functions of the stream interface 
   *  \return  a bad character
   */
  int peek(void) override { 
    // read the character
    int ch;
    if (0 == available()) {
      ch = BAD_CH;
    } else {
      // peek a character
      ch = rd.data[rdIndex];
    }
    return ch;
  }  
#endif
  
protected: 
  
  const size_t minAllocSize = 512;
  const size_t maxAllocSize = 2048;
  QUEUE* pQueue;
  MSG wr;
  size_t wrIndex;
  const MSG::SRC wrSrc;
  const MSG::CONTENT wrContent;
#ifndef PIPE_PRINT
protected: 
  MSG rd;
  size_t rdIndex;
  const int BAD_CH = -1; 
#endif
};

QUEUE queueToBluetooth(10,                  MSG::SRC::BLUETOOTH);
PIPE pipeGnssToBluetooth(queueToBluetooth,  MSG::SRC::GNSS); // using Gnss::rx.setNMEAOutputPort

QUEUE queueToWebsocket(30,                  MSG::SRC::WEBSOCKET);
PIPE pipeGnssToWebsocket(queueToWebsocket,  MSG::SRC::GNSS); // using Gnss::rx.setOutputPort Lband::rx.setOutputPort 

QUEUE queueToSdcard(30,                     MSG::SRC::SDCARD);
PIPE pipeWireToSdcard(queueToSdcard,        MSG::SRC::GNSS);
PIPE pipeSerialToSdcard(queueToSdcard,      MSG::SRC::LTE);

QUEUE queueToGnss(20,                       MSG::SRC::GNSS); // used by LTE, WLAN, BLUETOOTH and CONFIG to inject data to the GNSS

#endif // __IPC_H__
