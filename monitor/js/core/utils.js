
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

  /*xport GNSS_SIGNAL_LUT = {
    
    BeiDou      B1I D1          3 0 (4)4 (1)5 4 1
    BeiDou      B1I D2          3 1 (4)4 (1)5 4 1
    BeiDou      B2I D1          3 2 (4)4 (3)5 4 B
    BeiDou      B2I D2          3 3 (4)4 (3)5 4 B
    BeiDou      B3I D1          3 4 (4)4 N/A 4 8
    BeiDou      B3I D2          3 10 (4)4 N/A 4 8
    BeiDou      B1 Cp (pilot)   3 5 (4)4 N/A 4 3
    BeiDou      B1 Cd (data)    3 6 (4)4 N/A 4 3
    BeiDou      B2 ap (pilot)   3 7 (4)4 N/A 4 5
    BeiDou      B2 ad (data)    3 8 (4)4 N/A 4 5
    
    QZSS        L1C/A           5 0 (1)4 (1)5 5 1
    QZSS        L1S             5 1 (1)4 (4)5 5 4
    QZSS        L2 CM           5 4 (1)4 (5)5 5 5
    QZSS        L2 CL           5 5 (1)4 (6)5 5 6
    QZSS        L5 I            5 8 (1)4 N/A 5 7
    QZSS        L5 Q            5 9 (1)4 N/A 5 8
    QZSS        L1C/B           5 12 (1)4 N/A 5 N/A
    
    NavIC       L5 A3           7 0 N/A N/A 6 1


    Galileo     E5 aI           2 3 3 1 3 1
    Galileo     E5 aQ           2 4 3 1 3 1
    Galileo     E5 bI           2 5 3 2 3 2
    Galileo     E5 bQ           2 6 3 2 3 2
    Galileo     E6 B            2 8 3 5 3 5
    Galileo     E6 C            2 9 3 5 3 5
    Galileo     E6 A            2 10 3 4 3 4
  
}*/

export const GNSS_LUT = {
    GPS     : { flag:'🇺🇸', ch:'G', 
                sigNmea:{ 
                    '1':'L1', '2':'L1', '3':'L1', '9':'L1',
                    '4':'L2', '5':'L2', '6':'L2',
                    '7':'L5', '8':'L5' },
                sigUbx: {
                    0:'L1',     
                    3:'L2', 4:'L2',
                    6:'L5', 7:'L5' } }, 
    GLONASS : { flag:'🇷🇺', ch:'R',
                sigNmea: { 
                    '1':'L1', '2':'L1',
                    '3':'L2', '4':'L2' },
                sigUbx:{
                    0:'L1',     
                    2:'L2' } }, 
    Galileo : { flag:'🇪🇺', ch:'E',
                sigNmea: { 
                    '1':'E5', 2:'E5', 3:'E5',
                    '4':'E6', 5:'E6',
                    '6':'E1', 7:'E1' },
                sigUbx: {
                    0:'E1', 1:'E1',
                    3:'E5', 4:'E5', 
                    5:'E5', 6:'E5', 
                    8:'E6', 9:'E6', 10:'E6'
                     } },
    BeiDou  : { flag:'🇨🇳', ch:'B', // aka BDS 
                sigNmea:{ 
                    '1':'B1', '2':'B1', '3':'B1', '4':'B1',
                    '5':'B2', '6':'B2', '7':'B2', 'B':'B2', 'C':'B2',
                    '8':'B3', '9':'B3', 'A':'B3' },
                sigUbx: {
                    0:'B1',  1:'B1', 5:'B1', 6:'B1',
                    2:'B2',  3:'B2', 7:'B2', 8:'B2', 
                    4:'B3', 10:'B3' } },
    // regional systems
    QZSS    : { flag:'🇯🇵', ch:'Q', // Quasi-Zenith Satellite System  PRN 183, 184/196, 189/197, 185/200
                sigNmea:{ 
                    '1':'L1', '2':'L1', '3':'L1', '4':'L1',        
                    '5':'L2', '6':'L2',
                    '7':'L5', '8':'L5',
                    '9':'L6', 'A':'L6' },
                sigUbx: {
                    0:'L1', 1:'L1', 12:'L1',
                    4:'L2', 5:'L2',
                    8:'L5', 9:'L5' } }, 
    NavIC   : { flag:'🇮🇳', ch:'N', // Indian Regional Navigation Satellite System (aka NavIC)
                sigNmea:{ 
                    1:'L5', 2:'S',
                    3:'L5', 4:'S',
                    5:'L1' },
                sigUbx: {
                    0:'L5',
                    1:'L1' } }, 
    // IMES    : { flag:'🇯🇵', ch:'Q', sig:{ '1':'L1 C/A' } }, // Japanese Indoor Messaging System 
    // Augmentation systems
    WAAS    : { flag:'🇺🇸', ch:'S', sigNmea:{ 1:'L1'}, sigUbx:{ 0:'L1' } } , // Wide Area Augmentation System
    SDCM    : { flag:'🇷🇺', ch:'S', sigNmea:{ 1:'L1'}, sigUbx:{ 0:'L1' } }, // System for Differential Corrections and Monitoring
    EGNOS   : { flag:'🇪🇺', ch:'S', sigNmea:{ 1:'L1'}, sigUbx:{ 0:'L1' } }, // European Geostationary Navigation Overlay Service
    GAGAN   : { flag:'🇮🇳', ch:'S', sigNmea:{ 1:'L1'}, sigUbx:{ 0:'L1' } }, // GPS Aided Geo Augmented Navigation
    MSAS    : { flag:'🇯🇵', ch:'S', sigNmea:{ 1:'L1'}, sigUbx:{ 0:'L1' } }, // Multi-functional Satellite Augmentation System
    NSAS    : { flag:'🇳🇬', ch:'S', sigNmea:{ 1:'L1'}, sigUbx:{ 0:'L1' } }, // Nigerian Satellite Augmentation System
    GATBP   : { flag:'🇦🇺', ch:'S', sigNmea:{ 1:'L1'}, sigUbx:{ 0:'L1' } }, // Geoscience Australia (SBAS) Test-Bed Project
    BDSBAS  : { flag:'🇨🇳', ch:'S', sigNmea:{ 1:'L1'}, sigUbx:{ 0:'L1' } }, // BeiDou Satellite Based Augmentation System
    KAAS    : { flag:'🇰🇷', ch:'S', sigNmea:{ 1:'L1'}, sigUbx:{ 0:'L1' } }, // South Korea Area Augmentation System
    SBAS    : { flag:'🏳️', ch:'S', sigNmea:{ 1:'L1'}, sigUbx:{ 0:'L1' } ,
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