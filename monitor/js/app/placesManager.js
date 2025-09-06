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

import { def, log } from '../core/utils.js';

export class PlacesManager {

    constructor(select, mapView) {
        this.#places = [];
        this.#select = select;
        this.#addOption(PlacesManager.PLACE_OVERVIEW);
        // add change event to select
        this.#select.addEventListener('change', (evt) => {
            this.change(evt.target.value);
        } );
        // add place selection by Ctrl Key
        this.#mapView = mapView;
        const map = mapView.map;
        if (map.selectArea) {
            // leaflet
            map.selectArea.enable();
            map.selectArea.setControlKey(true);
            map.on("selectarea:selected", (evt) => { 
                this.addFromBounds(evt.bounds);
            } );
            this.#layer = L.layerGroup();
            mapView.layerControl.addOverlay(this.#layer, PlacesManager.LAYER_PLACES);
        } else {
            // openlayers
            const dragBox = new ol.interaction.DragBox({
                condition: ol.events.condition.platformModifierKeyOnly
            });
            map.addInteraction(dragBox);
            dragBox.on('boxend', () => {
                const geom = dragBox.getGeometry();
                const extent = geom.getExtent(); 
                const extentLonLat = ol.proj.transformExtent(extent, 'EPSG:3857', 'EPSG:4326');
                //this.addFromBounds(extentLonLat);
            });
        }
    }

    // ===== Public API =====

    clear() {
        // remove the option and map marker
        log('PlacesManager clear');
        this.#places.forEach( (place) => {
            this.#layer.removeLayer(place.marker);
            this.#select.removeChild(place.option);
        });
        this.#places.length = 0;
    }

    addFromBounds(bounds) {
        const map = this.#mapView.map;
        const mapBounds = map.getBounds();
        if (mapBounds.contains(bounds)) {
            const center = bounds.getCenter();
            const name = prompt('Please name the place.', center.lat.toFixed(6) + ',' + center.lng.toFixed(6));
            if (name) {
                const sw = bounds.getSouthWest();
                const ne = bounds.getNorthEast();
                const zoom = map.getZoom();
                const swPx = map.project(sw, zoom);
                const nePx = map.project(ne, zoom);
                const w = parseInt(Math.abs(nePx.x - swPx.x));
                const h = parseInt(Math.abs(nePx.y - swPx.y));
                const place = { name, size: [ w, h ], bounds:this.#toBounds(bounds) };
                this.add(place);
            }
        }
    }

    add(place) {
        let bounds = place.bounds;
        if (!Array.isArray(bounds) &&
            Number.isFinite(place.zoom) &&
            Array.isArray(place.size) &&
            Array.isArray(place.center)
        ) {
            const zoom = place.zoom;
            const size = L.point(place.size);
            const center = L.latLng(place.center);
            const half = size.divideBy(2);
            const map = this.#mapView.map;
            const centerPx = map.project(center, zoom);
            const swPx = centerPx.subtract(half);
            const nePx = centerPx.add(half);
            const sw = map.unproject(swPx, zoom);
            const ne = map.unproject(nePx, zoom);
            bounds = [[sw.lat, sw.lng], [ne.lat, ne.lng]];
        }
        if (Array.isArray(bounds)) {
            log('PlacesManager add', place.name);
            const marker = L.rectangle(bounds, { className: 'place', dashArray: '5, 5', weight: 2 });
            marker.place = place;
            marker.on('click', (evt) => {
                const place = evt.target.place;
                const setIt = this.#select.value !== place.name;
                this.change(setIt ? place : undefined, evt.originalEvent.ctrlKey);
            });
            place.marker = marker;
            this.#layer.addLayer(marker);
            this.#places.push(place);
            this.#addOption(place.name, place);
        }
    }

    change(place, setSize = false) {
        let name;
        // convert the name to a place
        if (typeof place === 'string') {
            name = place;
            place = this.#places.find((place) => (place.name === name));
        }
        if (!def(place)) {
            name = PlacesManager.PLACE_OVERVIEW;
            log('PlacesManager change', name);
            this.#mapView.setOverview();
        } else {
            name = place.name;
            log('PlacesManager change', name);
            this.#mapView.setBounds(place.bounds, setSize ? place.size : undefined);
        }
        if (this.#select.value !== name) {
            this.#select.value = name;
        }
    }

    // ===== Save Restore API =====

    fromJson(json) {
        this.clear();
        if (json) {
            if (Array.isArray(json.places)) {
                json.places.forEach((place) => this.add( place ) );
            }
            this.change(json.place);
            const show = json.layers?.includes(PlacesManager.LAYER_PLACES);
            this.#mapView.setVisible(this.#layer, show);
        }
    }

    toJson(json) {
        json.places = [];
        this.#places.forEach((place) => {
            const jsonPlace = { name:place.name }
            def(place.bounds) && (jsonPlace.bounds = place.bounds);
            def(place.size)   && (jsonPlace.size   = place.size);
            def(place.center) && (jsonPlace.center = place.center);
            json.places.push(jsonPlace);
        } );
        json.place = this.#select.value;
        const layers = json.layers || [];
        if (this.#mapView.map.hasLayer(this.#layer)) {
            layers.push(PlacesManager.LAYER_PLACES);
        }
        json.layers = layers;
    }

    // ===== Internals =====
    
    #addOption(name, place) {
        const option = document.createElement('option');
        option.textContent = name;
        option.value = name;
        if (place) { 
            option.place = place;
            place.option = option;
        }
        this.#select.appendChild(option);
    }

    #toBounds(bounds) {
        if (Array.isArray(bounds)) return bounds;
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        return [[sw.lat, sw.lng], [ne.lat, ne.lng]];
    }

    static PLACE_OVERVIEW = 'Overview';
    static LAYER_PLACES   = "Places";

    #select
    #layer
    #places
    #mapView
}
