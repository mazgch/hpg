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

import { hex }              from '../utils.js';

export class Protocol {

    /* 
    Text Decoding, Comma separated, NMEA/AT
    S        String
    Q        Quoted Sting
    C        Char
    I        Integer
    U        Unsigned
    R        Real/Float, 
    L        Lat/Lng
    T        Time
    D        Date, 
    
    Binary decoding, UBX, RTCM
    CH       Char
    S*       String, zero terminated 
    Sxx      Sting with max length xx, zero terminated 
    I1,I2,I4 Signed Integer
    U1,U2,U4 Unsigned Integer
    X1,X2,X4 Hex Value
    i1..iX   Signed bitfield
    u1..uX   Unsigned bitfield
    x1..xX   Hex bitfield
    R4,R8    Real/Float

    Special 
    [yy]:      add optional Array, with optional size yy
    *          Anything
    
    */
    static decode(data, spec, littleEnd = true, ofsBit = 0) {
        const len = data.length;
        let ofs = 0;
        let ix = 0;
        // create a binary data view
        let binary = new DataView(new ArrayBuffer(len), 0)
        for (let i=0; i < len; i++) {
            const by = data.charCodeAt(i);
            binary.setUint8(i, by);
        }
        return _decodeItem(spec, {});
        // helper for recursion
        function _decodeItem(spec, fields) {
            if (spec.type) {
                const match = spec.type.match(/^([*A-Za-z]+)(\d+)?(?:\[(\d*)\])?$/);
                if (!match) throw new Error('Invalid type in message spec');
                const type = match[1];
                let size = match[2];
                let num = match[3];
                if (type === '*') {
                    const elem = data.slice(ofs);
                    ofs = len;
                    ofsBit = 0
                    ix ++;
                    return elem;
                } else {
                    let elems = [];
                    const noArray = num === undefined;
                    num  = (num === undefined)  ? 1 : 
                        (num !== '')         ? parseInt(num) : 0x7FFFFFFF;
                    size = (size !== undefined) ? parseInt(size)   : 0;
                    for (let n = 0; (ofs < len) && (n < num); n ++) {
                        let elem;
                        if (size === 0) { // string types
                            if (type === 'Q') {
                                const sl = data.slice(ofs);
                                let m = sl.match(/^"([^"]*)"(?:,|$)/);
                                if (!m)
                                    m = sl.match(/^([^,\r\n$]*)(?:,|$)/);
                                if (m) {
                                    elem = m[1];
                                    ofs = ofs + m[0].length;
                                }
                                else ofs = len;
                            } else {
                                let end = data.indexOf(',', ofs);
                                if (end === -1) end = len;
                                if (end !== ofs) {
                                    elem = data.slice(ofs,end);
                                    if (type === 'C') {
                                        if (elem.length === 1) elem = elem.charAt(0);
                                    } else if (type === 'T') {
                                        const m = elem.match(/^(\d\d)(\d\d)(\d\d.\d*)$/);
                                        if (m) elem = [m[1],m[2],(m[3]+'000').slice(0,6)].join(':');
                                    } else if (type === 'D') {
                                        const m = elem.match(/^(\d\d)(\d\d)(\d\d)$/);
                                        if (m) {
                                            let y = Number(m[3]);
                                            y = ((y < 80) ? 2000 : (y < 100) ? 1900 : 0) + y;
                                            y = y.toString();
                                            elem = [ y, m[2] , m[1] ].join('-');
                                        }
                                    } else {
                                        let v;
                                        if (type === 'R') {
                                            v = parseFloat(elem);
                                        } else if (type === 'I') {
                                            v = parseInt(elem, 10);
                                        } else if (type === 'U') {
                                            v = parseInt(elem, 10);
                                            if (v < 0) v = undefined;
                                        } else if (type === 'X') {
                                            v = parseInt(elem, 16);
                                        } else if (type === 'L') {
                                            let cord = parseFloat(elem);
                                            if (!isNaN(cord)) {
                                                let t = Math.floor(cord*0.01);
                                                cord = t + (cord - 100.0*t) / 60.0;
                                                elem = cord.toFixed(7);
                                            }
                                        }
                                        if ((v !== undefined) && !isNaN(v)) {
                                            if (type === 'X')    v = '0x'+hex(v,2*size);
                                            else if (spec.scale) v *= spec.scale;
                                            elem = v;
                                        }
                                    }
                                }
                                ofs = end + 1;
                            }
                            ofsBit = 0;
                        } else if (type === 'u' || type === 'x' || type === 'i') { // bit types
                            if (littleEnd) {
                                // UBX bitfields
                                let v = binary.getUint8(ofs) >> ofsBit;
                                let o = 8;
                                while (ofsBit + size > o) {
                                    v += binary.getUint8(++ofs) << (o - ofsBit);
                                    o += 8;
                                }
                                const neg = v & (1 << (size - 1));
                                const adj = ((type === 'i') && neg) ? (1 << size) : 0;
                                ofsBit = (ofsBit + size) % 8;
                                if (ofsBit == 0) ofs ++;
                                v &= ((1 << size) - 1);
                                elem = v - adj;
                            } else {
                                // RTCM big endian format 
                                let v = binary.getUint8(ofs);
                                v &= (0xFF >> ofsBit);
                                const neg = v & (1 << (8 - ofsBit - 1));
                                const adj = ((type === 'i') && neg) ? (1 << size) : 0;
                                while (ofsBit + size > 8) {
                                    size -= (8 - ofsBit); // - bits
                                    ofsBit = 0;
                                    v <<= 8;
                                    v += binary.getUint8(++ofs);
                                }
                                ofsBit += size;
                                if (ofsBit == 8) {
                                    ofs ++;
                                    ofsBit = 0;
                                } else if (ofsBit) {
                                    v >>= (8 - ofsBit);
                                }
                                elem = v - adj;
                            }
                        } else { // binary types
                            if (type === 'CH') {
                                elem = data.charAt(ofs++);
                            } else if (type === 'S*') {
                                const term = data.indexOf('\x00', ofs);
                                const end = (term >= 0) ? ofs + term : len;
                                elem = data.slice(ofs, end);
                                ofs = end + 1; // skip zero term 
                            } else if (ofs + size <= len) {
                                let v;
                                if (type === 'S') {
                                    const str = data.slice(ofs, ofs+size);
                                    // trim zero termination
                                    const term = str.indexOf('\x00');
                                    elem = (term >= 0) ? str.slice(0,term) : str; 
                                } else if (type === 'I') {
                                    v = (size === 1) ? binary.getInt8(ofs) :
                                        (size === 2) ? binary.getInt16(ofs, littleEnd) :
                                        (size === 4) ? binary.getInt32(ofs, littleEnd) :
                                        (size === 8) ? Number(binary.getBigInt64(ofs, littleEnd)) : undefined;
                                } else if ((type === 'U') || (type == 'X')) {
                                    v = (size === 1) ? binary.getUint8(ofs) :
                                        (size === 2) ? binary.getUint16(ofs, littleEnd) :
                                        (size === 4) ? binary.getUint32(ofs, littleEnd) :
                                        (size === 8) ? Number(binary.getBigUint64(ofs, littleEnd)) : undefined;
                                } else if (type === 'R') {
                                    v = (size === 4) ? binary.getFloat32(ofs, littleEnd) :
                                        (size === 8) ? binary.getFloat64(ofs, littleEnd) : undefined;
                                }
                                if (v !== undefined) {
                                    if (type === 'X')    v = '0x'+hex(v,2*size);
                                    else if (spec.scale) v *= spec.scale;
                                    elem = v;
                                }
                                ofs += size;
                            } else {
                                ofs = len;
                            }
                            ofsBit = 0;
                        }
                        if (!noArray || (elem !== undefined))
                            elems.push(elem);
                        ix ++;
                    }
                    return noArray ? elems[0] : elems;
                }
            } else if (spec.spec)  {
                if (spec.repeat){
                    let elems = [];
                    const repeat = _repeat(spec.repeat, fields);
                    for (let r = 0; (ofs < len) && ((repeat===undefined) || (r < repeat)); r ++ ) {
                        const elem = _decodeItem(spec.spec, elems);
                        if (elem !== undefined) elems.push(elem);
                    }
                    return elems;
                } else {
                    return _decodeItem(spec.spec, {});
                }
            } else {
                let elems = {};
                for (let s = 0; (ofs < len) && (s < spec.length); s ++ ) {
                    const elem = _decodeItem(spec[s], elems);
                    if ((elem !== undefined) && spec[s].name) elems[spec[s].name] = elem;
                }
                return elems;
            }
        }
    }

    static encode(fields, spec) {
        let data = '';
        _encodeItem(spec, fields);
        return data;
        // helper for recursion
        function _encodeItem(spec, fields) {
            if (spec.type) {
                const match = spec.type.match(/^([*A-Z]+)(\d+)?(?:\[(\d*)\])?$/);
                if (!match) throw new Error('Invalid type in message spec');
                const type = match[1];
                let size = match[2];
                let num = match[3];
                const noArray = num === undefined;
                let vals = !spec.name ? [] : 
                            noArray   ? [ fields[spec.name] ] : 
                                        fields[spec.name];
                num  = (num === undefined)  ? 1 :
                    (num !== '')         ? parseInt(num) : vals.length;
                size = (size !== undefined) ? parseInt(size)   : 0;
                for (let n = 0; (n < num); n ++) {
                    if (size === 0) { // string types
                        throw new Error('Encoding of string messages not supported');
                    } else { // binary types
                        let v = vals[n];
                        if (type === 'CH') {
                            // AESSRT if val.length != 1
                            if (v === undefined) v = '\x00';
                            data += v;
                        } else if (type === 'S*') {
                            if (v === undefined) v = '';
                            data += v + '\x00';
                        } else {
                            if (type === 'S') {
                                if (v.length > size)      v = v.slice(size);
                                else if (v.length < size) v += '\x00'.repeat(size - v.length);
                                data += v;
                            } else {
                                let buf = new ArrayBuffer(8);
                                let binary = new DataView(buf);
                                v = (type === 'R') ? parseFloat(v) : parseInt(v);
                                if (isNaN(v)) v = 0;
                                if (spec.scale) v /= spec.scale;
                                if (type === 'I') {
                                    if      (size === 1) binary.getInt8(0, v, true);
                                    else if (size === 2) binary.getInt16(0, v, true);
                                    else if (size === 4) binary.getInt32(0, v, true);
                                } else if ((type === 'U') || (type == 'X')) {
                                    if      (size === 1) binary.setUint8(0, v, true);
                                    else if (size === 2) binary.setUint16(0, v, true);
                                    else if (size === 4) binary.setUint32(0, v, true);
                                } else if (type === 'R') {
                                    if      (size === 4) binary.setFloat32(0, v, true);
                                    else if (size === 8) binary.setFloat64(0, v, true);
                                }
                                for (let b = 0; b < size; b ++) {
                                    let ch = binary.getUint8(b, true);
                                    data += String.fromCharCode(ch);
                                }
                            }
                        }
                    }
                }
            } else if (spec.spec)  {
                let repeat = _repeat(spec.repeat, fields);
                if ((repeat === undefined) && fields[spec.name])
                    repeat = fields[spec.name].length;
                if (repeat === undefined) repeat = 0;
                for (let r = 0; r < repeat; r ++ ) {
                    _encodeItem(spec.spec, fields[spec.name]);
                }
            } else {
                for (let s = 0; s < spec.length; s ++ ) {
                    _encodeItem(spec[s], fields);
                }
            }
        }
    }

    static hint(spec, pre) {
        let data = [];
        _payloadHint(spec);
        return pre+data.join(',');

        // helper for recursion
        function _payloadHint(spec) {
            if (spec.type !== undefined) {
                data.push(spec.name);
            } else if (spec.spec)  {
                const repeat = 1; //_repeat(spec.repeat, fields);
                for (let r = 0; (repeat===undefined) || (r < repeat); r ++ ) {
                    _payloadHint(spec.spec);
                }
            } else {
                for (let s = 0; s < spec.length; s ++ ) {
                    _payloadHint(spec[s]);
                }
            }
        }
    }

    static WAIT = -1;
    static NOTFOUND = 0;
}

function _repeat(s,f) {
    if (s !== undefined) {
        s = s.replace(/\b(?:min|max)\(/g, 'Math.$&'); // Math stuff
        s = s.replace(/\b[a-zA-Z_]\w*\b/g, function _replace(s) { 
            return (f[s] === undefined) ? s : f[s]; 
        } );
        try {
            s = eval(s);
            s = parseInt(s);
            if (isNaN(s)) s = undefined;
        } catch (e) {
            s = 0; // error parsing skip this just assume once
            throw new Error('Invalid repetition in message/spec');            
        }
    }
    return s;
}