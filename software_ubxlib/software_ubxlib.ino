/*
 * Copyright 2022 u-blox
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/** @brief This is an Arduino version of main.c, demonstrating how to
 * bring up a network connection and then perform sockets operations
 * with a server on the public internet using a u-blox module.
 */

// UBXLIB 
//-----------------------------------
// Github Repository:  https://github.com/u-blox/ubxlib
// Execute: cd port/platform/arduino 
//          python3 u_arduino.py -o <ArduinoLibPath>/libraries/ubxlib
/* So for me this will do the job
   rm -rf /Users/michaelammann/Documents/Arduino/libraries/ubxlib
   cd /Users/michaelammann/Documents/GitHub/ubxlib_priv/port/platform/arduino
   python3 u_arduino.py -o /Users/michaelammann/Documents/Arduino/libraries/ubxlib
*/
#include <ubxlib.h>

#include "hw.h"

/* ----------------------------------------------------------------
 * VARIABLES
 * -------------------------------------------------------------- */

static const uDeviceCfg_t gDeviceCfgModem = {
    .version = 0,
    .deviceType = U_DEVICE_TYPE_CELL,
    .deviceCfg = {
        .cfgCell = {
            .version = 0,
            .moduleType = U_CELL_MODULE_TYPE_LARA_R6,
            .pSimPinCode = NULL, /* SIM pin */
            .pinEnablePower     = PIN_INVALID,
            .pinPwrOn           = LTE_PWR_ON | U_CELL_PIN_INVERTED,
            .pinVInt            = LTE_ON | U_CELL_PIN_INVERTED,
            .pinDtrPowerSaving  = LTE_DTR,
        },
    },
    .transportType = U_DEVICE_TRANSPORT_TYPE_UART,
    .transportCfg = {
        .cfgUart = {
            .version = 0,
            .uart = 1,
            .baudRate = U_CELL_UART_BAUD_RATE,
            .pinTxd = LTE_TXI,
            .pinRxd = LTE_RXO,
            .pinCts = LTE_CTS,
            .pinRts = LTE_RTS,
        },
    },
};

static const uNetworkCfgCell_t gNetworkCfgModem = {
    .version = 0,
    .type = U_NETWORK_TYPE_CELL,
    .pApn = NULL,           /* APN: NULL to accept default.  If using a Thingstream SIM enter "tsiot" here */
    .timeoutSeconds = 240,  /* Connection timeout in seconds */
};

static const uDeviceCfg_t gDeviceCfgGnss = {
    .version = 0,
    .deviceType = U_DEVICE_TYPE_GNSS,
    .deviceCfg = {
        .cfgGnss = {
            .version = 0,
            .moduleType = U_GNSS_MODULE_TYPE_M9,
            .pinEnablePower = PIN_INVALID,
            .pinDataReady = PIN_INVALID, // Not used
            .includeNmea = true,
            .i2cAddress = U_GNSS_I2C_ADDRESS
        },
    },
    .transportType = U_DEVICE_TRANSPORT_TYPE_I2C,
    .transportCfg = {
        .cfgI2c = {
            .version = 0,
            .i2c = 0,
            .pinSda = I2C_SDA,
            .pinScl = I2C_SCL,
            .clockHertz = 400000,
            .alreadyOpen = false
        },
    },
};

// NETWORK configuration for GNSS
static const uNetworkCfgGnss_t gNetworkCfgGnss = {
    .version = 0,
    .type = U_NETWORK_TYPE_GNSS,
    .moduleType = U_GNSS_MODULE_TYPE_M9,
    .devicePinPwr = PIN_INVALID,
    .devicePinDataReady = PIN_INVALID
};

static const uDeviceCfg_t gDeviceCfgLband = {
    .version = 0,
    .deviceType = U_DEVICE_TYPE_GNSS,
    .deviceCfg = {
        .cfgGnss = {
            .version = 0,
            .moduleType = U_GNSS_MODULE_TYPE_M9,
            .pinEnablePower = PIN_INVALID,
            .pinDataReady = PIN_INVALID,
            .includeNmea = false,
            .i2cAddress = U_GNSS_I2C_ADDRESS+1,
        },
    },
    .transportType = U_DEVICE_TRANSPORT_TYPE_I2C,
    .transportCfg = {
        .cfgI2c = {
            .version = 0,
            .i2c = 0,
            .pinSda = I2C_SDA,
            .pinScl = I2C_SCL,
            .clockHertz = 400000,
            .alreadyOpen = true
        },
    },
};

// NETWORK configuration for LBAND
static const uNetworkCfgGnss_t gNetworkCfgLband = {
    .version = 0,
    .type = U_NETWORK_TYPE_GNSS,
    .moduleType = U_GNSS_MODULE_TYPE_M9,
    .devicePinPwr = PIN_INVALID,
    .devicePinDataReady = PIN_INVALID
};

// The network handle
static uDeviceHandle_t devHandleModem = NULL;
static uDeviceHandle_t devHandleGnss = NULL;
static uDeviceHandle_t devHandleLband = NULL;

// A global error code
static int32_t errorCodeModem = U_ERROR_COMMON_NOT_INITIALISED;
static int32_t errorCodeGnss = U_ERROR_COMMON_NOT_INITIALISED;
static int32_t errorCodeLband = U_ERROR_COMMON_NOT_INITIALISED;

/* ----------------------------------------------------------------
 * UTILITY FUNCTIONS
 * -------------------------------------------------------------- */

// Print out an address structure.
static void printAddress(const uSockAddress_t *pAddress, bool hasPort)
{
    switch (pAddress->ipAddress.type) {
        case U_SOCK_ADDRESS_TYPE_V4:
            printf("IPV4");
            break;
        case U_SOCK_ADDRESS_TYPE_V6:
            printf("IPV6");
            break;
        case U_SOCK_ADDRESS_TYPE_V4_V6:
            printf("IPV4V6");
            break;
        default:
            printf("unknown type (%d)", pAddress->ipAddress.type);
            break;
    }

    printf(" ");

    if (pAddress->ipAddress.type == U_SOCK_ADDRESS_TYPE_V4) {
        for (int32_t x = 3; x >= 0; x--) {
            printf("%u", (pAddress->ipAddress.address.ipv4 >> (x * 8)) & 0xFF);
            if (x > 0) {
                printf(".");
            }
        }
        if (hasPort) {
            printf(":%u", pAddress->port);
        }
    } else if (pAddress->ipAddress.type == U_SOCK_ADDRESS_TYPE_V6) {
        if (hasPort) {
            printf("[");
        }
        for (int32_t x = 3; x >= 0; x--) {
            printf("%x:%x", pAddress->ipAddress.address.ipv6[x] >> 16,
                     pAddress->ipAddress.address.ipv6[x] & 0xFFFF);
            if (x > 0) {
                printf(":");
            }
        }
        if (hasPort) {
            printf("]:%u", pAddress->port);
        }
    }
}

/* ----------------------------------------------------------------
 * THE EXAMPLE
 * -------------------------------------------------------------- */

void setup() {
    int32_t returnCode;
    // Initialise the APIs we will need
    
    if (PIN_INVALID != LTE_RESET) {
      digitalWrite(LTE_RESET, HIGH);
      pinMode(LTE_RESET, OUTPUT);
      digitalWrite(LTE_RESET, HIGH);
    }
    //uPortLogOff();

    uPortInit();
    uPortI2cInit(); // You only need this if an I2C interface is used
    uDeviceInit();
#define CHECK_INIT        int _step = 0; bool _ok = 0
#define CHECK_OK          (_ok >= 0)
#define CHECK             if (_ok >= 0) _step ++, _ok
#define CHECK_EVAL(txt)   if (_ok < 0) printf(txt ", sequence failed at step %d\n", _step); else printf(txt " everything ok\n")

    printf("SCL %d %d SDA %d %d\n", SDA, I2C_SDA, SCL, I2C_SCL);
    returnCode = uDeviceOpen(&gDeviceCfgGnss, &devHandleGnss);
    if (returnCode >= 0) {
        printf("Added Gnss network with handle %p.\n", devHandleGnss);
        uGnssSetUbxMessagePrint(devHandleGnss, false);

        uint8_t id[5];
        uGnssVersionType_t version;
        uGnssInfoGetVersions(devHandleGnss, &version);
        uGnssInfoGetIdStr(devHandleGnss, (char*)id, sizeof(id));
        printf("Added Gnss version %s hw %s rom %s fw %s prot %s mod %s id %02x%02x%02x%02x%02x.\n", version.ver, version.hw, 
              version.rom, version.fw, version.prot, version.mod, id[0], id[1], id[2], id[3], id[4]);

        String fwver = version.fw;
        CHECK_INIT;
        CHECK = U_GNSS_CFG_SET_VAL(devHandleGnss, NMEA_HIGHPREC_L,                1, U_GNSS_CFG_VAL_LAYER_RAM);
        CHECK = U_GNSS_CFG_SET_VAL(devHandleGnss, MSGOUT_UBX_NAV_PVT_I2C_U1,      1, U_GNSS_CFG_VAL_LAYER_RAM);
        CHECK = U_GNSS_CFG_SET_VAL(devHandleGnss, MSGOUT_UBX_NAV_SAT_I2C_U1,      1, U_GNSS_CFG_VAL_LAYER_RAM);
        CHECK = U_GNSS_CFG_SET_VAL(devHandleGnss, MSGOUT_UBX_NAV_HPPOSLLH_I2C_U1, 1, U_GNSS_CFG_VAL_LAYER_RAM);
        CHECK = U_GNSS_CFG_SET_VAL(devHandleGnss, MSGOUT_UBX_RXM_COR_I2C_U1,      1, U_GNSS_CFG_VAL_LAYER_RAM);
        if (fwver.startsWith("HPS ")) {
          CHECK = U_GNSS_CFG_SET_VAL(devHandleGnss, MSGOUT_UBX_ESF_STATUS_I2C_U1, 1, U_GNSS_CFG_VAL_LAYER_RAM);
        }
        if (fwver.equals("HPS 1.30A01") || fwver.equals("HPS 1.30B01")) { // ZED-F9R LAP demo firmware, Supports 2.0 but doesn't have protection level
          printf("GNSS firmware %s is a time-limited demonstrator, please update firmware in Q4/2022\n", fwver.c_str());
        } else if (fwver.substring(4).toDouble() < 1.30) { // ZED-F9R/P old release firmware, no Spartan 2.0 support
          printf("GNSS firmware %s does not support Spartan 2.0, please update firmware\n", fwver.c_str());
        } else {
          CHECK = U_GNSS_CFG_SET_VAL(devHandleGnss, MSGOUT_UBX_NAV_PL_I2C_U1,     1, U_GNSS_CFG_VAL_LAYER_RAM);
        }
        CHECK_EVAL("ZED-F9"); 
        errorCodeGnss = uNetworkInterfaceUp(devHandleGnss, U_NETWORK_TYPE_GNSS, 
                                        &gNetworkCfgGnss);
        printf("Bringing up the Gnss network... %d\n", errorCodeGnss);
    } else {
        printf("Unable to add Gnss network, error %d!\n", returnCode);
    }

    returnCode = uDeviceOpen(&gDeviceCfgLband, &devHandleLband);
    if (returnCode >= 0) {
        printf("Added Lband network with handle %p.\n", devHandleLband);
        uGnssSetUbxMessagePrint(devHandleLband, false);

        uint8_t id[5];
        uGnssVersionType_t version;
        uGnssInfoGetVersions(devHandleLband, &version);
        uGnssInfoGetIdStr(devHandleLband, (char*)id, sizeof(id));
        printf("Added Lband version %s hw %s rom %s fw %s prot %s mod %s id %02x%02x%02x%02x%02x.\n", version.ver, version.hw, 
              version.rom, version.fw, version.prot, version.mod, id[0], id[1], id[2], id[3], id[4]);
        String fwver = version.fw;
        bool qzss = fwver.startsWith("QZS");
        #define LBAND_FREQ_NOUPDATE 0xFFFFFFFFF
        uint32_t freq = 1556290000;
        if (qzss){ // NEO-D9C
          freq = LBAND_FREQ_NOUPDATE; // prevents freq update
          CHECK_INIT;
          CHECK = U_GNSS_CFG_SET_VAL(devHandleLband, MSGOUT_UBX_RXM_QZSSL6_I2C_U1,   1, U_GNSS_CFG_VAL_LAYER_RAM);    
          // prepare the UART 2
          CHECK = U_GNSS_CFG_SET_VAL(devHandleLband, MSGOUT_UBX_RXM_QZSSL6_UART2_U1, 1, U_GNSS_CFG_VAL_LAYER_RAM);    
          CHECK = U_GNSS_CFG_SET_VAL(devHandleLband, UART2_BAUDRATE_U4,          38400, U_GNSS_CFG_VAL_LAYER_RAM); 
          CHECK_EVAL("NEO-D9C");      
        } else
        { // NEO-D9S
          CHECK_INIT;
          CHECK = U_GNSS_CFG_SET_VAL(devHandleLband, PMP_SEARCH_WINDOW_U2,        2200, U_GNSS_CFG_VAL_LAYER_RAM);    
          CHECK = U_GNSS_CFG_SET_VAL(devHandleLband, PMP_USE_SERVICE_ID_L,           0, U_GNSS_CFG_VAL_LAYER_RAM);    
          CHECK = U_GNSS_CFG_SET_VAL(devHandleLband, PMP_SERVICE_ID_U2,          21845, U_GNSS_CFG_VAL_LAYER_RAM);    
          CHECK = U_GNSS_CFG_SET_VAL(devHandleLband, PMP_DATA_RATE_E2,            2400, U_GNSS_CFG_VAL_LAYER_RAM);    
          CHECK = U_GNSS_CFG_SET_VAL(devHandleLband, PMP_USE_DESCRAMBLER_L,          1, U_GNSS_CFG_VAL_LAYER_RAM);    
          CHECK = U_GNSS_CFG_SET_VAL(devHandleLband, PMP_DESCRAMBLER_INIT_U2,    26969, U_GNSS_CFG_VAL_LAYER_RAM);    
          CHECK = U_GNSS_CFG_SET_VAL(devHandleLband, PMP_USE_PRESCRAMBLING_L,        0, U_GNSS_CFG_VAL_LAYER_RAM);    
          CHECK = U_GNSS_CFG_SET_VAL(devHandleLband, PMP_UNIQUE_WORD_U8, 16238547128276412563ull, U_GNSS_CFG_VAL_LAYER_RAM);    
          CHECK = U_GNSS_CFG_SET_VAL(devHandleLband, PMP_CENTER_FREQUENCY_U4,     freq, U_GNSS_CFG_VAL_LAYER_RAM);    
          CHECK = U_GNSS_CFG_SET_VAL(devHandleLband, MSGOUT_UBX_RXM_PMP_I2C_U1,      1, U_GNSS_CFG_VAL_LAYER_RAM);    
          CHECK = U_GNSS_CFG_SET_VAL(devHandleLband, MSGOUT_UBX_RXM_PMP_UART2_U1,    1, U_GNSS_CFG_VAL_LAYER_RAM);    
          CHECK = U_GNSS_CFG_SET_VAL(devHandleLband, UART2_BAUDRATE_U4,          38400, U_GNSS_CFG_VAL_LAYER_RAM); 
          CHECK_EVAL("NEO-D9S");   
        }
        errorCodeLband = uNetworkInterfaceUp(devHandleLband, U_NETWORK_TYPE_GNSS, 
                                        &gNetworkCfgLband);
        printf("Bringing up the Lband network... %d\n", errorCodeLband);
    } else {
        printf("Unable to add Lband network, error %d!\n", returnCode);
    }
#if 0
    // Open the device.  Once this function has returned a
    // non-negative value then the transport is powered-up,
    // can be configured etc. but is not yet connected.
    returnCode = uDeviceOpen(&gDeviceCfgModem, &devHandleModem);
    if (returnCode >= 0) {
        printf("Added Cell network with handle %p.\n", devHandleModem);
        // Bring up the network layer, i.e. connect it so that
        // after this point it may be used to transfer data.
        printf("Bringing up the Cell network...\n");
        errorCodeModem = uNetworkInterfaceUp(devHandleModem, U_NETWORK_TYPE_CELL,
                                        &gNetworkCfgModem);
        printf("Cell network Up %d...\n", errorCodeModem);
    } else {
        printf("Unable to add Modem network, error %d!\n", returnCode);
    }
#endif
}

static void messageReceiveCallback(uDeviceHandle_t gnssHandle,
                                    const uGnssMessageId_t *pMessageId,
                                    int32_t size,
                                    void *pCallbackParam)
{
  if (size > 0) {
    char* pBuffer = (char*) malloc(size);
    if (pBuffer) {
      if (uGnssMsgReceiveCallbackRead(gnssHandle, pBuffer, size) == size) {
        if ((pBuffer[2] == 0x01/*NAV*/) && (pBuffer[3] == 0x07/*PVT*/)) printf("%s Message size %d UBX-NAV-PVT\n", pCallbackParam, size);
        else if ((pBuffer[2] == 0x01/*NAV*/) && (pBuffer[3] == 0x14/*HPPOSLLH*/)) printf("%s Message size %d UBX-NAV-HPPOSLLH\n", pCallbackParam, size);
        else if ((pBuffer[2] == 0x01/*NAV*/) && (pBuffer[3] == 0x35/*SAT*/)) printf("%s Message size %d UBX-NAV-SAT\n", pCallbackParam, size);
        else if ((pBuffer[2] == 0x02/*RXM*/) && (pBuffer[3] == 0x72/*PMP*/)) printf("%s Message size %d UBX-RXM-PMP\n", pCallbackParam, size);
        else if ((pBuffer[2] == 0x02/*RXM*/) && (pBuffer[3] == 0x34/*COR*/)) printf("%s Message size %d UBX-RXM-COR\n", pCallbackParam, size);
        else if ((pBuffer[2] == 0x02/*RXM*/) && (pBuffer[3] == 0x73/*QZSS*/)) printf("%s Message size %d UBX-RXM-QZSSL6\n", pCallbackParam, size);
        else if ((pBuffer[2] == 0x10/*ESF*/) && (pBuffer[3] == 0x10/*STATUS*/)) printf("%s Message size %d UBX-ESF-STATUS\n", pCallbackParam, size);
        else if (pMessageId->type == U_GNSS_PROTOCOL_UBX) {
          printf("%s Message size %d UBX-%02X-%02X\n", pCallbackParam, size, pBuffer[2], pBuffer[3]);
        } else if (pMessageId->type == U_GNSS_PROTOCOL_NMEA) {
          pBuffer[size-2] = 0;
          printf("%s Message size %d NMEA %s\n", pCallbackParam, size, pBuffer);
        } else {
          printf("%s Message size %d type %d\n", pCallbackParam, size, pMessageId->type);
        }
      }
      free(pBuffer);
     }
   }
 }
 
void loop() {
    size_t txSize = 0;
    size_t rxSize = 0;
    int32_t tries = 10;
    int32_t wait = 1000;
      
    uGnssMessageId_t messageId;
    messageId.type = U_GNSS_PROTOCOL_UBX;
    messageId.id.ubx = (U_GNSS_UBX_MESSAGE_CLASS_ALL << 8) | U_GNSS_UBX_MESSAGE_ID_ALL;
    messageId.type = U_GNSS_PROTOCOL_ALL;
    
    int32_t asyncHandleGnss = U_ERROR_COMMON_NOT_INITIALISED;
    int32_t asyncHandleLband = U_ERROR_COMMON_NOT_INITIALISED;
    if (errorCodeGnss >= 0) {
        //uGnssCfgSetProtocolOut(devHandleGnss, U_GNSS_PROTOCOL_NMEA, true);
        //uGnssCfgSetProtocolOut(devHandleGnss, U_GNSS_PROTOCOL_UBX, true);
        //uGnssSetUbxMessagePrint(devHandleGnss, true);
        asyncHandleGnss = uGnssMsgReceiveStart(devHandleGnss, &messageId,
                                                messageReceiveCallback,
                                                (void*)"GNSS");
        printf("GNSS Start Listening %d...\n", asyncHandleGnss);
    }
    if (errorCodeLband >= 0) {
        //uGnssCfgSetProtocolOut(devHandleLband, U_GNSS_PROTOCOL_NMEA, true);
        //uGnssCfgSetProtocolOut(devHandleLband, U_GNSS_PROTOCOL_UBX, true);
        //uGnssSetUbxMessagePrint(devHandleLband, true);
        asyncHandleLband = uGnssMsgReceiveStart(devHandleLband, &messageId,
                                                messageReceiveCallback,
                                                (void*)"LBAND");
        printf("LBAND Start Listening %d...\n", asyncHandleLband);
    }
    for (int32_t i = 0; i < tries; i ++) {
        printf("Still Listening %d ...\n", i);
        delay(wait);
    }
    printf("Stop Listening...\n");
    
    if (errorCodeLband >= 0) {
        uGnssMsgReceiveStop(devHandleLband, asyncHandleLband);
    
        printf("Taking down LBAND...\n");
        uNetworkInterfaceDown(devHandleLband, U_NETWORK_TYPE_GNSS);
    }
    
    if (asyncHandleGnss >= 0) {
        uGnssMsgReceiveStop(devHandleGnss, asyncHandleGnss);
    
        uLocation_t location;
        if (uLocationGet(devHandleGnss, U_LOCATION_TYPE_GNSS,
                         NULL, NULL, &location, NULL) == 0) {
            printf("I am here: https://maps.google.com/?q=%f/%f\n",
                     location.latitudeX1e7 * 1e-7,
                     location.longitudeX1e7 * 1e-7);
        } else {
            printf("Unable to get a location fix!\n");
        }
     
        printf("Taking down GNSS...\n");
        uNetworkInterfaceDown(devHandleGnss, U_NETWORK_TYPE_GNSS);
    }
    
    if (errorCodeModem >= 0) {
        int32_t x = 0;
        int32_t sock;
        uSockAddress_t address;
        const char message[] = "The quick brown fox jumps over the lazy dog.";
        txSize = sizeof(message);
        char buffer[64];
        // Do things using the network, for
        // example connect and send data to
        // an echo server over a TCP socket
        // as follows

        // Get the IP address of the echo server using
        // the network's DNS resolution facility
        printf("Looking up server address...\n");
        uSockGetHostByName(devHandleModem, "ubxlib.it-sgn.u-blox.com",
                           &(address.ipAddress));
        printf("Address is: ");
        printAddress(&address, false);
        // The echo server is configured to echo TCP
        // packets on port 5055
        address.port = 5055;
        printf("\n");

        // Create the socket on the network
        printf("Creating socket...\n");
        sock = uSockCreate(devHandleModem,
                           U_SOCK_TYPE_STREAM,
                           U_SOCK_PROTOCOL_TCP);

        // Make a TCP connection to the server using
        // the socket
        if (uSockConnect(sock, &address) == 0) {
            // Send the data over the socket
            // and print the echo that comes back
            printf("Sending data...\n");
            while ((x >= 0) && (txSize > 0)) {
                x = uSockWrite(sock, message, txSize);
                if (x > 0) {
                    txSize -= x;
                }
            }
            printf("Sent %d byte(s) to echo server.\n", sizeof(message) - txSize);
            while ((x >= 0) && (rxSize < sizeof(message))) {
                x = uSockRead(sock, buffer + rxSize, sizeof(buffer) - rxSize);
                if (x > 0) {
                    rxSize += x;
                }
            }
            if (rxSize > 0) {
                printf("\nReceived echo back (%d byte(s)): %s\n", rxSize, buffer);
            } else {
                printf("\nNo reply received!\n");
            }
        } else {
            printf("Unable to connect to server!\n");
        }

        // Note: since devHandle is a cellular
        // handle any of the `cell` API calls
        // could be made here using it.
        // If the configuration used were Wifi
        // then the `wifi` API calls could be
        // used

        // Close the socket
        printf("Closing socket...\n");
        uSockShutdown(sock, U_SOCK_SHUTDOWN_READ_WRITE);
        uSockClose(sock);
        uSockCleanUp();
    } else {
        printf("Network is not available!\n");
    }

    // The remainder of this function is for u-blox internal
    // testing only, you can happily delete it
    int32_t failures = 0;
    int32_t tests = 0;
#ifdef U_CFG_TEST_CELL_MODULE_TYPE
    tests = 1;
    if ((txSize != 0) || (rxSize != sizeof(message))) {
        failures = 1;
    }
#endif
    printf("%d Tests %d Failures 0 Ignored\n", tests, failures);

    // Close the device
    // Note: we don't power the device down here in order
    // to speed up testing; you may prefer to power it off
    // by setting the second parameter to true.
    uDeviceClose(devHandleModem, false);
    uDeviceClose(devHandleGnss, false);
    uDeviceClose(devHandleLband, false);

    // Tidy up
    uDeviceDeinit();
    uPortDeinit();

    // We make the loop stop here as otherwise it will
    // send data again and you could run-up a large bill
    while (1) {
        // Can't just be an infinite loop as there might
        // be a watchdog timer running
        delay(1000);
    }
}
