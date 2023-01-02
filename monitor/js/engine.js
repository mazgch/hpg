"use strict";
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
    
// ------------------------------------------------------------------------------------
/* START OF MODULE */ const Engine = (function () {
// ------------------------------------------------------------------------------------
const WAIT = -1;
const NOTFOUND = 0;
const TYPE_INPUT = 'input'; 	// to device 
const TYPE_OUTPUT = 'output'; 	// from device 
const TYPE_PENDING = 'pending'; // from device 

// Message
// ------------------------------------------------------------------------------------
/*
    //                                              	Console  Details  Logfile  Ubxfile
    protocol  UBX,NMEA,RTCM3,SPARTN,AT,TEXT,...  		yes      yes      yes
    type      output,pending,input               		yes      yes      yes      yes
    name      the name of the message               	yes      yes      yes
    time      hh.mm.ss.sss                          	yes               yes
    date      yyyy-mm-dd hh.mm.ss.sss               	         yes
    text      some textual representation           	yes
    color     color of the text                     	yes
    data      the binary data (may be just text)   		         yes      yes      yes
    binary    protocol is binary                        	              yes
    -- optional --
    fields    decoded fields                            	     yes
    spec      specification                             	     yes
    id        protocol specific id
	
	Protocol  Name					Type
	SCRIPT:   INFO, ERROR, TRACE 	command
	USER:     TRACE					command
	DEBUG:    AGENT(event), DEVICE(command,event)
*/
function Message(protocol, data, type, binary) {
    const date = new Date();
    let message = { protocol:protocol, type:type, data:data, };
	let timeString = _pad(date.getHours(),2) + ':' + _pad(date.getMinutes(),2) + ':' +
                     _pad(date.getSeconds(),2) + '.' + _pad(date.getMilliseconds(),3);
    message.time = timeString;
    message.date = date.getFullYear() + '-' + _pad(1+date.getMonth(),2) + '-' + 
				   _pad(date.getDate(),2) + ' ' + timeString;
    message.name = '?';
    message.text = '';
    message.data = data;
    message.binary = binary;
    return message;
}
function messageLine(message, filter) {
	const head = message.time + ' ' + message.protocol + ' ';
	if ((filter === undefined) || filter.exec(head + message.text)) {
		// create the message DOM
		let div = document.createElement('div');
		div.className = 'message ' + message.type;
		div.message = message;
		let span = document.createElement('div');
		span.className = 'messagehead preformated';
		span.textContent = head;
		div.appendChild(span);
		span = document.createElement('div');
		span.className = 'messagetext preformated';
		span.textContent = message.text;
		if (message.color) span.style.color = message.color;
		div.appendChild(span);
		return div;
	}
}
	
function messageTable(message) {
	let dump = '<table class="table">';
    dump += '<tr><td><b>Protocol</b></td><td style="width:100%">' + message.protocol + '</td></tr>';
    dump += '<tr><td><b>Name</b></td><td>' + message.name + '</td></tr>';
    //if (message.id) dump += '<tr><td><b>Identifyer</b></td><td>' + message.id + '</td></tr>';
    if (message.descr)
        dump += '<tr><td><b>Description</b></td><td>' + message.descr + '</td></tr>';
    dump += '<tr><td><b>Type</b></td><td>' + message.type.toUpperCase() + '</td></tr>';
    dump += '<tr><td><b>Length</b></td><td>' + message.data.length + '</td></tr>';
    dump += '<tr><td><b>Text Dump</b></td><td class="preformated">' + textDump(message.data, message.binary) + '</td></tr>';
    dump     += '<tr><td><b>Hex Dump</b></td><td class="preformated">' + hexDump(message.data) + '</td></tr>';
    if (message.fields)
        dump += '<tr><td><b>Fields</b></td><td class="preformated">' + jsonDump(message.fields) + '</td></tr>';
//   if (message.spec)
//       dump += '<tr><td><b>Definition</b></td><td>' + jsonDump(message.spec) + '</td></tr>';
    dump += '<tr><td><b>Timestamp</b></td><td>' + message.date + '</td></tr>';
    dump += '</table>';
    let div = document.createElement('div');
	div.className = 'messagehint';
	div.innerHTML = dump;
	return div;
}

function messageLogFile(message) {
    if (!message)
        return _pad('TIME',14)+_pad('TYPE',8)+_pad('PROTOCOL',10)+_pad('MESSAGE',16)+_pad('SIZE',6)+'TEXT/HEX\r\n';
    let data;
    if (message.binary === false)
        data = textDump(message.data, false);
    else {
        const hex = message.data.split('').map(_convert);
        function _convert(c) {
            const by = c.charCodeAt(0);
            return ('0'+by.toString(16).toUpperCase()).slice(-2);
        }
        data = '[ ' + hex.join(' ') + ' ]';
    }
    return _pad(message.time,14)  +
           _pad(message.type.toUpperCase(),8) +
           _pad(message.protocol, 10) +
           _pad(message.name,16) +
           _pad(message.data.length.toString(),6) +
           data + '\r\n';
    function _pad(t,l) {
        if (!t || (t === '')) t = '?';
        if (t.length < l)
            t += ' '.repeat(l-t.length);
        return t;
    }
}

// Conversion Tools
// ------------------------------------------------------------------------------------

const INVALID_CHAR = '\u25ab';  // ▯ a box char '\u25ab' a box char;
const ELLIPSIS_CHAR = '\u2026'; // …;

function charDump(by) {
    //                      '\u2026'; // … ellipsis
    if (by === 0x09) return '\u2409'; // ␊ \t
    if (by === 0x0A) return '\u240A'; // ␊ \n
    if (by === 0x0D) return '\u240D'; // ␍ \r
    if (by === 0x20) return '\u2420'; // ␠ space
    if (by === 0x3C) return '&lt;';    // <
    if (by === 0x3E) return '&gt;';    // >
    if (by === 0x26) return '&amp;';   // &
    if (by === 0x22) return '&quot;';  // "
    if (by <=  0x1F) return INVALID_CHAR;
    if (by >=  0x7F &&
        by <=  0xA0) return INVALID_CHAR
    return String.fromCharCode(by);
}

function textDump(txt, binary) {
    if (binary === true)
        txt = txt.replace(/[\x00-\x1F\x7F-\xA0]+/gm, ELLIPSIS_CHAR);
    return txt.replace(/[\x00-\x20\x7F-\xA0]/g, _replaceChar);
	function _replaceChar(c) { return charDump(c.charCodeAt(0)); }
}

function jsonDump(json) {
    function replacer(match, pIndent, pKey, pVal, pEnd) {
        const key =  '<span class=json-key>';
        const val =  '<span class=json-value>';
        const bool = '<span class=json-boolean>';
        const str =  '<span class=json-string>';
        const isBool = ['true', 'false'].includes(pVal);
        if (pVal) pVal = pVal.replace(/^"(0x[0-9A-F]+)"$/mg, '$1'); // hex num string to number
        const pValSpan = /^"/.test(pVal) ? str : isBool ? bool : val;
        let r = pIndent || '';
        if (pKey) r = r + key + pKey.replace(/[": ]/g, '') + '</span>: ';
        if (pVal) r = r + pValSpan + pVal + '</span>';
        return r + (pEnd || '');
    }
    const jsonLine = /^( *)("[\w]+": )?("[^"]*"|[\w.+-]*)?([,[{])?$/mg;
    return JSON.stringify(json, null, 2)
        .replace(/&/g, '&amp;').replace(/\\"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(jsonLine, replacer);
}
                                
function hexDump(data, newLine = '</br>')
{
	let i;
    let line = '';
    let txt = ''
    for (i = 0; i < data.length; i ++) {
        if ((i&0xF) == 0) line += ('000'+i.toString(16).toUpperCase()).slice(-4) + ' ';
        const by = data.charCodeAt(i);
        line += ('0'+by.toString(16).toUpperCase()).slice(-2) + ' ';
        txt += charDump(by);
		
        if ((i&0xf)==15) {
            line += '  '+txt+newLine;
            txt = '';
        }
    }
    if (i&0xf) {
        i = 16-(i&0xf);
        if (i) line += '   '.repeat(i)
        line += '  '+txt+newLine;
    }
    return line;
}

/* 
 Text Decoding, Comma separated, NMEA/AT
   S		String
   Q        Quoted Sting
   C		Char
   I		Integer
   U		Unsigned
   R		Real/Float, 
   L		Lat/Long
   T		Time
   D		Date, 
 
 Binary decoding, UBX
   CH 		Char
   S* 		String, zero terminated 
   Sxx		Sting with max length xx, zero terminated 
   I1,I2,I4 Signed Integer
   U1,U2,U4 Unsigned Integer
   U1,U2,U4 Hex Value
   R4,R8	Real/Float

 Special 
 [yy]: 		add optional Array, with optional size yy
 *			Anything
   
*/
function processDecode(data, spec) {
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
            const match = spec.type.match(/^([*A-Z]+)(\d+)?(?:\[(\d*)\])?$/);
            if (!match) throw new Error('Invalid type in message spec');
            const type = match[1];
			let size = match[2];
			let num = match[3];
            if (type === '*') {
                const elem = data.slice(ofs);
                ofs = len;
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
                                    if (m) elem = ['20'+m[3],m[2],m[1]].join('-');
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
                                        if (type === 'X')    v = '0x'+_pad(v,2*size,16);
                                        else if (spec.scale) v *= spec.scale;
                                        elem = v;
                                    }
                                }
                            }
                            ofs = end + 1;
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
								v = (size === 1) ? binary.getInt8(ofs, true) :
									(size === 2) ? binary.getInt16(ofs, true) :
									(size === 4) ? binary.getInt32(ofs, true) : undefined;
							} else if ((type === 'U') || (type == 'X')) {
								v = (size === 1) ? binary.getUint8(ofs, true) :
									(size === 2) ? binary.getUint16(ofs, true) :
									(size === 4) ? binary.getUint32(ofs, true) : undefined;
							} else if (type === 'R') {
								v = (size === 4) ? binary.getFloat32(ofs, true) :
									(size === 8) ? binary.getFloat64(ofs, true) : undefined;
							}
							if (v !== undefined) {
								if (type === 'X')    v = '0x'+_pad(v,2*size,16);
								else if (spec.scale) v *= spec.scale;
								elem = v;
							}
							ofs += size;
						} else {
							ofs = len;
						}
					}
                    if (!noArray || (elem !== undefined))
                        elems.push(elem);
					ix ++;
                }
                return noArray ? elems[0] : elems;
            }
        } else if (spec.spec)  {
            let elems = [];
            const repeat = _repeat(spec.repeat, fields);
            for (let r = 0; (ofs < len) && ((repeat===undefined) || (r < repeat)); r ++ ) {
                const elem = _decodeItem(spec.spec, elems);
                if (elem !== undefined) elems.push(elem);
            }
            return elems;
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

function makeEncode(fields, spec) {
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

// helpers
// ------------------------------------------------------------------------------------

function lookup(list, txt) {
    let num;
    if (typeof txt === 'string') {
        txt = txt.toUpperCase(); // eventually dont do this here
        if (list) {
            for(let item in list) {
                if (list[item] === txt) {
                    num = item;
                    break;
                }
            }
        }
    } 
	if ((num === undefined) && !isNaN(txt)) {
        num = Number(txt);
		if (list && list[num])
            txt = list[num];
        else
            txt = _pad(num,2,16);;
    }
    return [txt, num];
}
    
function _pad(v,l,b) {
    let str = '0000000000000000';
    str += v.toString(b?b:10).toUpperCase();
    return str.slice(-l);
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

// UBX protocol
// ------------------------------------------------------------------------------------

const ProtocolUBX = (function () {

// valid types:
// CH: Char, S:String, Sxx:Sting with max length xx, *: Anything,
// I1,I2,I4:Signed Integer, U1,U2,U4:Unsigned Integer, 
// U1,U2,U4:Hex Value, R4,R8:Real/Float,
// [xx]: Array, add optional size xx

const mapCls = {
    0x01:'NAV',  0x02:'RXM',  0x04:'INF', 0x05:'ACK', 0x06:'CFG', 0x09:'UPD', 0x0A:'MON', 0x0B:'AID', 0x0D:'TIM',
    0x10:'ESF',  0x13:'MGA',  0x21:'LOG', 0x27:'SEC', 0x28:'HNR',
    0xF0:'NMEA', 0xF1:'PUBX', 0xF5:'RTCM',
}
const mapMsg = {
    0x01/*NAV*/: { 0x01:'POSECEF',   0x02:'POSLLH',    0x03:'STATUS',    0x04:'DOP',       0x05:'ATT',
                   0x06:'SOL',       0x07:'PVT',       0x09:'ODO',
                   0x10:'RESETODO',  0x11:'VELECEF',   0x12:'VELNED',    0x13:'HPPOSECEF', 0x14:'HPPOSLLH',
                   0x20:'TIMEGPS',   0x21:'TIMEUTC',   0x22:'CLOCK',     0x23:'TIMEGLO',   0x24:'TIMEBDS',
                   0x25:'TIMEGAL',   0x26:'TIMELS',    0x30:'SVINFO',    0x31:'DGPS',      0x32:'SBAS',
                   0x34:'ORB',       0x35:'SAT',       0x39:'GEOFENCE',  0x3B:'SVIN',      0x3C:'RELPOSNED',
                   0x42:'SLAS',      0x60:'AOPSTATUS', 0x61:'EOE',       0x62:'PL' },
    0x02/*RXM*/: { 0x13:'SFRBX',     0x14:'MEASX',     0x15:'RAWX',      0x20:'SVSI',      0x32:'RTCM',
                   0x34:'COR',       0x41:'PMREQ',     0x61:'IMES',      0x59:'RLM',       0x72:'PMP',
                   0x73:'QZSSL6', },
    0x04/*INF*/: { 0x00:'ERROR',     0x01:'WARNING',   0x02:'NOTICE',    0x03:'TEST',      0x04:'DEBUG', },
    0x05/*ACK*/: { 0x00:'NAK',       0x01:'ACK', },
    0x06/*CFG*/: { 0x00:'PRT',       0x01:'MSG',       0x02:'INF',       0x04:'RST',       0x06:'DAT',
                   0x08:'RATE',      0x09:'CFG',       0x11:'RXM',       0x13:'ANT',       0x16:'SBAS',
                   0x17:'NMEA',      0x1B:'USB',       0x1E:'ODO',       0x23:'NAVX5',     0x24:'NAV5',
                   0x31:'TP5',       0x34:'RINV',      0x39:'ITFM',      0x3B:'PM2',       0x3D:'TMODE2',
                   0x3E:'GNSS',      0x47:'LOGFILTER', 0x53:'TXSLOT',    0x57:'PWR',       0x5C:'HNR',
                   0x60:'ESRC',      0x61:'DOSC',      0x62:'SMGR',      0x69:'GEOFENCE',  0x70:'DGNSS',
                   0x71:'TMODE3',    0x84:'FIXSEED',   0x85:'DYNSEED',   0x86:'PMS',       0x93:'BATCH',
                   0x8A:'VALSET',    0x8B:'VALGET',    0x8C:'VALDEL',    0x8D:'SLAS',},
    0x09/*SOS*/: { 0x14:'SOS', },
    0x0A/*MON*/: { 0x02:'IO',        0x04:'VER',       0x06:'MSGPP',     0x07:'RXBUF',     0x08:'TXBUF',
                   0x09:'HW',        0x0B:'HW2',       0x21:'RXR',       0x27:'PATCH',     0x28:'GNSS',
                   0x2E:'SMGR',      0x32:'BATCH',     0x35:'PMP', },
    0x0B/*AID*/: { 0x01:'INI',       0x02:'HUI',       0x30:'ALM',       0x31:'EPH',       0x33:'AOP', },
    0x0D/*TIM*/: { 0x01:'TP',        0x03:'TM2',       0x04:'SVIN',      0x06:'VRFY',      0x11:'DOSC',
                   0x12:'TOS',       0x13:'SMEAS',     0x16:'FCHG',      0x15:'VCOCAL',    0x17:'HOC', },
    0x10/*ESF*/: { 0x02:'MEAS',      0x03:'RAW',       0x10:'STATUS',    0x15:'INS', },
    0x13/*MGA*/: { 0x00:'GPS',       0x02:'GAL',       0x03:'BDS',       0x05:'QZSS',      0x06:'GLO',
                   0x20:'ANO',       0x21:'FLASH',
                   0x40:'INI',       0x60:'ACK',       0x80:'DBD', },
    0x21/*LOG*/: { 0x03:'ERASE',     0x04:'STRING',    0x07:'CREATE',    0x08:'INFO',      0x09:'RETRIEVE',
                   0x0B:'RETRIEVEPOS',                 0x0D:'RETRIEVESTRING',              0x0E:'FINDTIME',
                   0x0F:'RETRIEVEPOSEXTRA',            0x10:'RETRIEVEBATCH',               0x11:'BATCH', },
    0x27/*SEC*/: { 0x01:'SIGN',      0x03:'UNIQID', },
    0x28/*HNR*/: { 0x00:'PVT',       0x02:'INS', },
	0xF0/*NMEA*/:{ 0x00:'GGA', 		 0x01:'GLL',       0x02:'GSA',       0x03:'GSV',
				   0x04:'RMC', 		 0x05:'VTG',       0x06:'GRS',       0x07:'GST',
				   0x08:'ZDA', 		 0x09:'GBS',       0x0A:'DTM',       0x0D:'GNS',
				   0x0F:'VLW', }, 
	0xF1/*PUBX*/:{ 0x00:'PUBX,00',	 0x01:'PUBX,01',   0x03:'PUBX,03',   0x04:'PUBX,04',	},
	0xF5/*RTCM*/:{ 0x05:'1005',      0x4A:'1074',      0x4D:'1077',      0x54:'1084',
				   0x57:'1087', 	 0x5E:'1094',      0x61:'1097',      0x7C:'1124',
				   0x7F:'1027', 	 0xE6:'1230',      0xFD:'4072.1',    0xFE:'4072.0', }, 
};
const mapPort     = { 0:'DDC',   1:'UART1',   2:'UART2',  3:'USB',  4:'SPI', };
const mapProtocol = { 0:'UBX',   1:'NMEA',    2:'RTCM',   /* ... */ 5:'RTCM3', };
const mapInf      = { 0:'ERROR', 1:'WARNING', 2:'NOTICE', 3:'TEST', 4:'DEBUG', };
const mapCfgLayer = { 0:'RAM',   1:'BBR',     2:'FLASH',  /* ... */ 7:'DEFAULT', };

const spec = {
// NAV ------------
	'NAV-DOP':          { descr:'Dilution of precision',
						  spec:[ { name:'itow',        type:'U4', scale:1e-3, unit:'s'   },
                                 { name:'gDop',        type:'U2', scale:1e-2,            },
                                 { name:'pDop',        type:'U2', scale:1e-2,            },
                                 { name:'tDop',        type:'U2', scale:1e-2,            },
                                 { name:'vDop',        type:'U2', scale:1e-2,            },
                                 { name:'hDop',        type:'U2', scale:1e-2,            },
                                 { name:'nDop',        type:'U2', scale:1e-2,            },
                                 { name:'eDop',        type:'U2', scale:1e-2,            }, ] },
    'NAV-HPPOSLLH':     { descr:'High Precision Geodetic Position Solution',
                          spec:[ { name:'version',     type:'U1'                         },
                                 {                     type:'U1[3]'                      },
                                 { name:'itow',        type:'U4', scale:1e-3, unit:'s'   },
                                 { name:'lon',         type:'I4', scale:1e-7, unit:'deg' },
                                 { name:'lat',         type:'I4', scale:1e-7, unit:'deg' },
                                 { name:'height',      type:'I4', scale:1e-3, unit:'m'   },
                                 { name:'msl',         type:'I4', scale:1e-3, unit:'m'   },
                                 { name:'lonHp',       type:'I1', scale:1e-9, unit:'deg' },
                                 { name:'latHP',       type:'I1', scale:1e-9, unit:'deg' }, ] },
    'NAV-POSECEF':      { descr:'Position Solution in ECEF',
						  spec:[ { name:'itow',        type:'U4', scale:1e-3, unit:'s'   },
                                 { name:'ecefX',       type:'I4', scale:1e-2, unit:'m'   },
                                 { name:'ecefY',       type:'I4', scale:1e-2, unit:'m'   },
                                 { name:'ecefZ',       type:'I4', scale:1e-2, unit:'m'   },
                                 { name:'pAcc',        type:'U4', scale:1e-2, unit:'m'   }, ] },
	'NAV-POSLLH':       { descr:'Geodetic Position Solution',
						  spec:[ { name:'itow',        type:'U4', scale:1e-3, unit:'s'   },
                                 { name:'lon',         type:'I4', scale:1e-7, unit:'deg' },
                                 { name:'lat',         type:'I4', scale:1e-7, unit:'deg' },
                                 { name:'height',      type:'I4', scale:1e-3, unit:'m'   },
                                 { name:'msl',         type:'I4', scale:1e-3, unit:'m'   },
                                 { name:'hAcc',        type:'U4', scale:1e-3, unit:'m'   },
                                 { name:'vAcc',        type:'U4', scale:1e-3, unit:'m'   }, ] },
    'NAV-PL':           { descr:'Protection Level',
                          spec:[ { name:'version',     type:'U1',                        },
                                 { name:'tmirCoeff',   type:'U1',                        },
                                 { name:'tmirExp',     type:'U1',                        },
                                 { name:'plPosValid',  type:'U1',                        },
                                 { name:'plPosFrame',  type:'U1',                        },
                                 { name:'plVelValid',  type:'U1',                        },
                                 { name:'plVelFrame',  type:'U1',                        },
                                 { name:'plTimeValid', type:'U1',                        },
                                 {                     type:'U1[4]'                      },
                                 { name:'itow',        type:'U4', scale:1e-3, unit:'s'   },
								 { name:'plPos1',      type:'U4', scale:1e-3, unit:'m'   },
                                 { name:'plPos2',      type:'U4', scale:1e-3, unit:'m'   },
                                 { name:'plPos3',      type:'U4', scale:1e-3, unit:'m'   },
                                 { name:'plVel1',      type:'U4', scale:1e-3, unit:'m/s' },
                                 { name:'plVel2',      type:'U4', scale:1e-3, unit:'m/s' },
                                 { name:'plVel3',      type:'U4', scale:1e-3, unit:'m/s' },
                                 { name:'plPosHorOr',  type:'U2', scale:1e-2, unit:'deg' },
                                 { name:'plVelHorOr',  type:'U2', scale:1e-2, unit:'deg' },
                                 { name:'plTime',      type:'U4',                        }, ] },
    'NAV-PVT':          { descr:'Navigation Position Velocity Time Solution',
						  spec:[ { name:'itow',        type:'U4', scale:1e-3, unit:'s'   },
								 { name:'year',        type:'U2',             unit:'y'   },
                                 { name:'month',       type:'U1',             unit:'month' },
                                 { name:'day',         type:'U1',             unit:'d'   },
                                 { name:'hour',        type:'U1',             unit:'h'   },
                                 { name:'min',         type:'U1',             unit:'min' },
                                 { name:'sec',         type:'U1',             unit:'s'   },
                                 { name:'valid',       type:'X1',                        }, // bit0:validDate, bit1:validTime, bit2:fullyResolved
                                 { name:'tAcc',        type:'U4',             unit:'ns'  },
                                 { name:'nano',        type:'I4',             unit:'ns'  },
                                 { name:'fixType',     type:'U1',                        },
                                 { name:'flags',       type:'X1',                        },  // bit0:fixOk, bit1:diffSol, bit2-4: psmState, bit5:headVehVal, bit6-7:carrSol
                                 { name:'flags2',      type:'X1',                        },  //
                                 { name:'numSV',       type:'U1',                        },
                                 { name:'lon',         type:'I4', scale:1e-7, unit:'deg' },
                                 { name:'lat',         type:'I4', scale:1e-7, unit:'deg' },
                                 { name:'height',      type:'I4', scale:1e-3, unit:'m'   },
                                 { name:'msl',         type:'I4', scale:1e-3, unit:'m'   },
                                 { name:'hAcc',        type:'U4', scale:1e-3, unit:'m'   },
                                 { name:'vAcc',        type:'U4', scale:1e-3, unit:'m'   },
                                 { name:'velN',        type:'I4', scale:1e-3, unit:'m/s' },
                                 { name:'velE',        type:'I4', scale:1e-3, unit:'m/s' },
                                 { name:'velD',        type:'I4', scale:1e-3, unit:'m/s' },
                                 { name:'gSpeed',      type:'U4', scale:1e-3, unit:'m/s' },
                                 { name:'headMot',     type:'I4', scale:1e-5, unit:'deg' },
                                 { name:'sAcc',        type:'U4', scale:1e-3, unit:'m/s' },
                                 { name:'cAcc',        type:'U4', scale:1e-5, unit:'deg' },
                                 { name:'pDop',        type:'U2', scale:1e-2,            },
                                 {                     type:'U1[6]'                      },
                                 { name:'headVeh',     type:'I4', scale:1e-5, unit:'deg' },
                                 {                     type:'U1[4]'                      }, ] },
	'NAV-STATUS':       { descr:'Receiver Navigation Status',
						  spec:[ { name:'itow',        type:'U4', scale:1e-3, unit:'s'   },
                                 { name:'gpsFix',      type:'U1',                        }, // 0:no fix, 1:dead reckoning only, 2:2D-fix, 3:3D-fix, 4:GPS + dead reckoning combined, 5:Time only fix
                                 { name:'flags',       type:'X1',                        }, // bit0:gpsFix, bit1:diffSol, bit2:wknSet, bit3:towSet
                                 { name:'fixStat',     type:'X1',                        }, // bit0:dgpsIStat bit6/7:mapMatching
                                 { name:'flags2',      type:'X1',                        }, // bit0/1:psmState, bit3/4:spoofDetState
                                 { name:'ttff',        type:'U4', scale:1e-3, unit:'s'   },
                                 { name:'msss',        type:'U4', scale:1e-3, unit:'s'   }, ] },
    'NAV-VELECEF':      { descr:'Velocity Solution in ECEF',
						  spec:[ { name:'itow',        type:'U4', scale:1e-3, unit:'s'   },
                                 { name:'ecefVX',      type:'I4', scale:1e-2, unit:'m/s' },
                                 { name:'ecefVY',      type:'I4', scale:1e-2, unit:'m/s' },
                                 { name:'ecefVZ',      type:'I4', scale:1e-2, unit:'m/s' },
                                 { name:'sAcc',        type:'U4', scale:1e-2, unit:'m/s' }, ] },
	'NAV-VELNED':       { descr:'Velocity Solution in NED',
						  spec:[ { name:'itow',        type:'U4', scale:1e-3, unit:'s'   },
                                 { name:'velN',        type:'I4', scale:1e-2, unit:'m/s' },
                                 { name:'velE',        type:'I4', scale:1e-2, unit:'m/s' },
                                 { name:'velD',        type:'I4', scale:1e-2, unit:'m/s' },
                                 { name:'speed',       type:'U4', scale:1e-2, unit:'m/s' },
                                 { name:'gSpeed',      type:'U4', scale:1e-2, unit:'m/s' },
                                 { name:'headMot',     type:'I4', scale:1e-5, unit:'deg' },
                                 { name:'sAcc',        type:'U4', scale:1e-2, unit:'m/s' },
                                 { name:'cAcc',        type:'U4', scale:1e-5, unit:'deg' }, ] },
	'NAV-SAT':          { descr:'Satellite Information',
						  spec:[ { name:'itow',        type:'U4', scale:1e-3, unit:'s'   },
                                 { name:'version',     type:'U1'                         },
                                 { name:'numSvs',      type:'U1'                         },
                                 {                     type:'U1[2]'                      },
                                 { name:'svs',         repeat:'numSvs', spec: [
                                   { name:'gnssId',    type:'U1'                         },
                                   { name:'svId',      type:'U1'                         }, // U:Used, e:Ephemeris but not used, -:Not used
                                   { name:'cno',       type:'U1',             unit:'dBHz'},
                                   { name:'elv',       type:'I1',             unit:'deg' },
                                   { name:'azim',      type:'I2',             unit:'deg' },
                                   { name:'prRes',     type:'I2', scale:0.1,  unit:'m'   },
                                   { name:'flags',     type:'X4',    }, ] }, ] },
// RXM ------------
    'RXM-COR':          { descr:'Differential correction input status',
                          spec:[ { name:'ver',         type:'U1',                        },
                                 { name:'ebn0',        type:'U1', scale:0.125, unit:'dB' },
                                 {                     type:'U1[2]'                      },
                                 { name:'statusInfo',  type:'X4',                        },
                                 { name:'msgType',     type:'U2',                        },
                                 { name:'msgSubType',  type:'U2',                        } ] },
    'RXM-PMP':          { descr:'PMP point to multipoint',
                          spec:[ { name:'ver',         type:'U1',                        },
                                 { /*name:'res0',*/    type:'U1',                        },
                                 { name:'numUserBytes',type:'U2',                        },
                                 { name:'timeTag',     type:'U4'                         },
                                 { name:'uniqueWord',  type:'U4[2]',                     },
                                 { name:'serviceId',   type:'U2',                        },
                                 { /*name:'spare',*/   type:'U1',                        },
                                 { name:'bitErrors',   type:'U1',                        },
                                 { name:'fecBits',     type:'U2',                        },
                                 { name:'ebn0',        type:'U1', scale:0.125, unit:'dB' },
                                 { /*name:'rese1',*/   type:'U1',                        },
                                 { name:'userData',    type:'U1[504]',                   } ] },
    'RXM-QZSSL6':       { descr:'QZSS L6 message',
                          spec:[ { name:'ver',         type:'U1',                        },
                                 { name:'svId',        type:'U1',                        },
                                 { name:'cno',         type:'U2', scale:0.00390625, unit:'dB' },
                                 { name:'timeTag',     type:'U4'                         },
                                 { name:'groupDelay',  type:'U1',                        },
                                 { name:'bitErrCorr',  type:'U1',                        },
                                 { name:'chInfo',      type:'U2',                        },
                                 { /*name:'res0',*/    type:'U1[2]'                      },
                                 { name:'msgBytes',    type:'U1[250]',                   } ] },
       // INF ------------
    'INF-ERROR':        { descr:'ASCII output with error contents',
						  spec:[ { name:'infTxt',      type:'S*'     }, ] },
    'INF-WARNING':      { descr:'ASCII output with warning contents',
						  spec:[ { name:'infTxt',      type:'S*'     }, ] },
    'INF-NOTICE':       { descr:'ASCII output with informational contents',
						  spec:[ { name:'infTxt',      type:'S*'     }, ] },
    'INF-TEST':         { descr:'ASCII output with test contents',
						  spec:[ { name:'infTxt',      type:'S*'     }, ] },
    'INF-DEBUG':        { descr:'ASCII output with debug contents',
						  spec:[ { name:'infTxt',      type:'S*'     }, ] },
// ACK ------------
    'ACK-NAK':          { descr:'Message Not-Acknowledged',
						  spec:[ { name:'clsID',       type:'U1'     },
                                 { name:'msgID',       type:'U1'     }, ] },
    'ACK-ACK':          { descr:'Message Acknowledged',
						  spec:[ { name:'clsID',       type:'U1'     },
                                 { name:'msgID',       type:'U1'     }, ] },
// CFG ------------
    'CFG-PRT':          { descr:'Port Configuration',
						  spec:[ { name:'portID',      type:'U1'     }, // 0:DDC/I2C/UART0 1:UART1 2:UART2 3:USB 4:SPI
                                 {                     type:'X1'     },
                                 { name:'txReady',     type:'X2'     },
                                 { name:'mode',        type:'X4'     }, // 8N1:0x000008D0 SPI:0x00000100
                                 { name:'baudRate',    type:'U4'     },
                                 { name:'inProtoMask', type:'X2'     }, // bit0:UBX bit1:NMEA bit2:RTCM, bit5:RTCM3
                                 { name:'outProtoMask',type:'X2'     },
                                 { name:'flags',       type:'X4'     }, ] },
    'CFG-MSG':          { descr:'Set Message Rate',
						  spec:[ { name:'clsID',       type:'U1'     },
                                 { name:'msgID',       type:'U1'     },
                                 { name:'rate',        type:'U1[]'   }, ] },
    'CFG-INF':          { descr:'Information message configuration',
						  spec:[ { name:'protocolID',  type:'U1'     }, // 0:UBX, 1:NMEA
                                 { /*name:'res1',*/    type:'U1[3]'  },
                                 { name:'infMsgMask',  type:'U1[]'   }, ] }, // bit0:ERROR, bit1:WARNING, bit2:NOTICE, bit3:TEST, bit4:DEBUG
    'CFG-RST':          { descr:'Reset Receiver / Clear Backup Data Structures',
						  spec:[ { name:'navBbrMask',  type:'X2'     }, // 0x0000:Hotstart 0x0001:Warmstart 0xFFFF:Coldstart
                                 { name:'resetMode',   type:'U1'     }, // 0:WD 1:SW 2:GNSS only 4:HD+WD 8:stop 9:start
                                 {                     type:'X1'     }, ] },
    'CFG-CFG':          { descr:'Clear, Save and Load configurations',
						  spec:[ { name:'clear',       type:'X4'     },
                                 { name:'save',        type:'X4'     },
                                 { name:'load',        type:'X4'     },
                                 { name:'deviceMask',  type:'X1'     }, ] }, // bit0:BBR bit1:FLASH bit2:EEPROM bit4:SPI
    'CFG-VALSET':       { descr:'Sets values corresponding to provided key-value pairs',
						  spec:[ { name:'version',     type:'U1'     }, // 0/1
                                 { name:'layer',       type:'U1'     }, // 0:RAM, 1:BBR, 2:FLASH, 7:DEFAULT
                                 { name:'transaction', type:'U1'     }, // if (version == 1): 0:Transactionless, 1:(Re)Start deletion transaction, 2: Deletion transaction ongoing, 3: Apply and end a deletion transaction
                                 { /*name:'res1',*/    type:'U1'     },
                                 { name:'cfgData',     type:'U1[]'   }, ] }, // key/value pairs U4 + x1|x2|x4|x8
    'CFG-VALGET':       { descr:'Get Configuration Items',
						  spec:[ { name:'version',     type:'U1'     }, // set 1
                                 { name:'layers',      type:'U1'     }, // bit0:RAM, bit1:BBR, bit2:FLASH
                                 { /*name:'res1',*/    type:'U1[2]'  },
                                 { name:'cfgData',     type:'U1[]'   }, ] }, // key/value pairs U4 + x1|x2|x4|x8
    'CFG-VALDEL':       { descr:'Deletes values corresponding to provided keys',
						  spec:[ { name:'version',     type:'U1'     }, // set 0/1
                                 { name:'layers',      type:'U1'     }, // bit1:BBR, bit2:FLASH
                                 { name:'transaction', type:'U1'     }, // if (version == 1): 0:Transactionless, 1:(Re)Start deletion transaction, 2: Deletion transaction ongoing, 3: Apply and end a deletion transaction
                                 { /*name:'res1',*/    type:'U1'     },
                                 { name:'keys',        type:'U4[]'   }, ] }, // keys
// MON ------------
    'MON-VER':          { descr:'Receiver/Software Version',
						  spec:[ { name:'swVer',       type:'S30'    },
								 { name:'hwVer',       type:'S10'    },
								 { name:'extVer',      type:'S30[]'  }, ] },
    'MON-PMP':          { descr:'PMP monitoring data',
						  spec:[ { name:'version',     type:'U1'     },
								 { name:'entries',     type:'U1'   },
								 { /*name:'res0',*/    type:'U1[2]'},
                                 { name:'entry',       repeat:'entries', spec: [
                                    { name:'timeTag',  type:'U4', unit:'ms' },
                                    { name:'status',   type:'X4'            }, // bit0:locked, bit1:frameSync
                                    { name:'lockTime', type:'U4', unit:'ms' }, 
                                    { name:'centerFreq',type:'U4',unit:'Hz' }, 
                                    { name:'cn0',      type:'U1', unit:'dbHz' },
                                    { name:'cn0Frac',  type:'U1', unit:'dbHz', scale:1./256, }, 
                                    { /*name:'res1',*/ type:'U1[2]'}, ] }, ] }, 
// ESF ------------
    'ESF-STATUS':       { descr:'External Sensor Fusion Status',
                          spec:[ { name:'itow',        type:'U4', scale:1e-3, unit:'s'   },
                                 { name:'version',     type:'U1'     },
                                 { /*name:'res0',*/    type:'U1[7]'  },
                                 { name:'fusionMode',  type:'U1'     }, // 0:init, 1:fusion mode, 2:temp suspended, 3:disabled
                                 { /*name:'res1',*/    type:'U1[2]'  },
                                 { name:'numSens',     type:'U1'  },
                                 { name:'sensor',      repeat:'numSens', spec: [
                                    { name:'sensStatus1',    type:'X1'       }, // bit0..5:type, bit6:used, bit7:ready
                                    { name:'sensStatus2',    type:'X1'       }, // bit0..1:calibStatus, bit2..3:timeStatus
                                    { name:'freq',      type:'U1', unit:'Hz' }, 
                                    { name:'faults',    type:'X1'            }, ] }, ] }, // bit0:badMeas, bit1:badTtag, bit2:missingMeas, bit3:noisyMeas
    'MGA-GPS':          { descr:'GPS Assistance Date',
						  spec:[ { name:'type',        type:'U1'     }, // 1:EPH, 2: ALM, 3:TIMEOFFSET, 4:HEALTH 5:UTC 6:IONO
                                 { name:'version',     type:'U1'     },
                                 { name:'svid',        type:'U1'     },
                                 { name:'gnss',        type:'U1'     }, ] },
    'MGA-GAL':          { descr:'Galileo Assistance Date',
						  spec:[ { name:'type',        type:'U1'     },
                                 { name:'version',     type:'U1'     },
                                 { name:'svid',        type:'U1'     },
                                 { name:'gnss',        type:'U1'     }, ] },
    'MGA-BDS':          { descr:'Beidou Assistance Date',
						  spec:[ { name:'type',        type:'U1'     },
                                 { name:'version',     type:'U1'     },
                                 { name:'svid',        type:'U1'     },
                                 { name:'gnss',        type:'U1'     }, ] },
    'MGA-QZSS':         { descr:'QZSS Assistance Date',
						  spec:[ { name:'type',        type:'U1'     },
                                 { name:'version',     type:'U1'     },
                                 { name:'svid',        type:'U1'     },
                                 { name:'gnss',        type:'U1'     }, ] },
    'MGA-GLO':          { descr:'Glonass Assistance Date',
						  spec:[ { name:'type',        type:'U1'     },
                                 { name:'version',     type:'U1'     },
                                 { name:'svid',        type:'U1'     },
                                 { name:'gnss',        type:'U1'     }, ] },
    'MGA-ANO':          { spec:[ { name:'type',        type:'U1'     },
                                 { name:'version',     type:'U1'     },
                                 { name:'svid',        type:'U1'     },
                                 { name:'gnss',        type:'U1'     },
                                 { name:'year',        type:'U1'     },
                                 { name:'month',       type:'U1'     },
                                 { name:'day',         type:'U1'     },
                                 {/*name:'res1', */    type:'U1'     },
                                 { name:'data',        type:'U1[64]' },
                                 {/*name:'res2',*/     type:'U1[4]'  }, ] },
    'MGA-FLASH':        { spec:[ { name:'type',        type:'U1'     }, // 1:DATA, 2:STOP, 3:ACK
                                 { name:'version',     type:'U1'     },
                                 { name:'_data_',      repeat:'((type==1)?1:0)', spec: [
                                   { name:'sequence',  type:'U2'     },
                                   { name:'size',      type:'U2'     },
                                   { name:'data',      type:'U1[]'   }, ] },
                                 { name:'_ack_',       repeat:'((type==3)?1:0)', spec: [
                                   { name:'ack',       type:'U1'     },
                                   {/*name:'res1',*/   type:'U1'     },
                                   { name:'sequence',  type:'U2'     }, ] },
                                 ] },
};

function ubxClsMsgId(cls,msg) {
    let clsNum;
    let msgNum;
    let clsArr = lookup(mapCls, cls);
	cls = clsArr[0];
	clsNum = clsArr[1];
    if (clsNum === undefined || clsNum < 0 || clsNum > 255)
        throw new Error('UBX class ID parameter failed');
    let msgArr = lookup(mapMsg[clsNum], msg);
	msg = msgArr[0];
	msgNum = msgArr[1];
    if (msgNum === undefined || msgNum < 0 || msgNum > 255)
        throw new Error('UBX message ID parameter failed');
    return [ cls + '-' + msg, clsNum, msgNum ];
}

function parse(data, i) {
	const len = data.length; 
	if (i >= len) return WAIT;
    let by = data.charCodeAt(i++);
    if (181 !== by) return NOTFOUND; // = µ, 0xB5
    if (i >= len) return WAIT;
    by = data.charCodeAt(i++);
    if (98 !== by) return NOTFOUND; // = b
    if (i+3 >= len) return WAIT;
    let ckb = 0
    let cka = 0;
    by = data.charCodeAt(i++); // cls
    cka += by; ckb += cka;
    by = data.charCodeAt(i++); // id
    cka += by; ckb += cka;
    by = data.charCodeAt(i++); // len low
    cka += by; ckb += cka;
    let l = by;
    by = data.charCodeAt(i++); // len high
    cka += by; ckb += cka;
    l += (by << 8);
    if (l >= len) return WAIT;
    while (l --) {
        by = data.charCodeAt(i++);
        cka += by; ckb += cka;
    }
    cka = cka & 0xFF;
    ckb = ckb & 0xFF;
    if (i >= len) return WAIT;
    by = data.charCodeAt(i++);
    if (by !== cka) return NOTFOUND;
    if (i >= len) return WAIT;
    by = data.charCodeAt(i++);
    if (by !== ckb) return NOTFOUND;
    return i;
}

function process(data, type) {
    let message = Message('UBX', data, type, true);
    let arr = ubxClsMsgId(message.data.charCodeAt(2), message.data.charCodeAt(3));
	message.id = arr[0];
	message.ubxCls = arr[1];
	message.ubxMsg = arr[2];
    message.name = message.id;
    message.text = message.name;
    const msgSpec = spec[message.id];
	if (msgSpec) {
		message.descr = msgSpec.descr;
        //message.spec = msgSpec.spec;
        if (msgSpec.spec && (message.data.length > 8)) {
            const payload = message.data.slice(6,-2);
            message.fields = processDecode(payload, msgSpec.spec);
			if (message.ubxCls === 0x04 && message.fields.infTxt)
				message.text += ' ' + message.fields.infTxt;
		}
	}
	return message;
}

function make(cls,id,data) {
    let msgId;
    let arr = ubxClsMsgId(cls, id);
    msgId = arr[0];
	cls = arr[1];
	id = arr[2];
    // with the spec try to encode the message
    if (data && (data instanceof Object) && !(data instanceof Array) && !(data instanceof ArrayBuffer)) {
        let msgSpec = spec[msgId];
        if (msgSpec && msgSpec.spec) {
            data = makeEncode(data, msgSpec.spec);
        } else {
            throw new Error('Now specification for message ' + msgId);
        }
    } else {
        data = conv(data);
    }
    // assemble and calc the crc
    data = String.fromCharCode(cls) +
           String.fromCharCode(id) +
           String.fromCharCode((data.length>>0)&0xFF) +
           String.fromCharCode((data.length>>8)&0xFF) +
           data;
    let crc_a = 0;
    let crc_b = 0;
    const len = data.length;
    for (let i = 0; i < len; i ++) {
        crc_a += data.charCodeAt(i);
        crc_b += crc_a;
    }
    crc_a &= 0xFF;
    crc_b &= 0xFF;
    data = "\xB5\x62" + data + String.fromCharCode(crc_a) + String.fromCharCode(crc_b);
	return process(data, TYPE_INPUT);
}

return { process: process, parse: parse, make: make, spec:spec };
})();

// NMEA protocol
// ------------------------------------------------------------------------------------

const ProtocolNMEA = (function () {

// valid types:
// S:String, C:Char, *:Anything
// I:Integer, U:Unsigned, R:Real/Float, 
// L:Lat/Long, T:Time, D:Date, 
// [xx]: Array, add optional size xx
const spec = {
    DTM:{ suggest:false, 
		  descr: 'GNSS Satellite Fault Detection',
          spec:[ { name:'datum',       type:'S' },
                 { name:'subDatum',    type:'S' },
                 { name:'offsetLat',   type:'R', unit:'min' }, { name:'latI',        type:'C' }, // N/S
                 { name:'offsetLong',  type:'R', unit:'min' }, { name:'longI',       type:'C' }, // E/W
                 { name:'offsetAlt',   type:'R', unit:'m' },
                 { name:'refDatum',    type:'S' }, ] },
    GBS:{ suggest:false, 
		  descr: 'GNSS Satellite Fault Detection',
          spec:[ { name:'time',        type:'T' },
                 { name:'errLat',      type:'R', unit:'m' },
                 { name:'errLon',      type:'R', unit:'m' },
                 { name:'errAlt',      type:'R', unit:'m' },
                 { name:'svid',        type:'U' },
                 { name:'prob',        type:'R' },
                 { name:'bias',        type:'R', unit:'m' },
                 { name:'stddev',      type:'R', unit:'m' },
                 { name:'systemId',    type:'U' },
                 { name:'signalId',    type:'U' }, ] },
    GGA:{ suggest:false, 
		  descr: 'Global positioning system fix data',
          spec:[ { name:'time',    	   type:'T' },
                 { name:'latN',    	   type:'L' }, { name:'latI', 	   type:'C' }, // N/S
                 { name:'longN',   	   type:'L' }, { name:'longI',	   type:'C' }, // E/W
                 { name:'quality', 	   type:'I' },
                 { name:'numSV',   	   type:'U' },
                 { name:'hDop',    	   type:'R' },
                 { name:'msl',     	   type:'R', unit:'m' }, {/*name:'mslI',*/  type:'C' },
                 { name:'sep',     	   type:'R', unit:'m' }, {/*name:'sepI',*/  type:'C' },
                 { name:'diffAge', 	   type:'I', unit:'s' },
                 { name:'diffStation', type:'S' }, ] },
    GLL:{ suggest:false, 
		  descr: 'Latitude and longitude, with time of position fix and status',
          spec:[ { name:'latN',        type:'L' }, { name:'latI',     type:'C' },
                 { name:'longN',       type:'L' }, { name:'longI',    type:'C' },
                 { name:'time',        type:'T' },
                 { name:'status',      type:'S' },
                 { name:'posMode',     type:'S' }, ] },
    EIGNQ: { 
	      descr: 'Poll a standard message',
          spec:[ { name:'msgId',       type:'S' }, ] },
    GNS:{ suggest:false, 
		  descr: 'GNSS fix data' ,
          spec:[ { name:'time',        type:'T' },
                 { name:'latN',        type:'L' }, { name:'latI',        type:'C' },
                 { name:'longN',       type:'L' }, { name:'longI',       type:'C' },
                 { name:'posMode',     type:'S' }, // two posModec chars for GPS + GLONASS
                 { name:'numSV',       type:'U' },
                 { name:'hDop',        type:'R' },
                 { name:'msl',         type:'R', unit:'m' }, {/*name:'mslI',*/  type:'C' },
                 { name:'sep',         type:'R', unit:'m' }, {/*name:'sepI',*/  type:'C' },
                 { name:'diffAge',     type:'I', unit:'s' },
                 { name:'diffStation', type:'S' },
                 { name:'navStatus',   type:'C' }, ] },
    GRS:{ suggest:false, 
		  descr: 'GNSS Range Residuals',
          spec:[ { name:'time',        type:'T' },
                 { name:'mode',        type:'U' },
                 { name:'residual',    type:'R[12]', unit:'m' },
                 { name:'systemId',    type:'U' },
                 { name:'signalId',    type:'U' }, ] },
    GSA:{ suggest:false, 
		  descr: 'GNSS DOP and Active Satellites',
          spec:[ { name:'opMode',      type:'S' },
                 { name:'navMode',     type:'U' },
                 { name:'sv',          type:'U[12]' },
                 { name:'pDop',        type:'R' },
                 { name:'hDop',        type:'R' },
                 { name:'vDop',        type:'R' },
                 { name:'systemId',    type:'U' }, ] },
    GST:{ suggest:false, 
		  descr: 'GNSS Pseudo Range Error Statistics',
          spec:[ { name:'time',        type:'T' },
                 { name:'rangeRms',    type:'R', unit:'m' },
                 { name:'stdMajor',    type:'R', unit:'m' },
                 { name:'stdMinor',    type:'R', unit:'m' },
                 { name:'orient',      type:'R', unit:'deg' },
                 { name:'stdLat',      type:'R', unit:'m' },
                 { name:'stdLong',     type:'R', unit:'m' },
                 { name:'stdAlt',      type:'R', unit:'m' }, ] },
    GSV:{ suggest:false, 
		  descr: 'GNSS Satellites in View',
          spec:[ { name:'numMsg', 	   type:'U' },
                 { name:'msgNum', 	   type:'U' },
                 { name:'numSV',  	   type:'U' },
                 { name:'svs',    	   repeat:'min(numSV-(msgNum-1)*4,4)', spec: [
                     { name:'sv', 	     type:'U' },
					 { name:'elv', 	     type:'U', unit:'deg' },
                     { name:'az', 	     type:'U', unit:'deg' },
					 { name:'cno',       type:'U', unit:'dBHz' }, ] },
                 { name:'signalId',	   type:'U' }, ] },
    RMC:{ suggest:false, 
		  descr: 'Recommended Minimum data',
          spec:[ { name:'time',        type:'T' },
                 { name:'status',      type:'C' },
                 { name:'latN',        type:'L' }, { name:'latI',        type:'C' },
                 { name:'longN',       type:'L' }, { name:'longI',    type:'C' },
                 { name:'spdKn',       type:'R', unit:'knots' },
                 { name:'cogt',        type:'R', unit:'deg' },
                 { name:'date',        type:'D' },
                 { name:'mv',          type:'R', unit:'deg' }, { name:'mvI',        type:'C' }, // E/W
                 { name:'posMode',     type:'S' },
                 { name:'navStatus',   type:'S' } ] },
    TXT:{ suggest:false, 
		  descr: 'Text Transmission',
          spec:[ { name:'msg',         type:'U' },
                 { name:'num',         type:'U' },
                 { name:'lvl',         type:'U' },
                 { name:'infTxt',      type:'*' }, ] },
    VLW:{ suggest:false, 
		  descr: 'Dual ground/water distance',
          spec:[ { name:'twd',         type:'R', unit:'nm' }, {/*name:'twdUnit',*/ type:'C' },
                 { name:'wd',          type:'R', unit:'nm' }, {/*name:'wdUnit',*/  type:'C' },
                 { name:'tgd',         type:'R', unit:'nm' }, {/*name:'tgdUnit',*/ type:'C' },
                 { name:'gd',          type:'R', unit:'nm' }, {/*name:'gdUnit',*/  type:'C' }, ] },
    VTG:{ suggest:false, 
		  descr: '',
          spec:[ { name:'cog',         type:'R', unit:'deg' }, {/*name:'cogI',*/ type:'C' },
                 { name:'cogm',        type:'R', unit:'deg' }, {/*name:'cogmI',*/ type:'C' },
                 { name:'spdKn',       type:'R', unit:'knots' }, {/*name:'spdKnI',*/type:'C' },
                 { name:'spdKm',       type:'R', unit:'km/h' }, {/*name:'spdKmI',*/type:'C' },
                 { name:'posMode',     type:'S' }, ] },
    ZDA:{ suggest:false, 
		  descr: 'Time and Date',
          spec:[ { name:'time',        type:'T' },
                 { name:'day',         type:'U' },
                 { name:'month',       type:'U' },
                 { name:'year',        type:'U' },
                 { name:'ltzh',        type:'I' }, ] },
    
    // Proprietary Sentences aka PUBX
    'PUBX,00':{ 
	      suggest:false, 
		  descr: 'Lat/Long Position Data',
          spec:[ { name:'time',        type:'T' },
                 { name:'latN',        type:'L' }, { name:'latI',        type:'C' },
                 { name:'longN',       type:'L' }, { name:'longI',    type:'C' },
                 { name:'altRef',      type:'R', unit:'m' },
                 { name:'navStatus',   type:'S' }, // e.g. NF:No Fix DR:Dead reckoning only solution
                                                   // G2:Stand alone 2D solution G3:Stand alone 3D solution
                                                   // D2:Differential 2D solution D3:Differential 3D solution
                                                   // RK:Combined GPS + dead reckoning solution TT:Time only solution
                 { name:'hAcc',        type:'R', unit:'m' },
                 { name:'vAcc',        type:'R', unit:'m' },
                 { name:'sog',         type:'R', unit:'km/h' },
                 { name:'cog',         type:'R', unit:'deg' },
                 { name:'vVel',        type:'R', unit:'m/s' },
                 { name:'diffAge',     type:'I', unit:'s' },
                 { name:'hDop',        type:'R' },
                 { name:'vDop',        type:'R' },
                 { name:'tDop',        type:'R' },
                 { name:'numSvs',      type:'U' },
                 {                     type:'S' },
                 { name:'DRused',      type:'U' }, ] },
    'PUBX,03':{
		  suggest:false, 
		  descr: 'Satellite Status',
          spec:[ { name:'numSV',         type:'U' },
                 { name:'svs',           spec: [
                     { name:'sv',          type:'U' },
                     { name:'status',      type:'U' }, // U:Used, e:Ephemeris but not used, -:Not used
                     { name:'az',          type:'U', unit:'deg' },
                     { name:'elv',         type:'U', unit:'deg' },
                     { name:'cno',         type:'U', unit:'dBHz' },
                     { name:'lck',         type:'U', unit:'s' }, ] }, ] },
    'PUBX,04':{ 
	      suggest:false, 
		  descr: 'Time of Day and Clock Information',
          spec:[ { name:'time',        type:'T', unit:'hhmmss.ss' },
                 { name:'date',        type:'D', unit:'ddmmyy' },
                 { name:'utcTow',      type:'R', unit:'s' },
                 { name:'utcWk',       type:'U', unit:'weeks' },
                 { name:'leapSec',     type:'S', unit:'s' },
                 { name:'clkBias',     type:'R', unit:'ns' },
                 { name:'clkDrift',    type:'R', unit:'ns/s' },
                 { name:'tpGran',      type:'R', unit:'ns' }, ] },
    'PUBX,40':{
	      descr: 'Set NMEA message output rate',
          spec:[ { name:'msgID',      type:'Q' },
				 { name:'rate',       type:'U[6]' }, ] },
    'PUBX,41':{ 
	      descr: 'Set Protocols and Baudrate',
          spec:[ { name:'portId',       type:'U' },
                 { name:'inProto',      type:'X' },
                 { name:'outProto',     type:'X' },
                 { name:'baudrate',     type:'U', unit:'bits/s' },
                 { name:'autobauding',  type:'U' }, ] },
};

function parse(data, i) {
    const len = data.length; 
	const hex = '0123456789ABCDEF';
    if (i >= len) return WAIT;
    let by = data.charCodeAt(i++);
    if (36 !== by) return NOTFOUND; // $
    let crc = 0;
    while (i < len) {
        by = data.charCodeAt(i++);
        if ((32 > by) || (126 < by)) return NOTFOUND; // not printable
        if (42 === by) break; // *
        crc ^= by;
    }
    if (i >= len) return WAIT;
    by = data.charCodeAt(i++);
    if (hex.charCodeAt((crc>>4)&0xF) !== by) return NOTFOUND;
    if (i >= len) return WAIT;
    by = data.charCodeAt(i++);
    if (hex.charCodeAt(crc&0xF) !== by) return NOTFOUND;
    if (i >= len) return WAIT;
    by = data.charCodeAt(i++);
    if (13 !== by) return NOTFOUND; // \r
    if (i >= len) return WAIT;
    by = data.charCodeAt(i++);
    if (10 !== by) return NOTFOUND; // \n
    return i;
}

function process(data, type) {
    let message = Message('NMEA', data, type, false);
	let m;
    let msgSpec;
    let payload;
    if (m = message.data.match(/\$(G[ABLNPQ])([A-Z]{3}),(.*)\*[0-9A-F]{2}\r\n$/)) { // Standard Nav device
        message.talker = m[1];
        message.id = m[2];
        payload = m[3];
        message.name = message.talker + message.id;
        msgSpec = spec[message.id];
    } else if (m = message.data.match(/\$PUBX,(\d{2}),(.*)\*[0-9A-F]{2}\r\n$/i)) { // P:proprietary PUBX
        message.pubxid = _pad(m[1],2,16);
        message.id = 'PUBX,'+message.pubxid;
        payload = m[2];
        message.name = message.id;
        msgSpec = spec[message.id];
    } else if (m = message.data.match(/\$([A-OQ-Z][A-Z])(G[ABNLPQ]Q),(.*)\*[0-9A-F]{2}\r\n$/)) { // Poll request to nav device
        message.talker = m[1];
        message.id = m[2];
        payload = m[3];
        message.name = message.talker + message.id;
        msgSpec = spec['Q'];
    }
	if (msgSpec) {
		message.descr = msgSpec.descr;
        //message.spec = msgSpec.spec;
        if (msgSpec.spec && (payload !== ''))
            message.fields = processDecode(payload, msgSpec.spec);
	}
    message.text = message.data.replace(/[\r\n]/gm, '');
    return message;
}

function make(data) {
    data = conv(data);
    let crc = 0;
    const len = data.length;
    for (let i = 0; i < len; i ++)
        crc = crc ^ data.charCodeAt(i);
    crc &= 0xFF;
    crc = ('0'+crc.toString(16).toUpperCase()).slice(-2);
	data = '$' + data + '*' + crc + "\r\n"
	return process(data, TYPE_INPUT);
}
    
return { process: process, parse: parse, make:make, spec:spec };
})();

// RTCM3 protocol
// ------------------------------------------------------------------------------------

const ProtocolRTCM3 = (function () {

const spec = {
	1001: { descr: 'L1-only GPS RTK observables', }, 
    1002: { descr: 'Extended L1-only GPS RTK observables', }, 
    1003: { descr: 'L1 & L2 GPS RTK observables', }, 
    1004: { descr: 'Extended L1 & L2 GPS RTK observables', }, 
    1005: { descr: 'Stationary RTK reference station ARP', }, 
    1006: { descr: 'Stationary RTK reference station ARP with antenna height', }, 
    1007: { descr: 'Antenna descriptor', },
    1009: { descr: 'L1-only GLONASS RTK observables', },
    1010: { descr: 'Extended L1-only GLONASS RTK observables', }, 
    1011: { descr: 'L1 & L2 GLONASS RTK observables', }, 
    1012: { descr: 'Extended L1 & L2 GLONASS RTK observables', },
    1074: { descr: 'GPS MSM4', },
    1077: { descr: 'GPS MSM7', },
	1084: { descr: 'GLONASS MSM4', },
    1087: { descr: 'GLONASS MSM7', },
	1094: { descr: 'Galileo MSM4', },
    1097: { descr: 'Galileo MSM7', },
    1124: { descr: 'BeiDou MSM4', },
    1127: { descr: 'BeiDou MSM7', },
    4072: { descr: 'u-blox proprietary message', },
	'4072.0': { descr: 'u-blox sub-type 0: Reference station PVT', },
    '4072.1': { descr: 'u-blox sub-type 1: Additional reference station information', },
    
    // not used by u-blox
    // https://www.use-snip.com/kb/knowledge-base/rtcm-3-message-list/
    1008: { descr: 'Antenna Descriptor and Serial Number', },
    1013: { descr: 'System Parameters, time offsets, lists of messages sent', },
    1014: { descr: 'Network Auxiliary Station Data', },
    1015: { descr: 'GPS Ionospheric Correction Differences', },
    1016: { descr: 'GPS Geometric Correction Differences', },
    1017: { descr: 'GPS Combined Geometric and Ionospheric Correction Differences', },
    1019: { descr: 'GPS Broadcast Ephemeris (orbits)', },
    1020: { descr: 'GLONASS Broadcast Ephemeris (orbits)', },
    1021: { descr: 'Helmert / Abridged Molodenski Transformation Parameters', },
    1022: { descr: 'Molodenski-Badekas Transformation Parameters', },
    1023: { descr: 'Residuals, Ellipsoidal Grid Representation', },
    1024: { descr: 'Residuals, Plane Grid Representation', },
    1025: { descr: 'Projection Parameters, Projection Types other than Lambert Conic Conformal', },
    1026: { descr: 'Projection Parameters, Projection Type LCC2SP (Lambert Conic Conformal', },
    1027: { descr: 'Projection Parameters, Projection Type OM (Oblique Mercator)', },
    1029: { descr: 'Unicode Text String (used for human readable text)', },
    1030: { descr: 'GPS Network RTK Residual Message', },
    1031: { descr: 'GLONASS Network RTK Residual', },
    1032: { descr: 'Physical Reference Station Position', },
    1033: { descr: 'Receiver and Antenna Descriptors', },
    1034: { descr: 'GPS Network FKP Gradient', },
    1035: { descr: 'GLONASS Network FKP Gradient', },
    1036: { descr: 'Not defined at this time', },
    1037: { descr: 'GLONASS Ionospheric Correction Differences', },
    1038: { descr: 'GLONASS Geometric Correction Differences', },
    1039: { descr: 'GLONASS Combined Geometric and Ionospheric Correction Differences', },
    1042: { descr: 'BDS Satellite Ephemeris Data', },
    1044: { descr: 'QZSS Ephemerides', },
    1045: { descr: 'Galileo Broadcast Ephemeris', },
    1046: { descr: 'Galileo I/NAV Satellite Ephemeris Data' },
    1057: { descr: 'SSR GPS orbit corrections to Broadcast Ephemeris', },
    1058: { descr: 'SSR GPS clock corrections to Broadcast Ephemeris', },
    1059: { descr: 'SSR GPS code biases', },
    1060: { descr: 'SSR Combined orbit and clock corrections to GPS Broadcast Ephemeris', },
    1061: { descr: 'SSR GPS User Range Accuracy', },
    1062: { descr: 'SSR High-rate GPS clock corrections to Broadcast Ephemeris', },
    1063: { descr: 'SSR GLONASS orbit corrections for Broadcast Ephemeris', },
    1064: { descr: 'SSR GLONASS clock corrections for Broadcast Ephemeris', },
    1065: { descr: 'SSR GLONASS code biases', },
    1066: { descr: 'SSR Combined orbit and clock corrections to GLONASS Broadcast Ephemeris', },
    1067: { descr: 'SSR GLONASS User Range Accuracy (URA)', },
    1068: { descr: 'High-rate GLONASS clock corrections to Broadcast Ephemeris', },
	/*
    MSM1    DGNSS uses, Pseudorange, (conventional and advanced)
    MSM2    RTK uses, Pseudorange only
    MSM3    RTK uses, Pseudorange (i.e. Code) and PhaseRange (i.e. Carrier)
    MSM4    RTK uses, Pseudorange, PhaseRange, CNR  (but No Doppler)
    MSM5    RTK uses, Pseudorange, PhaseRange, Doppler, CNR
    MSM6    RTK uses, Pseudorange, PhaseRange CNR, with high resolution
    MSM7    RTK uses, Pseudorange, PhaseRange, Doppler, CNR, with high resolution
    */
    1071: { descr: 'GPS MSM1', },
    1072: { descr: 'GPS MSM2', },
    1073: { descr: 'GPS MSM3', },
    1075: { descr: 'GPS MSM5', },
    1076: { descr: 'GPS MSM6', },
    1081: { descr: 'GLONASS MSM1', },
    1082: { descr: 'GLONASS MSM2', },
    1083: { descr: 'GLONASS MSM3', },
    1085: { descr: 'GLONASS MSM5', },
    1086: { descr: 'GLONASS MSM6', },
    1091: { descr: 'Galileo MSM1', },
    1092: { descr: 'Galileo MSM2', },
    1093: { descr: 'Galileo MSM3', },
    1095: { descr: 'Galileo MSM5', },
    1096: { descr: 'Galileo MSM6', },
    1101: { descr: 'SBAS MSM1', },
    1102: { descr: 'SBAS MSM2', },
    1103: { descr: 'SBAS MSM3', },
    1104: { descr: 'SBAS MSM4', },
    1105: { descr: 'SBAS MSM5', },
    1106: { descr: 'SBAS MSM6', },
    1107: { descr: 'SBAS MSM7', },
    1111: { descr: 'QZSS MSM1', },
    1112: { descr: 'QZSS MSM2', },
    1113: { descr: 'QZSS MSM3', },
    1114: { descr: 'QZSS MSM4', },
    1115: { descr: 'QZSS MSM5', },
    1116: { descr: 'QZSS MSM6', },
    1117: { descr: 'QZSS MSM7', },
    1121: { descr: 'BeiDou MSM1', },
    1122: { descr: 'BeiDou MSM2', },
    1123: { descr: 'BeiDou MSM3', },
    1125: { descr: 'BeiDou MSM5', },
    1126: { descr: 'BeiDou MSM6', },
	1230: { descr: 'GLONASS L1 and L2 Code-Phase Biases', },
};

function parse(data, i) {
	const len = data.length; 
	if (i >= len) return WAIT;
	let by = data.charCodeAt(i);
	if (0xD3 !== by) return NOTFOUND;
	if (i+1 >= len) return WAIT;
	by = data.charCodeAt(i+1);
	if ((0xFC & by) !== 0) return NOTFOUND;
	let l = (by & 0x3) << 8;
	if (i+2 >= len) return WAIT;
	by = data.charCodeAt(i+2);
	l += by + 6 + i;
	if (l >= len) return WAIT;
    let crc = 0;
    // CRC24Q check
    const _crc24qTable = [
        /* 00 */ 0x000000, 0x864cfb, 0x8ad50d, 0x0c99f6, 0x93e6e1, 0x15aa1a, 0x1933ec, 0x9f7f17,
        /* 08 */ 0xa18139, 0x27cdc2, 0x2b5434, 0xad18cf, 0x3267d8, 0xb42b23, 0xb8b2d5, 0x3efe2e,
        /* 10 */ 0xc54e89, 0x430272, 0x4f9b84, 0xc9d77f, 0x56a868, 0xd0e493, 0xdc7d65, 0x5a319e,
        /* 18 */ 0x64cfb0, 0xe2834b, 0xee1abd, 0x685646, 0xf72951, 0x7165aa, 0x7dfc5c, 0xfbb0a7,
        /* 20 */ 0x0cd1e9, 0x8a9d12, 0x8604e4, 0x00481f, 0x9f3708, 0x197bf3, 0x15e205, 0x93aefe,
        /* 28 */ 0xad50d0, 0x2b1c2b, 0x2785dd, 0xa1c926, 0x3eb631, 0xb8faca, 0xb4633c, 0x322fc7,
        /* 30 */ 0xc99f60, 0x4fd39b, 0x434a6d, 0xc50696, 0x5a7981, 0xdc357a, 0xd0ac8c, 0x56e077,
        /* 38 */ 0x681e59, 0xee52a2, 0xe2cb54, 0x6487af, 0xfbf8b8, 0x7db443, 0x712db5, 0xf7614e,
        /* 40 */ 0x19a3d2, 0x9fef29, 0x9376df, 0x153a24, 0x8a4533, 0x0c09c8, 0x00903e, 0x86dcc5,
        /* 48 */ 0xb822eb, 0x3e6e10, 0x32f7e6, 0xb4bb1d, 0x2bc40a, 0xad88f1, 0xa11107, 0x275dfc,
        /* 50 */ 0xdced5b, 0x5aa1a0, 0x563856, 0xd074ad, 0x4f0bba, 0xc94741, 0xc5deb7, 0x43924c,
        /* 58 */ 0x7d6c62, 0xfb2099, 0xf7b96f, 0x71f594, 0xee8a83, 0x68c678, 0x645f8e, 0xe21375,
        /* 60 */ 0x15723b, 0x933ec0, 0x9fa736, 0x19ebcd, 0x8694da, 0x00d821, 0x0c41d7, 0x8a0d2c,
        /* 68 */ 0xb4f302, 0x32bff9, 0x3e260f, 0xb86af4, 0x2715e3, 0xa15918, 0xadc0ee, 0x2b8c15,
        /* 70 */ 0xd03cb2, 0x567049, 0x5ae9bf, 0xdca544, 0x43da53, 0xc596a8, 0xc90f5e, 0x4f43a5,
        /* 78 */ 0x71bd8b, 0xf7f170, 0xfb6886, 0x7d247d, 0xe25b6a, 0x641791, 0x688e67, 0xeec29c,
        /* 80 */ 0x3347a4, 0xb50b5f, 0xb992a9, 0x3fde52, 0xa0a145, 0x26edbe, 0x2a7448, 0xac38b3,
        /* 88 */ 0x92c69d, 0x148a66, 0x181390, 0x9e5f6b, 0x01207c, 0x876c87, 0x8bf571, 0x0db98a,
        /* 90 */ 0xf6092d, 0x7045d6, 0x7cdc20, 0xfa90db, 0x65efcc, 0xe3a337, 0xef3ac1, 0x69763a,
        /* 98 */ 0x578814, 0xd1c4ef, 0xdd5d19, 0x5b11e2, 0xc46ef5, 0x42220e, 0x4ebbf8, 0xc8f703,
        /* a0 */ 0x3f964d, 0xb9dab6, 0xb54340, 0x330fbb, 0xac70ac, 0x2a3c57, 0x26a5a1, 0xa0e95a,
        /* a8 */ 0x9e1774, 0x185b8f, 0x14c279, 0x928e82, 0x0df195, 0x8bbd6e, 0x872498, 0x016863,
        /* b0 */ 0xfad8c4, 0x7c943f, 0x700dc9, 0xf64132, 0x693e25, 0xef72de, 0xe3eb28, 0x65a7d3,
        /* b8 */ 0x5b59fd, 0xdd1506, 0xd18cf0, 0x57c00b, 0xc8bf1c, 0x4ef3e7, 0x426a11, 0xc426ea,
        /* c0 */ 0x2ae476, 0xaca88d, 0xa0317b, 0x267d80, 0xb90297, 0x3f4e6c, 0x33d79a, 0xb59b61,
        /* c8 */ 0x8b654f, 0x0d29b4, 0x01b042, 0x87fcb9, 0x1883ae, 0x9ecf55, 0x9256a3, 0x141a58,
        /* d0 */ 0xefaaff, 0x69e604, 0x657ff2, 0xe33309, 0x7c4c1e, 0xfa00e5, 0xf69913, 0x70d5e8,
        /* d8 */ 0x4e2bc6, 0xc8673d, 0xc4fecb, 0x42b230, 0xddcd27, 0x5b81dc, 0x57182a, 0xd154d1,
        /* e0 */ 0x26359f, 0xa07964, 0xace092, 0x2aac69, 0xb5d37e, 0x339f85, 0x3f0673, 0xb94a88,
        /* e8 */ 0x87b4a6, 0x01f85d, 0x0d61ab, 0x8b2d50, 0x145247, 0x921ebc, 0x9e874a, 0x18cbb1,
        /* f0 */ 0xe37b16, 0x6537ed, 0x69ae1b, 0xefe2e0, 0x709df7, 0xf6d10c, 0xfa48fa, 0x7c0401,
        /* f8 */ 0x42fa2f, 0xc4b6d4, 0xc82f22, 0x4e63d9, 0xd11cce, 0x575035, 0x5bc9c3, 0xdd8538
    ];
    while (i < l) {
		by = data.charCodeAt(i++);
		const ix = ((crc >> 16) & 0xff);
        crc = ((crc << 8) | by) ^ _crc24qTable[ix];
	}
    if ((crc & 0xFFFFFF) != 0x000000) return NOTFOUND;
    return l;
}

function process(data, type) {
    let message = Message('RTCM3', data, type, true);
	message.id = (message.data.charCodeAt(4) >> 4) + (message.data.charCodeAt(3) << 4);
	message.name = message.id.toString();
	if (message.id === 4072) {
		message.subtype = ((message.data.charCodeAt(4) & 0xF) << 8) + message.data.charCodeAt(5);
		message.name += '.' + message.subtype.toString();
	} 
    message.text = message.name;
    const msgSpec = spec[message.id];
    if (msgSpec) {
        ///message.spec = msgSpec.spec;
        message.descr = msgSpec.descr;
        if (msgSpec.spec && (message.data.length > 6)) {
            //let payload = message.data.slice(3, -3);
            //message.fields = processDecode(payload, msgSpec.spec);
        }
    }
    return message;
}
	
return { process: process, parse: parse };
})();

// RTCM3 protocol
// ------------------------------------------------------------------------------------

const protocolSPARTN = (function () {

const mapType = {
    0:'OCB',  1:'HPAC',  2:'GAD',  3:'BPAC',  4:'EAS',  120:'PROP', 
}
const mapSubType = {
    0/*OCB*/:     { 0:'GPS',  1:'GLONASS',  2:'GALILEO',  3:'BEIDOU',  4:'QZSS',    },
    1/*HPAC*/:    { 0:'GPS',  1:'GLONASS',  2:'GALILEO',  3:'BEIDOU',  4:'QZSS',    },
    2/*GAD*/:     { 0:'MSG0',                                                       },
    3/*BPAC*/:    { 0:'POLYNOMIAL'                                                  },
    4/*EAS*/:     { 0:'DYNAMICKEY',  1:'GROUPAUTH',                                 },
    120/*PROP*/:  { 0:'SAPCORDA',    1:'UBLOX',  2:'SWIFT',                         }
}

const spec = {
    // type 0: GNSS Orbit, Clock, Bias (OCB) messages
    'OCB'             : { descr: 'GNSS Orbit, Clock, Bias',                           },
    'OCB-GPS'         : { descr: 'GPS Orbit, Clock, Bias',                            },
    'OCB-GLONASS'     : { descr: 'Glonass Orbit, Clock, Bias',                        },
    'OCB-GALILEO'     : { descr: 'Galileo Orbit, Clock, Bias',                        },
    'OCB-BEIDOU'      : { descr: 'BeiDou Orbit, Clock, Bias',                         },
    'OCB-QZSS'        : { descr: 'QZSS Orbit, Clock, Bias',                           },
    // type 1: High-precision atmosphere correction (HPAC) messages
    'HPAC'            : { descr: 'GNSS High-precision atmosphere correction',          }, 
    'HPAC-GPS'        : { descr: 'GPS High-precision atmosphere correction',           }, 
    'HPAC-GLONASS'    : { descr: 'Glonass High-precision atmosphere correction',       },  
    'HPAC-GALILEO'    : { descr: 'Galileo High-precision atmosphere correction',       },
    'HPAC-BEIDOU'     : { descr: 'BeiDou High-precision atmosphere correction',        },
    'HPAC-QZSS'       : { descr: 'QZSS High-precision atmosphere correction',          },
    // type 2: Geographic Area Definition (GAD) messages
    'GAD'             : { descr: 'Geographic Area Definition',                         }, 
    'GAD-MSG0'        : { descr: 'Geographic Area Definition',                         }, 
    // type 3: Basic-peecision atmosphere correction (BPAC) messages
    'BPAC'            : { descr: 'Basic-precision atmosphere correction',   }, 
    'BPAC-POLYNOMIAL' : { descr: 'Basic-precision atmosphere correction polynomial',   }, 
    // type 4: Encryption and Authentication Support (EAS) messages
    'EAS'             : { descr: 'Encryption and Authentication Support',              }, 
    'EAS-DYNAMICKEY'  : { descr: 'Dynamic Key',                                        }, 
    'EAS-GROUPAUTH'   : { descr: 'Group Authentication',                               },
    // type 120: Proprietary messages 
    'PROP'            : { descr: 'Proprietary',                                        }, 
    'PROP-SAPCORDA'   : { descr: 'Proprietary Sapcorda',                               }, 
    'PROP-UBLOX'      : { descr: 'Proprietary u-blox AG',                              }, 
    'PROP-SWIFT'      : { descr: 'Proprietary Swift Navigation',                       },
};

function parse(data, i) {
    const len = data.length; 
    if (i >= len) return WAIT;
    let by = data.charCodeAt(i);
    if (0x73 !== by) return NOTFOUND;
    if (i + 4 >= len) return WAIT;
    const _CrcTables = { 
        4 : [   0x0, 0xB, 0x5, 0xE, 0xA, 0x1, 0xF, 0x4,
                0x7, 0xC, 0x2, 0x9, 0xD, 0x6, 0x8, 0x3,
                0xE, 0x5, 0xB, 0x0, 0x4, 0xF, 0x1, 0xA,
                0x9, 0x2, 0xC, 0x7, 0x3, 0x8, 0x6, 0xD,
                0xF, 0x4, 0xA, 0x1, 0x5, 0xE, 0x0, 0xB,
                0x8, 0x3, 0xD, 0x6, 0x2, 0x9, 0x7, 0xC,
                0x1, 0xA, 0x4, 0xF, 0xB, 0x0, 0xE, 0x5,
                0x6, 0xD, 0x3, 0x8, 0xC, 0x7, 0x9, 0x2,
                0xD, 0x6, 0x8, 0x3, 0x7, 0xC, 0x2, 0x9,
                0xA, 0x1, 0xF, 0x4, 0x0, 0xB, 0x5, 0xE,
                0x3, 0x8, 0x6, 0xD, 0x9, 0x2, 0xC, 0x7,
                0x4, 0xF, 0x1, 0xA, 0xE, 0x5, 0xB, 0x0,
                0x2, 0x9, 0x7, 0xC, 0x8, 0x3, 0xD, 0x6,
                0x5, 0xE, 0x0, 0xB, 0xF, 0x4, 0xA, 0x1,
                0xC, 0x7, 0x9, 0x2, 0x6, 0xD, 0x3, 0x8,
                0xB, 0x0, 0xE, 0x5, 0x1, 0xA, 0x4, 0xF,
                0x9, 0x2, 0xC, 0x7, 0x3, 0x8, 0x6, 0xD,
                0xE, 0x5, 0xB, 0x0, 0x4, 0xF, 0x1, 0xA,
                0x7, 0xC, 0x2, 0x9, 0xD, 0x6, 0x8, 0x3,
                0x0, 0xB, 0x5, 0xE, 0xA, 0x1, 0xF, 0x4,
                0x6, 0xD, 0x3, 0x8, 0xC, 0x7, 0x9, 0x2,
                0x1, 0xA, 0x4, 0xF, 0xB, 0x0, 0xE, 0x5,
                0x8, 0x3, 0xD, 0x6, 0x2, 0x9, 0x7, 0xC,
                0xF, 0x4, 0xA, 0x1, 0x5, 0xE, 0x0, 0xB,
                0x4, 0xF, 0x1, 0xA, 0xE, 0x5, 0xB, 0x0,
                0x3, 0x8, 0x6, 0xD, 0x9, 0x2, 0xC, 0x7,
                0xA, 0x1, 0xF, 0x4, 0x0, 0xB, 0x5, 0xE,
                0xD, 0x6, 0x8, 0x3, 0x7, 0xC, 0x2, 0x9,
                0xB, 0x0, 0xE, 0x5, 0x1, 0xA, 0x4, 0xF,
                0xC, 0x7, 0x9, 0x2, 0x6, 0xD, 0x3, 0x8,
                0x5, 0xE, 0x0, 0xB, 0xF, 0x4, 0xA, 0x1,
                0x2, 0x9, 0x7, 0xC, 0x8, 0x3, 0xD, 0x6 ],
        8 : [   0x00, 0x07, 0x0E, 0x09, 0x1C, 0x1B, 0x12, 0x15,
                0x38, 0x3F, 0x36, 0x31, 0x24, 0x23, 0x2A, 0x2D,
                0x70, 0x77, 0x7E, 0x79, 0x6C, 0x6B, 0x62, 0x65,
                0x48, 0x4F, 0x46, 0x41, 0x54, 0x53, 0x5A, 0x5D,
                0xE0, 0xE7, 0xEE, 0xE9, 0xFC, 0xFB, 0xF2, 0xF5,
                0xD8, 0xDF, 0xD6, 0xD1, 0xC4, 0xC3, 0xCA, 0xCD,
                0x90, 0x97, 0x9E, 0x99, 0x8C, 0x8B, 0x82, 0x85,
                0xA8, 0xAF, 0xA6, 0xA1, 0xB4, 0xB3, 0xBA, 0xBD,
                0xC7, 0xC0, 0xC9, 0xCE, 0xDB, 0xDC, 0xD5, 0xD2,
                0xFF, 0xF8, 0xF1, 0xF6, 0xE3, 0xE4, 0xED, 0xEA,
                0xB7, 0xB0, 0xB9, 0xBE, 0xAB, 0xAC, 0xA5, 0xA2,
                0x8F, 0x88, 0x81, 0x86, 0x93, 0x94, 0x9D, 0x9A,
                0x27, 0x20, 0x29, 0x2E, 0x3B, 0x3C, 0x35, 0x32,
                0x1F, 0x18, 0x11, 0x16, 0x03, 0x04, 0x0D, 0x0A,
                0x57, 0x50, 0x59, 0x5E, 0x4B, 0x4C, 0x45, 0x42,
                0x6F, 0x68, 0x61, 0x66, 0x73, 0x74, 0x7D, 0x7A,
                0x89, 0x8E, 0x87, 0x80, 0x95, 0x92, 0x9B, 0x9C,
                0xB1, 0xB6, 0xBF, 0xB8, 0xAD, 0xAA, 0xA3, 0xA4,
                0xF9, 0xFE, 0xF7, 0xF0, 0xE5, 0xE2, 0xEB, 0xEC,
                0xC1, 0xC6, 0xCF, 0xC8, 0xDD, 0xDA, 0xD3, 0xD4,
                0x69, 0x6E, 0x67, 0x60, 0x75, 0x72, 0x7B, 0x7C,
                0x51, 0x56, 0x5F, 0x58, 0x4D, 0x4A, 0x43, 0x44,
                0x19, 0x1E, 0x17, 0x10, 0x05, 0x02, 0x0B, 0x0C,
                0x21, 0x26, 0x2F, 0x28, 0x3D, 0x3A, 0x33, 0x34,
                0x4E, 0x49, 0x40, 0x47, 0x52, 0x55, 0x5C, 0x5B,
                0x76, 0x71, 0x78, 0x7F, 0x6A, 0x6D, 0x64, 0x63,
                0x3E, 0x39, 0x30, 0x37, 0x22, 0x25, 0x2C, 0x2B,
                0x06, 0x01, 0x08, 0x0F, 0x1A, 0x1D, 0x14, 0x13,
                0xAE, 0xA9, 0xA0, 0xA7, 0xB2, 0xB5, 0xBC, 0xBB,
                0x96, 0x91, 0x98, 0x9F, 0x8A, 0x8D, 0x84, 0x83,
                0xDE, 0xD9, 0xD0, 0xD7, 0xC2, 0xC5, 0xCC, 0xCB,
                0xE6, 0xE1, 0xE8, 0xEF, 0xFA, 0xFD, 0xF4, 0xF3 ], 
        16 : [  0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50A5, 0x60C6, 0x70E7,
                0x8108, 0x9129, 0xA14A, 0xB16B, 0xC18C, 0xD1AD, 0xE1CE, 0xF1EF,
                0x1231, 0x0210, 0x3273, 0x2252, 0x52B5, 0x4294, 0x72F7, 0x62D6,
                0x9339, 0x8318, 0xB37B, 0xA35A, 0xD3BD, 0xC39C, 0xF3FF, 0xE3DE,
                0x2462, 0x3443, 0x0420, 0x1401, 0x64E6, 0x74C7, 0x44A4, 0x5485,
                0xA56A, 0xB54B, 0x8528, 0x9509, 0xE5EE, 0xF5CF, 0xC5AC, 0xD58D,
                0x3653, 0x2672, 0x1611, 0x0630, 0x76D7, 0x66F6, 0x5695, 0x46B4,
                0xB75B, 0xA77A, 0x9719, 0x8738, 0xF7DF, 0xE7FE, 0xD79D, 0xC7BC,
                0x48C4, 0x58E5, 0x6886, 0x78A7, 0x0840, 0x1861, 0x2802, 0x3823,
                0xC9CC, 0xD9ED, 0xE98E, 0xF9AF, 0x8948, 0x9969, 0xA90A, 0xB92B,
                0x5AF5, 0x4AD4, 0x7AB7, 0x6A96, 0x1A71, 0x0A50, 0x3A33, 0x2A12,
                0xDBFD, 0xCBDC, 0xFBBF, 0xEB9E, 0x9B79, 0x8B58, 0xBB3B, 0xAB1A,
                0x6CA6, 0x7C87, 0x4CE4, 0x5CC5, 0x2C22, 0x3C03, 0x0C60, 0x1C41,
                0xEDAE, 0xFD8F, 0xCDEC, 0xDDCD, 0xAD2A, 0xBD0B, 0x8D68, 0x9D49,
                0x7E97, 0x6EB6, 0x5ED5, 0x4EF4, 0x3E13, 0x2E32, 0x1E51, 0x0E70,
                0xFF9F, 0xEFBE, 0xDFDD, 0xCFFC, 0xBF1B, 0xAF3A, 0x9F59, 0x8F78,
                0x9188, 0x81A9, 0xB1CA, 0xA1EB, 0xD10C, 0xC12D, 0xF14E, 0xE16F,
                0x1080, 0x00A1, 0x30C2, 0x20E3, 0x5004, 0x4025, 0x7046, 0x6067,
                0x83B9, 0x9398, 0xA3FB, 0xB3DA, 0xC33D, 0xD31C, 0xE37F, 0xF35E,
                0x02B1, 0x1290, 0x22F3, 0x32D2, 0x4235, 0x5214, 0x6277, 0x7256,
                0xB5EA, 0xA5CB, 0x95A8, 0x8589, 0xF56E, 0xE54F, 0xD52C, 0xC50D,
                0x34E2, 0x24C3, 0x14A0, 0x0481, 0x7466, 0x6447, 0x5424, 0x4405,
                0xA7DB, 0xB7FA, 0x8799, 0x97B8, 0xE75F, 0xF77E, 0xC71D, 0xD73C,
                0x26D3, 0x36F2, 0x0691, 0x16B0, 0x6657, 0x7676, 0x4615, 0x5634,
                0xD94C, 0xC96D, 0xF90E, 0xE92F, 0x99C8, 0x89E9, 0xB98A, 0xA9AB,
                0x5844, 0x4865, 0x7806, 0x6827, 0x18C0, 0x08E1, 0x3882, 0x28A3,
                0xCB7D, 0xDB5C, 0xEB3F, 0xFB1E, 0x8BF9, 0x9BD8, 0xABBB, 0xBB9A,
                0x4A75, 0x5A54, 0x6A37, 0x7A16, 0x0AF1, 0x1AD0, 0x2AB3, 0x3A92,
                0xFD2E, 0xED0F, 0xDD6C, 0xCD4D, 0xBDAA, 0xAD8B, 0x9DE8, 0x8DC9,
                0x7C26, 0x6C07, 0x5C64, 0x4C45, 0x3CA2, 0x2C83, 0x1CE0, 0x0CC1,
                0xEF1F, 0xFF3E, 0xCF5D, 0xDF7C, 0xAF9B, 0xBFBA, 0x8FD9, 0x9FF8,
                0x6E17, 0x7E36, 0x4E55, 0x5E74, 0x2E93, 0x3EB2, 0x0ED1, 0x1EF0 ], 
        24 : [  0x000000, 0x864CFB, 0x8AD50D, 0x0C99F6, 0x93E6E1, 0x15AA1A, 0x1933EC, 0x9F7F17,
                0xA18139, 0x27CDC2, 0x2B5434, 0xAD18CF, 0x3267D8, 0xB42B23, 0xB8B2D5, 0x3EFE2E,
                0xC54E89, 0x430272, 0x4F9B84, 0xC9D77F, 0x56A868, 0xD0E493, 0xDC7D65, 0x5A319E,
                0x64CFB0, 0xE2834B, 0xEE1ABD, 0x685646, 0xF72951, 0x7165AA, 0x7DFC5C, 0xFBB0A7,
                0x0CD1E9, 0x8A9D12, 0x8604E4, 0x00481F, 0x9F3708, 0x197BF3, 0x15E205, 0x93AEFE,
                0xAD50D0, 0x2B1C2B, 0x2785DD, 0xA1C926, 0x3EB631, 0xB8FACA, 0xB4633C, 0x322FC7,
                0xC99F60, 0x4FD39B, 0x434A6D, 0xC50696, 0x5A7981, 0xDC357A, 0xD0AC8C, 0x56E077,
                0x681E59, 0xEE52A2, 0xE2CB54, 0x6487AF, 0xFBF8B8, 0x7DB443, 0x712DB5, 0xF7614E,
                0x19A3D2, 0x9FEF29, 0x9376DF, 0x153A24, 0x8A4533, 0x0C09C8, 0x00903E, 0x86DCC5,
                0xB822EB, 0x3E6E10, 0x32F7E6, 0xB4BB1D, 0x2BC40A, 0xAD88F1, 0xA11107, 0x275DFC,
                0xDCED5B, 0x5AA1A0, 0x563856, 0xD074AD, 0x4F0BBA, 0xC94741, 0xC5DEB7, 0x43924C,
                0x7D6C62, 0xFB2099, 0xF7B96F, 0x71F594, 0xEE8A83, 0x68C678, 0x645F8E, 0xE21375,
                0x15723B, 0x933EC0, 0x9FA736, 0x19EBCD, 0x8694DA, 0x00D821, 0x0C41D7, 0x8A0D2C,
                0xB4F302, 0x32BFF9, 0x3E260F, 0xB86AF4, 0x2715E3, 0xA15918, 0xADC0EE, 0x2B8C15,
                0xD03CB2, 0x567049, 0x5AE9BF, 0xDCA544, 0x43DA53, 0xC596A8, 0xC90F5E, 0x4F43A5,
                0x71BD8B, 0xF7F170, 0xFB6886, 0x7D247D, 0xE25B6A, 0x641791, 0x688E67, 0xEEC29C,
                0x3347A4, 0xB50B5F, 0xB992A9, 0x3FDE52, 0xA0A145, 0x26EDBE, 0x2A7448, 0xAC38B3,
                0x92C69D, 0x148A66, 0x181390, 0x9E5F6B, 0x01207C, 0x876C87, 0x8BF571, 0x0DB98A,
                0xF6092D, 0x7045D6, 0x7CDC20, 0xFA90DB, 0x65EFCC, 0xE3A337, 0xEF3AC1, 0x69763A,
                0x578814, 0xD1C4EF, 0xDD5D19, 0x5B11E2, 0xC46EF5, 0x42220E, 0x4EBBF8, 0xC8F703,
                0x3F964D, 0xB9DAB6, 0xB54340, 0x330FBB, 0xAC70AC, 0x2A3C57, 0x26A5A1, 0xA0E95A,
                0x9E1774, 0x185B8F, 0x14C279, 0x928E82, 0x0DF195, 0x8BBD6E, 0x872498, 0x016863,
                0xFAD8C4, 0x7C943F, 0x700DC9, 0xF64132, 0x693E25, 0xEF72DE, 0xE3EB28, 0x65A7D3,
                0x5B59FD, 0xDD1506, 0xD18CF0, 0x57C00B, 0xC8BF1C, 0x4EF3E7, 0x426A11, 0xC426EA,
                0x2AE476, 0xACA88D, 0xA0317B, 0x267D80, 0xB90297, 0x3F4E6C, 0x33D79A, 0xB59B61,
                0x8B654F, 0x0D29B4, 0x01B042, 0x87FCB9, 0x1883AE, 0x9ECF55, 0x9256A3, 0x141A58,
                0xEFAAFF, 0x69E604, 0x657FF2, 0xE33309, 0x7C4C1E, 0xFA00E5, 0xF69913, 0x70D5E8,
                0x4E2BC6, 0xC8673D, 0xC4FECB, 0x42B230, 0xDDCD27, 0x5B81DC, 0x57182A, 0xD154D1,
                0x26359F, 0xA07964, 0xACE092, 0x2AAC69, 0xB5D37E, 0x339F85, 0x3F0673, 0xB94A88,
                0x87B4A6, 0x01F85D, 0x0D61AB, 0x8B2D50, 0x145247, 0x921EBC, 0x9E874A, 0x18CBB1,
                0xE37B16, 0x6537ED, 0x69AE1B, 0xEFE2E0, 0x709DF7, 0xF6D10C, 0xFA48FA, 0x7C0401,
                0x42FA2F, 0xC4B6D4, 0xC82F22, 0x4E63D9, 0xD11CCE, 0x575035, 0x5BC9C3, 0xDD8538 ], 
        32 : [  0x00000000, 0x04C11DB7, 0x09823B6E, 0x0D4326D9, 0x130476DC, 0x17C56B6B, 0x1A864DB2, 0x1E475005,
                0x2608EDB8, 0x22C9F00F, 0x2F8AD6D6, 0x2B4BCB61, 0x350C9B64, 0x31CD86D3, 0x3C8EA00A, 0x384FBDBD,
                0x4C11DB70, 0x48D0C6C7, 0x4593E01E, 0x4152FDA9, 0x5F15ADAC, 0x5BD4B01B, 0x569796C2, 0x52568B75,
                0x6A1936C8, 0x6ED82B7F, 0x639B0DA6, 0x675A1011, 0x791D4014, 0x7DDC5DA3, 0x709F7B7A, 0x745E66CD,
                0x9823B6E0, 0x9CE2AB57, 0x91A18D8E, 0x95609039, 0x8B27C03C, 0x8FE6DD8B, 0x82A5FB52, 0x8664E6E5,
                0xBE2B5B58, 0xBAEA46EF, 0xB7A96036, 0xB3687D81, 0xAD2F2D84, 0xA9EE3033, 0xA4AD16EA, 0xA06C0B5D,
                0xD4326D90, 0xD0F37027, 0xDDB056FE, 0xD9714B49, 0xC7361B4C, 0xC3F706FB, 0xCEB42022, 0xCA753D95,
                0xF23A8028, 0xF6FB9D9F, 0xFBB8BB46, 0xFF79A6F1, 0xE13EF6F4, 0xE5FFEB43, 0xE8BCCD9A, 0xEC7DD02D,
                0x34867077, 0x30476DC0, 0x3D044B19, 0x39C556AE, 0x278206AB, 0x23431B1C, 0x2E003DC5, 0x2AC12072,
                0x128E9DCF, 0x164F8078, 0x1B0CA6A1, 0x1FCDBB16, 0x018AEB13, 0x054BF6A4, 0x0808D07D, 0x0CC9CDCA,
                0x7897AB07, 0x7C56B6B0, 0x71159069, 0x75D48DDE, 0x6B93DDDB, 0x6F52C06C, 0x6211E6B5, 0x66D0FB02,
                0x5E9F46BF, 0x5A5E5B08, 0x571D7DD1, 0x53DC6066, 0x4D9B3063, 0x495A2DD4, 0x44190B0D, 0x40D816BA,
                0xACA5C697, 0xA864DB20, 0xA527FDF9, 0xA1E6E04E, 0xBFA1B04B, 0xBB60ADFC, 0xB6238B25, 0xB2E29692,
                0x8AAD2B2F, 0x8E6C3698, 0x832F1041, 0x87EE0DF6, 0x99A95DF3, 0x9D684044, 0x902B669D, 0x94EA7B2A,
                0xE0B41DE7, 0xE4750050, 0xE9362689, 0xEDF73B3E, 0xF3B06B3B, 0xF771768C, 0xFA325055, 0xFEF34DE2,
                0xC6BCF05F, 0xC27DEDE8, 0xCF3ECB31, 0xCBFFD686, 0xD5B88683, 0xD1799B34, 0xDC3ABDED, 0xD8FBA05A,
                0x690CE0EE, 0x6DCDFD59, 0x608EDB80, 0x644FC637, 0x7A089632, 0x7EC98B85, 0x738AAD5C, 0x774BB0EB,
                0x4F040D56, 0x4BC510E1, 0x46863638, 0x42472B8F, 0x5C007B8A, 0x58C1663D, 0x558240E4, 0x51435D53,
                0x251D3B9E, 0x21DC2629, 0x2C9F00F0, 0x285E1D47, 0x36194D42, 0x32D850F5, 0x3F9B762C, 0x3B5A6B9B,
                0x0315D626, 0x07D4CB91, 0x0A97ED48, 0x0E56F0FF, 0x1011A0FA, 0x14D0BD4D, 0x19939B94, 0x1D528623,
                0xF12F560E, 0xF5EE4BB9, 0xF8AD6D60, 0xFC6C70D7, 0xE22B20D2, 0xE6EA3D65, 0xEBA91BBC, 0xEF68060B,
                0xD727BBB6, 0xD3E6A601, 0xDEA580D8, 0xDA649D6F, 0xC423CD6A, 0xC0E2D0DD, 0xCDA1F604, 0xC960EBB3,
                0xBD3E8D7E, 0xB9FF90C9, 0xB4BCB610, 0xB07DABA7, 0xAE3AFBA2, 0xAAFBE615, 0xA7B8C0CC, 0xA379DD7B,
                0x9B3660C6, 0x9FF77D71, 0x92B45BA8, 0x9675461F, 0x8832161A, 0x8CF30BAD, 0x81B02D74, 0x857130C3,
                0x5D8A9099, 0x594B8D2E, 0x5408ABF7, 0x50C9B640, 0x4E8EE645, 0x4A4FFBF2, 0x470CDD2B, 0x43CDC09C,
                0x7B827D21, 0x7F436096, 0x7200464F, 0x76C15BF8, 0x68860BFD, 0x6C47164A, 0x61043093, 0x65C52D24,
                0x119B4BE9, 0x155A565E, 0x18197087, 0x1CD86D30, 0x029F3D35, 0x065E2082, 0x0B1D065B, 0x0FDC1BEC,
                0x3793A651, 0x3352BBE6, 0x3E119D3F, 0x3AD08088, 0x2497D08D, 0x2056CD3A, 0x2D15EBE3, 0x29D4F654,
                0xC5A92679, 0xC1683BCE, 0xCC2B1D17, 0xC8EA00A0, 0xD6AD50A5, 0xD26C4D12, 0xDF2F6BCB, 0xDBEE767C,
                0xE3A1CBC1, 0xE760D676, 0xEA23F0AF, 0xEEE2ED18, 0xF0A5BD1D, 0xF464A0AA, 0xF9278673, 0xFDE69BC4,
                0x89B8FD09, 0x8D79E0BE, 0x803AC667, 0x84FBDBD0, 0x9ABC8BD5, 0x9E7D9662, 0x933EB0BB, 0x97FFAD0C,
                0xAFB010B1, 0xAB710D06, 0xA6322BDF, 0xA2F33668, 0xBCB4666D, 0xB8757BDA, 0xB5365D03, 0xB1F740B4 ] };
    let crc4 = 0;
    by = data.charCodeAt(i+1);
    let frameStart = by << 16;
    crc4 = _CrcTables[4][by ^ crc4]
    by = data.charCodeAt(i+2);
    frameStart += by << 8;
    crc4 = _CrcTables[4][by ^ crc4]
    by = data.charCodeAt(i+3);
    frameStart += by;
    crc4 = _CrcTables[4][(by & 0xF0) ^ crc4]
    let lenData     = (frameStart & 0x01FF80) >> 7;           // E1 encrypted
    const e1        = (frameStart & 0x000040) >> 6;           // E1 encrypted
    const crcType   = (frameStart & 0x000030) >> 4;           // MCT2
    const fc4       = (frameStart & 0x00000F) >> 0;           // FC4 header crc 4
    if (crc4 != fc4) return NOTFOUND;
    if (i >= len) return WAIT;              // must match min header message 
    by = data.charCodeAt(i+4);
    const tt1 = ((by & 0x8) >> 3)           // TT1 ttag size 16 / 32 bits
    let lenHead = 8 + (tt1 ? 2 : 0) + (e1 ? 2 : 0);
    if (i + lenHead >= len) return WAIT;    // must have header 
    if (e1) {
        by = data.charCodeAt(i + lenHead - 1); // check auth indicator in payload
        const ai3 = (by & 0x38) >> 3;
        const al3 = (by & 0x07) >> 0;
        if (ai3 > 1) {
            const lutAuthSize = [ 8, 12, 16, 32, 64, 0, 0, 0 ];
            lenData += lutAuthSize[al3]; // size of auth block 
        }
    }
    const lenCrc = crcType + 1;
    let crcBits = lenCrc * 8;
    const crcTable = _CrcTables[crcBits];
    const crcMask = [ 0xFF, 0xFFFF, 0xFFFFFF, 0xFFFFFFFF ];
    let crc = 0;
    let l = i + lenData + lenHead + lenCrc;
    if (l >= len) return WAIT;
    i ++; // skip the 0x73
    while (i < l) {
        by = data.charCodeAt(i++);
        const ix = (by ^ (crc >> (crcBits - 8)));
        crc =  crcTable[ix] ^ (crc << 8);
        crc &= crcMask[crcType];
    }
    if (crc != 0) return NOTFOUND;
    return l;
}

function process(data, type) {
    let message = Message('SPARTN', data, type, true);
    message.spartnType    = (message.data.charCodeAt(1) & 0xF7) >> 1;
	message.spartnSubType = (message.data.charCodeAt(4) & 0xF0) >> 4;
    let msgSpec;
    if (mapType[message.spartnType] !== undefined) {
        message.id = mapType[message.spartnType];
        if (spec[message.id]) msgSpec = spec[message.id]; // try to get the descr just by type
        if (mapSubType[message.spartnType] !== undefined && 
            mapSubType[message.spartnType][message.spartnSubType] !== undefined) {
            message.id += "-" + mapSubType[message.spartnType][message.spartnSubType];
        } else {
            message.id += "-" + message.spartnSubType;
        }
        if (spec[message.id]) msgSpec = spec[message.id];
    } else {
        message.id = message.spartnType + "-" + message.spartnSubType;
    }
    message.name = message.id;
    message.text = message.name;
    if (msgSpec) {
        ///message.spec = msgSpec.spec;
        message.descr = msgSpec.descr;
        if (msgSpec.spec && (message.data.length > 4)) {
            //let payload = message.data.slice(3, -3);
            //message.fields = processDecode(payload, msgSpec.spec);
        }
    }
    return message;
}
    
return { process: process, parse: parse };
})();

    
// AT protocol
// ------------------------------------------------------------------------------------

const ProtocolAT = (function () {

/*
 ATI         => LARA-R211-02B-00
 AT+CGMI     => u-blox
 AT+CGMM     => LARA-R211
 AT+CGMR     => 30.24
 ATI9     => 30.24,A01.01
 AT+CGSN     => 352953080019031
 AT+CCLK? => "04/01/01,01:06:01+04"
 AT+UPSV? => +UPSV: 0
 AT+COPS? =>
 AT+CREG? => +CREG: 2,3
 AT+CLCK="SC",2
 AT+CREG=0 =>
 AT+CSQ     => +CSQ: 16,99
 
 
*/

const spec = {
    // Information text responses and result codes
    'OK':           { suggest:false, descr: 'Command line successfully processed and executed', },
    'BUSY':         { suggest:false, descr: 'Engaged signal detected (the called number is busy)', },
    'RING':         { suggest:false, descr: 'Incoming call signal from the network', }, // URC
    'CONNECT':      { suggest:false, descr: 'Data connection established',              // Intermediate
                      spec: [ { name:'data_rate',               type:'U' }, ] },
    'NO CARRIER':   { suggest:false, descr: 'Connection terminated from the remote part or attempt to establish a connection failed', },
    'NO DIALTONE':  { suggest:false, descr: 'No dialtone detected', },
    'NO ANSWER':    { suggest:false, descr: 'No hang up detected after a fixed network timeout', },
    'ABORTED':      { suggest:false, descr: 'Command line execution aborted ', },
    'ERROR':        { suggest:false, descr: 'General failure', },
    // Error messages
    '+CME':         { suggest:false, descr: 'Error',
                      spec: [ { name:'err_msg',               type:'Q' }, ] },
    '+CMS':         { suggest:false, descr: 'SMS Error',
                      spec: [ { name:'err_msg',               type:'Q' }, ] },
    // various
    'I0':           { descr: 'Ordering code request',
                      spec: [ { name:'type_number',           type:'Q' }, ] },
    'I9':           { descr: 'Modem and application version request',
                      spec: [ { name:'modem_version',         type:'Q' },
                              { name:'applications_version',  type:'Q' }, ] },
     // IPC
    '+CMUX':        { descr: ' Multiplexing mode ',
                      spec: [ { name:'mode',                  type:'U' },
                              { name:'subset',                type:'U' },
                              { name:'port_speed',            type:'U' },
                              { name:'N1',                    type:'U' },
                              { name:'T1',                    type:'U' },
                              { name:'N2',                    type:'U' },
                              { name:'T2',                    type:'U' },
                              { name:'N3',                    type:'U' },
                              { name:'T3',                    type:'U' },
                              { name:'k',                     type:'U' }, ] },
    // General
    '+CGMI':        { descr: 'Manufacturer identification',
                      spec: [ { name:'manufacturer',          type:'Q' }, ] },
    '+GMI':         { descr: 'Manufacturer identification',
                      spec: [ { name:'manufacturer',          type:'Q' }, ] },
    '+CGMM':        { descr: 'Model identification',
                      spec: [ { name:'model',                 type:'Q' }, ] },
    '+GMM':         { descr: 'Model identification',
                      spec: [ { name:'model',                 type:'Q' }, ] },
    '+CGMR':        { descr: 'Firmware version identification',
                      spec: [ { name:'version',               type:'Q' }, ] },
    '+GMR':         { descr: 'Firmware version identification',
                      spec: [ { name:'version',               type:'Q' }, ] },
    '+CGSN':        { descr: 'IMEI identification',
                      spec: [ { name:'sn',                    type:'Q' }, ] },
    '+GSN':         { descr: 'IMEI identification',
                      spec: [ { name:'sn',                    type:'Q' }, ] },
    '+CFUN':        { descr: 'Set Module functionality',
                      spec: [ { name:'fun',                   type:'U' },
                              { name:'rst',                   type:'U' }, ] },
    '+CFUN?':       { descr: 'Read Module functionality',
                      spec: [ { name:'power_mode',            type:'U' },
                              { name:'STK_mode',              type:'U' }, ] },
    '+CMEE':        { descr: 'Report mobile termination error',
                      spec: [ { name:'n',                     type:'U' }, ] }, // 0: none, 1: numeric, 2 verbose
    '+CLCK':        { descr: 'Facility lock',
                      spec: [ { name:'fac',                   type:'Q' },
                              { name:'mode',                  type:'U' },
                              { name:'passwd',                type:'Q' },
                              { name:'class',                 type:'U' }, ] },
    '+CLCK:':       { suggest:false, descr: 'Facility lock',
                      spec: [ { name:'status',                type:'U' },
                              { name:'class',                 type:'U' }, ] },
    '+CPIN':        { descr: 'Enter PIN',
                      spec: [ { name:'pin',                   type:'Q' },
                              { name:'newpin',                type:'Q' }, ] },
    '+CCLK':        { descr: 'Clock',
                      spec: [ { name:'time',                  type:'Q' }, ] },
    '+COPS':        { descr: 'Operator selection',            },
    '+CREG':        { descr: 'Network registration status',
                      spec: [ { name:'n',                     type:'U' }, ] },
    '+CREG:':       { suggest:false, descr: 'Network registration status',
                      spec: [ { name:'n',                     type:'U' }, // only for AT+CREG? not URC
                              { name:'stat',                  type:'U' },
                              { name:'lac',                   type:'Q' },
                              { name:'ci',                    type:'Q' },
                              { name:'AcTStatus',             type:'U' }, ] },
    '+CSQ':         { descr: 'Signal Quality',
                      spec: [ { name:'rssi',                  type:'U' },
                              { name:'ber',                   type:'U' }, ] },
    '+CCID':        { descr: 'Card identification',
                      spec: [ { name:'iccid',                 type:'Q' }, ] },
    '+CIMI':        { descr: 'International mobile subscriber identification',
                      spec: [ { name:'imsi',                  type:'Q' }, ] },
    '+UPSV':        { descr: 'Power saving control',
                      spec: [ { name:'mode',                  type:'U' },
                              { name:'timeout',               type:'U' }, ] },
    '+CPWROFF':     { descr: 'Module switch off', },
    '+UMLA':        { descr: 'Local address',
                      spec: [ { name:'interface_id',          type:'U' },
                              { name:'address',               type:'Q' }, ] },
	'+UMLA:':       { suggest:false, descr: 'Local address',
                      spec: [ { name:'address',               type:'Q' }, ] },
	'+UMSTAT':      { descr: ' System status',
                      spec: [ { name:'status_id',             type:'U' }, ] },
	'+UMSTAT:':     { suggest:false, descr: ' System status',
                      spec: [ { name:'status_id',             type:'U' },
							  { name:'status_val',            type:'U' }, ] },
	// wifi commands
    '+UWSCAN':      { descr: 'Wifi Scan',
                      spec: [ { name:'ssid',                  type:'Q' }, ] },
    '+UWSCAN:':     { suggest:false, descr: 'Wifi Scan',
                      spec: [ { name:'bssid',                 type:'Q' },
                              { name:'op_mode',               type:'U' },
                              { name:'ssid',                  type:'Q' },
                              { name:'channel',               type:'U' },
                              { name:'rssi',                  type:'I' },
                              { name:'authentication_suites', type:'U' },
                              { name:'unicast_ciphers',       type:'U' },
                              { name:'group_ciphers',         type:'U' }, ] },
    // bluetooth commands
    '+UBTD':        { descr: 'Bluetooth Discovery (Low Energy)',
                      spec: [ { name:'discovery_type',        type:'U' },
                              { name:'mode',                  type:'U' },
                              { name:'discovery_length',      type:'U' }, ] },
    '+UBTD:':       { suggest:false, descr: 'Bluetooth Discovery (Low Energy)',
                      spec: [ { name:'bd_addr',               type:'Q' },
                              { name:'rssi',                  type:'I' },
                              { name:'device_name',           type:'Q' },
                              { name:'data_type',             type:'U' },
                              { name:'data',                  type:'*' }, ] },
    // file system commands
    '+ULSTFILE':    { descr: 'File system information',
                      spec: [ { name:'request',               type:'U' }, ] },
    '+ULSTFILE:':   { suggest:false, descr: 'File system information',
                      spec: [ { name:'information',           type:'Q' }, ] },
    '+URDFILE':     { descr: 'Read file',
                      spec: [ { name:'request',               type:'Q' },
                              { name:'filename',              type:'Q' },
                              { name:'size',                  type:'U' },
                              { name:'data',                  type:'*' }, ] },
    '+UDELFILE':    { descr: 'Delete file',
                      spec: [ { name:'filename',              type:'Q' }, ] },
    '+UDWNFILE':    { descr: 'Write file',
                      spec: [ { name:'filename',              type:'Q' },
                              { name:'size',                  type:'U' },
                              { name:'data',                  type:'*' }, ] },
};

function parse(data, i) {
//    [AT.*\r]      \\ echo / command
//    [\r\n.*]\r\n  \\ intermediate
//    [\r\n.*\r\n]  \\ final response
    const len = data.length;
    const ofs = i;
    let format;
    let by;
    if (i >= len) return WAIT;
    by = data.charCodeAt(i++);
    if (65 === by || 97 === by) { // A,a
        if (i >= len) return WAIT;
        by = data.charCodeAt(i++);
        if (84 !== by && 116 !== by) return NOTFOUND; // T,t
        by = data.charCodeAt(i++);
        format = 0;
    } else if (13 === by) { // \r
        if (i >= len) return WAIT;
        by = data.charCodeAt(i++);
        if (10 !== by) return NOTFOUND; // \n
        by = data.charCodeAt(i++);
        format = 1;
        // avoid capturing NMEA
        if (36 === by) { // $
            if (i >= len) return WAIT;
            by = data.charCodeAt(i++);
            if ((71 === by) || (80 === by)) return NOTFOUND; // G, P
        }
    } else return NOTFOUND;
    while ((32 <= by) && (126 >= by)) {
        if (i >= len) return WAIT;
        by = data.charCodeAt(i++);
    }
    if (13 !== by)  return NOTFOUND; // \r
    if (0 === format) return i;
    if (i >= len)   return WAIT;
    by = data.charCodeAt(i++);
    if (10 !== by)  return NOTFOUND; // \n
    // (1 === format)
    const payload = data.slice(ofs+2, i-2);
    const m = payload.match(/^(?:OK|BUSY|RING|CONNECT|NO (?:CARRIER|DIALDONE|ANSWER)|ABORTED|ERROR|\+CM[ES] Error:.*)$/i);
    if (m) return i;
    // check if we need to include trailing cr lr
    if (i >= len) return WAIT;
    by = data.charCodeAt(i++);
    if (13 !== by) return i-3;
    if (i >= len) return WAIT;
    by = data.charCodeAt(i++);
    if (10 !== by) return i-4;
    return i-2;
}

let lastId;
function process(data, type) {
    let message = Message('AT', data, type, false);
    let m;
    let payload;
    if (m = message.data.match(/^AT([\+&]?[A-Z0-9]*)[=?]*\s*(.*)\r$/i)) { // Echo
        message.id = m[1].toUpperCase();
        payload = m[2];
        lastId = message.id;
    } else if (m = message.data.match(/^\r\n(OK|BUSY|RING|CONNECT|NO (?:CARRIER|DIALDONE|ANSWER)|ABORTED|ERROR)\r\n$/i)) { // final result
        message.id = m[1].toUpperCase();
        payload = '';
        lastId = undefined;
    } else if (m = message.data.match(/^\r\n(\+CM[ES])\s*Error:\s*(.*)\r\n$/i)) { // Final result Error
        message.id = m[1].toUpperCase();
        payload = m[2];
        lastId = undefined;
    } else if (m = message.data.match(/^\r\n([\+][A-Z0-9]+:)\s*(.*)(\r\n)?$/i)) { // URCs
        message.id = m[1].toUpperCase();
        payload = m[2];
    } else if (m = message.data.match(/^\r\n(.*)(?:\r\n)?$/i)) {
        message.id = lastId;
        payload = m[1];
    }
    if (message.id !== undefined) {
        message.name = message.id;
        let msgSpec = spec[message.id];
        if (!msgSpec && (m = message.id.match(/^(\+[A-Z0-9]+):$/))) msgSpec = spec[m[1]];
        if (msgSpec) {
            message.descr = msgSpec.descr;
            //message.spec = msgSpec.spec;
            if (msgSpec.spec && (payload !== ''))
                message.fields = processDecode(payload, msgSpec.spec);
        }
    }
    message.text = message.data.replace(/[\r\n]/gm, '');
    return message;
}

function make(data) {
    data = conv(data);
    data = 'AT' + data + '\r';
    return process(data, TYPE_INPUT);
}

return { process: process, parse: parse, make: make, spec:spec };
})();

// Text
// ------------------------------------------------------------------------------------

const ProtocolTEXT = (function () {

function parse(data, i) {
    const len = data.length;
	if (i >= len) return WAIT;
    let by = data.charCodeAt(i++);
    while ((32 <= by) && (126 >= by)) {
        if (i >= len) return WAIT;
        by = data.charCodeAt(i++);
    }
    if (10 === by) return i; 		// \n
    if (13 !== by) return NOTFOUND; // \r
    if (i >= len) return i;
    by = data.charCodeAt(i);
    return (by === 10) ? i + 1 : i; // \n
}

function process(data, type) {
    let message = Message('TEXT', data, type, false);
    message.text = message.data.replace(/[\r\n]/gm, '');
    return message;
}

function make(data) {
    data = conv(data);
    data += '\r';
    return process(data, TYPE_INPUT);
}

return { process: process, parse: parse, make: make, };
})();

// UNKNOWN / DEBUG / TRACE
// ------------------------------------------------------------------------------------

const ProtocolUNKNOWN = (function () {

function process(data, type) {
    let message = Message('UNKNOWN', data, type, true);
    message.text = data.replace(/[\x00-\x1F\x7F-\xA0]+/gm, '\u2026'); // … ellipsis
    return message;
}

return { process: process, };
})();

// More Helpers
// ------------------------------------------------------------------------------------

function conv(data) {
    if (typeof data === 'string') {
        return data;
    } else if (data instanceof Array) {
        let str = '';
        for (let i = 0; i <  data.length; i ++) {
            if (data[i] < 0 || data[i] > 255) throw new Error('Array "data" does not contain Bytes.');
            str += String.fromCharCode(data[i]);
        }
        return str;
    } else if (data instanceof ArrayBuffer) {
        let str = '';
        const view = new DataView(data);
        for (let i = 0; i <  view.byteLength; i ++) {
            str += String.fromCharCode(view.getUint8(i));
        }
        return str;
    } else if (data === undefined || !data) {
        return '';
    } else {
        throw new Error('Parameter "data" is not of type Array or String.');
    }
}

function makeFromText(data) {
    let message;
    let m;
    if (m = data.match(/^\$[A-Z]{4,}\d*/i)) {
        let end = data.match(/\*[0-9A-F]{2}$/); // strip crc and cr/lf
        end = end ? -end[0].length : undefined;
        data = data.slice(1, end);
        message = ProtocolNMEA.make(data);
    } else if (m = data.match(/^UBX(?:\s+|-)([A-Z]{2,}|\d+)(?:\s+|-)([A-Z]{2,}|\d+)\s*/i)) {
        data = data.slice(m[0].length);
        if (data.length) {
            let obj;
            try {
                data = data.replace(/([,{]\s*)(\w+)(\s*:)/mg, "$1\"$2\"$3"); // make sure field names are quoted
				obj = JSON.parse(data);
            } catch (e) { obj = data; }
            if (obj !== undefined) data = obj;
        }
        message = ProtocolUBX.make(m[1], m[2], data);
    } else if (m = data.match(/^AT/i)) {
        data = data.slice(2);
        message = ProtocolAT.make(data);
    } else {
        message = ProtocolTEXT.make(data);
    }
    return message;
}

function makeSuggestions() {
	let arr = []; 
	_suggestions('AT',   ProtocolAT.spec,   atHint); 
	_suggestions('$',    ProtocolNMEA.spec, nmeaHint); 
	_suggestions('UBX ', ProtocolUBX.spec,  ubxHint); 
	//_suggestions('$',   ProtocolNMEA.spec); 
	return arr;
	
	function _suggestions(txt, spec, hint) {
		let keys = Object.keys(spec);
		keys.forEach( function _addAt(key) {
			if (false === spec[key].suggest) {
				/* skip */
			} else {
				const payload = spec[key].spec ? hint(spec[key].spec) : undefined;
				arr.push( { data:txt+key, descr:spec[key].descr, payload:payload } );
				
				
			}
		} );
	}
	
	function ubxHint(spec) {
		let payload = _payloadHint(spec);
		return ' ' + JSON.stringify(payload);

		// helper for recursion
		function _payloadHint(spec) {
			if (spec.type !== undefined) {
				return spec.type;
			} else if (spec.spec)  {
				let elems = [];
				const repeat = 1; //_repeat(spec.repeat, fields);
				for (let r = 0; (repeat===undefined) || (r < repeat); r ++ ) {
					const elem = _payloadHint(spec.spec, elems);
					if (elem !== undefined) elems.push(elem);
				}
				return elems;
			} else {
				let elems = {};
				for (let s = 0; s < spec.length; s ++ ) {
					const elem = _payloadHint(spec[s], elems);
					if ((elem !== undefined) && spec[s].name) elems[spec[s].name] = elem;
				}
				return elems;
			}
		}
	}
	function atHint(spec, pre) {
		return txtHint(spec, '=');
	}
	function nmeaHint(spec, pre) {
		return txtHint(spec, ',');
	}
	function txtHint(spec, pre) {
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
}

function make(data) {
    data = conv(data);
    // parse them into separate messages
    let ret = parseProtocols(data, TYPE_INPUT);
	let messages = ret[0];
	let done = ret[1];
    // remainder as unknown
    if (done !== data.length) {
        let message = ProtocolUNKNOWN.process( data.slice(done), TYPE_INPUT);
        messages.push( message );
    }
    return messages;
}

// PARSER
// ------------------------------------------------------------------------------------

const protocols = [ ProtocolUBX, ProtocolNMEA, ProtocolRTCM3, protocolSPARTN, ProtocolAT, ProtocolTEXT, /*UNKNOWN, DEBUG, TRACE */ ];
function parseProtocols(buffer, type) {
    let messages = [];
    let ofs = 0;
    let done = 0;
    while (ofs < buffer.length) {
        let prot = 0;
        while (prot < protocols.length) {
            let end = protocols[prot].parse(buffer, ofs);
            if (WAIT === end) {
                // exit loops
                ofs = buffer.length;
                prot = protocols.length;
            } else if ((NOTFOUND !== end) && (end > ofs)) {
                if (ofs > done)
                    messages.push( ProtocolUNKNOWN.process(buffer.slice(done,ofs), type) );
                messages.push( protocols[prot].process(buffer.slice(ofs,end), type) );
                done = ofs = end;
                prot = 0;
            } else {
                prot ++; // next protocol
                if (prot === protocols.length)
                    ofs ++; // skip a byte
            }
        }
    }
    return [ messages, done ];
}
    
let   parseBuffer = '';
function append(data) {
    parseBuffer += data;
}

function parse() {
    let ret = parseProtocols(parseBuffer, TYPE_OUTPUT);
	let messages = ret[0];
	let done = ret[1];
    // rcompact the buffer
    if (done > 0) parseBuffer = parseBuffer.slice(done);
    // remainder as unknown (but mark temporary pending)
    if (parseBuffer.length) {
        const message = ProtocolUNKNOWN.process( parseBuffer, TYPE_PENDING);
        messages.push( message );
    }
    return messages;
}

function pending() {
    if (parseBuffer === '') return undefined;
    const message = ProtocolUNKNOWN.process( parseBuffer, TYPE_OUTPUT);
    parseBuffer = '';
    return message;
}

function reset() {
    parseBuffer = '';
}

function time(time) {
    if (!time) time = new Date();
    return _pad(time.getHours(),2) + ':' + _pad(time.getMinutes(),2) + ':' +
           _pad(time.getSeconds(),2) + '.' + _pad(time.getMilliseconds(),3);
}

// ------------------------------------------------------------------------------------
/* END OF MODULE */ return {
    parseAppend:   append,
    parseMessages: parse,
    parsePending:  pending,
    parseReset:    reset,
    parseTime:     time,
    makeUbx:       ProtocolUBX.make,
    makeNmea:      ProtocolNMEA.make,
    makeAt:        ProtocolAT.make,
    makeText:      ProtocolTEXT.make,
	make:     	   make,
    makeFromText:  makeFromText,
	makeSuggestions: makeSuggestions, 
	
    Message:        Message,
    messageLine:    messageLine,
	messageTable:   messageTable,
    messageLogFile: messageLogFile,
};
})();
// ------------------------------------------------------------------------------------
