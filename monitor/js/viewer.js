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

import { TrimPlayer } from './app/trimPlayer.js';
import { Track } from './core/track.js';
import { FieldsReg } from './core/fieldsReg.js';
import { def, formatDateTime, setAlpha, bytesToString } from './core/utils.js';

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

  // Track mode
  const MODE_HIDDEN      = 'hidden';
  const MODE_MARKERS     = 'markers';
  const MODE_ANYFIX      = 'anyfix';
  const MODE_LINE        = 'line';
  // chart modes 
  const CHART_TIMESERIES = 'Time series';
  const CHART_CUMULATIVE = 'Cumulative';
  const CHART_DERIVATIVE = 'Derivative';
  const CHART_CDF        = 'CDF';
  const CHART_HISTOGRAM  = 'Histogram';
  const CHART_HISTOGRAM_COARSE = 'Histogram Coarse';
  // Reseverd words 
  const PLACE_OVERVIEW   = 'Overview';
  const TRACK_REFERENCE  = 'Reference';
  const LAYER_PLACES     = "Places";
  // track colors
  const COLOR_REFERENCE  = '#000000';
  const COLOR_UBLOX      = '#0000ff';
  const COLOR_OTHERS     = '#ff0000';
  const COLOR_FIX = { 
    undefined: '#00000000',
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
    'FIXED': '#008000',
  };
  const EPOCH_FIELDS = [ 
    'date', 'time',
    'fix', 'psm',
    'lat', 'lng', 'pAcc', 'hAcc',
    'height', 'msl', 'vAcc', 
    'speed', 'gSpeed', 'sAcc', 'cAcc', 
    'hDop', 'pDop', 'numSV', 
    'pErr', 'hErr', 'vErr', 'sErr', 'gsErr',
    'ICC1', 'ICC2', 'ICC3', 'ICC4'
  ];
  
  // UI
  // ------------------------------------------------------------------------------------

  feather.replace();
  
  // drag and drop
  const dropzone = document.getElementById('dropzone');
  const dropOverlay = document.getElementById('drop-overlay');
  dropzone.addEventListener('dragover', (evt) => {
    dropOverlay.style.display = 'block';
    evt.preventDefault();
  });
  dropzone.addEventListener('dragleave', () => {
    dropOverlay.style.display = 'none';
  });
  dropzone.addEventListener('drop', (evt) => {
    dropOverlay.style.display = 'none';
    configReadFiles(evt.dataTransfer.files);
    evt.preventDefault();
  });
  // load button
  const loadPicker = document.getElementById('loadpicker');
  const loadFiles = document.getElementById("load");
  loadFiles.addEventListener('click', () => {
    loadPicker.click();
  });
  loadPicker.addEventListener('change', (evt) => { 
    configReadFiles(evt.target.files);
    evt.target.value = null;
  });

  const root = document.getElementById('trimPlayer');
  const trimPlayer = new TrimPlayer(root);
  root.addEventListener('trim', (evt) => {
    config.time = evt.detail;
    trackTableUpdate();
    config.tracks.forEach( (track) => { 
      trackUpdate(track);
      chartUpdateData(track.dataset);
      mapUpdateTrack(track); 
    } );
  });
  root.addEventListener('seek', (evt) => {
    mapFlyTo(evt.detail, false);
    chartSetTime(evt.detail);
  });
  root.addEventListener('time', (evt) => {
    mapFlyTo(evt.detail);
    chartSetTime(evt.detail);
  });
  
  // map
  const mapsContainer = document.getElementById("map");
  const downloadConfig = document.getElementById("download");
  downloadConfig.addEventListener('click', configDownloadJson);
  const placeSelect = document.getElementById("places");
  placeSelect.addEventListener("change", (evt) => {
    const name = evt.target.value;
    const place = config.places.find((place) => (place.name === name));
    placeChange(place);
  });
  const clearConfig = document.getElementById("clear");
  clearConfig.addEventListener('click', configClear);
  const opacitySlider = document.getElementById('opacity');
  opacitySlider.addEventListener('input', (evt) => {
    mapSetOpacity(evt.target.value);
  });
  
  // chart
  const fieldSelect = document.getElementById('field');
  fieldSelect.addEventListener("change", (evt) => chartConfigChange() );
  const hiddenFields = ['time','date','itow'];
  EPOCH_FIELDS.filter((field) => (!hiddenFields.includes(field)) ).forEach( (field) => {
    const option = document.createElement("option");
    option.textContent = FieldsReg[field]?.name || field;
    option.value = field;
    fieldSelect.appendChild(option);
  })
  fieldSelect.value = 'height';
  const modeSelect = document.getElementById('mode');
  modeSelect.addEventListener("change", (evt) => chartConfigChange() );
  const resetZoom = document.getElementById('resetZoom');
  resetZoom.addEventListener("click", chartResetZoom);

  // Application
  // ------------------------------------------------------------------------------------

  let map;
  let chart;
  let placesLayer;
  let baseLayers;
  let layerControl;
  let config = { places: [], tracks: [], time: [ -Infinity, Infinity ] };
  mapInit(); 
  chartInit();
  placeAddOption(PLACE_OVERVIEW);
  trackTableUpdate();
  mapUpdateTrackLegend();
  window.onbeforeunload = function _unload() {
    try {
      const json = configGetJson();
      const bytes = pako.gzip(json);
      const txt = bytesToString(bytes);
      const b64 = btoa(txt);
      localStorage.setItem('json.gz', b64);
    } catch (err) {
      console.error(err);
    }
  }
  const params = new URLSearchParams(window.location.search);
  if (0 < params.size) {
    params.forEach( (url, name) => {
      if (url) {
        const url = url.toLowerCase();
        if (url.endsWith('.json')) {
          configFetchJson(url);
        } else if (url.endsWith('.ubx')) {
          const track = new Track(name, EPOCH_FIELDS, { url:url });
          track.fetchUrl(url)
            .then( () => { console.log("trk loaded "); trackAdd(track) } )
            .catch( console.error );
        }
      }
    });
  } else {
    let json;
    try {
      const b64 = localStorage.getItem('json.gz');
      const binary = atob(b64);
      const bytes = pako.ungzip(binary);
      json = bytesToString(bytes);
    } catch (err) {
      console.error(err);
    }
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
    const stadiaHost = 'https://tiles.stadiamaps.com/tiles/'
    const stadiaTile = '/{z}/{x}/{y}{r}.{ext}';
    const arcGisHost = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
    const arcGisTile = '/MapServer/tile/{z}/{y}/{x}';
    const swissTopoHost = 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.';
    const swissTopoTile = '/default/current/3857/{z}/{x}/{y}.jpeg';
    const swisstopoBounds = [[45.398181, 5.140242], [48.230651, 11.47757]];
    const swisstopoSatellite = L.tileLayer(swissTopoHost + 'swissimage'    + swissTopoTile, 
          { maxZoom: 24, maxNativeZoom: 20, minNativeZoom: 8, bounds: swisstopoBounds } );
    const swisstopoColor  = L.tileLayer(swissTopoHost + 'pixelkarte-farbe' + swissTopoTile, 
          { maxZoom: 24, maxNativeZoom: 18, minNativeZoom: 8, bounds: swisstopoBounds } );
    const swisstopoGray   = L.tileLayer(swissTopoHost + 'pixelkarte-grau'  + swissTopoTile, 
          { maxZoom: 24, maxNativeZoom: 18, minNativeZoom: 8, bounds: swisstopoBounds } );
    const esriSatellite   = L.tileLayer(arcGisHost + 'World_Imagery' + arcGisTile, 
          { maxZoom: 24, maxNativeZoom: 19 } ).addTo(map);
    const stadiaSatellite = L.tileLayer(stadiaHost + 'alidade_satellite' + stadiaTile, 
          { maxZoom: 24, maxNativeZoom: 20, ext: 'jpg' } );
    const osmStreet       = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", 
          { maxZoom: 24, maxNativeZoom: 19 });   
    baseLayers = { 
      "ESRI World Imagery": esriSatellite, "Stadia Satellite": stadiaSatellite,
      "Swisstopo Satellite":swisstopoSatellite, "Swisstopo Color":swisstopoColor, "Swisstopo Gray":swisstopoGray,
      "OSM Street": osmStreet 
    };
    if (window.google?.maps) {
      const googleRoadmap   = L.gridLayer.googleMutant({ type: 'roadmap',   maxZoom: 24 });
      const googleSatellite = L.gridLayer.googleMutant({ type: 'satellite', maxZoom: 24 });
      const googleHhybrid   = L.gridLayer.googleMutant({ type: 'hybrid',    maxZoom: 24 });
      baseLayers['Google Roadmap'] = googleRoadmap;
      baseLayers['Google Satellite'] = googleSatellite;
      baseLayers['Google Hybrid'] =  googleHhybrid
    }
    placesLayer = L.layerGroup().addTo(map);
    layerControl = L.control.layers( baseLayers, { [LAYER_PLACES]: placesLayer } ).addTo(map);
    // add lat lng x y hint
    const coordControl = L.control({ position: 'bottomright' });
    map.divInfo = L.DomUtil.create('div', 'leaflet-control-coords leaflet-bar');
    coordControl.onAdd = () => { return map.divInfo; };
    coordControl.addTo(map);
    map.on('mousemove', mapUpdateCoords);
    mapsContainer.addEventListener('mouseleave', mapUpdateTrackLegend);
    map.on("selectarea:selected", (evt) => { placeAddBounds(evt.bounds); } );
  }
  
  function mapUpdateCoords(evt) {
    const lat = Number(evt.latlng.lat.toFixed(5));
    const lng = Number(evt.latlng.lng.toFixed(5));
    const x = Math.round(evt.containerPoint.x);
    const y = Math.round(evt.containerPoint.y);
    map.divInfo.innerHTML = `Lat: ${lat}, y: ${y}<br>Lng: ${lng} x: ${x} `;
    map.divInfo.style.display = 'block';
  }

  function mapUpdateTrackLegend() {
    while (map.divInfo.firstChild) {
       map.divInfo.removeChild(map.divInfo.lastChild);
    }
    if (0 < config.tracks.length) {
        config.tracks
          .filter( (track) => (track.mode !== MODE_HIDDEN) )
          .forEach( (track) => {
              map.divInfo.appendChild(track.nameHtml('div'));
        } )
        map.divInfo.style.display = 'block';
    } else {
      map.divInfo.appendChild(document.createTextNode("No tracks"));
      map.divInfo.style.maxWidth = '300px'
      map.divInfo.style.display = 'none';
    }
  }
  
  function mapSetBounds(bounds, size) {
    const setSize = Array.isArray(size) && (2 === size.length);
    const wh = setSize ? size.map( (v) => (v + 'px')) : ['',''];
    mapsContainer.style.display = 'block';
    if ((mapsContainer.style.width != wh[0]) || (mapsContainer.style.height != wh[1])) { 
      mapsContainer.style.width = wh[0];
      mapsContainer.style.height = wh[1];
      map.invalidateSize(); // Call after changing size
    }
    if (Array.isArray(bounds) && (2 === bounds.length) && 
       (bounds[0][0] < bounds[1][0]) && (bounds[0][1] < bounds[1][1])) {
     const padding = setSize ? [0,0] : [10, 10];
     map.fitBounds(bounds, { animate: false, padding: padding } );
    }
  }

  function mapSetOpacity(opacity) {
    const panes = document.getElementsByClassName('leaflet-tile-pane');
    for (let i = 0; i < panes.length; i++) {
      panes[i].style.opacity = 1 - opacity;
    }
  }

  function mapAddLayer(track) {
    const addInfos   = (track.mode === MODE_MARKERS) || true; // REACQ / LOST
    const addMarkers = (track.mode === MODE_MARKERS) || (track.mode === MODE_ANYFIX);
    // collect an array of cordinates and information for markers
    let infos = [];
    let trackCoords = [];
    let infoCenter;
    let fixLost;
    const layer = L.layerGroup();
    track.epochs
          .filter((epoch) => epoch.selTime)
          .forEach( (epoch) => {
      // if we are loosing the fix with this epoch 
      if (addInfos && !epoch.fixGood && (fixLost === false)) {
        infos.push('Fix lost');
        fixLost = true;
      }
      // publish messages if we has a location from before 
      if (infoCenter && (0 < infos.length)) {
        // remove any later duplicates 
        infos.filter((item, index) => infos.indexOf(item) === index);
        // add the marker to the layer 
        layer.addLayer( _message(infoCenter, infos, track));
        infos = [];
        infoCenter = undefined;
      }
      // if we are reacquiring a good fix 
      if (addInfos && epoch.posValid && epoch.fixGood) {
        if ((fixLost === true) && addInfos) {
          infos.push('Fix recovered');
        }
        fixLost = false;
      }
      // now concatenate the strings 
      if (epoch.info?.length) {
        infos = infos.concat(epoch.info);
      }
      // populate the the coordinates for the polyline
      if (epoch.posValid) {
        const center = [epoch.fields.lat, epoch.fields.lng];
        if (((track.mode === MODE_ANYFIX) ? epoch.fixValid : epoch.fixGood)) {
          trackCoords.push( center );
          if (addMarkers) {
            // the do marker 
            const marker = L.circleMarker(center, {
              className: 'marker', color: epoch.color, fillColor: epoch.color, 
              radius: 3, weight: 1, opacity: 1, fillOpacity: 0.8
            });
            marker.on('mouseover', (evt) => evt.target.setRadius(5) );
            marker.on('mouseout',  (evt) => evt.target.setRadius(3) );
            marker.on('click', (evt) => mapPopUp(evt.latlng, epoch, track.nameHtml()));
            layer.addLayer(marker);
          }
          infoCenter = center;
        } else if (0 < trackCoords.length) {
          // create segments with gaps
          layer.addLayer( _polyline(trackCoords) );
          trackCoords = [];
        }        
      } 
    } )
    // add the last text marker
    if (infoCenter && (0 < infos.length)) {
      layer.addLayer( _message(infoCenter, infos, track));
    }
    layer.addLayer( _polyline(trackCoords) );
    layer.addTo(map);
    return layer;

    function _polyline( trackCoords ) {
      const polyline = L.polyline(trackCoords, { className: 'polyline', color: track.color, opacity: 0.6, weight: 2 } );
      return polyline;
    }

    function _message(center, infos, track) {
      const svgIcon = feather.icons['message-square'].toSvg( { fill: setAlpha(track.color, 0.3), stroke: setAlpha(track.color, 0.9) } );
      const divIcon = L.divIcon( { html: svgIcon, className: '', iconSize: [20, 20], iconAnchor: [2, 22] } );
      const marker = L.marker(center, { icon: divIcon, riseOnHover: true, } );
      marker.bindTooltip(track.infosHtml(infos), { direction: 'bottom', });
      return marker;
    }
  }

  function mapPopUp(center, epoch, label) {
    const fields = epoch.fields;
    if (epoch.datetime) {
      trimPlayer.setCurrent(epoch.datetime);
    }  
    const div = document.createElement('div');
    // the title 
    div.appendChild(label);
    div.appendChild(epoch.tableHtml(EPOCH_FIELDS));
    // fire the popup
    const popup = L.popup();
    popup.setLatLng(center)
    popup.setContent(div);
    popup.openOn(map);
  }
 
  function mapUpdateTrack(track) {
    if (track.layer) {
      map.removeLayer(track.layer);
      delete track.layer;
      delete track.crossHair;
    }
    if (track.mode !== MODE_HIDDEN) {
      track.layer = mapAddLayer(track);
    }
  }

  function  mapFlyTo(datetime, pan = true) {
    let center;
    let refCenter;
    config.tracks.forEach((track) => {
      if (track.layer) {

        const epoch = track?.epochs
              .filter((epoch) => (epoch.timeValid && epoch.posValid))
              .reduce((prev, curr) => {
          const prevDiff = Math.abs(new Date(prev.datetime) - datetime);
          const currDiff = Math.abs(new Date(curr.datetime) - datetime);
          return currDiff < prevDiff ? curr : prev;
        })
        if (epoch) {
          center = [epoch.fields.lat, epoch.fields.lng];
          if (track.name == TRACK_REFERENCE) {
            refCenter = center;
          }
          if (!def(track.crossHair)) {
            const svgIcon = feather.icons.crosshair.toSvg( { stroke: setAlpha(track.color, 0.9), 'stroke-width': 2,  } );
            const divIcon = L.divIcon( { html: svgIcon, className: '', iconSize: [24, 24], iconAnchor: [12, 12] } );
            track.crossHair = L.marker(center, { icon: divIcon, interactive: false } );
            track.layer.addLayer(track.crossHair);
          } else {
            // reuse
            track.crossHair.setLatLng(center);
          }
        } else {
          track.layer.removeLayer(track.crossHair);
          delete track.crossHair;
        }
      }
    })
    if (!refCenter) {
      refCenter = center;
    }
    if (refCenter && map._loaded) {
      (pan ? map.panTo(refCenter, 20) : map.setView(refCenter, 20)); 
    }
    
  }
  
  // Config 
  // ------------------------------------------------------------------------------------

  function configFetchJson(name) {
    fetch(name)
    .then( (response) => response.bytes())
    .then( (bytes) => {
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
          bytes = pako.ungzip(bytes);
      }
      const txt = bytesToString(bytes);
      configApply(txt);
    })
  }
  
  function configClear() {
    placeRemoveAll();
    trackRemoveAll();
  }

  function configApply(rawJson) {
    let json;
    try {
      json = JSON.parse(rawJson);
    } catch (err) {
       alert("Error parsing the .json envirionment file.");
    }
    if (typeof json === 'object') {
      if (json.version === 1.0) {
        (typeof json.field === 'string') && (fieldSelect.value = json.field);
        (typeof json.mode === 'string') && (modeSelect.value = json.mode);
        chartConfigChange();
        if (Array.isArray(json.time) && (2 === json.time.length)) {
          const range = json.time.map( (time) => new Date(time).getTime() );
          if (Number.isFinite(range[0]) && Number.isFinite(range[1]) && (range[0] < range[1])) {
            config.time = range;
            trimPlayer.setBounds(range);
            trimPlayer.setTrim(range);
            trimPlayer.setCurrent(range[0]);
          }
        }
        if (Number.isFinite(json.opacity)) {
          opacitySlider.value = json.opacity;
          mapSetOpacity(opacitySlider.value);
        }
        if (Array.isArray(json.layers)) {
          Object.entries(baseLayers).forEach( ([name, layer]) => {
            _setVisible(layer,(-1 !== json.layers.indexOf(name)));
          } );
          _setVisible(placesLayer,(-1 !== json.layers.indexOf(LAYER_PLACES)));

          function _setVisible(layer, show) {
            const isVisible = map.hasLayer(layer);
            (isVisible && !show) && map.removeLayer(layer);
            (!isVisible && show) && layer.addTo(map);
          }
        }
        Array.isArray(json.places) && placeApplyConfig(json.places);
        Array.isArray(json.tracks) && trackApplyConfig(json.tracks);
        if (typeof json.place === 'string') {
          const place = config.places.find((place) => (place.name === json.place))
          if (place) {
            placeChange(place);
          }
        }
      } else {
        alert('Version '+json.version+'of .json envirionment file not supported or unknown.');
      }
    }
  }

  function configReadFiles(files) {
    Array.from(files).forEach(file => {
      const name = file.name.toLowerCase();
      const reader = new FileReader();
      reader.onload = (evt) => {
        let bytes = new Uint8Array(evt.target.result)
        let txt;
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
          bytes = pako.ungzip(bytes);
        }
        // if it starts with { we assume it is a json
        if (String.fromCharCode(bytes[0]) === '{') {
          const txt = bytesToString(bytes);
          configApply( txt );
        } else {
          const m = file.name.match(/(?:.*\/)?([^.]+).*$/);
          const name = m ? m[1] : file.name;
          const track = new Track( name, EPOCH_FIELDS, { file:file.name } );
          track.addData(bytes);
          trackAdd(track);
        } 
      };
      reader.readAsArrayBuffer(file);
    });
  }
   
  function configDownloadJson(evt) { 
    const doGzip = !evt.shiftKey;
    let data = configGetJson();
    let type = 'application/json';
    let name = 'config.json';
    if (doGzip) {
      data = pako.gzip(data);
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
    const places = config.places.map( (place) => configPlaceJson(place) );
    const tracks = config.tracks.map( (track) => configTrackJson(track) );
    const range = config.time
          .filter( (time) => Number.isFinite(time) )
          .map( (time) => new Date(time).toISOString() );
    let layers = [];
    Object.entries(baseLayers).forEach(([name, layer]) => {
      map.hasLayer(layer) && layers.push(name);
    } );
    map.hasLayer(placesLayer) && layers.push(LAYER_PLACES);
    const json = { 
      comment: `This file can be viewed with ${window.location.protocol}//${window.location.hostname}${window.location.pathname}`, 
      version: 1,
      place: placeSelect.value, 
      opacity: opacitySlider.value,
      field: fieldSelect.value, 
      mode: modeSelect.value
    };
    (Array.isArray(layers) && (0 < layers.length)) && (json.layers = layers);
    (range.length === 2) && (json.time = range);
    json.places = places;
    json.tracks = tracks;
    return JSON.stringify(json, null, 1/*change to 1 for better readability*/);
  }

  function configPlaceJson(place) {
    return { name:place.name, size:place.size, zoom:place.zoom, center:place.center };
  }

  function configTrackJson(track) {
    const epochs = track.epochs.map( epoch => configEpochJson(epoch) );
    const json = { name:track.name, color:track.color };
    if (track.mode) json.mode = track.mode;
    if (track.info) json.info = track.info;
    if (epochs) json.epochs = epochs;
    return json;
  }

  function configEpochJson(epoch) {
    const json = { fields: {} };
    EPOCH_FIELDS.forEach((key) => {
        if (def(epoch.fields[key])) {
          json.fields[key] = epoch.fields[key];
        }
    });
    if (epoch.info) json.info = epoch.info;
    return json;
  }

  // Place 
  // ------------------------------------------------------------------------------------
  function placeRemoveAll() {
    config.places.forEach( (place) => {
      placesLayer.removeLayer(place.layer);
      placeSelect.removeChild(place.option);
    });
    config.places.length = 0;
  }

  function placeApplyConfig(places) {
    placeRemoveAll();
    if (Array.isArray(places)) {
      places.forEach( (place) => placeAdd(place) )
    }
  }

  function placeAddBounds(bounds) {
    // maks sure bound are valid in current map area 
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const mapBounds = map.getBounds();
    if (mapBounds.contains(sw) && mapBounds.contains(ne)) {
      const center = bounds.getCenter();
      const name = prompt('Please name the place.', center.lat.toFixed(6) + ',' + center.lng.toFixed(6));
      if (name) {
        const zoom = map.getZoom();
        const swPx = map.project(sw, zoom);
        const nePx = map.project(ne, zoom);
        const w = parseInt(Math.abs(nePx.x - swPx.x));
        const h = parseInt(Math.abs(nePx.y - swPx.y));
        const place = { name:name, size: [ w, h ], bounds:[[sw.lat,sw.lng], [ne.lat, ne.lng]] };
        placeAdd(place);
      }
    }
  }

  function placeAdd(place) {
    if (!Array.isArray(place.bounds) && Number.isFinite(place.zoom) && 
          Array.isArray(place.size) && Array.isArray(place.center)) {
      const div = document.createElement('div');
      const temp = L.map(div, { center: place.center, zoom: place.zoom });
      temp._size = L.point(place.size);
      temp._resetView(L.latLng(place.center), place.zoom);
      const sw = temp.getBounds().getSouthWest();
      const ne = temp.getBounds().getNorthEast();
      place.bounds = [ [sw.lat, sw.lng], [ne.lat, ne.lng] ];
    }
    if (Array.isArray(place.bounds)) {
      const marker = L.rectangle(place.bounds, { className: 'place', dashArray: '5, 5', weight: 2 });
      marker.place = place;
      marker.on('click', (evt) => {
        const place = evt.target.place;
        const isOverview = (placeSelect.value === PLACE_OVERVIEW);
        placeSelect.value = isOverview ? place.name : PLACE_OVERVIEW;
        placeChange(isOverview ? place : undefined, evt.originalEvent.ctrlKey);
      });
      place.layer = marker;
      placesLayer.addLayer(marker);
      config.places.push(place);
      placeAddOption(place.name, place);
    }
  }

  function placeAddOption(name, place) {
    const option = document.createElement('option');
    option.textContent = name;
    option.value = name;
    if (place) {
      option.place = place;
      place.option = option;
    }
    placeSelect.appendChild(option);
  }
  
  function placeChange(place, setSize = false) {
    let name;
    if (place === undefined) {
      name = PLACE_OVERVIEW;
      mapSetBounds(config.posBounds);
    } else {
      name = place.name;
      mapSetBounds(place.bounds, setSize ? place.size : undefined);
    }
    if (placeSelect.value !== name) {
      placeSelect.value = PLACE_OVERVIEW;
    }
  }

  // Track 
  // ------------------------------------------------------------------------------------

  function trackRemoveAll() {
    
    // CHART: remove all datasets
    // MAP: remove all layers and update legends  
    config.tracks.forEach( (track) => {
      if (track.layer) {
         map.removeLayer(track.layer);
         delete track.layer;
      }
      if (track.dataset) {
        chartRemoveDataset(track.dataset);
      }
    } );
    config.tracks.length = 0;
    chart.update();
    mapUpdateTrackLegend();
    // TABLE: update
    trackTableUpdate();
    // no track any more 
    trackUpdate();
  }

  function trackApplyConfig(jsonTracks) {
    trackRemoveAll();
    if (Array.isArray(jsonTracks)) {
      jsonTracks.forEach( (jsonTrack) => {
        const track = new Track(jsonTrack.name, EPOCH_FIELDS, jsonTrack);
        def(jsonTrack.epochs) && track.addEpochs(jsonTrack.epochs);
        if ((0 === track.epochs.length) && def(track.url)) {
          track.fetchUrl(track.url)
            .then( () => { trackAdd(track); } )
            .catch( console.error )
        } else {
          trackAdd(track);
        }
      } );
    }
  } 
  
  function trackDefaults(track) {
    // set defaults for basic settings
    track.name = (track.name === 'truth') ? TRACK_REFERENCE : track.name;
    const defMode = ((track.name === TRACK_REFERENCE)  ? MODE_LINE : MODE_MARKERS);
    const defColor = (track.name === TRACK_REFERENCE)  ? COLOR_REFERENCE : 
                     (track.info?.protoVer)            ? COLOR_UBLOX : COLOR_OTHERS;
    // apply if not set otherwise
    track.color = track.color ?? defColor;
    track.mode = track.mode ?? defMode;
  } 
  
  function trackUpdateReferenceErrors( track ) {
    const refTrack = config.tracks.find((track) => (track.name === TRACK_REFERENCE));
    const refEpochs = (refTrack !== track) ? refTrack?.epochs : undefined;
    track.epochs.forEach( (epoch) => epoch.calcRefError(refEpochs) );
  }
  
  function trackUpdate(track) {
    // now we get new bounds
    let minTime =  Infinity;
    let maxTime = -Infinity;
    let minLat  =  Infinity;
    let maxLat  = -Infinity;
    let minLng  =  Infinity;
    let maxLng  = -Infinity;
    if (track) {
      track.epochs.forEach( (epoch) => { 
        epoch.color = FieldsReg.fix?.color(epoch.fields.fix); // to do 
        epoch.selTime = epoch.timeValid && epoch.fixValid && ((config.time.length !== 2) ||
              ((config.time[0] <= epoch.datetime) && (config.time[1] >= epoch.datetime)));
        if (epoch.timeValid && epoch.fixValid) {
          minTime = Math.min(minTime, epoch.datetime);
          maxTime = Math.max(maxTime, epoch.datetime);
        }
        if (epoch.selTime && epoch.fixGood && epoch.posValid) {
          minLat = Math.min(minLat, epoch.fields.lat);
          maxLat = Math.max(maxLat, epoch.fields.lat);
          minLng = Math.min(minLng, epoch.fields.lng);
          maxLng = Math.max(maxLng, epoch.fields.lng);
        }
      } );
      track.timeBounds = [ minTime, maxTime ];
      track.posBounds = [ [ minLat, minLng ], [ maxLat, maxLng] ];
    }
    // propagate bounds to the config
    config.tracks
        .filter( (track) => (track.mode !== MODE_HIDDEN) )
        .forEach( (track) => {
      minTime = Math.min(minTime, track.timeBounds[0]);
      maxTime = Math.max(maxTime, track.timeBounds[1]); 
      minLat = Math.min(minLat, track.posBounds[0][0]);
      maxLat = Math.max(maxLat, track.posBounds[1][0]);
      minLng = Math.min(minLng, track.posBounds[0][1]);
      maxLng = Math.max(maxLng, track.posBounds[1][1]);
    } );
    config.timeBounds = [ minTime, maxTime ];
    config.posBounds = [ [ minLat, minLng ], [ maxLat, maxLng ] ];
  }

  function trackAdd(track) {
    if ((typeof track  === 'object') && (track) && (track.name) && 
        Array.isArray(track.epochs) && (0 < track.epochs.length)) {
      // this is part of adding the tack
      config.tracks.push(track);
      trackDefaults(track);
      if (track.name == TRACK_REFERENCE) {
        config.tracks.forEach( (track) => { 
            trackUpdateReferenceErrors(track); 
        } );
      } else {
        trackUpdateReferenceErrors(track);
      }
      // now update the tracks 
      trackUpdate(track);
      trimPlayer.setBounds(config.timeBounds);
      const inBounds = ((config.time[0] >= config.timeBounds[0]) && (config.time[1] <= config.timeBounds[1]))
      if (!inBounds) {
        config.time = config.timeBounds;
      }
      trimPlayer.setTrim(config.time);
      trimPlayer.setCurrent(config.time[0]);
      trackTableUpdate();
      // CHART: add dataset 
      track.dataset = chartAddDataset(track);
      // MAP: add layer
      if (track.mode !== MODE_HIDDEN) {
        track.layer = mapAddLayer(track);
      }
      // bound may have changed 
      placeChange();
      return true;
    }
    return false;
  } 

  function trackTableUpdate() {
    const iconShow = feather.icons['eye'].toSvg({class:'icon-inline'});
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
    config.tracks
          .sort( (trackA, trackB) => trackA.name.localeCompare(trackB.name) )
          .forEach( (track) => {
            const tr = _getTr(track);
            tbody.appendChild(tr);
          } );

    function _getTr(track) {
      const tr = document.createElement('tr');
      // Icon
      const tdIcon = document.createElement('td');
      tdIcon.className = 'center';
      tdIcon.style.cursor = 'pointer';
      tdIcon.innerHTML = _icon(track.mode);
      tdIcon.addEventListener('click', (evt) => {
        _modeChange(track);
        tdIcon.innerHTML = _icon(track.mode);
      } );
      tr.appendChild(tdIcon);
      // Name
      const tdName = document.createElement('td');
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = track.name;
      nameInput.addEventListener("keyup", (evt) => {
        if (evt.key === "Enter") {
          nameInput.blur();
        }
      } );
      nameInput.addEventListener("blur", (evt) => {
        _nameChange(track, evt.target.value);
      } );
      tdName.appendChild(nameInput);
      tr.appendChild(tdName);
      // Color Pickers
      const tdColor = document.createElement('td');
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value =  track.color;
      colorInput.style.cursor = 'pointer';
      nameInput.track = track;
      colorInput.addEventListener("change", (evt) => {
        _colorChange(track, evt.target.value);
      });
      tdColor.appendChild(colorInput);
      tr.appendChild(tdColor);
      // infos 
      _addTd(tr, track.info?.module || '');
      _addTd(tr, track.info?.fwVer || '');
      _addTd(tr, track.info?.protoVer || '');
      _addTd(tr, track.info?.hwVer || track.info?.monHwVer || '');
      const epochs = track.epochs.filter(epoch => epoch.selTime && epoch.fixGood);
      _addTd(tr, `${epochs.length} / ${track.epochs.length}`);
      
      function _addTd(tr, value) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      }
      return tr;
    
      function _icon(mode) {
        let icon;
        if (mode === MODE_HIDDEN) {
          icon = feather.icons['eye-off'].toSvg( { class:'icon-inline' } );
        } else if (mode === MODE_MARKERS) {
          icon = feather.icons['git-commit'].toSvg( { class:'icon-inline', fill:COLOR_FIX['3D']} )
        } else if (mode === MODE_ANYFIX) {
          icon = feather.icons['share-2'].toSvg( { class:'icon-inline', fill:COLOR_FIX['BAD']} )
        } else {
          icon = '〜';
        }
        return icon;
      }

      function _modeChange(track) {
        // DATA: track mode
        track.mode = (track.mode === MODE_HIDDEN)  ? MODE_LINE :
                     (track.mode === MODE_LINE)    ? MODE_MARKERS :
                     (track.mode === MODE_MARKERS) ? MODE_ANYFIX : 
                                                     MODE_HIDDEN;
        // CHART: update chart with its dataset
        track.dataset.hidden = (track.mode === MODE_HIDDEN) && (0 < track.dataset.data.length);
        chart.update();
        // MAP: rebuidl track and legend
        mapUpdateTrack(track);
        mapUpdateTrackLegend();
      } 

      function _nameChange(track, newName) {
        if (track.name !== newName) { 
          delete Object.assign(config.tracks, {[newName]: config.tracks[track.name] })[newName];
          const refErrUpd = (track.name === TRACK_REFERENCE) || (newName === TRACK_REFERENCE);
          // DATA: update name and reference errors  
          track.name = newName;
          if (refErrUpd) {
            config.tracks.forEach( (track) => { 
              trackUpdateReferenceErrors(track); 
            } );
          } else {
            trackUpdateReferenceErrors(track);
          }
          // CHART: update the name in the dataset
          if (track.dataset) {
            track.dataset.label = newName;
            chart.update();
          }
          // MAP: change the name of marker, popup and legend
          mapUpdateTrack(track);
          mapUpdateTrackLegend();
        }
      }

      function _colorChange(track, newColor) {
        if (track.color !== newColor) {
          // DATA: update color 
          track.color = newColor;
          // CHART: update the map and chart colors 
          track.dataset.borderColor = track.color;
          chart.update();
          // MAP: change the color ployline, marker, popup and legend
          mapUpdateTrack(track);
          mapUpdateTrackLegend();
        }
      } 
    }
  }

  // Chart 
  // ------------------------------------------------------------------------------------

  function chartInit() {
    const chartContainer = document.getElementById("chart");
    chartContainer.addEventListener( 'mouseout', chartUpdateAnnotation);
    chart = new Chart(chartContainer, {
      type: 'scatter',
      data: {
        datasets: []
      },
      options: { 
        onHover: chartUpdateAnnotation,
        onLeave: chartUpdateAnnotation,
        onClick: chartOnClick,
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { intersect: false, mode: 'nearest' },
        layout: { padding: { left: 10, right: 10+10+24, top: 10, bottom: 10 } },
        transitions: { active: { animation: { duration: 0 } }, resize: { animation: { duration: 0 } } },
        plugins: {
          annotation: {  annotations: {} },
          legend: {
            enabled: true,
            labels: { 
              boxWidth: 20, boxHeight: 0,
              filter: (legendItem) => (!legendItem.hidden)
            }, 
            onClick: (evt) => evt.stopPropagation()
          },
          tooltip: {
            usePointStyle: false, displayColors: false,
            backgroundColor: 'rgba(245,245,245,0.8)',
            bodyColor: '#000',  bodyFont: { size: 10 },
            borderColor: '#888', borderWidth: 1, cornerRadius: 0,
            callbacks: { label: _toolTipTitle,  afterLabel: _toolTipText, }
          },
          zoom: {
            pan: { enabled: true, mode: 'xy' },
            zoom: {
              mode: 'xy',
              pinch: { enabled: true },
              wheel: { enabled: true, modifierKey: 'shift' },
              drag:  { enabled: true, modifierKey: 'shift', borderWidth: 2 }
            }
          }
        },
        scales: { 
          y: { 
            type: 'linear',
            title: { display: true },
            ticks: { font:{ size:10 }, maxRotation:0, autoSkipPadding:10, beginAtZero: false }
          },
          x: { 
            type: 'linear',
            title: { display: true, },
            ticks: { font:{ size:10 }, maxRotation:0, autoSkipPadding:10, beginAtZero: false }
          }
        }
      }
    });
    chartConfigChange(); // initial change

    function _toolTipTitle(context) {
      return context.dataset.label;
    }
    
    function _toolTipText(context) {
      const defField = FieldsReg[fieldSelect.value];
      const unit = (defField.unit ? ' ' + defField.unit : '')
      const category = defField.map ? Object.keys(defField.map) : undefined;
      if ((modeSelect.value === CHART_TIMESERIES) || 
          (modeSelect.value === CHART_CUMULATIVE) ||
          (modeSelect.value === CHART_DERIVATIVE)) {
        const txtX = context.chart.options.scales.x.title.text;
        const txtY = defField.name;
        const valX = context.chart.options.scales.x.ticks.callback(context.raw.x);
        const valY = (category ? category[context.raw.y] : context.raw.y) + unit;
        return `${txtY}: ${valY}\n${txtX}: ${valX}`;
      } else {
        const txtX = defField.name;
        const txtY = context.chart.options.scales.y.title.text;
        const valX = (category ? category[context.raw.x] : context.raw.x) + unit;
        const valY = context.chart.options.scales.y.ticks.callback(context.raw.y);
        return `${txtY}: ${valY}\n${txtX}: ${valX}`;
      }
    }
  }

  function chartOnClick(e) {
    const elems = e.chart.getElementsAtEventForMode(e, "nearest", {intersect:false} );
    if (0 < elems.length) {
      const pt = elems[0];
      const dataset = e.chart.data.datasets[pt.datasetIndex];
      const epoch = dataset.data[pt.index].epoch;
      if (epoch?.posValid) {
        const zoom = Math.min(map.getZoom(), 20);
        const center = [epoch.fields.lat, epoch.fields.lng];
        map.setView( center, zoom );
        mapPopUp( center, epoch, dataset.track.nameHtml());
      }
    }
  }

  function chartAddDataset(track) {
    const dataset = { 
      label: track.name, borderColor: track.color, 
      track: track,
      data: [],
      hidden: true, spanGaps: false, showLine: true,
      borderCapStyle: 'round', borderJoinStyle: 'bevel',
      borderWidth: 2,
      pointRadius: 0, pointBorderWidth: 0,
      pointBorderColor: _pointColor,
      pointBackgroundColor: _pointBackgroundColor,
      pointHoverRadius: 5, pointHoverBorderWidth: 1,
      pointHoverBorderColor: _pointColor,
      pointHoverBackgroundColor: _pointBackgroundColor,
    };
    chart.data.datasets.push( dataset );
    track.dataset = dataset;
    chartUpdateData(dataset);
    
    function _pointColor(ctx) {
      return ctx.dataset.data[ctx.dataIndex]?.epoch?.color || track.color; 
    }
    function _pointBackgroundColor(ctx) { 
      return setAlpha(_pointColor(ctx), 0.8);
    }
    return dataset;
  }

  function chartRemoveDataset(dataset) { 
    const ix = chart.data.datasets.indexOf(dataset);
    if (ix !== -1) {
      chart.data.datasets.splice(ix, 1);
    }
  }

  function chartConfigChange() { 
    // update the data from epoch
    const field = fieldSelect.value;
    const defField = FieldsReg[field];
    const axisName = defField.name + 
        ( ((modeSelect.value === CHART_CUMULATIVE) ||
           (modeSelect.value === CHART_DERIVATIVE) ||
            !defField.unit) ? '' : (' [' + defField.unit + ']'));
    const category = def(defField.map) ? Object.keys(defField.map) : undefined;
    const prec = defField.prec;
    
    if ((modeSelect.value === CHART_TIMESERIES) || 
        (modeSelect.value === CHART_CUMULATIVE) || 
        (modeSelect.value === CHART_DERIVATIVE)) {
      chart.options.scales.x.title.text = 'Time UTC';
      chart.options.scales.x.ticks.callback = formatDateTime;
      chart.options.scales.x.ticks.maxTicksLimit = 10;
      chart.options.scales.x.ticks.autoSkip = true;
      chart.options.scales.x.ticks.stepSize = undefined;

      chart.options.scales.y.title.text = ((modeSelect.value !== CHART_TIMESERIES) ? modeSelect.value + ' ' : '') + axisName;
      chart.options.scales.y.ticks.callback = _fmtVal;
      chart.options.scales.y.ticks.maxTicksLimit = category ? category.length: undefined;
      chart.options.scales.y.ticks.autoSkip = category ? false : true;
      chart.options.scales.y.ticks.stepSize = category ? 1 : undefined;
    } else {
      chart.options.scales.x.title.text = axisName;
      chart.options.scales.x.ticks.callback = _fmtVal;
      chart.options.scales.x.ticks.maxTicksLimit = category ? category.length: undefined;
      chart.options.scales.x.ticks.autoSkip = category ? false : true;
      chart.options.scales.x.ticks.stepSize = category ? 1 : undefined;

      chart.options.scales.y.title.text = (modeSelect.value === CHART_CDF) ? 'Cumulative density' : 'Density';
      chart.options.scales.y.ticks.callback = (v) => Number(v.toFixed(5));
      chart.options.scales.y.ticks.maxTicksLimit = undefined;
      chart.options.scales.y.ticks.autoSkip = true;
      chart.options.scales.y.ticks.stepSize = undefined;
    } 

    chart.data.datasets.forEach( (dataset) => chartUpdateData(dataset) );

    function _fmtVal(v) { 
      return category ? category[v] : defField.format(v); 
    }
  }

  function chartUpdateData(dataset) {
    // update the data from epoch
    const field = fieldSelect.value;
    const defField = FieldsReg[field];
    const category = def(defField.map) ? Object.keys(defField.map) : undefined;
    // TODO *************** fix above 
    
    config.tracks
          .filter( (track) => ((dataset === undefined) || (dataset === track.dataset)))
          .forEach( (track) => {
      // created the chart data
      let c = 0;
      let l; 
      let data = track.epochs
        .filter( (epoch) => (epoch.selTime && epoch.timeValid) )
        .map( (epoch) => { 
          let v = epoch.fields[fieldSelect.value];
          if (((track.mode === MODE_ANYFIX) ? epoch.fixValid : epoch.fixGood) && (v !== undefined)) {
            if (category) {
              v = category.indexOf(`${v}`);
              v = (0 <= v) ? v : undefined;
            } 
            c += v;
            const d = Number.isFinite(l) ? (v - l) : undefined;
            l = v;
            let y = (modeSelect.value === CHART_CUMULATIVE) ? (category ? undefined : c) : 
                      (modeSelect.value === CHART_DERIVATIVE) ? (category ? undefined : d) : v;
            //y = Number.isFinite(y) ? defField.format(y) : y;
            return { x: epoch.datetime, y: y, epoch:epoch };
          } else {
            l = undefined;
            return { x: epoch.datetime, y: undefined, epoch:epoch };
          }
        });
      // calc the cnt, mean, std dev, min and max

      const vals = data.map((row) => (row.y)).filter(Number.isFinite);
      const dataset = track.dataset;
      dataset.stats = {};
      dataset.stats.cnt = vals.length;
      if (0 < vals.length) {
        dataset.stats.min = Math.min(... vals);
        dataset.stats.max = Math.max(... vals);
        dataset.stats.mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        if (1 < vals.length) {
          dataset.stats.std = Math.sqrt(vals.reduce((s, x) => s + (x - dataset.stats.mean) ** 2, 0) / vals.length);
        }
      }
      // convert to cdf or histogram and calc median and quantiles 
      if ((modeSelect.value === CHART_CDF) ||
          (modeSelect.value === CHART_HISTOGRAM)  || 
          (modeSelect.value === CHART_HISTOGRAM_COARSE)) {
        const PRECISION_REDUCE = (modeSelect.value === CHART_HISTOGRAM_COARSE) ? 2 : 1;
        const prec = (0 < defField.prec) ? Math.max(1, defField.prec - PRECISION_REDUCE) : 1;
        const xd = (10 ** -prec).toFixed(prec);
        // 1) extract & optionally round
        const vals = data
          .filter( (row) => Number.isFinite(row.y) )   // only work with good numbers 
          .map( (row) => Number(row.y.toFixed(prec)) ) // reduce precision 
        const len = vals.length;
        if (0 < len) {
          // 2) frequency by value
          const hist = {};
          vals.forEach( (x) => { 
            hist[x] = (hist[x] || 0) + 1
          });
          // 3) sort unique value
          let sortValues = Object.keys(hist).map(Number).sort((a, b) => a - b);
          // 4) stuff additional zeros in between values / determine the quantiles
          const isCdf = (modeSelect.value === CHART_CDF);
          let xl = (sortValues[0] - xd).toFixed(prec);
          let y = 0;
          let yCum = 0;
          const dataValues = [];
          sortValues.forEach( (x) => {
            // push a 0 just after last
            if ((xl < x) && !isCdf) {
              dataValues.push( { x:xl, y:y } );
            }
            // push a 0 just before current 
            const xn = x - xd;
            if (xl < xn) {
              dataValues.push( { x:xn, y:y } );
            }
            y = hist[x] || 0;
            yCum += y;
            // capture the cdf values in the hash
            const cdf = yCum / len;
            dataset.stats.q50 ??= cdf >= 0.500 ? x : dataset.stats.q50;
            dataset.stats.q68 ??= cdf >= 0.680 ? x : dataset.stats.q68;
            dataset.stats.q95 ??= cdf >= 0.950 ? x : dataset.stats.q95;
            dataset.stats.q99 ??= cdf >= 0.997 ? x : dataset.stats.q99;
            // select the new y value
            y = isCdf ? cdf : (y / len);
            dataValues.push( { x:x, y:y } );
            y = isCdf ? y : 0;
            xl = x + xd;
          });
          dataValues.push( { x:xl, y:y } );
          data = dataValues;
        } else { 
          data.length = 0;
        }
      }
      dataset.hidden = (0 === data.length) || (track.mode === MODE_HIDDEN);
      dataset.data.length = 0;
      if (data.length) {
        dataset.data.push.apply(dataset.data, data);
      }
    });
    // create the annotaions
    chartUpdateAnnotation();
    // change axis to fit new data
    chartResetZoom();
    // finally redraw
    chart.update();
  }

  // add annotaions to the chart
  function chartUpdateAnnotation(evt, active/*,chart*/) {
    if (chart) {
      const CHART_CDF_ANNOTAIONS = {
        y50: _annotation('y', 0.500, '#00000040', '0.5' ),
        y68: _annotation('y', 0.680, '#00000040', '0.68' ),
        y95: _annotation('y', 0.950, '#00000040', '0.95' ),
        y99: _annotation('y', 0.997, '#00000040', '0.997')
      };    
      let annotations = (modeSelect.value === CHART_CDF) ? CHART_CDF_ANNOTAIONS : {};
      if (def(chart.options.plugins.annotation.annotations.time)) {
          const datetime = chart.options.plugins.annotation.annotations.time.xMin;
          if (def(datetime)) {
            annotations.time = _annotation('x', datetime, '#00000040', 'time' );
          }
      }
      if (active && (0 < active.length)) {
        const axis = ((modeSelect.value === CHART_TIMESERIES) || 
                      (modeSelect.value === CHART_CUMULATIVE) || 
                      (modeSelect.value === CHART_DERIVATIVE)) ? 'y' : 'x';
        const index = active[0].datasetIndex;
        const dataset = chart.data.datasets[index];
        if (!dataset.hidden) {
          const color = dataset.borderColor;
          const _fmt = chart.options.scales[axis].ticks.callback;
          if (modeSelect.value === CHART_CDF) {
            if (def(dataset.stats.q50)) annotations.q50 = _annotation(axis, dataset.stats.q50, color, `x̃ = ${_fmt(dataset.stats.q50)}` );
            if (def(dataset.stats.q68)) annotations.q68 = _annotation(axis, dataset.stats.q68, color, `Q68 = ${_fmt(dataset.stats.q68)}` );
            if (def(dataset.stats.q95)) annotations.q95 = _annotation(axis, dataset.stats.q95, color, `Q95 = ${_fmt(dataset.stats.q95)}` );
            if (def(dataset.stats.q99)) annotations.q99 = _annotation(axis, dataset.stats.q99, color, `Q99.7 = ${_fmt(dataset.stats.q99)}` );
          } else {
            if (def(dataset.stats.min)) annotations.min = _annotation(axis, dataset.stats.min, color, `min = ${_fmt(dataset.stats.min)}`);
            if (def(dataset.stats.max)) annotations.max = _annotation(axis, dataset.stats.max, color, `max = ${_fmt(dataset.stats.max)}`);
            if (def(dataset.stats.mean)) {
              const field = fieldSelect.value;
              const defField = FieldsReg[field];
              if (!def(defField.map)) {
                annotations.mean = _annotation(axis, dataset.stats.mean, color, `μ = ${_fmt(dataset.stats.mean)}`);
                if (def(dataset.stats.std)) {
                  const mps = dataset.stats.mean + dataset.stats.std;
                  annotations.plus = _annotation(axis, mps, color, `μ+σ = ${_fmt(mps)}` );
                  const mms = dataset.stats.mean - dataset.stats.std;
                  annotations.minus = _annotation(axis, mms, color, `μ-σ = ${_fmt(mms)}`);
                }
              }
            }
          }
        } 
      }
      /// TODO: try to reuse the hash
      chart.options.plugins.annotation.annotations = annotations;
      chart.update();
    }
  }

  function chartSetTime(datetime) {
    if ((modeSelect.value === CHART_TIMESERIES) || 
        (modeSelect.value === CHART_CUMULATIVE) || 
        (modeSelect.value === CHART_DERIVATIVE)) {
      chart.options.plugins.annotation.annotations.time = _annotation('x', datetime, '#00000040', 'time' );
      chart.update();
    }
  }
          
  function _annotation(axis, val, color, label) {
    const annotation = { type: MODE_LINE, borderColor: color, borderWidth: 1, borderDash: [6, 6] };
    if (axis === 'x') {
      annotation.xMin = annotation.xMax = val;
    } else {
      annotation.yMin = annotation.yMax = val;
    }
    if (label) {
      const position = (axis === 'y') ? 'start' : 'end';
      const rotation = (axis === 'x') ? -90 : 0;
      annotation.label = { 
        padding:2, display: true, content: label, position: position, 
        textStrokeColor: 'rgba(255,255,255,1)', textStrokeWidth: 5, font: { weight:'nomal' },
        backgroundColor: 'rgba(255,255,255,0)', color: color, rotation: rotation 
      };
    }
    return annotation;
  }
 
  function chartResetZoom() {
    // find the bounds 
    let minX =  Infinity;
    let maxX = -Infinity;
    let minY =  Infinity;
    let maxY = -Infinity;
    chart.data.datasets
      .filter( (dataset) => (!dataset.hidden) )
      .forEach( (dataset) => {
        dataset.data.forEach( (row) => {
          if (Number.isFinite(row.x)) {
            minX = Math.min(minX, row.x);
            maxX = Math.max(maxX, row.x);
          }
          if (Number.isFinite(row.y)) {
            minY = Math.min(minY, row.y);
            maxY = Math.max(maxY, row.y);
          }
        } )
    } );
    // category fields are fixed
    const defField = FieldsReg[fieldSelect.value];
    if (defField.map) {
      // make it fixed size
      if (modeSelect.value === CHART_TIMESERIES) {
        minY = 0; 
        maxY = Object.keys(defField.map).length - 1;
      } else {
        minX = 0; 
        maxX = Object.keys(defField.map).length - 1;
      }
    }
    // make defaults 
    if ((modeSelect.value === CHART_CDF) ||
        (modeSelect.value === CHART_HISTOGRAM) ||
        (modeSelect.value === CHART_HISTOGRAM_COARSE)) {
      minY = 0.00;
      if (modeSelect.value === CHART_CDF) {
        maxY = 1.00;
      } 
    }
    // now reset the zoom plugin 
    chart.resetZoom();
    // set new scales
    chart.options.scales.x.min = Number.isFinite(minX) ? minX : undefined;
    chart.options.scales.x.max = Number.isFinite(maxX) ? maxX : undefined;
    chart.options.scales.y.min = Number.isFinite(minY) ? minY : undefined;
    chart.options.scales.y.max = Number.isFinite(maxY) ? maxY : undefined;
  }
}

// ------------------------------------------------------------------------------------
return { }; })(); // UVIEW mdoule end
// ------------------------------------------------------------------------------------
