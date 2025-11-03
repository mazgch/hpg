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

import { def, GNSS_LUT } from './utils.js';
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
        this.#completeCog(this.#fields);
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
        // calculate number of Sv
        const svObj = Object.values(this.#svs);
        if (def(svObj)) {
            fields.numSV = svObj.filter((sv) => sv.used).length;
            const trkObj = svObj.map((sv) => {
                // check if array with signals or just a cno value
                if (typeof sv.cno === 'object') {
                    return Object.values(sv.cno).filter((cno) => (0 < cno)).length;
                } else {
                    return (0 < sv.cno) ? 1 : 0;
                }
            }).filter((v) => (0 < v));
            fields.trkSV = trkObj.length;
            fields.trkSig = trkObj.reduce((tot, cnos) => tot + cnos, 0);
        }
        return new Epoch(fields, this.#svs, ((0 < this.#info.length) ? this.#info : undefined) );
    }

    clear() {
        this.#meas = {};
        this.#fields = {}; 
        this.#svs = {};
        this.#info = []; 
        this.#ids = {};  
    }

    merge(message) {
        let m;
        def(message.id) && (this.#ids[message.id] = true);  
        def(message.fields) && this.fieldsMerge(message.fields, this.#fields);
        if ((message.name === 'NAV-PVT') && def(message.fields?.flags?.psmState)) {
            const mapPsm = Object.keys(FieldsReg.psm.map);
            this.#fields.psm = mapPsm[message.fields.flags.psmState];
        } else if (message.name === 'TUN-MEAS') {
            const name = message.fields?.name;
            const i = message.fields?.meas[2].value; // 0=cnt, 1=time 2=avg
            const mapV = { ICC1:'vcc', ICC2:'vbat', ICC3:'vio' } 
            const n = mapV[name];
            if (n) {
                this.#meas[n] ??= {}
                this.#meas[n].cnt = (this.#meas[n].cnt || 0) + 1;
                this.#meas[n].avg = (this.#meas[n].avg || 0) + i;
            }
        // get inf texts 
        } else if ((message.id === 'NAV-SAT') && (0 < message.fields?.svs?.length)){
            const svs = message.fields.svs;
            for (let s = 0; s < svs.length; s ++) {
                const sv = svs[s];
                const [sys, id, sig, used, cno, az, el] = this.#convertUbxSvId(sv.gnssId, sv.svId, undefined, sv.flags.svUsed, sv.cno, sv.azim, sv.elev);
                if (def(cno) || def(az) || def(el)) {
                    this.#svsSet(id, sig, used, cno, az, el, sv.prRes);
                }
            }
        } else if ((message.id === 'NAV-SIG') && (0 < message.fields?.sigs?.length)){
            const svs = message.fields.sigs;
            for (let s = 0; s < svs.length; s ++) {
                const sv = svs[s];
                const [sys, id, sig, used, cno] = this.#convertUbxSvId(sv.gnssId, sv.svId, sv.sigId, sv.sigFlags.prUsed, sv.cno);
                if (def(cno)) {
                    this.#svsSet(id, sig, used, cno, undefined, undefined, sv.prRes);
                }
            }
        } else if (message.protocol === 'NMEA') {
            const fields = message.fields;
            const talker = message.talker;
            if ((message.id === 'GSA') && (0 < fields?.sv?.length)) {
                const svs = fields.sv;
                for (let s = 0; s < svs.length; s ++) {
                    if (def(svs[s])) {
                        const [sys, sv, nmeaSv, sig] = this.#convertNmeaSvId(fields.systemId, svs[s], talker, fields.signalId);
                        this.#svsSet(sv, sig, true);
                    }
                }
            } else if  ((message.id === 'GRS') && (0 < fields?.residual?.length)) {
                const residuals = fields.residual;
                for (let s = 0; s < residuals.length; s ++) {
                    //TODO: need to map the ressidual to the id in GSA
                    //const [sys, sv, nmeaSv, sig] = this.#convertNmeaSvId(fields.systemId, undefined, talker, fields.signalId);
                    //this.#svsSet(sv, sig, undefined, undefined, undefined, undefined, residuals[s]);
                }
            } else if  ((message.id === 'GSV') && (0 < fields?.svs?.length)) {
                const svs = fields.svs;
                for (let s = 0; s < svs.length; s ++) {
                    const [sys, sv, nmeaSv, sig] = this.#convertNmeaSvId(fields.systemId, svs[s].sv, talker, fields.signalId);
                    const used = undefined;
                    this.#svsSet(sv, sig, used, svs[s].cno, svs[s].az, svs[s].elv);
                }
            }
        } else if (def(message.fields?.infTxt) && (m = message.name.match(/^(INF-([A-Z]+)|(G[PN]TXT))$/))) {
            if (m[2] === 'TEST') {
                m = message.fields.infTxt.match(/nomVoltage_(.*)=(.*)$/);
                if (def(m) && def(m[1]) && def(m[2])) {
                    this.#voltage[m[1]] = Number( m[2].replace('V','.') );
                }
            } else if ((m[2] === 'ERROR') || (m[2] === 'WARNING') || (m[2] === 'NOTICE')) {
                const infTxt = ((def(m[2]) && (m[2] !== 'NOTICE')) ? `$(m[2]) `: '') + message.fields.infTxt;
                this.infMerge(this.#info, infTxt);
            } else {
                // DEBUG / USER
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
            const carrSol = { 1: 'FLOAT', 2: 'FIXED' }; 
            const diffSol = { 1: 'DGPS' }; 
            const fixType = { 5: 'TIME', 4: '3D+DR', 3: '3D', 2: '2D', 1: 'DR', 0:'NO' }; 
            if ((0 !== fields.fixType) && def(fix = fixOk[fields.flags?.fixOk])) {
                fields.fix = fix; // downgrade !ok fixes to BAD
            } else if (def(fix = carrSol[fields.flags?.carrSol]) && (2 <= fields.fixType)) {
                fields.fix = fix; // upgrade RTK fixes to FLOAT/FIXED
            } else if (def(fix = diffSol[fields.flags?.diffSol]) && (3 === fields.fixType)) {
                fields.fix = fix; // upgrade 3D fixes to DGPS
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
    
    #completeCog(fields) {
        // speed
        if (!def(fields.cog) && def(fields.headMot)) {
            fields.cog = fields.headMot;
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

    #svsSet(sv, sig, used, cno, az, el, res) {
        this.#svs[sv] ??= {};
        const s = this.#svs[sv];
        if (def(used)) s.used = used;
        if (def(az) && (  0 <= az) && (360 >= az) && 
            def(el) && (-90 <= el) && ( 90 >= el)) {
            s.az = az;
            s.el = el;
        }
        if (def(res)) { s.res = Number(res.toFixed(1)); }         
        if (def(cno) && (0 < cno)) {
            // make it an object if there is a signal 
            if (def(sig)) {
                if (typeof s.cno !== 'object') {
                    s.cno ??= {};
                }
                s.cno[sig] = Number(cno);
            } else if (typeof s.cno !== 'object') {
                s.cno = Number(cno);
            }
        }
    }

    #NMEA_SIGNALS  = {  1:'GPS',  2:'GLONASS',  3:'Galileo',  4:'BeiDou',  5:'QZSS',  6:'NavIC', };
    #NMEA_TALKERS  = { GP:'GPS', GL:'GLONASS', GA:'Galileo', GB:'BeiDou', GQ:'QZSS', GI:'NavIC', GN:'GNSS', BD:'BeiDou', };
    
    #convertNmeaSvId(sys, id, talker, signalId) {
        // NMEA convert the System, SV, Talker to our internal representation
        sys = this.#NMEA_SIGNALS[sys] || this.#NMEA_TALKERS[talker] || 'GNSS';
        let nmea;
        const gnss = GNSS_LUT[sys]; 
        if (def(gnss)) {
            nmea = id;
            if (!def(id)) id = '?';
            else if (gnss.sv && (id >= gnss.sv[0]) && (id <= gnss.sv[1])) {
                id += 1 - gnss.sv[0];
            } else if (gnss.sbas && (id >= gnss.sbas[0]) && (id <= gnss.sbas[1])) {
                id += 120 - gnss.sbas[0];
                sys = GNSS_LUT.SBAS.map[id];
                if (!def(sys)) sys = 'SBAS';
            } else if ((id >= 65) && (id <= 99)) {
                id += 1 - 65;
                sys = 'GLONASS';
            } else if ((id >= 193) && (id <= 197)) {
                sys = 'QZSS';
            } else if ((id >= 152) && (id <= 158)) {
                sys = GNSS_LUT.SBAS.map[id];
                if (!sys) sys = 'SBAS';
            } else if ((id >= 401) && (id<= 437)) {
                id += 1 - 401;
                sys = 'BeiDou';
            } else if ((id >= 301) && (id <= 336)) {
                id += 1 - 301;
                sys = 'Galileo';
            }
            if (id === nmea) {
                nmea = undefined;
            }
            id = gnss.ch + id;
        }
        const sig = GNSS_LUT[sys]?.sig[signalId] || 'L1 C/A';
        return [ sys, id, nmea, sig ];
    }

    #UBX_GNSSID    = {  0:'GPS',  1:'SBAS',  2:'Galileo', 3:'BeiDou', 4:'IMES', 5:'QZSS', 6:'GLONASS', 7:'NavIC', };
    /*
        GNSS        SVs         gnssId/svId svId(single)
        GPS         G1-G32      0:1-32      1-32
        SBAS        S120-S158   1:120-158   120-158
        Galileo     E1-E36      2:1-36      211-246
        BeiDou      B1-B5       3:1-5       159-163
                    B6-B37      3:6-37      33-64
                    B38-B63     3:38-63     n/a
        IMES        I1-I10      4:1-10      173-182
        QZSS        Q1-Q10      5:1-10      193-202
        GLONASS     R1-R32      6:1-32      65-96
                    R?          6:255       255
        NavIC       N1-N7       7:1-7       247-253
                    N8-N14      7:8-14      n/a
   
        GNSS        Signal  gnssId  sigId
        GPS         L1C/A2  0       0
        GPS         L2 CL   0       3
        GPS         L2 CM   0       4
        SBAS        L1C/A2  1       0
        Galileo     E1 C2   2       0
        Galileo     E1 B2   2       1
        Galileo     E5 bI   2       5
        Galileo     E5 bQ   2       6
        BeiDou      B1I D12 3       0
        BeiDou      B1I D22 3       1
        BeiDou      B2I D1  3       2
        BeiDou      B2I D2  3       3
        QZSS        L1C/A2  5       0
        QZSS        L1S     5       1
        QZSS        L2 CM   5       4
        QZSS        L2 CL   5       5
        GLONASS     L1 OF2  6       0
        GLONASS     L2 OF   6       2
    */
    #convertUbxSvId(gnssId, svId, sigId, used, cno, az, el) {
        const sys = this.#UBX_GNSSID[gnssId];
        const gnss = GNSS_LUT[sys];
        if (def(gnss)) {
            svId = gnss.ch + svId;
        }
        az = (az >=   0) && (az <= 360) ? az : undefined;
        el = (el >= -90) && (el <=  90) ? el : undefined;
        sigId = def(sigId) ? sigId : undefined;
        // TODO convert to a real signal Id
        used = (0 < used) ? true : undefined;
        cno = (0 < cno) ? cno : undefined;
        return [sys, svId, sigId, used, cno, az, el]
    }

    // some protected local vars 
    #svs
    #meas
    #voltage
    #fields
    #info
    #ids
}