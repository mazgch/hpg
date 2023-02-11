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
 
  enum class HINT { 
    NONE, CONFIG, DATA, TEXT,             // generic data
    AT, UBX, NMEA, RTCM, SPARTN, UNKNOWN, // various protocols 
    KEYS, RXMPMP, RXMQZSSL6, ESFMEAS      // specific messages
  };   //!< the hint is used to determin wha to do with the data

  /** conversion function from a destination type into a string
   */
  static const char* text(HINT hint) {
    static const char* _text[] = { 
      "NONE", "CONFIG", "DATA", "TEXT", 
      "AT", "UBX", "NMEA", "RTCM", "SPARTAN", "UNKNOWN",
      "KEYS", "RXMPMP", "RXMQZSSL6", "ESFMEAS"  
    };
    size_t ix = (size_t)hint;
    return (ix < sizeof(_text)/sizeof(*_text)) ? _text[ix] : "??";
  }

  enum class SRC { NONE, WLAN, LTE, LBAND, GNSS, BLUETOOTH, WEBSOCKET, WIRE, CANBUS, NUM }; //!< the source types
  
  /** conversion function from a source type into a string
   */
  static const char* text(SRC src) {
    static const char* _text[] = { "none", "WLAN", "LTE", "LBAND", "GNSS", "BLUETOOTH", "WEBSOCKET", "WIRE", "CANBUS", };
    size_t ix = (size_t)src;
    return (ix < sizeof(_text)/sizeof(*_text)) ? _text[ix] : "??";
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
  String dump(int maxLength = 500) const {
    char string[maxLength];
    int len = snprintf(string, sizeof(string), "src %s hint %s size %d data", 
              text(src), text(hint), size);
    if (NULL == data) {
      len += snprintf(&string[len], sizeof(string) - len, " null");
    } else if ((hint == HINT::TEXT) || (hint == HINT::NMEA)) {
      size_t dump = (hint == HINT::NMEA) ? size - 2 : size; 
      if (sizeof(string) - (len + 4/* space, 2 quotes and \0 */) >= dump) {
        len += snprintf(&string[len], sizeof(string) - len, " \"%.*s\"", dump, data);
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
   *  \prama _hint  hint for the data content 
   */
  void init(const void* ptr, size_t len, SRC _src, HINT _hint) {
    if (malloc(len)) {
      if (NULL != ptr) {
        memcpy(data, ptr, len);
      }
      src = _src;
      hint = _hint;
    } else {
      src = SRC::NONE;
      hint = HINT::NONE;
    }
  }
  
};

class PROTOCOL {

public: 
  static const size_t WAIT     = ~0;
  static const size_t NOTFOUND =  0;
  typedef size_t (*PARSE_FUNCTION)(const uint8_t *ptr, size_t size);

  static size_t parse(const uint8_t *ptr, size_t size, MSG::HINT &hint, size_t skip = 0) {
    size_t unknown = skip;
    ptr += skip;
    size -= skip;
    while (0 < size) {
      const struct { 
        PARSE_FUNCTION parseFunc;
        MSG::HINT hint; 
      } _protocols[] = {
        { parseUBX,     MSG::HINT::UBX      },
        { parseNMEA,    MSG::HINT::NMEA     },
        { parseRTCM,    MSG::HINT::RTCM     },
        { parseSPARTN,  MSG::HINT::SPARTN   }
      };  
      for (size_t prot = 0; prot < sizeof(_protocols)/sizeof(*_protocols); prot ++) {
        size_t len = _protocols[prot].parseFunc(ptr, size);
        if (len == WAIT) {
          if (0 < unknown) { 
            // there is a unknown block before, get rid of it
            hint = MSG::HINT::UNKNOWN; 
            return unknown;
          } else { 
            hint = _protocols[prot].hint;
            return WAIT;
          }
        } else if (len != NOTFOUND) {
          // we found a valid message 
          if (0 < unknown) { 
            // there is a unknown block before 
            hint = MSG::HINT::UNKNOWN; 
            return unknown;
          } else {
            hint = _protocols[prot].hint; 
            return len;
          }
        }
      }
      ptr ++;
      size --;
      unknown ++;
    }
    hint = MSG::HINT::UNKNOWN; 
    return unknown;
  }

  static size_t parseNMEA(const uint8_t *ptr, size_t size) {
    uint8_t by; 
    const uint8_t _hex[] = { '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F' };
    const size_t maxLen = 100 /* a strict sentence length is 82 chars, be tolearnt as we have extended bits  */ - 5 /* crc *XX\r\n */;
    if (0 >= size) return WAIT;
    by = ptr[0];
	  if ('$' != by) return NOTFOUND; // $, 36
    if (1 >= size) return WAIT;
    by = ptr[1];
    if (('G' != by) && ('P' != by))  return NOTFOUND;
    CRC crc = by;
    size_t len = 2;
    while (len < size) {
        if (maxLen < len) return NOTFOUND;
        by = ptr[len++];
        if ((32 > by) || (126 < by)) return NOTFOUND; // not printable
        if ('*' == by) break; // *, 42
        crc = crc ^ by;
    }
    if (len >= size) return WAIT;
    by = ptr[len++];
    if (_hex[(crc >> 4) & 0xF] != by) return NOTFOUND;
    if (len >= size) return WAIT;
    by = ptr[len++];
    if (_hex[(crc >> 0) & 0xF] != by) return NOTFOUND;
    if (len >= size) return WAIT;
    by = ptr[len++];
    if ('\r' != by) return NOTFOUND; // \r, 0x0D, 13
    if (len >= size) return WAIT;
    by = ptr[len++];
    if ('\n' != by) return NOTFOUND; // \n, 0x0A, 10
    return len;
  }

  /*template<typename T>
  bool field<T>(const uint8_t *ptr, size_t size, size_t ix, T value) {
    uint8_t* start = ptr;
    while (0 < size) {
      if (*ptr == ',' || *ptr == '*') {
        if (ix == 0) 
          ; // now field starts at start until ptr - 1;
        else if (ix == 1) {
          strtol(start, &end);
        }
      }
      ptr ++;
    }
  }*/

  static size_t parseUBX(const uint8_t *ptr, size_t size) {
    uint8_t by; 
    const size_t maxLen = 6 /* head */ + 1024 /* limit to reasonable payload (max 0xFFFF) */ + 2 /* crc */;
    if (0 >= size) return WAIT;
	  by = ptr[0];
	  if (0xB5 != by) return NOTFOUND; // = µ, 0xB5, 181
    if (1 >= size) return WAIT;
    by = ptr[1];
	  if (0x62 != by) return NOTFOUND; // = b, 0x62, 98
    if (5 >= size) return WAIT;
    const size_t len = 6 + (ptr[5] << 8) + ptr[4];
    if (maxLen < len) return NOTFOUND;
    if (len > size) return WAIT;
    uint8_t cka = 0;
	  uint8_t ckb = 0;
	  for (size_t ix = 2; ix < len; ) {
		  by = ptr[ix++];
      cka += by;
      ckb += cka;
    }
    if (len >= size) return WAIT;
    by = ptr[len];
    if (by != cka) return NOTFOUND;
    if (len + 1 >= size) return WAIT;
    by = ptr[len + 1];
    if (by != ckb) return NOTFOUND;
    return len + 2;
  }

  static inline uint16_t U2(uint8_t *ptr) {
    return (uint16_t)(ptr[1] << 8) | ptr[0]; 
  }
  
  static inline uint32_t U4(uint8_t *ptr) {
    return (uint32_t)((ptr[3] << 24) | (ptr[2] << 16) | (ptr[1] << 8) | ptr[0]); 
  }
  
  static inline int16_t I2(uint8_t *ptr) { 
    return (int16_t)U2(ptr); 
  }
  
  static inline int32_t I4(uint8_t *ptr) {
    return (int32_t)U4(ptr); 
  }

  enum class UBXCLS {
    NAV  = 0x01,  RXM  = 0x02,  INF  = 0x04,  ACK  = 0x05,  CFG  = 0x06,  UPD  = 0x09,   
    MON  = 0x0A,  AID  = 0x0B,  TIM  = 0x0D,  ESF  = 0x10,  MGA  = 0x13,  LOG  = 0x21,  
    SEC  = 0x27,  HNR  = 0x28,  NMEA = 0xF0,  PUBX = 0xF1,  RTCM = 0xF5,
  };
  
  #define _UBXID(id, cls) (((id) << 8) | (int)cls)

  enum class UBXID { 
    NAVPVT      = _UBXID(0x07, UBXCLS::NAV),    
    RXMPMP      = _UBXID(0x72, UBXCLS::RXM),  
    RXMQZSSL6   = _UBXID(0x73, UBXCLS::RXM),
    INVALID     = -1,
  };
  
  typedef struct {
    uint32_t iTOW; uint16_t year; uint8_t month; uint8_t day; 
    uint8_t hour; uint8_t min; uint8_t sec; uint8_t valid; uint32_t tAcc; int32_t nano;
    uint8_t  fixType; uint8_t flags; uint8_t flags2; uint8_t numSV; 
    int32_t lon; int32_t lat;int32_t height;int32_t hMSL; uint32_t hAcc; uint32_t vAcc;
    int32_t velN; int32_t velE; int32_t  velD; int32_t gSpeed; int32_t headMot; uint32_t sAcc; uint32_t headAcc;
    uint16_t pDOP; uint8_t flags3; uint8_t reserved0[5]; 
    int32_t headVeh; int16_t magDec; uint16_t magAcc;
  } UBXNAV_t;

  static inline UBXID ubx(const MSG &msg) {
    if ((MSG::HINT::UBX != msg.hint) || (8 > msg.size)) {
      return UBXID::INVALID;
    }
    return (UBXID)_UBXID(msg.data[3], msg.data[2]);
  }
  
  static size_t parseRTCM(const uint8_t *ptr, size_t size) {
    uint8_t by; 
    const size_t maxLen = 3 /* head */ + 0x3FF /* payload 10 bits */ + 3 /* crc */;
    if (0 >= size) return WAIT;
	  by = ptr[0];
	  if (0xD3 != by) return NOTFOUND;
	  if (1 >= size) return WAIT;
	  by = ptr[1];
	  if ((0xFC & by) != 0) return NOTFOUND;
	  size_t len = (by & 0x3) << 8;
	  if (2 >= size) return WAIT;
	  by = ptr[2];
	  len += by + 6;
	  if (maxLen < len) return NOTFOUND;
    if (len > size) return WAIT;
    CRC crc = 0; // crc allbytes including the 0xD3
    for (size_t ix = 0; ix < len; ) {
		  by = ptr[ix++];
      crc24(crc, by);
    }
    if (crc != 0) return NOTFOUND;
    return len;
  }

  static size_t parseSPARTN(const uint8_t *ptr, size_t size) {
    uint8_t by; 
    const size_t maxLen = 12 /*head*/ + 0x3FF /* payload 10 bits */ + 64 /* auth */ + 4 /* crc */;
    if (0 >= size) return WAIT;
	  by = ptr[0];
	  if (0x73 != by) return NOTFOUND; // = s, 0x73, 163
    if (3 >= size) return WAIT;
    by = ptr[1];
	  CRC crc = 0;
    crc4(crc,by);
    uint32_t lenData = (by & 1) << 9;
    by = ptr[2];
	  crc4(crc,by);
    lenData += by << 1;
    by = ptr[3];
	  crc4(crc, by & 0xF0);
    crc = (crc ^ by) & 0x0F;
    if (crc != 0) return NOTFOUND;
    lenData += (by >> 7) & 1;
    const bool e1          = (by & 0x40); // E1 encrypted
    const uint8_t crcType  = (by & 0x30) >> 4; // MCT2
     if (4 >= size) return WAIT; // must match min header message 
    by = ptr[4];
	  const bool tt1         = (by & 0x08); // TT1 ttag size 16 / 32 bits
    uint16_t lenHead = 8 + (tt1 ? 2 : 0) + (e1 ? 2 : 0);
    if (lenHead >= size) return WAIT; // must have full header 
    if (e1) {
        by = ptr[lenHead - 1];
	      const uint8_t ai3 = (by & 0x38) >> 3;
        const uint8_t al3 = (by & 0x07) >> 0;
        if (ai3 > 1) {
            const uint8_t lutAuthSize[] = { 8, 12, 16, 32, 64, 0, 0, 0 };
            lenData += lutAuthSize[al3]; // size of auth block 
        }
    }
    const uint8_t lenCrc = crcType + 1;
    const CRC_FUNCTION crcLut[] = { crc8, crc16, crc24, crc32 };
    const CRC_FUNCTION crcFunc = crcLut[crcType];
    crc = 0;
    const size_t len = lenData + lenHead + lenCrc;
    if (maxLen < len) return NOTFOUND;
    if (len > size) return WAIT;
    for (size_t ix = 1; ix < len; ) {
		  by = ptr[ix++];
      crcFunc(crc, by);
    }
    if (crc != 0) return NOTFOUND;
    return len;
  }

protected: 
  
  typedef uint32_t CRC; 
  typedef void (*CRC_FUNCTION)(CRC &crc, uint8_t by);

  static inline void crc4(CRC &crc, uint8_t by) {
    const uint8_t _table[] = {
      /* 00 */  0x0, 0xB, 0x5, 0xE, 0xA, 0x1, 0xF, 0x4,
      /* 08 */  0x7, 0xC, 0x2, 0x9, 0xD, 0x6, 0x8, 0x3,
      /* 10 */  0xE, 0x5, 0xB, 0x0, 0x4, 0xF, 0x1, 0xA,
      /* 18 */  0x9, 0x2, 0xC, 0x7, 0x3, 0x8, 0x6, 0xD,
      /* 20 */  0xF, 0x4, 0xA, 0x1, 0x5, 0xE, 0x0, 0xB,
      /* 28 */  0x8, 0x3, 0xD, 0x6, 0x2, 0x9, 0x7, 0xC,
      /* 30 */  0x1, 0xA, 0x4, 0xF, 0xB, 0x0, 0xE, 0x5,
      /* 38 */  0x6, 0xD, 0x3, 0x8, 0xC, 0x7, 0x9, 0x2,
      /* 40 */  0xD, 0x6, 0x8, 0x3, 0x7, 0xC, 0x2, 0x9,
      /* 48 */  0xA, 0x1, 0xF, 0x4, 0x0, 0xB, 0x5, 0xE,
      /* 50 */  0x3, 0x8, 0x6, 0xD, 0x9, 0x2, 0xC, 0x7,
      /* 58 */  0x4, 0xF, 0x1, 0xA, 0xE, 0x5, 0xB, 0x0,
      /* 60 */  0x2, 0x9, 0x7, 0xC, 0x8, 0x3, 0xD, 0x6,
      /* 68 */  0x5, 0xE, 0x0, 0xB, 0xF, 0x4, 0xA, 0x1,
      /* 70 */  0xC, 0x7, 0x9, 0x2, 0x6, 0xD, 0x3, 0x8,
      /* 78 */  0xB, 0x0, 0xE, 0x5, 0x1, 0xA, 0x4, 0xF,
      /* 80 */  0x9, 0x2, 0xC, 0x7, 0x3, 0x8, 0x6, 0xD,
      /* 88 */  0xE, 0x5, 0xB, 0x0, 0x4, 0xF, 0x1, 0xA,
      /* 90 */  0x7, 0xC, 0x2, 0x9, 0xD, 0x6, 0x8, 0x3,
      /* 98 */  0x0, 0xB, 0x5, 0xE, 0xA, 0x1, 0xF, 0x4,
      /* a0 */  0x6, 0xD, 0x3, 0x8, 0xC, 0x7, 0x9, 0x2,
      /* a8 */  0x1, 0xA, 0x4, 0xF, 0xB, 0x0, 0xE, 0x5,
      /* b0 */  0x8, 0x3, 0xD, 0x6, 0x2, 0x9, 0x7, 0xC,
      /* b8 */  0xF, 0x4, 0xA, 0x1, 0x5, 0xE, 0x0, 0xB,
      /* c0 */  0x4, 0xF, 0x1, 0xA, 0xE, 0x5, 0xB, 0x0,
      /* c8 */  0x3, 0x8, 0x6, 0xD, 0x9, 0x2, 0xC, 0x7,
      /* d0 */  0xA, 0x1, 0xF, 0x4, 0x0, 0xB, 0x5, 0xE,
      /* d8 */  0xD, 0x6, 0x8, 0x3, 0x7, 0xC, 0x2, 0x9,
      /* e0 */  0xB, 0x0, 0xE, 0x5, 0x1, 0xA, 0x4, 0xF,
      /* e8 */  0xC, 0x7, 0x9, 0x2, 0x6, 0xD, 0x3, 0x8,
      /* f0 */  0x5, 0xE, 0x0, 0xB, 0xF, 0x4, 0xA, 0x1,
      /* f8 */  0x2, 0x9, 0x7, 0xC, 0x8, 0x3, 0xD, 0x6 
    };
    crc = _table[by ^ crc];
  }
  static void crc8(CRC &crc, uint8_t by) {
    const uint8_t _table[] = {
      /* 00 */ 0x00, 0x07, 0x0E, 0x09, 0x1C, 0x1B, 0x12, 0x15,
      /* 08 */ 0x38, 0x3F, 0x36, 0x31, 0x24, 0x23, 0x2A, 0x2D,
      /* 10 */ 0x70, 0x77, 0x7E, 0x79, 0x6C, 0x6B, 0x62, 0x65,
      /* 18 */ 0x48, 0x4F, 0x46, 0x41, 0x54, 0x53, 0x5A, 0x5D,
      /* 20 */ 0xE0, 0xE7, 0xEE, 0xE9, 0xFC, 0xFB, 0xF2, 0xF5,
      /* 28 */ 0xD8, 0xDF, 0xD6, 0xD1, 0xC4, 0xC3, 0xCA, 0xCD,
      /* 30 */ 0x90, 0x97, 0x9E, 0x99, 0x8C, 0x8B, 0x82, 0x85,
      /* 38 */ 0xA8, 0xAF, 0xA6, 0xA1, 0xB4, 0xB3, 0xBA, 0xBD,
      /* 40 */ 0xC7, 0xC0, 0xC9, 0xCE, 0xDB, 0xDC, 0xD5, 0xD2,
      /* 48 */ 0xFF, 0xF8, 0xF1, 0xF6, 0xE3, 0xE4, 0xED, 0xEA,
      /* 50 */ 0xB7, 0xB0, 0xB9, 0xBE, 0xAB, 0xAC, 0xA5, 0xA2,
      /* 58 */ 0x8F, 0x88, 0x81, 0x86, 0x93, 0x94, 0x9D, 0x9A,
      /* 60 */ 0x27, 0x20, 0x29, 0x2E, 0x3B, 0x3C, 0x35, 0x32,
      /* 68 */ 0x1F, 0x18, 0x11, 0x16, 0x03, 0x04, 0x0D, 0x0A,
      /* 70 */ 0x57, 0x50, 0x59, 0x5E, 0x4B, 0x4C, 0x45, 0x42,
      /* 78 */ 0x6F, 0x68, 0x61, 0x66, 0x73, 0x74, 0x7D, 0x7A,
      /* 80 */ 0x89, 0x8E, 0x87, 0x80, 0x95, 0x92, 0x9B, 0x9C,
      /* 88 */ 0xB1, 0xB6, 0xBF, 0xB8, 0xAD, 0xAA, 0xA3, 0xA4,
      /* 90 */ 0xF9, 0xFE, 0xF7, 0xF0, 0xE5, 0xE2, 0xEB, 0xEC,
      /* 98 */ 0xC1, 0xC6, 0xCF, 0xC8, 0xDD, 0xDA, 0xD3, 0xD4,
      /* a0 */ 0x69, 0x6E, 0x67, 0x60, 0x75, 0x72, 0x7B, 0x7C,
      /* a8 */ 0x51, 0x56, 0x5F, 0x58, 0x4D, 0x4A, 0x43, 0x44,
      /* b0 */ 0x19, 0x1E, 0x17, 0x10, 0x05, 0x02, 0x0B, 0x0C,
      /* b8 */ 0x21, 0x26, 0x2F, 0x28, 0x3D, 0x3A, 0x33, 0x34,
      /* c0 */ 0x4E, 0x49, 0x40, 0x47, 0x52, 0x55, 0x5C, 0x5B,
      /* c8 */ 0x76, 0x71, 0x78, 0x7F, 0x6A, 0x6D, 0x64, 0x63,
      /* d0 */ 0x3E, 0x39, 0x30, 0x37, 0x22, 0x25, 0x2C, 0x2B,
      /* d8 */ 0x06, 0x01, 0x08, 0x0F, 0x1A, 0x1D, 0x14, 0x13,
      /* e0 */ 0xAE, 0xA9, 0xA0, 0xA7, 0xB2, 0xB5, 0xBC, 0xBB,
      /* e8 */ 0x96, 0x91, 0x98, 0x9F, 0x8A, 0x8D, 0x84, 0x83,
      /* f0 */ 0xDE, 0xD9, 0xD0, 0xD7, 0xC2, 0xC5, 0xCC, 0xCB,
      /* f8 */ 0xE6, 0xE1, 0xE8, 0xEF, 0xFA, 0xFD, 0xF4, 0xF3 
    };
    crc = crc ^ _table[by ^ crc];
  }
  static void crc16(CRC &crc, uint8_t by) {
    const uint16_t _table[] = {
      /* 00 */ 0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50A5, 0x60C6, 0x70E7,
      /* 08 */ 0x8108, 0x9129, 0xA14A, 0xB16B, 0xC18C, 0xD1AD, 0xE1CE, 0xF1EF,
      /* 10 */ 0x1231, 0x0210, 0x3273, 0x2252, 0x52B5, 0x4294, 0x72F7, 0x62D6,
      /* 18 */ 0x9339, 0x8318, 0xB37B, 0xA35A, 0xD3BD, 0xC39C, 0xF3FF, 0xE3DE,
      /* 20 */ 0x2462, 0x3443, 0x0420, 0x1401, 0x64E6, 0x74C7, 0x44A4, 0x5485,
      /* 28 */ 0xA56A, 0xB54B, 0x8528, 0x9509, 0xE5EE, 0xF5CF, 0xC5AC, 0xD58D,
      /* 30 */ 0x3653, 0x2672, 0x1611, 0x0630, 0x76D7, 0x66F6, 0x5695, 0x46B4,
      /* 38 */ 0xB75B, 0xA77A, 0x9719, 0x8738, 0xF7DF, 0xE7FE, 0xD79D, 0xC7BC,
      /* 40 */ 0x48C4, 0x58E5, 0x6886, 0x78A7, 0x0840, 0x1861, 0x2802, 0x3823,
      /* 48 */ 0xC9CC, 0xD9ED, 0xE98E, 0xF9AF, 0x8948, 0x9969, 0xA90A, 0xB92B,
      /* 50 */ 0x5AF5, 0x4AD4, 0x7AB7, 0x6A96, 0x1A71, 0x0A50, 0x3A33, 0x2A12,
      /* 58 */ 0xDBFD, 0xCBDC, 0xFBBF, 0xEB9E, 0x9B79, 0x8B58, 0xBB3B, 0xAB1A,
      /* 60 */ 0x6CA6, 0x7C87, 0x4CE4, 0x5CC5, 0x2C22, 0x3C03, 0x0C60, 0x1C41,
      /* 68 */ 0xEDAE, 0xFD8F, 0xCDEC, 0xDDCD, 0xAD2A, 0xBD0B, 0x8D68, 0x9D49,
      /* 70 */ 0x7E97, 0x6EB6, 0x5ED5, 0x4EF4, 0x3E13, 0x2E32, 0x1E51, 0x0E70,
      /* 78 */ 0xFF9F, 0xEFBE, 0xDFDD, 0xCFFC, 0xBF1B, 0xAF3A, 0x9F59, 0x8F78,
      /* 80 */ 0x9188, 0x81A9, 0xB1CA, 0xA1EB, 0xD10C, 0xC12D, 0xF14E, 0xE16F,
      /* 88 */ 0x1080, 0x00A1, 0x30C2, 0x20E3, 0x5004, 0x4025, 0x7046, 0x6067,
      /* 90 */ 0x83B9, 0x9398, 0xA3FB, 0xB3DA, 0xC33D, 0xD31C, 0xE37F, 0xF35E,
      /* 98 */ 0x02B1, 0x1290, 0x22F3, 0x32D2, 0x4235, 0x5214, 0x6277, 0x7256,
      /* a0 */ 0xB5EA, 0xA5CB, 0x95A8, 0x8589, 0xF56E, 0xE54F, 0xD52C, 0xC50D,
      /* a8 */ 0x34E2, 0x24C3, 0x14A0, 0x0481, 0x7466, 0x6447, 0x5424, 0x4405,
      /* b0 */ 0xA7DB, 0xB7FA, 0x8799, 0x97B8, 0xE75F, 0xF77E, 0xC71D, 0xD73C,
      /* b8 */ 0x26D3, 0x36F2, 0x0691, 0x16B0, 0x6657, 0x7676, 0x4615, 0x5634,
      /* c0 */ 0xD94C, 0xC96D, 0xF90E, 0xE92F, 0x99C8, 0x89E9, 0xB98A, 0xA9AB,
      /* c8 */ 0x5844, 0x4865, 0x7806, 0x6827, 0x18C0, 0x08E1, 0x3882, 0x28A3,
      /* d0 */ 0xCB7D, 0xDB5C, 0xEB3F, 0xFB1E, 0x8BF9, 0x9BD8, 0xABBB, 0xBB9A,
      /* d8 */ 0x4A75, 0x5A54, 0x6A37, 0x7A16, 0x0AF1, 0x1AD0, 0x2AB3, 0x3A92,
      /* e0 */ 0xFD2E, 0xED0F, 0xDD6C, 0xCD4D, 0xBDAA, 0xAD8B, 0x9DE8, 0x8DC9,
      /* e8 */ 0x7C26, 0x6C07, 0x5C64, 0x4C45, 0x3CA2, 0x2C83, 0x1CE0, 0x0CC1,
      /* f0 */ 0xEF1F, 0xFF3E, 0xCF5D, 0xDF7C, 0xAF9B, 0xBFBA, 0x8FD9, 0x9FF8,
      /* f8 */ 0x6E17, 0x7E36, 0x4E55, 0x5E74, 0x2E93, 0x3EB2, 0x0ED1, 0x1EF0
    };
    crc = ((crc << 8) ^ _table[(by ^ (crc >> 8)) & 0xff]) & 0xFFFF;
  }
  static void crc24(CRC &crc, uint8_t by) {
    const uint32_t _table[] = {
      /* 00 */ 0x000000, 0x864CFB, 0x8AD50D, 0x0C99F6, 0x93E6E1, 0x15AA1A, 0x1933EC, 0x9F7F17,
      /* 08 */ 0xA18139, 0x27CDC2, 0x2B5434, 0xAD18CF, 0x3267D8, 0xB42B23, 0xB8B2D5, 0x3EFE2E,
      /* 10 */ 0xC54E89, 0x430272, 0x4F9B84, 0xC9D77F, 0x56A868, 0xD0E493, 0xDC7D65, 0x5A319E,
      /* 18 */ 0x64CFB0, 0xE2834B, 0xEE1ABD, 0x685646, 0xF72951, 0x7165AA, 0x7DFC5C, 0xFBB0A7,
      /* 20 */ 0x0CD1E9, 0x8A9D12, 0x8604E4, 0x00481F, 0x9F3708, 0x197BF3, 0x15E205, 0x93AEFE,
      /* 28 */ 0xAD50D0, 0x2B1C2B, 0x2785DD, 0xA1C926, 0x3EB631, 0xB8FACA, 0xB4633C, 0x322FC7,
      /* 30 */ 0xC99F60, 0x4FD39B, 0x434A6D, 0xC50696, 0x5A7981, 0xDC357A, 0xD0AC8C, 0x56E077,
      /* 38 */ 0x681E59, 0xEE52A2, 0xE2CB54, 0x6487AF, 0xFBF8B8, 0x7DB443, 0x712DB5, 0xF7614E,
      /* 40 */ 0x19A3D2, 0x9FEF29, 0x9376DF, 0x153A24, 0x8A4533, 0x0C09C8, 0x00903E, 0x86DCC5,
      /* 48 */ 0xB822EB, 0x3E6E10, 0x32F7E6, 0xB4BB1D, 0x2BC40A, 0xAD88F1, 0xA11107, 0x275DFC,
      /* 50 */ 0xDCED5B, 0x5AA1A0, 0x563856, 0xD074AD, 0x4F0BBA, 0xC94741, 0xC5DEB7, 0x43924C,
      /* 58 */ 0x7D6C62, 0xFB2099, 0xF7B96F, 0x71F594, 0xEE8A83, 0x68C678, 0x645F8E, 0xE21375,
      /* 60 */ 0x15723B, 0x933EC0, 0x9FA736, 0x19EBCD, 0x8694DA, 0x00D821, 0x0C41D7, 0x8A0D2C,
      /* 68 */ 0xB4F302, 0x32BFF9, 0x3E260F, 0xB86AF4, 0x2715E3, 0xA15918, 0xADC0EE, 0x2B8C15,
      /* 70 */ 0xD03CB2, 0x567049, 0x5AE9BF, 0xDCA544, 0x43DA53, 0xC596A8, 0xC90F5E, 0x4F43A5,
      /* 78 */ 0x71BD8B, 0xF7F170, 0xFB6886, 0x7D247D, 0xE25B6A, 0x641791, 0x688E67, 0xEEC29C,
      /* 80 */ 0x3347A4, 0xB50B5F, 0xB992A9, 0x3FDE52, 0xA0A145, 0x26EDBE, 0x2A7448, 0xAC38B3,
      /* 88 */ 0x92C69D, 0x148A66, 0x181390, 0x9E5F6B, 0x01207C, 0x876C87, 0x8BF571, 0x0DB98A,
      /* 90 */ 0xF6092D, 0x7045D6, 0x7CDC20, 0xFA90DB, 0x65EFCC, 0xE3A337, 0xEF3AC1, 0x69763A,
      /* 98 */ 0x578814, 0xD1C4EF, 0xDD5D19, 0x5B11E2, 0xC46EF5, 0x42220E, 0x4EBBF8, 0xC8F703,
      /* a0 */ 0x3F964D, 0xB9DAB6, 0xB54340, 0x330FBB, 0xAC70AC, 0x2A3C57, 0x26A5A1, 0xA0E95A,
      /* a8 */ 0x9E1774, 0x185B8F, 0x14C279, 0x928E82, 0x0DF195, 0x8BBD6E, 0x872498, 0x016863,
      /* b0 */ 0xFAD8C4, 0x7C943F, 0x700DC9, 0xF64132, 0x693E25, 0xEF72DE, 0xE3EB28, 0x65A7D3,
      /* b8 */ 0x5B59FD, 0xDD1506, 0xD18CF0, 0x57C00B, 0xC8BF1C, 0x4EF3E7, 0x426A11, 0xC426EA,
      /* c0 */ 0x2AE476, 0xACA88D, 0xA0317B, 0x267D80, 0xB90297, 0x3F4E6C, 0x33D79A, 0xB59B61,
      /* c8 */ 0x8B654F, 0x0D29B4, 0x01B042, 0x87FCB9, 0x1883AE, 0x9ECF55, 0x9256A3, 0x141A58,
      /* d0 */ 0xEFAAFF, 0x69E604, 0x657FF2, 0xE33309, 0x7C4C1E, 0xFA00E5, 0xF69913, 0x70D5E8,
      /* d8 */ 0x4E2BC6, 0xC8673D, 0xC4FECB, 0x42B230, 0xDDCD27, 0x5B81DC, 0x57182A, 0xD154D1,
      /* e0 */ 0x26359F, 0xA07964, 0xACE092, 0x2AAC69, 0xB5D37E, 0x339F85, 0x3F0673, 0xB94A88,
      /* e8 */ 0x87B4A6, 0x01F85D, 0x0D61AB, 0x8B2D50, 0x145247, 0x921EBC, 0x9E874A, 0x18CBB1,
      /* f0 */ 0xE37B16, 0x6537ED, 0x69AE1B, 0xEFE2E0, 0x709DF7, 0xF6D10C, 0xFA48FA, 0x7C0401,
      /* f8 */ 0x42FA2F, 0xC4B6D4, 0xC82F22, 0x4E63D9, 0xD11CCE, 0x575035, 0x5BC9C3, 0xDD8538 
    };
    crc = ((crc << 8) ^ _table[(by ^ (crc >> 16)) & 0xff]) & 0xFFFFFF;
  }
  
  static void crc32(CRC &crc, uint8_t by) {
    const uint32_t _table[] = {
      /* 00 */ 0x00000000, 0x04C11DB7, 0x09823B6E, 0x0D4326D9, 0x130476DC, 0x17C56B6B, 0x1A864DB2, 0x1E475005,
      /* 08 */ 0x2608EDB8, 0x22C9F00F, 0x2F8AD6D6, 0x2B4BCB61, 0x350C9B64, 0x31CD86D3, 0x3C8EA00A, 0x384FBDBD,
      /* 10 */ 0x4C11DB70, 0x48D0C6C7, 0x4593E01E, 0x4152FDA9, 0x5F15ADAC, 0x5BD4B01B, 0x569796C2, 0x52568B75,
      /* 18 */ 0x6A1936C8, 0x6ED82B7F, 0x639B0DA6, 0x675A1011, 0x791D4014, 0x7DDC5DA3, 0x709F7B7A, 0x745E66CD,
      /* 20 */ 0x9823B6E0, 0x9CE2AB57, 0x91A18D8E, 0x95609039, 0x8B27C03C, 0x8FE6DD8B, 0x82A5FB52, 0x8664E6E5,
      /* 28 */ 0xBE2B5B58, 0xBAEA46EF, 0xB7A96036, 0xB3687D81, 0xAD2F2D84, 0xA9EE3033, 0xA4AD16EA, 0xA06C0B5D,
      /* 30 */ 0xD4326D90, 0xD0F37027, 0xDDB056FE, 0xD9714B49, 0xC7361B4C, 0xC3F706FB, 0xCEB42022, 0xCA753D95,
      /* 38 */ 0xF23A8028, 0xF6FB9D9F, 0xFBB8BB46, 0xFF79A6F1, 0xE13EF6F4, 0xE5FFEB43, 0xE8BCCD9A, 0xEC7DD02D,
      /* 40 */ 0x34867077, 0x30476DC0, 0x3D044B19, 0x39C556AE, 0x278206AB, 0x23431B1C, 0x2E003DC5, 0x2AC12072,
      /* 48 */ 0x128E9DCF, 0x164F8078, 0x1B0CA6A1, 0x1FCDBB16, 0x018AEB13, 0x054BF6A4, 0x0808D07D, 0x0CC9CDCA,
      /* 50 */ 0x7897AB07, 0x7C56B6B0, 0x71159069, 0x75D48DDE, 0x6B93DDDB, 0x6F52C06C, 0x6211E6B5, 0x66D0FB02,
      /* 58 */ 0x5E9F46BF, 0x5A5E5B08, 0x571D7DD1, 0x53DC6066, 0x4D9B3063, 0x495A2DD4, 0x44190B0D, 0x40D816BA,
      /* 60 */ 0xACA5C697, 0xA864DB20, 0xA527FDF9, 0xA1E6E04E, 0xBFA1B04B, 0xBB60ADFC, 0xB6238B25, 0xB2E29692,
      /* 68 */ 0x8AAD2B2F, 0x8E6C3698, 0x832F1041, 0x87EE0DF6, 0x99A95DF3, 0x9D684044, 0x902B669D, 0x94EA7B2A,
      /* 70 */ 0xE0B41DE7, 0xE4750050, 0xE9362689, 0xEDF73B3E, 0xF3B06B3B, 0xF771768C, 0xFA325055, 0xFEF34DE2,
      /* 78 */ 0xC6BCF05F, 0xC27DEDE8, 0xCF3ECB31, 0xCBFFD686, 0xD5B88683, 0xD1799B34, 0xDC3ABDED, 0xD8FBA05A,
      /* 80 */ 0x690CE0EE, 0x6DCDFD59, 0x608EDB80, 0x644FC637, 0x7A089632, 0x7EC98B85, 0x738AAD5C, 0x774BB0EB,
      /* 88 */ 0x4F040D56, 0x4BC510E1, 0x46863638, 0x42472B8F, 0x5C007B8A, 0x58C1663D, 0x558240E4, 0x51435D53,
      /* 90 */ 0x251D3B9E, 0x21DC2629, 0x2C9F00F0, 0x285E1D47, 0x36194D42, 0x32D850F5, 0x3F9B762C, 0x3B5A6B9B,
      /* 98 */ 0x0315D626, 0x07D4CB91, 0x0A97ED48, 0x0E56F0FF, 0x1011A0FA, 0x14D0BD4D, 0x19939B94, 0x1D528623,
      /* a0 */ 0xF12F560E, 0xF5EE4BB9, 0xF8AD6D60, 0xFC6C70D7, 0xE22B20D2, 0xE6EA3D65, 0xEBA91BBC, 0xEF68060B,
      /* a8 */ 0xD727BBB6, 0xD3E6A601, 0xDEA580D8, 0xDA649D6F, 0xC423CD6A, 0xC0E2D0DD, 0xCDA1F604, 0xC960EBB3,
      /* b0 */ 0xBD3E8D7E, 0xB9FF90C9, 0xB4BCB610, 0xB07DABA7, 0xAE3AFBA2, 0xAAFBE615, 0xA7B8C0CC, 0xA379DD7B,
      /* b8 */ 0x9B3660C6, 0x9FF77D71, 0x92B45BA8, 0x9675461F, 0x8832161A, 0x8CF30BAD, 0x81B02D74, 0x857130C3,
      /* c0 */ 0x5D8A9099, 0x594B8D2E, 0x5408ABF7, 0x50C9B640, 0x4E8EE645, 0x4A4FFBF2, 0x470CDD2B, 0x43CDC09C,
      /* c8 */ 0x7B827D21, 0x7F436096, 0x7200464F, 0x76C15BF8, 0x68860BFD, 0x6C47164A, 0x61043093, 0x65C52D24,
      /* d0 */ 0x119B4BE9, 0x155A565E, 0x18197087, 0x1CD86D30, 0x029F3D35, 0x065E2082, 0x0B1D065B, 0x0FDC1BEC,
      /* d8 */ 0x3793A651, 0x3352BBE6, 0x3E119D3F, 0x3AD08088, 0x2497D08D, 0x2056CD3A, 0x2D15EBE3, 0x29D4F654,
      /* e0 */ 0xC5A92679, 0xC1683BCE, 0xCC2B1D17, 0xC8EA00A0, 0xD6AD50A5, 0xD26C4D12, 0xDF2F6BCB, 0xDBEE767C,
      /* e8 */ 0xE3A1CBC1, 0xE760D676, 0xEA23F0AF, 0xEEE2ED18, 0xF0A5BD1D, 0xF464A0AA, 0xF9278673, 0xFDE69BC4,
      /* f0 */ 0x89B8FD09, 0x8D79E0BE, 0x803AC667, 0x84FBDBD0, 0x9ABC8BD5, 0x9E7D9662, 0x933EB0BB, 0x97FFAD0C,
      /* f8 */ 0xAFB010B1, 0xAB710D06, 0xA6322BDF, 0xA2F33668, 0xBCB4666D, 0xB8757BDA, 0xB5365D03, 0xB1F740B4 
    };
    crc = (crc << 8) ^ _table[(by ^ (crc >> 24)) & 0xff];
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

  void sendParsed(MSG &msg, TickType_t ticks = portMAX_DELAY) {
    size_t size = msg.size;
    sendParsed(msg.data, size, msg.src, 0, ticks); 
    if (0 < size) { 
      msg.resize(size);
      msg.hint = MSG::HINT::UNKNOWN;
      send(msg);
    }
  }

  void sendParsed(uint8_t *ptr, size_t &size, MSG::SRC src, size_t skip = 0, TickType_t ticks = portMAX_DELAY) {
    const uint8_t *p = ptr;
    while (0 < size) {
      MSG::HINT hint = MSG::HINT::NONE;
      size_t len = PROTOCOL::parse(p, size, hint, skip);
      if ((len == PROTOCOL::WAIT) || (len == PROTOCOL::NOTFOUND)) {
        break;
      }
      MSG msg(p, len, src, hint);
      send(msg, ticks);
      p += len;
      size -= len;
    }
    if ((ptr < p) && (0 < size)) {
      // move to start size is changed
      memmove(ptr, p, size);
    }
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
  
  const size_t minAllocSize = 2048;   //!< min size to alloc when writing small bits of data
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
QUEUE queueToCommTask(10); //!< queue into Comm Task
PIPE pipeSerialToCommTask(queueToCommTask,  MSG::SRC::LTE,  MSG::HINT::AT);   //!< Stream interface from Serial used by Lte
PIPE pipeWireToCommTask(queueToCommTask,    MSG::SRC::WIRE, MSG::HINT::UBX);  //!< Stream interface from Wire used by GNSS, LBAND

#if 0
#include <vector>
#include <Wire.h>

class UBXGNSS {
 
public:

  enum class I2CADR {
    GNSS  = 0x42,
    LBAND = 0x43,
  };
  
  bool begin(TwoWire &wire) {
    i2c = &wire;
    i2c->setTimeOut(4);
    mutex = xSemaphoreCreateMutex();
    xTaskCreatePinnedToCore(task, "GNSSrx", 2048, this, 3, NULL, 1);
    return true;
  }

  void end() {
    i2c->end();
  }

  bool addReadTask(const I2CADR adr, MSG::SRC src, size_t size = bufferSize) {
    uint8_t *buffer = (uint8_t *)malloc(size);
    if (NULL != buffer) {
      bool ok = detect(adr);
      DEVICE dev = {
        .adr = adr,
        .src = src,
        .buffer = buffer,
        .size = size,
        .used = 0,
        .ok = ok,
      };
      devices.push_back(dev);
      return true;
    } 
    return false;
  }

  bool detect(const I2CADR adr) {
    uint8_t ret = 0;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      i2c->beginTransmission((uint8_t)adr);
      ret = i2c->endTransmission();
      xSemaphoreGive(mutex);
    }
    return (0 == ret);
  }

  bool write(const I2CADR adr, const uint8_t* ptr, size_t len) {
    size_t size = 0;
    if ((1 < len) && (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY))) {
      do { 
        // we can't write just one byte.  
        uint8_t num = (len >  maxTransaction) ?  maxTransaction : len;
        // avoid leaving just one byte in the buffer left to write
        if (1 == (len - num)) {
          num --;
        }
        i2c->beginTransmission((uint8_t)adr);
        num = i2c->write(ptr, num);
        uint8_t ret = i2c->endTransmission();
        if (0 != ret) {
          log_w("end transmission failed %d", ret);
          break;
        }
        ptr += num; 
        len -= num;
        size += num;
      } while (0 < len);
      xSemaphoreGive(mutex);
    }
    return size;  
  }

protected:
  typedef struct {
    I2CADR   adr;
    MSG::SRC src;

    uint8_t *buffer;
    size_t   size;
    size_t   used;
    bool     ok; 
  } DEVICE;

  std::vector<DEVICE> devices;

  /** FreeRTOS static task function, will just call the objects task function  
   *  \param pvParameters the Lte object (this)
   */
  static void task(void * pvParameters) {
    ((UBXGNSS*) pvParameters)->task();
  }
  
  void task(void) {
    while (true) {
      TickType_t ticks = xTaskGetTickCount();
      for (auto dev = devices.begin(); (dev != devices.end()); dev = std::next(dev)) {
        if (dev->ok) {
          size_t avail = available(dev->adr);
          while (0 < avail) {
            size_t toRead = dev->size - dev->used;
            if (avail < toRead) toRead = avail;
            size_t num = read(dev->adr, dev->buffer + dev->used, toRead);
            if (0 < num) {
              avail -= num;
              dev->used += num;
              queueToCommTask.sendParsed(dev->buffer, dev->used, dev->src);
              // we still have a full buffer after parsing 
              if (dev->used == dev->size) {
                // try to increase the size or drop some bytes
                size_t size =  dev->size + bufferInc;
                uint8_t *buffer = NULL;
                if (size <= bufferMax) {
                  buffer = (uint8_t *)realloc(dev->buffer, size);
                } 
                if (NULL != buffer) {
                  log_w("buffer size %d bytes", size);
                  dev->buffer = buffer;
                  dev->size = size;
                } else {
                  // we may have a bad byte in the buffer and were not able to extend the buffer memory
                  // so lets try to remove the thing that prevents us from parsing other messages
                  const size_t skip = 1;
                  log_w("buffer full, skip at least %d bytes", skip);
                  queueToCommTask.sendParsed(dev->buffer, dev->used, dev->src, skip);
                }
              }
            } 
            if (num != toRead) {
              // likely a [E][Wire.cpp:513] requestFrom(): i2cRead returned Error 263
              // we will recover with the next available call (a write)
              avail = available(dev->adr);
              log_w("read error %d bytes available", avail);
            }
          }
        }
      }
      ticks = (xTaskGetTickCount() - ticks);
      const TickType_t timeoutTicks = pdMS_TO_TICKS(50);
      if (ticks < timeoutTicks) {
        vTaskDelay(timeoutTicks - ticks);
      }
    }
  }

  size_t available(const I2CADR adr) {
    size_t avail = 0;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      i2c->beginTransmission((uint8_t)adr);
      i2c->write(i2cRegLength); // set length addressrequestFrom
      uint8_t ret = i2c->endTransmission(false); // repeated start
      if (0 == ret) {
        uint8_t ret = i2c->requestFrom((uint8_t)adr, (uint8_t)2);
        if (2 == ret) {
          uint16_t len = (i2c->read() << 8);
          len |= i2c->read();
          if (len & 0x8000) {
            log_e("len err %04X", len);
            len &= ~0x8000; // workaround, mask obviously wrong lengths
          }
          avail = len;
        }
      }
      xSemaphoreGive(mutex);
    }
    return avail;
  }
  
  size_t read(const I2CADR adr, uint8_t* ptr, size_t len) {
    size_t size = 0;
    if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
      while (0 < len) {
        const uint8_t num = (len >  maxTransaction) ?  maxTransaction : len;
        uint8_t ret = i2c->requestFrom((uint8_t)adr, num);
        if (num == ret) {
          len -= ret;
          size += ret;
          do {
            *ptr++ = i2c->read();
          } while (--ret);
        } else {
          break;
        }
      }
      xSemaphoreGive(mutex);
    }
    return size;
  }

  TwoWire *i2c;
  SemaphoreHandle_t mutex;

  static const size_t bufferMax       =       2048;
  static const size_t bufferSize      =       1024;
  static const size_t bufferInc       =        128;
  static const uint8_t maxTransaction =  UINT8_MAX;

  static const uint8_t i2cRegLength   =       0xFD;
  static const uint8_t i2cRegStream   =       0xFF;
};

UBXGNSS gnss;
#endif

#endif // __IPC_H__
