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

  const CONFIG_EMPTY = { places: [], tracks: [] };
  
  // UI
  // ------------------------------------------------------------------------------------

  feather.replace();
    
  const params = new URLSearchParams(window.location.search);
  const urls = params.getAll('f');

  const mapsContainer = document.getElementById("map");
  const downloadConfig = document.getElementById("download");
  downloadConfig.addEventListener('click', configDownloadJson);
  const placeSelect = document.getElementById("places");
  placeSelect.addEventListener("change", placeSelectChange);
  const clearConfig = document.getElementById("clear");
  clearConfig.addEventListener('click', configClear);
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

  // Application
  // ------------------------------------------------------------------------------------

  let map;
  let placesLayer;
  let trackLayers = [];
  let layerControl;
  let config = CONFIG_EMPTY;
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
    // add lat lng x y hint
    const coordControl = L.control({ position: 'bottomright' });
    map.divInfo = L.DomUtil.create('div', 'leaflet-control-coords leaflet-bar');
    coordControl.onAdd = function () { return map.divInfo; };
    coordControl.addTo(map);
    map.on('mousemove', mapUpdateCoords);
    mapsContainer.addEventListener('mouseleave', mapUpdateTrackLegend)
    map.on('overlayadd', trackOverlayAdd);
    map.on('overlayremove', trackOverlayRemove);
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

  // Config 
  // ------------------------------------------------------------------------------------

  function configFetchJson(name) {
    fetch(name)
    .then(response => response.json())
    .then(json => configApply(json))
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

  // Place 
  // ------------------------------------------------------------------------------------

  function placeRemoveAll() {
    map.removeLayer(placesLayer);
    layerControl.removeLayer(placesLayer);
    placesLayer = L.layerGroup().addTo(map);
    layerControl.addOverlay(placesLayer, "Places");
    placeSelect.options.length = 0;
    placeAddOption('Overview');
    config.places = [];
  }

  function placeApplyConfig(places) {
    placeRemoveAll();
    if (isDef(places)) {
      places.forEach((place, idx) => {
        placeAddOption(place.name, place);
      });
    }
  }

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

  // Track 
  // ------------------------------------------------------------------------------------

  function trackRemoveAll() {
    trackLayers.forEach( layer => {
      if(map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
      layerControl.removeLayer(layer);
    } );
    trackLayers = [];
    config.tracks = [];
    trackTableUpdate();
    mapUpdateTrackLegend();
  }

  function trackApplyConfig(tracks) {
    trackRemoveAll();
    if (isDef(tracks)) {
      tracks.forEach((track) => {
        trackFetchUrl(track);
      });
    }
  }

  function trackOverlayAdd(e) {
    if (e.layer.track) {
      e.layer.track.selected = true;
      mapUpdateTrackLegend();
      if (0 == e.layer.getLayers().length) {
        trackAddLayer(e.layer);
      }
    } else {
      // must be 'Places' layer
    }
    /*i*/
  };
  
  function trackOverlayRemove(e) {
    if (e.layer.track) {
      e.layer.track.selected = false;
      mapUpdateTrackLegend();
      e.layer.clearLayers();
    } else {
      // must be 'Places' layer
    }
  };

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
          track.bounds = trackGetBounds(track.epochs);
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
        track.bounds = trackGetBounds(track.epochs);
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
          track.bounds = trackGetBounds(track.epochs);
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
      const center = [epoch.fields.lat, epoch.fields.lng];
      trackCoords.push( center );
      if (layerGroup.track.name.toLowerCase() !== 'truth') {
        const marker = L.circleMarker(center, {
          radius: 3, weight: 1, 
          color: epoch.color, opacity: 1, 
          fillColor: epoch.color, fillOpacity: 0.8,
          className: 'marker'
        });
        if (isDef(epoch.info) && (0 < epoch.info.length)) {
          const infText = epoch.info.join('<br/>');
          const flag = L.marker(center, { riseOnHover: true, className: 'inf-error' } )
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
    const fields =  e.target.fields;
    const rows = Object.entries(Epoch.epochFields)
            .filter(([key]) => key in fields)
            .map(([key, def]) => {
      const unit = isDef(def.unit) ? def.unit : '';
      return '<tr><td>'+def.name+'</td><td class="right">'+fields[key]+'</td><td>'+unit+'</td></tr>';
    });
    popup.setContent( e.target.label + '<br><table style="font-size:0.8em"><thead>' +
            '<tr><th>Parameter</th><th class="right">Value</th><th>Unit</th></tr>' +
            '</thead><tbody>' + rows.join('') + '</tbody></table>');
    popup.openOn(map);
  }
  function trackMarkerHover() { this.setRadius(5); }
  function trackMarkerReset() { this.setRadius(3); }

  function trackGetLabel(track) {
    return `<span style="color:${track.color};">${track.name}</span>`;
  }

  function trackGetInfo(track, key) {
    return isDef(track.info) && isDef(track.info[key]) ? track.info[key] : '';
  }

  function trackTableUpdate() {
    const table = document.getElementById('table_tracks');
    let html = '<tr><th>Track Name</th><th>Color</th><th>Epochs</th><th>Module</th><th>Firmware</th><th>Protocol</th><th>Hardware</th><th>ROM</th></tr>';
    config.tracks.forEach((track) => {
      const epochs = isDef(track.epochs) ? track.epochs.length : '';
      let fwVer = trackGetInfo(track, 'fwVer');
      if (fwVer == '') { 
        fwVer = trackGetInfo(track, 'monFwVer'); 
      }
      let hwVer = trackGetInfo(track, 'hwVer');
      if (hwVer == '') {
        hwVer = trackGetInfo(track, 'monHwVer');
      }
      html += '<tr><td>' + track.name + 
              '</td><td><input type="color" disabled value="' + track.color + '" /></td><td>' + epochs + 
              '</td><td>' + trackGetInfo(track, 'module') + '</td><td>' + fwVer + 
              '</td><td>' + trackGetInfo(track, 'protoVer') + '</td><td>' + hwVer + 
              '</td><td>' + trackGetInfo(track, 'romVer') + '</td></tr>';
    } );
    table.innerHTML = html;
  }

  function trackGetBounds(epochs) {
    if (isDef(epochs) && (0 < epochs.length)) {
      const latlngs = Object.values(epochs).map(p => [p.fields.lat, p.fields.lng]);
      const bounds = L.latLngBounds(latlngs);
      return [
        [bounds.getSouthWest().lat, bounds.getSouthWest().lng],
        [bounds.getNorthEast().lat, bounds.getNorthEast().lng]
      ];
    }
  }

  // Conversions 
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
      let epoch = { fields: {}, ids: {} };
      messages.forEach( function(message) {
        if ((message.type === 'output') && message.protocol.match(/^NMEA|UBX$/)) {
          if (isDef(message.fields)) {
            if (Epoch.epochCheck(epoch, message)) {
              const colorMap = { 
                'DR':    'purple', '2D':    'blue', 
                '2D/3D': 'green',  '3D':    'green', 'DGPS':  'green', 
                '3D+DR': 'purple', 'FIXED': 'green', 'FLOAT': 'green' 
              };
              if (isDef(epoch.fields.lat) && isDef(epoch.fields.lng) && isDef(epoch.fields.fix) && isDef(colorMap[epoch.fields.fix])) {
                epochs.push( { color: colorMap[epoch.fields.fix], fields: epoch.fields, info: epoch.info } );
                delete epoch.info;
              }
              epoch.fields = {};
              epoch.ids = {};
            }
            const keys = [ 
              'date', 'time', 'lat', 'lng', 'height', 'msl', 'pAcc', 'hAcc', 'vAcc', 
              'speed', 'gSpeed', 'sAcc', 'cAcc', 'hDop', 'pDop', 'numSV' 
            ];
            Epoch.epochFill(epoch.fields, message.fields, keys);
          }
          convertMessageExtract(track, message);
          epoch.ids[message.id] = true;
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
    return epochs;
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
  
  // HELPER 
  // ------------------------------------------------------------------------------------

  function isDef(value) {
    return undefined !== value;
  }

}

// ------------------------------------------------------------------------------------
return { }; })(); // UVIEW mdoule end
// ------------------------------------------------------------------------------------
