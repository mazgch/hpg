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

import { MapView } from './app/mapView.js';
//import { MapView } from './app/olMapView.js';
import { ChartView } from './app/chartView.js';
import { TableView } from './app/tableView.js';
import { PlacesManager } from './app/placesManager.js';
import { TrimPlayer } from './app/trimPlayer.js';
import { FileManager } from './app/fileManager.js';

import { Track } from './core/track.js';
import { Epoch } from './core/epoch.js';
import { def, bytesToString, isGzip, log } from './core/utils.js';

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

  // track colors
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

  // Application
  // ------------------------------------------------------------------------------------

  let config = { places: [], tracks: [], time: [ -Infinity, Infinity ] };
  
  // FileManager
  const fileControl = document.getElementById('fileManager');
  const fileManager = new FileManager({
    container: fileControl,
    onLoadFiles: (files) => configReadFiles(files),
    onDownload: (evt) => configDownloadJson(evt),
    onClear: () => configClear()
  });
  fileControl.addEventListener('change', (evt) => {
    const track = evt.detail?.track;
    if (track instanceof Track) {
      mapView.updateLayer(track);
      const recalc =  evt.detail?.recalc;
      if (recalc) {
        config.tracks.forEach( (trk) => {
          trackUpdateReferenceErrors(trk); 
          chartView.updateDataset(trk);
        });
      } else {
        chartView.updateDataset(track);
      }
      tableView.updateColumns(config.tracks);
    }
  });

  // TrimPlayer
  const trimControl = document.getElementById('trimPlayer');
  const trimPlayer = new TrimPlayer(trimControl);
  trimControl.addEventListener('trim', (evt) => {
    const timeTrim = evt.detail;
    config.time = timeTrim;
    config.tracks.forEach( (track) => { 
      track.trim(timeTrim);
      mapView.updateLayer(track);
      chartView.updateDataset(track);
    } );
    config.posBounds = trackGetPosBounds();
  });
  trimControl.addEventListener('seek', (evt) => {
    const datetime = evt.detail;
    config.tracks.forEach((track) => {
      track.setTime(datetime); 
    });
    tableView.updateColumns(config.tracks);
    mapView.flyTo(datetime, false);
    chartView.setTime(datetime);
  });
  trimControl.addEventListener('time', (evt) => {
    const datetime = evt.detail;
    config.tracks.forEach((track) => {
      track.setTime(datetime); 
    });
    tableView.updateColumns(config.tracks);
    mapView.flyTo(datetime);
    chartView.setTime(datetime);
  });
  const cropButton = document.getElementById("btnCrop");
  cropButton.addEventListener('click', (evt) => {
    config.tracks.map((track) => {
      track.crop();
      tableView.updateColumns(config.tracks);
      mapView.updateLayer(track); 
      chartView.updateDataset(track);
      trimPlayer.setBounds(config.time);
    })
  });

  // MapView
  const mapsContainer = document.getElementById("map");
  const opacitySlider = document.getElementById('opacity');
  const mapView = new MapView(mapsContainer, opacitySlider);
  mapsContainer.addEventListener('epoch', (evt) => {
    const epoch = evt.detail;
    if ((epoch instanceof Epoch) && epoch.timeValid) {
      trimPlayer.setCurrent(epoch.datetime);
    }
  });
  
  // PlacesManager
  const placeSelect = document.getElementById("places");
  const placeManager = new PlacesManager(placeSelect, mapView);
  
  // ChartView
  const fieldSelect = document.getElementById('field');
  const modeSelect = document.getElementById('mode');
  const chartContainer = document.getElementById("chart");
  const chartView = new ChartView(chartContainer, fieldSelect, modeSelect);
  chartContainer.addEventListener('epoch', (evt) => {
    const epoch = evt.detail;
    if ((epoch instanceof Epoch) && epoch.timeValid) {
      trimPlayer.setCurrent(epoch.datetime);
    }
  });
  const resetZoomButton = document.getElementById('resetZoom');
  resetZoomButton.addEventListener("click", (evt) => {
    chartView.resetZoom();
  });
  
  // TableView
  const tableContainer = document.getElementById("table");
  const tableView = new TableView(tableContainer);
  tableContainer.addEventListener("field", (evt) => {
    const field = evt.detail;
    if (field) {
      chartView.setField(field);
      chartView.configChange();
    }
  });

  // ------------------------------------------------------------------------------------
  // ------------------------------------------------------------------------------------
  // CLEAN mess below up 
  // ------------------------------------------------------------------------------------
  // ------------------------------------------------------------------------------------

  window.onbeforeunload = function _unload() {
    try {
      const json = JSON.stringify(configGetJson());
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
          log(`config ${url}`)
          configFetchJson(url);
        } else if (url.endsWith('.ubx')) {
          const track = new Track(name, Track.EPOCH_FIELDS, { url:url });
          track.fetchUrl(url)
            .then( () => { trackAdd(track) } )
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
      mapView.setCurrentPosition();
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
    placeManager.clear();
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
        config.time = trimPlayer.fromJson(json);
        placeManager.fromJson(json);
        mapView.fromJson(json);
        chartView.fromJson(json);
        Array.isArray(json.tracks) && trackApplyConfig(json.tracks);
      } else {
        alert('Version '+json.version+'of .json envirionment file not supported or unknown.');
      }
    }
  }

  function configReadFiles(files) {
    Array.from(files).forEach(file => {
      if (file.name.match(/json(\.gz)?$/i)) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          let bytes = new Uint8Array(evt.target.result)
          if (isGzip(bytes)) {
            bytes = pako.ungzip(bytes);
          }
          const txt = bytesToString(bytes);
          configApply( txt );
        };
        reader.readAsArrayBuffer(file);
      } else {
        const m = file.name.match(/(?:.*\/)?([^.]+).*$/);
        const name = m ? m[1] : file.name;
        const track = new Track( name, Track.EPOCH_FIELDS, { file:file.name } );
        track.readFile(file)
          .then( (track) => { trackAdd(track);}  );
      }
    });
  }
   
  function configDownloadJson(evt) { 
    const doGzip = !evt.shiftKey;
    let data = JSON.stringify(configGetJson(), null, doGzip ? 0 : 1);
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
    const json = { 
      comment: `This file can be viewed with ${window.location.protocol}//${window.location.hostname}${window.location.pathname}`, 
      version: 1,
    };
    trimPlayer.toJson(json, config.time);
    placeManager.toJson(json);
    mapView.toJson(json);
    chartView.toJson(json);
    const tracks = config.tracks.map( (track) => configTrackJson(track) );
    json.tracks = tracks;
    return json;
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
    Track.EPOCH_FIELDS.forEach((key) => {
        if (def(epoch.fields[key])) {
          json.fields[key] = epoch.fields[key];
        }
    });
    if (epoch.info) json.info = epoch.info;
    return json;
  }

  // Track 
  // ------------------------------------------------------------------------------------

  function trackRemoveAll() {
    // CHART: remove all datasets
    // MAP: remove all layers and update legends  
    config.tracks.forEach( (track) => {
      mapView.removeLayer(track);
      chartView.removeDataset(track);
    } );
    config.tracks.length = 0;
    fileManager.setTracks(config.tracks);
    mapView.updateLegend();
    // no track any more 
    config.posBounds = trackGetPosBounds();
  }

  function trackApplyConfig(jsonTracks) {
    trackRemoveAll();
    if (Array.isArray(jsonTracks)) {
      jsonTracks.forEach( (jsonTrack) => {
        const track = new Track(jsonTrack.name, Track.EPOCH_FIELDS, jsonTrack);
        if (!def(jsonTrack.epochs) && def(track.url)) {
          track.fetchUrl(track.url)
            .then( () => { trackAdd(track); } )
            .catch( console.error )
        } else {
          track.addEpochs(jsonTrack.epochs)
          trackAdd(track);
        }
      } );
    }
  } 
  
  function trackDefaults(track) {
    // set defaults for basic settings
    track.name = (track.name === 'truth') ? Track.TRACK_REFERENCE : track.name;
    const defMode = ((track.name === Track.TRACK_REFERENCE)  ? Track.MODE_LINE : Track.MODE_MARKERS);
    const defColor = (track.name === Track.TRACK_REFERENCE)  ? Track.COLOR_REFERENCE : 
                     (track.info?.protoVer)            ? Track.COLOR_UBLOX : Track.COLOR_OTHERS;
    // apply if not set otherwise
    track.color = track.color ?? defColor;
    track.mode = track.mode ?? defMode;
  } 
  
  function trackUpdateReferenceErrors( track ) {
    const refTrack = config.tracks.find((track) => (track.name === Track.TRACK_REFERENCE));
    const refEpochs = (refTrack !== track) ? refTrack?.epochs : undefined;
    track.epochs.forEach( (epoch) => epoch.calcRefError(refEpochs) );
  }
  
  function trackGetPosBounds() {
    // now we get new bounds
    let minLat  =  Infinity;
    let maxLat  = -Infinity;
    let minLng  =  Infinity;
    let maxLng  = -Infinity;
    // propagate bounds to the config
    config.tracks
        .filter( (track) => (track.mode !== Track.MODE_HIDDEN) )
        .forEach( (track) => {
      const posBounds = track.boundsPos();
      minLat = Math.min(minLat, posBounds[0][0]);
      maxLat = Math.max(maxLat, posBounds[1][0]);
      minLng = Math.min(minLng, posBounds[0][1]);
      maxLng = Math.max(maxLng, posBounds[1][1]);
    } );
    return [ [ minLat, minLng ], [ maxLat, maxLng ] ];
  }

  function trackGetTimeBounds() {
    // now we get new bounds
    let minTime =  Infinity;
    let maxTime = -Infinity;
    // propagate bounds to the config
    config.tracks
        //.filter( (track) => (track.mode !== Track.MODE_HIDDEN) )
        .forEach( (track) => {
      const timeBounds = track.boundsTime();
      minTime = Math.min(minTime, timeBounds[0]);
      maxTime = Math.max(maxTime, timeBounds[1]); 
    } );
    return [ minTime, maxTime ];
  }

  function trackAdd(track) {
    if ((typeof track  === 'object') && (track) && (track.name) && 
        Array.isArray(track.epochs) && (0 < track.epochs.length)) {
      // this is part of adding the tack
      config.tracks.push(track);
      trackDefaults(track);
      // now we propagte the time bounds a global so we can reset the trim player
      config.timeBounds = trackGetTimeBounds()
      trimPlayer.setBounds(config.timeBounds);
      const inBounds = ((config.time[0] >= config.timeBounds[0]) && (config.time[1] <= config.timeBounds[1]))
      if (!inBounds) {
        config.time = config.timeBounds;
      }
      trimPlayer.setTrim(config.time);
      trimPlayer.setCurrent(config.time[0]);
      track.trim(config.time);
      config.posBounds = trackGetPosBounds();
      // now update the tracks 
      if (track.name === Track.TRACK_REFERENCE) {
        config.tracks.forEach( (track) => { 
            trackUpdateReferenceErrors(track);
        });
        chartView.configChange();
      } else {
        trackUpdateReferenceErrors(track);
      }
      if (track.mode !== Track.MODE_HIDDEN) {
        mapView.addLayer(track);
        chartView.addDataset(track);
      }
      placeManager.change();
      fileManager.setTracks(config.tracks);
      return true;
    }
    return false;
  } 
}

// ------------------------------------------------------------------------------------
return { }; })(); // UVIEW mdoule end
// ------------------------------------------------------------------------------------
