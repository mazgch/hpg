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

window.clickLink = function _clickLink(link) {
    let el = window.open(link, '_blank');
    if (el) el.focus();
}

window.onload = function _onload() {
    
    feather.replace();

    // Application
    // ------------------------------------------------------------------------------------

    let config = { time: [-Infinity, Infinity] };

    // TrimPlayer
    // ------------------------------------------------------------------------------------

    const trimControl = document.getElementById('trimPlayer');
    const trimPlayer = new TrimPlayer(trimControl);
    trimControl.addEventListener('trim', (evt) => {
        const timeTrim = evt.detail;
        config.time = timeTrim;
        fileManager.tracks.forEach((track) => {
            track.trim(timeTrim);
            mapView.updateLayer(track);
            chartView.updateDataset(track);
        });
        config.posBounds = fileManager.getPosBounds();
    });
    trimControl.addEventListener('seek', (evt) => {
        const datetime = evt.detail;
        fileManager.tracks.forEach((track) => {
            track.setTime(datetime);
        });
        tableView.updateColumns(fileManager.tracks);
        mapView.flyTo(false); // will use track.currentEpoch
        chartView.setTime(datetime);
    });
    trimControl.addEventListener('time', (evt) => {
        const datetime = evt.detail;
        fileManager.tracks.forEach((track) => {
            track.setTime(datetime);
        });
        tableView.updateColumns(fileManager.tracks);
        mapView.flyTo(false); // will use track.currentEpoch
        chartView.setTime(datetime);
    });
    const cropButton = document.getElementById("btnCrop");
    cropButton.addEventListener('click', (evt) => {
        fileManager.tracks.map((track) => {
            track.crop();
            mapView.updateLayer(track);
            chartView.updateDataset(track);
            trimPlayer.setBounds(config.time);
        })
        tableView.updateColumns(fileManager.tracks);
    });

    // MapView
    // ------------------------------------------------------------------------------------

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
    // ------------------------------------------------------------------------------------

    const placeSelect = document.getElementById("places");
    const placeManager = new PlacesManager(placeSelect, mapView);

    // ChartView
    // ------------------------------------------------------------------------------------

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
    // ------------------------------------------------------------------------------------
    
    const tableContainer = document.getElementById("table");
    const tableView = new TableView(tableContainer);
    tableContainer.addEventListener("field", (evt) => {
        const field = evt.detail;
        if (field) {
            chartView.setField(field);
            chartView.configChange();
        }
    });

    // Drag & Drop
    // ------------------------------------------------------------------------------------

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
        fileManager.readFiles(evt.dataTransfer.files);
        evt.preventDefault();
    });

    // FileManager
    // ------------------------------------------------------------------------------------

    const fileControl = document.getElementById('fileManager');
    const fileManager = new FileManager({
        container: fileControl,
        onFromJson,
        onToJson
    });
    fileControl.addEventListener('add', (evt) => {
        const track = evt.detail;
        // now we propagte the time bounds a global so we can reset the trim player
        config.timeBounds = fileManager.getTimeBounds()
        if (config.timeBounds[0] < config.timeBounds[1]) {
            trimPlayer.setBounds(config.timeBounds);
            const inBounds = ((config.time[0] >= config.timeBounds[0]) && (config.time[1] <= config.timeBounds[1]))
            if (!inBounds) {
                config.time = config.timeBounds;
            }
            trimPlayer.setTrim(config.time);
            trimPlayer.setCurrent(config.time[0]);
            track.trim(config.time);
            config.posBounds = fileManager.getPosBounds();
        }

        // and update the track if needed 
        if ((track.mode !== Track.MODE_HIDDEN) && (0 < track.epochs.length)) {
            mapView.addLayer(track);
            chartView.addDataset(track);
            tableView.updateColumns(fileManager.tracks);
        }
        // TODO do we need this really 
        placeManager.change(); 
    });
    fileControl.addEventListener('update', (evt) => {
        const track = evt.detail;
        mapView.updateLayer(track);
        chartView.updateDataset(track);
        tableView.updateColumns(fileManager.tracks);
    });
    fileControl.addEventListener('remove', (evt) => {
        const track = evt.detail;
        mapView.removeLayer(track);
        chartView.removeDataset(track);
        tableView.updateColumns(fileManager.tracks);
    });

     // Json Environment File Callbacks 
    // ------------------------------------------------------------------------------------

    const JSON_VERSION = 1.0;

    function onFromJson(rawJson) {
        if (rawJson) {
            let json;
            try {
                json = JSON.parse(rawJson);
            } catch (err) {
                alert("Error parsing .json envirionment file.");
            }
            if (typeof json === 'object') {
                if (json.version === JSON_VERSION) {
                    config.time = trimPlayer.fromJson(json);
                    mapView.fromJson(json);
                    placeManager.fromJson(json);
                    chartView.fromJson(json);
                    fileManager.fromJson(json);
                } else {
                    alert(`Version ${json.version} of .json envirionment file not supported.`);
                }
            }
        } else {
            placeManager.fromJson();
            fileManager.fromJson();
        }
    }

    function onToJson() {
        const json = {
            comment: `This file can be viewed with ${window.location.origin}${window.location.pathname}`,
            version: JSON_VERSION,
        };
        trimPlayer.toJson(json, config.time);
        mapView.toJson(json);
        placeManager.toJson(json);
        chartView.toJson(json);
        fileManager.toJson(json);
        return json;
    }
    
    // Save & Restore 
    // ------------------------------------------------------------------------------------

    const params = new URLSearchParams(window.location.search);
    if (!fileManager.readUrl(params)) {
        if (!fileManager.readLocal()) {
            mapView.setCurrentPosition();
        }
    }

    window.onbeforeunload = function _unload() {
        fileManager.writeLocal();
    }
}
