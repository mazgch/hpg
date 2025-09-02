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

import { Track } from '../core/track.js';
import { def, setAlpha, log, formatDateTime } from '../core/utils.js';

export class MapView {
    constructor(container, opacitySlider) {
        this.#container = container;
        container.style.display = 'block';
        container.className = "map-section";
        // map
        const map = L.map(container, {
            preferCanvas: true, attributionControl: false, fullscreenControl: true, 
            zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false,
            zoomControl: true, zoomSnap: 0.1, wheelPxPerZoomLevel: 20, boxZoom: true
        });
        this.map = map;
        // resizing
        this.resizeObserver = new ResizeObserver(() => {
            map.invalidateSize();
        });
        this.resizeObserver.observe(container);
        // controls 
        L.control.scale().addTo(map);
        this.#baseLayers = MapView.#defaultBaseLayers();
        Object.values(this.#baseLayers)[0].addTo(map);
        this.layerControl = L.control.layers(this.#baseLayers).addTo(map);
        /*
        const coordControl = L.control({ position: 'bottomright' });
        this.#divInfo = L.DomUtil.create('div', 'leaflet-control-coords leaflet-bar');
        coordControl.onAdd = () => { return this.#divInfo; };
        coordControl.addTo(map);
        map.on('mousemove', (evt) => this.#updateCoords(evt));
        container.addEventListener('mouseleave', (evt) => this.updateLegend());
        */
        const screenshoter = L.simpleMapScreenshoter({
            hideElementsWithSelectors: ['.leaflet-control-container'], // hide controls
            cropImageByInnerWH: true,           // use map inner size
            mimeType: 'image/png',              // exported type
            caption: null,                      // or {text:'My Map', font:'14px sans-serif', fillStyle:'#000'}
            preventDownload: false              // set true if you want to handle the blob yourself
        }).addTo(map);

        // opacity 
        this.#opacitySlider = opacitySlider;
        opacitySlider.addEventListener('input', (evt) => {
            this.setOpacity(evt.target.value);
        });
        this.setOpacity(opacitySlider.value);
        // layers
        this.updateLegend();
    }

    // ===== Public API =====

    setVisible(layer, show) {
        const isVisible = this.map.hasLayer(layer);
        (isVisible && !show) && this.map.removeLayer(layer);
        (!isVisible && show) && this.map.addLayer(layer);
    }

    setBounds(bounds, size) {
        const container = this.#container;
        const map = this.map;
        const setSize = Array.isArray(size) && (2 === size.length);
        const wh = setSize ? size.map((v) => (v + 'px')) : ['', ''];
        container.style.display = 'block';
        if ((container.style.width != wh[0]) || (container.style.height != wh[1])) {
            container.style.width = wh[0];
            container.style.height = wh[1];
            map.invalidateSize(); // Call after changing size
        }
        if (Array.isArray(bounds) && (2 === bounds.length) &&
            (bounds[0][0] < bounds[1][0]) && (bounds[0][1] < bounds[1][1])) {
            const padding = setSize ? [0, 0] : [10, 10];
            this.map.fitBounds(bounds, { animate: false, padding: padding });
        }
    }

    setOverview() {
        // now we get new bounds
        let minLat = Infinity;
        let maxLat = -Infinity;
        let minLng = Infinity;
        let maxLng = -Infinity;
        // propagate bounds to the config
        this.map.eachLayer(layer => {
            const track = layer.track;
            if (track) {
                const posBounds = track.boundsPos();
                minLat = Math.min(minLat, posBounds[0][0]);
                maxLat = Math.max(maxLat, posBounds[1][0]);
                minLng = Math.min(minLng, posBounds[0][1]);
                maxLng = Math.max(maxLng, posBounds[1][1]);
            }
        });
        if ((minLat < minLng) || (minLng < maxLng)) {
            const posBounds = [[minLat, minLng], [maxLat, maxLng]];
            this.setBounds(posBounds);
        }
    }

    setOpacity(opacity) {
        const panes = document.getElementsByClassName('leaflet-tile-pane');
        for (let i = 0; i < panes.length; i++) {
            panes[i].style.opacity = 1 - opacity;
        }
    }

    flyTo(pan = true) {
        const map = this.map;
        const latlngs = [];
        map.eachLayer((layer) => {
            const track = layer.track;
            let epoch;
            // how to handle loading tracks
            if (track && !def(track.progress) && (track.mode !== Track.MODE_HIDDEN)) {
                epoch = track.currentEpoch;
            }
            if (epoch) {
                const center = [epoch.fields.lat, epoch.fields.lng];
                latlngs.push(center);
                if (!def(track.crossHair)) {
                    const svgIcon = feather.icons.crosshair.toSvg({ stroke: track.color, 'stroke-width': 2, });
                    const divIcon = L.divIcon({ html: svgIcon, className: '', iconSize: [24, 24], iconAnchor: [12, 12] });
                    track.crossHair = L.marker(center, { icon: divIcon, interactive: false });
                    layer.addLayer(track.crossHair);
                } else {
                    // reuse
                    track.crossHair.setLatLng(center);
                }
            } else if (track?.crossHair) {
                layer.removeLayer(track.crossHair);
                delete track.crossHair;
            }
        })
        const curBounds = this.#getBounds();
        if (0 < latlngs.length) {
            const reqBounds = L.latLngBounds(latlngs).pad(0.2);
            const maxZoom = curBounds ? Math.max(19, map.getZoom()) : 19;
            if (curBounds?.contains(reqBounds)) {
                const center = reqBounds.getCenter();
                (pan ? map.panTo(center, maxZoom) : map.setView(center, maxZoom ));
            } else {
                map.fitBounds(reqBounds, { animate: pan, maxZoom: maxZoom });
            }
        }
    }

    setCurrentPosition() {
        if (navigator.geolocation && this.map) {
            navigator.geolocation.getCurrentPosition((position) => {
                this.map.setView([position.coords.latitude, position.coords.longitude], 14, { animate: false })
                this.#container.style.display = 'block';
            },
                (err) => { },
                { timeout: 1000 } // Timeout in ms
            );
        }
    }

    addLayer(track) {
        const addInfos = (track.mode === Track.MODE_MARKERS);
        const addMarkers = (track.mode === Track.MODE_MARKERS) || (track.mode === Track.MODE_ANYFIX);
        // collect an array of cordinates and information for markers
        let infos = [];
        let trackCoords = [];
        let infoCenter;
        let fixLost;
        // we have to use an SVG renderer to capture images of our map overlays (we will not use for palces)
        const svgRenderer = L.svg( { padding: 0.5 } ); 
        const layer = L.layerGroup( {renderer: svgRenderer } );
        log('MapView add', track.name);
        track.epochs
            .forEach((epoch) => {
                // if we are loosing the fix with this epoch 
                if (addInfos && !epoch.fixGood && epoch.selTime && (fixLost === false)) {
                    infos.push('Fix lost');
                    fixLost = true;
                }
                // publish messages if we have a location from before 
                if (infoCenter && (0 < infos.length)) {
                    // remove any later duplicates 
                    infos.filter((item, index) => infos.indexOf(item) === index);
                    // add the marker to the layer 
                    layer.addLayer(_message(infoCenter, infos, track));
                    infos = [];
                    infoCenter = undefined;
                }
                // if we are reacquiring a good fix 
                if (addInfos && epoch.posValid && epoch.fixGood && epoch.selTime) {
                    if (fixLost === true) {
                        infos.push('Fix recovered');
                    }
                    fixLost = false;
                }
                // now concatenate the strings 
                if (epoch.info?.length) {
                    infos = infos.concat(epoch.info);
                }
                // populate the the coordinates for the polyline
                if (epoch.posValid && epoch.selTime && ((track.mode === Track.MODE_ANYFIX) ? epoch.fixValid : epoch.fixGood)) {
                    const center = [epoch.fields.lat, epoch.fields.lng];
                    trackCoords.push(center);
                    if (addMarkers) {
                        // the dot marker 
                        const marker = L.circleMarker(center, {
                            renderer: svgRenderer,
                            className: 'marker', color: epoch.color, fillColor: epoch.color,
                            radius: 3, weight: 1, opacity: 1, fillOpacity: 0.8
                        } );
                        marker.epoch = epoch;
                        marker.bindTooltip(() => _toolTip(track, epoch), { } );
                        marker.on('mouseover', (evt) => evt.target.setRadius(5));
                        marker.on('mouseout', (evt) => evt.target.setRadius(3));
                        marker.on('click', (evt) => this.#emit('epoch', evt.target.epoch));
                        layer.addLayer(marker);
                    }
                    infoCenter = center;
                } else if (0 < trackCoords.length) {
                    // create segments with gaps
                    layer.addLayer(_polyline(trackCoords));
                    trackCoords = [];
                }
            })
        // add the last text marker
        if (infoCenter && (0 < infos.length)) {
            layer.addLayer(_message(infoCenter, infos, track));
        }
        layer.addLayer(_polyline(trackCoords));
        layer.addTo(this.map);
        layer.track = track;
        track.layer = layer;
        this.updateLegend();
        const bounds = this.#getBounds();
        if (!bounds) {
            this.setOverview();
        }

        function _polyline(trackCoords) {
            const polyline = L.polyline(trackCoords, {
                renderer: svgRenderer,
                interactive: false,
                className: 'polyline', color: track.color, opacity: 0.6, weight: 2
            } );
            return polyline;
        }

        function _message(center, infos, track) {
            const svgIcon = feather.icons['message-square'].toSvg({ fill: setAlpha(track.color, 0.3), stroke: setAlpha(track.color, 0.9) });
            const divIcon = L.divIcon({ html: svgIcon, className: '', iconSize: [20, 20], iconAnchor: [2, 22] });
            const marker = L.marker(center, { renderer: svgRenderer, icon: divIcon, riseOnHover: true, });
            marker.bindTooltip(track.infosHtml(infos), { direction: 'bottom', });
            return marker;
        }

        function _toolTip(track, epoch) {
            const div = document.createElement('div');
            div.appendChild(track.nameHtml());
            const lat = epoch.fields.lat;
            const lng = epoch.fields.lng;
            const time = formatDateTime(epoch.datetime);
            const divLat = document.createElement('div');
            divLat.textContent = `Latitude: ${lat}`;
            div.appendChild(divLat);
            const divLon = document.createElement('div');
            divLon.textContent = `Longitude: ${lng}`;
            div.appendChild(divLon);
            const divTime = document.createElement('div');
            divTime.textContent = `Time UTC: ${time}`;
            div.appendChild(divTime);
            return div; 
        }   
    }

    removeLayer(track) {
        const layer = track.layer;
        if (layer) {
            log('MapView remove',track.name);
            if (track.crossHair) {
                layer.removeLayer(track.crossHair);
                delete track.crossHair;
            }
            this.map.removeLayer(layer);
            delete track.layer;
            this.updateLegend();
        }
    }

    updateLayer(track) {
        this.removeLayer(track);
        if (track.mode !== Track.MODE_HIDDEN) {
         this.addLayer(track);
        }
        this.updateLegend();
    }

    updateLegend() {
        const div = this.#divInfo;
        if (div) {
            while (div.firstChild) {
                div.removeChild(div.lastChild);
            }
            this.map.eachLayer((layer) => {
                const track = layer.track;
                if (track) {
                    div.appendChild(track.nameHtml('div'));
                }
            });
            div.style.maxWidth = '300px'
            div.style.display = (0 < div.childNodes.length) ? 'block' : 'none';
        }
    }

    // ===== Save Restore API =====

    fromJson(json) {
        if (Array.isArray(json.layers)) {
            Object.entries(this.#baseLayers).forEach(([name, layer]) => {
                this.setVisible(layer, json.layers.includes(name));
            });
        }
        this.#opacitySlider.value = json.opacity;
    }

    toJson(json) {
        const layers = [];
        Object.entries(this.#baseLayers).forEach(([name, layer]) => {
            this.map.hasLayer(layer) && layers.push(name);
        });
        (0 <= layers.length) && (json.layers = layers);
        json.opacity = this.#opacitySlider.value;
    }

    // ===== Internals =====
    
    #updateCoords(evt) {
        const div = this.#divInfo;
        if (div) {
            const lat = Number(evt.latlng.lat.toFixed(5));
            const lng = Number(evt.latlng.lng.toFixed(5));
            const pt = evt.containerPoint;
            const x = Math.round(pt.x);
            const y = Math.round(pt.y);
            div.innerHTML = `Lat: ${lat}, y: ${y}<br>Lng: ${lng} x: ${x} `;
            div.style.display = 'block';
        }
    }

    static #defaultBaseLayers() {
        const arcGisHost = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
        const arcGisTile = '/MapServer/tile/{z}/{y}/{x}';
        const esriSatellite = L.tileLayer(arcGisHost + 'World_Imagery' + arcGisTile,
            { maxZoom: 24, maxNativeZoom: 19 });
        const stadiaHost = 'https://tiles.stadiamaps.com/tiles/'
        const stadiaTile = '/{z}/{x}/{y}{r}.{ext}';
        const stadiaSatellite = L.tileLayer(stadiaHost + 'alidade_satellite' + stadiaTile,
            { maxZoom: 24, maxNativeZoom: 20, ext: 'jpg' });
        const swissTopoHost = 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.';
        const swissTopoTile = '/default/current/3857/{z}/{x}/{y}.jpeg';
        const swisstopoBounds = [[45.398181, 5.140242], [48.230651, 11.47757]];
        const swisstopoSatellite = L.tileLayer(swissTopoHost + 'swissimage' + swissTopoTile,
            { maxZoom: 24, maxNativeZoom: 20, minNativeZoom: 8, bounds: swisstopoBounds });
        const swisstopoColor = L.tileLayer(swissTopoHost + 'pixelkarte-farbe' + swissTopoTile,
            { maxZoom: 24, maxNativeZoom: 18, minNativeZoom: 8, bounds: swisstopoBounds });
        const swisstopoGray = L.tileLayer(swissTopoHost + 'pixelkarte-grau' + swissTopoTile,
            { maxZoom: 24, maxNativeZoom: 18, minNativeZoom: 8, bounds: swisstopoBounds });
        const osmStreet = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            { maxZoom: 24, maxNativeZoom: 19 });
        const baseLayers = {
            "ESRI World Imagery": esriSatellite, "Stadia Satellite": stadiaSatellite,
            "Swisstopo Satellite": swisstopoSatellite, "Swisstopo Color": swisstopoColor, "Swisstopo Gray": swisstopoGray,
            "OSM Street": osmStreet
        };
        if (window.google?.maps) {
            const googleRoadmap = L.gridLayer.googleMutant({ type: 'roadmap', maxZoom: 24 });
            const googleSatellite = L.gridLayer.googleMutant({ type: 'satellite', maxZoom: 24 });
            const googleHhybrid = L.gridLayer.googleMutant({ type: 'hybrid', maxZoom: 24 });
            baseLayers['Google Roadmap'] = googleRoadmap;
            baseLayers['Google Satellite'] = googleSatellite;
            baseLayers['Google Hybrid'] = googleHhybrid
        }
        return baseLayers;
    }

    #getBounds() {
        try { 
            return this.map.getBounds(); 
        } catch (err) {
            //console.error('MapView getBounds', err);
        }
    }


    #emit(name, detail) {
        this.#container.dispatchEvent(new CustomEvent(name, { detail }));
    }

    #container
    #opacitySlider
    #divInfo
    #baseLayers
}