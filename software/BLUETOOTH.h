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
 
#ifndef __BLUETOOTH_H__
#define __BLUETOOTH_H__

#if !defined(CONFIG_BT_ENABLED) || !defined(CONFIG_BLUEDROID_ENABLED)
#error Bluetooth is not enabled! Please run `make menuconfig` to and enable it
#endif

#if !defined(CONFIG_BT_SPP_ENABLED)
#error Serial Bluetooth not available or not enabled. It is only available for the ESP32 chip.
#endif

class BLUETOOTH : public BluetoothSerial {
public:
  void begin(void) {
    String name = Config.getDeviceName();
/*  onData(onDataCb);
    onConfirmRequest(onConfirmRequestCb);
    onAuthComplete(onAuthCompleteCb);*/
    enableSSP();
    BluetoothSerial::begin(name, true);
    Log.info("BLUETOOTH begin pair with device \"%s\"", name.c_str());
  }

  void poll() {
    if (available()) {
      write(read());
    }
  }

protected:
/*static void onDataCb(const uint8_t *buffer, size_t size) {
    Log.debug("BLUETOOTH onBluetoothSerialData %d bytes", size);
  }
  static void onConfirmRequestCb(uint32_t num_val) {
    Log.debug("BLUETOOTH onConfirmRequest %d", num_val);
    Bluetooth.confirmReply(true);
  }
  static void onAuthCompleteCb(boolean success) {
    Log.debug("BLUETOOTH onAuthComplete %d", success);
  }*/
};

BLUETOOTH Bluetooth;

#endif // __BLUETOOTH_H__
