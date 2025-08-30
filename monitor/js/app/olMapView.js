// monitor/js/app/olMapView.js
/*
 * OpenLayers-backed MapView with the same external API as the Leaflet MapView.
 * 
 * Notes:
 * - Some Leaflet plugins used in your viewer (fullscreen control, area-select, google-mutant, built-in layer switcher UI)
 *   do not have direct OL core equivalents. Where functionality is missing, you'll find clear TODO/NOTE comments below.
 */

"use strict";

import { Track } from '../core/track.js';
import { def, setAlpha } from '../core/utils.js';

export class MapView {
    constructor(container, opacitySlider) {
        this.#container = container;
        container.classList.add('map-section'); // keep your CSS hook

        // --- Base layers (TileLayer) ---
        this.#baseLayers = MapView.#defaultBaseLayers();

        // --- Map & View ---
        const vectTrk  = this.#vectTrk  = new ol.layer.Vector({ zIndex: 10, updateWhileAnimating: true, updateWhileInteracting: true});
        const vectFix  = this.#vectFix  = new ol.layer.Vector({ zIndex: 20, updateWhileAnimating: true, updateWhileInteracting: true});
        const vectInfo = this.#vectInfo = new ol.layer.Vector({ zIndex: 30, updateWhileAnimating: true, updateWhileInteracting: true});
        const vectPt   = this.#vectPt   = new ol.layer.Vector({ zIndex: 40, updateWhileAnimating: true, updateWhileInteracting: true});
        let intr = ol.interaction.defaults.defaults({ onFocusOnly: true, mouseWheelZoom: false });
        let ctrl = ol.control.defaults.defaults({ attribution: false, zoom: true, rotate: true, });
        class toolbarCtrl extends ol.control.Control {
            constructor(opt_options) {
                const options = opt_options || {};
                // useful unicode icons ⏺◌◯☉⌖⬭⬬⬮⬯
                const btnPoint = document.createElement('div');
                btnPoint.className = 'overlay_button'
                btnPoint.innerHTML = feather.icons.crosshair.toSvg();
                btnPoint.title = "Current location marker";
                btnPoint.type = "button";
                const btnFix = document.createElement('button');
                btnFix.innerHTML = '⏺';
                btnFix.style.fontWeight = '400';
                btnFix.title = "Colored fix type markers";
                const btnTrack = document.createElement('button');
                btnTrack.innerHTML = '☡';
                btnTrack.title = "Ground track";
                btnTrack.type = "button";
                const btnInfo = document.createElement('button');
                btnInfo.innerHTML = 'ℹ';
                btnInfo.style.fontStyle = 'italic';
                btnInfo.style.fontWeight = '400';
                btnInfo.title = "Info Messages";
                const element = document.createElement('div');
                element.className = 'overlay_ctrl ol-options ol-control';
                element.appendChild(btnPoint);
                element.appendChild(btnFix);
                element.appendChild(btnTrack);
                element.appendChild(btnInfo);
                super({
                    element: element,
                    target: options.target,
                });
                btnPoint.addEventListener('click', this.showHideLayers.bind(this, vectPt), false);
                btnFix.addEventListener('click',   this.showHideLayers.bind(this, vectFix), false);
                btnTrack.addEventListener('click', this.showHideLayers.bind(this, vectTrk), false);
                btnInfo.addEventListener('click',  this.showHideLayers.bind(this, vectInfo), false);
            }
            showHideLayers(layer) { layer.setOpacity( ( layer.getOpacity() == 0) ? 1 : 0 ); }
        }
        const overviewMap = new ol.control.OverviewMap({
            collapseLabel: '\u00AB',
            layers: [ new ol.layer.Tile(  { source: new ol.source.OSM() } )],
            expandFactor: 8,
            label: '\u00BB',
            collapsed: true,
            rotation: Math.PI / 6,
        });
        const scaleLine = new ol.control.ScaleLine({ units: 'metric', minWidth: 100 })
        let layers = Object.values(this.#baseLayers);
        layers.push(...[vectPt, vectFix, vectTrk, vectInfo]);
        ctrl.extend([ new toolbarCtrl(), scaleLine, overviewMap, new ol.control.FullScreen() ]);
        const view = new ol.View({
            center: ol.proj.fromLonLat([8.3, 47.4]), // CH-ish default
            zoom: 10,
            maxZoom: 27,
        });
        let opt = { 
            controls: ctrl, 
            interactions: intr, 
            layers: layers, 
            target: container, 
            view: view 
        };
        const map = this.map = new ol.Map(opt);
        map.getView().on('change:resolution', function _onZoomed(event){
            var zLevel = this.getZoom();     
            if (zLevel >= 20 && overviewMap.getCollapsed()) {
                overviewMap.setCollapsed(false);
            } else if (zLevel < 15 && !overviewMap.getCollapsed()) {
                overviewMap.setCollapsed(true);
            } 
        });
        
        // Ensure only the first base layer is visible by default
        let first = true;
        Object.values(this.#baseLayers).forEach((lyr) => {
            lyr.setVisible(first);
            first = false;
        });

        // --- Layer control UI ---
        // NOTE: OL core does not ship a layer switcher UI like Leaflet. 
        // You can add a small custom control or plug-in (e.g., ol-layerswitcher).
        // For now, we keep programmatic control and store the mapping for fromJson/toJson.
        this.layerControl = { /* placeholder for symmetry */ };

        // --- Coordinates readout (custom control) ---
        this.#divInfo = document.createElement('div');
        this.#divInfo.className = 'ol-control ol-unselectable'; // reuse your CSS when possible
        this.#divInfo.style.display = 'none';
        this.#divInfo.style.maxWidth = '300px';

        const coordsWrapper = document.createElement('div');
        coordsWrapper.className = 'ol-control ol-custom-coords';
        coordsWrapper.style.position = 'absolute';
        //coordsWrapper.style.right = '0.5em';
        coordsWrapper.style.top = '0.5em';
        coordsWrapper.appendChild(this.#divInfo);
        container.appendChild(coordsWrapper);

        this.map.on('pointermove', (evt) => {
            if (evt.dragging) return;
            const lonlat = ol.proj.toLonLat(evt.coordinate);
            const lat = Number(lonlat[1].toFixed(5));
            const lng = Number(lonlat[0].toFixed(5));
            const pixel = this.map.getPixelFromCoordinate(evt.coordinate);
            const x = Math.round(pixel[0]);
            const y = Math.round(pixel[1]);
            this.#divInfo.innerHTML = `Lat: ${lat}, y: ${y}<br>Lng: ${lng} x: ${x}`;
            this.#divInfo.style.display = 'block';
        });
        container.addEventListener('mouseleave', () => this.updateLegend());

        // --- Opacity slider for base tiles (invert like your Leaflet) ---
        this.#opacitySlider = opacitySlider;
        opacitySlider.addEventListener('input', (evt) => this.setOpacity(evt.target.value));
        this.setOpacity(opacitySlider.value);

        // --- Resize handling ---
        this.resizeObserver = new ResizeObserver(() => this.map.updateSize());
        this.resizeObserver.observe(container);

        // --- Vector layer store & legend ---
        this.updateLegend();

        // --- NOTES on plugins parity ---
        // - Fullscreen: OL has no core fullscreen control (use a small custom button or a plugin; TODO if desired)
        // - Area select: use DragBox interaction if you want Shift+drag box-zoom; OL has it but not enabled by default. TODO if desired.
        // - GoogleMutant: Not available in OL (would require Google Maps JS + custom sync). Leaving out by design.
    }

    // ===== Public API (mirrors Leaflet MapView) =====

    setVisible(layer, show) {
        // In this OL version, “layer” is an ol/layer/... instance stored on track.layer
        if (layer && layer.setVisible) layer.setVisible(!!show);
    }

    setBounds(bounds, size) {
        // bounds: [[minLat, minLng], [maxLat, maxLng]]  (Leaflet-style)
        // size: [w, h] in px (optional)
        const container = this.#container;

        const setSize = Array.isArray(size) && size.length === 2;
        const wh = setSize ? size.map((v) => `${v}px`) : ['', ''];
        container.style.display = 'block';
        if ((container.style.width !== wh[0]) || (container.style.height !== wh[1])) {
            container.style.width = wh[0];
            container.style.height = wh[1];
            this.map.updateSize();
        }
        if (Array.isArray(bounds) && bounds.length === 2 &&
            (bounds[0][0] < bounds[1][0]) && (bounds[0][1] < bounds[1][1])) {
            const minLat = bounds[0][0], minLng = bounds[0][1];
            const maxLat = bounds[1][0], maxLng = bounds[1][1];
            const extentLL = [
                minLng, minLat,   // [minX (lon), minY (lat)]
                maxLng, maxLat
            ];
            // Transform extent to view projection (EPSG:3857)
            const min = ol.proj.fromLonLat([extentLL[0], extentLL[1]]);
            const max = ol.proj.fromLonLat([extentLL[2], extentLL[3]]);
            const extent = [min[0], min[1], max[0], max[1]];
            this.map.getView().fit(extent, { duration: 0, padding: [10, 10, 10, 10] });
        }
    }

    setOverview() {
        // Aggregate bounds of all track layers (like your Leaflet version)
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;

        this.map.getLayers().forEach((lyr) => {
            const track = lyr?.track;
            if (!track) return;
            const posBounds = track.boundsPos?.();
            if (!posBounds) return;
            minLat = Math.min(minLat, posBounds[0][0]);
            maxLat = Math.max(maxLat, posBounds[1][0]);
            minLng = Math.min(minLng, posBounds[0][1]);
            maxLng = Math.max(maxLng, posBounds[1][1]);
        });

        if ((minLat < maxLat) && (minLng < maxLng)) {
            this.setBounds([[minLat, minLng], [maxLat, maxLng]]);
        }
    }

    setOpacity(opacity) {
        // Your Leaflet code sets tile-pane opacity to (1 - sliderValue)
        const tileOpacity = 1 - parseFloat(opacity || 0);
        Object.values(this.#baseLayers).forEach((lyr) => {
            if (lyr instanceof ol.layer.Tile) lyr.setOpacity(tileOpacity);
        });
    }

    popUp(center, epoch, labelNode) {
        this.#emit('epoch', epoch);

        const container = document.createElement('div');
        container.className = "ol-popup";
        if (labelNode) container.appendChild(labelNode);
        container.appendChild(epoch.tableHtml(Track.EPOCH_FIELDS));
        if (this.#popup) {
            this.map.removeOverlay(this.#popup);
        }
        this.#popup = new ol.Overlay({
            element: container,
            offset: [0, -10],
            positioning: 'bottom-center',
            stopEvent: true
        });
        this.map.addOverlay(this.#popup);
        this.#popup.setPosition(ol.proj.fromLonLat([center[1], center[0]])); // [lon,lat] → 3857
    }

    flyTo(datetime, pan = true) {
        const map = this.map;
        let center;    // [lat, lng]
        let refCenter; // [lat, lng]

        this.map.getLayers().forEach((lyr) => {
            const track = lyr?.track;
            if (!track) return;
            const epoch = track?.epochs
                .filter((e) => (e.timeValid && e.posValid))
                .reduce((prev, curr) => {
                        const prevDiff = Math.abs(new Date(prev.datetime) - datetime);
                        const currDiff = Math.abs(new Date(curr.datetime) - datetime);
                        return currDiff < prevDiff ? curr : prev;
                    });
            if (!epoch) {
                // remove crosshair if it exists
                if (lyr.crossHair) {
                    lyr.getSource().removeFeature(lyr.crossHair);
                    delete lyr.crossHair;
                }
                return;
            }

            const lat = epoch.fields.lat, lng = epoch.fields.lng;
            center = [lat, lng];
            if (track.name === Track.TRACK_REFERENCE) refCenter = center;
            if (!def(lyr.crossHair)) {
                const f = new ol.Feature(new ol.geom.Point(ol.proj.fromLonLat([lng, lat])));
                const svg = feather.icons['crosshair'].toSvg({ stroke: setAlpha(track.color, 0.9) });
                const svgUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
                f.setStyle(new ol.style.Style({
                    image: new ol.style.Icon({ src: svgUrl, anchor: [0.5, 0.5], anchorXUnits: 'fraction', anchorYUnits: 'fraction', scale: 1 }),
                    zIndex: 40
                }));
                lyr.getSource().addFeature(f);
                lyr.crossHair = f;
            } else {
                lyr.crossHair.getGeometry().setCoordinates(ol.proj.fromLonLat([lng, lat]));
            }
        });

        const target = refCenter || center;
        if (target) {
            const view = map.getView();
            const zoom = Math.max(19, view.getZoom() || 19);
            const coord = ol.proj.fromLonLat([target[1], target[0]]);
            if (pan) {
                view.animate({ center: coord, duration: 150 });
            } else {
                view.setCenter(coord);
            }
            if ((view.getZoom() ?? 0) < zoom) view.setZoom(zoom);
        }
    }

    setCurrentPosition() {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition((pos) => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            this.map.getView().setCenter(ol.proj.fromLonLat([lng, lat]));
            this.map.getView().setZoom(14);
            this.#container.style.display = 'block';
        }, (err) => { }, { timeout: 1000 });
    }

    addLayer(track) {
        // Equivalent to your Leaflet addLayer: renders polyline segments and optional point markers & info markers.
        const addMarkers = (track.mode === Track.MODE_MARKERS);
        const addInfos = (track.mode === Track.MODE_MARKERS) || (track.mode === Track.MODE_ANYFIX);

        const vsrc = new ol.source.Vector();
        const vlyr = new ol.layer.Vector({
            source: vsrc,
            style: null, // per-feature styles below
            visible: true,
            updateWhileAnimating: true,
            updateWhileInteracting: true,
            enderBuffer: 256
        });

        // Store backrefs to mimic Leaflet usage
        vlyr.track = track;
        track.layer = vlyr;

        // State during iteration
        let infos = [];
        let trackCoords = []; // array of [lon,lat] (note order!)
        let infoCenter;       // [lon,lat]
        let fixLost;

        const svg = feather.icons['message-square'].toSvg({
            fill: setAlpha(track.color, 0.3),
            stroke: setAlpha(track.color, 0.9)
        });
        const svgUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
        const msgStyle = new ol.style.Style({
            image: new ol.style.Icon({ src: svgUrl, anchor: [0.1, 1], anchorXUnits: 'fraction', anchorYUnits: 'fraction', scale: 1 }),
            zIndex: 30
        });
        const segStyle = new ol.style.Style({
            stroke: new ol.style.Stroke({ color: setAlpha(track.color, 0.6), width: 2 }),
            zIndex: 20
        })

        const pushSegment = () => {
            if (trackCoords.length < 2) { trackCoords = []; return; }
            const ls = new ol.geom.LineString(trackCoords.map(c => ol.proj.fromLonLat(c)));
            const f = new ol.Feature(ls);
            f.setStyle(segStyle);
            vsrc.addFeature(f);
            trackCoords = [];
        };

        const addInfoMarker = (centerLonLat, infosArr) => {
            const f = new ol.Feature(new ol.geom.Point(ol.proj.fromLonLat(centerLonLat)));
            f.setStyle(msgStyle);
            f.set('infoHtml', track.infosHtml(infosArr));
            vsrc.addFeature(f);
        };

        const addPointMarker = (centerLonLat, color) => {
            const f = new ol.Feature(new ol.geom.Point(ol.proj.fromLonLat(centerLonLat)));
            f.setStyle(new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 3,
                    fill: new ol.style.Fill({ color }),
                    stroke: new ol.style.Stroke({ color, width: 1 })
                }),
                zIndex: 10
            }));
            // Hover radius bump (we'll simulate via pointermove + hit detect if needed)
            vsrc.addFeature(f);
            return f;
        };

        // Build features from epochs
        track.epochs
            .filter((e) => e.selTime)
            .forEach((epoch) => {
                if (addInfos && !epoch.fixGood && (fixLost === false)) {
                    infos.push('Fix lost');
                    fixLost = true;
                }
                // publish messages at last known infoCenter
                if (infoCenter && infos.length > 0) {
                    infos = infos.filter((v, i, a) => a.indexOf(v) === i); // unique
                    addInfoMarker(infoCenter, infos);
                    infos = [];
                    infoCenter = undefined;
                }
                if (addInfos && epoch.posValid && epoch.fixGood) {
                    if (fixLost === true) infos.push('Fix recovered');
                    fixLost = false;
                }
                if (epoch.info?.length) {
                    infos = infos.concat(epoch.info);
                }
                if (epoch.posValid) {
                    const lat = epoch.fields.lat, lng = epoch.fields.lng;
                    const lonlat = [lng, lat]; // IMPORTANT: [lon,lat]
                    if ((track.mode === Track.MODE_ANYFIX) ? epoch.fixValid : epoch.fixGood) {
                        trackCoords.push(lonlat);
                        if (addMarkers) {
                            const pointF = addPointMarker(lonlat, epoch.color);
                            // Click → popup mirroring Leaflet
                            pointF.set('epoch', epoch);
                            pointF.set('trackNameNode', track.nameHtml());
                        }
                        infoCenter = lonlat;
                    } else if (trackCoords.length > 0) {
                        pushSegment(); // gap the polyline
                    }
                }
            });
        if (infoCenter && infos.length > 0) addInfoMarker(infoCenter, infos);
        pushSegment(); // last segment

        this.map.addLayer(vlyr);
        this.updateLegend();

        // Click handling for epoch popups
        this.map.on('singleclick', (evt) => {
            const pixel = evt.pixel;
            this.map.forEachFeatureAtPixel(pixel, (feature, layer) => {
                if (layer !== vlyr) return;
                const epoch = feature.get('epoch');
                const nameNode = feature.get('trackNameNode');
                if (epoch && nameNode) {
                    const lat = epoch.fields.lat, lng = epoch.fields.lng;
                    this.popUp([lat, lng], epoch, nameNode);
                    return true;
                }
            });
        });
    }

    removeLayer(track) {
        if (track.layer) {
            this.map.removeLayer(track.layer);
            delete track.layer;
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
        // Keep showing coords on move; when leaving, show legend of tracks
        if (!div) return;
        while (div.firstChild) div.removeChild(div.lastChild);

        this.map.getLayers().forEach((lyr) => {
            const track = lyr?.track;
            if (track) {
                div.appendChild(track.nameHtml('div'));
            }
        });
        div.style.display = (div.childNodes.length > 0) ? 'block' : 'none';
    }

    // ===== Save/Restore =====

    fromJson(json) {
        // Toggle base layers matching saved names
        const wanted = new Set(json.layers || []);
        Object.entries(this.#baseLayers).forEach(([name, layer]) => {
            layer.setVisible(wanted.has(name));
        });
        this.#opacitySlider.value = json.opacity ?? this.#opacitySlider.value;
        this.setOpacity(this.#opacitySlider.value);
    }

    toJson(json) {
        const layers = [];
        Object.entries(this.#baseLayers).forEach(([name, layer]) => {
            if (layer.getVisible()) layers.push(name);
        });
        if (layers.length >= 0) json.layers = layers;
        json.opacity = this.#opacitySlider.value;
    }

    // ===== Internals =====

    static #defaultBaseLayers() {
        const base = {};
        // ESRI World Imagery
        base["ESRI World Imagery"] = new ol.layer.Tile({
            source: new ol.source.XYZ({ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 19 }),
            visible: true, updateWhileAnimating: true, updateWhileInteracting: true, preload: Infinity
        });
        // Stadia Satellite (public tiles)
        base["Stadia Satellite"] = new ol.layer.Tile({
            source: new ol.source.XYZ({ url: 'https://tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}{r}.jpg', maxZoom: 20 }),
            visible: false, updateWhileAnimating: true, updateWhileInteracting: true, preload: Infinity
        });
        // Swisstopo
        base["Swisstopo Satellite"] = new ol.layer.Tile({
            source: new ol.source.XYZ({ url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg', maxZoom: 20 }),
            visible: false, updateWhileAnimating: true, updateWhileInteracting: true, preload: Infinity
        });
        base["Swisstopo Color"] = new ol.layer.Tile({
            source: new ol.source.XYZ({ url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg', maxZoom: 18 }),
            visible: false, updateWhileAnimating: true, updateWhileInteracting: true, preload: Infinity
        });
        base["Swisstopo Gray"] = new ol.layer.Tile({
            source: new ol.source.XYZ({ url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg', maxZoom: 18 }),
            visible: false, updateWhileAnimating: true, updateWhileInteracting: true, preload: Infinity
        });
        // OSM Street
        base["OSM Street"] = new ol.layer.Tile({ source: new ol.source.OSM({ maxZoom: 19 }), visible: false});
        return base;
    }

    #emit(name, detail) {
        this.#container.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
    }
    
    #container
    #opacitySlider
    #divInfo
    #baseLayers
    #popup
    #vectPt  
    #vectTrk 
    #vectFix 
    #vectInfo
}