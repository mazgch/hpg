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

#define WEBSOCKET_STREAM            // for the more powerful u-center UI

#define WEBSOCKET_WEBSOCKET_PORT    8080 // needs to match WEBSOCKET_HTML and hpg.mazg.ch value
#ifdef WEBSOCKET_STREAM
  #define WEBSOCKET_HPGMAZGCHURL    "http://hpg.mazg.ch"
  #define WEBSOCKET_HPGMAZGCHNAME   "mazg.ch HPG Monitor"
#endif
#define WEBSOCKET_URL               "/monitor.html"
#define WEBSOCKET_JSURL             "/monitor.js"
#define WEBSOCKET_CSSURL            "/monitor.css"
#define WEBSOCKET_BUTTON            "Monitor"

extern const char* WEBSOCKET_HTML;
extern const char* WEBSOCKET_CSS;
extern const char* WEBSOCKET_JS;

using namespace websockets;

class WEBSOCKET : public Stream {
public: 
#ifdef WEBSOCKET_STREAM
  WEBSOCKET(size_t size = 5*1024) : buffer{size} {
    mutex = xSemaphoreCreateMutex();
#else
  WEBSOCKET {
#endif
    queue = xQueueCreate(5, sizeof(MSG));
  }
  
  void setup(WiFiManager& manager) {
    pManager = &manager;
    pManager->setCustomMenuHTML("<form action=\"" WEBSOCKET_URL "\" method=\"get\"><button>" WEBSOCKET_BUTTON "</button></form><br>"
#ifdef WEBSOCKET_STREAM
            "<button onclick=\"window.location.href='" WEBSOCKET_HPGMAZGCHURL "?ip='+window.location.hostname\">" WEBSOCKET_HPGMAZGCHNAME "</button><br><br>"
#endif
    );
    wsServer.listen(WEBSOCKET_WEBSOCKET_PORT);
    if (!wsServer.available()) {
      Log.info("WEBSOCKET not available");
    }
  }

  void poll(void) {
    if (wsServer.poll()) {
      WebsocketsClient client = wsServer.accept();
      client.ping();
      client.onMessage(wsMessage);
      client.onEvent(wsEvent);
      String string = Config.getDeviceName();
      string = "Connected to " + string + "\r\n";
      write(string.c_str());
      Log.info("WEBSOCKET new client, total %d", wsClients.size() + 1);
      wsClients.push_back(client);
    }
    // poll all clients 
    for (auto it = wsClients.begin(); (it != wsClients.end()); it = std::next(it)) {
      if (it->available()) {
        it->poll();
      } else {
        it->close();
        wsClients.erase(it);
        it = std::prev(it);
      }
    }

    MSG msg;
    while (xQueueReceive(queue, &msg, 0/*portMAX_DELAY*/) == pdPASS) {
      for (auto it = wsClients.begin(); (it != wsClients.end()); it = std::next(it)) {
        if (it->available()) {
          it->send(msg.data, msg.size);
        }
      }
      Log.debug("WEBSOCKET queue rd %d from %d", msg.size, msg.source);
      delete [] msg.data;
      msg.data = NULL;
    }
#ifdef WEBSOCKET_STREAM
    bool loop;
    do {
      loop = false;
      if (xSemaphoreTake(mutex, portMAX_DELAY)) {
        uint8_t temp[UBXFILE_BLOCK_SIZE];
        size_t len = buffer.read((char*)temp, sizeof(temp));
        xSemaphoreGive(mutex);
        if (0 < len) {
          for (auto it = wsClients.begin(); (it != wsClients.end()); it = std::next(it)) {
            if (it->available()) {
              it->sendBinary((const char*)temp, len);
            }
          }
          Log.debug("WEBSOCKET stream rd %d", len);
        }
      }
      vTaskDelay(0); // Yield
    } while (loop);
#endif
  }
      
  void write(const void* buffer, size_t size) {
    MSG msg;
    msg.data = new char[size];
    if (msg.data) {
      memcpy(msg.data, buffer, size);
      msg.size = size;
      msg.source = MSG::CDC;
      Log.debug("WEBSOCKET queue wr %d from %d", msg.size, msg.source);
      xQueueSendToBack(queue, &msg, 0/*portMAX_DELAY*/);
    } else {
      Log.error("WEBSOCKET queue wr %d, failed alloc", size);
    }
  }

  void write(const char* buffer) {
    write(buffer, strlen(buffer));
  }

#ifdef WEBSOCKET_STREAM
  // Stream
  size_t write(uint8_t ch) override {
    size_t size = sizeof(ch);
    if (xSemaphoreTake(mutex, portMAX_DELAY)) {
      size = buffer.write(ch);
      xSemaphoreGive(mutex);
    }
    return size;
  }
  size_t write(const uint8_t *ptr, size_t size) override {
    if (xSemaphoreTake(mutex, portMAX_DELAY)) {
      size = buffer.write((const char*)ptr, size);
      xSemaphoreGive(mutex);
    }
    return size;
  }
  void flush() override { /* nothing */ }
  int available() override { return 0; };
  int read() override { return -1; } 
  int peek() override  { return -1; }
#endif
  
  void bind(void) {
    if ((NULL != pManager) && (NULL != pManager->server)) {
      pManager->server->on(WEBSOCKET_URL,    std::bind(&WEBSOCKET::serveHtml, this));
      pManager->server->on(WEBSOCKET_JSURL,  std::bind(&WEBSOCKET::serveJs,   this));           
      pManager->server->on(WEBSOCKET_CSSURL, std::bind(&WEBSOCKET::serveCss,  this));           
    }
  }
   
protected:
  void serve(const char* file, const char* format, const char* content) {
    Log.info("WEBSOCKET serve \"%s\" as \"%s\"", file, format);  
    if ((NULL != pManager) && (NULL != pManager->server)) {
      pManager->server->send(200, format, content);
    }
  }

  void serveHtml(void)  { serve(WEBSOCKET_URL,    "text/html",        WEBSOCKET_HTML); }
  void serveJs(void)    { serve(WEBSOCKET_JSURL,  "text/javascript",  WEBSOCKET_JS);   }
  void serveCss(void)   { serve(WEBSOCKET_CSSURL, "text/css",         WEBSOCKET_CSS);  }
  
  static void wsMessage(WebsocketsClient &client, WebsocketsMessage message) {
    if (!message.isBinary()) {
      String data = message.data();
      Log.info("WEBSOCKET message %s with %d bytes", data.c_str(), message.length()); 
      data = "Echo from HPG solution:\r\n" + data;
      client.send(data.c_str());
#ifdef WEBSOCKET_STREAM
    } else {
      Log.info("WEBSOCKET message %d bytes", message.length()); 
      extern size_t GNSSINJECT(const void* ptr, size_t len);
      GNSSINJECT(message.c_str(), message.length());
#endif
    }
  }

  static void wsEvent(WebsocketsClient &client, WebsocketsEvent event, String data) {
    if(event == WebsocketsEvent::ConnectionOpened) {
      Log.info("WEBSOCKET opened");
    } else if(event == WebsocketsEvent::ConnectionClosed) {
      Log.info("WEBSOCKET closed");
    } else if(event == WebsocketsEvent::GotPing) {
      client.pong(data);
      Log.info("WEBSOCKET ping \"%s\"", data.c_str());
    } else if(event == WebsocketsEvent::GotPong) {
      Log.info("WEBSOCKET pong \"%s\"", data.c_str());
    }
  }
  
  WebsocketsServer wsServer;
  std::vector<WebsocketsClient> wsClients;
  WiFiManager* pManager;
  xQueueHandle queue;

  typedef struct {
    enum { LTE, GNSS, LBAND, CDC } source; 
    char* data;
    size_t size; 
  } MSG;

#ifdef WEBSOCKET_STREAM
  // Stream
  SemaphoreHandle_t mutex;
  cbuf buffer;
#endif
};

WEBSOCKET Websocket;

// --------------------------------------------------------------------------------------
// Resources served
// --------------------------------------------------------------------------------------

const char* WEBSOCKET_HTML = R"html(
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

const char* WEBSOCKET_CSS = R"css(
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

const char* WEBSOCKET_JS = R"js(
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
