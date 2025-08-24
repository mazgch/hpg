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

import { def } from './utils.js';
import { Epoch } from './epoch.js';
import { Collector } from './collector.js';

export class Track {
    constructor(name, keys, opt = {} ) {
        this.clear();
        this.name = name;
        this.#keys = keys;
        def(opt.url)   && (this.url   = opt.url);
        def(opt.file)  && (this.file  = opt.file);
        def(opt.color) && (this.color = opt.color);
        def(opt.mode)  && (this.mode  = opt.mode);
        def(opt.info)  && (this.info  = opt.info);
    }

    async fetchUrl(url) {
        const response = await fetch(url);
        // maybe we could consume bytes on the go  
        const bytes = await response.bytes();
        return this.addData(bytes);
    }

    addData(data) {
        if (data instanceof Uint8Array) {
            if ((data[0] === 0x1f) && (data[1] === 0x8b)) {
                data = window.pako.ungzip(data);
            }
        }
        if (typeof data !== 'string') {
            data = Array.from(data, (byte) => (String.fromCharCode(byte))).join('');
        }
        this.appendData(data);
    }
    
    addEpochs(epochs) {
        epochs.forEach( (epoch) => {
            const fields = Object.fromEntries(
                Object.entries(epoch.fields)
                    .filter( ([key, val]) => (this.#keys.includes(key)) ));
            epoch = new Epoch( fields, epoch.info );
            this.add(epoch);
        });
        if (0 === this.epochs.length) {
            throw new Error('No epochs loaded');
        }
    }

    clear() {
        this.info   = {};
        this.epochs = [];
        this.bounds = { 
            lat:      { min:Infinity, max: -Infinity },
            lng:      { min:Infinity, max: -Infinity },
            datetime: { min:Infinity, max: -Infinity }
        };
        this.#collector = undefined;
        Engine.parseReset();
    }

    appendData(ubxString) {
        Engine.parseAppend(ubxString);
        let messages = Engine.parseMessages();
        if (messages.length) {
            messages.forEach( (message) => { 
                this.appendMessage(message); 
            });
        }
    }

    appendMessage(message) {
        this.#collector ??= new Collector();
        if (this.#collector.check(message)) {
            const epoch = this.#collector.collect( this.#keys );
            this.#collector.clear();
            this.add(epoch);
        }
        this.#collector.merge(message);
        this.#collectInfo(message);
    }

    nameHtml(type = 'span') {
        const div = document.createElement(type);
        div.style.whiteSpace = 'nowrap'; 
        const span = document.createElement('span');
        span.className = 'dash';
        span.style.backgroundColor = this.color;
        div.appendChild(span);
        div.appendChild(document.createTextNode(this.name));
        return div;
    }

    infosHtml(infos) {
        const div = document.createElement('div');
        div.appendChild(this.nameHtml('div'));
        infos.forEach( (info) => {
            div.appendChild(document.createTextNode(info));
            div.appendChild(document.createElement('br'));
        })
        return div;
    }


    add(epoch) {
        this.epochs.push(epoch);
        if (epoch.timeValid) {
            this.bounds.datetime.min = Math.min(epoch.datetime, this.bounds.datetime.min);
            this.bounds.datetime.max = Math.max(epoch.datetime, this.bounds.datetime.max);
        }
        if (epoch.posValid) {
            this.bounds.lat.min = Math.min(epoch.datetime, this.bounds.lat.min);
            this.bounds.lat.max = Math.max(epoch.datetime, this.bounds.lat.max);
            this.bounds.lng.min = Math.min(epoch.datetime, this.bounds.lng.min);
            this.bounds.lng.max = Math.max(epoch.datetime, this.bounds.lng.max);
        }
    }

    boundsPos() {
        return [ [ this.bounds.lat.min, this.bounds.lng.min], [ this.bounds.lat.max, this.bounds.lng.max] ];
    }

    boundsTime() {
        return [ this.bounds.datetime.min, this.bounds.datetime.max];
    }

    trim( range, good ) {
        let minLat  =  Infinity;
        let minLng  =  Infinity;
        let maxLat  = -Infinity;
        let maxLng  = -Infinity;
        this.epochs.forEach( (epoch) => { 
            epoch.selTime = epoch.timeValid && (epoch.datetime >= range[0]) && (epoch.datetime <= range[0]);
            if (epoch.selTime) {
                minLat = Math.min(minLat, epoch.fields.lat);
                minLng = Math.min(minLng, epoch.fields.lng);
                maxLat = Math.max(maxLat, epoch.fields.lat);
                maxLng = Math.max(maxLng, epoch.fields.lng);
            }
        } );
        return [ [ minLat, minLng ], [ maxLat, maxLng] ];
    }

    #collectInfo(message) {
        if ((message.type === 'output') && message.protocol.match(/^NMEA|UBX$/)) {
            // extract text fields 
            if ((message.protocol === 'UBX') && message.fields) {
                if (message.name === 'MON-VER') {
                    this.#setInfo(message.fields.swVer);
                    this.info.monHwVer = message.fields.hwVer;
                    if (message.fields.extVer) {
                        for (let i = 0; i < message.fields.extVer.length; i ++)
                        this.#setInfo(message.fields.extVer[i]);
                    }
                } else if (message.name === 'INF-NOTICE') {
                    this.#setInfo(message.fields.infTxt);
                }
            } else if (message.protocol === 'NMEA') {
                if ((message.id === 'TXT') && message.fields) {
                    this.#setInfo(message.fields.infTxt);
                } else {
                    // try to pares Airoha sw version messages
                    const m = message.text.match(/^\$PAIR02[1|0],([^_]*)_([^\,]*)\.([^,]*),(\w)/);
                    if (m) {
                        this.info.module = m[1];
                        this.info.fwVer  = m[2];
                        this.info.hwVer  = m[3];
                    }
                }
            }
        }
    }

    #setInfo(text) {
        if (text) {
            let m;
            if (m = text.match(/^MOD=(.+)$/))                       this.info.module   = m[1];
            else if (m = text.match(/^HW (.+)$/))                   this.info.hwVer    = m[1];
            else if (m = text.match(/^ROM (?:BASE|CORE)?\s*(.+)$/)) this.info.romVer   = m[1];
            else if (m = text.match(/^EXT (?:BASE|CORE)?\s*(.+)$/)) this.info.extVer   = m[1];
            else if (m = text.match(/^FWVER=(.+)$/))                this.info.fwVer    = m[1];
            else if (m = text.match(/^PROTVER=(.+)$/))              this.info.protoVer = m[1];
        }
    }

    // some protected local vars 
    #collector
    #keys
}
