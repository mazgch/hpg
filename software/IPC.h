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

class ELEMENT {

public: 

  ELEMENT() {
    clear();
  }
  
  ~ELEMENT() {
    free();
  }

  typedef enum { NOCONTENT, TEXT, BINARY, KEYS, CORRECTIONS, CONFIG } CONTENT;
  
  static const char* text(CONTENT content) {
    static const char* text[] = { "none", "TEXT", "BINARY", "KEYS", "CORRECTIONS", "CONFIG" };
    return (content < sizeof(text)/sizeof(*text)) ? text[content] : "??";
  }
  
  typedef enum { NOSOURCE, WLAN, LTE, LBAND, GNSS, BLUETOOTH, WEBSOCKET, UART, CANBUS, APP } SOURCE;
  
  static const char* text(SOURCE source) {
    static const char* text[] = { "none", "WLAN", "LTE", "LBAND", "GNSS", "BLUETOOTH", "WEBSOCKET", "UART",  "CANBUS", "APP" };
    return (source < sizeof(text)/sizeof(*text)) ? text[source] : "??";
  }

  String dump(int maxLength = 100) {
    char string[maxLength];
    int len = snprintf(string, sizeof(string), "source %d-%s content %d-%s size %d data", source, text(source), content, text(content), size);
    if (NULL == data) {
      len += snprintf(&string[len], sizeof(string) - len, " null");
    } else if (content == TEXT) {
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
    return String(string);
  }

  ELEMENT(const uint8_t* data, size_t size, SOURCE source, CONTENT content = BINARY) {
    init(data, size, source, content);
  }
  
  ELEMENT(const char* string, SOURCE source) {
    size_t len = strlen(string);
    init((const uint8_t*)string, len, source, TEXT);
  }
  
  ELEMENT(SOURCE source, size_t size, CONTENT content = BINARY) {
    init(NULL, size, source, content);
  }
  
  uint8_t* malloc(size_t length) {
    data = new uint8_t[length];
    size = (NULL != data) ? length : 0;
    return data;
  }

  void free(void) {
    if (NULL != data) {
      delete [] data;
      clear(); 
    }
  }
  
  void clear(void) {
    data = NULL;
    size = 0;
    source = NOSOURCE;
    content = NOCONTENT; 
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
  SOURCE source; 

protected:

  void init(const uint8_t* _data, size_t _size, SOURCE _source, CONTENT _content) {
    malloc(_size);
    if (NULL != data) {
      if (NULL != _data) {
        memcpy(data, _data, _size);
      }
      source = _source;
      content = _content;
    } else {
      source = NOSOURCE;
      content = NOCONTENT;
    }
  }
};

class QUEUE {

public: 

  QUEUE(size_t num) {
    queue = xQueueCreate(num, sizeof(ELEMENT));
  }

  ~QUEUE() {
    if (NULL != queue) {
      ELEMENT element;
      // remove all elements from the queue
      while (xQueueReceive(queue, &element, 0) == pdTRUE) {
        element.free();
      }
      vQueueDelete(queue);
    }
    queue = NULL;
  }

  bool send(ELEMENT &element, TickType_t ticks = portMAX_DELAY) {
    if ((NULL != queue) && (xQueueSendToBack(queue, &element, ticks) == pdTRUE)) {
      element.clear(); // the element with its data is now in the queue, wipe it
      return true;
    }
    return false;
  }

  bool sendFront(ELEMENT &element, TickType_t ticks = portMAX_DELAY) {
    if ((NULL != queue) && (xQueueSendToFront(queue, &element, ticks) == pdTRUE)) {
      element.clear(); // the element with its data is now in the queue, wipe it
      return true;
    }
    return false;
  }
  
  bool receive(ELEMENT &element, TickType_t ticks = portMAX_DELAY) {
    // first relase any buffer still attached to the element
    element.free();
    if ((NULL != queue) && (xQueueReceive(queue, &element, ticks) == pdTRUE)) {
      return true;
    }
    return false;
  }

  inline TickType_t ms2ticks(int ms) {
    return (ms != INT_MAX) ? pdMS_TO_TICKS(ms) : portMAX_DELAY;
  }
 
protected:

  xQueueHandle queue;

};

#define PIPE_PRINT //!< enable this to remove the Stream read interface

/** You can attach a PIPE to a QUEUE and this allos you to read and write like a buffered loopback stream 
 *  only one task should write and read this stream.
 */
#ifndef PIPE_PRINT
class PIPE : public Stream {
#else
class PIPE : public Print {
#endif

public: 

  PIPE(QUEUE &queue, ELEMENT::SOURCE source, ELEMENT::CONTENT content = ELEMENT::CONTENT::BINARY) : wrSource{source}, wrContent{content} {
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
        wr.source = wrSource;
        wr.content = wrContent;
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
      } else if (wrIndex == wr.size) {
        if (!pQueue->send(wr, portMAX_DELAY)) {
          // we tried waiting forever for the queue to get empty but it still failed
          // so drop it and finish the whole write command, wrote may be wrong in this case
          wr.free();
          size = 0;
        }
        wrIndex = 0;
      } else {
        // we can't write likely wo did not get memory, lets be nice and yield for a while until we can allocate again
        vTaskDelay(pdMS_TO_TICKS(1));
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
      wr.size = wrIndex;    // adjust the data size 
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
  
  const size_t minAllocSize = 256;
  const size_t maxAllocSize = 2048;
  QUEUE* pQueue;
  ELEMENT wr;
  size_t wrIndex;
  const ELEMENT::SOURCE wrSource;
  const ELEMENT::CONTENT wrContent;
#ifndef PIPE_PRINT
protected: 
  ELEMENT rd;
  size_t rdIndex;
  const int BAD_CH = -1; 
#endif
};

#if 1
void testQueuePipe(void) {
  log_i("start %d", ESP.getFreeHeap());
  {
    const uint8_t binData[] = { 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F };
    const char* txtData = "The quick brown fox jumps over the lazy dog!";
    QUEUE  gps2file(10); 
    PIPE   pipeGpstoFile(gps2file, ELEMENT::SOURCE::GNSS, ELEMENT::CONTENT::BINARY);
    PIPE   pipeLtetoFile(gps2file, ELEMENT::SOURCE::LTE,  ELEMENT::CONTENT::TEXT);
    
    log_i("create %d", ESP.getFreeHeap());
    ELEMENT element;
    ELEMENT txtElem(txtData, ELEMENT::SOURCE::LTE);
    ELEMENT binElem(binData, sizeof(binData), ELEMENT::SOURCE::GNSS);
    log_i("%s", element.dump().c_str());
    log_i("%s", txtElem.dump().c_str());
    log_i("%s", binElem.dump().c_str());
  
    log_i("send %d", ESP.getFreeHeap());
    gps2file.send(element);
    gps2file.send(txtElem);
    gps2file.send(binElem);
    log_i("%s", element.dump().c_str());
    log_i("%s", txtElem.dump().c_str());
    log_i("%s", binElem.dump().c_str());
    
    log_i("read %d", ESP.getFreeHeap());
    while (gps2file.receive(element, 0)) {
      log_i("%s", element.dump().c_str());
    }
    log_i("%s", element.dump().c_str());
    
    log_i("print %d", ESP.getFreeHeap());
    pipeLtetoFile.print(txtData);
    pipeGpstoFile.write(binData, sizeof(binData));
    pipeLtetoFile.print(txtData);
    pipeGpstoFile.write(binData, sizeof(binData));
    for (size_t ix = 0; ix < sizeof(binData) * 1; ix ++) {
      pipeGpstoFile.write(binData[ix % sizeof(binData)]);
    }
    for (size_t ix = 0; ix < 6; ix ++) {
      pipeLtetoFile.print(txtData);
      pipeGpstoFile.write(binData, sizeof(binData));
    }
    log_i("flush %d", ESP.getFreeHeap());
    pipeLtetoFile.flush();
    pipeGpstoFile.flush();

    log_i("read %d", ESP.getFreeHeap());
    while (gps2file.receive(element, 0)) {
      log_i("%s", element.dump().c_str());
    }
    log_i("%s", element.dump().c_str());
    
#ifndef PIPE_PRINT
    const char* txtData2 = "The five boxing wizards jump quickly!";
    log_i("stream %d", ESP.getFreeHeap());
    pipeLtetoFile.print(txtData2);
    pipeLtetoFile.flush();
    String str = pipeLtetoFile.readStringUntil('j') + "j";
    pipeLtetoFile.print(txtData2);
    pipeLtetoFile.flush();
    String str2 = pipeLtetoFile.readStringUntil('!') + "!";
    String str3 = pipeLtetoFile.readStringUntil('!') + "!";
    log_i("pipe read \"%s\" \"%s\" \"%s\"", str.c_str(), str2.c_str(), str3.c_str());
#endif
      
    log_i("read %d", ESP.getFreeHeap());
    while (gps2file.receive(element, 0)) {
      log_i("%s", element.dump().c_str());
    }
    log_i("%s", element.dump().c_str());
    
    log_i("done %d", ESP.getFreeHeap());
  }
  log_i("end %d", ESP.getFreeHeap());
}
#endif

QUEUE queueToBluetooth(10);
PIPE pipeToBluetooth(queueToBluetooth, ELEMENT::SOURCE::GNSS);

QUEUE queueToGnss(20);
PIPE lbandToGnss(queueToGnss, ELEMENT::SOURCE::LBAND);
PIPE wlanToGnss(queueToGnss,  ELEMENT::SOURCE::WLAN);
PIPE lteToGnss(queueToGnss,   ELEMENT::SOURCE::LTE);

#endif // __IPC_H__
