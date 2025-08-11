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
    
"use strict";

// ------------------------------------------------------------------------------------
/* START OF MODULE */ var UVIEW = (function () {
// ------------------------------------------------------------------------------------

window.clickLink = function _clickLink(link) {
    let el = window.open(link,'_blank');
    if (el) el.focus();
} 

// Init
// ------------------------------------------------------------------------------------
window.onload = function _onload() {

  const CONFIG_EMPTY = { places: {}, tracks: {} };
  const PLACE_OVERVIEW  = 'Overview';
  const TRACK_REFERENCE = 'Reference';
  const COLOR_REFERENCE = '#000000';
  const COLOR_UBLOX     = '#0000ff';
  const COLOR_OTHERS    = '#ff0000';
  const COLOR_FIX = { 
    'NO':    '#ff0000',
    'BAD':   '#ff0000',
    'SIM':   '#ff0000',
    'DR':    '#ff00ff', 
    '2D':    '#00ffff', 
    '2D/3D': '#00ff00',  
    '3D':    '#00ff00', 
    'DGPS':  '#00ff00', 
    '3D+DR': '#ffbf00', 
    'FLOAT': '#00C000', 
    'FIXED': '#008000'
  };
  const EPOCH_FIELDS = [ 
    'date', 'time', 'itow', 
    'fix', 'lat', 'lng', 'height', 'msl', 'pAcc', 'hAcc', 'vAcc', 
    'speed', 'gSpeed', 'sAcc', 'cAcc', 'hDop', 'pDop', 'numSV', 
    'pErr', 'hErr', 'vErr', 'sErr', 'gsErr'
  ];
  
  // UI
  // ------------------------------------------------------------------------------------

  feather.replace();
  
  // drag and drop
  const dropzone = document.getElementById('dropzone');
  const dropOverlay = document.getElementById('drop-overlay');
  dropzone.addEventListener('dragover', function(e) {
    dropOverlay.style.display = 'block';
    e.preventDefault();
  });
  dropzone.addEventListener('dragleave', function() {
    dropOverlay.style.display = 'none';
  });
  dropzone.addEventListener('drop', function(e) {
    dropOverlay.style.display = 'none';
    configReadFiles(e.dataTransfer.files);
    e.preventDefault();
  });
  // track list
  const loadPicker = document.getElementById('loadpicker');
  const loadFiles = document.getElementById("load");
  loadFiles.addEventListener('click',(e) => {
    loadPicker.click();
  });
  loadPicker.addEventListener('change', (e) => { 
    configReadFiles(e.target.files);
    e.target.value = null;
  });
  // map
  const mapsContainer = document.getElementById("map");
  const downloadConfig = document.getElementById("download");
  downloadConfig.addEventListener('click', configDownloadJson);
  const placeSelect = document.getElementById("places");
  placeSelect.addEventListener("change", placeSelectChange);
  const clearConfig = document.getElementById("clear");
  clearConfig.addEventListener('click', configClear);
  const opacitySlider = document.getElementById('opacity');
  opacitySlider.addEventListener('input', (e) => {
    mapSetOpacity(e.target.value);
  });
  // chart
  const fieldSelect = document.getElementById('field');
  fieldSelect.addEventListener("change", chartFieldChange);
  EPOCH_FIELDS.slice(3/*skip time/ date/itow*/).forEach( field => {
    const option = document.createElement("option");
    const defField = Epoch.epochFields[field];
    option.textContent = isDef(defField) ? defField.name : field;
    option.value = field;
    fieldSelect.appendChild(option);
  })
  fieldSelect.value = 'height';
  const modeSelect = document.getElementById('mode');
  modeSelect.addEventListener("change", chartFieldChange);
  const resetZoom = document.getElementById('resetZoom');
  resetZoom.addEventListener("click", chartResetZoom);

  // Application
  // ------------------------------------------------------------------------------------

  let map;
  let chart;
  let placesLayer;
  let trackLayers = {};
  let layerControl;
  let config = CONFIG_EMPTY;
  mapInit(); 
  chartInit();
  placeAddOption(PLACE_OVERVIEW);
  trackTableUpdate();
  mapUpdateTrackLegend();
  window.onbeforeunload = function _unload() {
    const json = configGetJson();
    localStorage.setItem("json", json);
  }
  const params = new URLSearchParams(window.location.search);
  if (0 < params.size) {
    params.forEach( (url, name) => {
      if (isDef(url) && ('' != url)) {
        const name = url.toLowerCase();
        if (name.endsWith('.json')) {
          configFetchJson(url);
        } else if (name.endsWith('.ubx')) {
          const track = { url:url };
          trackFetchUrl( name, track );
        }
      }
    });
  } else {
    const json = localStorage.getItem("json");
    if (json) {
      configApply(json);
    } else {
      if (navigator.geolocation && map) {
        navigator.geolocation.getCurrentPosition(
          (position) => { 
            map.setView([position.coords.latitude, position.coords.longitude], 14, { animate: false })
            mapsContainer.style.display = 'block';
          }, 
          (err) => {},
          { timeout: 1000 } // Timeout in ms
        );
      }
    }
  }   
    
  // Map
  // ------------------------------------------------------------------------------------

  function mapInit() {
    mapsContainer.style.display = "none";
    mapsContainer.className = "map-section";
    const resizeObserver = new ResizeObserver(() => {
      if (map) {
        map.invalidateSize();
      }
    });
    resizeObserver.observe(mapsContainer);
    map = L.map(mapsContainer, { fullscreenControl: true, zoomControl: true, zoomSnap: 0.1, wheelPxPerZoomLevel: 20, boxZoom: true });
    map.selectArea.enable();
    map.selectArea.setControlKey(true);
    L.control.scale().addTo(map);
    mapSetOpacity(opacitySlider.value);
    const esriSatellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", 
            { maxZoom: 20.5 }).addTo(map);
    const stadiaSatellite = L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}{r}.{ext}', 
            { maxZoom: 20.5, ext: 'jpg' });
    const swisstopoBounds = [[45.398181, 5.140242], [48.230651, 11.47757]];
    const swisstopoSatellite = L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg', 
            { minZoom: 7.5, maxZoom: 20.5, bounds: swisstopoBounds });
    const swisstopoColor = L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg', 
            { minZoom: 7.5, maxZoom: 19.5, bounds: swisstopoBounds });
    const swisstopoGray = L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg', 
            { minZoom: 7.5, maxZoom: 19.5, bounds: swisstopoBounds });
    const osmTopography = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",   { maxZoom: 17.5 });
    const osmStreet     = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19.5 });
    const baseLayers = { 
      "ESRI World Imagery": esriSatellite, "Stadia Satellite": stadiaSatellite,
      "Swisstopo Satellite":swisstopoSatellite, "Swisstopo Color":swisstopoColor, "Swisstopo Gray":swisstopoGray,
      "OSM Topography": osmTopography, "OSM Street": osmStreet };
    placesLayer = L.layerGroup().addTo(map);
    layerControl = L.control.layers( baseLayers, { "Places": placesLayer } ).addTo(map);
    // add lat lng x y hint
    const coordControl = L.control({ position: 'bottomright' });
    map.divInfo = L.DomUtil.create('div', 'leaflet-control-coords leaflet-bar');
    coordControl.onAdd = function () { return map.divInfo; };
    coordControl.addTo(map);
    map.on('mousemove', mapUpdateCoords);
    mapsContainer.addEventListener('mouseleave', mapUpdateTrackLegend)
    map.on("selectarea:selected", (e) => placeAddBounds(e.bounds));
  }
  
  function mapUpdateCoords(e) {
    const lat = Number(e.latlng.lat.toFixed(5));
    const lng = Number(e.latlng.lng.toFixed(5));
    const x = Math.round(e.containerPoint.x);
    const y = Math.round(e.containerPoint.y);
    map.divInfo.innerHTML = `Lat: ${lat}, y: ${y}<br>Lng: ${lng} x: ${x} `;
    map.divInfo.style.display = 'block';
  }

  function mapUpdateTrackLegend() {
    const html = Object.entries(config.tracks)
        .filter(([name, track]) => track.mode !== 'hidden')
        //.map(([name, track]) => '<span class="dash" style="background-color:'+ track.color +'"></span>' + name )
        .map(([name, track]) => trackGetLabel(track) )
        .join('&nbsp;&nbsp;');
    const show = isDef(html) && (html != '');
    map.divInfo.innerHTML = (show) ? html : 'No tracks.';
    map.divInfo.style.display = show ? 'block' : 'none';
  }
  
  function mapSetSize(size) {
    mapsContainer.style.display = "block";
    const set = isDef(size);
    const width = set ? size[0] + "px" : '';
    const height = set ? size[1] + "px" : '';
    if ((mapsContainer.style.width != width) || (mapsContainer.style.height != height)) { 
      mapsContainer.style.width = width;
      mapsContainer.style.height = height;
      map.invalidateSize(); // Call after setting size
    }
  }

  function mapSetOpacity(opacity) {
    const panes = document.getElementsByClassName('leaflet-tile-pane');
    for (let i = 0; i < panes.length; i++) {
      panes[i].style.opacity = 1 - opacity;
    }
  }

  // Config 
  // ------------------------------------------------------------------------------------

  function configFetchJson(name) {
    fetch(name)
    .then(response => response.bytes())
    .then(bytes => {
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
          bytes = window.pako.ungzip(bytes);
      }
      const txt = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
      configApply(txt);
    })
  }
  
  function configClear() {
    placeRemoveAll();
    trackRemoveAll();
  }

  function configApply(json) {
    let sanJson;
    try {
      sanJson = JSON.parse(json);
    } catch (err) { 
      alert("Error parsing the .json file.");
    }
    if (isDef(sanJson)) {
      placeApplyConfig(sanJson.places);
      trackApplyConfig(sanJson.tracks);
      if (isDef(sanJson.map?.opacity)) {
        opacitySlider.value = sanJson.map.opacity;
        mapSetOpacity(opacitySlider.value);
      }
      if (isDef(sanJson.map?.place) && isDef(config.places[sanJson.map.place])) {
        placeSelect.value = sanJson.map.place;
      }
      const place = config.places[placeSelect.value];
      placeChange(place ? place : PLACE_OVERVIEW);
      if (isDef(sanJson.chart?.field)) {
        fieldSelect.value = sanJson.chart.field;
      }
      if (isDef(sanJson.chart?.mode)) {
        modeSelect.value = sanJson.chart.mode;
      }
      chartFieldChange();
      mapUpdateTrackLegend();
    }
  }

  function configReadFiles(files) {
    Array.from(files).forEach(file => {
      const name = file.name.toLowerCase();
      const reader = new FileReader();
      reader.onload = (e) => {
        let bytes = new Uint8Array(e.target.result)
        let txt;
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
          bytes = window.pako.ungzip(bytes);
        }
        // if it starts with { we assume it is a json
        if (String.fromCharCode(bytes[0]) === '{') {
          const txt = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
          configApply( txt );
        } else {
          const track = { file:file.name };
          const m = file.name.match(/(?:.*\/)?([^.]+).*$/);
          const name = m ? m[1] : file.name;
          if (!trackFromBytes(name, bytes, track)) {
            alert('No epochs loaded, please check source:\n' + name);
          }
        } 
      };
      reader.readAsArrayBuffer(file);
    });
  }
   
  function configDownloadJson(e) { 
    const doGzip = !e.shiftKey;
    let data = configGetJson();
    let type = 'application/json';
    let name = 'config.json';
    if (doGzip) {
      data = window.pako.gzip(data);
      type = 'application/x-gzip';
      name += '.gz';
    }
    const blob = new Blob([data], { type: type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);;
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function configGetJson() { 
    const places = Object.entries(config.places)
        .map(([name, place]) => [ name, configPlaceJson(place) ] );
    const tracks = Object.entries(config.tracks)
        .map(([name, track]) => [ name, configTrackJson(track) ] );
    const json = { 
      comment: `This file can be viewed with ${window.location.protocol}//${window.location.hostname}${window.location.pathname}`, 
      map:   { place: placeSelect.value, opacity: opacitySlider.value },
      chart: { field: fieldSelect.value, mode: modeSelect.value },
      places:  Object.fromEntries(places), 
      tracks:  Object.fromEntries(tracks),
    };
    return JSON.stringify(json, null, 1/*change to 1 for better readability*/);
  }

  function configPlaceJson(place) {
    return { size:place.size, zoom:place.zoom, center:place.center };
  }

  function configTrackJson(track) {
    const epochs = track.epochs.map( epoch => configEpochJson(epoch) );
    const json = { color:track.color };
    if (track.mode) json.mode = track.mode;
    if (track.info) json.info = track.info;
    if (epochs) json.epochs = epochs;
    return json;
  }

  function configEpochJson(epoch) {
    const json = { fields: {} };
    EPOCH_FIELDS.forEach((key) => {
        if (isDef(epoch.fields[key])) {
          json.fields[key] = epoch.fields[key];
        }
    });
    if (epoch.info) json.info = epoch.info;
    return json;
  }

  // Place 
  // ------------------------------------------------------------------------------------

  function placeRemoveAll() {
    map.removeLayer(placesLayer);
    layerControl.removeLayer(placesLayer);
    placesLayer = L.layerGroup().addTo(map);
    layerControl.addOverlay(placesLayer, "Places");
    while (placeSelect.firstChild) {
      placeSelect.removeChild(placeSelect.firstChild);
    }
    placeAddOption(PLACE_OVERVIEW);
    config.places = {};
  }

  function placeApplyConfig(places) {
    placeRemoveAll();
    if (isDef(places)) {
      for (const [name, place] of Object.entries(places)) {
        placeAddOption(name, place);
      }
    }
  }

  function placeSelectChange(e) { 
    const option = e.target.selectedOptions[0];
    placeChange(option.place); 
  };

  function placeAddBounds(bounds) {
    // maks sure bound are valid in current map area 
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const mapBounds = map.getBounds();
    if (mapBounds.contains(sw) && mapBounds.contains(ne)) {
      const center = bounds.getCenter();
      const name = prompt('Please name the place.', center.lat.toFixed(6) + ',' + center.lng.toFixed(6));
      if (isDef(name) && ('' != name)) {
        const zoom = map.getZoom();
        const swPx = map.project(sw, zoom);
        const nePx = map.project(ne, zoom);
        const w = parseInt(Math.abs(nePx.x - swPx.x));
        const h = parseInt(Math.abs(nePx.y - swPx.y));
        const place = { size: [ w, h ], bounds:[sw, ne] };
        placeAddOption(name, place);
      }
    }
  }

  function placeAddOption(name, place) {
    let option = Array.from(placeSelect.options).find(opt => opt.value === name);
    if (!isDef(option)) {
      option = document.createElement("option");
      option.textContent = name;
      option.value = name;
      placeSelect.appendChild(option);
    }
    option.place = place;
    if (isDef(place)) {
      if (!isDef(place.bounds) && isDef(place.size) && isDef(place.center) && isDef(place.zoom)) {
        const temp = L.map(document.createElement('div'), { center: place.center, zoom: place.zoom });
        temp._size = L.point(place.size[0], place.size[1]);
        temp._resetView(L.latLng(place.center), place.zoom);
        const sw = temp.getBounds().getSouthWest();
        const ne = temp.getBounds().getNorthEast();
        place.bounds = [ [sw.lat, sw.lng] , [ne.lat, ne.lng] ];
      }
      if (isDef(place.bounds)) {
        const marker = L.rectangle(place.bounds, { dashArray: '5, 5', weight: 2, className: 'place' });
        marker.place = place;
        marker.on('click', (e) => {
          const isOverview = (name == placeSelect.value);
          placeChange(isOverview ? undefined : place, e.originalEvent.ctrlKey);
          placeSelect.value = isOverview ? PLACE_OVERVIEW : name;
        });
        placesLayer.addLayer(marker);
      }
      config.places[name] = place;
    }
  }
  
  function placeChange(place, setSize = false) {
    if (map) {
      if (place) {
        if (setSize) mapSetSize(place.size);
        if (isDef(place.bounds)) {
          map.fitBounds(place.bounds, { animate: false } );
        } else if (isDef(place.center) && isDef(place.zoom)) { 
          map.setView([place.center[0], place.center[1]], place.zoom, { animate: false });
        }  
        mapsContainer.style.display = 'block';
      } else {
        mapSetSize();
        const tracks = Object.values(config.tracks)
                .filter(track => isDef(track.bounds));
        if(0 < tracks.length) {
          const bounds = L.latLngBounds(
            [ Math.min(...tracks.map(item => item.bounds[0][0])), Math.min(...tracks.map(item => item.bounds[0][1])) ],
            [ Math.max(...tracks.map(item => item.bounds[1][0])), Math.max(...tracks.map(item => item.bounds[1][1])) ]);
          map.fitBounds(bounds, { animate: false, padding: [20, 20] } );
          mapsContainer.style.display = 'block';
        }
      }
    }
  }

  // Track 
  // ------------------------------------------------------------------------------------

  function trackRemoveAll() {
    Object.values(trackLayers).forEach( layer => {
      if(map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
      //layerControl.removeLayer(layer);
    } );
    trackLayers = {};
    config.tracks = {};
    chartReset();
    trackTableUpdate();
    mapUpdateTrackLegend();
  }

  function trackApplyConfig(tracks) {
    trackRemoveAll();
    if (isDef(tracks)) {
      for (const [name, track] of Object.entries(tracks)) {
        if (!trackAdd(name, track) && isDef(track.url)) {
          trackFetchUrl(name, track);
        }
      }
    }
  }

  function trackFetchUrl(name, track) {
    fetch(track.url)
      .then(response => response.bytes())
      .then(bytes => {
        // cound be zipped 
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
          bytes = window.pako.ungzip(bytes);
        }
        if (!trackFromBytes(name, bytes, track)) {
          alert('No epochs loaded, please check source:\n' + track.url);
        }
      });
  }

  function trackFromBytes(name, bytes, track) {
    const ubxData = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
    let epochs = [];
    Engine.parseReset()
    Engine.parseAppend(ubxData);
    let messages = Engine.parseMessages();
    if (messages.length) {
      let epoch = { fields: {}, ids: {} };
      messages.forEach( function(message) {
        if ((message.type === 'output') && message.protocol.match(/^NMEA|UBX$/)) {
          if (isDef(message.fields)) {
            if (Epoch.epochCheck(epoch, message)) {
              Epoch.epochComplete(epoch);
              const cleanEpoch = Epoch.epochClean(epoch, EPOCH_FIELDS);
              epochs.push( cleanEpoch );
            }
            Epoch.epochFill(epoch, message);
          }
          // extract text fields 
          if ((message.protocol === 'UBX') && isDef(message.fields)) {
            if (message.name === 'MON-VER') {
              convertTextExtract(track, message.fields.swVer);
              convertSetInfo(track, 'monHwVer', message.fields.hwVer);
              if (message.fields.extVer) {
                  for (let i = 0; i < message.fields.extVer.length; i ++)
                    convertTextExtract(track, message.fields.extVer[i]);
              }
            } else if (message.name === 'INF-NOTICE') {
              convertTextExtract(track, message.fields.infTxt);
            }
          } else if (message.protocol === 'NMEA') {
            if ((message.id === 'TXT') && isDef(message.fields)) {
              convertTextExtract(track, message.fields.infTxt);
            } else {
              // $PAIR021,Project,Freq,SWPack,SerVer,SerBuildTime,L1RomVer>,L1ramVer,L5romVer,L5RamVer,KernelVer,KernelBuildTime,KFVersion,KFBuildTime,RTKVersion,RTKBuildTime,...
              // $PAIR021,AG3352Q_V2.3.0.AG3352_20230213,S,N,2b31f59,2209141904,2b9,0,,,d32ef91c,2209141902,571d3e7,2209141904,,,-15.48,-15.48,-14.02,-15.48,0,1,##,0,0*6D
              const m = message.text.match(/^\$PAIR02[1|0],([^_]*)_([^\,]*)\.([^,]*),(\w)/);
              if (m) {
                convertSetInfo(track, 'module', m[1]);
                convertSetInfo(track, 'fwVer', m[2]);
                convertSetInfo(track, 'hwVer', m[3]);
              }
            }
          }
          let m = message.name.match(/^(INF-(ERROR|WARNING|NOTICE)|(G[PN]TXT))$/)
          if (m) {
            // add texts but only once
            epoch.info ??= [];
            if (!epoch.info.includes(message.fields.infTxt)) {
              epoch.info.push(message.fields.infTxt);
            }
          }
        }
      } );
    }
    track.epochs = epochs;
    return trackAdd(name, track);
  } 
  
  function convertTextExtract(track, text) {
    if (text) {
        let m;
        if (m = text.match(/^MOD=(.+)$/))                       convertSetInfo(track, 'module', m[1]);
        else if (m = text.match(/^HW (.+)$/))                   convertSetInfo(track, 'hwVer', m[1]);
        else if (m = text.match(/^ROM (?:BASE|CORE)?\s*(.+)$/)) convertSetInfo(track, 'romVer', m[1]);
        else if (m = text.match(/^EXT (?:BASE|CORE)?\s*(.+)$/)) convertSetInfo(track, 'extVer', m[1]);
        else if (m = text.match(/^FWVER=(.+)$/))                convertSetInfo(track, 'fwVer', m[1]);
        else if (m = text.match(/^PROTVER=(.+)$/))              convertSetInfo(track, 'protoVer', m[1]);
    }
  }

  function convertSetInfo(track, key, value) {
    if(isDef(value) && isDef(key)) {
      track.info ??= {};
      track.info[key] = value;
    }
  }

  function trackAdd(name, track) {
    if (isDef(track.epochs) && (0 < track.epochs.length)) {
      // complete each epoch (color, datetime, valid)
      track.epochs.forEach( (epoch) => {
        if (!isDef(epoch.time) && 
              isDef(epoch.fields.date) && (epoch.fields.date != '') &&
              isDef(epoch.fields.time) && (epoch.fields.time != '') ) {
          //Date.UTC(year, monthIndex, day, hours, minutes, seconds, milliseconds
          const datetime = new Date(epoch.fields.date + 'T'+ epoch.fields.time + 'Z').getTime();
          if (isNaN(datetime)) {
            throw new Error("bad time");
          } else {
            epoch.datetime = datetime;
          }
        }
        if (!isDef(epoch.color)) {
          epoch.color = COLOR_FIX[epoch.fields.fix];
        }
        if (!isDef(epoch.valid)) {
          epoch.valid = (epoch.fields.fix != 'NO') && (epoch.fields.fix != 'BAD');
        }       
      });
      // set track level 
      if (!isDef(track.color)) {
        track.color = (name === TRACK_REFERENCE)  ? COLOR_REFERENCE : 
                      isDef(track.info?.protoVer) ? COLOR_UBLOX : 
                                                    COLOR_OTHERS;
      }
      if (!isDef(track.mode)) {
        track.mode = (name === TRACK_REFERENCE) ? 'line' : 'markers';
      }
      if (!isDef(track.bounds)) {
        const latlngs = Object.values(track.epochs)
            .filter(epoch => (epoch.valid === true) && isDef(epoch.fields.lat) && isDef(epoch.fields.lng))
            .map(epoch => [epoch.fields.lat, epoch.fields.lng]);
        const bounds = L.latLngBounds(latlngs);
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        track.bounds = [ [sw.lat, sw.lng], [ne.lat, ne.lng] ];
      }
      track.name = name
      config.tracks[name] = track;
      const groupLayer = L.layerGroup();
      groupLayer.track = track;
      trackLayers[name] = groupLayer;
      const label = trackGetLabel(track);
      //layerControl.addOverlay(groupLayer, label);
      chartAddTrack(track);
      trackTableUpdate();
      if (track.mode !== 'hidden') {
        trackAddLayer(groupLayer, track.mode == 'markers');
      }
      updateErrors();
      placeChange();
      return true;
    }
    return false;
  } 

  function trackAddLayer(layerGroup, addMarkers) {
    let trackCoords = [];
    let infos = [];
    const track = layerGroup.track;
    const svgIcon = feather.icons['message-square'].toSvg( { fill: 'rgba(64,64,64,0.3)', stroke: 'rgba(64,64,64,0.9)' });
    const divIcon = L.divIcon({ html: svgIcon, className: '', iconSize: [20, 20], iconAnchor: [2, 22] });
    track.epochs
         .forEach( function(epoch) {
      if (isDef(epoch.info) && (0 < epoch.info.length)) {
        infos = infos.concat(epoch.info);
      }
      if (epoch.valid) {
        const center = [epoch.fields.lat, epoch.fields.lng];
        trackCoords.push( center );
        if (addMarkers) {
          const marker = L.circleMarker(center, {
            radius: 3, weight: 1, 
            color: epoch.color, opacity: 1, 
            fillColor: epoch.color, fillOpacity: 0.8,
            className: 'marker'
          });
          const label = trackGetLabel(track);
          if (0 < infos.length) {
            const infText = infos.join('<br/>');
            const flag = L.marker(center, { icon: divIcon, riseOnHover: true, } )
                    .bindTooltip(label + '</br>' + infText, { direction: 'bottom', });
            layerGroup.addLayer(flag);
            infos = [];
          }
          marker.label = label;
          marker.fields = epoch.fields;
          marker.on('mouseover', trackMarkerHover);
          marker.on('mouseout', trackMarkerReset);
          marker.on('click', trackMarkerPopUp);
          layerGroup.addLayer(marker);
        }
      } 
    } )
    const trackLine = L.polyline(trackCoords);
    trackLine.setStyle({ color: track.color, opacity: 0.6, weight: 2 });
    layerGroup.addLayer(trackLine);
    layerGroup.addTo(map);
  }

  function trackMarkerPopUp(e) { 
    const popup = L.popup();
    popup.setLatLng(e.latlng)
    const fields =  e.target.fields;
    const rows = Object.entries(Epoch.epochFields)
            .filter(([key]) => key in fields)
            .map(([key, def]) => {
      const unit = isDef(def.unit) ? def.unit : '';
      return '<tr><td>'+def.name+'</td><td class="right">'+fields[key]+'</td><td>'+unit+'</td></tr>';
    });
    popup.setContent( e.target.label + '<br><table class="table" style="font-size:0.8em"><thead>' +
            '<tr><th>Parameter</th><th class="right">Value</th><th>Unit</th></tr>' +
            '</thead><tbody>' + rows.join('') + '</tbody></table>');
    popup.openOn(map);
  }
  function trackMarkerHover() { this.setRadius(5); }
  function trackMarkerReset() { this.setRadius(3); }

  function trackGetLabel(track) {
    return '<span class="dash" style="background-color:'+ track.color +'"></span>' + track.name;
    return `<span style="color:${track.color};">${track.name}</span>`;
  }

  function trackGetInfo(track, key) {
    return isDef(track.info) && isDef(track.info[key]) ? track.info[key] : '';
  }

  function trackTableUpdate() {
    const iconShow = feather.icons['eye'].toSvg({class:'icon-inline'});
    const iconMarker = feather.icons['git-commit'].toSvg({class:'icon-inline', fill:COLOR_FIX['3D']}, );
    const table = document.getElementById('table_tracks');
    while (table.firstChild) {
        table.removeChild(table.firstChild);
    }
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    const tr = document.createElement('tr');
    let th = document.createElement('th');
    th.className = 'center';
    th.innerHTML = iconShow;
    tr.appendChild(th);
    const cols = [ "Track Name", "Color", "Module", "Firmware", "Protocol", "Hardware", "Epochs" ];
    cols.forEach(col => {
      th = document.createElement('th');
      th.textContent = col;
      tr.appendChild(th);
    });
    tbody.appendChild(tr);
    
    for (const [name, track] of Object.entries(config.tracks).sort(([keyA], [keyB]) => keyA.localeCompare(keyB))) {
      const tr = trackTableAddRow(name, track);
      tbody.appendChild(tr);
    }
  }

  function trackTableAddRow(name, track) {
    const iconHide = feather.icons['eye-off'].toSvg( { class:'icon-inline' } );
    const iconMarker = feather.icons['share-2'].toSvg( { class:'icon-inline', fill:COLOR_FIX['3D']} );
    const iconShow = track.mode === 'hidden' ? iconHide : track.mode === 'markers' ? iconMarker  : '〜';
    const tr = document.createElement('tr');
    let td = document.createElement('td');
    td.className = 'center';
    td.innerHTML = iconShow;
    td.addEventListener('click', (e) => { 
      track.mode = track.mode === 'hidden' ? 'markers' :
                   track.mode === 'markers' ? 'line' : 
                                              'hidden';
      chart.data.datasets
          .filter( dataset => dataset.label == name )
          .forEach( dataset => dataset.hidden = (track.mode === 'hidden'));
      chart.update();
      const layerGrp = trackLayers[name];
      if(map.hasLayer(layerGrp)) {
        map.removeLayer(layerGrp);
      }
      // remove all layers to free memory
      layerGrp.eachLayer(layer => {
        layerGrp.removeLayer(layer);
      } );
      if (track.mode !== 'hidden') {
        trackAddLayer(layerGrp, track.mode === 'markers');
      }
      trackTableUpdate();
      mapUpdateTrackLegend();
    } );
    tr.appendChild(td);
    td = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = name;
    nameInput.addEventListener("keyup", function(event) {
      if (event.key === "Enter") {
        nameInput.blur();
      }
    });
    nameInput.addEventListener("blur", function(event) {
      if (name !== nameInput.value) {
        const newName = nameInput.value;
        delete Object.assign(config.tracks, {[newName]: config.tracks[name] })[name];
        // if we change the reference then recaluclate the errors 
        if (newName === TRACK_REFERENCE || name === TRACK_REFERENCE) {
          updateErrors();
        }
        chart.data.datasets
          .filter( dataset => dataset.label == name )
          .forEach( dataset => dataset.label = newName );
        chart.update();
        delete Object.assign(trackLayers, {[newName]: trackLayers[name] })[name];
        trackTableUpdate();
        mapUpdateTrackLegend();
      }
    });
    td.appendChild(nameInput);
    tr.appendChild(td);
    td = document.createElement('td');
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value =  track.color;
    colorInput.addEventListener("change", (e) => { 
      track.color = e.target.value;
      // update the map and chart colors 
      chart.data.datasets
          .filter( dataset => dataset.label == name )
          .forEach( dataset => dataset.borderColor = track.color);
      chart.update();
      // change the color of the polyline layer
      trackLayers[name].eachLayer(layer => {
        if (layer instanceof L.Polyline) {
          layer.setStyle({ color: track.color });
        }
      } );
      trackTableUpdate();
      mapUpdateTrackLegend();
    } );
    td.appendChild(colorInput);
    tr.appendChild(td);
    
    td = document.createElement('td');
    td.textContent = trackGetInfo(track, 'module');
    tr.appendChild(td);

    td = document.createElement('td');
    let fwVer = trackGetInfo(track, 'fwVer');
    td.textContent = fwVer;
    tr.appendChild(td);

    td = document.createElement('td');
    td.textContent = trackGetInfo(track, 'protoVer');
    tr.appendChild(td);
    
    td = document.createElement('td');
    let hwVer = trackGetInfo(track, 'hwVer');
    if (!isDef(hwVer) || (hwVer == '')) {
      hwVer = trackGetInfo(track, 'monHwVer');
    }
    td.textContent = hwVer;
    tr.appendChild(td); 
    
    td = document.createElement('td');
    const epochs =(isDef(track.epochs) ? track.epochs.length : '');
    td.textContent = epochs;
    tr.appendChild(td);
    
    
    return tr;
  }

  // Chart 
  // ------------------------------------------------------------------------------------

  function chartInit() {
    const defField = Epoch.epochFields[fieldSelect.value];
    const isLin = isDef(defField) ? 0<=defField.prec : true;
  
  
    if (Chart !== undefined) {
        Chart.defaults.responsive = true; 
        Chart.defaults.layout.padding = { left: 10, right: 10+10+24, top: 10, bottom: 10 };
        Chart.defaults.animation = false;
        Chart.defaults.transitions.active.animation.duration = 0;
        Chart.defaults.transitions.resize.animation.duration = 0;
        Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(245,245,245,0.8)';
        Chart.defaults.plugins.tooltip.borderColor = '#888';
        Chart.defaults.plugins.tooltip.borderWidth = 1;
        Chart.defaults.plugins.tooltip.cornerRadius = 0;
        Chart.defaults.plugins.tooltip.titleColor = '#000';
        Chart.defaults.plugins.tooltip.titleFont.size = 10;
        Chart.defaults.plugins.tooltip.bodyColor = '#000';
        Chart.defaults.plugins.tooltip.bodyFont.size = 10;
        Chart.defaults.plugins.tooltip.displayColors = false;
    }
    const chartContainer = document.getElementById("chart");
    chartContainer.addEventListener( 'mouseout', chartStatsUpdate);
    chart = new Chart(chartContainer, {
      type: 'scatter',
      data: {
        datasets: []
      },
      options: { 
        onHover: chartStatsUpdate,
        onLeave: chartStatsUpdate,
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'nearest',
          //axis: 'x'
        },
        animation: {
          duration: 0
        },
        plugins: {
          annotation: { 
            annotations: {} 
          },
          legend: {
            enabled: true,
            labels: {
              boxWidth: 20,
              boxHeight: 0,
              filter: (li) => { return li.hidden == false; }
            }, 
            onClick: () => { return; }
          },
          tooltip: {
            usePointStyle: true,
            callbacks: {
              label: _toolTipTitle, 
              afterLabel: _toolTipText,
            }
          },
          zoom: {
            pan: {
              enabled: true,
              mode: 'xy',
            },
            zoom: {
              wheel: {
                enabled: true,
                modifierKey: 'shift'
              },
              drag: {
                enabled: true,
                modifierKey: 'shift',
                borderWidth: 2              
              },
              pinch: {
                enabled: true,
              },
              mode: 'xy',
            }
          }
        },
        scales: { 
          y: { 
            type: 'linear',
            title: { display: true, },
            ticks: { font:{ size:10 }, maxRotation:0, autoSkipPadding:10, },
          },
          x: { 
            type: 'linear',
            ticks: { font:{ size:10 }, maxRotation:0, },
            title: { display: true, }
          }
        }
      }
    });
    chartFieldChange();
    function _toolTipTitle(context) {
      return context.dataset.label;
    }
    function _toolTipText(context) {
      const defField = Epoch.epochFields[fieldSelect.value];
      const unit = (defField.unit ? ' ' + defField.unit : '')
      if (modeSelect.value === 'val') {
        const txtX = context.chart.options.scales.x.title.text;
        const txtY = defField.name;
        const valX = context.chart.options.scales.x.ticks.callback(context.raw.x);
        const valY = chartValCallback(context.raw.y) + unit;
        return `${txtY}: ${valY}\n${txtX}: ${valX}`;
      } else {
        const txtX = defField.name;
        const txtY = context.chart.options.scales.y.title.text;
        const valX = chartValCallback(context.raw.x) + unit;
        const valY = context.chart.options.scales.y.ticks.callback(context.raw.y);
        return `${txtY}: ${valY}\n${txtX}: ${valX}`;
      }
    }
  }

  function chartTimeCallback(va) {
    const datetime = new Date(va);
    const yr = datetime.getUTCFullYear();
    const mt = datetime.getUTCMonth()+1;
    const day = datetime.getUTCDay();
    const h = datetime.getUTCHours();
    const m = datetime.getUTCMinutes();
    const s = datetime.getUTCSeconds() + datetime.getUTCMilliseconds() * 1e-3;
    return Epoch.fmtDate(yr,mt,day) + ' ' + Epoch.fmtTime(h,m,s);
  }
  
  function chartValCallback(va) {
    const defField = Epoch.epochFields[fieldSelect.value];
    const category = defField.map ? Object.keys(defField.map) : undefined;
    const val = (0 <= defField.prec)  ? va.toFixed(defField.prec) :
                (isDef(category))     ? category[va] : // get key by index
                                        va;
    return val;
  }

  function chartReset() {
    chart.data.datasets = [];
    chart.update();
  }
  
  function chartAddTrack(track) {
    const defField = Epoch.epochFields[fieldSelect.value];
    const isLin = isDef(defField) ? (0<=defField.prec) : true;
    const bkg = toRGBa(track.color, 0.5);
    const light = toRGBa(track.color, 0.3);
    chart.data.datasets.push( { 
      label: track.name, 
      data: [],
      spanGaps: false,
      showLine: isLin,
      hidden: track.mode == 'hidden',
      borderCapStyle: 'round',
      borderJoinStyle: 'bevel',
      borderColor: track.color,
      borderWidth: 2,

      pointRadius: 0,
      pointBorderColor: epochColor,
      pointBackgroundColor: epochBackgroundColor,
      pointBorderWidth: 0,
      pointHoverRadius: 5,
      pointHoverBorderColor: epochColor,
      pointHoverBackgroundColor: epochBackgroundColor,
      pointHoverBorderWidth: 1,
    } );
    function epochColor(ctx) {
      const row = isDef(ctx.dataIndex) && (ctx.dataIndex < ctx.dataset.data.length) ? ctx.dataset.data[ctx.dataIndex] : undefined; 
      return isDef(row) && isDef(row.c) ? row.c : track.color;
    }
    function epochBackgroundColor(ctx) { 
      return toRGBa(epochColor(ctx), 0.8);
    }
    chartFieldChange();
  }

  function chartFieldChange() {
    // update the data from epoch
    const field = fieldSelect.value;
    const defField = Epoch.epochFields[field];
    const name = defField.name + (defField.unit ? ' [' + defField.unit + ']' : '');
    const category = isDef(defField.map) ? Object.keys(defField.map) : undefined;
    if (modeSelect.value === 'hist') {
      chart.options.scales.x.title.text = name;
      chart.options.scales.x.ticks.callback = chartValCallback;
      chart.options.scales.x.ticks.maxTicksLimit = category ? category.length: undefined;
      chart.options.scales.x.ticks.autoSkip = category ? false : true;
      chart.options.scales.x.ticks.stepSize = category ? 1 : undefined;

      chart.options.scales.y.title.text = 'Density';
      chart.options.scales.y.ticks.callback = (v) => v.toFixed(2);
      chart.options.scales.y.ticks.maxTicksLimit = undefined;
      chart.options.scales.y.ticks.autoSkip = true;
      chart.options.scales.y.ticks.stepSize = undefined;
    } else if (modeSelect.value === 'cdf') {
      chart.options.scales.x.title.text = name;
      chart.options.scales.x.ticks.callback = chartValCallback;
      chart.options.scales.x.ticks.maxTicksLimit = category ? category.length: undefined;
      chart.options.scales.x.ticks.autoSkip = category ? false : true;
      chart.options.scales.x.ticks.stepSize = category ? 1 : undefined;

      chart.options.scales.y.title.text = 'Cumulative density';
      chart.options.scales.y.ticks.callback = (v) => v.toFixed(2);
      chart.options.scales.y.ticks.maxTicksLimit = undefined;
      chart.options.scales.y.ticks.autoSkip = true;
      chart.options.scales.y.ticks.stepSize = undefined;

    } else if (modeSelect.value === 'val') {
      chart.options.scales.x.title.text = 'Time';
      chart.options.scales.x.ticks.callback = chartTimeCallback;
      chart.options.scales.x.ticks.maxTicksLimit = undefined;
      chart.options.scales.x.ticks.autoSkip = true;
      chart.options.scales.x.ticks.stepSize = undefined;

      chart.options.scales.y.title.text = name;
      chart.options.scales.y.ticks.callback = chartValCallback;
      chart.options.scales.y.ticks.maxTicksLimit = category ? category.length: undefined;
      chart.options.scales.y.ticks.autoSkip = category ? false : true;
      chart.options.scales.y.ticks.stepSize = category ? 1 : undefined;
    }
 
    chart.data.datasets.forEach((dataset) => {
      const track = config.tracks[dataset.label];
      dataset.showLine = true;
      let data = track.epochs
        .filter((epoch) => isDef(epoch.datetime) && epoch.valid)
        .map((epoch) => { 
        let y = epoch.fields[fieldSelect.value];
        if (!isDef(y)) {
          y = Number.NaN;
        } else if (defField.map) {
          y = category.indexOf(y);
        }
        const x = epoch.datetime;
        return { x: x, y: y, c: epoch.color }; 
      });
      // calc the mean and std dev
      const vals = data.map(row => row.y).filter(Number.isFinite);
      dataset.hidden = (0 == vals.length) || (track.mode === 'hidden');
      dataset.stats = {};
      if (0 < vals.length) {
        dataset.stats.min = Math.min(... vals);
        dataset.stats.max = Math.max(... vals);
        dataset.stats.mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        dataset.stats.std = (1 < vals.length) ? Math.sqrt(vals.reduce((s, x) => s + (x - dataset.stats.mean) ** 2, 0) / vals.length): undefined;
      }
      // convert to cdf or histogram
      if (modeSelect.value !== 'val') {
        // 1) extract & optionally round
        const PRECISION_REDUCE = 1;
        const prec = (0 <= defField.prec) ? Math.max(defField.prec - PRECISION_REDUCE, 0) : undefined;
        const values = data
          .filter(e => isDef(e.y))
          .map(e => {
            let y = e.y;
            if (0 <= prec) {
              y = Number(y.toFixed(prec))
            }
            return y; 
          } );
        const len = values.length;
        if (0 < len) {
          // 2) frequency by value
          const hist = {};
          for (const value of values) hist[value] = (hist[value] || 0) + 1;
          // 3) sort unique value
          const sortValues = Object.keys(hist).map(Number).sort((a, b) => a > b);
          // 4) cumulative → CDF
          let cum = 0;
          data = sortValues.map(x => {
            const cnt = hist[x];
            cum += cnt;
            const cdf = cum / len;
            if (!isDef(dataset.stats.q50) && (cdf >= 0.500)) { dataset.stats.q50 = x; }
            if (!isDef(dataset.stats.q68) && (cdf >= 0.680)) { dataset.stats.q68 = x; }
            if (!isDef(dataset.stats.q95) && (cdf >= 0.950)) { dataset.stats.q95 = x; }
            if (!isDef(dataset.stats.q99) && (cdf >= 0.997)) { dataset.stats.q99 = x; }
            const y = (modeSelect.value === 'cdf') ? cdf : (cnt / len);
            return { x: x, y: y };
          } );
        
        } else { 
          data = [];
        }
      }
      dataset.data = data;
    });
      
    // update the chart and reset the zoom pan
    chartResetZoom();
    chartStatsUpdate(); // force an inital update to set all settings
    chart.update();
  }

  function chartStatsUpdate(evt, active/*,chart*/) {
    if (chart) {
      const CHART_CDF_ANNOTAIONS = {
        y50: annotation('y', 0.500, '#00000040', '0.5'),
        y68: annotation('y', 0.680, '#00000040', '0.68'),
        y95: annotation('y', 0.950, '#00000040', '0.95'),
        y99: annotation('y', 0.997, '#00000040', '0.997')
      };    
      let annotations = (modeSelect.value === 'cdf') ? CHART_CDF_ANNOTAIONS : {};
      if (active && (0 < active.length)) {
        const axis = (modeSelect.value === 'val') ? 'y' : 'x';
        const index = active[0].datasetIndex;
        const dataset = chart.data.datasets[index];
        if (!dataset.hidden) {
          if (modeSelect.value === 'cdf') {
            if (isDef(dataset.stats.q50)) annotations.q50 = annotation(axis, dataset.stats.q50, dataset.borderColor, `q50 = ${chartValCallback(dataset.stats.q50)}` );
            if (isDef(dataset.stats.q68)) annotations.q68 = annotation(axis, dataset.stats.q68, dataset.borderColor, `q68 = ${chartValCallback(dataset.stats.q68)}` );
            if (isDef(dataset.stats.q95)) annotations.q95 = annotation(axis, dataset.stats.q95, dataset.borderColor, `q95 = ${chartValCallback(dataset.stats.q95)}` );
            if (isDef(dataset.stats.q99)) annotations.q99 = annotation(axis, dataset.stats.q99, dataset.borderColor, `q99 = ${chartValCallback(dataset.stats.q99)}` );
          } else {
            if (isDef(dataset.stats.min)) annotations.min = annotation(axis, dataset.stats.min, dataset.borderColor, `min = ${chartValCallback(dataset.stats.min)}`);
            if (isDef(dataset.stats.max)) annotations.max = annotation(axis, dataset.stats.max, dataset.borderColor, `max = ${chartValCallback(dataset.stats.max)}`);
            if (isDef(dataset.stats.mean)) {
              annotations.mean = annotation(axis, dataset.stats.mean, dataset.borderColor, `μ = ${chartValCallback(dataset.stats.mean)}`);
              if (isDef(dataset.stats.std)) {
                const mps = dataset.stats.mean + dataset.stats.std;
                const mms = dataset.stats.mean - dataset.stats.std;
                annotations.plus = annotation(axis, mps, dataset.borderColor, `μ+σ = ${chartValCallback(mps)}` );
                annotations.minus = annotation(axis, mms, dataset.borderColor, `μ-σ = ${chartValCallback(mms)}`);
              }
            }
          }
        }
      }
      chart.options.plugins.annotation.annotations = annotations;
      chart.update();
    }
  }
 
  function annotation(axis, val, color, label) {
    const axisMin = axis + 'Min';
    const axisMax = axis + 'Max';
    const annotation = { type: 'line', borderColor: color, borderWidth: 1, borderDash: [6, 6] };
    if (axis === 'x') {
      annotation.xMin = annotation.xMax = val;
    } else {
      annotation.yMin = annotation.yMax = val;
    }
    if (label) {
      const position = (axis === 'y') ? 'start' : 'end';
      const rotation = (axis === 'x') ? -90 : 0;
      annotation.label = { padding:2, display: true, content: label, position: position, 
        textStrokeColor:'rgba(255,255,255,1)', textStrokeWidth: 3, font: { weight:'nomal' },
        backgroundColor: 'rgba(255,255,255,0)', color: color, rotation: rotation };
    }
    return annotation;
  }

  function chartResetZoom() {
    let minX;
    let maxX;
    let minY;
    let maxY;
    chart.resetZoom();
    const defField = Epoch.epochFields[fieldSelect.value];
    chart.data.datasets
        .filter(dataset => !dataset.hidden)
        .forEach((dataset) => {
      const data = dataset.data.filter(r => isDef(r.x) && isDef(r.y));
      if(0 < data.length) {
        const arrX = data.map((r) => r.x).sort((a, b) => a > b);
        const thisMinX = arrX[0]
        const thisMaxX = arrX[arrX.length - 1];
        const arrY = data.map((r) => r.y).sort((a, b) => a > b);
        const thisMinY = arrY[0];
        const thisMaxY = arrY[arrY.length - 1];
        if (isDef(thisMinX) && (!isDef(minX) || (thisMinX < minX))) minX = thisMinX;
        if (isDef(thisMaxX) && (!isDef(maxX) || (thisMaxX > maxX))) maxX = thisMaxX;
        if (isDef(thisMinY) && (!isDef(minY) || (thisMinY < minY))) minY = thisMinY;
        if (isDef(thisMaxY) && (!isDef(maxY) || (thisMaxY > maxY))) maxY = thisMaxY;
      }
    });
    if (defField.map) {
      // make it fixed size
      if (modeSelect.value === 'val') {
        minY = 0; 
        maxY = Object.keys(defField.map).length - 1;
      } else {
        minX = 0; 
        maxX = Object.keys(defField.map).length - 1;
      }
    }
    if (modeSelect.value === 'hist') {
      minY = 0.00;
    } else if (modeSelect.value === 'cdf') {
      minY = 0.00;
      maxY = 1.00;
    }
    if (isDef(minX)) chart.options.scales.x.min = minX;
    if (isDef(maxX)) chart.options.scales.x.max = maxX;
    if (isDef(minY)) chart.options.scales.y.min = minY;
    if (isDef(maxY)) chart.options.scales.y.max = maxY;
  }

  // Math 
  // ------------------------------------------------------------------------------------

  function updateErrors() {
    const refTrack = config.tracks[TRACK_REFERENCE];
    if (isDef(refTrack)) {
      Object.entries(config.tracks)
        .filter(([name, track]) => (name !== TRACK_REFERENCE))
        .forEach(([name, track])  => {
          computeErrors(track.epochs, refTrack.epochs);
        } )
    }
  }

  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Earth radius in meters
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function computeErrors(measEpochs, refEpochs) {
    let refIx = 0;
    const refLen = refEpochs.length;
    measEpochs.forEach( (epoch) => {
      const measDatetime = epoch.datetime;
      // we are not checking 
      const refIx = refEpochs.findIndex(refEpoch => refEpoch.datetime >= measDatetime);
      let refMeas;
      if (refIx != -1) {
        const refEpoch = refEpochs[refIx];
        const refDatetime = refEpoch.datetime;
        if (refDatetime == measDatetime) {
          refMeas = { 
            lat:refEpoch.fields.lat, 
            lng:refEpoch.fields.lng, 
            height:refEpoch.fields.height,
            speed:refEpoch.fields.speed,
            gSpeed:refEpoch.fields.gSpeed 
          };
        } else if (refIx > 0) {
          const prevEpoch = refEpochs[refIx - 1];
          const prevDatetime = prevEpoch.datetime;
          if (prevDatetime < measDatetime) {
            const ratio = (refDatetime - measDatetime) / (refDatetime - prevDatetime);
            refMeas = {
              lat: refEpoch.fields.lat + (prevEpoch.fields.lat - refEpoch.fields.lat) * ratio,
              lng: refEpoch.fields.lng + (prevEpoch.fields.lng - refEpoch.fields.lng) * ratio,
              height: refEpoch.fields.height + (prevEpoch.fields.height - refEpoch.fields.height) * ratio,
              speed: refEpoch.fields.speed + (prevEpoch.fields.speed - refEpoch.fields.speed) * ratio,
              gSpeed: refEpoch.fields.gSpeed + (prevEpoch.fields.gSpeed - refEpoch.fields.gSpeed) * ratio
            }
          }
        }
      }
      
      if (isDef(refMeas)) {
        helper('hErr', haversine(epoch.fields.lat, epoch.fields.lng, refMeas.lat, refMeas.lng));
        helper('vErr', Math.abs(epoch.fields.height - refMeas.height));
        helper('pErr', Math.sqrt(epoch.fields.hErr ** 2 + epoch.fields.vErr ** 2));
        helper('sErr', Math.abs(epoch.fields.speed - refMeas.speed));
        helper('gsErr', Math.abs(epoch.fields.gSpeed - refMeas.gSpeed));
      } else {
        delete epoch.fields.hErr;
        delete epoch.fields.vErr;
        delete epoch.fields.pErr;
        delete epoch.fields.sErr;
        delete epoch.fields.gsErr;
      }
      function helper(key, value) {
        if (isDef(refMeas) && Number.isFinite(value)) {
          epoch.fields[key] = Number(value.toFixed(3));
        } else {
          delete epoch.fields[key];
        }
      } 
    } )
  }

  // Helper 
  // ------------------------------------------------------------------------------------

  function isDef(value) {
    return (undefined !== value) && (null !== value);
  }

  function toRGBa(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
    if (alpha) {
        return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
    } else {
        return "rgb(" + r + ", " + g + ", " + b + ")";
    }
  }

}

// ------------------------------------------------------------------------------------
return { }; })(); // UVIEW mdoule end
// ------------------------------------------------------------------------------------
