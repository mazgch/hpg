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
import { PlacesManager } from './app/placesManager.js';
import { TrimPlayer } from './app/trimPlayer.js';

import { Track } from './core/track.js';
import { FieldsReg } from './core/fieldsReg.js';
import { Statistics } from './core/statistics.js';
import { def, formatDateTime, setAlpha, bytesToString, isGzip } from './core/utils.js';

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

  // chart modes 
  const CHART_TIMESERIES    = 'Time series';
  const CHART_CUMULATIVE    = 'Cumulative';
  const CHART_DERIVATIVE    = 'Derivative';
  const CHART_CDF           = 'CDF';
  const CHART_HISTOGRAM     = 'Histogram';
  const CHART_HISTOGRAM_FD  = 'Histogram FD';
  const CHART_KDE           = 'Kernel density';
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
  
  // chart
  const fieldSelect = document.getElementById('field');
  fieldSelect.addEventListener("change", (evt) => chartConfigChange() );
  const hiddenFields = ['time','date','itow'];
  Track.EPOCH_FIELDS.filter((field) => (!hiddenFields.includes(field)) ).forEach( (field) => {
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

  let config = { places: [], tracks: [], time: [ -Infinity, Infinity ] };
  
  // TrimPlayer
  const trimControl = document.getElementById('trimPlayer');
  const trimPlayer = new TrimPlayer(trimControl);
  trimControl.addEventListener('trim', (evt) => {
    const timeTrim = evt.detail;
    config.time = timeTrim;
    config.tracks.forEach( (track) => { 
      track.trim(timeTrim);
      chartUpdateData(track.dataset);
      if (track.mode !== Track.MODE_HIDDEN) {
        mapView.removeLayer(track);
        mapView.addLayer(track);
      }
    } );
    config.posBounds = trackGetPosBounds();
    trackTableUpdate();
  });
  trimControl.addEventListener('seek', (evt) => {
    const datetime = evt.detail;
    mapView.flyTo(datetime, false);
    chartSetTime(datetime);
  });
  trimControl.addEventListener('time', (evt) => {
    const datetime = evt.detail;
    mapView.flyTo(datetime);
    chartSetTime(datetime);
  });
  
  // MapView
  const mapsContainer = document.getElementById("map");
  const opacitySlider = document.getElementById('opacity');
  const mapView = new MapView(mapsContainer, opacitySlider, trimPlayer);
  
  // PlacesManager
  const placeSelect = document.getElementById("places");
  const placeManager = new PlacesManager(placeSelect, mapView);
  
  // ChartView
  let chart;
  chartInit();

  
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
        (typeof json.field === 'string') && (fieldSelect.value = json.field);
        (typeof json.mode === 'string') && (modeSelect.value = json.mode);
        chartConfigChange();
        config.time = trimPlayer.fromJson(json);
        Array.isArray(json.tracks) && trackApplyConfig(json.tracks);
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
      field: fieldSelect.value, 
      mode: modeSelect.value
    };
    json.tracks = tracks;
    trimPlayer.toJson(json, config.time);
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
      mapView.removeLayer(track);
      if (track.dataset) {
        chartRemoveDataset(track.dataset);
      }
    } );
    config.tracks.length = 0;
    chart.update();
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
            chartUpdateData(track);
        } );
      } else {
        trackUpdateReferenceErrors(track);
      }
      trackTableUpdate();
      // CHART: add dataset 
      track.dataset = chartAddDataset(track);
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
        track.dataset.hidden = (track.mode === Track.MODE_HIDDEN) && (0 < track.dataset.data.length);
        chart.update();
        // MAP: rebuild track and legend
        mapView.removeLayer(track);
        if (track.mode !== Track.MODE_HIDDEN) {
          mapView.addLayer(track);
        }
        mapView.updateLegend();
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
          if (track.dataset) {
            track.dataset.label = newName;
            chart.update();
          }
          // MAP: change the name of marker, popup and legend
          mapView.removeLayer(track);
        if (track.mode !== Track.MODE_HIDDEN) {
            mapView.addLayer(track);
          }
          mapView.updateLegend();
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
          mapView.removeLayer(track);
          if (track.mode !== Track.MODE_HIDDEN) {
            mapView.addLayer(track);
          }
          mapView.updateLegend();
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
        if (epoch.datetime) {
          trimPlayer.setCurrent(epoch.datetime);
        }  
        mapView.flyTo( epoch.datetime, false );
      }
    }
  }

  function chartAddDataset(track) {
    const dataset = { 
      label: track.name, borderColor: setAlpha(track.color,0.8),
      //fill:true, backgroundColor: setAlpha(track.color, 0.01),
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
      const color = ctx.dataset.data[ctx.dataIndex]?.epoch?.color || track.color;
      return setAlpha(color, 1); 
    }
    function _pointBackgroundColor(ctx) { 
      const color = ctx.dataset.data[ctx.dataIndex]?.epoch?.color || track.color;
      return setAlpha(color, 0.8);
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
      return category ? category[Math.round(v)] : defField.format(v); 
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
        .filter( (epoch) => (epoch.selTime) )
        .map( (epoch) => { 
          let v = epoch.fields[fieldSelect.value];
          if (epoch.timeValid && ((track.mode === Track.MODE_ANYFIX) || epoch.fixGood) && def(v)) {
            if (category) {
              v = category.indexOf(`${v}`);
              v = (0 <= v) ? v : null;
            } 
            c += v;
            const d = Number.isFinite(l) ? (v - l) : null;
            l = v;
            let y = (modeSelect.value === CHART_CUMULATIVE) ? (category ? null : c) : 
                    (modeSelect.value === CHART_DERIVATIVE) ? (category ? null : d) : v;
            //y = Number.isFinite(y) ? defField.format(y) : y;
            return { x: epoch.datetime, y: y, epoch:epoch };
          } else {
            l = undefined;
            return { x: null, y: null, epoch:epoch };
          }
        });
      
      const vals = data.map((row) => (row.y)).filter(Number.isFinite);
      dataset.stats = new Statistics(vals);
      if (!chartXisTime()) {
        // convert to cdf or histogram and calc median and quantiles 
        if (category) {
          if (modeSelect.value === CHART_HISTOGRAM) {
            data = dataset.stats.histogram2();
            //dataset.pointRadius = 5;
            //dataset.borderWidth = 0;
          } else {
            data = [];
          }
          data = data.map((row) => { return { 
            x:row.x, 
            y:chart.options.scales.y.ticks.callback(row.y)
          } } );
        } else {
          if (modeSelect.value === CHART_CDF) {
            data = dataset.stats.cdf(512);
          } else if (modeSelect.value === CHART_HISTOGRAM) {
            data = dataset.stats.histogram(512);
          } else if (modeSelect.value === CHART_HISTOGRAM_FD) {
            data = dataset.stats.histogram(/*freedmanDiaconis*/);
          } else if (modeSelect.value === CHART_KDE) {
            data = dataset.stats.kde(/*silvermanBandwidth*/);
          } else {
            data = [];
          }
          data = data.map((row) => { return { 
            x:chart.options.scales.x.ticks.callback(row.x), 
            y:chart.options.scales.y.ticks.callback(row.y)
          } } );
        }
      }
      dataset.hidden = (0 === data.length) || (track.mode === Track.MODE_HIDDEN);
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
        const axis = (chartXisTime()) ? 'y' : 'x';
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
                if (def(dataset.stats.sigma)) {
                  const mps = dataset.stats.mean + dataset.stats.sigma;
                  annotations.plus = _annotation(axis, mps, color, `μ+σ = ${_fmt(mps)}` );
                  const mms = dataset.stats.mean - dataset.stats.sigma;
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
    if (chartXisTime()) {
      chart.options.plugins.annotation.annotations.time = _annotation('x', datetime, '#00000040', 'time' );
      chart.update();
    }
  }
          
  function _annotation(axis, val, color, label) {
    const annotation = { type: Track.MODE_LINE, borderColor: color, borderWidth: 1, borderDash: [6, 6] };
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
      if (chartXisTime()) {
        minY = 0; 
        maxY = Object.keys(defField.map).length - 1;
      } else {
        minX = 0; 
        maxX = Object.keys(defField.map).length - 1;
      }
    } 
    if (!chartXisTime()) {
      minY = 0;
      if (modeSelect.value === CHART_CDF) {
        maxY = 1;
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
  
  function chartXisTime() {
    return (modeSelect.value === CHART_TIMESERIES) || 
           (modeSelect.value === CHART_CUMULATIVE) || 
           (modeSelect.value === CHART_DERIVATIVE);
  } 

}


// ------------------------------------------------------------------------------------
return { }; })(); // UVIEW mdoule end
// ------------------------------------------------------------------------------------
