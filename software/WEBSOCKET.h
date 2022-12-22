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
 
#ifndef __WEBSOCKET__H__
#define __WEBSOCKET__H__

#include <ArduinoWebsockets.h>
using namespace websockets;

const uint16_t WEBSOCKET_PORT     =        8080; //!< needs to match WEBSOCKET_HTML and hpg.mazg.ch value

#define WEBSOCKET_HPGMAZGCHURL    "http://hpg.mazg.ch"
#define WEBSOCKET_HPGMAZGCHNAME   "mazg.ch HPG Monitor"
#define WEBSOCKET_URL             "/monitor.html"
#define WEBSOCKET_JSURL           "/monitor.js"
#define WEBSOCKET_CSSURL          "/monitor.css"
#define WEBSOCKET_BUTTON          "Monitor"

/** This class encapsulates all WLAN functions. 
*/
class WEBSOCKET : public Stream {

public: 

  /** constructor
   *  \param size  the size of the cicular buffer
   */
  WEBSOCKET(size_t size = 5*1024) : buffer{size} {
    mutex = xSemaphoreCreateMutex();
    queue = xQueueCreate(10, sizeof(MSG));
    connected = false;
  }

  /** attach the the websocket to the manager and start listening
   */
  void setup(WiFiManager& manager) {
    pManager = &manager;
    pManager->setCustomMenuHTML("<form action=\"" WEBSOCKET_URL "\" method=\"get\"><button>" WEBSOCKET_BUTTON "</button></form><br>"
            "<button onclick=\"window.location.href='" WEBSOCKET_HPGMAZGCHURL "?ip='+window.location.hostname\">" WEBSOCKET_HPGMAZGCHNAME "</button><br><br>"
    );
    wsServer.listen(WEBSOCKET_PORT);
    if (!wsServer.available()) {
      log_i("server unavailable");
    }
  }

  /** register the pages to be served
   */
  void bind(void) {
    if ((NULL != pManager) && (NULL != pManager->server)) {
      pManager->server->on(WEBSOCKET_URL,    std::bind(&WEBSOCKET::serveHtml, this));
      pManager->server->on(WEBSOCKET_JSURL,  std::bind(&WEBSOCKET::serveJs,   this));           
      pManager->server->on(WEBSOCKET_CSSURL, std::bind(&WEBSOCKET::serveCss,  this));           
    }
  }

  /** check the available and potential new clients
   */
  void poll(void) {
    // poll all clients
    for (auto it = wsClients.begin(); (it != wsClients.end()); it = std::next(it)) {
      if (it->available()) {
        it->poll();
      } else {
        log_i("client unavailable");
        it->close();
        wsClients.erase(it);
        it = std::prev(it);
      }
    }
    if (wsServer.poll()) {
      // check for a new client
      WebsocketsClient client = wsServer.accept();
      client.onMessage(onMessage);
      client.onEvent(onEvent);
      client.ping();
      String string = Config.getDeviceName();
      string = "Connected to " + string + "\r\n";
      client.send(string.c_str());
      log_i("new client, total %d", wsClients.size() + 1);
      wsClients.push_back(client);
    }
    connected = wsClients.size() > 0;
    send();
  }

  // --------------------------------------------------------------------------------------
  // STREAM interface: https://github.com/arduino/ArduinoCore-API/blob/master/api/Stream.h
  // --------------------------------------------------------------------------------------
 
  typedef enum                          {  WLAN = 0, LTE,   LBAND,   GNSS, NUM } SOURCE; //!< source enum for MSG
  const char* SOURCE_LUT[SOURCE::NUM] = { "WLAN",   "LTE", "LBAND", "GNSS"     };  //!< source to text conversion
  typedef struct { 
    SOURCE source;            //!< source of data 
    char* data;               //!< data buffer, allocated by calling task and released  by consumers  
    size_t size;              //!< data size
    bool binary;              //!< type of the data 
  } MSG;                      //!< queue element
  xQueueHandle queue;         //!< queue to hold the different data to be sent to the websocket
  SemaphoreHandle_t mutex;    //!< protects cbuf from concurnet access by tasks. 
  cbuf buffer;                //!< the circular local buffer
  
  /** write data into the queue to be sent 
   *  \param buffer  data to write
   *  \param size    of data to write 
   *  \param source  the origin of this data
   *  \param binary  how to send the data over the websocket
   *  \return        the bytes put in the queue
   */
  size_t write(const void* buffer, size_t size, SOURCE source, bool binary = true) {
    size_t wrote = 0;
    if (connected) {
      MSG msg;
      msg.data = new char[size];
      if (msg.data) {
        memcpy(msg.data, buffer, size);
        msg.size = size;
        msg.source = source;
        msg.binary = binary;
        if (xQueueSendToBack(queue, &msg, 0/*portMAX_DELAY*/) == pdPASS) {
          log_d("queue %d bytes from %d(%s)", size, source, SOURCE_LUT[source]);
          wrote += msg.size;
        } else {
          log_e("queue %d bytes from %d(%s) failed, queue full", size, source, SOURCE_LUT[source]);
          delete [] msg.data;
        }
      } else {
        log_e("queue %d bytes from %d(%s), failed alloc", size, SOURCE_LUT[source]);
      }
    }
    return wrote;
  }

#if 0
  size_t write(GNSS::MSG &gnssMsg) {
    size_t wrote = 0;
    if (connected) {
      MSG msg;
      msg.data = gnssMsg.data;
      msg.size = gnssMsg.size;
      msg.source = (gnssMsg.source == GNSS::SOURCE::LTE) ? LTE : WLAN;
      msg.binary = true;
      if (xQueueSendToBack(queue, &msg, 0/*portMAX_DELAY*/) == pdPASS) {
        log_d("queue %d bytes from %d(%s)", size, source, SOURCE_LUT[source]);
        wrote += msg.size;
      } else {
        log_e("queue %d bytes from %d(%s) failed, queue full", size, source, SOURCE_LUT[source]);
        delete [] msg.data;
      }
    } else {
      delete [] gnssMsg.data;
    }
    gnssMsg.data = NULL;
    return wrote;
  }
#endif

  /** write data into the queue to be sent 
   *  \param buffer  a string to write
   *  \param source  the origin of this data
   *  \return        the bytes put in the queue
   */
  size_t write(const char* buffer, SOURCE source) {
    return write(buffer, strlen(buffer), source, false);
  }

  /** send both the message queue data as well as the cicular buffer to the websocket. 
   *  This will also free any buffer allocated in the queue elements.
   */
  void send(void) {
    int total = 0;
    MSG msg;
    while (xQueueReceive(queue, &msg, 0/*portMAX_DELAY*/) == pdPASS) {
      for (auto it = wsClients.begin(); (it != wsClients.end()); it = std::next(it)) {
        if (it->available()) {
          if (msg.binary) {
            it->sendBinary(msg.data, msg.size);
          } else {
            it->send(msg.data, msg.size);
          }
        }
      }
      total += msg.size;
      log_d("queue %d bytes from %d(%s)", msg.size, msg.source, SOURCE_LUT[msg.source]);
      delete [] msg.data;
      msg.data = NULL;
    }
    bool loop;
    do {
      loop = false;
      if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
        uint8_t temp[UBXFILE_BLOCK_SIZE];
        size_t len = buffer.read((char*)temp, sizeof(temp));
        xSemaphoreGive(mutex);
        if (0 < len) {
          for (auto it = wsClients.begin(); (it != wsClients.end()); it = std::next(it)) {
            if (it->available()) {
              it->sendBinary((const char*)temp, len);
            }
          }
          log_d("buffer %d bytes", len);
          total += len;
          loop = true;
        }
      }
      vTaskDelay(0); // Yield
    } while (loop);
    if (0 < total) {
      log_d("total %d bytes", total);
    }
  }
    
  // --------------------------------------------------------------------------------------
  // STREAM interface: https://github.com/arduino/ArduinoCore-API/blob/master/api/Stream.h
  // --------------------------------------------------------------------------------------
 
  /** The character written is passed into a circular buffer
   *  \param ch  character to write
   *  \return    the bytes written
   */ 
  size_t write(uint8_t ch) override {
    size_t size = 0;
    if (connected) {
      if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
        size = buffer.write(ch);
        xSemaphoreGive(mutex);
      }
    }
    return size;
  }
  
  /** All data written is passed into the circular buffer
   *  \param ptr   pointer to buffer to write
   *  \param size  number of bytes in ptr to write
   *  \return      the bytes written
   */ 
  size_t write(const uint8_t *ptr, size_t size) override {
    if (connected) {
      if (pdTRUE == xSemaphoreTake(mutex, portMAX_DELAY)) {
        size = buffer.write((const char*)ptr, size);
        xSemaphoreGive(mutex);
      }
    }
    return size;
  }
  
  /** override flush functions of the stream interface 
   */
  void flush(void)    override { /*nothing*/ }
  
  /** override available functions of the stream interface 
   *  \return  nothing available
   */
  int available(void) override { return   0; }
  
  /** override read functions of the stream interface 
   *  \return  a bad character
   */
  int read(void)      override { return  -1; }
  
  /** override peek functions of the stream interface 
   *  \return  a bad character
   */
  int peek(void)      override { return  -1; }
   
protected:
  void serve(const char* file, const char* format, const char* content) {
    log_i("send \"%s\" as \"%s\"", file, format);  
    if ((NULL != pManager) && (NULL != pManager->server)) {
      pManager->server->send(200, format, content);
    }
  }

  void serveHtml(void)  { serve(WEBSOCKET_URL,    "text/html",        HTML); }
  void serveJs(void)    { serve(WEBSOCKET_JSURL,  "text/javascript",  JS);   }
  void serveCss(void)   { serve(WEBSOCKET_CSSURL, "text/css",         CSS);  }
  
  static void onMessage(WebsocketsClient &client, WebsocketsMessage message) {
    if (!message.isBinary()) {
      String data = message.data();
      log_i("string \"%s\" with %d bytes", data.c_str(), message.length()); 
      data = "Echo from HPG solution:\r\n" + data;
      client.send(data.c_str());
    } else {
      log_i("binary %d bytes", message.length());
      // function is declared here to avoid include dependency
      extern size_t GNSS_INJECT_WEBSOCKET(const void* ptr, size_t len);
      GNSS_INJECT_WEBSOCKET(message.c_str(), message.length());
    }
  }

  static void onEvent(WebsocketsClient &client, WebsocketsEvent event, String data) {
    if(event == WebsocketsEvent::ConnectionOpened) {
      log_i("opened");
    } else if(event == WebsocketsEvent::ConnectionClosed) {
      log_i("closed");
    } else if(event == WebsocketsEvent::GotPing) {
      client.pong(data);
      log_i("ping \"%s\"", data.c_str());
    } else if(event == WebsocketsEvent::GotPong) {
      log_i("pong \"%s\"", data.c_str());
    }
  }
  
  std::vector<WebsocketsClient> wsClients;  //!< list websocket clients connected
  WebsocketsServer wsServer;                //!< websocket server listens for incoming connections 
  WiFiManager* pManager;                    //!< the wifi manager with its captive portal
  bool connected;                           //!< wifi connected flag

  static const char HTML[];   //!< the content of served file monitor.html
  static const char CSS[];    //!< the content of served file monitor.css
  static const char JS[];     //!< the content of served file monitor.js
};

WEBSOCKET Websocket;  //!< The global WEBSOCKET peripherial object

// --------------------------------------------------------------------------------------
// Resources served
// --------------------------------------------------------------------------------------

//! the content of served file monitor.html
const char WEBSOCKET::HTML[] = R"html(
<!DOCTYPE html>
<html>
  <head>
    <script src="monitor.js" type="text/javascript"></script>
    <link   href="monitor.css"  type="text/css" rel="stylesheet" media="all" />
    <script src="https://cdn.jsdelivr.net/npm/openlayers@4.6.5/dist/ol.js"  type="text/javascript"></script>
    <link  href="https://cdn.jsdelivr.net/npm/openlayers@4.6.5/dist/ol.css" type="text/css" rel="stylesheet"/>
    <title>Monitor</title>
    <meta charset='UTF-8'>
  </head>
  <body>
    <h1>Monitor</h1>
    <div hidden id='map' class='map item' style="height:40vh"></div>
    <div id='output' class='item'></div>
    <input id='message' class='item' type='text' placeholder='Send a message' />
  </body>
</html>
)html";

//! the content of served file monitor.css
const char WEBSOCKET::CSS[] = R"css(
  body {
    display: grid;
    grid-gap: 1em;
    margin: 0;
    padding: 1em;
    box-sizing: border-box;
    font-family: 'Helvetica Neue', 'Helvetica', 'Arial', sans-serif;
  }
  h1 {
    margin: 0;
  }
  input {
    bo
  }
  .item {
    padding: 0.2em;
    border: 1pt solid;
    font-size: 12pt;
    font-family: monospace;
  }
  #map {
    height: 40vh;
  }
  #output {
    height: 35vh;
    white-space: nowrap;
    overflow: scroll;
    resize: vertical;
  }
  #message {
    width: 100%;
    outline: none;
    box-sizing: border-box;
  }
)css";

//! the content of served file monitor.js
const char WEBSOCKET::JS[] = R"js(
  "use strict";
  let map = null; 
  let track = null;
  let point = null;
  let connected = false
  let ws = null
  let output = null
  
  function log(message, color = 'black') {
    if (null != output) {
      const el = document.createElement('div')
      el.innerHTML = message
      el.style.color = color
      output.append(el)
      output.scrollTop = output.scrollHeight
    }
  }

  window.onload = function _onload() {
    // create the map
    let el = document.getElementById('map');
    if (ol !== undefined) {
      el.removeAttribute('hidden');
      const pos = ol.proj.fromLonLat([8.565783, 47.284641])
      track = new ol.Feature( { geometry: new ol.geom.LineString([]) } )
      track.setStyle( new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: 'rgba(255,110,89,0.7)', 
            width: 3,
            lineCap: 'round'
          })
        }) 
      )
      let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="22" y1="12" x2="18" y2="12"></line><line x1="6" y1="12" x2="2" y2="12"></line><line x1="12" y1="6" x2="12" y2="2"></line><line x1="12" y1="22" x2="12" y2="18"></line></svg>';
      let icon = new ol.style.Icon({ color:'#ff6e59', opacity: 1, src: 'data:image/svg+xml;utf8,' + svg,
                   anchor: [0.5, 0.5], anchorXUnits: 'fraction', anchorYUnits: 'fraction', });
      point = new ol.Feature( { geometry: new ol.geom.Point(pos) } )
      point.setStyle( new ol.style.Style( { image: icon } ) );
      map = new ol.Map({
        target: 'map',
        controls: ol.control.defaults().extend([ new ol.control.ScaleLine({ units: 'metric' }) ]),
        layers: [
          new ol.layer.Tile({
            source: new ol.source.OSM()
          }), 
          new ol.layer.Vector({
            source: new ol.source.Vector({
              features: [point, track]
            }),
          })
        ],
        view: new ol.View({
          center: ol.proj.fromLonLat(pos),
          zoom: 16
        })
      });
    } 

    const message = document.querySelector('#message')
    output = document.querySelector('#output')
    const url = ((window.location.protocol == 'https:') ? 'wss:' : 'ws:') + '//' + window.location.host + ':8080'
    ws = new WebSocket(url)
    
    ws.addEventListener('open', () => {
      connected = true
      log('Open', 'green')
    })
    ws.addEventListener('close', () => {
      connected = false
      log('Close', 'red')
    })
    ws.addEventListener('message', ({ data }) => {
      if (typeof(data) == 'string') {
        log(`${data}`)
        //                     time        src  fix  car acc       lat          lon
        const m = data.match(/^\d+:\d+:\d+ \w+ (\S+) \w+ \d+\.\d+ (-?\d+\.\d+) (-?\d+\.\d+)/)
        if (map && track && m) {
          if (m[1] != "No") {
            let pos = ol.proj.fromLonLat([Number(m[3]), Number(m[2])])
            map.getView().setCenter(pos)
            track.getGeometry().appendCoordinate(pos)
            point.getGeometry().setCoordinates(pos)
          }
        }
      }
    })
    message.addEventListener('keyup', ({ keyCode }) => {
      if (connected && (keyCode === 13)) {
        ws.send(message.value)
      }
    })
    log(`Connecting to ${url} ...`, 'blue')
  }
)js";

#endif
