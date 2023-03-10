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

// Configuration
// ------------------------------------------------------------------------------------
const CHART_POINTS   = 60;

// make sure we have no CORS issue
let MOD_DIR = '/';
let OPT = {};
// ------------------------------------------------------------------------------------
/* START OF MODULE */ var USTART = (function () {
// ------------------------------------------------------------------------------------

window.clickLink = function _clickLink(link) {
    let el = window.open(link,'_blank');
    if (el) el.focus();
} 

// Init
// ------------------------------------------------------------------------------------
window.onload = function _onload() {
    if (window.location.protocol == 'https:') {
        window.location.protocol = 'http:';
    }

	feather.replace();
    
	// evaluate the url arguments
    OPT = window.location.search.substring(1).split("&").reduce(_splitArgs, {});
    function _splitArgs(result, value) {
        var p = value.split('=');
        if (p[0]) result[decodeURIComponent(p[0])] = p[1] ? decodeURIComponent(p[1]) : true;
        return result;
    }
	if (!OPT.dbg) window.onerror = reportErrors;
	window.onbeforeunload = function _unload() {
        Device.deviceUninit();
    }

	if (Chart !== undefined) {
		Chart.defaults.responsive = true; 
        Chart.defaults.layout.padding = { left: 10, right: 10, top: 10, bottom: 10 };
        Chart.defaults.animation = false;
        Chart.defaults.transitions.active.animation.duration = 0;
        Chart.defaults.transitions.resize.animation.duration = 0;
        Chart.defaults.plugins.tooltip.callbacks.label = function noToolTip(tooltipItem) { return ''; };
		Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(245,245,245,0.8)';
		Chart.defaults.plugins.tooltip.borderColor = '#888';
		Chart.defaults.plugins.tooltip.borderWidth = 1;
		Chart.defaults.plugins.tooltip.cornerRadius = 0;
		Chart.defaults.plugins.tooltip.titleColor = '#000';//titleFontColor = '#000';
		Chart.defaults.plugins.tooltip.titleFont.size = 10;
		Chart.defaults.plugins.tooltip.bodyColor = '#000';
		Chart.defaults.plugins.tooltip.bodyFont.size = 10;
		Chart.defaults.plugins.tooltip.displayColors = false;
        Chart.defaults.plugins.legend.display = false;
    }
	setTimeout( function _initAll(){
		Device.deviceInit(OPT.ip); // also wait for this as it may still see the old port leave ...
		Console.init();
		//Script.scriptInit();
		dbInit();
		//drawInstruments();
	} , 1000);
}

function reportErrors(msg , url, lineNo , columnNo, error) {
	let el = document.getElementById('crash-message');
	if (el) {
		const loc = '<pre>' + url + ':' + lineNo + ((columnNo) ? ': ' + columnNo : '') + '</pre>';
		const err = (error && error.stack) ? '<pre>' + error.stack : '</pre>';
		const txt = '<div class="grid"><b>' + msg + '</b>' + loc + err + '</div>';
		el.innerHTML = txt;
		el.removeAttribute('hidden');
		setTimeout( function _timeout() { el.setAttribute('hidden',''); }, 10000);
	}
	return false;
};

function resetGui() {
	Console.reset();
	let els = document.getElementsByClassName('dbvalue');
	for (let i = 0; (i < els.length); i ++) {
		els[i].textContent = '';
		els[i].parentNode.setAttribute('hidden','');
	}
    dbClear();

	let el = document.getElementById('sv_list');
	if (el) el.textContent = '';
	if (undefined !== map) {
		map.setTarget(null);
		map = undefined;
		el = document.getElementById('map');
		el.setAttribute('hidden','');
	}
	let tiles = [ 'tile_satellite',  'tile_messages', 'tile_parameter', 'tile_automate', 'tile_position', 'tile_script'];
	tiles.forEach( _tileIter );
	function _tileIter(tile) { 
		let el = document.getElementById(tile);
		if (el) el.setAttribute('hidden','');
	}
}

function httpGet(resolve, reject) {
	const request = new XMLHttpRequest();
	request.onload = function _onload() {
		if (this.status === 200)
			resolve(this.response);
		else 
			reject(new Error(this.statusText));
	};
	request.onerror = function _onerror() {
		reject(new Error('httpGet Error: '+this.statusText));
	};
	request.open('GET', url, true);
	request.responseType = responseType;
	request.send();
}

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
  //IMES    : { flag:'jp', ch:'Q', }, // Japanese Indoor Messaging System 
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

// navStatus: V = Equipment is not providing navigational status information			

const DB_LINES = 60+1;
const LEAP_SECONDS = 18;
let db = { // a database with values values to capture an report
    date:   new dbY( { name: 'Date UTC',                            unit:'yyyy-mm-dd',         } ),
    time:   new dbY( { name: 'Time UTC',                            unit:'hh:mm:ss.sss',       } ),
    wno:    new dbY( { name: 'GPS week number',                     unit:'s',          prec:3,   descr:'weeks since 1980-01-06 modulo 1024' } ),
    itow:   new dbY( { name: 'GPS time of week',                    unit:'s',          prec:3,   descr:'offset by leap seconds to UTC', } ),
	// 3D Position
    ecefX:  new dbY( { name: 'ECEF X coordinate',                   unit:'m',          prec:3, } ),
    ecefY:  new dbY( { name: 'ECEF Y coordinate',   		        unit:'m',          prec:3, } ),
    ecefZ:  new dbY( { name: 'ECEF Z coordinate',   		        unit:'m',          prec:3, } ),
    pAcc:   new dbY( { name: 'Position accuracy estimate',          unit:'m',          prec:3, } ),
    // 2D Horizontal Porition
    lat:    new dbY( { name: 'Latitude',                            unit:'degrees',    prec:8, } ),
    long:   new dbY( { name: 'Longitude',                           unit:'degrees',    prec:8, } ),
    hAcc:   new dbY( { name: 'Horizontal accuarcy estimate',        unit:'m',          prec:3, } ),
    // Vertical
    height: new dbY( { name: 'Height above ellipsoid',              unit:'m',          prec:3, } ),
    msl:    new dbY( { name: 'Height above mean sea level',         unit:'m',          prec:3, } ),
    sep:    new dbY( { name: 'Geoidal separation',                  unit:'m',          prec:3, } ),
    vAcc:   new dbY( { name: 'Vertical position accuarcy',          unit:'m',          prec:3, } ),
    // Velocities
    ecefVX: new dbY( { name: 'ECEF X velocity',                     unit:'m/s',        prec:3, } ),
    ecefVY: new dbY( { name: 'ECEF Y velocity',                     unit:'m/s',        prec:3, } ),
    ecefVZ: new dbY( { name: 'ECEF Z velocity',                     unit:'m/s',        prec:3, } ),
    sAcc:   new dbY( { name: 'Velocity (3D) accuarcy',              unit:'m/s',        prec:3, } ),
    // Speed
    speed:  new dbY( { name: 'Speed (3-D)',                         unit:'m/s',        prec:3, } ),
    gSpeed: new dbY( { name: 'Ground Speed (2-D)',                  unit:'m/s',        prec:3, } ),
    velN:   new dbY( { name: 'NED north velocity',                  unit:'m/s',        prec:3, } ),
    velE:   new dbY( { name: 'NED east velocity',                   unit:'m/s',        prec:3, } ),
    velD:   new dbY( { name: 'NED down velocity',                   unit:'m/s',        prec:3, } ),
    // Heading
    heading:new dbY( { name: 'Heading of motion 2-D',               unit:'degrees',    prec:2, } ),
    cogt:   new dbY( { name: 'Course over Ground',                  unit:'degrees',    prec:2, } ), // == heading
    cAcc:   new dbY( { name: 'Heading accuracy estimate',           unit:'degrees',    prec:2, } ),
    // DOP
    gDop:   new dbY( { name: 'Geometric DOP',                                          prec:2, } ),
    pDop:   new dbY( { name: 'Position DOP',                                           prec:2, } ),
    hDop:   new dbY( { name: 'Horizontal DOP',                                         prec:2, } ),
    vDop:   new dbY( { name: 'Vertical DOP',                                           prec:2, } ),
    nDop:   new dbY( { name: 'Northing DOP',                                           prec:2, } ),
    eDop:   new dbY( { name: 'Easting DOP',                                            prec:2, } ),
    tDop:   new dbY( { name: 'Time DOP',                                               prec:2, } ),
    // Portection Level
    plPosValid: new dbY( { name: 'Position protection level valid',       hide:true } ), // assuming frame PL 3
    plPos1: new dbY( { name: 'Position protection level major',           unit:'m',       prec:3, } ),
    plPos2: new dbY( { name: 'Position protection level minor',           unit:'m',       prec:3, } ),
    plPos3: new dbY( { name: 'Position protection level vertical',        unit:'m',       prec:3, } ),
    plPosHorOr: new dbY( { name: 'Position protection level orientation', unit:'degrees', prec:1, } ),
    plVelValid: new dbY( { name: 'Velocity protection level valid',       hide:true } ), // assuming frame PL 3
    plVel1: new dbY( { name: 'Velocity protection level major',           unit:'m/s',     prec:3, hide:true } ),
    plVel2: new dbY( { name: 'Velocity protection level minor',           unit:'m/s',     prec:3, hide:true } ),
    plVel3: new dbY( { name: 'Velocity protection level vertical',        unit:'m/s',     prec:3, hide:true } ),
    plVelHorOr: new dbY( { name: 'Velocity protection level orientation', unit:'degrees', prec:1, hide:true } ),
      // status
	status: new dbY( { name: 'NMEA valid status',                   map:mapNmeaStatus,		   } ),
    posMode:new dbY( { name: 'NMEA position mode',	                map:mapNmeaPosMode,	       } ),
    opMode: new dbY( { name: 'NMEA operation status',               map:mapNmeaOpMode, 		   } ),
    navMode:new dbY( { name: 'NMEA navigation mode',                map:mapNmeaNavMode,        } ),
    quality:new dbY( { name: 'NMEA quality',	                    map:mapNmeaQuality, 	   } ),
    // 
    fusionMode: new dbY( { name: 'ESF fusion mode',                 map:mapEsfFusionMode,      } ),
    lBebn0: new dbY( { name: 'LBAND Eb/N0',                         unit:'dB',         prec:1, } ),
    lBcn0:  new dbY( { name: 'LBAND C/N0',                          unit:'dB',         prec:1, } ),
    // internals
	epIndex:new dbY( { name: 'Epoch index',                                                    } ),
    epNumMsg:new dbY({ name: 'Messages in epoch',                                      prec:0, } ),
    epBytes:new dbY( { name: 'Bytes in epoch',                      unit:'Bytes',      prec:0, } ),
	// time series 
};
let dbUpdateReq = false; // if true Publish will Update the GUI
let epoch = { ids:{}, index:0, data:'', numMsg:0, }; // a database with all messages from the current epoch

let dbInt = { // a database with values values to capture and report
	time:    new dbY( { name: 'Local time',                         unit:'hh:mm:ss.sss',       } ),
	uptime:  new dbY( { name: 'Connect duration',                   unit:'hh:mm:ss.sss',       } ),
	msgRx:   new dbY( { name: 'Messages received',                  unit:'Messages/s', prec:0, } ),
	bytesRx: new dbY( { name: 'Bytes received',                     unit:'Bytes/s',    prec:0, } ),
	msgTx:   new dbY( { name: 'Messages transmitted',               unit:'Messages/s', prec:0, } ),
    bytesTx: new dbY( { name: 'Bytes transmitted',                  unit:'Bytes/s',    prec:0, } ),
};
let intStats = { bytesTx: 0, bytesRx: 0, msgTx: 0, msgRx: 0, bytesPend:0,};

function dbBase(opt) {
	for (let key in opt)
        this[key] = opt[key];
    this.nan = (0<=opt.prec) ? NaN : '';
    if (opt.map)
        this.cat = Object.keys(opt.map).reverse();
    this.array = [ ];
    this.carray = [ ];
    this.sta = 0;
    this.cnt = 0;
    this.len = 3600;
    // attach the api
    this.set = function(val, msg) {
        let sta = 0;
        if (undefined !== val) {
            if (0 <= this.prec) {
                val = Number(val);
                if (!isNaN(val)) sta = 1;
            } else {
                if (typeof val !== 'string')
                    val = val.toString();
                sta = 1;
            }
        }
        if (sta) {
            this.store(sta, val);
            if (msg) {
                this.msg = msg.protocol + ' ' + msg.name;
                this.time = msg.time;
            }
        }
    }
    this.hint = function() {
        if (this.map) {
            let list = [];
            for (let key in this.map) {
                list.push(key + ': ' + this.map[key]);
            }
            return list.join('\r\n');
        }
    }
    this.comment = function() {
        if (this.map) {
            const val = this.map[this.val];
            if (undefined !== val)
                return val;
        }
        return this.descr;
    }
    this.value = function(ix) {
        if (this.sta | this.cnt) {
            const val =  (undefined === ix) ? this.val : this.array[ix];
            return this.format(
                (undefined !== ix) ? this.array[ix] :
                (this.sta | this.cnt) ? this.val : '' );
        }
    }
    this.values = function() {
        let arr = [];
        for (let i = 0; i < this.array.length; i ++) {
            let val = this.array[i];
            arr[i] = this.format(val);
        }
        return arr;
    }
    this.clear = function() {
        this.sta = 0;
        this.cnt = 0;
        this.array.length = 0;
        this.carray.length = 0;
		this.onclear();
    }
    this.onclear = function() {
        console.log('cleared ' + this.name);
    }
    this.onpublish = function() {
        // attach an update function
    /*    console.log('publish' + this.name + ': ' + JSON.stringify(
            { value:this.value(), hint:this.comment(), values:this.values(), stats:this.stats(), }
        ));*/
    }
    this.format = function(val) {
        if (val === this.nan) return '';
        else if (0 <= this.prec)
            val = val.toFixed(this.prec);
        return val;
    }
    this.stats = function() {
        let cnt = this.cnt;
        const sta = this.sta;
        if (sta) cnt ++;
        const val = this.val;
        const txt = (cnt) ? this.format(val) : '';
        let ret = {};
        ret.cur = txt;
        ret.sta = ['no','yes','calc'][sta];
        ret.cnt = cnt;
        const prec = this.prec;
        if (0 <= prec) {
            if (1 < cnt) {
                let min = this.min;
                let max = this.max;
                let sum = this.sum;
                let sqr = this.sqr;
                if (sta) {
                    if (val < min) min = val;
                    if (val > max) max = val;
                    sum += val;
                    sqr += val * val;
                }
                const avg = (sum / cnt);
                let tmp = (sqr * cnt - sum * sum);
                tmp = tmp / (cnt * (cnt - 1));
                const variance = (Number.EPSILON > tmp) ? 0 : tmp;
                const stddev = Math.sqrt(variance);
                ret.min = min.toFixed(prec);
                ret.max = max.toFixed(prec);
                ret.avg = avg.toFixed(prec);
                ret.dev = stddev.toFixed(prec);
            } else if (0 < cnt) {
                ret.min = txt;
                ret.max = txt;
                ret.avg = txt;
            }
        }
        if (this.msg) ret.msg = this.msg;
        if (this.time) ret.time = this.time;
        if (cnt) ret.age = sta ? 0 : this.age;
        return ret;
    }
    this.calc = function() {
        const sta = this.sta;
        const val = this.val;
        const cnt = this.cnt;
        if (sta) {
            if (0 <= this.prec) {
                if (cnt) {
                    this.min = Math.min(val, this.min);
                    this.max = Math.max(val, this.max);
                    this.sum += val;
                    this.sqr += val * val;
                } else {
                    this.min = val;
                    this.max = val;
                    this.sum = val;
                    this.sqr = val * val;
                }
            }
            this.cnt = cnt+1;
            this.sta = 0;
            this.age = 0;
        }
        else if (cnt)
            this.age ++;
    }
}

function dbY(opt) {
    dbBase.call(this, opt);
    // attach / extend the api
    this.publish = function(param) {
        let len = this.array.length;
        let clen = this.carray.length;
        if ((0 === len) || this.grow) {
            if (this.len === len)
                this.array.shift();
            else len ++;
            this.array.push(this.nan);
            this.grow = false;
            
            if (CHART_POINTS === clen)
                this.carray.shift();
            else clen ++;
            this.carray.push(this.nan);
        }
        if (this.dirty) {
            this.array[len-1] = this.sta ? this.val : this.nan;
            this.carray[clen-1] = this.sta ? this.val : this.nan;
            this.onpublish(param);
            this.dirty = false;
        }
    }
    this.update = function() {
        this.calc();
        this.grow = true;
        this.dirty = true;
    }
    this.store = function(sta, val) {
        this.dirty = true;
        this.val = val;
        this.sta = sta;
    }
}

function dbTY(opt) {
    dbBase.call(this, opt);
    // attach / extend the api
    this.store = function (sta, val) {
        if (sta) {
            let ttag = new Date;
            this.ttag = ttag;
            this.val = val;
            this.sta = sta;
            if (this.len === this.array.length)
                this.array.shift();
            this.array.push( [ttag, val] );
            if (CHART_POINTS === this.carray.length)
                this.carray.shift();
            this.carray.push( [ttag, val] );
            this.onpublish();
            this.calc();
        }
    }
}

function formatDate(ttag) {
    return [1900+ttag.getYear(), _pad(1+ttag.getMonth(),2), _pad(ttag.getDate(),2)].join('-') + ' ' +
           [_pad(ttag.getHours(),2), _pad(ttag.getMinutes(),2), _pad(ttag.getSeconds(),2)].join(':') + '.' +
           _pad(ttag.getMilliseconds(),3);
    function _pad(v,l) { return ('0000'+v.toString()).slice(-l); }
}

function formatTime(ttag) {
    return [_pad(ttag.getHours(),2), _pad(ttag.getMinutes(),2), _pad(ttag.getSeconds(),2)].join(':') + '.' +
           _pad(ttag.getMilliseconds(),3);
    function _pad(v,l) { return ('0000'+v.toString()).slice(-l); }
}

function dbInit(){
	let el = document.getElementById('db_clear');
	if (el) el.addEventListener('click', dbClear);
	el = document.getElementById('db_save');
	if (el) el.addEventListener('click', dbSave);
	el = document.getElementById('db_kml');
    if (el) el.addEventListener('click', dbSaveKml);
    for (let name in db) {
        db[name].timebase = db.time.carray;
        if (db[name].hide !== true) {
            db[name].onpublish = dbOnPublish;
        }
        db[name].onclear = dbOnClear;
    }
    for (let name in dbInt) {
        dbInt[name].timebase = dbInt.time.carray;
        if (dbInt[name].hide !== true) {
            dbInt[name].onpublish = dbOnPublish
        } 
        dbInt[name].onclear = dbOnClear;
    }
    setInterval( function _oneSecondInterval() {
        // a one second maintainance timer
        let date = new Date();
        dbInt.time.set(formatTime(date));
        if (USTART.timeConnected !== undefined) {
            let diff = date - USTART.timeConnected;
            diff += date.getTimezoneOffset() * 60000;
            diff = new Date(diff);
            dbInt.uptime.set(formatTime(diff));
        }
        dbInt.bytesTx.set(intStats.bytesTx);
        dbInt.msgTx.set(intStats.msgTx);
        dbInt.bytesRx.set(intStats.bytesRx + intStats.bytesPend);
        dbInt.msgRx.set(intStats.msgRx);
        intStats.bytesTx = 0;
        intStats.bytesRx = 0;
        intStats.msgTx = 0;
        intStats.msgRx = 0;
        intStats.bytesPend = 0;
        
        let el = document.getElementById('dbInt');
        for (let name in dbInt) {
            const e = dbInt[name];
            e.publish(el)
            if (e.el) el = e.el.info ? e.el.info : e.el.row;
        }
        for (let name in dbInt) {
            dbInt[name].update(el)
        }
    }, 1000);
}

function dbSave(e) {
	e.preventDefault();
    const sep = (Array.toLocaleString) ? ['a','b'].toLocaleString().charAt(1) : ';';
	let text = '';
	let cols = { };
    let len = 0;
    for (let name in db) {
        const e = db[name];
		if (e.sta | e.cnt) {
            const values = e.values();
            len = Math.max(len, values.length);
			let object = { id:name, name:e.name, unit:e.unit };
            cols[name] = Object.assign( object, e.stats(), values );
        }
    }
	function _row(item) {
		let line = item;
		for (let name in cols) {
			line += sep + ((undefined !== cols[name][item]) ? cols[name][item] : '');
		}
		line += '\r\n';
		return line;
	}
	text += _row('name');
	text += _row('id');
	text += _row('unit');
	text += _row('sta');
	text += _row('cnt');
	text += _row('cur');
	text += _row('min');
	text += _row('max');
	text += _row('avg');
	text += _row('dev');
	for (let r = 0; r < len; r ++) {
		text += _row(r);
	}
	const blob = new Blob( [ text ], {type:'text/plain'});
	const link = window.URL.createObjectURL(blob);
	const tempLink = document.createElement('a');
	tempLink.download  = 'Exported.csv';
	tempLink.innerHTML = 'Download CSV File';
	tempLink.href      = link;
	tempLink.onclick   = function (e) { document.body.removeChild(e.target); };
	tempLink.setAttribute('hidden','');
	document.body.appendChild(tempLink);
	tempLink.click();
}

function dbSaveKml(e) {
    const coords = [];
    const coordsto = [];
    for (let r = 0; r < db.time.array.length; r ++) {
		const lon = db.long.array[r];
		const lat = db.lat.array[r];
		const msl = db.msl.array[r];
		if (!isNaN(lon) && !isNaN(lat) && !isNaN(msl)) {
			coords.push( [ lon, lat, msl ].join() );
			const vE = !isNaN(db.velE.array[r]) ? db.velE.array[r] : 0;
			const vN = !isNaN(db.velN.array[r]) ? db.velN.array[r] : 0;
			const vD = !isNaN(db.velD.array[r]) ? db.velD.array[r] : 0;
			coordsto.push( [ lon + vE / (111199.0 * Math.cos(lat * Math.PI / 180.0)), 
							 lat + vN /  111199.0, msl - vD].join() );
		}
	}
	//             aabbggrr
	const col   = 'ff596eff';
	const collt = 'cc596eff';
    let kml = '\
<?xml version="1.0" encoding="UTF-8"?>\r\n\
<kml xmlns="http://www.opengis.net/kml/2.2">\r\n\
<Document>\r\n\
	<name>GNSS Log</name>\r\n\
	<description>Created with ' + window.location.origin + '</description>\r\n\
	<open>1</open>\r\n\
	<StyleMap id="style">\r\n\
		<Pair>\r\n\
			<key>normal</key>\r\n\
			<Style>\r\n\
				<IconStyle>\r\n\
					<color>'+col+'</color>\r\n\
					<scale>0.21</scale>\r\n\
					<Icon>\r\n\
						<href>https://maps.google.com/mapfiles/kml/pal2/icon18.png</href>\r\n\
					</Icon>\r\n\
					<hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>\r\n\
				</IconStyle>\r\n\
				<LabelStyle>\r\n\
					<scale>0</scale>\r\n\
				</LabelStyle>\r\n\
			</Style>\r\n\
		</Pair>\r\n\
		<Pair>\r\n\
			<key>highlight</key>\r\n\
			<Style>\r\n\
				<IconStyle>\r\n\
					<color>'+col+'</color>\r\n\
					<scale>0.3</scale>\r\n\
					<Icon>\r\n\
						<href>https://maps.google.com/mapfiles/kml/pal2/icon18.png</href>\r\n\
					</Icon>\r\n\
					<hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>\r\n\
				</IconStyle>\r\n\
			</Style>\r\n\
		</Pair>\r\n\
	</StyleMap>\r\n\
	<Folder>\r\n\
		<name>Positions</name>\r\n';
	for (let i = 0; i < coords.length; i ++) {
		kml += '\
		<Placemark>\r\n\
			<name>Index '+i+'</name>\r\n\
			<description>Description '+i+'\r\n'+coords[i]+'</description>\r\n\
			<styleUrl>#style</styleUrl>\r\n\
			<Point>\r\n\
				<coordinates>'+coords[i]+'</coordinates>\r\n\
			</Point>\r\n\
		</Placemark>\r\n';
	}
	kml += '\
	</Folder>\r\n\
	<Placemark>\r\n\
		<name>Track</name>\r\n\
		<Style>\r\n\
			<LineStyle>\r\n\
				<color>'+col+'</color>\r\n\
				<width>1</width>\r\n\
			</LineStyle>\r\n\
		</Style>\r\n\
		<LineString>\r\n\
			<coordinates>' + coords.join(' ') + '</coordinates>\r\n\
		</LineString>\r\n\
	</Placemark>\r\n';
	kml += '\
	<Placemark>\r\n\
		<name>Speed Vectors</name>\r\n\
		<Style>\r\n\
			<LineStyle>\r\n\
				<color>'+collt+'</color>\r\n\
				<width>3</width>\r\n\
			</LineStyle>\r\n\
		</Style>\r\n\
		<MultiGeometry>\r\n';
	for (let i = 0; i < coords.length; i ++) {
		kml += '\
			<LineString>\r\n\
				<coordinates>' + coords[i] + ' ' + coordsto[i] + '</coordinates>\r\n\
			</LineString>\r\n';
	}	
	kml += '\
		</MultiGeometry>\r\n\
	</Placemark>\r\n\
</Document>\r\n\
</kml>';
    const blob = new Blob( [ kml ], {type:'application/vnd.google-earth.kml+xml'});
    const link = window.URL.createObjectURL(blob);
    const tempLink = document.createElement('a');
    tempLink.download  = 'Exported.kml';
    tempLink.innerHTML = 'Download KML File';
    tempLink.href      = link;
    tempLink.onclick   = function (e) { document.body.removeChild(e.target); };
    tempLink.setAttribute('hidden','');
    document.body.appendChild(tempLink);
    tempLink.click();
}

function dbClear(e) {
    if (e) e.preventDefault();
    epoch.ids = {};
    epoch.data = '';
    epoch.numMsg = 0;
    epoch.index = 0;
    for (let name in db)
        db[name].clear();
    for (let name in dbInt)
        dbInt[name].clear();
    clearMapTrack(e);
}

function dbOnClear() {
    // detach the gui
    if (this.chart) {
        this.chart.destroy();
        this.chart = undefined;
    }
    if (this.el) {
        if (this.el.row) this.el.row.parentNode.removeChild(this.el.row);
        if (this.el.info) this.el.info.parentNode.removeChild(this.el.info);
        this.el = undefined;
    }
}
function dbOnPublish(el) {
    if (this.sta | this.cnt) {
        if (undefined === this.el) {
            let tr = document.createElement('tr');
            let td = document.createElement('td');
            td.textContent = this.name;
            if (this.descr) td.title = this.descr;
            td.style.whiteSpace = 'nowrap';
            tr.appendChild(td);
            td = document.createElement('td');
            td.className = 'right';
            const hint = this.hint();
            if (hint) td.title = hint;
            this.el = { row: tr, value:td };
            tr.appendChild(td);
            td = document.createElement('td');
            if (this.unit) td.textContent = this.unit;
            if (this.map) this.el.comment = td;
            tr.appendChild(td);
            tr.dbEntry = this;
            tr.removeAttribute('hidden');
            tr.addEventListener('click', _onDatabaseRowClick);
            el.parentNode.insertBefore(tr, el.nextSibling);     // only ok if we dont have a child open
        }
        if (this.el.value)   this.el.value.textContent = this.value();
        if (this.el.comment) this.el.comment.textContent = this.comment();
        if (this.el.stats) { // we have a details view open
            let el = _makeTable(this.stats());
            if (el) this.el.stats.innerHTML = el.innerHTML;
        }
        if (this.chart) this.chart.update(0);
    }
    
    function _onDatabaseRowClick(e) {
        if (this.dbEntry) {
            const e = this.dbEntry;
            if (e.el.info) {
                if (e.chart) e.chart.destroy();
                if (e.el.info) e.el.info.parentNode.removeChild(e.el.info); // remove me
                e.el.info = undefined;
                e.el.stats = undefined;
                e.chart = undefined;
            } else {
                const tr = document.createElement('tr');
                tr.dbEntry  = this.dbEntry;
                tr.className = 'dbrow';
                tr.addEventListener('click', _onDatabaseRowClick);
                // the chart
                let td2 = document.createElement('td');
                td2.colSpan = 2;
                let div = _makeChart(e, this.parentNode.width);
                if (div) {
                    td2.appendChild(div);
                }
                tr.appendChild(td2);
                // the stats
                let td = document.createElement('td');
                td.colSpan = 1;
                table = document.createElement('table');
                const stats = e.stats();
                if (stats) {
                    table = _makeTable(stats);
                    if (table) {
                        e.el.stats = table;
                        td.appendChild(table);
                    }
                }
                tr.appendChild(td);
                // innner
                 e.el.info = this.parentNode.insertBefore(tr, this.nextSibling);
            }
        }
    }
    
    function _makeTable(stats) {
        let dump = '';
        dump += '<tr style="border-top-width:0;"><td colspan="2" style="padding-top:1em;"><b>Statistics<b></td></tr>';
        if (undefined !== stats.cur) dump += '<tr><td>Latest</td><td class="right">' + stats.cur + '</td></tr>';
        if (undefined !== stats.min) dump += '<tr><td>Minimum</td><td class="right">' + stats.min + '</td></tr>';
        if (undefined !== stats.max) dump += '<tr><td>Maximum</td><td class="right">' + stats.max + '</td></tr>';
        if (undefined !== stats.avg) dump += '<tr><td>Average</td><td class="right">' + stats.avg + '</td></tr>';
        if (undefined !== stats.dev) dump += '<tr><td title="Standard Deviation">Std. Dev.</td><td class="right">' + stats.dev + '</td></tr>';
        dump += '<tr><td>Count</td><td class="right">' + stats.cnt + '</td></tr>';
    //    if (stat.unit)   dump += '<tr><td>Unit</td><td class="right">'+stats.unit+'</td></tr>';
        dump += '<tr><td colspan="2" style="padding-top:1em;"><b>Source</b></td></tr>';
        if (undefined !== stats.msg) {
            let m = stats.msg.match(/^(\w+)\s+(.*)/);
            if (m != undefined && m.length == 3) {
                dump += '<tr><td>Protocol</td><td class="right">' + m[1] + '</td></tr>';
                dump += '<tr><td>Message</td><td class="right">' + m[2] + '</td></tr>';
            }
        }
        if (undefined != stats.time) dump += '<tr><td>Time</td><td class="right">' + stats.time + '</td></tr>';
        if (undefined !== stats.age) {
            const age = (stats.age > 1) ? stats.age + '  s Ago' : (stats.age === 1) ? 'Last Epoch' : 'Just Now';
            dump += '<tr><td>Updated</td><td class="right">' + age + '</td></tr>';
        }
        let table = document.createElement('table');
        table.className = "dbtable";
        table.innerHTML = dump;
        return table;
    }
    
    function _makeChart(e, width) {
        if (e.cat || (0<=e.prec)) {
            const col = COL_HERO;
            const bkg = toRGBa(col, 0.5);
            const spec =  {
                type: 'line',
                data: { 
                    xLabels: e.timebase, yLabels: e.cat,
                    datasets: [{ 
                        label: e.name, 
                        data: e.carray, 
                        showLine: (0<=e.prec),
                        backgroundColor: bkg, 
                        borderColor: col, 
                        lineTension:0, 
                        fill: false, 
                    }] 
                },
                options: { 
                    layout: { padding: { left: 0, right: 0 } },
                    maintainAspectRatio: false, 
                    plugins: { tooltip: { callbacks: { title: _toolTipTitle, afterLabel: _toolTipText }, }, },
                    scales: { 
                        y: { 
                            ticks: { maxTicksLimit:(e.cat ? e.cat.length : 7), font:{ size:10 }, autoSkip:!e.cat, maxRotation:0, autoSkipPadding:10, },
                            //title: { text: e.unit, display: true, }, 
                            type:((0<=e.prec)?'linear':'category'),
                            stepSize:((e.cat) ? 1 : undefined), 
                        },
                        x: { 
                            ticks: { maxTicksLimit:6, maxRotation:0, font:{ size:10 } },
                            //title: { text: 'Time', display: true, }
                        }, 
                    }, 
                }
            };
            let canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = width;
            canvas.height = (0<=e.prec) ? '230px' : '150px';
            e.chart = new Chart(ctx, spec);
            let div = document.createElement('div');
            div.className = 'dbchart';
            div.style.height = (0<=e.prec) ? '230px' : '150px';
            div.style.width = width;
            div.appendChild(canvas);
            return div;
            function _toolTipTitle(context) {
                return context[0].dataset.label;
            }
            function _toolTipText(context) {
                let val = context.raw;
                if (e.prec) val = val.toFixed(e.prec);
                return 'Value: ' + val + (e.unit ? ' ' + e.unit : '')  + 
                                         ((e.map && e.map[val]) ? " " + e.map[val] : '') + '\nTime: ' + context.label;
            }
        }
    }
}
        
function dbPublish() {
    // now publish to the gui
    if (db.long.dirty && db.lat.dirty)
        centerMap(db.long.val, db.lat.val, db.cogt.val, db.gSpeed.val, db.hAcc.val,
                  (db.plPosValid.val ? { major:db.plPos1.val, minor:db.plPos2.val, vert:db.plPos3.val, angle:db.plPosHorOr.val } : undefined),
                  (db.plVelValid.val ? { major:db.plVel1.val, minor:db.plVel2.val, vert:db.plVel3.val, angle:db.plVelHorOr.val } : undefined) );
    if (nmeaSvDb.dirty) {
        nmeaSvDb.dirty = false;
        // Merge the new values with the old ones avoid flickering, every epoch we will replace the old with new
        Object.assign(oldSvDb, nmeaSvDb);
        chartSvs(oldSvDb);
        tableSvs(oldSvDb);
    }
    // show the Tiles
    let el = document.getElementById('db');
    for (let name in db) {
        const e = db[name];
        e.publish(el)
        if (e.el) el = e.el.info ? e.el.info : e.el.row;
    }
    el = document.getElementById('tile_position');
    if (el) {
        el.removeAttribute('hidden');
    }
    if (nmeaSvDb.freqs > 0) {
        el = document.getElementById('tile_satellite');
        if (el) el.removeAttribute('hidden');
    }
}

function updateStatus( message ) {
    // update internal counters
    if (message.type === 'input') {
        intStats.bytesTx += message.data.length;
        intStats.msgTx ++;
    }
    if (message.type === 'output') {
        intStats.bytesRx += message.data.length;
        intStats.bytesPend = 0;
        intStats.msgRx ++;
    }
    if (message.type === 'pending')
        intStats.bytesPend = message.data.length;
        
    const fields = message.fields;
    if ((message.type === 'output') && message.protocol.match(/^NMEA|UBX$/) && fields) {
        let newEpoch = false;
        if (db.time.sta && fields) {
            if (undefined !== fields.time) {
                const oldTime = db.time.value();
                newEpoch = fields.time !== oldTime;
/*REMOVE*/      //if (newEpoch) console.log('epoch by TIME ' + oldTime + ' ' + fields.time + ' of ' + message.id);
            } else if (undefined !== fields.itow) {
                let tod = (fields.itow - LEAP_SECONDS) % 86400;
                const h = Math.floor(tod / 3600);
                tod = (tod - (h * 3600));
                const m = Math.floor(tod / 60);
                const s = tod - (m * 60);
                const time = ('0'+h).slice(-2) + ':' + ('0'+m).slice(-2) + ':' + ('0'+s.toFixed(3)).slice(-6);
                const oldTime = db.time.value();
                newEpoch = time !== oldTime;
/*REMOVE*/      //if (newEpoch) console.log('epoch by ITOW ' + oldTime + ' ' + time + ' of ' + message.id);
            }
        }
        if (!newEpoch) {
            const id = message.id;
            newEpoch = epoch.ids[id] && (id === 'RMC' || id === 'VTG' || id === 'GGA' || id === 'GNS');
/*REMOVE*/  //if (newEpoch) console.log('epoch by ' + message.id);
        }
        if (newEpoch) {
            if (epoch.numMsg) 
				dbPublish();
            // reset for next epoch here
            epoch.ids = {};
            epoch.data = '';
            epoch.numMsg = 0;
            epoch.index ++;
            oldSvDb = nmeaSvDb; // take a copy 
            nmeaSvUsed = [];
            nmeaSvDb = { freqs:0 };
            nmeaSvDb.dirty = true;
            for (let name in db)
                db[name].update();
        }
        // append it to current epoch
        epoch.data += message.data;
        epoch.ids[message.id] = (epoch.ids[message.id]|0) + 1;
        epoch.numMsg ++;
        db.epIndex.set(epoch.index);
        db.epNumMsg.set(epoch.numMsg);
        db.epBytes.set(epoch.data.length);
        // add the new values to the (new) epoch
        for(let name in fields)
            if(db[name]) db[name].set(fields[name], message);
        // some conversions to correct units (most recent wins) set always
        if ((undefined !== fields.longN) && (undefined !== fields.longI) && (0 === db.long.sta))
            db.long.set((fields.longI === 'W') ? -fields.longN : fields.longN, message);
        if ((undefined !== fields.latN) && (undefined !== fields.latI) && (0 === db.lat.sta))
            db.lat.set((fields.latI === 'S') ? -fields.latN : fields.latN, message);
        if (0 === db.gSpeed.sta) {
            if (undefined !== fields.spdKm)
                db.gSpeed.set(0.06 * fields.spdKm. message);
            else if (undefined !== fields.spdKn)
                db.gSpeed.set(0.11112 * fields.spdKn. message);
        }
        // complete from other fields
        if (undefined !== fields.sep) {
            if (undefined !== fields.msl)
                db.height.set(fields.msl + fields.sep, message);
            else if (undefined !== fields.height)
                db.msl.set(fields.height - fields.sep, message);
        } else if ((undefined !== fields.height) && (undefined !== fields.msl))
            db.sep.set(fields.height - fields.msl, message);
        if (undefined !== fields.itow) {
            let tod = (fields.itow - 18) % 86400;
            const h = Math.floor(tod / 3600);
            tod = (tod - (h * 3600));
            const m = Math.floor(tod / 60);
            const s = tod - (m * 60);
            const time = ('0'+h).slice(-2) + ':' + ('0'+m).slice(-2) + ':' + ('0'+s.toFixed(3)).slice(-6);
            db.time.set(time, message);
        }
        /*
		if ((undefined !== fields.ecefX) && (undefined !== fields.ecefY)){
			if (0 === db.long.sta) {
				db.long.set(Math.atan2(fields.ecefY, fields.ecefX), message);
			} 
			if ((undefined !== fields.ecefZ) && (0 === db.lat.sta)){
				const F		= 0.00335281066474748;//(1/298.2572235630);
				const A		= 6378137.0;
				const B		= 6356752.31424518;//(A * (1-F));
				const E1SQR	= 0.00669437999014132;//((A*A - B*B) / (A*A));
				const E2SQR	= 0.00673949674227643;//((A*A - B*B) / (B*B));
				const E2SQR_B = 42841.31151331360000000;// E2SQR * B;
				const E1SQR_A = 42697.67270718000000000;// E1SQR * A;
				const p = Math.sqrt(fields.ecefX * fields.ecefX + fields.ecefY * fields.ecefY);
				const T = Math.atan2(fields.ecefZ * A, p * B);
				const sinT = Math.sin(T);
				const cosT = Math.cos(T);
				double dLat = Math.atan2(Z + E2SQR_B * sinT * sinT * sinT, p - E1SQR_A * cosT * cosT * cosT);
				db.lat.set(dLat);
			}
			if ((undefined !== fields.height) && (0 === db.lat.sta)){
				
			}
		}
		*/
			
/*		// XYZ -> Lat/LOn/ALT
		onst double Pi		= 3.1415926535898;		// WGS 84 value of pi
const double F		= (1/298.2572235630);
const double A		= 6378137.0;
const double B		= (A * (1-F));
const double E1SQR	= ((A*A - B*B) / (A*A));
const double E2SQR	= ((A*A - B*B) / (B*B));

const double RADIANS_PER_DEGREE = (Pi / 180.0);							//!< Radians per degree
const double DEGREES_PER_RADIAN	= (180.0 / Pi);							//!< Degrees per radian
const double ARCSECONDS_PER_RADIAN	= (DEGREES_PER_RADIAN * 3600.0);	//!< Arc seconds per radian
const double RADIANS_PER_ARCSECOND = (RADIANS_PER_DEGREE / 3600);		//!< Radians per arc second

const double METERS_PER_NAUTICAL_MILE	= (1853.32055);
const double LAT_METERS_PER_DEGREE		= (METERS_PER_NAUTICAL_MILE * 60.0);
const double KNOTS_PER_METER			= (0.3048 * 6076.0);

const double C_SOL	= 299792458.0;

double X = m_pStorageX->GetValue();
		
			// Set Altitude if needed
			if (m_pStorageAlt && m_pStorageAlt->IsUndefined())
			{
				// handle the poles
				if (p == 0.0)
					bUpdated |= m_pStorageAlt->EstValue(fabs(Z) - B);
				else
				{
					double sinF = sin(dLat);
					double cosF = cos(dLat);
					double N =  A*A / sqrt(A*A * cosF*cosF + B*B * sinF*sinF);
					bUpdated |= m_pStorageAlt->EstValue(p / cosF - N);
				}
			}
			
		if (m_pStorageLat && m_pStorageLat->IsDefined() && 
		m_pStorageAlt && m_pStorageAlt->IsDefined())
		{
			double dLat = m_pStorageLat->GetValue();
			double dAlt = m_pStorageAlt->GetValue();
			double sinF = sin(dLat);
			double cosF = cos(dLat);
			double N =  (A * A) / sqrt(A * A * cosF * cosF + B * B * sinF * sinF);
			// Set Z if Needed
			if (m_pStorageZ && m_pStorageZ->IsUndefined())
				bUpdated |= m_pStorageZ->EstValue(((B * B) / (A * A) * N + dAlt) * sinF);
			if (m_pStorageLon && m_pStorageLon->IsDefined())
			{
				double dLon = m_pStorageLon->GetValue();
				// Set X if Needed
				if (m_pStorageX && m_pStorageX->IsUndefined())
					bUpdated |= m_pStorageX->EstValue((N + dAlt) * cosF * cos(dLon));
				// Set Y if Needed
				if (m_pStorageY && m_pStorageY->IsUndefined())
					bUpdated |= m_pStorageY->EstValue((N + dAlt) * cosF * sin(dLon));
			}
		}
		if (m_pStorageX && m_pStorageX->IsDefined() && 
		m_pStorageY && m_pStorageY->IsDefined() && 
		m_pStorageLong && m_pStorageLong->IsDefined())
	{
		
	VXYZ -> VNED
		double X = m_pStorageX->GetValue();
		double Y = m_pStorageY->GetValue();
		double Long = m_pStorageLong->GetValue();
		double sinL = sin(Long);
		double cosL = cos(Long);
		if (m_pStorageEast && m_pStorageEast->IsUndefined())
			bUpdated |= m_pStorageEast->EstValue(- X * sinL + Y * cosL);
		if (m_pStorageZ && m_pStorageZ->IsDefined() && 
			m_pStorageLat && m_pStorageLat->IsDefined())
		{
			double Z = m_pStorageZ->GetValue();
			double Lat = m_pStorageLat->GetValue();
			double sinF = sin(Lat);
			double cosF = cos(Lat);
			if (m_pStorageNorth && m_pStorageNorth->IsUndefined()) 
				bUpdated |= m_pStorageNorth->EstValue(- X * sinF * cosL - Y * sinF * sinL + Z * cosF);
			if (m_pStorageDown && m_pStorageDown->IsUndefined()) 
				bUpdated |= m_pStorageDown->EstValue(- X * cosF * cosL - Y * cosF * sinL - Z * sinF);
		}
	}
		
	if (m_pStorageNorth && m_pStorageNorth->IsDefined() && 
		m_pStorageDown && m_pStorageDown->IsDefined() && 
		m_pStorageLat && m_pStorageLat->IsDefined())
	{
		double North = m_pStorageNorth->GetValue();
		double Down = m_pStorageDown->GetValue();
		double Lat = m_pStorageLat->GetValue();
		double sinF = sin(Lat);
		double cosF = cos(Lat);
		if (m_pStorageZ && m_pStorageZ->IsUndefined())
			bUpdated |= m_pStorageZ->EstValue(cosF * North - sinF * Down);
		if (m_pStorageEast && m_pStorageEast->IsDefined() && 
			m_pStorageLong && m_pStorageLong->IsDefined())
		{
			double East = m_pStorageEast->GetValue();
			double Long = m_pStorageLong->GetValue();
			double sinL = sin(Long);
			double cosL = cos(Long);
			if (m_pStorageX && m_pStorageX->IsUndefined()) 
				bUpdated |= m_pStorageX->EstValue(- sinL * East  - cosL * sinF * North - cosL * cosF * Down);
			if (m_pStorageY && m_pStorageY->IsUndefined()) 
				bUpdated |= m_pStorageY->EstValue(cosL * East  - sinL * sinF * North - cosF * sinL * Down);
		}
	}
	*/
	
        // special extractions from messages
        if (message.protocol === 'UBX') {
            if (message.name === 'MON-VER') {
				USTART.tableEntry('dev_tech', /*'\uE003'+*/
						'<a target="_blank" href="https://www.u-blox.com/en/positioning-chips-and-modules">Positioning</a>', true);
                infTextExtract(fields.swVer);
                tableEntry('dev_hw', fields.hwVer);
                if (fields.extVer) {
                    for (let i = 0; i < fields.extVer.length; i ++)
                        infTextExtract(fields.extVer[i]);
                }
            } else if (message.name === 'INF-NOTICE') {
                infTextExtract(fields.infTxt);
            } else if (message.name === 'MON-PMP') {
                for (let i = 0; i <fields.entries; i ++) {
                    let freq = fields.entry[i].centerFreq;
                    const cn0 = fields.entry[i].cn0 + fields.entry[0].cn0Frac;
                    if (cn0 > 0) {
                        db.lBcn0.set(cn0);
                    }
                    const sys = 'PointPerfect';
                    let sig = 'LBAND';
                    if (0 < freq) sig += ' ' + (freq*1e-6).toFixed(2);
                    let id = gnssLut[sys].ch;
                    const keys = Object.keys(gnssLut[sys].freq);
                    keys.forEach( function Check(key) {
                        if (Math.abs(freq - gnssLut[sys].freq[key]) < 100000) {
                            id = gnssLut[sys].ch + key;
                        }
                    } );
                    if (undefined !== id) {
                        nmeaSvsSet(sys, id, sig, cn0)
                        nmeaSvDb.dirty = true;
                    }
                }   
            } else if (message.name === 'RXM-QZSSL6') {
                const sys = 'QZSS';
                const sig = 'L6';
                const id = gnssLut[sys].ch + fields.svId;
                nmeaSvsSet(sys, id, sig, fields.cno);
                nmeaSvDb.dirty = true;
            } else if (message.name === 'RXM-PMP') {
                if (fields.ebn0 > 0)
                    db.lBebn0.set(fields.ebn0);
                nmeaSvDb.dirty = true;
            } else if (message.name === 'RXM-COR') {
                if (fields.ebn0 > 0)
                    db.lBebn0.set(fields.ebn0);
            } 
        } else if (message.protocol === 'NMEA') {
            if ((message.id === 'GSA') || (message.id === 'GSV')) {
                nmeaSvsExtract(fields, message.talker);
            } else if (message.id === 'TXT') {
                infTextExtract(fields.infTxt);
            }
        }
    }
}

// this function can be used on UBX INF or MON-VER or NMEA TXT messages
function infTextExtract(v) {
	if (v) {
		let t, k;
		if (t = v.match(/^MOD=(.+)$/))            k = 'dev_mod';
		else if (t = v.match(/^HW (.+)$/))        k = 'dev_hw';
		else if (t = v.match(/^ROM (?:BASE|CORE) (.+)$/)) k = 'dev_rom';
		else if (t = v.match(/^EXT CORE (.+)$/))  k = 'dev_flash';
		else if (t = v.match(/^FWVER=(.+)$/))     k = 'dev_ext';
		else if (t = v.match(/^PROTVER=(.+)$/))   k = 'dev_prot';
		if (k && t && t.length==2) tableEntry(k, t[1]);
	}
}

function nmeaSvsSet(sys, sv, sig, cno, az, elv, used, nmeaSv) {
    if (!nmeaSvDb[sys]) 	nmeaSvDb[sys] = {};
    if (!nmeaSvDb[sys][sv]) nmeaSvDb[sys][sv] = { cno:[] };
    if (used !== undefined) nmeaSvDb[sys][sv].used = used;
    if (nmeaSv !== undefined) nmeaSvDb[sys][sv].nmea = nmeaSv;
    if ((az !== undefined) && (0 <= az) && (360 >= az) && (elv !== undefined) && (0 <= elv)) {
        nmeaSvDb[sys][sv].az  = az;
        nmeaSvDb[sys][sv].elv = elv;
    }
    if (cno) {
        nmeaSvDb[sys][sv].cno[sig] = cno.toFixed(0);
        const len = Object.keys(nmeaSvDb[sys][sv].cno).length;
        if (len > nmeaSvDb.freqs) nmeaSvDb.freqs = len;
    }
}

// this function is intended to run either on GSA or GSV
function nmeaSvsExtract(fields, talker) {
	if (fields.sv) {
		for (let s = 0; s < fields.sv.length; s ++) {
            if (fields.sv[s] !== undefined) {
                const ret = _nmeaSvId(fields.systemId, fields.sv[s], talker);
                const sv = ret[0];
                if (-1 === nmeaSvUsed.indexOf(sv)) {
                    nmeaSvUsed.push(sv);
                }
            }
		}
        nmeaSvDb.dirty = true;
	} else if (fields.svs) {
		for (let s = 0; s < fields.svs.length; s ++) {
			const ret = _nmeaSvId(fields.systemId, fields.svs[s].sv, talker);
			const sv = ret[0];
			const nmeaSv = ret[1];
			const sys = ret[2];
			const sig = (gnssLut[sys].sig && gnssLut[sys].sig[fields.signalId]) ? gnssLut[sys].sig[fields.signalId] : 'L1 C/A';
            const used = (-1 !== nmeaSvUsed.indexOf(sv));
			nmeaSvsSet(sys, sv, sig, fields.svs[s].cno, fields.svs[s].az, fields.svs[s].elv, used, nmeaSv);
		}
        nmeaSvDb.dirty = true;
	}
	// NMEA convert the System, SV, Talker to our internal representation
	function _nmeaSvId(s,i,t) {
		s = (mapNmeaSignalId[s] !== undefined) ? mapNmeaSignalId[s] : 
            (mapNmeaTalker[t]   !== undefined) ? mapNmeaTalker[t] : 'GNSS';
		let nmea;
		if (gnssLut[s]) {
			nmea = i;
			if (i === undefined) i = '?';
			else if (gnssLut[s].sv && (i >= gnssLut[s].sv[0]) && (i <= gnssLut[s].sv[1])) {
				i += 1 - gnssLut[s].sv[0];
			} else if (gnssLut[s].sbas && (i >= gnssLut[s].sbas[0]) && (i <= gnssLut[s].sbas[1])) {
				i += 120 - gnssLut[s].sbas[0];
				s = gnssLut.SBAS.map[i];
                if (!s) s = 'SBAS';
			} else if ((i >= 65) && (i <= 99)) {
				i += 1 - 65;
				s = 'GLONASS';
			} else if ((i >= 193) && (i <= 197)) {
				s = 'QZSS';
			} else if ((i >= 152) && (i <= 158)) {
				s = gnssLut.SBAS.map[i];
                if (!s) s = 'SBAS';
			} else if ((i >= 401) && (i <= 437)) {
				i += 1 - 401;
				s = 'BeiDou';
			} else if ((i >= 301) && (i <= 336)) {
				i += 1 - 301;
				s = 'Galileo';
			}
			if (i === nmea) nmea = undefined;
			i = gnssLut[s].ch + i;
		}
		return [ i, nmea, s ];
	}
}

// Table
// ------------------------------------------------------------------------------------
var table = {};
function tableEntry(entry, val, html) {
    if (typeof val === 'string') 
		val = val.replace(/^"(.+(?="$))"$/,'$1');
	else if (!val) val = '';
    _entry(entry);
	if(table[entry]) {
		if (html)
			table[entry].innerHTML = val;
		else 
			table[entry].textContent = val;
		table[entry].parentNode.removeAttribute('hidden');
		if (entry == 'dev_typenum') {
			// SHO: add the script tile for some NINA-B3
			if (val.match(/^NINA-B31\d-20B/)) {
				let el = document.getElementById('tile_script');
				if (el) el.removeAttribute('hidden');
			}
		} else if (entry == 'dev_mod' /* THIS CODE IS DISABLED */ && false) {
			let query = val;
			let p = val.indexOf('-');
			let c = val.length;
			while (--c >= p) {
				query += '+' + val.slice(0, c);
			}
			let url = 'https://www.u-blox.com/en/uapp/productinfo/' + query;
			const Http = new XMLHttpRequest();
            var rndNum = Math.round(Math.random() * 10000);
            if ((Http.readyState == Http.DONE) && (Http.status == 200))
            {
                Http.onreadystatechange = function(e){
                    if(this.readyState === Http.DONE && this.status === 200) {
                        let json = {}
                        let m = this.responseText.replace(/<([^>]+)>([^<]*)<\/([^>]+)>/g, function _replace(a,b,c) {
                            json[b] = c;
                        });
                        if (json.image) {
                            let a = json.image.split('|');
                            let image = a.map( function (i) { return '<img class="prod_img" src="'+i+'" />'; } ).join('');
                            _entry('dev_img', image);
                        }
                        if (json.url && json.name && json.subtitle)
                            _entry('dev_prod', '<a target="_blank" href="'+json.url+'">'+json.name+'</a><br>'+json.subtitle);
                        if (json.descr) {
                            let descr = json.descr.replace(/\&gt;/g, '>').replace(/\&lt;/g, '<');
                            _entry('dev_descr', descr);
                        }
                    }
                };
                Http.open('GET', url, true);
                Http.send();
            };
        }
    }
	function _entry(e, v) {
		if (table[e] === undefined) {
			const el = document.getElementById(e);
			table[e] = el ? el : null;
		}
		if (table[e] && v) {
			table[e].innerHTML = v;
			table[e].parentNode.removeAttribute('hidden');;
		}
	}
}

const DEGREE_SYMBOL = '\u00B0';
function tableUpdate(db) {
	let keys = Object.keys(db);
	keys.forEach( function Table(key) {
		tableEntry('tab_'+key, db[key]);
	} );
}
function _td(elem, cls) { 
	return (cls ? ('<td class="'+cls+'">') : '<td>') + 
		   ((elem!==undefined)?elem:'') + '</td>';
}		
function tableSvs(svdb) {
	if (table.sv_list === undefined) {
		const el  = document.getElementById('sv_list');
		table.sv_list = el ? el : null;
	}
	if (table.sv_list) {
		let gnssKeys = Object.keys(gnssLut);
		let cnt = 0;
		gnssKeys.forEach( function _loopSys(sys) {
			var lut = gnssLut[sys];
			if (svdb[sys]) {
				let svKeys = Object.keys(svdb[sys]);
				svKeys.forEach( function _loopSv(svid) {
					let sv = svdb[sys][svid];
                    //let icon =  (sv.used) ? feather.icons["x-square"] : feather.icons["square"];
                    //let srcUsed = 'data:image/svg+xml;utf8,' + icon.toSvg();
					let iconUsed  = (sv.used === undefined) ? '' : sv.used ? '◾' : '◽'; // 🟩🟥🟢🔴⚪⭕◾◽
					const txtUsed = (sv.used === undefined) ? '' : 'Satellite ' + (sv.used ? '' :'is not ') + 'used in navigation solution';
                    const txtSys = flagsEmojy[lut.flag] + ' ' + sys;
					let sig = Object.keys(sv.cno);
					let cno = sig.map( function(freq) { 
						let c = sv.cno[freq];
						if (c && (freq !== '?')) c += ' ' + freq;
						return c;
					});
                    cno = cno.join(', ');
			        const nmea = sv.nmea ? 'NMEA Satellite ID: ' + sv.nmea : '';
					if (cnt < table.sv_list.childElementCount) {
						let tr = table.sv_list.childNodes[cnt];
						tr.childNodes[0].textContent = txtSys;
						tr.childNodes[1].textContent = svid;
					    tr.childNodes[1].title       = nmea;
                        tr.childNodes[2].textContent = iconUsed;
                        tr.childNodes[2].title = txtUsed;
                        tr.childNodes[3].textContent = cno;
						tr.childNodes[4].textContent = sv.elv;
						tr.childNodes[5].textContent = sv.az;
					} else {
						let tr = document.createElement('tr');
						tr.className = 'sv_row';
						let td = document.createElement('td');
						  td.textContent = txtSys;
						  tr.appendChild(td);
        				td = document.createElement('td');
						  td.textContent = svid;
						  td.style.textAlign = 'center';
						  td.title = nmea;
						  tr.appendChild(td);
						td = document.createElement('td');
						  td.style.textAlign = 'center';
                          td.textContent = iconUsed;
                          td.title = txtUsed;
						  tr.appendChild(td); // SV
						td = document.createElement('td');
						  td.style.textAlign = 'center';
						  td.textContent = cno;
						  tr.appendChild(td);
						td = document.createElement('td');
						  td.style.textAlign = 'right';
						  td.textContent = sv.elv;
						  tr.appendChild(td);
						td = document.createElement('td');
						  td.style.textAlign = 'right';
						  td.textContent = sv.az;
						  tr.appendChild(td);
						table.sv_list.appendChild(tr);
					}
					cnt ++;
				} );
			}
		} ); 
		for (cnt = table.sv_list.childElementCount - cnt; cnt > 0; cnt --)
			table.sv_list.removeChild(table.sv_list.lastChild);
	}
}

// Chart
// ------------------------------------------------------------------------------------
let chart;
const svLabels = [];
const svLevels = [];

const svAzEl = [ [], [] ];
const svName = [ [], [] ];
let chartAzEl;
let axis = [];
let svAzElLabel = [];
for (let i = 0; i < 360; i ++) svAzElLabel[i] = '';
for (let i = 0; i < 360; i += 45) {
	const label = [ "N", "NE", "E", "SE", "S", "SW", "W", "NW" ];
	axis[i] = 0;
    axis[i+1] = 90;
	svAzElLabel[i] = label[i/45];
}
let dataAzEl = { labels:svAzElLabel, datasets: [ { fill: false, pointRadius: 0, borderWidth:1, data: axis } ] };

function chartSvs(svdb) {
	const col = [ COL_BLUE, COL_GREEN ];
	const bkg = col.map( v => toRGBa(v, 0.5) );
	svLabels.length = 0;
	svAzEl[0].length = 0;
    svAzEl[1].length = 0;
    for (let f = 0; f < svdb.freqs; f ++)
		svLevels[f] = { data: [], borderWidth: 1, borderColor: [], backgroundColor: [] };
    svLevels.length = svdb.freqs;
    const gnssKeys = Object.keys(gnssLut);
	gnssKeys.forEach( function _system(sys) {
		const lut = gnssLut[sys];
		if (svdb[sys]) {
			const svKeys = Object.keys(svdb[sys]);
			svKeys.forEach( function _sv(svid) {
				const sv = svdb[sys][svid];
				const sig = Object.keys(sv.cno);
				// prepare for the signal plot
				if (sig.length) {
					svLabels.push(svid);
					for (let f = 0; f < svdb.freqs; f ++) {
						svLevels[f].data.push(sv.cno[sig[f]]);
						const u = sv.used?1:0;
						svLevels[f].backgroundColor.push(bkg[u]);
						svLevels[f].borderColor.push(col[u]);
					}
				}
                // prepare for the az el plot
                if (sv.az && sv.elv) {
                    const ai = Math.round(sv.az) % (360);
                    let i = 0;
                    let u = sv.used ? 1 : 0;
                    while (1) {
                        if (undefined === svAzEl[u][i]) svAzEl[u][i] = [], svName[u][i] = [];
                        if (undefined === svAzEl[u][i][ai]) break;
						i ++;
                    }
                    svAzEl[u][i][ai] = sv.elv;
					svName[u][i][ai] = svid;
                }
			} );
		}
    } ); 

	 if (!chart) {
        let el = document.getElementById('svs');
        if ((Chart !== undefined) && el && el.clientWidth && el.clientHeight) {
            const spec = {
                type: 'bar', data: { labels: svLabels, datasets: svLevels },
                options: {
                    maintainAspectRatio: false,
                    plugins: { 
                        tooltip: {
                            callbacks: {
                                title: _toolTipTitle,
                                afterLabel: _toolTipText,
                            },
                        }, 
                    },
                    scales: {
                        x: { 
                            ticks: { 
                                maxRotation:0, autoSkip:false, padding:0, font:{ size:9 },
                                callback: function _EvenTick(v,i) { return (i % 2) ? '' : this.getLabelForValue(v); }
                            },
                            stacked: true, 
                        },
                        x2: { 
                            grid: {
                                drawBorder: false, // hide the x axis
                                drawTicks: false,
                            },
                            ticks: { 
                                maxRotation:0, autoSkip:false, padding:0, font:{ size:9 },
                                callback: function _OddTick(v,i) { return (i % 2) ? this.getLabelForValue(v) : ''; }
                            },
                            stacked: true, 
                        },
                        y: {
                            display: true,
                            ticks: { min: 0, suggestedMax:40, stepSize:5, maxRotation:0, },
                            title: { display: true, text: 'C/N0 [dBHz]', fontStyle: 'bold', },
                            stacked: false, 
                        }
                    }
                }
            };
            const ctx = el.getContext('2d');
            chart = new Chart(ctx, spec);
            function _toolTipTitle(context) {
                return 'Satellite: '+ context[0].label;
            }
            function _toolTipText(context) {
                // TODO add signal and maybe second CNO ? 
                // context.chart.data.labels[context.dataIndex]
                // context.chart.data.datasets[0].data[context.dataIndex] // CNO[0]
                // context.chart.data.datasets[0].data[context.dataIndex] // CNO[1]
                return 'C/N0: ' + context.formattedValue + ' dBHz';
            }
        }
    } else {
        chart.update(0);
    }
    
    // this is an azimuth elevation plot with used status
    dataAzEl.datasets.length = 1; // just keep the axis 
    for (let u = 0; u < svAzEl.length; u ++) {
        for (let i = 0; i < svAzEl[u].length; i ++) {
            dataAzEl.datasets.push( {
                fill: false, radius: 9, pointRadius: 9, pointHoverRadius: 11,
                pointBackgroundColor: bkg[u], pointBorderColor: col[u], borderColor: 'transparent',
                data: svAzEl[u][i],
				name: svName[u][i], } );
        }
    }
    if (!chartAzEl) {
        const el = document.getElementById("svs2");
        if ((Chart !== undefined) && el && el.clientWidth && el.clientHeight) {
            const chartOptions = {
                plugins: { 
                    tooltip: {
                        callbacks: {
                            title: _toolTipTitle,
                            afterLabel: _toolTipText, 
                        },
                    },
                },
                scales: {  
                    r : {
                        angleLines: { color:'transparent', },
                        ticks: { beginAtZero: true, stepSize: 15 }, 
                        min: 0, max: 90, reverse:true
                    }
                },
            };
            const ctx = el.getContext('2d');
            chartAzEl = new Chart(ctx, { type: 'radar', data: dataAzEl, options: chartOptions } );
        }
    } else {
        chartAzEl.update(0);
    }
    function _toolTipTitle(context) {
        const ix = context[0].datasetIndex;
        const az = context[0].dataIndex;
        const name = dataAzEl.datasets[ix].name[az];
        return 'Satellite: '+name;
    }
    function _toolTipText(context) {
        //const ix = context.datasetIndex;
        const az = context.dataIndex;
        const el = context.formattedValue;
        //const el2 = dataAzEl.datasets[ix].data[az];
        //const name = dataAzEl.datasets[ix].name[az];
        return 'Elevation: ' + el + '\nAzimuth: ' + az;
    }
}

// Map 
// ------------------------------------------------------------------------------------
var map;
var point;
var track;
var dots;
var horizAcc;
var plPosEll;
var plVelEll;
var speedVec;
const MAP_POINTS = 10000;

function makeEllipse(position, major, minor, angle) {
    let coords = [];
    if ((position !== undefined) && (major !== undefined) && (minor !== undefined) && (angle !== undefined) && (major < 100000) && (major > 0)) {
        const circle = new ol.geom.Circle( position, 1.0);
        const polygon = ol.geom.Polygon.fromCircle(circle, 64);
        polygon.scale(minor, major); 
        polygon.rotate(-(angle * Math.PI) / 180.0, circle.getCenter());
        coords = polygon.getCoordinates();
    }
    return coords;
}

function clearMapTrack(e) {
    if (track) track.getGeometry().setCoordinates([]);
    if (dots) dots.getGeometry().setCoordinates([]);
}

function centerMap(lon, lat, cogt, gSpeed, hAcc, plPos, plVel) {
    var el = document.getElementById('map');
    if (el && (ol !== undefined) && !isNaN(lon) && !isNaN(lat)) {
        el.removeAttribute('hidden');
        let scale = Math.cos(lat * Math.PI / 180.0 );
        let position = ol.proj.fromLonLat([Number(lon), Number(lat)]);
        let radius = !isNaN(hAcc) ? scale * hAcc : 0;
        let posEll = plPos ? makeEllipse(position, plPos.major * scale, plPos.minor * scale, plPos.angle) : [];
        let velEll = [];
        let velVect = [];
        if (!isNaN(cogt) && !isNaN(gSpeed)) {
            gSpeed *= scale;
            cogt *= Math.PI / 180.0;
            const positionV = [ position[0] + Math.sin(cogt) * gSpeed, 
                                position[1] + Math.cos(cogt) * gSpeed];
            velEll = plVel ? makeEllipse(positionV, plVel.major * scale, plVel.minor * scale, plVel.angle) : [];
            velVect = [ position, positionV ];
        }
        if (!map && el.clientWidth && el.clientHeight) {
			// track
            track = new ol.Feature({ geometry: new ol.geom.LineString( [ position ] ) });
            let stroke = new ol.style.Stroke({width: 2, color: toRGBa(COL_HERO, 0.8), lineCap:'round' });
            track.setStyle( new ol.style.Style({ stroke: stroke }) );
            dots = new ol.Feature({ geometry: new ol.geom.MultiPoint([ position ]) });
            let vertices = new ol.style.Circle({ radius: 2, fill: new ol.style.Fill({ color: COL_HERO }), });
            dots.setStyle( new ol.style.Style({ image: vertices }) );
            // point
            point = new ol.Feature(new ol.geom.Point(position));
            let svg = feather.icons.crosshair.toSvg({ color: 'white', 'stroke-width': 2, width: 96, height: 96, });
            let icon    = new ol.style.Icon({ color: COL_BLUE, scale: 0.25, src: 'data:image/svg+xml;utf8,' + svg,
											  anchor: [0.5, 0.5], anchorXUnits: 'fraction', anchorYUnits: 'fraction', });
            point.setStyle( new ol.style.Style( { image: icon } ) );
			// ellispe
            const ellStyle = new ol.style.Style( { 
                stroke: new ol.style.Stroke({ color: COL_RED, width:1, lineCap:'round' }),
                fill:   new ol.style.Fill(  { color: toRGBa(COL_RED, 0.3), }),
            } );
            horizAcc = new ol.Feature({ geometry: new ol.geom.Circle( position, radius)});
            plPosEll = new ol.Feature({ geometry: new ol.geom.Polygon( posEll ) });
            plVelEll = new ol.Feature({ geometry: new ol.geom.Polygon( velEll ) });
            speedVec = new ol.Feature({ geometry: new ol.geom.LineString( velVect ) });
            // put things together 
            let tile    = new ol.layer.Tile(  { source: new ol.source.OSM() });
            let vectPt  = new ol.layer.Vector({ source: new ol.source.Vector({ features: [ point ] }) });
            let vectTrk = new ol.layer.Vector({ source: new ol.source.Vector({ features: [ track, dots ] }) });
            let vectEll = new ol.layer.Vector({ source: new ol.source.Vector({ features: [ horizAcc, plPosEll, plVelEll, speedVec ] }), style: ellStyle });
            let intr = ol.interaction.defaults.defaults({ onFocusOnly: true, mouseWheelZoom: false });
            let ctrl = ol.control.defaults.defaults({ attribution: false, zoom: true, rotate: true, });
            class mapToolbar extends ol.control.Control {
                constructor(opt_options) {
                    const options = opt_options || {};
                    // useful unicode icons ◌◯☉⌖⬭⬬⬮⬯
                    const btnPoint = document.createElement('div');
                    btnPoint.className = 'overlay_button'
                    btnPoint.innerHTML = feather.icons.crosshair.toSvg();
                    btnPoint.title = "Current location marker";
                    btnPoint.type = "button";
                    const btnError = document.createElement('button');
                    btnError.innerHTML = 'O';
                    btnError.style.fontStyle = 'italic';
                    btnError.style.fontWeight = '400';
                    btnError.title = "Horizontal accuracy estimate\nand protection level ellipse";
                    const btnTrack = document.createElement('button');
                    btnTrack.innerHTML = '☡';
                    btnTrack.title = "Ground track";
                    btnTrack.type = "button";
                    const element = document.createElement('div');
                    element.className = 'overlay_ctrl ol-options ol-control';
                    element.appendChild(btnPoint);
                    element.appendChild(btnError);
                    element.appendChild(btnTrack);
                    super({
                        element: element,
                        target: options.target,
                    });
                    btnPoint.addEventListener('click', this.showHideLayers.bind(this, vectPt), false);
                    btnTrack.addEventListener('click', this.showHideLayers.bind(this, vectTrk), false);
                    btnError.addEventListener('click', this.showHideLayers.bind(this, vectEll), false);
                }
                showHideLayers(layer) { layer.setOpacity( (layer.getOpacity() == 0) ? 1 : 0 ); }
            }
            const overviewMap = new ol.control.OverviewMap({
                collapseLabel: '\u00AB',
                layers: [ new ol.layer.Tile(  { source: new ol.source.OSM() } )],
                expandFactor: 4,
                label: '\u00BB',
                collapsed: true,
                rotation: Math.PI / 6,
            });
            const scaleLine = new ol.control.ScaleLine({ units: 'metric', minWidth: 100, /*bar: true, steps: 4, text: true,*/ })
            ctrl.extend([ new mapToolbar(), scaleLine, overviewMap, new ol.control.FullScreen() ]);
            let view = new ol.View( {  center:position, zoom: 15, maxZoom: 27, });
            let opt = { 
                controls: ctrl, 
                interactions: intr, 
                layers: [ tile, vectEll, vectTrk, vectPt ], 
                target: 'map', 
                view: view };
			map = new ol.Map(opt);
            map.getView().on('change:resolution', function _onZoomed(event){
                var zLevel = this.getZoom();     
                if (zLevel >= 20 && overviewMap.getCollapsed()) {
                    overviewMap.setCollapsed(false);
                } else if (zLevel < 15 && !overviewMap.getCollapsed()) {
                    overviewMap.setCollapsed(true);
                } 
            });
		} else if (map) {
            const extent = map.getView().calculateExtent(map.getSize());
            if (!(extent && extent[0]<=position[0] && extent[2]>=position[0] &&
                            extent[1]<=position[1] && extent[3]>=position[1])) {
               map.getView().setCenter(position);
			}
            let coordsTrk = track.getGeometry().getCoordinates(); // get coordinate array
            if ((coordsTrk.length == 0) || (coordsTrk[0][0] != position[0]) || (coordsTrk[0][1] != position[1]) ) {
                coordsTrk.unshift( position );
                if (coordsTrk.length > MAP_POINTS) coordsTrk.length = MAP_POINTS;
                track.getGeometry().setCoordinates(coordsTrk);
                dots.getGeometry().setCoordinates(coordsTrk);
            }
            point.getGeometry().setCoordinates(position);
            horizAcc.getGeometry().setRadius(radius);
            horizAcc.getGeometry().setCenter(position);
            plPosEll.getGeometry().setCoordinates( posEll );
            plVelEll.getGeometry().setCoordinates( velEll );
            speedVec.getGeometry().setCoordinates( velVect );
        }
    }
}
/*
function drawInstruments() {
	const el = document.getElementById('tile_instruments');
	const h = 200;     
	const w = 200;
	const r = ((h < w) ? h : w) / 2;
	const c = { x:w/2, y:h/2 };
	
	// draw the compass
	let a = 0;
	let canvas = document.createElement('canvas');
	canvas.width = 200; 
	canvas.height = 200; 
	let ctx = canvas.getContext('2d');
	if (db.cogt.sta || db.cogt.cnt) {
		a = db.cogt.val * Math.PI / 180.0;
		const v = 0.9 * r; 
		const as = v * Math.sin(a);
		const ac = v * Math.cos(a);
		ctx.font = '10px';
		ctx.textAlign = 'center';
		ctx.textBaseline = "middle"; 
		ctx.fillText("N", c.x - as, c.y - ac);
		ctx.fillText("E", c.x + ac, c.y - as);
		ctx.fillText("S", c.x + as, c.y + ac);
		ctx.fillText("W", c.x - ac, c.y + as);
	}
	DrawRose(a, 			    r * 0.80, r * 0.20);
	DrawRose(a + Math.PI / 4.0, r * 0.60, r * 0.20);
	el.appendChild(canvas);
    el.removeAttribute('hidden');
	
	function DrawRose(a, r1, r2)
	{
		const r1s = r1 * Math.sin(a);
		const r1c = r1 * Math.cos(a);
		a += Math.PI / 4.0;
		const r2s = r2 * Math.sin(a);
		const r2c = r2 * Math.cos(a);
		ctx.lineWidth = 2;
		ctx.strokeStyle = "#808080";
		ctx.fillStyle = "#808080"
		ctx.beginPath();
		ctx.moveTo(c.x + r1s, c.y + r1c);
		ctx.lineTo(c.x + r2s, c.y + r2c);
		ctx.lineTo(c.x - r2s, c.y - r2c);
		ctx.lineTo(c.x - r1s, c.y - r1c);
		ctx.stroke();
		ctx.fill();
		ctx.beginPath();
		ctx.moveTo(c.x + r1c, c.y - r1s);
		ctx.lineTo(c.x + r2c, c.y - r2s);
		ctx.lineTo(c.x - r2c, c.y + r2s);
		ctx.lineTo(c.x - r1c, c.y + r1s);
		ctx.stroke();
		ctx.fill();
		ctx.fillStyle = "#ffffff"
		ctx.beginPath();
		ctx.moveTo(c.x + r1s, c.y + r1c);
		ctx.lineTo(c.x - r2c, c.y + r2s);
		ctx.lineTo(c.x + r2c, c.y - r2s);
		ctx.lineTo(c.x - r1s, c.y - r1c);
		ctx.stroke();
		ctx.fill();
		ctx.beginPath();
		ctx.moveTo(c.x + r1c, c.y - r1s);
		ctx.lineTo(c.x + r2s, c.y + r2c);
		ctx.lineTo(c.x - r2s, c.y - r2c);
		ctx.lineTo(c.x - r1c, c.y + r1s);
		ctx.stroke();
		ctx.fill();
	}
}
*/
var statLed = { } ;
function statusLed(led) {
    if (statLed.el === undefined) {
        statLed.el = document.getElementById('status_led');
    }
    if (statLed.el) {
        let className = statLed.el.className.baseVal.replace(/ led_\S+/, '');
		statLed.el.className.baseVal = led ? className + ' led_' + led : className; 
		if (statLed.timer) {
            clearTimeout(statLed.timer);
            statLed.timer = undefined;
        }
        if (led === 'data') {
            statLed.timer = setTimeout( statusLedClear, 200 );
        }
		function statusLedClear() {
			statLed.el.className.baseVal = className;
			statLed.timer = undefined;
			if (epoch.numMsg) 
				dbPublish();
		}
    }
}



// ------------------------------------------------------------------------------------
return { updateStatus:updateStatus,
         tableEntry: tableEntry,
         resetGui: resetGui,
		 statusLed: statusLed,
};
})();
// ------------------------------------------------------------------------------------

const SEPARATOR      = '  |  ';
const COL_PPT   = { hero:'#ff6e59',   black:'#1a1a1a',
                    red:'#a02846',    yellow:'#ffbe28', blue:'#4664b4',   green:'#3cb46e',
                    dkgray:'#5a5a5a', gray:'#9a9a9a',   ltgray:'#bebebe', sltgray:'#dcdcdc', };
const COL_WEB   = { hero:'#ff6e59',   text:'#1a1a1a',   white:'#ffffff',  bgnd:'#f7f7f7',
                    red:'#ffbbba',    yellow:'#fff4b5', blue:'#afc3e6',   green:'#bbf0d0',
                    black:'#1a1a1a',  dkgray:'#5a5a5a', gray:'#9a9a9a',   ltgray:'#bebebe', };
const COL_HERO  = COL_PPT.hero;
const COL_BLUE  = COL_PPT.blue;
const COL_GREEN = COL_PPT.green;
const COL_RED   = COL_PPT.red;
function toRGBa(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
    if (alpha) {
        return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
    } else {
        return "rgb(" + r + ", " + g + ", " + b + ")";
    }
}

// Editor
// ------------------------------------------------------------------------------------
function editorInit(id) {
    let view = id+'_editor';
    var el = document.getElementById(view);
    var editor;
    try {
        editor = (el && (ace !== undefined)) ? ace.edit(view) : undefined;
    } catch (e) {}
    if (editor) {
        editor.setTheme('ace/theme/xcode');
        editor.session.setMode('ace/mode/javascript');
        editor.setOptions({fontSize: '12pt'});
        const Http = new XMLHttpRequest();
        Http.onreadystatechange = function _loadOptions(e){
            if (this.readyState === 4 && this.status === 200) {
                var el = document.getElementById(id+'_template');
                if(el) {
                    el.addEventListener('change', function(e){ _editorLoadTemplate(MOD_DIR + id + '/' + e.srcElement.value,editor); } );
                    el.innerHTML = this.responseText;
                    _editorLoadTemplate(MOD_DIR + id + '/' + el.value, editor);
                }
            }
        }
        Http.open('GET',MOD_DIR + id + '/index.xml', true);
        Http.setRequestHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        Http.send();
    }
    return editor;
    
    function _editorLoadTemplate(url,editor) {
        const Http = new XMLHttpRequest();
        Http.onreadystatechange = function _loadTemplate(e){
            if(this.readyState === 4 && this.status === 200) {
                editor.getSession().setValue(this.responseText);
                const format = url.match(/\.py$/) ? 'ace/mode/python' :
                                                    'ace/mode/javascript';
                editor.session.setMode( format );
            }
        }
        Http.open('GET', url, true);
        Http.setRequestHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        Http.send();
    }
}
