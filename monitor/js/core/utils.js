
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

export function log(...args) {
    const stack = new Error().stack.split("\n");
    const text = stack.slice(1).map((str) => {
        const m = str.match(/^([^@]*)@.*\/([^\/]+)\.js(:\d*)/);;
        return (m) ? `${m[2]}:${m[1]||m[3]}` : str; 
    }).reverse().join(' ');
    const time = formatTime(Date.now());
    console.log.apply(console, [ time, ...args/*, text*/]);
}

export function assert(condition, message) {
    if (!condition) {
        throw new Error(message||'assert failure');
    }
}

export function def(value) {
    return (undefined !== value) && (null !== value);
}

export function get(obj, path) {
    const parts = path.split(".");
    const val = obj;
    for (const part of parts) {
        if (!def(val)) {
            break;
        }
        val = val[part];
    }
    return val;
}

export function pad(t,l,ch=' ') {
    if (!t || (t === '')) t = '?';
    if (t.length < l)
        t += ch.repeat(l-t.length);
    return t;
}

export function hex(v,l) {
    v = v.toString(16).toUpperCase();
    if (l) {
        v = '0'.repeat(l-v.length) + v.slice(-l);
    }
    return v;
}

// 000000000011111111112222
// 012345678901234567890123
// YYYY-MM-DDTHH:MM:SS.sssZ
// \__0-10__/.\__11-23___/.
export function formatDateTime(utcMs) {
    const utcTxt = new Date(utcMs).toISOString();
    return utcTxt.replace('T', ' ').slice(0, 23);
}

export function formatDateTimeShort(utcMs) {
    const utcTxt = new Date(utcMs).toISOString();
    return utcTxt.replace('T', ' ').slice(0, 19);
}

export function formatDate(utcMs) {
    const utcTxt = new Date(utcMs).toISOString();
    return utcTxt.slice(0, 10);
}

export function formatTime(utcMs) {
    const utcTxt = new Date(utcMs).toISOString();
    return utcTxt.slice(11, 23);
}

export function setAlpha(hexColor, alpha = 1) {
    if (hexColor?.[0] === "#") {
        const r = parseInt(hexColor.slice(1, 3), 16);
        const g = parseInt(hexColor.slice(3, 5), 16);
        const b = parseInt(hexColor.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }
}

export function bytesToString(bytes) {
    return Array.from(bytes, byte => String.fromCharCode(byte)).join('');
}

export function isGzip(value) {
    return (value instanceof Uint8Array) && (2 <= value?.length) && 
        (value[0] === 0x1f) && (value[1] === 0x8b);
}

export const GNSS_LUT = {
    GPS     : { flag:'🇺🇸', ch:'G', sv:[1, 32], sbas:[33,64],
                sig:{ '1':'L1 C/A',
                      '2':'L1 P(Y)',
                      '3':'L1 M',
                      '4':'L2 P(Y)',
                      '5':'L2C-M',
                      '6':'L2C-L',
                      '7':'L5-I',
                      '8':'L5-Q',
                      '9':'L1C' } }, 
    GLONASS : { flag:'🇷🇺', ch:'R', sv:[65,99], sbas:[33,64],
                sig:{ '1':'L1 C/A',
                      '2':'L1 P',
                      '3':'L2 C/A',
                      '4':'L2 P' } }, 
    Galileo : { flag:'🇪🇺', ch:'E', sv:[1, 36], sbas:[37,64],
                sig:{ '1':'E5a',
                      '2':'E5b',
                      '3':'E5a+b',
                      '4':'E6-A',
                      '5':'E6-BC',
                      '6':'E1-A',
                      '7':'E1-BC' } },
    BeiDou  : { flag:'🇨🇳', ch:'B', sv:[1, 63], // aka BDS 
                sig:{ '1':'B1I',
                      '2':'B1Q',
                      '3':'B1C',
                      '4':'B1A',
                      '5':'B2-a',
                      '6':'B2-b',
                      '7':'B2 a+b',
                      '8':'B3I',
                      '9':'B3Q',
                      'A':'B3A',
                      'B':'B2I',
                      'C':'B2Q' } },
    // regional systems
    QZSS    : { flag:'🇯🇵', ch:'Q', sv:[1, 10], // Quasi-Zenith Satellite System  PRN 183, 184/196, 189/197, 185/200
                sig:{ '1':'L1 C/A',
                      '2':'L1C (D)',
                      '3':'L1C (P)',
                      '4':'LIS',
                      '5':'L2C-M',
                      '6':'L2C-L',
                      '7':'L5-I',
                      '8':'L5-Q',
                      '9':'L6D',
                      'A':'L6E' } }, 
    NavIC   : { flag:'🇮🇳', ch:'I', sv:[1, 14], // Indian Regional Navigation Satellite System (aka NavIC)
                sig:{ '1':'L5-SPS',
                      '2':'S-SPS',
                      '3':'L5-RS',
                      '4':'S-RS',
                      '5':'L1-SPS' } }, 
    // IMES    : { flag:'🇯🇵', ch:'Q', sig:{ '1':'L1 C/A' } }, // Japanese Indoor Messaging System 
    // Augmentation systems
    WAAS    : { flag:'🇺🇸', ch:'S', sig:{ '1':'L1 C/A' } }, // Wide Area Augmentation System
    SDCM    : { flag:'🇷🇺', ch:'S', sig:{ '1':'L1 C/A' } }, // System for Differential Corrections and Monitoring
    EGNOS   : { flag:'🇪🇺', ch:'S', sig:{ '1':'L1 C/A' } }, // European Geostationary Navigation Overlay Service
    GAGAN   : { flag:'🇮🇳', ch:'S', sig:{ '1':'L1 C/A' } }, // GPS Aided Geo Augmented Navigation
    MSAS    : { flag:'🇯🇵', ch:'S', sig:{ '1':'L1 C/A' } }, // Multi-functional Satellite Augmentation System
    NSAS    : { flag:'🇳🇬', ch:'S', sig:{ '1':'L1 C/A' } }, // Nigerian Satellite Augmentation System
    GATBP   : { flag:'🇦🇺', ch:'S', sig:{ '1':'L1 C/A' } }, // Geoscience Australia (SBAS) Test-Bed Project
    BDSBAS  : { flag:'🇨🇳', ch:'S', sig:{ '1':'L1 C/A' } }, // BeiDou Satellite Based Augmentation System
    KAAS    : { flag:'🇰🇷', ch:'S', sig:{ '1':'L1 C/A' } }, // South Korea Area Augmentation System
    SBAS    : { flag:'🏳️', ch:'S', sig:{ '1':'L1 C/A' },
                map:{ // https://media.defense.gov/2018/Aug/07/2001951699/-1/-1/1/L1%20CA%20PRN%20CODE%20ASSIGNMENTS%20JULY%202018.PDF
                        // PRN  System      Satellite      Orbital Slot    Effective Date
                        120:'EGNOS',  // INMARSAT 3F2         15.5 W    Current
                        121:'EGNOS',  // INMARSAT 3F5           25 E    Active until Apr 2024
                        122:'GATBP',  // INMARSAT 4F1        143.5 E    Active until Jan 2019
                        123:'EGNOS',  // ASTRA 5B             31.5 E    Active until Nov 2021
                        124:'EGNOS',  // Reserved                       Active until Apr 2024
                        125:'SDCM',   // Luch-5A                16 W    Active until Dec 2021
                        126:'EGNOS',  // INMARSAT 4F2           25 E    Active until Apr 2019
                        127:'GAGAN',  // GSAT-8                 55 E    Active until Sep 2020
                        128:'GAGAN',  // GSAT-10                83 E    Active until Sep 2020
                        129:'MSAS',   // MTSAT-2               145 E    Active until Jan 2020
                        130:'BDSBAS', // G6                     80 E    Active until Oct 2020
                        131:'WAAS',   // Eutelsat 117WB        117 W    Active until Mar 2028
                        132:'GAGAN',  // GSAT-15              93.5 E    Active until Nov 2025
                        133:'WAAS',   // INMARSAT 4F3           98 W    Active until Oct 2029
                        134:'KAAS',   // INMARSAT 5F3          178 E    Active until Jun 2021
                        135:'WAAS',   // Intelsat Galaxy 15    133 W    Active until Jul 2019
                        136:'EGNOS',  // ASTRA 4B                5 E    Active until Nov 2021
                        137:'MSAS',   // MTSAT-2               145 E    Active until Jan 2020
                        138:'WAAS',   // ANIK-F1R              107.3    Active until Jul 2022
                        // more
                        140:'SDCM',   // Luch-5B                95 E    Active until Dec 2021
                        141:'SDCM',   // Luch-4                167 E    Active until Dec 2021
                        143:'BSSBAS', // G3                   110.5E    Active until Dec 2020
                        144:'BSSBAS', // G1                    140 E    Active until Dec 2020
                        147:'NSAS',   // NIGCOMSAT-1R         42.5 E    Active until Oct 2018
                        148:''    ,   // ALCOMSAT-1           24.8 W    Active until Jan 2019
                    }, },
    PointPerfect : { flag:'🏳️', ch:'PP', 
                        freq: {
                        eu: 1545260000,
                        us: 1556290000,
                        } },
};