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
 
#ifndef __HW_H__
#define __HW_H__

/** The target is used to enable conditional code thoughout this application 
 */
#if defined(ARDUINO_UBLOX_NINA_W10)
 //#define HW_TARGET     UBLOX_XPLR_HPG2_C214   //!< enable this when using https://www.u-blox.com/en/product/xplr-hpg-2
 #define HW_TARGET     MAZGCH_HPG_SOLUTION_V09
#elif defined(ARDUINO_UBLOX_NORA_W10)
 #define HW_TARGET     UBLOX_XPLR_HPG1_C213
#elif defined(ARDUINO_ESP32_MICROMOD)
 #define HW_TARGET     SPARKFUN_MICROMOD_MAINBOARD
#elif defined(ARDUINO_ESP32_DEV)
 #define HW_TARGET     SPARKFUN_RTK_CONTROL
#else
 #error unknown board target 
#endif

// https://github.com/mazgch/hpg/tree/main/hardware
#define MAZGCH_HPG_SOLUTION_V08              1 //!< Select ESP32 Arduino / u-blox NINA-W10 series (ESP32) 
#define MAZGCH_HPG_SOLUTION_V09              2 //!< Select ESP32 Arduino / u-blox NINA-W10 series (ESP32) 

// https://www.u-blox.com/en/product/xplr-hpg-2
#define UBLOX_XPLR_HPG2_C214                 3 //!< Select ESP32 Arduino / u-blox NINA-W10 series (ESP32), PCB rev A/B 

// https://www.u-blox.com/en/product/xplr-hpg-1
#define UBLOX_XPLR_HPG1_C213_revA           11 //!< Select ESP32 Arduino / u-blox NORA-W10 series (ESP32-S3), LTE in slot 1, PCB rev A
#define UBLOX_XPLR_HPG1_C213                12 //!< Select ESP32 Arduino / u-blox NORA-W10 series (ESP32-S3), LTE in slot 1, PCB rev B/C 

#define SPARKFUN_MICROMOD_MAINBOARD_PT      21 //!< Choose Sparkfun ESP32 Arduino / Sparkfun ESP32 MicroMod - with prototype LTE function
#define SPARKFUN_MICROMOD_MAINBOARD         22 //!< Choose Sparkfun ESP32 Arduino / Sparkfun ESP32 MicroMod

#define SPARKFUN_MICROMOD_MAINBOARD_DOUBLE  31 //!< Choose Sparkfun ESP32 Arduino / Sparkfun ESP32 MicroMod 

#define SPARKFUN_MICROMOD_ASSET_TRACKER     41 //!< Choose Sparkfun ESP32 Arduino / Sparkfun ESP32 MicroMod

#define SPARKFUN_RTK_CONTROL                51 //!< Select ESP32 / ESP32 Wrover Module

/** the pins are defined here for each hardware target 
 */
enum HW_PINS {  
    // Standard pins
    BOOT        =  0, 
    CDC_RX      = RX,  CDC_TX         = TX,
#if (HW_TARGET == UBLOX_XPLR_HPG1_C213_revA)
    LED         =  8,
    CAN_RX      = -1,  CAN_TX         = -1,
    I2C_SDA     = 18,  I2C_SCL        = 17,
#elif (HW_TARGET == UBLOX_XPLR_HPG1_C213)
    LED         =  2,
    CAN_RX      = -1,  CAN_TX         = -1,
    I2C_SDA     = 18,  I2C_SCL        = 17,
#elif (HW_TARGET == SPARKFUN_RTK_CONTROL)
    LED         =  2,
    CAN_RX      = -1,  CAN_TX         = -1,
    I2C_SDA     = 21,  I2C_SCL        = 22,
#else
    LED         =  2,
    CAN_RX      =  4,  CAN_TX         =  5,
    I2C_SDA     = 21,  I2C_SCL        = 22,
#endif    

#if (HW_TARGET == MAZGCH_HPG_SOLUTION_V08)
 #warning using MAZGCH_HPG_SOLUTION_V08
    // LTE (DCE) - BUG 34/39 are input only.on V0.8 -> will swap in V0.9
    LTE_RESET   = -1 /*BUG 34 is IN only */, 
    LTE_PWR_ON  = -1 /*BUG 39 is IN only */, LTE_ON      = 37,  LTE_INT = -1,
    LTE_TXI     = 25,  LTE_RXO        = 26,  LTE_RTS     = 27,  LTE_CTS = 36, 
    LTE_RI      = 12,  LTE_DSR        = 13,  LTE_DCD     = 14,  LTE_DTR = 15,
    LTE_PWR_ON_ACTIVE = HIGH, LTE_ON_ACTIVE = LOW,

    // Power supply
    VIN         = 35,  V33_EN         = 33, V33_EN_ACTIVE = HIGH,
    
    // Micro SD card - MISO / MOSI will be swapped to allow use of default pins 
    MICROSD_SCK = 18,  MICROSD_SDI    = 23,  MICROSD_SDO = 19,   
    MICROSD_CS  = 32,  MICROSD_PWR_EN = -1,  MICROSD_DET = 38,
    MICROSD_DET_REMOVED = HIGH, MICROSD_PWR_EN_ACTIVE = LOW,

    REQUIRED_GPIO_PIN = -1, REQUIRED_GPIO_PIN_ACTIVE = HIGH,

#elif (HW_TARGET == MAZGCH_HPG_SOLUTION_V09)
    // LTE (DCE)
    LTE_RESET   = 13,  LTE_PWR_ON     = 12,  LTE_ON      = 37,  LTE_INT = -1,
    LTE_TXI     = 25,  LTE_RXO        = 26,  LTE_RTS     = 27,  LTE_CTS = 36, 
    LTE_RI      = 34,  LTE_DSR        = 39,  LTE_DCD     = 14,  LTE_DTR = 15,
    LTE_PWR_ON_ACTIVE = HIGH, LTE_ON_ACTIVE = LOW,

    // Power supply
    VIN         = 35,  V33_EN         = 33, V33_EN_ACTIVE = HIGH,
    
    // Micro SD card
    MICROSD_SCK = 18,  MICROSD_SDI    = 19,  MICROSD_SDO = 23,   
    MICROSD_CS  = 32,  MICROSD_PWR_EN = -1,  MICROSD_DET = 38,
    MICROSD_DET_REMOVED = HIGH, MICROSD_PWR_EN_ACTIVE = LOW,

    REQUIRED_GPIO_PIN = -1, REQUIRED_GPIO_PIN_ACTIVE = HIGH,

#elif (HW_TARGET == UBLOX_XPLR_HPG2_C214)
    // LTE (DCE)
    LTE_RESET   = 33,  LTE_PWR_ON     = 26,  LTE_ON      = 37,  LTE_INT = -1,
    LTE_TXI     = 25,  LTE_RXO        = 34,  LTE_RTS     = 27,  LTE_CTS = 36, 
    LTE_RI      = 12,  LTE_DSR        = 13,  LTE_DCD     = 14,  LTE_DTR = 15,
    LTE_PWR_ON_ACTIVE = HIGH, LTE_ON_ACTIVE = LOW,

    // Power supply
    VIN         = 35,  V33_EN         = -1, V33_EN_ACTIVE = HIGH,
    
    // Micro SD card
    MICROSD_SCK = 18,  MICROSD_SDI    = 19,  MICROSD_SDO = 23,   
    MICROSD_CS  = 32,  MICROSD_PWR_EN = -1,  MICROSD_DET = 38,
    MICROSD_DET_REMOVED = HIGH, MICROSD_PWR_EN_ACTIVE = LOW,

    REQUIRED_GPIO_PIN = -1, REQUIRED_GPIO_PIN_ACTIVE = HIGH,

#elif (HW_TARGET == UBLOX_XPLR_HPG1_C213_revA)
 #warning using UBLOX_XPLR_HPG1_C213_revA
    // LTE (DCE)
    LTE_RESET   = -1,  LTE_PWR_ON     =  9,  LTE_ON      = -1,  LTE_INT = -1,
    LTE_TXI     = 46,  LTE_RXO        =  2,  LTE_RTS     = 38,  LTE_CTS =  4, 
    LTE_RI      =  7,  LTE_DSR        = -1,  LTE_DCD     = -1,  LTE_DTR = -1,
    LTE_PWR_ON_ACTIVE = HIGH, LTE_ON_ACTIVE = LOW,

    // Power supply
    VIN         = -1,  V33_EN         = -1, V33_EN_ACTIVE = HIGH,
    
    // Micro SD card
    MICROSD_SCK = 36,  MICROSD_SDI    = 37,  MICROSD_SDO = 35,   
    MICROSD_CS  = 34,  MICROSD_PWR_EN = -1,  MICROSD_DET = 34,
    MICROSD_DET_REMOVED = LOW, MICROSD_PWR_EN_ACTIVE = LOW,

    REQUIRED_GPIO_PIN = -1, REQUIRED_GPIO_PIN_ACTIVE = HIGH,

#elif (HW_TARGET == UBLOX_XPLR_HPG1_C213)
    // LTE (DCE)
    LTE_RESET   = -1,  LTE_PWR_ON     =  9,  LTE_ON      = -1,  LTE_INT = -1,
    LTE_TXI     = 46,  LTE_RXO        =  3,  LTE_RTS     = 38,  LTE_CTS =  4, 
    LTE_RI      =  7,  LTE_DSR        = -1,  LTE_DCD     = -1,  LTE_DTR = -1,
    LTE_PWR_ON_ACTIVE = HIGH, LTE_ON_ACTIVE = LOW,

    // Power supply
    VIN         = -1,  V33_EN         = -1, V33_EN_ACTIVE = HIGH,
    
    // Micro SD card
    MICROSD_SCK = 36,  MICROSD_SDI    = 37,  MICROSD_SDO = 35,   
    MICROSD_CS  = 34,  MICROSD_PWR_EN = -1,  MICROSD_DET = 34,
    MICROSD_DET_REMOVED = LOW, MICROSD_PWR_EN_ACTIVE = LOW,

    REQUIRED_GPIO_PIN = -1, REQUIRED_GPIO_PIN_ACTIVE = HIGH,

#elif (HW_TARGET == SPARKFUN_MICROMOD_ASSET_TRACKER)
    // LTE (DCE)
    LTE_RESET   = -1,  LTE_PWR_ON     = G2,  LTE_ON      = G6,  LTE_INT = G5, 
    LTE_TXI    = TX1,  LTE_RXO       = RX1,  LTE_RTS     = -1,  LTE_CTS = -1, 
    LTE_RI      = G4,  LTE_DSR        = -1,  LTE_DCD     = -1,  LTE_DTR = -1,
    LTE_PWR_ON_ACTIVE = HIGH, LTE_ON_ACTIVE = LOW,
   
    // Power supply
    VIN         = 39,  V33_EN         = -1, V33_EN_ACTIVE = HIGH,
    
    // Micro SD card
    MICROSD_SCK = SCK, MICROSD_SDI  = MISO, MICROSD_SDO = MOSI, 
    MICROSD_DET = -1,  MICROSD_PWR_EN = G1,  
    MICROSD_CS  = G0,
    MICROSD_DET_REMOVED = HIGH, MICROSD_PWR_EN_ACTIVE = LOW,

    REQUIRED_GPIO_PIN = -1, REQUIRED_GPIO_PIN_ACTIVE = HIGH,

#elif ((HW_TARGET == SPARKFUN_MICROMOD_MAINBOARD_PT) || (HW_TARGET == SPARKFUN_MICROMOD_MAINBOARD_DOUBLE_PT)) // using ESP 32 MicroMod MCU
    // LTE (DCE)   // assignable D0,A0,G0 (G4 G5 can't be used as duplicated on ESP32)
    LTE_RESET   = G2,  LTE_PWR_ON    = PWM0,  LTE_ON    = -1/*BUG G3/TX1*/,  LTE_INT = -1, 
    LTE_TXI    = TX1,  LTE_RXO        = RX1,  LTE_RTS   = -1,  LTE_CTS = -1,  // TX1/RX1 were swapped, all PT V1 boards patched
    LTE_RI      = G1,  LTE_DSR         = -1,  LTE_DCD   = -1,  LTE_DTR = -1,
    LTE_NI      = -1, /*BUG G4/RXD*/
    LTE_PWR_ON_ACTIVE = HIGH, LTE_ON_ACTIVE = LOW,

    // Power supply
    VIN         = 39,  V33_EN         = -1, V33_EN_ACTIVE = HIGH,
    
    // Micro SD card
    MICROSD_SCK = SCK, MICROSD_SDI  = MISO, MICROSD_SDO = MOSI, 
    MICROSD_DET = -1,  MICROSD_PWR_EN = 5,  
# if (HW_TARGET == SPARKFUN_MICROMOD_MAINBOARD_PT)
    MICROSD_CS  = D1,
# else
    MICROSD_CS  = G4,
# endif
    MICROSD_DET_REMOVED = HIGH, MICROSD_PWR_EN_ACTIVE = LOW,

    REQUIRED_GPIO_PIN = -1, REQUIRED_GPIO_PIN_ACTIVE = HIGH,

#elif (HW_TARGET == SPARKFUN_RTK_CONTROL)
    // LTE (DCE)
    LTE_RESET   = -1,  LTE_PWR_ON     = 26,  LTE_ON      =  5,  LTE_INT = -1, 
    LTE_TXI     = 13,  LTE_RXO        = 14,  LTE_RTS     = -1,  LTE_CTS = -1, 
    LTE_RI      = -1,  LTE_DSR        = -1,  LTE_DCD     = -1,  LTE_DTR = -1,
    LTE_NI      = 34,
    LTE_PWR_ON_ACTIVE = HIGH, LTE_ON_ACTIVE = HIGH,
   
    // Power supply
    VIN         = -1,  V33_EN         = 32, V33_EN_ACTIVE = HIGH,
    
    // Micro SD card
    MICROSD_SCK = SCK, MICROSD_SDI  = MISO, MICROSD_SDO = MOSI, 
    MICROSD_DET = 36,  MICROSD_PWR_EN = -1,  
    MICROSD_CS  = 4,
    MICROSD_DET_REMOVED = LOW, MICROSD_PWR_EN_ACTIVE = LOW,

    // Required GPIO pin - on SPARKFUN_RTK_CONTROL this is the WizNet W5500 CS
    REQUIRED_GPIO_PIN = 27, REQUIRED_GPIO_PIN_ACTIVE = HIGH,

#else // using ESP 32 MicroMod MCU
    // LTE (DCE)   // assignable D0,A0,G0 (G3/G4 can't be used as duplicated with TX1/RX1 on ESP32)
    LTE_RESET = PWM0,  LTE_PWR_ON     = G2,  LTE_ON      = SS,  LTE_INT = -1, 
    LTE_TXI    = TX1,  LTE_RXO       = RX1,  LTE_RTS     = -1,  LTE_CTS = -1, 
    LTE_RI      = -1,  LTE_DSR        = -1,  LTE_DCD     = -1,  LTE_DTR = -1,
    LTE_NI      = D0,
    LTE_PWR_ON_ACTIVE = HIGH, LTE_ON_ACTIVE = LOW,

    // Power supply
    VIN         = 39,  V33_EN         = -1, V33_EN_ACTIVE = HIGH,
    
    // Micro SD card
    MICROSD_SCK = SCK, MICROSD_SDI  = MISO, MICROSD_SDO = MOSI, 
    MICROSD_DET = -1,  MICROSD_PWR_EN = 5,  
# if (HW_TARGET == SPARKFUN_MICROMOD_MAINBOARD)
    MICROSD_CS  = D1,
# else
    MICROSD_CS  = G4,
# endif
    MICROSD_DET_REMOVED = HIGH, MICROSD_PWR_EN_ACTIVE = LOW,

    REQUIRED_GPIO_PIN = -1, REQUIRED_GPIO_PIN_ACTIVE = HIGH,

#endif
    PIN_INVALID = -1
};

/** Helper macro for GPIO debugging with a logic analyzer (e.g. Saleae Logic Pro 8 or 16)
 *  Will do nothing if pin is set invalid. Carefully check the schemtic before using a GPIO. 
 */
#define HW_DBG_PIN(pin,level) if (PIN_INVALID != pin) pinMode(pin, OUTPUT), digitalWrite(pin,level)
#define HW_DBG_HI(pin)        HW_DBG_PIN(pin,HIGH)  //!< put the at the start of the code to profile
#define HW_DBG_LO(pin)        HW_DBG_PIN(pin,LOW)   //!< put the at the end of the code to profile

class HW {
  
public:

  /** constructor
   */
  HW(){
    hwInit();
  }

  void hwInit(void) {
    // Do any top-level hardware initialization here:
    // Initialize any required GPIO pins
    if (PIN_INVALID != REQUIRED_GPIO_PIN) {
      digitalWrite(REQUIRED_GPIO_PIN, REQUIRED_GPIO_PIN_ACTIVE);
      pinMode(REQUIRED_GPIO_PIN, OUTPUT);
      digitalWrite(REQUIRED_GPIO_PIN, REQUIRED_GPIO_PIN_ACTIVE);
    }
    // Turn on the 3.3V regulator - if present
    if (PIN_INVALID != V33_EN) {
      digitalWrite(V33_EN, V33_EN_ACTIVE);
      pinMode(V33_EN, OUTPUT);
      digitalWrite(V33_EN, V33_EN_ACTIVE);
    }
    log_i("Hardware initialized");
  }

};

HW Hardware; //!< The global HW object

#endif // __HW_H__
