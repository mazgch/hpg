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
import { FieldsReg } from './fieldsReg.js'

export class Epoch {
    constructor(fields, info) {
        this.fields = fields;
        if (Array.isArray(info) && (0 < info?.length)) {
            this.info = info;
        }

        this.fixValid = def(fields.fix) && (fields.fix !== 'NO');
        this.posValid = this.fixValid && def(fields.lat) && def(fields.lng);
        this.fixGood = this.fixValid && (fields.fix !== 'BAD');
        this.color = FieldsReg.fix?.color(fields.fix); // TODO 
        let datetime = Number.NaN;
        if (def(fields.date) && def(fields.time)) {
            const isoTime = fields.date + 'T'+ fields.time + 'Z';
            datetime = new Date(isoTime).getTime();
        }
        // Airoha/MTK is outputting 1.5.1980 as Dates in NMEA, which is GPS week 0, lets ignore the first year
        this.timeValid = this.fixValid && Number.isFinite(datetime) && (datetime > 347068800000 /* 31.12.1980 */);
        if (this.timeValid) {
            this.datetime = datetime;
        }
    }

    calcRefError(refEpochs) {
        const vals = {};
        if (def(refEpochs) && this.timeValid) {
            // find the first epoch in the file (should e use valid only)
            const ix = refEpochs.findIndex((epoch) => (epoch.timeValid && (epoch.datetime >= this.datetime)));
            if (0 <= ix) {
                const nextEp = refEpochs[ix];
                const dt = nextEp.datetime - this.datetime;
                const prevEp = (0 === dt) ? nextEp : refEpochs[ix-1];
                const diff = (nextEp.datetime - prevEp?.datetime);
                if ((0 === dt) || (def(prevEp) && (0 !== diff))) {
                    const ratio = (0 === dt) ? 0 : (dt / diff);
                    const keys = ['lat', 'lng', 'height', 'speed', 'gSpeed'];
                    keys.forEach( key => {
                        vals[key] = nextEp.fields[key] + ratio * (prevEp.fields[key] - nextEp.fields[key]);
                    });
                    if (this.posValid && Number.isFinite(vals.lat) && Number.isFinite(vals.lng)) {
                        // haversine: calculate the great cicle in meters using between to lat/lng positions
                        const R = 6371000; // Earth radius in meters
                        const toRad = deg => deg * Math.PI / 180;
                        const dLat = toRad(vals.lat - this.fields.lat);
                        const dLng = toRad(vals.lng - this.fields.lng);
                        const a = Math.sin(dLat/2) ** 2 +
                                Math.cos(toRad(this.fields.lat)) * Math.cos(toRad(vals.lat)) * Math.sin(dLng/2)**2;
                        vals.hErr = 2 * R * Math.asin(Math.sqrt(a));
                    }
                    if (Number.isFinite(this.fields.height) && Number.isFinite(vals.height)){
                        vals.vErr = Math.abs(this.fields.height - vals.height)
                    }
                    if (Number.isFinite(vals.hErr) && Number.isFinite(vals.vErr)){
                        vals.pErr = Math.sqrt(vals.hErr ** 2 + vals.vErr ** 2);
                    }
                    if (Number.isFinite(this.fields.speed) && Number.isFinite(vals.speed)){
                        vals.sErr = Math.abs(this.fields.speed - vals.speed);
                    }
                    if (Number.isFinite(this.fields.gSpeed) && Number.isFinite(vals.gSpeed)){
                        vals.gsErr = Math.abs(this.fields.gSpeed - vals.gSpeed);
                    }
                }
            }
        }
        
        // now write all the errors back or delete the previous
        const errKeys = [ 'hErr', 'vErr', 'pErr', 'sErr', 'gsErr' ];
        errKeys.forEach(key => {
            if (Number.isFinite(vals[key]) && def(FieldsReg[key])) {
                this.fields[key] = FieldsReg[key].format(vals[key]);
            } else {
                delete this.fields[key];
            }
        })
    }

    tableHtml(keys) {
        const table = document.createElement('table');
        table.className = 'table';
        // header
        const thead = document.createElement('thead');
        table.appendChild(thead);
        const tr = document.createElement('tr');
        thead.appendChild(tr);
        const thP = document.createElement('th');
        thP.textContent = 'Parameter';
        tr.appendChild(thP);
        const thV = document.createElement('th');
        thV.className = 'right';
        thV.textContent = 'Value';
        tr.appendChild(thV);
        const thU = document.createElement('th');
        thU.textContent = 'Unit';
        tr.appendChild(thU);
        // body
        const tbody = document.createElement('tbody');
        table.appendChild(tbody);
        keys.forEach((field) => {
          // each row
          const val = this.fields[field];
          const reg = FieldsReg[field];
          if (def(val) && def(reg)) {
            const tr = reg.trHtml(val);
            (tr) && tbody.appendChild(tr);
          }
        } );
        return table;
    }
}
