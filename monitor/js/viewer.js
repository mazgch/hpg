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

  // -------------------------------------------------------------
  // UI
  // -------------------------------------------------------------

  feather.replace();
    
  const params = new URLSearchParams(window.location.search);
  const urls = params.getAll('f');

  const mapsContainer = document.getElementById("map");
  const downloadConfig = document.getElementById("download");
  downloadConfig.addEventListener('click', configDownloadJson);
  const placeSelect = document.getElementById("places");
  placeSelect.addEventListener("change", placeSelectChange);
  const opacitySlider = document.getElementById('opacity');
  opacitySlider.addEventListener('input', (e) => {
    mapSetOpacity(Math.abs(e.target.value));
  });

  const uploadPicker = document.getElementById('files');
  uploadPicker.addEventListener('change', (e) => configReadFiles(e.target.files) );
  const dropzone = document.getElementById('dropzone');
  const dropOverlay = document.getElementById('drop-overlay');
  dropzone.addEventListener('dragover', function(e) {
    e.preventDefault();
    dropOverlay.style.display = 'block';
  });
  dropzone.addEventListener('dragleave', function() {
    dropOverlay.style.display = 'none';
  });
  dropzone.addEventListener('drop', function(e) {
    e.preventDefault();
    dropOverlay.style.display = 'none';
    configReadFiles(e.dataTransfer.files);
  });

  // -------------------------------------------------------------
  // APPLICATION
  // -------------------------------------------------------------

  let map;
  let placesLayer;
  let trackLayers = [];
  let layerControl;
  let config = { places: [], tracks: [] };
  mapInit();
  placeAddOption('Overview');
  trackTableUpdate();
  mapUpdateTrackLegend();
  if (0 < urls.length) {
    urls.forEach(url => {
      if (isDef(url) && ('' != url)) {
        const name = url.toLowerCase();
        if (name.endsWith('.json')) {
          configFetchJson(url);
        } else if (name.endsWith('.ubx')) {
          trackFetchUrl(url);
        }
      }
    });
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
    
  // -------------------------------------------------------------
  // MAP
  // -------------------------------------------------------------

  function mapInit() {
    mapsContainer.style.display = "none";
    mapsContainer.className = "map-section";
    const resizeObserver = new ResizeObserver(() => {
      if (map) {
        map.invalidateSize();
      }
    });
    resizeObserver.observe(mapsContainer);
    map = L.map(mapsContainer, { zoomControl: true, zoomSnap: 0.1, wheelPxPerZoomLevel: 20, boxZoom: true });
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
    // add lat lon x y hint
    const coordControl = L.control({ position: 'bottomright' });
    map.divInfo = L.DomUtil.create('div', 'leaflet-control-coords leaflet-bar');
    coordControl.onAdd = function () { return map.divInfo; };
    coordControl.addTo(map);
    map.on('mousemove', mapUpdateCoords);
    mapsContainer.addEventListener('mouseleave', mapUpdateTrackLegend)
    map.on('overlayadd', function (e) {
      if (e.layer.track) {
        e.layer.track.selected = true;
        mapUpdateTrackLegend();
        if (!map.hasLayer(e.layer)) {
          trackAddLayer(e.layer);
        }
      } else {
        // must be 'Places' layer
      }
      /*i*/
    });
    map.on('overlayremove', function (e) {
      if (e.layer.track) {
        e.layer.track.selected = false;
        mapUpdateTrackLegend();
      } else {
        // must be 'Places' layer
      }
    });
    map.on("selectarea:selected", (e) => placeAddBounds(e.bounds));
  }
  
  function mapUpdateCoords(e) {
    const lat = Number(e.latlng.lat.toFixed(5));
    const lng = Number(e.latlng.lng.toFixed(5));
    const x = Math.round(e.layerPoint.x);
    const y = Math.round(e.layerPoint.y);
    map.divInfo.innerHTML = `Lat: ${lat}, y: ${y}<br>Lng: ${lng} x: ${x} `;
  }

  function mapUpdateTrackLegend() {
    const html = config.tracks
      .filter(track => track.selected)
      .map(track => trackGetLabel(track))
      .join(' | ');
    map.divInfo.innerHTML = (isDef(html) && (html != '')) ? html : 'Please add Tracks';
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

  // ------------------------------------------------------------
  // CONFIG 
  // ------------------------------------------------------------

  function configFetchJson(name) {
    fetch(name)
    .then(response => response.json())
    .then(json => configApply(json))
  }

  function configApply(json) {
    let sanJson;
    try {
      sanJson = JSON.parse(json);
    } catch (err) { 
      alert("Error parsing the .json file.");
    }
    if (isDef(sanJson) && isDef(sanJson.places) && isDef(sanJson.tracks)) {
      placeApplyConfig(sanJson.places);
      trackApplyConfig(sanJson.tracks);
      placeChange();
      mapUpdateTrackLegend();
    }
  }

  function configReadFiles(files) {
    Array.from(files).forEach(file => {
      const name = file.name.toLowerCase();
      if (name.endsWith('.json')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          configApply(e.target.result);
        };
        reader.readAsText(file);
      } else if (name.endsWith('.ubx')) {
        trackReadFile(file);
      }
    });
  }
   
  function configDownloadJson() {
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);;
    link.download = 'config.json';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  // ------------------------------------------------------------
  // PLACE 
  // ------------------------------------------------------------
  
  function placeSelectChange(e) { 
    const option = e.target.selectedOptions[0];
    placeChange(option.place); 
  };

  function placeAddBounds(bounds) {
    const center = bounds.getCenter();
    const name = prompt('Please name the place.', center.lat.toFixed(6) + ',' + center.lng.toFixed(6));
    if (isDef(name) && ('' != name)) {
      const zoom = map.getZoom();
      const sw = map.project(bounds.getSouthWest(), zoom);
      const ne = map.project(bounds.getNorthEast(), zoom);
      const w = parseInt(Math.abs(ne.x - sw.x));
      const h = parseInt(Math.abs(ne.y - sw.y));
      const place = { name:name, size: [ w, h ], bounds:[sw, ne] };
      placeAddOption(place.name, place);
    }
  }

  function placeAddOption(name, place) {
    const option = document.createElement("option");
    option.textContent = name;
    option.value = name;
    option.place = place;
    placeSelect.appendChild(option);
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
          const isOverview = (place.name == placeSelect.value);
          placeChange(isOverview ? undefined : place, e.originalEvent.ctrlKey);
          placeSelect.value = isOverview ? 'Overview' : place.name;
        });
        placesLayer.addLayer(marker);
      }
      config.places.push(place);
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
        const tracks = config.tracks ? config.tracks.filter(item => isDef(item.bounds)) : [];
        if(0 < tracks.length) {
          const bounds = L.latLngBounds(
            [ Math.min(...tracks.map(item => item.bounds[0][0])), Math.min(...tracks.map(item => item.bounds[0][1])) ],
            [ Math.max(...tracks.map(item => item.bounds[1][0])), Math.max(...tracks.map(item => item.bounds[1][1])) ]);
          bounds.add
          map.fitBounds(bounds, { animate: false, padding: [20, 20] } );
          mapsContainer.style.display = 'block';
        }
      }
    }
  }

  function placeApplyConfig(places) {
    map.removeLayer(placesLayer);
    layerControl.removeLayer(placesLayer);
    placesLayer = L.layerGroup().addTo(map);
    layerControl.addOverlay(placesLayer, "Places");
    placeSelect.options.length = 0;
    placeAddOption('Overview');
    config.places = [];
    if (isDef(places)) {
      places.forEach((place, idx) => {
        placeAddOption(place.name, place);
      });
    }
  }

  // ------------------------------------------------------------
  // TRACK 
  // ------------------------------------------------------------

  function trackApplyConfig(tracks) {
    trackLayers.forEach( layer => {
      if(map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
      layerControl.removeLayer(layer);
    } );
    config.tracks = [];
    trackTableUpdate();
    mapUpdateTrackLegend();
    if (isDef(tracks)) {
      tracks.forEach((track) => {
        trackFetchUrl(track);
      });
    }
  }

  function trackReadFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let track = { name: file.name, selected: true, color: 'red' };
      const bytes = new Uint8Array(reader.result);
      const ubxData = convertUbxToUnicode(bytes);
      track.epochs = convertUbxToEpochs(ubxData, track);
      const length = track.epochs.length;
      if (length > 0) {
        const name = file.name.replace(/\.ubx$/i, '');
        track.name = prompt(length +" epochs loaded, please name the track.", name);
        if (isDef(track.name) && ('' != track.name)) {
          track.bounds = epochsGetBounds(track.epochs);
          const groupLayer = trackAdd(track);
          trackAddLayer(groupLayer);
          trackTableUpdate();
        }
      } else {
        alert('No epochs loaded, please check the file ' + file.name);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function trackAdd(track) {
    const groupLayer = L.layerGroup();
    config.tracks.push(track);
    trackTableUpdate();
    groupLayer.track = track;
    trackLayers.push(groupLayer);
    layerControl.addOverlay(groupLayer, trackGetLabel(track));
    return groupLayer;
  } 

  function trackFetchUrl(track) {
    const groupLayer = trackAdd(track);
    if (track.epochs) {
      if (track.bounds) {
        track.bounds = epochsGetBounds(track.epochs);
      }
      if (track.selected) {
        trackAddLayer(groupLayer);
      }
    } else {
      fetch(track.url)
      .then(response => response.bytes())
      .then(bytes => {
        // we have a new track 
        const ubxData = convertUbxToUnicode(bytes);
        track.epochs = convertUbxToEpochs(ubxData, track);
        const length = track.epochs.length;
        if (0 < length) {
          track.bounds = epochsGetBounds(track.epochs);
          if (track.selected) {
            trackAddLayer(groupLayer);
          }
          trackTableUpdate();
        } else {
          alert('No epochs loaded, please check the file ' + track.url);
        }
      });
    }
  }

  function trackAddLayer(layerGroup) {
    let trackCoords = [];
    layerGroup.track.epochs.forEach( function(epoch) {
      trackCoords.push( epoch.center );
      if (layerGroup.track.name.toLowerCase() !== 'truth') {
        const marker = L.circleMarker(epoch.center, {
          radius: 3, weight: 1, 
          color: epoch.color, opacity: 1, 
          fillColor: epoch.color, fillOpacity: 0.8,
          className: 'marker'
        });
        if (0 < epoch.info.length) {
          const infText = epoch.info.join('<br/>');
          const flag = L.marker(epoch.center, { riseOnHover: true, className: 'inf-error' } )
                  .bindTooltip(infText, { direction: 'bottom', offset: [-14, 28], });
          layerGroup.addLayer(flag);
        }
        marker.label = trackGetLabel(layerGroup.track);
        marker.fields = epoch.fields;
        marker.on('mouseover', trackMarkerHover);
        marker.on('mouseout', trackMarkerReset);
        marker.on('click', trackMarkerPopUp);
        layerGroup.addLayer(marker);
      } 
    } )
    const track = L.polyline(trackCoords);
    track.setStyle({ color: layerGroup.track.color, opacity: 0.5, weight: 2 });
    layerGroup.addLayer(track);
    layerGroup.addTo(map);
    placeChange();
  }

  function trackMarkerPopUp(e) { 
    const popup = L.popup();
    popup.setLatLng(e.latlng)
    popup.setContent(e.target.label + '<br><br>' + jsonToTable(e.target.fields) )
    popup.openOn(map);
  }
  
  function trackMarkerHover() { this.setRadius(5); }
  function trackMarkerReset() { this.setRadius(3); }

  function trackGetLabel(track) {
    return '<span style="color:'+ track.color + ';">' + track.name + '</span>';
  }

  function trackGetInfo(track, key) {
    return isDef(track.info) && isDef(track.info[key]) ? track.info[key] : '';
  }

  function trackTableUpdate() {
    const table = document.getElementById('table_tracks');
    let html = '<tr><th>Track Name</th><th>Color</th><th>Epochs</th><th>Module</th><th>Firmware</th><th>Protocol</th><th>Hardware</th><th>ROM</th></tr>';
    config.tracks.forEach((track) => {
      html += '<tr><td>'+track.name+'</td>';
      html += '<td><input type="color" disabled value="'+track.color+'"></input></td>';
      html += '<td>' + (isDef(track.epochs) ? track.epochs.length : '') + '</td>';
      html += '<td>' + trackGetInfo(track, 'module') + '</td>';
      let fwVer = trackGetInfo(track, 'fwVer');
      if (fwVer == '') {
        fwVer = trackGetInfo(track, 'monFwVer');
      }
      html += '<td>' + fwVer + '</td>';
      html += '<td>' + trackGetInfo(track, 'protoVer') + '</td>';
      let hwVer = trackGetInfo(track, 'hwVer');
      if (hwVer == '') {
        hwVer = trackGetInfo(track, 'monHwVer');
      }
      html += '<td>' + hwVer + '</td>';
      html += '<td>' + trackGetInfo(track, 'romVer') + '</td></tr>';
    } );
    table.innerHTML = html;
  }

  // ------------------------------------------------------------
  // TRACK 
  // ------------------------------------------------------------

  // the engine needs a unicode string as it will use getCharCodeAt to extract a byte
  function convertUbxToUnicode(ubxData) {
    // convert the data
    let unicodeData = '';
    for (let i = 0; i < ubxData.length; i++) {
      unicodeData += String.fromCharCode(ubxData[i]);
    }
    return unicodeData;
  }

  function convertUbxToEpochs(ubxData, track) {
    let epochs = [];
    Engine.parseReset()
    Engine.parseAppend(ubxData);
    let messages = Engine.parseMessages();
    if (messages.length) {
      let epoch = { fields: {}, ids: {}, info: [] };
      messages.forEach( function(message) {
        if ((message.type === 'output') && message.protocol.match(/^NMEA|UBX$/)) {
          if (isDef(message.fields)) {
            if (epochCheck(epoch, message)) {
              const colorMap = { 
                'DR':    'purple', '2D':    'blue', 
                '2D/3D': 'green',  '3D':    'green', 'DGPS':  'green', 
                '3D+DR': 'purple', 'FIXED': 'green', 'FLOAT': 'green' 
              };
              if (isDef(epoch.fields.lat) && isDef(epoch.fields.lon) && isDef(epoch.fields.fix) && isDef(colorMap[epoch.fields.fix])) {
                epochs.push( { color: colorMap[epoch.fields.fix], center: [epoch.fields.lat, epoch.fields.lon], fields: epoch.fields, info: epoch.info } );
                epoch.info = [];
              }
              epoch.fields = {};
              epoch.ids = {};
            }
            epochFill(epoch.fields, message.fields);
          }
          convertMessageExtract(track, message);
          epoch.ids[message.id] = true;
          let m = message.name.match(/^(INF-(ERROR|WARNING|NOTICE)|(G[PN]TXT))$/)
          if (m) {
            // add texts but only once
            if (!epoch.info.includes(message.fields.infTxt)) {
              epoch.info.push(message.fields.infTxt);
            }
          }
        }
      } );
    }
    return jsonSanitize(epochs);
  }
  
  function convertMessageExtract(track, message) {
    if ((message.protocol === 'UBX') && isDef(message.fields)) {
      if (message.name === 'MON-VER') {
        convertSetInfo(track, 'monFwVer', message.fields.swVer);
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
  } 

  function convertTextExtract(track, text) {
    if (text) {
        let m;
        if (m = text.match(/^MOD=(.+)$/))                     convertSetInfo(track, 'module', m[1]);
        else if (m = text.match(/^HW (.+)$/))                 convertSetInfo(track, 'hwVer', m[1]);
        else if (m = text.match(/^ROM (?:BASE|CORE) (.+)$/))  convertSetInfo(track, 'romVer', m[1]);
        else if (m = text.match(/^EXT CORE (.+)$/))           convertSetInfo(track, 'extCore', m[1]);
        else if (m = text.match(/^FWVER=(.+)$/))              convertSetInfo(track, 'fwVer', m[1]);
        else if (m = text.match(/^PROTVER=(.+)$/))            convertSetInfo(track, 'protoVer', m[1]);
    }
  }

  function convertSetInfo(track, key, value) {
    if(isDef(value) && isDef(key)) {
      track.info ??= {};
      track.info[key] = value;
    }
  }
  
  // ------------------------------------------------------------
  // EPOCH 
  // ------------------------------------------------------------

  function epochCheck(epoch, message) {
    const fields = message.fields;
    if (isDef(fields.time)) {
      return fields.time !== epoch.fields.time;
    } else if (isDef(fields.itow)) {
      return getTimeItow(fields.itow) !== epoch.fields.time;
    }
    const msgId = ['RMC', 'VTG', 'GGA', 'GNS'];
    return msgId.includes(message.id) && epoch.ids[message.id];
  }

  function epochFill(epoch, fields) {
    const keys = [
      'date', 'time',
      'lat', 'lon', 'height', 'msl', 
      'pAcc', 'hAcc', 'vAcc', 
      'speed', 'gSpeed',             
      'sAcc', 'cAcc', 
      'hDop', 'pDop', 'numSV' 
    ];
    keys.forEach(key => {
      if (key in fields) {
        epoch[key] = fields[key];
      }
    });
    // fix
    if (isDef(fields.fixType) && isDef(fields.flags.fixOk)) {
      // from UBX
      const map = { 5: 'TIME', 4: '3D+DR', 3: '3D', 2: '2D', 1: 'DR' }; 
      epoch.fix = (0 == fields.flags.fixOk) ? 'BAD'  :
                  isDef(map[fields.fixType]) ? map[fields.fixType] : 'NO';
    } else {
      /* from  NMEA
      status  quality  navMode posMode 
          V       0        1       N      V = data invalid, A = data valid
          V       0        1       N      GNSS fix, but user limits exceeded
          V       6        2       E      Dead reckoning fix, but user limits exceeded
          A       6        2       E      Dead reckoning fix
          A      1/2       2      A/D     2D GNSS fix        
          A      1/2       3      A/D     3D GNSS fix        
          A      1/2       3      A/D     Combined GNSS/dead reckoning fix  
      */
      if (isDef(fields.status)) {
        const map = { 'V': 'BAD' }; // V = data invalid, A = data valid
        epoch.fix = isDef(map[fields.status]) ? map[fields.status] : epoch.fix;
      } else {
        if (isDef(fields.quality)) {
          const map = { 5: 'FLOAT', 4: 'FIXED', 2: 'DGPS', 1: '2D/3D', 6: 'DR' }; 
          epoch.fix = isDef(map[fields.quality]) ? map[fields.quality] : 'NO';
        } else if (isDef(fields.posMode)) {
          const map = { 'S':'SIM', 'M':'MANUAL', 'F':'FLOAT', 'R':'FIXED', 'D':'DGPS', 'A':'2D/3D', 'E':'DR' }; 
          epoch.fix = isDef(map[fields.posMode]) ? map[fields.posMode] : 'NO';
        }
        if (isDef(epoch.fix) && isDef(fields.navMode) && ("2D/3D" === epoch.fix)) {
          const map = { '3': '3D', '2': '2D' }; 
          epoch.fix = isDef(map[fields.navMode]) ? map[fields.navMode] : epoch.fix;
        }
      }
    }
    // date / time
    if (!isDef(epoch.date) && isDef(fields.year) && isDef(fields.month) && isDef(fields.day)) {
      epoch.date = fmtDate(fields.year, fields.month, fields.day);
    }
    if (!isDef(epoch.time)) {
      if (isDef(fields.hour) && isDef(fields.min) && isDef(fields.sec)) {
        epoch.time = fmtTime(fields.hour, fields.min, fields.sec);
      }
      else if (isDef(fields.itow)) {
        epoch.time = getTimeItow(fields.itow);
      }
    }
    // location
    if (!isDef(epoch.lon) && isDef(fields.longN) && isDef(fields.longI)) {
      epoch.lon = (fields.longI === 'W') ? -fields.longN : fields.longN;
    }
    if (!isDef(epoch.lat) && isDef(fields.latN) && isDef(fields.latI)) {
      epoch.lat = (fields.latI === 'S') ? -fields.latN : fields.latN;
    }
    // speed
    if (!isDef(epoch.gSpeed)) {
      if (isDef(fields.spdKm))
        epoch.gSpeed = 0.06 * fields.spdKm;
      else if (isDef(fields.spdKn))
        epoch.gSpeed = 0.11112 * fields.spdKn;
    }
    // altitude 
    if (isDef(fields.sep)) {
      if (!isDef(epoch.height) && isDef(fields.msl)) {
        epoch.height = fields.msl + fields.sep;
      }
      else if (!isDef(epoch.msl) && isDef(fields.height)) {
        epoch.msl = fields.height - fields.sep;
      }
    } else if (isDef(fields.height) && isDef(fields.msl)) {
      epoch.sep = fields.height - fields.msl;
    }
    epoch = jsonSanitize(epoch);
  }

  function epochsGetBounds(epochs) {
    if (isDef(epochs) && (0 < epochs.length)) {
      const latlngs = Object.values(epochs).map(p => p.center);
      const bounds = L.latLngBounds(latlngs);
      return [
        [bounds.getSouthWest().lat, bounds.getSouthWest().lng],
        [bounds.getNorthEast().lat, bounds.getNorthEast().lng]
      ];
    }
  }

  // ------------------------------------------------------------
  // HELPER 
  // ------------------------------------------------------------

  function isDef(value) {
    return undefined !== value;
  }

  function getTimeItow(itow) {
    const LEAP_SECONDS = 18;
    const itowleap = itow - LEAP_SECONDS
    let tod = (itowleap < 0 ? itowleap + 86400 : itowleap);
    const h = Math.floor(tod / 3600);
    tod = (tod - (h * 3600));
    const m = Math.floor(tod / 60);
    const s = tod - (m * 60);
    return fmtTime(h, m, s);
  }

  function fmtTime(h, m, s) {
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    const ss = String(Math.floor(s)).padStart(2, '0');
    const sss = String(Math.round((s % 1) * 1000)).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${sss}`;
  }

  function fmtDate(y, m, d) {
    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    return `${y}-${mm}-${d}`;
  }
  
  function jsonToTable(json) {
    const rows = Object.entries(json).map(([key, value]) => {
      return `<tr><td>${key}</td><td>${value}</td></tr>`;
    });
    return `<table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  function jsonSanitize(obj) {
    // sanitize the json object
    if (Array.isArray(obj)) {
      return obj.map(jsonSanitize).filter(jsonSanitizeObj);
    } else if ((typeof obj === 'object') && obj !== null) {
      const result = {};
      const objs = Object.entries(obj);
      for (const [key, rawObj] of objs) {
        const sanObj = jsonSanitize(rawObj)
        if(jsonSanitizeObj(sanObj)) {
          result[key] = sanObj;
        }
      }
      return result;
    } else if (typeof obj === 'number') {
      return jsonSanitizeNum(obj);
    } else if ((typeof obj === 'string') && !isNaN(obj) && obj.trim() !== '') {
      return jsonSanitizeNum(obj);
    } else {
      return obj;
    }
  }
  
  function jsonSanitizeObj(obj) {
    // no undefined, null objects or empty strings
    return (obj !== undefined) && (obj !== null) && 
          !((typeof obj === 'string') && (obj.trim() === ''));
  }
  
  function jsonSanitizeNum(obj) {
    // lets round to some digits to avoid long numbers 
    const m = String(obj).match(/^-?\d*(\.?\d*(e[+-]?\d+)?)?$/i);
    if (m) {
      const num = Number(obj);
      return (m[1] && (10 < m[1].length)) ? Number(num.toFixed(10)) : num;
    }
    return obj;
  }

  // ------------------------------------------------------------
  // END 
  // ------------------------------------------------------------

}

return { }; })(); // UVIEW mdoule end