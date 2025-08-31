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

export class FileManager {
    constructor(opts = {}) {
        this.#container = opts.container;
        this.onLoadFiles = opts.onLoadFiles;
        this.onDownload = opts.onDownload;
        this.onClear = opts.onClear;

        if (!this.#container) throw new Error("FileManager requires a container");

        this.#renderShell();
    }

    // ===== Public API =====

    setTracks(tracks = []) {
        this.tracks = tracks;
        this.#renderChips();
        this.#hidePopup();
    }

    // ===== Internals =====

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
            if (files && files.length && this.onLoadFiles) this.onLoadFiles(files);
            evt.target.value = null;
        });

        // Buttons
        this.btnLoad = document.createElement("button");
        this.btnLoad.className = "overlay_button";
        this.btnLoad.title = "Add .ubx files or a .json environment file";
        this.btnLoad.innerHTML = feather.icons['file-plus'].toSvg();
        this.btnLoad.addEventListener("click", () => this.input.click());

        this.btnDownload = document.createElement("button");
        this.btnDownload.className = "overlay_button";
        this.btnDownload.title = "Download current environment (hold Shift for uncompressed)";
        this.btnDownload.innerHTML = feather.icons.download.toSvg();
        this.btnDownload.addEventListener("click", (evt) => this.onDownload && this.onDownload(evt));

        this.btnClear = document.createElement("button");
        this.btnClear.className = "overlay_button";
        this.btnClear.title = "Remove all tracks and places";
        this.btnClear.innerHTML = feather.icons.trash.toSvg();
        this.btnClear.addEventListener("click", () => this.onClear && this.onClear());

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
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach((track) => {
                const chip = document.createElement("div");
                chip.className = "track-chip";

                const line = document.createElement("span");
                line.className = "dash";
                line.style.background = track.color;

                const name = document.createElement("span");
                name.className = "chip-name";
                name.textContent = track.name || "(unnamed)";

                chip.append(line, name);
                this.right.appendChild(chip);

                chip.addEventListener("mouseenter", () => this.#showPopupForTrack(track, chip));
                chip.addEventListener("mouseleave", () => this.#hidePopupSoon());
            });
    }

    #hidePopupSoon() {
        clearTimeout(this.#hideTid);
        this.#hideTid = setTimeout(() => this.#hidePopup(), 120);
    }

    #hidePopup() {
        this.popup.classList.add("hidden");
        this.popup.innerHTML = "";
    }

    #showPopupForTrack(track, anchorEl) {
        clearTimeout(this.#hideTid);

        const epochsGood = (track.epochs || []).filter((e) => e.selTime && e.fixGood).length;
        const epochsTotal = (track.epochs || []).length;
        const info = track.info || {};

        const tbl = document.createElement("table");
        tbl.className = 'table';

        const rows = [
            ["Color", this.#color(track, 'td')],
            ["Mode", this.#mode(track, 'td')],
            ["Module", info.module],
            ["Firmware", info.fwVer],
            ["Protocol", info.protoVer],
            ["Extension", info.extVer],
            ["Hardware", info.hwVer || info.monHwVer],
            ["Epochs", `${epochsGood} / ${epochsTotal}`],
        ];

        tbl.appendChild(_row('Name', this.#name(track, 'th'), 'th'))
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

        // Position the popup under the bar, roughly under the hovered chip
        const barRect = this.#container.getBoundingClientRect();
        const chipRect = anchorEl.getBoundingClientRect();
        const left = Math.max(barRect.left, Math.min(barRect.right, (chipRect.left + chipRect.right) / 2)) - barRect.left;
        this.popup.style.left = `${left - 100}px`;
        this.popup.style.top = `${barRect.height + 5}px`;

        // Keep shown if the mouse moves into the popup
        this.popup.onmouseenter = () => clearTimeout(this.#hideTid);
        this.popup.onmouseleave = () => this.#hidePopupSoon();
    }

    // ===== Internals =====

    #name(track, tx = 'td') {
        const td = document.createElement(tx);
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
            track.name = name;
            this.#emit('change', track);
        });
        td.appendChild(input);
        return td;
    }

    #color(track, tx = 'td') {
        const td = document.createElement(tx);
        td.style.position = 'relative';
        const line = document.createElement("span");
        line.className = 'dash';
        line.style.backgroundColor = track.color;
        td.appendChild(line);
        const input = document.createElement("input");
        input.style.left = 0;
        input.style.top = 0;
        input.style.right = 0;
        input.style.opacity = 0;
        input.style.position = 'absolute';
        input.style.cursor = 'pointer';
        input.type = "color";
        input.value = track.color;
        input.addEventListener('change', () => {
            evt.preventDefault();
            evt.stopPropagation();
            const color = input.value;
            track.color = color;
            line.style.backgroundColor = color;
            this.#emit('change', track);
        });
        td.appendChild(input);
        return td;
    }

    #mode(track, tx = 'td') {
        const td = document.createElement(tx);
        td.style.cursor = 'pointer';
        td.innerHTML = track.modeIcon();
        td.addEventListener('click', (evt) => {
            track.mode = (track.mode === Track.MODE_HIDDEN)  ? Track.MODE_LINE :
                         (track.mode === Track.MODE_LINE)    ? Track.MODE_MARKERS :
                         (track.mode === Track.MODE_MARKERS) ? Track.MODE_ANYFIX :
                                                               Track.MODE_HIDDEN;
            td.innerHTML = track.modeIcon();
            this.#emit('change', track);
        });
        return td;
    }

    #emit(name, detail) {
        this.#container.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
    }

    #container
    #hideTid
}