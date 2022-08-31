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

#if defined(ARDUINO_UBLOX_NINA_W10)
 #define HW_TARGET     MAZGCH_HPG_SOLUTION_V09
#elif defined(ARDUINO_UBLOX_NORA_W10)
 #define HW_TARGET     MAZGCH_HPG_MODULAR_V01
#elif defined(ARDUINO_ESP32_MICROMOD)
 #define HW_TARGET     SPARKFUN_MICROMOD_MAINBOARD
#else
 #error unknown board target 
#endif

#define MAZGCH_HPG_SOLUTION_V08              0 // Select ESP32 Arduino / u-blox NINA-W10 series (ESP32) 
#define MAZGCH_HPG_SOLUTION_V09              1 // Select ESP32 Arduino / u-blox NINA-W10 series (ESP32) 
#define MAZGCH_HPG_SOLUTION_V10              2 // Select ESP32 Arduino / u-blox NINA-W10 series (ESP32) 

#define MAZGCH_HPG_MODULAR_V01               5 // Select ESP32 Arduino / u-blox NORA-W10 series (ESP32-S3), LTE in slot 1

#define SPARKFUN_MICROMOD_MAINBOARD_PT      11 // Choose Spakfun ESP32 Arduino / Sparkfun ESP32 MicroMod / prototype LTE function
#define SPARKFUN_MICROMOD_MAINBOARD         12

#define SPARKFUN_MICROMOD_MAINBOARD_DOUBLE  21 // Choose Spakfun ESP32 Arduino / Sparkfun ESP32 MicroMod 

#define SPARKFUN_MICROMOD_ASSET_TRACKER     10 // Choose Spakfun ESP32 Arduino / Sparkfun ESP32 MicroMod

enum HW_PINS {  
    // Standard pins
    BOOT        =  0, 
    LED         =  2,
#if (HW_TARGET == MAZGCH_HPG_MODULAR_V01)
    CDC_RX      = 44,  CDC_TX         = 43,
    CAN_RX      = -1,  CAN_TX         = -1,
    I2C_SDA     = 18,  I2C_SCL        = 17,
#else
    CDC_RX      =  3,  CDC_TX         = 1,
    CAN_RX      =  4,  CAN_TX         = 5,
    I2C_SDA     = 21,  I2C_SCL        = 22,
#endif    
#if (HW_TARGET == MAZGCH_HPG_SOLUTION_V08)
 #warning using MAZGCH_HPG_SOLUTION_V08
    // LTE (DCE) - BUG 34/39 are input only.on V0.8 -> will swap in V0.9
    LTE_RESET   = -1 /*BUG 34 is IN only */, 
    LTE_PWR_ON  = -1 /*BUG 39 is IN only */, LTE_ON      = 37,  LTE_INT = -1,
    LTE_TXI     = 25,  LTE_RXO        = 26,  LTE_RTS     = 27,  LTE_CTS = 36, 
    LTE_RI      = 12,  LTE_DSR        = 13,  LTE_DCD     = 14,  LTE_DTR = 15,

    // Power supply
    VIN         = 35,  V33_EN         = 33,
    
    // Micro SD card - MISO / MOSI will be swapped to allow use of default pins 
    MICROSD_SCK = 18,  MICROSD_SDI    = 23,  MICROSD_SDO = 19,   
    MICROSD_CS  = 32,  MICROSD_PWR_EN = -1,  MICROSD_DET = 38,
    
#elif (HW_TARGET == MAZGCH_HPG_SOLUTION_V09)
    // LTE (DCE)
    LTE_RESET   = 13,  LTE_PWR_ON     = 12,  LTE_ON      = 37,  LTE_INT = -1,
    LTE_TXI     = 25,  LTE_RXO        = 26,  LTE_RTS     = 27,  LTE_CTS = 36, 
    LTE_RI      = 34,  LTE_DSR        = 39,  LTE_DCD     = 14,  LTE_DTR = 15,

    // Power supply
    VIN         = 35,  V33_EN         = 33,
    
    // Micro SD card
    MICROSD_SCK = 18,  MICROSD_SDI    = 19,  MICROSD_SDO = 23,   
    MICROSD_CS  = 32,  MICROSD_PWR_EN = -1,  MICROSD_DET = 38,
    
#elif (HW_TARGET == MAZGCH_HPG_SOLUTION_V10)
    // LTE (DCE)
    LTE_RESET   = 12,  LTE_PWR_ON     = 13,  LTE_ON      = 37,  LTE_INT = -1,
    LTE_TXI     = 25,  LTE_RXO        = 26,  LTE_RTS     = 27,  LTE_CTS = 36, 
    LTE_RI      = 34,  LTE_DSR        = 39,  LTE_DCD     = 14,  LTE_DTR = 15,

    // Power supply
    VIN         = 35,  V33_EN         = 33,
    
    // Micro SD card
    MICROSD_SCK = 18,  MICROSD_SDI    = 19,  MICROSD_SDO = 23,   
    MICROSD_CS  = 32,  MICROSD_PWR_EN = -1,  MICROSD_DET = 38,
    
#elif (HW_TARGET == MAZGCH_HPG_MODULAR_V01)
    // LTE (DCE)
    LTE_RESET   = -1,  LTE_PWR_ON     =  9,  LTE_ON      = -1,  LTE_INT = -1,
    LTE_TXI     = 46,  LTE_RXO        =  2,  LTE_RTS     = 38,  LTE_CTS =  4, 
    LTE_RI      =  7,  LTE_DSR        = -1,  LTE_DCD     = -1,  LTE_DTR = -1,

    // Power supply
    VIN         = -1,  V33_EN         = -1,
    
    // Micro SD card
    MICROSD_SCK = 36,  MICROSD_SDI    = 37,  MICROSD_SDO = 35,   
    MICROSD_CS  = 34,  MICROSD_PWR_EN = -1,  MICROSD_DET = -1,
    
#elif (HW_TARGET == SPARKFUN_MICROMOD_ASSET_TRACKER)
    // LTE (DCE)
    LTE_RESET   = -1,  LTE_PWR_ON     = G2,  LTE_ON      = G6,  LTE_INT = G5, 
    LTE_TXI    = TX1,  LTE_RXO       = RX1,  LTE_RTS     = -1,  LTE_CTS = -1, 
    LTE_RI      = G4,  LTE_DSR        = -1,  LTE_DCD     = -1,  LTE_DTR = -1,
   
    // Power supply
    VIN         = 39,  V33_EN         = -1,
    
    // Micro SD card
    MICROSD_SCK = SCK, MICROSD_SDI  = MISO, MICROSD_SDO = MOSI, 
    MICROSD_DET = -1,  MICROSD_PWR_EN = G1,  
    MICROSD_CS  = G0,

#elif ((HW_TARGET == SPARKFUN_MICROMOD_MAINBOARD_PT) || (HW_TARGET == SPARKFUN_MICROMOD_MAINBOARD_DOUBLE_PT)) // using ESP 32 MicroMod MCU
    // LTE (DCE)   // assignable D0,A0,G0 (G4 G5 can't be used as duplicated on ESP32)
    LTE_RESET   = G2,  LTE_PWR_ON    = PWM0,  LTE_ON    = -1/*BUG G3/TX1*/,  LTE_INT = -1, 
    LTE_TXI    = TX1,  LTE_RXO        = RX1,  LTE_RTS   = -1,  LTE_CTS = -1,  // TX1/RX1 were swapped, all PT V1 boards patched
    LTE_RI      = G1,  LTE_DSR         = -1,  LTE_DCD   = -1,  LTE_DTR = -1,
    LTE_NI      = -1, /*BUG G4/RXD*/
    // Power supply
    VIN         = 39,  V33_EN         = -1,
    
    // Micro SD card
    MICROSD_SCK = SCK, MICROSD_SDI  = MISO, MICROSD_SDO = MOSI, 
    MICROSD_DET = -1,  MICROSD_PWR_EN = 5,  
# if (HW_TARGET == SPARKFUN_MICROMOD_MAINBOARD_PT)
    MICROSD_CS  = D1,
# else
    MICROSD_CS  = G4,
# endif

#else // using ESP 32 MicroMod MCU
    // LTE (DCE)   // assignable D0,A0,G0 (G3/G4 can't be used as duplicated with TX1/RX1 on ESP32)
    LTE_RESET = PWM0,  LTE_PWR_ON     = G2,  LTE_ON      = SS,  LTE_INT = -1, 
    LTE_TXI    = TX1,  LTE_RXO       = RX1,  LTE_RTS     = -1,  LTE_CTS = -1, 
    LTE_RI      = -1,  LTE_DSR        = -1,  LTE_DCD     = -1,  LTE_DTR = -1,
    LTE_NI      = D0,
    // Power supply
    VIN         = 39,  V33_EN         = -1,
    
    // Micro SD card
    MICROSD_SCK = SCK, MICROSD_SDI  = MISO, MICROSD_SDO = MOSI, 
    MICROSD_DET = -1,  MICROSD_PWR_EN = 5,  
# if (HW_TARGET == SPARKFUN_MICROMOD_MAINBOARD)
    MICROSD_CS  = D1,
# else
    MICROSD_CS  = G4,
# endif

#endif
    PIN_INVALID = -1
};

#define HW_DBG_PIN(pin,level) if (PIN_INVALID != pin) pinMode(pin, OUTPUT), digitalWrite(pin,level)
#define HW_DBG_HI(pin)        HW_DBG_PIN(pin,HIGH)
#define HW_DBG_LO(pin)        HW_DBG_PIN(pin,LOW)

#define HW_DBG_WLAN           PIN_INVALID//D1
#define HW_DBG_LTE            PIN_INVALID//D0
#define HW_DBG_GNSS           PIN_INVALID//PWM1
#define HW_DBG_LBAND          PIN_INVALID//PWM1
#define HW_DBG_WLAN_MGR       PIN_INVALID//PWM0
#define HW_DBG_LOG_ERR        PIN_INVALID

#endif // __HW_H__
