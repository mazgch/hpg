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
 
#ifndef __UBXIO_H__
#define __UBXIO_H__

/** older versions of ESP32_Arduino do not yet support flow control, but we need this for the modem. 
 *  The following flag will make sure code is added for this,
 */
#include <driver/uart.h> // for flow control, and uart num
#if !defined(HW_FLOWCTRL_CTS_RTS) || !defined(ESP_ARDUINO_VERSION) || !defined(ESP_ARDUINO_VERSION_VAL)
 #define UBXSERIAL_OVERRIDE_FLOWCONTROL  
#elif (ESP_ARDUINO_VERSION <= ESP_ARDUINO_VERSION_VAL(2, 0, 3))
 #define UBXSERIAL_OVERRIDE_FLOWCONTROL
#endif

const int UBXSERIAL_RXSIZE         =         256;  //!< RX buffer size
const uint8_t UBXSERIAL_UARTNUM    =  UART_NUM_1;  //!< Uart hardware number

// -----------------------------------------------------------------------
// SERIAL
// -----------------------------------------------------------------------

/** This class encapsulates all UBXSERIAL functions. the class can be used as alternative to a 
 *  normal Serial port, but add full RX and TX logging capability. 
*/
class UBXSERIAL : public HardwareSerial {
public:

  /** constructor
   */
  UBXSERIAL() : HardwareSerial{UBXSERIAL_UARTNUM} {
    setRxBufferSize(UBXSERIAL_RXSIZE);
  }

  // --------------------------------------------------------------------------------------
  // STREAM interface: https://github.com/arduino/ArduinoCore-API/blob/master/api/Stream.h
  // --------------------------------------------------------------------------------------
 
  /** The character written is also passed into the circular buffer
   *  \param ch  character to write
   *  \return    the bytes written
   */ 
  size_t write(uint8_t ch) override {
    pipeSerialToCommTask.write(ch);
    return HardwareSerial::write(ch);
  }
  
  /** All data written is also passed into the circular buffer
   *  \param ptr   pointer to buffer to write
   *  \param size  number of bytes in ptr to write
   *  \return      the bytes written
   */ 
  size_t write(const uint8_t *ptr, size_t size) override {
    pipeSerialToCommTask.write(ptr, size);
    return HardwareSerial::write(ptr, size);  
  }

  /** The character read is also passed in also passed into the circular buffer.
   *  \return  the character read
   */ 
  int read(void) override {
    int ch = HardwareSerial::read();
    if (-1 != ch) {
      pipeSerialToCommTask.write(ch);
    }
    return ch;
  }
  
#ifdef UBXSERIAL_OVERRIDE_FLOWCONTROL
  // The arduino_esp32 core has a bug that some pins are swapped in the setPins function. 
  // PR https://github.com/espressif/arduino-esp32/pull/6816#pullrequestreview-987757446 was issued
  // We will override as we cannot rely on that bugfix being applied in the users environment. 

  // extend the flow control API while on older arduino_ESP32 revisions
  // we keep the API forward compatible so that when the new platform is released it just works
  void setPins(int8_t rxPin, int8_t txPin, int8_t ctsPin, int8_t rtsPin) {
    uart_set_pin((uart_port_t)_uart_nr, txPin, rxPin, rtsPin, ctsPin);
  }
  
  void setHwFlowCtrlMode(uint8_t mode, uint8_t threshold) {
    uart_set_hw_flow_ctrl((uart_port_t)_uart_nr, (uart_hw_flowcontrol_t) mode, threshold);
  }
  
 #ifndef HW_FLOWCTRL_CTS_RTS
  #define HW_FLOWCTRL_CTS_RTS UART_HW_FLOWCTRL_CTS_RTS
 #endif
#endif
};

UBXSERIAL UbxSerial; //!< The global UBXSERIAL peripherial object (replaces Serial1)

// -----------------------------------------------------------------------
// WIRE
// -----------------------------------------------------------------------

#include <Wire.h>

const int UBXWIRE_FREQ             =      400000;  //!< I2C Frequency
const uint8_t UBXWIRE_BUSNUM       =           0;  //!< I2C bus number

/** This class encapsulates all UBXWIRESERIAL functions. the class can be used as alternative 
 *  to a normal Wire port, but add full RX and TX logging capability of the data stream filtering 
 *  out I2C register set and stream length reads at address 0xFD and 0xFE.  
 */
class UBXWIRE : public TwoWire {

public:

  /** constructor
   */
  UBXWIRE() : TwoWire{UBXWIRE_BUSNUM} {
#ifdef USE_UBXWIRE
    state = STATE::READ;
    lenLo = 0;
    // i2c wire
#endif
    begin(I2C_SDA, I2C_SCL, UBXWIRE_FREQ);  // Start I2C
  }
  
#ifdef USE_UBXWIRE
  /** The character written is also passed into the circular buffer
   *  \param ch  character to write
   *  \return    the bytes written
   */ 
  size_t write(uint8_t ch) override {
    if (state == STATE::READFD) {
      // seems we ar just writing after assumed address set to length field
      const uint8_t mem[] = { REG_ADR_SIZE, ch };
      pipeWireToCommTask.write(mem, sizeof(mem));
    } else if (state == STATE::READFE) {
      // quite unusal should never happen 
      const uint8_t mem[] = { REG_ADR_SIZE, lenLo, ch };
      // we set register address and read part of the length, now we write again
      pipeWireToCommTask.write(mem, sizeof(mem));
    }
    else if (ch == REG_ADR_SIZE) {
      state = STATE::READFD;
      // do not write this now
    } else {
      state = STATE::WRITE;
      pipeWireToCommTask.write(ch);
    }
    return TwoWire::write(ch);
  }
  
  /** All data written is also passed into the circular buffer
   *  \param ptr   pointer to buffer to write
   *  \param size  number of bytes in ptr to write
   *  \return      the bytes written
   */ 
  size_t write(const uint8_t *ptr, size_t size) override {
    if ((1 == size) && (REG_ADR_SIZE == *ptr)) {
      state = STATE::READFD;
    } else {
      if (state == STATE::READFD) {
        pipeWireToCommTask.write(REG_ADR_SIZE);
      }
      pipeWireToCommTask.write(ptr, size);
      state = STATE::WRITE;
    }
    return TwoWire::write(ptr, size);  
  }

  /** The character read is also passed in also passed into the circular buffer.
   *  \return  the character read
   */ 
  int read(void) override {
    int ch = TwoWire::read();
    if (state == STATE::READFD) {
      state = STATE::READFE;
      lenLo = ch;
    } else if (state == STATE::READFE) {
      state = STATE::READ;
      //lenHi = ch;
    } else {
      pipeWireToCommTask.write(ch);
    }
    return ch;
  }
  
protected:
  enum class STATE { READFD, READFE, READ, WRITE } state; //!< state of the I2C traffic filter 
  const uint8_t REG_ADR_SIZE = 0xFD;                      //!< the first address of the size register (2 bytes)
  uint8_t lenLo;                                          //!> backup of lenLo 
#endif
};

UBXWIRE UbxWire; //!< The global UBXWIRE peripherial object (replaces Wire)

#endif // __UBXIO_H__
