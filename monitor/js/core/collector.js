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
import { FieldsReg } from './fieldsReg.js';

export class Collector {
    constructor( ) {
        this.clear();
        this.#meas = {};
        this.#voltage = {};
    }

    check(message) {
        const msgId = ['RMC', 'VTG', 'GGA', 'GNS'];
        return  (def(message.id) && msgId.includes(message.id) && def(this.#ids[message.id])) || 
                (def(message.fields?.time) && def(this.#fields.time) && (message.fields?.time !== this.#fields.time)) ||
                (def(message.fields?.itow) && def(this.#fields.itow) && (message.fields?.itow !== this.#fields.itow));
    }

    collect(keys) {
        this.#completeFixUbx(this.#fields);
        this.#completeFixNmea(this.#fields);
        this.#completeDateTime(this.#fields);
        this.#completeLocation(this.#fields);
        this.#completeSpeed(this.#fields);
        this.#completeHeight(this.#fields);
        const fieldEntries = Object.entries(this.#fields)
                .filter( ([key, val]) => ( def(val) && keys.includes( key ) && (true !== FieldsReg[key]?.hide)) )
                .map( ([key, val]) => {
                    if (def(FieldsReg[key])) {
                        val = FieldsReg[key].format( val );
                    }
                    return [key, val]; 
                } );
        const fields = Object.fromEntries(fieldEntries);

        // calculate the power consumption
        let power;
        Object.entries(this.#voltage).forEach( ([n, v]) => { 
            if (def(this.#meas[n]?.avg) && def(this.#meas[n]?.cnt)) {   
                const powerN = v * this.#meas[n].avg / this.#meas[n].cnt;
                power = (power || 0) + powerN;
            }
        } );
        if (def(power)) {
            fields.power = Number(power.toFixed(6));
        }
        return new Epoch(fields, ((0 < this.#info.length) ? this.#info : undefined) );
    }

    clear() {
        this.#meas = {};
        this.#fields = {}; 
        this.#info = []; 
        this.#ids = {};  
    }

    merge(message) {
        def(message.id) && (this.#ids[message.id] = true);  
        def(message.fields) && this.fieldsMerge(message.fields, this.#fields);
        if ((message.name === 'NAV-PVT') && def(message.fields?.flags?.psmState)) {
            const mapPsm = Object.keys(FieldsReg.psm.map);
            this.#fields.psm = mapPsm[message.fields.flags.psmState];
        }
        if (message.name === 'TUN-MEAS') {
            const name = message.fields?.name;
            const i = message.fields?.meas[2].value; // 0=cnt, 1=time 2=avg
            const mapV = { ICC1:'vcc', ICC2:'vbat', ICC3:'vio' } 
            const n = mapV[name];
            if (n) {
                this.#meas[n] ??= {}
                this.#meas[n].cnt = (this.#meas[n].cnt || 0) + 1;
                this.#meas[n].avg = (this.#meas[n].avg || 0) + i;
            }
        }
        // extract configured voltages 
        let m = message.fields?.infTxt?.match(/nomVoltage_(.*)=(.*)$/);
        if (m) {
            this.#voltage[m[1]] = Number( m[2].replace('V','.') );
        }
        // get inf texts 
        if (def(message.fields?.infTxt)) {
            m = message.name.match(/^(INF-(ERROR|WARNING|NOTICE)|(G[PN]TXT))$/);
            if (m) {
                const infTxt = ((def(m[2]) && (m[2] !== 'NOTICE')) ? `$(m[2]) `: '') + message.fields.infTxt;
                this.infMerge(this.#info, infTxt);
            }
        }
    }
    
    // helpers 

    infMerge(infos, info) {
        (info) && !infos.includes(info) && infos.push(info);
    }    
   
    fieldsMerge(fromFields, toFields) {
        Object.entries(fromFields)
            .forEach( ([key, val]) => { 
                if (def(val) && def(toFields[key]) && (typeof val !== typeof toFields[key])) {
                    console.error('change of field type ' + key + ' from ' + (typeof val) + ' to ' + (typeof toFields[key]));
                }
                if (Array.isArray(val)) {
                    (!Array.isArray(toFields[key])) && (toFields[key] = []);
                    val.forEach((elem, ix) => {
                        toFields[key][ix] = elem;
                    })
                } else if (typeof val === 'object') {
                    (typeof toFields[key] !== 'object') && (toFields[key] = {});
                    this.fieldsMerge(val, toFields[key]);
                } else {
                    toFields[key] = val; 
                }
            })
    }

    #completeFixUbx(fields) {
        if (!def(fields.fix)) {
            let fix;
            const fixOk = { 0:'BAD' }; 
            const fixType = { 5: 'TIME', 4: '3D+DR', 3: '3D', 2: '2D', 1: 'DR', 0:'NO' }; 
            const carrSol = { 1: 'FLOAT', 2: 'FIXED' }; 
            if ((0 !== fields.fixType) && def(fix = fixOk[fields.flags?.fixOk])) {
                fields.fix = fix;
            } else if (def(fix = carrSol[fields.flags?.carrSol])) {
                fields.fix = fix;
            } else if (def(fix = fixType[fields.fixType])) {
                fields.fix = fix;
            }
        }
    }

    #completeFixNmea(fields) {
        /* 
        status  quality  navMode posMode 
            V       0        1       N      No fix
            V       0        1       N      GNSS fix, but user limits exceeded
            V       6        2       E      Dead reckoning fix, but user limits exceeded
            A       6        2       E      Dead reckoning fix
            A      1/2       2      A/D     2D GNSS fix        
            A      1/2       3      A/D     3D GNSS fix        
            A      1/2       3      A/D     Combined GNSS/dead reckoning fix  
        */
        if (!def(fields.fix)) {
            let fix
            const status  = { 'V':'NO' }; // V = data invalid, A = data valid
            const quality = {   0:'NO',   1:'2D/3D',   2:'DGPS' ,  5:'FLOAT',   4:'FIXED',   6:'DR',   7:'TIME' }; 
            const posMode = { 'N':'NO', 'A':'2D/3D', 'D':'DGPS', 'F':'FLOAT', 'R':'FIXED', 'E':'DR', 'M':'TIME'/*Manual*/, 'S':'SIM' }; 
            const navMode = {   1:'NO', '2':'2D',    '3':'3D',  }; 
            if (def(fix = status[fields.status])) {
                fields.fix = fix;
            } else if (def(fix = quality[fields.quality])) {
                fields.fix = fix;
            } else if (def(fix = posMode[fields.posMode])) {
                fields.fix = fix;
            }
            if (("2D/3D" === fields.fix) && def(fix = navMode[fields.navMode])) {
                fields.fix = fix;
            }
        }
    }
    
    #completeDateTime(fields) {
        // date / time from UBX
        if ((!def(fields.date) || !def(fields.time)) && ((0 !== fields.valid?.validDate) || (0 !== fields.valid?.validTime))) {
            const ms = def(fields.nano) ? Math.round(fields.nano * 1e-6) : 0;
            const [date, time] = this.#convertDateTime(fields.year, fields.month, fields.day, fields.hour, fields.min, fields.sec, ms);
            !def(fields.date) && def(date) && (0 !== fields.valid?.validDate) && (fields.date = date);
            !def(fields.time) && def(time) && (0 !== fields.valid?.validTime) && (fields.time = time);
        }
        const towSet = def(fields.towSet) && (0 < fields.towSet) && def(fields.itow);
        const wknSet = def(fields.wknSet) && (0 < fields.wknSet) && def(fields.wkn) && towSet;
        if ((!def(fields.date) || !def(fields.time)) && (towSet || wknSet)) {
            const [date, time] = this.#convertGpsWeekItow(fields.wkn, fields.itow);
            !def(fields.date) && def(date) && (wknSet)  && (fields.date = date);
            !def(fields.time) && def(time) && (towSet) && (fields.time = time);
        }
    }
    
    #completeLocation(fields) {
        let val;
        // location
        const mapWE = { 'W': -fields.longN, 'E': fields.longN };
        if (!def(fields.lng) && def(val = mapWE[fields.longI])) {
            fields.lng = val;
        }
        const mapNS = { 'S': -fields.latN,  'N': fields.latN  };
        if (!def(fields.lat) && def(val = mapNS[fields.latI])) {
            fields.lat = val;
        }
    }
    
    #completeSpeed(fields) {
        // speed
        if (!def(fields.gSpeed)) {
            if (def(fields.velN) && def(fields.velE))
                fields.gSpeed = Math.sqrt(fields.velN ** 2 + fields.velE ** 2);
            else if (def(fields.spdKm))
                fields.gSpeed = fields.spdKm * (1.0 / 3.6);
            else if (def(fields.spdKn))
                fields.gSpeed = fields.spdKn * (1852.0 / 3600.0);
        }
        if (!def(fields.speed) && def(fields.gSpeed) && def(fields.velD)) {
                fields.speed = Math.sqrt(fields.velD ** 2 + fields.gSpeed ** 2);
        }
    }
    
    #completeHeight(fields) {
        // altitude 
        if (def(fields.gsep)) {
            if (!def(fields.height) && def(fields.msl)) {
                fields.height = fields.msl + fields.gsep;
            }
            else if (!def(fields.msl) && def(fields.height)) {
                fields.msl = fields.height - fields.gsep;
            }
        } else if (def(fields.height) && def(fields.msl)) {
            fields.gsep = fields.height - fields.msl;
        }
        if (!def(fields.pAcc) && def(fields.hAcc) && def(fields.vAcc)) {
            fields.pAcc = Math.sqrt(fields.hAcc ** 2 + fields.vAcc ** 2);
        }
    }

    #convertDateTime(yr, mth, day, hr, min, sec, ms) 
    {
        // just use any arbitrary date, as we dont care, we use GPS start
        const datetime = new Date(Date.UTC(
            def(yr) ? yr : 1980, def(mth) ? mth-1 : 0, def(day) ? day : 5, 
            def(hr) ? hr : 0, def(min) ? min : 0, def(sec) ? sec : 0)).getTime();
        let time;
        let date;
        if (Number.isFinite(datetime)) {
            [date, time] = (new Date(datetime + ms)).toISOString().split('T');
            time = time.replace('Z', '');
            date = (def(yr) && def(mth)  && def(day) && def(date)) ? date : undefined; 
            time = (def(hr) && def(min) && def(sec) && def(time)) ? time  : undefined;
        }
        return [date, time]; 
    }

    #LEAP_SECONDS = [
        { ms:  315_964_800_000, ls:     0 },
        { ms:  362_793_600_000, ls: 1_000 },
        { ms:  362_793_600_000, ls: 1_000 },
        { ms:  394_329_600_000, ls: 2_000 },
        { ms:  425_865_600_000, ls: 3_000 },
        { ms:  489_024_000_000, ls: 4_000 },
        { ms:  567_993_600_000, ls: 5_000 },
        { ms:  631_152_000_000, ls: 6_000 },
        { ms:  662_688_000_000, ls: 7_000 },
        { ms:  709_948_800_000, ls: 8_000 },
        { ms:  741_484_800_000, ls: 9_000 },
        { ms:  773_020_800_000, ls:10_000 },
        { ms:  820_454_400_000, ls:11_000 },
        { ms:  867_715_200_000, ls:12_000 },
        { ms:  915_148_800_000, ls:13_000 },
        { ms:1_136_073_600_000, ls:14_000 },
        { ms:1_230_768_000_000, ls:15_000 },
        { ms:1_341_100_800_000, ls:16_000 },
        { ms:1_435_708_800_000, ls:17_000 },
        { ms:1_483_228_800_000, ls:18_000 }
    ];
    #GPSWEEK_INC  = 7*24*60*60*1000; // a week in ms
    #ITOW_INC     = 1000; // itow in ms
    #GPSWEEK_ROLL = 1024 * this.#GPSWEEK_INC; // a week in ms
    #GPSWEEK_MIN  = (new Date()).getTime() - (this.#GPSWEEK_ROLL * 3 / 4) ;

    #convertGpsWeekItow(wkn, itow) {
        let datetime =  this.#LEAP_SECONDS[0].ms; // GPS WEEK 0
        let leapSeconds = this.#LEAP_SECONDS[this.#LEAP_SECONDS.length-1].ls;
        if (def(wkn)) {
            const wknMs = wkn * this.#GPSWEEK_INC;
            const itowMs = def(itow) ? itow * this.#ITOW_INC : 0;
            datetime += wknMs + itowMs;
            // handle rollovers
            while (datetime < this.#GPSWEEK_MIN) {
                datetime += this.#GPSWEEK_ROLL;
            }
            leapSeconds = this.#LEAP_SECONDS.findLast((row) => (datetime >= row.ms)).ls;
        } 
        const [date, time] = new Date(datetime - leapSeconds).toISOString().split('T');
        return [ date, time.replace('Z', '') ];
    }    

    // some protected local vars 
    #meas
    #voltage
    #fields
    #info
    #ids
}