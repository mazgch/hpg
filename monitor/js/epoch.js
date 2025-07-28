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

// Epoch
// ------------------------------------------------------------------------------------

const Epoch = (function () {

const gnssLut = {
    GPS     : { flag:'us', ch:'G', sv:[1, 32], sbas:[33,64],
                sig:{ '1':'L1 C/A',
                      '5':'L2C-M',
                      '6':'L2C-L',
                      '7':'L5-I',
                      '8':'L5-Q' } }, 
    GLONASS : { flag:'ru', ch:'R', sv:[65,99], sbas:[33,64],
                sig:{ '1':'L1 OF',
                      '3':'L2 OF' } }, 
    Galileo : { flag:'eu', ch:'E', sv:[1, 36], sbas:[37,64],
                sig:{ '1':'E5 a',
                      '2':'E5 b',
                      '7':'E1 BC' } },
    BeiDou  : { flag:'cn', ch:'B', sv:[1, 63], // aka BDS 
                sig:{ '1':'B1I',
                      '3':'B1C',
                      '5':'B2a',
                      'B':'B2I' } }, // to be confirmed 
    // regional systems
    IRNSS   : { flag:'in', ch:'I', sv:[1, 14], // Indian Regional Navigation Satellite System (aka NavIC)
                sig:{ '1':'L5 A' } }, 
    QZSS    : { flag:'jp', ch:'Q', sv:[1, 10], // Quasi-Zenith Satellite System  PRN 183, 184/196, 189/197, 185/200
                sig:{ '1':'L1C/A',
                      '4':'LIS',
                      '5':'L2 CM',
                      '6':'L2 CL',
                      '7':'L5 I',
                      '8':'L5 Q' } }, 
    IMES    : { flag:'jp', ch:'Q', }, // Japanese Indoor Messaging System 
    // Augmentation systems
    WAAS    : { flag:'us', ch:'S', }, // Wide Area Augmentation System
    SDCM    : { flag:'ru', ch:'S', }, // System for Differential Corrections and Monitoring
    EGNOS   : { flag:'eu', ch:'S', }, // European Geostationary Navigation Overlay Service
    GAGAN   : { flag:'in', ch:'S', }, // GPS Aided Geo Augmented Navigation
    MSAS    : { flag:'jp', ch:'S', }, // Multi-functional Satellite Augmentation System
    NSAS    : { flag:'ni', ch:'S', }, // Nigerian Satellite Augmentation System
    GATBP   : { flag:'au', ch:'S', }, // Geoscience Australia (SBAS) Test-Bed Project
    BDSBAS  : { flag:'cn', ch:'S', }, // BeiDou Satellite Based Augmentation System
    KAAS    : { flag:'kr', ch:'S', }, // South Korea Area Augmentation System
    SBAS    : { flag:'un', ch:'S',
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
    PointPerfect : { flag:'un', ch:'PP', 
                     freq: {
                        eu: 1545260000,
                        us: 1556290000,
                     } },
};
const flagsEmojy = {
    'us': '🇺🇸',
    'ru': '🇷🇺', 
    'eu': '🇪🇺',
    'cn': '🇨🇳',
    'in': '🇮🇳',
    'jp': '🇯🇵,',
    'ni': '🇳🇬',
    'au': '🇦🇺',
    'kr': '🇰🇷',
    'un': '🏳️', // 🇺🇳
};

var nmeaSvUsed = [];
var nmeaSvDb = { freqs:0 };
var oldSvDb = { freqs:0 };
// convert some fields to text
const mapNmeaStatus = { 
    'V':'Data invalid',
    'A':'Data valid',
};
const mapNmeaNavMode = {
    '3':'3D fix',
    '2':'2D fix',
    '1':'No fix',
}
const mapEsfFusionMode = {
    '0':'Initilizing',
    '1':'Fusion Mode',
    '2':'Temporary Disabled',
    '3':'Disabled',
}
const mapEsfCalibMode = {
    '0':'Initialization',
    '1':'Fusion Mode',
    '2':'Suspended',
    '3':'Disabled',
}
const mapNmeaQuality = {
    '8':'Simulation',
    '7':'Manual input',
    '6':'Estimated/Dead reckoning fix',
    '5':'RTK float',
    '4':'RTK fixed',
    '3':'PPS fix',
    '2':'Differential GNSS fix',
    '1':'Autonomous GNSS fix',
    '0':'No fix',
};
const mapNmeaPosMode = {
    'N':'No fix', 
    'E':'Estimated/Dead reckoning fix', 
    'A':'Autonomous GNSS fix', 
    'D':'Differential GNSS fix', 
    'F':'RTK float', 
    'R':'RTK fixed', 
};
const mapNmeaOpMode = {
    'M':'Manually set to 2D or 3D mode',
    'A':'Automatic 2D or 3D mode',
};

const mapNmeaSignalId = {  1:'GPS',  2:'GLONASS',  3:'Galileo',  4:'BeiDou',  5:'QZSS',  6:'IRNSS', };
const mapNmeaTalker   = { GP:'GPS', GL:'GLONASS', GA:'Galileo', GB:'BeiDou', GQ:'QZSS', GI:'IRNSS', GN:'GNSS', BD:'BeiDou', };

const epochFields = {
    date:   { name: 'Date UTC',                            unit:'yyyy-mm-dd'         },
    time:   { name: 'Time UTC',                            unit:'hh:mm:ss.sss'       },
    wno:    { name: 'GPS week number',                     unit:'s',          prec:3,   descr:'weeks since 1980-01-06 modulo 1024' },
    itow:   { name: 'GPS time of week',                    unit:'s',          prec:3,   descr:'offset by leap seconds to UTC' },
    // 3D Position
    fix:    { name: 'Position fix',                                                 },
    ecefX:  { name: 'ECEF X coordinate',                   unit:'m',          prec:3 },
    ecefY:  { name: 'ECEF Y coordinate',                   unit:'m',          prec:3 },
    ecefZ:  { name: 'ECEF Z coordinate',                   unit:'m',          prec:3 },
    pAcc:   { name: 'Position accuracy estimate',          unit:'m',          prec:3 },
    // 2D Horizontal Porition
    lat:    { name: 'Latitude',                            unit:'degrees',    prec:8 },
    lng:    { name: 'Longitude',                           unit:'degrees',    prec:8 },
    hAcc:   { name: 'Horizontal accuarcy estimate',        unit:'m',          prec:3 },
    // Vertical
    height: { name: 'Height above ellipsoid',              unit:'m',          prec:3 },
    msl:    { name: 'Height above mean sea level',         unit:'m',          prec:3 },
    sep:    { name: 'Geoidal separation',                  unit:'m',          prec:3 },
    vAcc:   { name: 'Vertical position accuarcy',          unit:'m',          prec:3 },
    // Velocitiy
    ecefVX: { name: 'ECEF X velocity',                     unit:'m/s',        prec:3 },
    ecefVY: { name: 'ECEF Y velocity',                     unit:'m/s',        prec:3 },
    ecefVZ: { name: 'ECEF Z velocity',                     unit:'m/s',        prec:3 },
    sAcc:   { name: 'Velocity (3D) accuarcy',              unit:'m/s',        prec:3 },
    // Speed
    speed:  { name: 'Speed (3-D)',                         unit:'m/s',        prec:3 },
    gSpeed: { name: 'Ground Speed (2-D)',                  unit:'m/s',        prec:3 },
    velN:   { name: 'NED north velocity',                  unit:'m/s',        prec:3 },
    velE:   { name: 'NED east velocity',                   unit:'m/s',        prec:3 },
    velD:   { name: 'NED down velocity',                   unit:'m/s',        prec:3 },
    // Heading
    heading:{ name: 'Heading of motion 2-D',               unit:'degrees',    prec:2 },
    cogt:   { name: 'Course over Ground',                  unit:'degrees',    prec:2 }, // == heading
    cAcc:   { name: 'Heading accuracy estimate',           unit:'degrees',    prec:2 },
    // DOP / satellites
    numSV:  { name: 'Number of Satellites',                                   prec:0 },
    gDop:   { name: 'Geometric DOP',                                          prec:2 },
    pDop:   { name: 'Position DOP',                                           prec:2 },
    hDop:   { name: 'Horizontal DOP',                                         prec:2 },
    vDop:   { name: 'Vertical DOP',                                           prec:2 },
    nDop:   { name: 'Northing DOP',                                           prec:2 },
    eDop:   { name: 'Easting DOP',                                            prec:2 },
    tDop:   { name: 'Time DOP',                                               prec:2 },
    // Portection Level
    plPosValid: { name: 'Position protection level valid',                                   hide:true }, // assuming frame PL 3
    plPos1:     { name: 'Position protection level major',           unit:'m',       prec:3  },
    plPos2:     { name: 'Position protection level minor',           unit:'m',       prec:3  },
    plPos3:     { name: 'Position protection level vertical',        unit:'m',       prec:3  },
    plPosHorOr: { name: 'Position protection level orientation',     unit:'degrees', prec:1  },
    plVelValid: { name: 'Velocity protection level valid',                                   hide:true }, // assuming frame PL 3
    plVel1:     { name: 'Velocity protection level major',           unit:'m/s',     prec:3, hide:true },
    plVel2:     { name: 'Velocity protection level minor',           unit:'m/s',     prec:3, hide:true },
    plVel3:     { name: 'Velocity protection level vertical',        unit:'m/s',     prec:3, hide:true },
    plVelHorOr: { name: 'Velocity protection level orientation', unit:'degrees', prec:1, hide:true },
    // status
    status: { name: 'NMEA valid status',                   map:mapNmeaStatus          },
    posMode:{ name: 'NMEA position mode',                  map:mapNmeaPosMode         },
    opMode: { name: 'NMEA operation status',               map:mapNmeaOpMode          },
    navMode:{ name: 'NMEA navigation mode',                map:mapNmeaNavMode         },
    quality:{ name: 'NMEA quality',                        map:mapNmeaQuality         },
    // 
    fusionMode: { name: 'ESF fusion mode',                 map:mapEsfFusionMode,      } ,
    lBebn0: { name: 'LBAND Eb/N0',                         unit:'dB',         prec:1  } ,
    lBcn0:  { name: 'LBAND C/N0',                          unit:'dB',         prec:1  } ,
    // internals
    epIndex: { name: 'Epoch index',                                                   } ,
    epNumMsg:{ name: 'Messages in epoch',                                      prec:0 } ,
    epBytes: { name: 'Bytes in epoch',                      unit:'Bytes',      prec:0 } ,
};

function epochCheck(epoch, message) {
    const fields = message.fields;
    if (isDef(fields.time)) {
        return fields.time !== epoch.fields.time;
    } else if (isDef(fields.itow)) {
        return getTimeItow(fields.itow) !== epoch.fields.time;
    }
    const msgId = ['RMC', 'VTG', 'GGA', 'GNS'];
    return msgId.includes(message.id) && epoch.ids[message.id];
}

function epochFill(epoch, fields, keys=[]) {
    keys.forEach(key => {
        if (key in fields) {
            epoch[key] = jsonSanitizeNum(fields[key]);
        }
    });
    // fix
    if (isDef(fields.fixType) && isDef(fields.flags.fixOk)) {
        // from UBX
        const map = { 5: 'TIME', 4: '3D+DR', 3: '3D', 2: '2D', 1: 'DR' }; 
        epoch.fix = (0 == fields.flags.fixOk) ? 'BAD'  :
                    isDef(map[fields.fixType]) ? map[fields.fixType] : 'NO';
    } else {
        /* from  NMEA
        status  quality  navMode posMode 
            V       0        1       N      V = data invalid, A = data valid
            V       0        1       N      GNSS fix, but user limits exceeded
            V       6        2       E      Dead reckoning fix, but user limits exceeded
            A       6        2       E      Dead reckoning fix
            A      1/2       2      A/D     2D GNSS fix        
            A      1/2       3      A/D     3D GNSS fix        
            A      1/2       3      A/D     Combined GNSS/dead reckoning fix  
        */
        if (isDef(fields.status)) {
        const map = { 'V': 'BAD' }; // V = data invalid, A = data valid
        epoch.fix = isDef(map[fields.status]) ? map[fields.status] : epoch.fix;
        } else {
        if (isDef(fields.quality)) {
            const map = { 5: 'FLOAT', 4: 'FIXED', 2: 'DGPS', 1: '2D/3D', 6: 'DR' }; 
            epoch.fix = isDef(map[fields.quality]) ? map[fields.quality] : 'NO';
        } else if (isDef(fields.posMode)) {
            const map = { 'S':'SIM', 'M':'MANUAL', 'F':'FLOAT', 'R':'FIXED', 'D':'DGPS', 'A':'2D/3D', 'E':'DR' }; 
            epoch.fix = isDef(map[fields.posMode]) ? map[fields.posMode] : 'NO';
        }
        if (isDef(epoch.fix) && isDef(fields.navMode) && ("2D/3D" === epoch.fix)) {
            const map = { '3': '3D', '2': '2D' }; 
            epoch.fix = isDef(map[fields.navMode]) ? map[fields.navMode] : epoch.fix;
        }
        }
    }
    // date / time
    if (!isDef(epoch.date) && isDef(fields.year) && isDef(fields.month) && isDef(fields.day)) {
        epoch.date = fmtDate(fields.year, fields.month, fields.day);
    }
    if (!isDef(epoch.time)) {
        if (isDef(fields.hour) && isDef(fields.min) && isDef(fields.sec)) {
            epoch.time = fmtTime(fields.hour, fields.min, fields.sec);
        }
        else if (isDef(fields.itow)) {
            epoch.time = getTimeItow(fields.itow);
        }
    }
    // location
    if (!isDef(epoch.lng) && isDef(fields.longN) && isDef(fields.longI)) {
        epoch.lng = jsonSanitizeNum((fields.longI === 'W') ? -fields.longN : fields.longN);
    }
    if (!isDef(epoch.lat) && isDef(fields.latN) && isDef(fields.latI)) {
        epoch.lat = jsonSanitizeNum((fields.latI === 'S') ? -fields.latN : fields.latN);
    }
    // speed
    if (!isDef(epoch.gSpeed)) {
        if (isDef(fields.spdKm))
        epoch.gSpeed = jsonSanitizeNum(0.06 * fields.spdKm);
        else if (isDef(fields.spdKn))
        epoch.gSpeed = jsonSanitizeNum(0.11112 * fields.spdKn);
    }
    // altitude 
    if (isDef(fields.sep)) {
        if (!isDef(epoch.height) && isDef(fields.msl)) {
        epoch.height = jsonSanitizeNum(fields.msl + fields.sep);
        }
        else if (!isDef(epoch.msl) && isDef(fields.height)) {
        epoch.msl = jsonSanitizeNum(fields.height - fields.sep);
        }
    } else if (isDef(fields.height) && isDef(fields.msl)) {
        epoch.sep = jsonSanitizeNum(fields.height - fields.msl);
    }
    epoch = jsonSanitize(epoch);
}

function isDef(value) {
    return undefined !== value;
}

const LEAP_SECONDS = 18;
function getTimeItow(itow) {
    const LEAP_SECONDS = 18;
    const itowleap = (itow % 86400) - LEAP_SECONDS
    let tod = (itowleap < 0 ? itowleap + 86400 : itowleap);
    const h = Math.floor(tod / 3600);
    tod = (tod - (h * 3600));
    const m = Math.floor(tod / 60);
    const s = tod - (m * 60);
    return fmtTime(h, m, s);
}

function fmtTime(h, m, s) {
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    const ss = String(Math.floor(s)).padStart(2, '0');
    const sss = String(Math.round((s % 1) * 1000)).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${sss}`;
}

function fmtDate(y, m, d) {
    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    return `${y}-${mm}-${d}`;
}

// Helpers
// ------------------------------------------------------------------------------------

function jsonSanitize(obj) {
    // sanitize the json object
    if (Array.isArray(obj)) {
        return obj.map(jsonSanitize).filter(jsonSanitizeObj);
    } else if ((typeof obj === 'object') && obj !== null) {
        const result = {};
        const objs = Object.entries(obj);
        for (const [key, rawObj] of objs) {
            const sanObj = jsonSanitize(rawObj)
            if(jsonSanitizeObj(sanObj)) {
                result[key] = sanObj;
            }
        }
        return result;
    } else if (typeof obj === 'number') {
        return jsonSanitizeNum(obj);
    } else if ((typeof obj === 'string') && !isNaN(obj) && obj.trim() !== '') {
        return jsonSanitizeNum(obj);
    } else {
        return obj;
    }
}
  
function jsonSanitizeObj(obj) {
    // no undefined, null objects or empty strings
    return (obj !== undefined) && (obj !== null) && 
        !((typeof obj === 'string') && (obj.trim() === ''));
}
  
function jsonSanitizeNum(obj) {
    // lets round to some digits to avoid excessive numbers 
    const m = String(obj).match(/^-?\d*(\.?\d*(e[+-]?\d+)?)?$/i);
    if (m) {
        const num = Number(obj);
        return (m[1] && (10 < m[1].length)) ? Number(num.toFixed(10)) : num;
    }
    return obj;
}

return { gnssLut: gnssLut, flagsEmojy: flagsEmojy, epochFields: epochFields, 
         epochCheck:epochCheck, epochFill:epochFill };
})();

// ------------------------------------------------------------------------------------
