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

import { def, log, bytesToString, isGzip } from './utils.js';
import { Epoch } from './epoch.js';
import { Collector } from './collector.js';

export class Track {
    constructor(name, keys, opt = {} ) {
        this.clear();
        name = name.match(/^(truth|reference)/i) ? Track.TRACK_REFERENCE : name;
        this.name = name;
        const isRef = (name === Track.TRACK_REFERENCE);
        this.mode =  def(opt.mode)  ? opt.mode : 
                     (isRef)        ? Track.MODE_LINE : 
                                      Track.MODE_MARKERS;
        
        this.#keys = keys;
        if (def(opt.color)) {
            this.#color = opt.color;
        } else if (isRef) {
            this.#color = Track.COLOR_REFERENCE;
        } 
        def(opt.url)   && (this.url   = opt.url);
        def(opt.file)  && (this.file  = opt.file);
        def(opt.info)  && (this.info  = opt.info);
    }

    async fetchUrl(url, progressCallback) {
        log('Track fetchUrl', this.name)
        const res = await fetch(url);
        const size = res.headers.get("content-length");
        const reader = res.body.getReader();
        return this.read(reader, size, progressCallback);
    }
    
    async readFile(file, progressCallback) {
        log('Track readFile', this.name)
        const size = file.size; 
        const reader = file.stream().getReader();
        return this.read(reader, size, progressCallback);
    }
    
    async read(reader, size, progressCallback) {
        let cnt = 0;
        let infCnt = 0;
        this.progress = 0;
        let { value, done } = await reader.read();
        if (!done) {
            // progress / yield
            cnt += value.length;
            this.progress = Math.round(100 * cnt / size);
            if (progressCallback) await progressCallback(cnt, size);
            if (isGzip(value)) {
                // setup inflator and decoding callbacks
                const inflator = new pako.Inflate({ to: 'uint8array' });
                inflator.onData = (infValue) => {
                    infCnt += infValue.length;
                    const txt = bytesToString(infValue);
                    if (txt) this.appendData(txt);
                };
                inflator.onError = (err) => { 
                    console.error('inflate error:', err);
                };
                // push data though inflator 
                inflator.push(value, false);
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    inflator.push(value, false);
                    // progress / yield
                    cnt += value.length;
                    this.progress = Math.round(100 * cnt / size);
                    if (progressCallback) await progressCallback(cnt, size, infCnt);
                }
                inflator.push(new Uint8Array(0), true);
            } else {
                // read data directly and decode 
                const txt = bytesToString(value);
                if (txt) this.appendData(txt);
                while (!done) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    const txt = bytesToString(value);
                    if (txt) this.appendData(txt);
                    // progress / yield
                    cnt += value.length;
                    this.progress = Math.round(100 * cnt / size);
                    if (progressCallback) await progressCallback(cnt, size, infCnt);
                }
            }
        }
        // progress / yield
        delete this.progress;
        if (progressCallback) await progressCallback(cnt, size, infCnt); 
        return this;
    }

   setTime(datetime) {
        const epoch = this.epochs
                .filter((epoch) => (epoch.timeValid && epoch.posValid))
                .reduce((prev, curr) => {
                    const prevDiff = Math.abs(new Date(prev.datetime) - datetime);
                    const currDiff = Math.abs(new Date(curr.datetime) - datetime);
                    return currDiff < prevDiff ? curr : prev;
                })
        this.currentEpoch = epoch;
    }

    addEpochs(epochs) {
        log('Track addEpochs', this.name)
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

    calcRefError(track /* = reference */ ) {
        const refEpochs = (track !== this) ? track?.epochs : undefined;
        this.epochs.forEach( (epoch) => {
            epoch.calcRefError(refEpochs);
        });
    } 

    clear() {
        this.info   = {};
        this.epochs = [];
        delete this.currentEpoch;
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
        span.style.backgroundColor = this.color();
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

    color(color) {
        def(color) && (this.#color = color);
        return def(this.#color)         ? this.#color : 
               def(this.info?.protoVer) ? Track.COLOR_UBLOX : 
               !def(this.progress)      ? Track.COLOR_OTHERS :
                                          Track.COLOR_UNKNOWN;
    }

    modeIcon() {
        let icon;
        const mode = this.mode;
        if (mode === Track.MODE_HIDDEN) {
            icon = feather.icons['eye-off'].toSvg( { class:'icon-inline' } );
        } else if (mode === Track.MODE_MARKERS) {
            icon = feather.icons['git-commit'].toSvg( { class:'icon-inline', fill:'#00ff00'} )
        } else if (mode === Track.MODE_ANYFIX) {
            icon = feather.icons['share-2'].toSvg( { class:'icon-inline', fill:'#ff0000'} )
        } else {
            icon = '〜';
        }
        return icon;
    }


    add(epoch) {
        this.epochs.push(epoch);
        if (epoch.timeValid) {
            this.bounds.datetime.min = Math.min(epoch.datetime, this.bounds.datetime.min);
            this.bounds.datetime.max = Math.max(epoch.datetime, this.bounds.datetime.max);
        }
        if (epoch.posValid) {
            this.bounds.lat.min = Math.min(epoch.fields.lat, this.bounds.lat.min);
            this.bounds.lat.max = Math.max(epoch.fields.lat, this.bounds.lat.max);
            this.bounds.lng.min = Math.min(epoch.fields.lng, this.bounds.lng.min);
            this.bounds.lng.max = Math.max(epoch.fields.lng, this.bounds.lng.max);
        }
    }

    crop() {
        const epochs = this.epochs.filter( (epoch) => epoch.selTime );
        let dateMin =  Infinity;
        let dateMax = -Infinity;
        epochs.forEach((epoch) => {
            if (epoch.timeValid) {
                dateMin = Math.min(epoch.datetime, dateMin);
                dateMin = Math.max(epoch.datetime, dateMax);
            }
        });
        this.bounds.datetime = { min:dateMin, max: dateMax };
        this.epochs = epochs;
    }

    boundsPos() {
        return [ [ this.bounds.lat.min, this.bounds.lng.min], [ this.bounds.lat.max, this.bounds.lng.max] ];
    }

    boundsTime() {
        return [ this.bounds.datetime.min, this.bounds.datetime.max];
    }

    trim( range ) {
        let minLat  =  Infinity;
        let minLng  =  Infinity;
        let maxLat  = -Infinity;
        let maxLng  = -Infinity;
        this.epochs.forEach( (epoch) => { 
            epoch.selTime = epoch.timeValid && (epoch.datetime >= range[0]) && (epoch.datetime <= range[1]);
            if (epoch.selTime & epoch.posValid) {
                minLat = Math.min(minLat, epoch.fields.lat);
                minLng = Math.min(minLng, epoch.fields.lng);
                maxLat = Math.max(maxLat, epoch.fields.lat);
                maxLng = Math.max(maxLng, epoch.fields.lng);
            }
        } );
        this.bounds.lat = { min:minLat, max:maxLat };
        this.bounds.lng = { min:minLng, max:maxLng };
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

    static MODE_HIDDEN  = 'hidden';
    static MODE_MARKERS = 'markers';
    static MODE_ANYFIX  = 'anyfix';
    static MODE_LINE    = 'line';

    static TRACK_REFERENCE = 'Reference';

    static COLOR_REFERENCE     = '#000000';
    static COLOR_UBLOX         = '#0000ff';
    static COLOR_OTHERS        = '#ff0000';
    static COLOR_UNKNOWN       = '#808080';

    static EPOCH_FIELDS = [ 
        'date', 'time',
        'fix', 'psm', 'power',
        'lat', 'lng', 'pAcc', 'hAcc',
        'height', 'msl', 'vAcc', 
        'speed', 'gSpeed', 'sAcc', 'cAcc', 
        'hDop', 'pDop', 'numSV', 
        'pErr', 'hErr', 'vErr', 'sErr', 'gsErr',
    ];
  
    // some protected local vars 
    #collector
    #keys
    #color
}
