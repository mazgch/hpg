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

import { Track } from '../core/track.js'
import { def, log, bytesToString, isGzip } from '../core/utils.js';

export class FileManager {
    constructor(opts = {}) {
        this.tracks = [];
        this.#container = opts.container;
        
        this.onFromJson = opts.onFromJson;
        this.onToJson = opts.onToJson;

        if (!this.#container) throw new Error("FileManager requires a container");
        this.#renderShell();
    }

    // ===== Public API Config =====

    readUrl(params) {
        if (0 < params.size) {
            params.forEach((url, name) => {
                if (url) {
                    if (url.match(/json(\.gz)?$/i)) {
                        fetch(url)
                            .then((response) => response.bytes())
                            .then((bytes) => {
                                if (isGzip(bytes)) {
                                    bytes = pako.ungzip(bytes);
                                }
                                const json = bytesToString(bytes);
                                this.onFromJson(json);
                            })
                            .catch((err) => console.error('FileManager readUrl', name, err));
                    } else if (url.match(/ubx(\.gz)?$/i)) {
                        const track = new Track(name, Track.EPOCH_FIELDS, { url: url });
                        this.tracks.push(track);
                        track.fetchUrl(url, (cnt,size,gzsize) => this.progress(track, cnt, size, gzsize))
                            .then(() => { 
                                this.add(track) 
                            })
                            .catch((err) => console.error('FileManager readUrl', name, err));
                    }
                }
            });
            return true;
        } else {
            return false;
        }
    }
    
    readFiles(files) {
        Array.from(files).forEach(file => {
            if (file.name.match(/json(\.gz)?$/i)) {
                const reader = new FileReader();
                reader.onload = (evt) => {
                    let bytes = new Uint8Array(evt.target.result)
                    if (isGzip(bytes)) {
                        bytes = pako.ungzip(bytes);
                    }
                    const json = bytesToString(bytes);
                    this.onFromJson(json);
                };
                reader.readAsArrayBuffer(file);
            } else {
                const m = file.name.match(/(?:.*\/)?([^.]+).*$/);
                const name = m ? m[1] : file.name;
                const track = new Track(name, Track.EPOCH_FIELDS, { file: file.name });
                this.tracks.push(track);
                track.readFile(file, (cnt,size,gzsize) => this.progress(track, cnt, size, gzsize))
                    .then((track) => { 
                        this.add(track); 
                    })
                    .catch((err) => console.error('FileManager readFiles', name, err));
            }
        });
    }

    // ===== Public API Download =====

    downloadJson(doGzip) {
        const json = this.onToJson();
        let data = JSON.stringify(json, null, doGzip ? 0 : 1);
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

    // ===== Public API Local Storage =====

    readLocal() {
        try {
            const b64 = localStorage.getItem('json.gz');
            const binary = atob(b64);
            const bytes = pako.ungzip(binary);
            const json = bytesToString(bytes);
            this.onFromJson(json);
            return true;
        } catch (err) {
            console.error(err);
            return false;
        }
    }

    writeLocal() {
        try {
            const json = this.onToJson();
            const jsonTxt = JSON.stringify(json);
            const bytes = pako.gzip(jsonTxt);
            const txt = bytesToString(bytes);
            const b64 = btoa(txt);
            localStorage.setItem('json.gz', b64);
        } catch (err) {
            console.error(err);
        }
    }

    // ===== Public API Tracks =====

    clear() {
        log('FileManager clear');
        this.tracks.forEach((track, ix) => {
            this.#emit('remove', track);
        });
        delete this.refTrack;
        this.tracks.length = 0;
        this.#renderChips();
    }

    async progress(track, cnt, size, infCnt) { 
        this.#renderChips();
        log("FileManager progress", track.name, track.progress || 'done', [ cnt, size, infCnt] );
        return new Promise((resolve) => {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => resolve());
            } else {
                Promise.resolve().then(resolve);
            }
        });
    }

    add(track) {
       log('FileManager add', track.name);
        // update reference errors and indicate changes of tracks 
        if (track.name === Track.TRACK_REFERENCE) {
            this.refTrack = track;
            this.tracks.forEach((trk) => {
                trk.calcRefError(track /* = reference */ );
                this.#emit('update', trk );
            });
        } else if(this.refTrack) {
            track.calcRefError(this.refTrack);
        }
        // finally add it
        this.#renderChips();
        this.#emit('add', track);
    }
    
    update(track) {
        let refChange;
        log('FileManager update', track.name);
        if ((track.name === Track.TRACK_REFERENCE) && (track !== this.refTrack)) {
            this.refTrack = track;
            refChange = true;
        } else if (track === this.refTrack) {
            delete this.refTrack;
            refChange = true;
        }
        this.#renderChips();
        if (refChange) {
            this.tracks.forEach((trk) => {
                trk.calcRefError(this.refTrack);
                this.#emit('update', trk );
            });
        } else {
            this.#emit('update', track );
        }
    }

    remove(track) {
        log('FileManager remove', track.name);
        const ix = this.tracks.findIndex((trk) => (trk === track));
        if (-1 !== ix) {
            this.tracks.splice(ix, 1);
            this.#renderChips();
            this.#hidePopup();
            this.#emit('remove', track);
            if (track === this.refTrack) {
                delete this.refTrack;
                this.tracks.forEach((trk) => {
                    trk.calcRefError();
                    this.#emit('update', trk );
                })
            }
        }
    }

    getPosBounds() {
        // now we get new bounds
        let minLat = Infinity;
        let maxLat = -Infinity;
        let minLng = Infinity;
        let maxLng = -Infinity;
        // propagate bounds to the config
        this.tracks
            .filter((track) => (track.mode !== Track.MODE_HIDDEN))
            .forEach((track) => {
                const posBounds = track.boundsPos();
                minLat = Math.min(minLat, posBounds[0][0]);
                maxLat = Math.max(maxLat, posBounds[1][0]);
                minLng = Math.min(minLng, posBounds[0][1]);
                maxLng = Math.max(maxLng, posBounds[1][1]);
            });
        return [[minLat, minLng], [maxLat, maxLng]];
    }

    getTimeBounds() {
        // now we get new bounds
        let minTime = Infinity;
        let maxTime = -Infinity;
        // propagate bounds to the config
        this.tracks
            //.filter( (track) => (track.mode !== Track.MODE_HIDDEN) )
            .forEach((track) => {
                const timeBounds = track.boundsTime();
                minTime = Math.min(minTime, timeBounds[0]);
                maxTime = Math.max(maxTime, timeBounds[1]);
            });
        return [minTime, maxTime];
    }

    // ===== Save Restore API =====

    fromJson(json) {
        this.clear();
        if (Array.isArray(json?.tracks)) {
            json.tracks.forEach((trkJson) => {
                const track = new Track(trkJson.name, Track.EPOCH_FIELDS, trkJson);
                if (def(trkJson.epochs)) {
                    track.addEpochs(trkJson.epochs);
                    this.add(track);
                } else if (def(track.url)) {
                    track.fetchUrl(track.url)
                        .then(() => { 
                            this.add(track);
                         })
                        .catch(console.error);
                }
            });
        }
    }

    toJson(json) {
        const tracks = [];
        this.tracks.forEach((track) => {
            tracks.push( this.#trackJson(track) );
        });
        if (tracks) json.tracks = tracks;
    }

    // ===== Internals =====

    #trackJson(track) {
        const epochs = track.epochs.map(epoch => this.#epochJson(epoch));
        const json = { name: track.name, color: track.color() };
        if (track.mode) json.mode = track.mode;
        if (track.info) json.info = track.info;
        if (epochs) json.epochs = epochs;
        return json;
    }

    #epochJson(epoch) {
        const json = { fields: {} };
        Track.EPOCH_FIELDS.forEach((key) => {
            if (def(epoch.fields[key])) {
                json.fields[key] = epoch.fields[key];
            }
        });
        if (epoch.info) json.info = epoch.info;
        return json;
    }

    // ===== GUI Internals =====

    #renderShell() {
        const bar = this.#container;
        bar.classList.add("filemanager");

        // Left controls
        this.left = document.createElement("div");
        this.left.className = "filemanager-left overlay_control";

        // Hidden file input
        this.input = document.createElement("input");
        this.input.type = "file";
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        if (!isIOS) {
            this.input.accept = ".gz,.json,.ubx,application/gzip,application/x-gzip,application/json";
        }
        this.input.multiple = true;
        this.input.style.display = "none";
        this.input.addEventListener("change", (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            const files = evt.target.files;
            if (files && files.length) {
                this.readFiles(files);
            }
            evt.target.value = null;
        });

        // Buttons
        this.btnLoad = document.createElement("button");
        this.btnLoad.className = "overlay_button";
        this.btnLoad.title = "Add .ubx files or a .json environment file";
        this.btnLoad.innerHTML = feather.icons['file-plus'].toSvg();
        this.btnLoad.addEventListener("click", (evt) => this.input.click());

        this.btnDownload = document.createElement("button");
        this.btnDownload.className = "overlay_button";
        this.btnDownload.title = "Download current environment (hold Shift for uncompressed)";
        this.btnDownload.innerHTML = feather.icons.download.toSvg();
        this.btnDownload.addEventListener("click", (evt) => this.downloadJson(!evt.shiftKey));
        this.btnClear = document.createElement("button");
        this.btnClear.className = "overlay_button";
        this.btnClear.title = "Remove all tracks and places";
        this.btnClear.innerHTML = feather.icons.trash.toSvg();
        this.btnClear.addEventListener("click", (evt) => this.onFromJson());
        this.left.append(this.input, this.btnLoad, this.btnDownload, this.btnClear);

        // Right: track chips
        this.right = document.createElement("div");
        this.right.className = "filemanager-right";

        // Floating popup (positioned relative to bar)
        this.popup = document.createElement("div");
        this.popup.className = "filemanager-popup hidden";
        bar.append(this.left, this.right, this.popup);
    }

    #renderChips() {
        const tracks = this.tracks || [];
        this.right.innerHTML = "";
        tracks
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach((track) => {
                const chip = document.createElement("div");
                chip.className = "track-chip";
                chip.style.opacity = (track.progress && (track.mode === Track.MODE_HIDDEN)) ? 0.5 : 1.0;
                if (track.progress !== undefined && track.progress < 100) {
                    const progress = document.createElement("div");
                    progress.className = "chip-progress";
                    progress.style.width = `${track.progress}%`;
                    chip.appendChild(progress);
                }
                const line = document.createElement("span");
                line.className = "dash";
                line.style.background = track.color();
                const name = document.createElement("span");
                name.className = "chip-name";
                name.textContent = track.name || "(unnamed)"
                chip.append(line, name);
                this.right.appendChild(chip);
                chip.addEventListener("mouseenter", () => this.#showPopupForTrack(track, chip));
                chip.addEventListener("mouseleave", () => this.#hidePopupSoon());
            });
        this.#hidePopup();
    }

    #hidePopupSoon() {
        clearTimeout(this.#hideTid);
        this.#hideTid = setTimeout(() => this.#hidePopup(), 120);
    }

    #hidePopup() {
        this.popup.classList.add("hidden");
        this.popup.innerHTML = "";
    }

    #showPopupForTrack(track, chip) {
        clearTimeout(this.#hideTid);
        const epochsGood = (track.epochs || []).filter((e) => e.selTime && e.fixGood).length;
        const epochsTotal = (track.epochs || []).length;
        const info = track.info || {};
        const tbl = document.createElement("table");
        tbl.className = 'table';
        const rows = [
            ["Color", this.#tdColor(track)],
            ["Mode", this.#tdMode(track)],
            ["Module", info.module],
            ["Firmware", info.fwVer],
            ["Protocol", info.protoVer],
            ["Extension", info.extVer],
            ["Hardware", info.hwVer || info.monHwVer],
            ["Epochs", `${epochsGood} / ${epochsTotal}`],
            ['Remove', this.#tdRemove(track)]
        ];

        tbl.appendChild(_row('Name', this.#thName(track), 'th'))
        rows.forEach(([n, v], ix) => {
            if (v) {
                tbl.appendChild(_row(n, v));
            }
        });
        
        function _row(n, v, tx = 'td') {
            const tr = document.createElement('tr');
            n = _tx(n, tx);
            tr.appendChild(n);
            v = _tx(v, tx);
            tr.appendChild(v);
            return tr;
        }

        function _tx(obj, tx) {
            if (typeof obj !== 'object') {
                const td = document.createElement(tx);
                td.textContent = obj;
                obj = td;
            };
            return obj;
        }

        this.popup.innerHTML = "";
        const arrow = document.createElement("div");
        arrow.className = "filemanager-popup-arrow";
        this.popup.append(arrow, tbl);
        this.popup.classList.remove("hidden");

        // Position the popup relative to the hovered chip (inside the bar)
        const GAP = 8; // px gap below the chip
        const barRect = this.#container.getBoundingClientRect();
        const chipRect = chip.getBoundingClientRect();
        this.popup.style.left = '0px';
        this.popup.style.top = '0px';
        const popupRect = this.popup.getBoundingClientRect();
        let left = chipRect.left - barRect.left + (chipRect.width - popupRect.width) / 2;
        left = Math.max(8, Math.min(left, barRect.width - popupRect.width - 8));
        const top = chipRect.bottom - barRect.top + GAP;
        this.popup.style.left = `${Math.round(left)}px`;
        this.popup.style.top = `${Math.round(top)}px`;
        const chipCenterInPopup = (chipRect.left + chipRect.width / 2) - (barRect.left + left);
        const arrowWidth = arrow.offsetWidth || 12; // fallback if not yet measured
        const arrowHalf = arrowWidth / 2;
        const arrowMin = arrowHalf + 4;
        const arrowMax = popupRect.width - arrowHalf - 4;
        const arrowLeft = Math.max(arrowMin, Math.min(chipCenterInPopup, arrowMax)) - arrowHalf;
        arrow.style.left = `${Math.round(arrowLeft)}px`;
        this.popup.onmouseenter = () => clearTimeout(this.#hideTid);
        this.popup.onmouseleave = () => this.#hidePopupSoon();
    }

    #thName(track) {
        const td = document.createElement('th');
        const input = document.createElement('input');
        input.type = 'text';
        input.value = track.name;
        input.addEventListener("keyup", (evt) => {
            if (evt.key === "Enter") {
                input.blur();
            }
        });
        input.addEventListener("blur", (evt) => {
            const name = evt.target.value;
            const recalc = (name       === Track.TRACK_REFERENCE) || 
                           (track.name === Track.TRACK_REFERENCE);
            track.name = name;
            this.update(track);
        });
        td.appendChild(input);
        return td;
    }

    #tdColor(track) {
        const td = document.createElement('td');
        td.style.position = 'relative';
        const line = document.createElement("span");
        line.className = 'dash';
        const color = track.color();
        line.style.backgroundColor = color;
        td.appendChild(line);
        const input = document.createElement("input");
        input.style.left = 0;
        input.style.top = 0;
        input.style.right = 0;
        input.style.height = '100%';
        input.style.width = '100%';
        input.style.opacity = 0;
        input.style.position = 'absolute';
        input.style.cursor = 'pointer';
        input.type = "color";
        input.value = color;
        input.addEventListener('change', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            const color = input.value;
            track.color(color);
            line.style.backgroundColor = color;
            this.update(track);
        });
        td.appendChild(input);
        return td;
    }

    #tdMode(track) {
        const td = document.createElement('td');
        td.style.cursor = 'pointer';
        td.innerHTML = track.modeIcon();
        td.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            track.mode = (track.mode === Track.MODE_HIDDEN)  ? Track.MODE_LINE :
                         (track.mode === Track.MODE_LINE)    ? Track.MODE_MARKERS :
                         (track.mode === Track.MODE_MARKERS) ? Track.MODE_ANYFIX :
                                                               Track.MODE_HIDDEN;
            td.innerHTML = track.modeIcon();
            this.update(track);
        });
        return td;
    }
    
    #tdRemove(track) {
        const td = document.createElement('td');
        td.style.cursor = 'pointer';
        td.innerHTML = feather.icons.trash.toSvg({ class:'icon-inline' });
        td.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            this.remove(track);
            this.#hidePopup();
        });
        return td;
    }

    // ===== Internals =====

    #emit(name, detail ) {
        this.#container.dispatchEvent(new CustomEvent(name, { detail }));
    }

    #container
    #hideTid
}
