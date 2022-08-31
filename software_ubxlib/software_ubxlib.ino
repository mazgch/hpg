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
// So for me this will do the job
// rm -rf /Users/michaelammann/Documents/Arduino/libraries/ubxlib
// cd Users/michaelammann/Documents/GitHub/ubxlib_priv/port/platform/arduino
// python3 u_arduino.py -o /Users/michaelammann/Documents/Arduino/libraries/ubxlib
#include <ubxlib.h>

/* ----------------------------------------------------------------
 * VARIABLES
 * -------------------------------------------------------------- */

enum HW_PINS {  
    I2C_SDA     = 21,  I2C_SCL        = 22,
    // LTE (DCE)
    LTE_RESET   = 13,  LTE_PWR_ON     = 12,  LTE_ON      = 37,  LTE_INT = -1,
    LTE_TXI     = 25,  LTE_RXO        = 26,  LTE_RTS     = 27,  LTE_CTS = 36, 
    LTE_RI      = 34,  LTE_DSR        = 39,  LTE_DCD     = 14,  LTE_DTR = 15,
    PIN_INVALID = -1
};

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
                                    size_t size,
                                    void *pCallbackParam)
 {

     char* pBuffer = (char*) malloc(size);
     if (pBuffer) {
        if (uGnssMsgReceiveCallbackRead(gnssHandle, pBuffer, size) == size) {
            if (pMessageId->type == U_GNSS_PROTOCOL_UBX) {
                printf("%s Message size %d UBX-%02X-%02X\n", pCallbackParam, size, pBuffer[3], pBuffer[4]);
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
