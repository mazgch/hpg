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
import { ChartView } from './app/chartView.js';
import { PlacesManager } from './app/placesManager.js';
import { TrimPlayer } from './app/trimPlayer.js';

import { Track } from './core/track.js';
import { def, bytesToString, isGzip } from './core/utils.js';

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
  
  const downloadConfig = document.getElementById("download");
  downloadConfig.addEventListener('click', configDownloadJson);

  const clearConfig = document.getElementById("clear");
  clearConfig.addEventListener('click', configClear);

  // Application
  // ------------------------------------------------------------------------------------

  let config = { places: [], tracks: [], time: [ -Infinity, Infinity ] };
  
  // TrimPlayer
  const trimControl = document.getElementById('trimPlayer');
  const trimPlayer = new TrimPlayer(trimControl);
  trimControl.addEventListener('trim', (evt) => {
    const timeTrim = evt.detail;
    config.time = timeTrim;
    config.tracks.forEach( (track) => { 
      track.trim(timeTrim);
      chartView.updateDataset(track);
      mapView.updateLayer(track);
    } );
    config.posBounds = trackGetPosBounds();
    trackTableUpdate();
  });
  trimControl.addEventListener('seek', (evt) => {
    const datetime = evt.detail;
    mapView.flyTo(datetime, false);
    chartView.setTime(datetime);
  });
  trimControl.addEventListener('time', (evt) => {
    const datetime = evt.detail;
    mapView.flyTo(datetime);
    chartView.setTime(datetime);
  });
  const cropButton = document.getElementById("btnCrop");
  cropButton.addEventListener('click', (evt) => {
    config.tracks.map((track) => {
      const epochs = track.epochs.filter( (epoch) => epoch.selTime );
      track.epochs = epochs;
      chartView.updateDataset(track);
      mapView.updateLayer(track); 
      trimPlayer.setBounds(config.time);
    })

  });

  // MapView
  const mapsContainer = document.getElementById("map");
  const opacitySlider = document.getElementById('opacity');
  const mapView = new MapView(mapsContainer, opacitySlider, trimPlayer);
  
  // PlacesManager
  const placeSelect = document.getElementById("places");
  const placeManager = new PlacesManager(placeSelect, mapView);
  
  // ChartView
  const chartContainer = document.getElementById("chart");
  const fieldSelect = document.getElementById('field');
  const modeSelect = document.getElementById('mode');
  const chartView = new ChartView(chartContainer, fieldSelect, modeSelect, trimPlayer, mapView);
  const resetZoomButton = document.getElementById('resetZoom');
  resetZoomButton.addEventListener("click", (evt) => chartView.resetZoom() );

  trackTableUpdate();
  
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
          configFetchJson(url);
        } else if (url.endsWith('.ubx')) {
          const track = new Track(name, Track.EPOCH_FIELDS, { url:url });
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
        Array.isArray(json.tracks) && trackApplyConfig(json.tracks);
        chartView.fromJson(json);
        mapView.fromJson(json);
        placeManager.fromJson(json);
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
    const tracks = config.tracks.map( (track) => configTrackJson(track) );
    const json = { 
      comment: `This file can be viewed with ${window.location.protocol}//${window.location.hostname}${window.location.pathname}`, 
      version: 1,
    };
    json.tracks = tracks;
    trimPlayer.toJson(json, config.time);
    chartView.toJson(json);
    mapView.toJson(json);
    placeManager.toJson(json);
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
      chartView.removeDataset(track);
      mapView.removeLayer(track);
    } );
    config.tracks.length = 0;
    chartView.chart.update();
    mapView.updateLegend();
    // TABLE: update
    trackTableUpdate();
    // no track any more 
    config.posBounds = trackGetPosBounds();
  }

  function trackApplyConfig(jsonTracks) {
    trackRemoveAll();
    if (Array.isArray(jsonTracks)) {
      jsonTracks.forEach( (jsonTrack) => {
        const track = new Track(jsonTrack.name, Track.EPOCH_FIELDS, jsonTrack);
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
        .filter( (track) => (track.mode !== Track.MODE_HIDDEN) )
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
            chartView.updateDataset(track);
        } );
      } else {
        trackUpdateReferenceErrors(track);
      }
      trackTableUpdate();
      // CHART: add dataset 
      chartView.addDataset(track);
      // MAP: add layer
      if (track.mode !== Track.MODE_HIDDEN) {
        mapView.addLayer(track);
      }
      // bound may have changed 
      placeManager.change();
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
        if (mode === Track.MODE_HIDDEN) {
          icon = feather.icons['eye-off'].toSvg( { class:'icon-inline' } );
        } else if (mode === Track.MODE_MARKERS) {
          icon = feather.icons['git-commit'].toSvg( { class:'icon-inline', fill:COLOR_FIX['3D']} )
        } else if (mode === Track.MODE_ANYFIX) {
          icon = feather.icons['share-2'].toSvg( { class:'icon-inline', fill:COLOR_FIX['BAD']} )
        } else {
          icon = '〜';
        }
        return icon;
      }

      function _modeChange(track) {
        // DATA: track mode
        track.mode = (track.mode === Track.MODE_HIDDEN)  ? Track.MODE_LINE :
                     (track.mode === Track.MODE_LINE)    ? Track.MODE_MARKERS :
                     (track.mode === Track.MODE_MARKERS) ? Track.MODE_ANYFIX : 
                                                           Track.MODE_HIDDEN;
        // CHART: update chart with its dataset
        chartView.updateDataset(track);
        // MAP: rebuild track and legend
        mapView.updateLayer(track);
      } 

      function _nameChange(track, newName) {
        if (track.name !== newName) { 
          delete Object.assign(config.tracks, {[newName]: config.tracks[track.name] })[newName];
          const refErrUpd = (track.name === Track.TRACK_REFERENCE) || (newName === Track.TRACK_REFERENCE);
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
          chartView.updateDataset(track);
          // MAP: change the name of marker, popup and legend
          mapView.updateLayer(track);
        }
      }

      function _colorChange(track, newColor) {
        if (track.color !== newColor) {
          // DATA: update color 
          track.color = newColor;
          // CHART: update the map and chart colors 
          chartView.updateDataset(track);
          // MAP: change the color ployline, marker, popup and legend
          mapView.updateLayer(track);
        }
      } 
    }
  }
}


// ------------------------------------------------------------------------------------
return { }; })(); // UVIEW mdoule end
// ------------------------------------------------------------------------------------
