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

/** This file contains the inter process/task communication functiions. We are using queues 
 *  to communicate between tasks. This ensures that shared data is accessed in a controlled way. 
 *  The object that is sent across queues is MSG, which holds a buffer with the actual data. 
 *  The sending task will allocate the buffer and it released by the receiving task. Pipes can 
 *  be used to accumulate bytes (e.g. from a Stream) into resonable sized messages.  
 */

/** This objects is sent across queues from one task to another. Its holds a buffer with the 
 *  actual data and some control variable. 
 */
class MSG {

public: 

  /** constructor
   */
  MSG() {
    clear();
  }
  
  /** destructor, will release also the data buffer unless it has been sent using the queue
   */
  ~MSG() {
    free();
  }
 
  enum class HINT { NONE, CONFIG, DATA, TEXT, RTCM, KEYS, SPARTN, RXMPMP, RXMQZSSL6, ESFMEAS, UBX, AT }; //!< the hint is used to determin what to do with the data

  /** conversion function from a destination type into a string
   */
  static const char* text(HINT hint) {
    static const char* text[] = { "NONE", "CONFIG", "DATA", "TEXT", "RTCM", "KEYS", "SPARTAN", "RXMPMP", "RXMQZSSL6", "ESFMEAS", "UBX", "AT", };
    size_t ix = (size_t)hint;
    return (ix < sizeof(text)/sizeof(*text)) ? text[ix] : "??";
  }

  enum class SRC { NONE, WLAN, LTE, LBAND, GNSS, BLUETOOTH, WEBSOCKET, WIRE, CANBUS, NUM }; //!< the source types
  
  /** conversion function from a source type into a string
   */
  static const char* text(SRC src) {
    static const char* text[] = { "none", "WLAN", "LTE", "LBAND", "GNSS", "BLUETOOTH", "WEBSOCKET", "WIRE", "CANBUS", };
    size_t ix = (size_t)src;
    return (ix < sizeof(text)/sizeof(*text)) ? text[ix] : "??";
  }

  /** constructor, that initializes from existing data (allocates own buffer and takes a copy of the data)
   *  \param ptr   data
   *  \param size  the size of data
   *  \prama src   the origin of this data
   *  \prama hint  the hint for the data content 
   */
  MSG(const void* ptr, size_t size, SRC src, HINT hint) {
    init(ptr, size, src, hint);
  }
  
  /** constructor, that initializes from existing string (allocates own buffer and takes a copy of the data)
   *  \param string  the text data
   *  \prama src     the origin of this data
   *  \prama hint    the hint for the data content
   */
  MSG(const char* string, SRC src, HINT hint) {
    size_t len = (NULL != string) ? strlen(string) : 0;
    init(string, len, src, hint);
  }
  
  /** constructor, that allocates a buffer for certain size
   *  \param size  the size to reserve for data, allocated but uninitialized
   *  \prama src   the origin of this data
   *  \prama hint  the hint for the data content  
   */
  MSG(size_t size, SRC src, HINT hint) {
    init(NULL, size, src, hint);
  }

  /** is the message buffer valid/filled
   *  \return  true if data buffer is sucessfully allocated
   */
  operator bool() const {
    return data != NULL;
  }

  /** dump the message to a string
   *  \return  the object dumped as string 
   */
  operator String() const {
    return dump();
  }

  /** dump the message to a string
   *  \param maxLength  maximum line length
   *  \return           the object dumped as string 
   */
  String dump(int maxLength = 100) const {
    char string[maxLength];
    int len = snprintf(string, sizeof(string), "src %s hint %s size %d data", 
              text(src), text(hint), size);
    if (NULL == data) {
      len += snprintf(&string[len], sizeof(string) - len, " null");
    } else if (hint == HINT::TEXT) {
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

  /** message buffer alloc function
   *  \param len  the buffer size
   *  \return     sucess of failure of memory alloc
   */
  bool malloc(size_t len) {
    data = (uint8_t*)::malloc(len);
    size = (NULL != data) ? len : 0;
    return (NULL != data);
  }         

  /** message buffer resize
   *  \param newSize  the new buffer size
   *  \return         sucess of failure of the buffer realloc/resize
   */
  bool resize(size_t newSize) {
    if (size != newSize) {
      uint8_t* newData = (uint8_t*)::realloc(data, newSize);
      if (NULL != newData) {
        data = newData;
        size = newSize;
      }
    }
    return (size == newSize);
  }

  /** Free the buffer and clear it
   */
  void free(void) {
    if (NULL != data) {
      ::free(data);
      clear(); 
    }
  }
  
  /** Just clear the message, this just detaches the pointer without freeing 
   */
  void clear(void) {
    data = NULL;
    size = 0;
    src = SRC::NONE;
    hint = HINT::NONE; 
  }

  /** safely write some data to the message's buffer from an index  
   *  \param ptr    the data to write
   *  \param len    the length of the data to write
   *  \param index  the offset to write at 
   *  \return       the data actually written
   */
  int write(const void* ptr, size_t len, size_t index = 0){
    if ((index + len) > size) {
      len = (index < size) ? size - index : 0;
    }
    if (0 < len) {
      memcpy(&data[index], ptr, len);
    }
    return len;
  }
  
  uint8_t*    data;  //!< data buffer 
  size_t      size;  //!< size of the data
  SRC          src;  //!< origin of the data
  HINT        hint;  //!< what to do with the data, bit fields with desitnatiosn set

protected:

  /** Used to init the object, allocates the buffer and takes a copy of the data
   *  \param ptr    data
   *  \param size   the size of data
   *  \prama _src   the origin of this data
   *  \prama _dest  hint for the data content 
   */
  void init(const void* ptr, size_t len, SRC _src, HINT _dest) {
    if (malloc(len)) {
      if (NULL != ptr) {
        memcpy(data, ptr, len);
      }
      src = _src;
      hint = _dest;
    } else {
      src = SRC::NONE;
      hint = HINT::NONE;
    }
  }
  
};

/** A queue creates a safe way of communication between two tasks 
 */
class QUEUE {

public: 

  /** constructor
   *  \param num   size of the queue
   *  \param hint  the destination of thsi queue
   */
  QUEUE(size_t num) {
    queue = xQueueCreate(num, sizeof(MSG));
    minFree = num;
  }

  /** destructor
   */
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

  /** send a message to another task, put at the end of the queue
   *  \param msg    the message to be sent 
   *  \param ticks  number of os ticks to wait, 0 to return immediately, omit for blocking 
   *  \return       send success
   *  
   *  \note buffer will be detached if send is successful, will be freed by receiving task 
   */
  bool send(MSG &msg, TickType_t ticks = portMAX_DELAY) {
    if ((NULL != queue) && msg) {
      log_v("%s", msg.dump().c_str());
      if (xQueueSendToBack(queue, &msg, ticks) == pdTRUE) {
        msg.clear(); // the msg with its data is now in the queue, wipe it
        return true;
      }
    }
    log_e("ticks %d dropped %s", ticks, msg.dump().c_str());
    return false;
  }

  /** send a message to another task, put at the front of the queue
   *  \param msg    the message to be sent 
   *  \param ticks  number of os ticks to wait, 0 to return immediately, omit for blocking 
   *  \return       send success
   *  
   *  \note buffer will be detached if send is successful, will be freed by receiving task 
   */
  bool sendFront(MSG &msg, TickType_t ticks = portMAX_DELAY) {
    if ((NULL != queue) && msg) {
      log_v("%s", msg.dump().c_str());
      if (xQueueSendToFront(queue, &msg, ticks) == pdTRUE) {
        msg.clear(); // the msg with its data is now in the queue, wipe it
        return true;
      }
    }
    log_e("ticks %d dropped %s", ticks, msg.dump().c_str());
    return false;
  }

  /** send a message to another task, put at the front of the queue (= high priority)
   *  \param msg    the message to be sent 
   *  \return       send success
   *  
   *  \note buffer will be detached if send is successful, will be freed by receiving task 
   */
  bool sendFrontIsr(MSG &msg) {
    if ((NULL != queue) && msg) {
      BaseType_t taskYield = pdFALSE;
      if (xQueueSendToFrontFromISR(queue, &msg, &taskYield) == pdTRUE) {
        msg.clear(); // the msg with its data is now in the queue, wipe it
        if(taskYield) {
           portYIELD_FROM_ISR();
        }
        return true;
      }
    }
    return false;
  }
  
  /** receive a message from another task
   *  \param msg    the message received 
   *  \param ticks  number of os ticks to wait, 0 to return immediately, omit for blocking 
   *  \return       receive success
   *  
   *  \note buffer will be detached if send is successful, will be freed by receiving task 
   */
  bool receive(MSG &msg, TickType_t ticks = portMAX_DELAY) {
    // first relase any buffer still attached to the msg
    msg.free();
    if (NULL != queue) {
      uint8_t avail = uxQueueSpacesAvailable(queue);
      if (avail < minFree) {
        minFree = avail;
      }
      if (xQueueReceive(queue, &msg, ticks) == pdTRUE){
        return true;
      }
    }
    return false;
  }

  /** get the minimum number of free slots in this queue
   *  \return  the min number fo free element in the queue
   */
  uint8_t getMinFree(void) {
    return minFree;
  }
protected:

  xQueueHandle queue;   //!< the queue 
  uint8_t minFree;      //!< the min number of queue elements
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

  /** constructor
   *  \param queue  the queue to attach 
   *  \prama src    the origin of this data
   *  \prama hint   the destination for this data   
   */
  PIPE(QUEUE &queue, MSG::SRC src, MSG::HINT hint) : wrSrc{src}, wrDest{hint} {
    pQueue = &queue;
    wrIndex = 0; 
#ifndef PIPE_PRINT
    rdIndex = 0;
#endif
  }

  /** destructor
   */
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
 
  /** The character written is passed into the pipe buffer
   *  \param ch  character to write
   *  \return    the bytes written
   */ 
  size_t write(uint8_t ch) override { 
    return write(&ch, 1);
  }
  
  /** all data written is passed into the pipe buffer
   *  \param ptr   pointer to buffer to write
   *  \param size  number of bytes in ptr to write
   *  \return      the bytes written
   */ 
  size_t write(const uint8_t *data, size_t size) override { 
    size_t wrote = 0;
    while (0 < size) { 
      // check if we have already memory 
      if (NULL == wr.data) {
        // just allocate at least a minimal sized memory
        size_t allocSize = (size > minAllocSize) ? size : minAllocSize;
        wr.src = wrSrc;
        wr.hint = wrDest;
        // ok this failed, retry with a smaller chunk
        if (!wr.malloc(allocSize) && (minAllocSize < allocSize)) {
          if (!wr.malloc(minAllocSize)) {
            // dropping bytes here
            log_e("dropping %d", size);
            size = 0;
          }
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

  /** space availble in current pipe buffer without potentially blocking
   *  \return  number fo bytes free, 
  */
  int availableForWrite(void) override {
    // for sure we can write what is left free in our local buffer 
    return (NULL != wr.data) ? wr.size - wrIndex : 0;
  }
  
  /** override flush functions of the stream interface, this places the pipe buffer into the queue
   */
  void flush(void) override { 
    if (0 < wrIndex) {      // check if we have any pending data
      if (wrIndex < wr.size) {
        wr.resize(wrIndex); // adjust the data size
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
  
  const size_t minAllocSize = 3072;   //!< min size to alloc when writing small bits of data
  QUEUE* pQueue;                      //!< pointer to the attache queue
  MSG wr;                             //!< the write message object
  size_t wrIndex;                     //!< the written index in the buffer of the write object
  const MSG::SRC wrSrc;               //!< the source of this pipe
  const MSG::HINT wrDest;             //!< the destination for this pipe
#ifndef PIPE_PRINT
  MSG rd;                             //!< the read message object
  size_t rdIndex;                     //!< the read index in the buffer of the read object
  const int BAD_CH = -1;              //!< char to return in case of no data. 
#endif
};

// Websocket is a low priority task make sure we can hold enough messages
QUEUE queueToCommTask(15);                                      //!< queue into Websocket Task
PIPE pipeSerialToCommTask(queueToCommTask,  MSG::SRC::LTE,  MSG::HINT::AT);   //!< Stream interface from Serial used by Lte
PIPE pipeWireToCommTask(queueToCommTask,    MSG::SRC::WIRE, MSG::HINT::UBX);  //!< Stream interface from Wire used by GNSS, LBAND

#endif // __IPC_H__
