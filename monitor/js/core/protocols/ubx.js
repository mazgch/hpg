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

import { hex }      from '../utils.js';
import { Message }  from '../message.js';
import { Protocol } from './protocol.js';

export class ProtocolUbx extends Protocol {

    parse(data, i) {
        const len = data.length; 
        if (i >= len) return Protocol.WAIT;
        let by = data.charCodeAt(i++);
        if (181 !== by) return Protocol.NOTFOUND; // = µ, 0xB5
        if (i >= len) return Protocol.WAIT;
        by = data.charCodeAt(i++);
        if (98 !== by) return Protocol.NOTFOUND; // = b
        if (i+3 >= len) return Protocol.WAIT;
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
        if (l >= len) return Protocol.WAIT;
        while (l --) {
            by = data.charCodeAt(i++);
            cka += by; ckb += cka;
        }
        cka = cka & 0xFF;
        ckb = ckb & 0xFF;
        if (i >= len) return Protocol.WAIT;
        by = data.charCodeAt(i++);
        if (by !== cka) return Protocol.NOTFOUND;
        if (i >= len) return Protocol.WAIT;
        by = data.charCodeAt(i++);
        if (by !== ckb) return Protocol.NOTFOUND;
        return i;
    }

    process(data, type) {
        let message = new Message('UBX', data, type, true);
        let arr = ubxClsMsgId(message.data.charCodeAt(2), message.data.charCodeAt(3));
        message.id = arr[0];
        message.ubxCls = arr[1];
        message.ubxMsg = arr[2];
        message.name = message.id;
        message.text = message.name;
        const msgSpec = ProtocolUbx.spec[message.id];
        if (msgSpec) {
            message.descr = msgSpec.descr;
            //message.spec = msgSpec.spec;
            if (msgSpec.spec && (message.data.length > 8)) {
                const payload = message.data.slice(6,-2);
                message.fields = Protocol.decode(payload, msgSpec.spec);
                if (message.ubxCls === 0x04 && message.fields.infTxt)
                    message.text += ' ' + message.fields.infTxt;
            }
        }
        return message;
    }

    fromText(data) {
        let m;
        if (m = data.match(/^UBX(?:\s+|-)([A-Z]{2,}|\d+)(?:\s+|-)([A-Z]{2,}|\d+)\s*/i)) {
            data = data.slice(m[0].length);
            if (data.length) {
                let obj;
                try {
                    data = data.replace(/([,{]\s*)(\w+)(\s*:)/mg, "$1\"$2\"$3"); // make sure field names are quoted
                    obj = JSON.parse(data);
                } catch (e) { obj = data; }
                if (obj !== undefined) data = obj;
            }
            return this.make(m[1], m[2], data);
        }
    } 

    make(cls,id,data) {
        let msgId;
        let arr = ubxClsMsgId(cls, id);
        msgId = arr[0];
        cls = arr[1];
        id = arr[2];
        // with the spec try to encode the message
        if (data && (data instanceof Object) && !(data instanceof Array) && !(data instanceof ArrayBuffer)) {
            let msgSpec = this.spec[msgId];
            if (msgSpec && msgSpec.spec) {
                data = Protocol.encode(data, msgSpec.spec);
            } else {
                throw new Error('Now specification for message ' + msgId);
            }
        } else {
            data = conv(data);
        }
        // assemble and calc the crc
        data =  String.fromCharCode(cls) +
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
        return this.process(data, Message.TYPE_INPUT);
    }

    hint(spec) {
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
    
    // valid types:
    // CH: Char, S:String, Sxx:Sting with max length xx, *: Anything,
    // I1,I2,I4:Signed Integer, U1,U2,U4:Unsigned Integer, 
    // U1,U2,U4:Hex Value, R4,R8:Real/Float,
    // [xx]: Array, add optional size xx

    static spec = {
    // NAV ------------
        'NAV-DOP': { 
            descr:  'Dilution of precision',
            spec:[  { name:'itow',                  type:'U4', scale:1e-3, unit:'s'     },
                    { name:'gDop',                  type:'U2', scale:1e-2,              },
                    { name:'pDop',                  type:'U2', scale:1e-2,              },
                    { name:'tDop',                  type:'U2', scale:1e-2,              },
                    { name:'vDop',                  type:'U2', scale:1e-2,              },
                    { name:'hDop',                  type:'U2', scale:1e-2,              },
                    { name:'nDop',                  type:'U2', scale:1e-2,              },
                    { name:'eDop',                  type:'U2', scale:1e-2,              }, ] },
        'NAV-HPPOSLLH': {   
            descr:  'High Precision Geodetic Position Solution',    
            spec:[  { name:'version',               type:'U1'                           },
                    {                               type:'U1[3]'                        },
                    { name:'itow',                  type:'U4', scale:1e-3, unit:'s'     },
                    { name:'lng',                   type:'I4', scale:1e-7, unit:'deg'   },
                    { name:'lat',                   type:'I4', scale:1e-7, unit:'deg'   },
                    { name:'height',                type:'I4', scale:1e-3, unit:'m'     },
                    { name:'msl',                   type:'I4', scale:1e-3, unit:'m'     },
                    { name:'lonHp',                 type:'I1', scale:1e-9, unit:'deg'   },
                    { name:'latHP',                 type:'I1', scale:1e-9, unit:'deg'   }, ] },
        'NAV-POSECEF': {    
            descr:  'Position Solution in ECEF',    
            spec:[  { name:'itow',                  type:'U4', scale:1e-3, unit:'s'     },
                    { name:'ecefX',                 type:'I4', scale:1e-2, unit:'m'     },
                    { name:'ecefY',                 type:'I4', scale:1e-2, unit:'m'     },
                    { name:'ecefZ',                 type:'I4', scale:1e-2, unit:'m'     },
                    { name:'pAcc',                  type:'U4', scale:1e-2, unit:'m'     }, ] },
        'NAV-POSLLH': {     
            descr:  'Geodetic Position Solution',   
            spec:[  { name:'itow',                  type:'U4', scale:1e-3, unit:'s'     },
                    { name:'lng',                   type:'I4', scale:1e-7, unit:'deg'   },
                    { name:'lat',                   type:'I4', scale:1e-7, unit:'deg'   },
                    { name:'height',                type:'I4', scale:1e-3, unit:'m'     },
                    { name:'msl',                   type:'I4', scale:1e-3, unit:'m'     },
                    { name:'hAcc',                  type:'U4', scale:1e-3, unit:'m'     },
                    { name:'vAcc',                  type:'U4', scale:1e-3, unit:'m'     }, ] },
        'NAV-PL': { 
            descr: 'Protection Level',
            spec:[  { name:'version',               type:'U1',                          },
                    { name:'tmirCoeff',             type:'U1',                          },
                    { name:'tmirExp',               type:'U1',                          },
                    { name:'plPosValid',            type:'U1',                          },
                    { name:'plPosFrame',            type:'U1',                          },
                    { name:'plVelValid',            type:'U1',                          },
                    { name:'plVelFrame',            type:'U1',                          },
                    { name:'plTimeValid',           type:'U1',                          },
                    {                               type:'U1[4]'                        },
                    { name:'itow',                  type:'U4', scale:1e-3, unit:'s'     },
                    { name:'plPos1',                type:'U4', scale:1e-3, unit:'m'     },
                    { name:'plPos2',                type:'U4', scale:1e-3, unit:'m'     },
                    { name:'plPos3',                type:'U4', scale:1e-3, unit:'m'     },
                    { name:'plVel1',                type:'U4', scale:1e-3, unit:'m/s'   },
                    { name:'plVel2',                type:'U4', scale:1e-3, unit:'m/s'   },
                    { name:'plVel3',                type:'U4', scale:1e-3, unit:'m/s'   },
                    { name:'plPosHorOr',            type:'U2', scale:1e-2, unit:'deg'   },
                    { name:'plVelHorOr',            type:'U2', scale:1e-2, unit:'deg'   },
                    { name:'plTime',                type:'U4',                          }, ] },
        'NAV-PVT': { 
            descr:  'Navigation Position Velocity Time Solution',
            spec:[  { name:'itow',                  type:'U4', scale:1e-3, unit:'s'     },
                    { name:'year',                  type:'U2',             unit:'y'     },
                    { name:'month',                 type:'U1',             unit:'month' },
                    { name:'day',                   type:'U1',             unit:'d'     },
                    { name:'hour',                  type:'U1',             unit:'h'     },
                    { name:'min',                   type:'U1',             unit:'min'   },
                    { name:'sec',                   type:'U1',             unit:'s'     },
                    { name:'valid',                 spec: [
                        { name:'validDate',         type:'x1'                           },
                        { name:'validTime',         type:'x1'                           },
                        { name:'fullyResolved',     type:'x1'                           },
                        {                           type:'x5'                           } ] },
                    { name:'tAcc',                  type:'U4',             unit:'ns'    },
                    { name:'nano',                  type:'I4',             unit:'ns'    },
                    { name:'fixType',               type:'U1',                          },
                    { name:'flags',                 spec: [
                        { name:'fixOk',             type:'x1'                           },
                        { name:'diffSol',           type:'x1'                           },
                        { name:'psmState',          type:'x3'                           },
                        { name:'headVehVal',        type:'x1'                           },
                        { name:'carrSol',           type:'x2'                           } ] },
                    { name:'flags2',                spec: [
                        {                           type:'x5'                           },
                        { name:'confirmedAvai',     type:'x1'                           },
                        { name:'confirmedDate',     type:'x1'                           },
                        { name:'confirmedTime',     type:'x1'                           } ] },
                    { name:'numSV',                 type:'U1',                          },
                    { name:'lng',                   type:'I4', scale:1e-7, unit:'deg'   },
                    { name:'lat',                   type:'I4', scale:1e-7, unit:'deg'   },
                    { name:'height',                type:'I4', scale:1e-3, unit:'m'     },
                    { name:'msl',                   type:'I4', scale:1e-3, unit:'m'     },
                    { name:'hAcc',                  type:'U4', scale:1e-3, unit:'m'     },
                    { name:'vAcc',                  type:'U4', scale:1e-3, unit:'m'     },
                    { name:'velN',                  type:'I4', scale:1e-3, unit:'m/s'   },
                    { name:'velE',                  type:'I4', scale:1e-3, unit:'m/s'   },
                    { name:'velD',                  type:'I4', scale:1e-3, unit:'m/s'   },
                    { name:'gSpeed',                type:'U4', scale:1e-3, unit:'m/s'   },
                    { name:'headMot',               type:'I4', scale:1e-5, unit:'deg'   },
                    { name:'sAcc',                  type:'U4', scale:1e-3, unit:'m/s'   },
                    { name:'cAcc',                  type:'U4', scale:1e-5, unit:'deg'   },
                    { name:'pDop',                  type:'U2', scale:1e-2,              },
                    {                               type:'U1[6]'                        },
                    { name:'headVeh',               type:'I4', scale:1e-5, unit:'deg'   },
                    {                               type:'U1[4]'                        } ] },
        'NAV-STATUS': { 
            descr:  'Receiver Navigation Status',
            spec:[  { name:'itow',                  type:'U4', scale:1e-3, unit:'s'     },
                    { name:'fixType',               type:'U1',                          }, // 0:no fix, 1:dead reckoning only, 2:2D-fix, 3:3D-fix, 4:GPS + dead reckoning combined, 5:Time only fix
                    { name:'flags',                 spec: [
                        { name:'fixOk',             type:'x1'                           },
                        { name:'diffSol',           type:'x1'                           },
                        { name:'wknSet',            type:'x1'                           },
                        { name:'towSet',            type:'x1'                           },
                        {                           type:'x4'                           } ] },
                    { name:'fixStat',               spec: [
                        { name:'dgpsIStat',         type:'x1'                           },
                        {                           type:'x5'                           },
                        { name:'mapMatching',       type:'x2'                           } ] },
                    { name:'flags2',                spec: [
                        { name:'psmState',          type:'x2'                           },
                        { name:'spoofDetState',     type:'x2'                           },
                        {                           type:'x4'                           } ] },
                    { name:'ttff',                  type:'U4', scale:1e-3, unit:'s'     },
                    { name:'msss',                  type:'U4', scale:1e-3, unit:'s'     } ] },
         'NAV-ODO': { 
            descr:  'Odometer solution',
            spec:[  { name:'version',               type:'U1',                          },
                    {                               type:'U1[3]',                       },
                    { name:'itow',                  type:'U4', scale:1e-3, unit:'s'     },
                    { name:'distance',              type:'U4',             unit:'m'     },
                    { name:'totalDistance',         type:'U4',             unit:'m'     },
                    { name:'distanceStd',           type:'U4',             unit:'m'     } ] },
        'NAV-VELECEF': {
            descr:  'Velocity Solution in ECEF',
            spec:[  { name:'itow',                  type:'U4', scale:1e-3, unit:'s'     },
                    { name:'ecefVX',                type:'I4', scale:1e-2, unit:'m/s'   },
                    { name:'ecefVY',                type:'I4', scale:1e-2, unit:'m/s'   },
                    { name:'ecefVZ',                type:'I4', scale:1e-2, unit:'m/s'   },
                    { name:'sAcc',                  type:'U4', scale:1e-2, unit:'m/s'   } ] },
        'NAV-VELNED': { 
            descr:  'Velocity Solution in NED',
            spec:[  { name:'itow',                  type:'U4', scale:1e-3, unit:'s'     },
                    { name:'velN',                  type:'I4', scale:1e-2, unit:'m/s'   },
                    { name:'velE',                  type:'I4', scale:1e-2, unit:'m/s'   },
                    { name:'velD',                  type:'I4', scale:1e-2, unit:'m/s'   },
                    { name:'speed',                 type:'U4', scale:1e-2, unit:'m/s'   },
                    { name:'gSpeed',                type:'U4', scale:1e-2, unit:'m/s'   },
                    { name:'headMot',               type:'I4', scale:1e-5, unit:'deg'   },
                    { name:'sAcc',                  type:'U4', scale:1e-2, unit:'m/s'   },
                    { name:'cAcc',                  type:'U4', scale:1e-5, unit:'deg'   } ] },
        'NAV-SAT': { 
            descr:  'Satellite Information',
            spec:[  { name:'itow',                  type:'U4', scale:1e-3, unit:'s'     },
                    { name:'version',               type:'U1'                           },
                    { name:'numSvs',                type:'U1'                           },
                    {                               type:'U1[2]'                        },
                    { name:'svs', repeat:'numSvs',  spec: [ 
                        { name:'gnssId',            type:'U1'                           },
                        { name:'svId',              type:'U1'                           }, // U:Used, e:Ephemeris but not used, -:Not used
                        { name:'cno',               type:'U1',             unit:'dBHz'  },
                        { name:'elev',              type:'I1',             unit:'deg'   },
                        { name:'azim',              type:'I2',             unit:'deg'   },
                        { name:'prRes',             type:'I2', scale:0.1,  unit:'m'     },
                        { name:'flags',             spec: [
                            { name:'qualityInd',    type:'x3'                           },
                            { name:'svUsed',        type:'x1'                           },
                            { name:'healthy',       type:'x2'                           },
                            { name:'diffCorr',      type:'x1'                           },
                            { name:'smoothed',      type:'x1'                           },
                            { name:'orbitSource',   type:'x3'                           },
                            { name:'ephAvail',      type:'x1'                           },
                            { name:'almAvail',      type:'x1'                           },
                            { name:'anoAvail',      type:'x1'                           },
                            { name:'aopAvail',      type:'x1'                           },
                            {                       type:'x1'                           },
                            { name:'sbasCorrUsed',  type:'x1'                           },
                            { name:'rtcmCorrUsed',  type:'x1'                           },
                            { name:'slasCorrUsed',  type:'x1'                           },
                            { name:'spartnCorrUsed',type:'x1'                           },
                            { name:'prCorrUsed',    type:'x1'                           },
                            { name:'crCorrUsed',    type:'x1'                           },
                            { name:'doCorrUsed',    type:'x1'                           },
                            { name:'clasCorrUsed',  type:'x1'                           },
                            {                       type:'x8'                           } ] } ] } ] },
        'NAV-SIG': {
            descr: 'Signal information',
            spec:[  { name:'itow',                  type:'U4', scale:1e-3, unit:'s'     },
                    { name:'version',               type:'U1'                           },
                    { name:'numSigs',               type:'U1'                           },
                    {                               type:'U1[2]'                        },
                    { name:'sigs', repeat:'numSigs',  spec: [ 
                        { name:'gnssId',            type:'U1'                           },
                        { name:'svId',              type:'U1'                           }, 
                        { name:'sigId',             type:'U1'                           },
                        { name:'freqId',            type:'U1'                           },
                        { name:'prRes',             type:'I2', scale:0.1,  unit:'m'     },
                        { name:'cno',               type:'U1',             unit:'dBHz'  },
                        { name:'qualityInd',        type:'U1'                           },
                        { name:'corrSource',        type:'U1'                           },
                        { name:'ionoModel',         type:'U1'                           },
                        { name:'sigFlags',         spec: [
                            { name:'healthy',       type:'x2'                           },
                            { name:'prSmoothed',    type:'x1'                           },
                            { name:'prUsed',        type:'x1'                           },
                            { name:'crUsed',        type:'x1'                           },
                            { name:'doUsed',        type:'x1'                           },
                            { name:'prCorrUsed',    type:'x1'                           },
                            { name:'crCorrUsed',    type:'x1'                           },
                            { name:'doCorrUsed',    type:'x1'                           },
                            {                       type:'x7'                           } ] },
                        {                           type:'U1[4]'                        } ] } ] },
    // RXM ------------
        'RXM-COR': { 
            descr:  'Differential correction input status',
            spec:[  { name:'ver',                   type:'U1',                          },
                    { name:'ebn0',                  type:'U1', scale:0.125, unit:'dB'   },
                    {                               type:'U1[2]'                        },
                    { name:'statusInfo',            type:'X4',                          },
                    { name:'msgType',               type:'U2',                          },
                    { name:'msgSubType',            type:'U2',                          } ] },
        'RXM-PMP': {    
            descr: 'PMP point to multipoint',    
            spec:[  { name:'ver',                   type:'U1',                          },
                    { /*name:'res0',*/              type:'U1',                          },
                    { name:'numUserBytes',          type:'U2',                          },
                    { name:'timeTag',               type:'U4'                           },
                    { name:'uniqueWord',            type:'U4[2]',                       },
                    { name:'serviceId',             type:'U2',                          },
                    { /*name:'spare',*/             type:'U1',                          },
                    { name:'bitErrors',             type:'U1',                          },
                    { name:'fecBits',               type:'U2',                          },
                    { name:'ebn0',                  type:'U1', scale:0.125, unit:'dB'   },
                    { /*name:'rese1',*/             type:'U1',                          },
                    { name:'userData',              type:'U1[504]',                     } ] },
        'RXM-QZSSL6': { 
            descr:  'QZSS L6 message',
            spec:[  { name:'ver',                   type:'U1',                          },
                    { name:'svId',                  type:'U1',                          },
                    { name:'cno',                   type:'U2',scale:0.00390625,unit:'dB'},
                    { name:'timeTag',               type:'U4'                           },
                    { name:'groupDelay',            type:'U1',                          },
                    { name:'bitErrCorr',            type:'U1',                          },
                    { name:'chInfo',                type:'U2',                          },
                    { /*name:'res0',*/              type:'U1[2]'                        },
                    { name:'msgBytes',              type:'U1[250]',                     } ] },
        // INF ------------
        'INF-ERROR': { 
            descr:  'ASCII output with error contents',
            spec:[  { name:'infTxt',                type:'S*'                           } ] },
        'INF-WARNING': { 
            descr:  'ASCII output with warning contents',
            spec:[  { name:'infTxt',                type:'S*'                           } ] },
        'INF-NOTICE': { 
            descr:  'ASCII output with informational contents',
            spec:[  { name:'infTxt',                type:'S*'                           } ] },
        'INF-TEST': { 
            descr:  'ASCII output with test contents',
            spec:[  { name:'infTxt',                type:'S*'                           } ] },
        'INF-DEBUG': { 
            descr:'ASCII output with debug contents',
            spec:[  { name:'infTxt',                type:'S*'                           } ] },
    // ACK ------------
        'ACK-NAK': { 
            descr:  'Message Not-Acknowledged',
            spec:[  { name:'clsID',                 type:'U1'                           },
                    { name:'msgID',                 type:'U1'                           } ] },
        'ACK-ACK': { 
            descr:  'Message Acknowledged',
            spec:[  { name:'clsID',                 type:'U1'                           },
                    { name:'msgID',                 type:'U1'                           } ] },
    // CFG ------------
        'CFG-PRT': { 
            descr:  'Port Configuration',
            spec:[  { name:'portID',                type:'U1'                           }, // 0:DDC/I2C/UART0 1:UART1 2:UART2 3:USB 4:SPI
                    {                               type:'X1'                           },
                    { name:'txReady',               type:'X2'                           },
                    { name:'mode',                  type:'X4'                           }, // 8N1:0x000008D0 SPI:0x00000100
                    { name:'baudRate',              type:'U4'                           },
                    { name:'inProtoMask',           type:'X2'                           }, // bit0:UBX bit1:NMEA bit2:RTCM, bit5:RTCM3
                    { name:'outProtoMask',          type:'X2'                           },
                    { name:'flags',                 type:'X4'                           } ] },
        'CFG-MSG': { 
            descr:  'Set Message Rate',
            spec:[  { name:'clsID',                 type:'U1'                           },
                    { name:'msgID',                 type:'U1'                           },
                    { name:'rate',                  type:'U1[]'                         } ] },
        'CFG-INF': { 
            descr:'Information message configuration',
            spec:[  { name:'protocolID',            type:'U1'                           }, // 0:UBX, 1:NMEA
                    { /*name:'res1',*/              type:'U1[3]'                        },
                    { name:'infMsgMask',            type:'U1[]'                         } ] }, // bit0:ERROR, bit1:WARNING, bit2:NOTICE, bit3:TEST, bit4:DEBUG
        'CFG-RST': { 
            descr:  'Reset Receiver / Clear Backup Data Structures',
            spec:[  { name:'navBbrMask',            type:'X2'                           }, // 0x0000:Hotstart 0x0001:Warmstart 0xFFFF:Coldstart
                    { name:'resetMode',             type:'U1'                           }, // 0:WD 1:SW 2:GNSS only 4:HD+WD 8:stop 9:start
                    {                               type:'X1'                           } ] },
        'CFG-CFG': { 
            descr:  'Clear, Save and Load configurations',
            spec:[  { name:'clear',                 type:'X4'                           },
                    { name:'save',                  type:'X4'                           },
                    { name:'load',                  type:'X4'                           },
                    { name:'deviceMask',            type:'X1'                           } ] }, // bit0:BBR bit1:FLASH bit2:EEPROM bit4:SPI
        'CFG-VALSET': { 
            descr:  'Sets values corresponding to provided key-value pairs',
            spec:[  { name:'version',               type:'U1'                           }, // 0/1
                    { name:'layer',                 type:'U1'                           }, // 0:RAM, 1:BBR, 2:FLASH, 7:DEFAULT
                    { name:'transaction',           type:'U1'                           }, // if (version == 1): 0:Transactionless, 1:(Re)Start deletion transaction, 2: Deletion transaction ongoing, 3: Apply and end a deletion transaction
                    { /*name:'res1',*/              type:'U1'                           },
                    { name:'cfgData',               type:'U1[]'                         } ] }, // key/value pairs U4 + x1|x2|x4|x8
        'CFG-VALGET': { 
            descr:  'Get Configuration Items',
            spec:[  { name:'version',               type:'U1'                           }, // set 1
                    { name:'layers',                type:'U1'                           }, // bit0:RAM, bit1:BBR, bit2:FLASH
                    { /*name:'res1',*/              type:'U1[2]'                        },
                    { name:'cfgData',               type:'U1[]'                         } ] }, // key/value pairs U4 + x1|x2|x4|x8
        'CFG-VALDEL': { 
            descr:  'Deletes values corresponding to provided keys',
            spec:[  { name:'version',               type:'U1'                           }, // set 0/1
                    { name:'layers',                type:'U1'                           }, // bit1:BBR, bit2:FLASH
                    { name:'transaction',           type:'U1'                           }, // if (version == 1): 0:Transactionless, 1:(Re)Start deletion transaction, 2: Deletion transaction ongoing, 3: Apply and end a deletion transaction
                    { /*name:'res1',*/              type:'U1'                           },
                    { name:'keys',                  type:'U4[]'                         } ] }, // keys
    // TUN ------------
        'TUN-MEAS': { 
            descr:  'Measurements',
            spec:[  { name:'name',                  type:'S8'                          },
                    { name:'unit',                  type:'S4'                          },
                    { name:'flags',                 spec: [
                        {                           type:'x8'                           } ] },
                    { name:'version',               type:'U1'                          },
                    { name:'numMeas',               type:'U2'                          },
                    { name:'meas', repeat:'numMeas', spec: [
                        { name:'name',              type:'S4'                          },
                        { name:'unit',              type:'S3'                          },
                        { name:'type',              type:'U1' /* 0=U8, 1=I8, 2=R8 */   },
                        { name:'value',             type:'R8' /* union U/I/R8 */       } ] } ] },
    // MON ------------
        'MON-VER': { 
            descr:  'Receiver/Software Version',
            spec:[  { name:'swVer',                 type:'S30'                          },
                    { name:'hwVer',                 type:'S10'                          },
                    { name:'extVer',                type:'S30[]'                        } ] },
        'MON-PMP': { 
            descr:  'PMP monitoring data',
            spec:[  { name:'version',               type:'U1'                           },
                    { name:'entries',               type:'U1'                           },
                    { /*name:'res0',*/              type:'U1[2]'                        },
                    { name:'entry', repeat:'entries', spec: [
                        { name:'timeTag',           type:'U4', unit:'ms'                },
                        { name:'status',            spec: [
                            { name:'locked',        type:'x1'                           },
                            { name:'frameSync',     type:'x1'                           },
                            {                       type:'x30'                          } ] },
                        { name:'lockTime',          type:'U4', unit:'ms'                }, 
                        { name:'centerFreq',        type:'U4', unit:'Hz'                }, 
                        { name:'cn0',               type:'U1', unit:'dbHz'              },
                        { name:'cn0Frac',           type:'U1', unit:'dbHz',scale:1./256 }, 
                        { /*name:'res1',*/          type:'U1[2]'                        } ] } ] }, 
    // ESF ------------
        'ESF-STATUS': { 
            descr:'External Sensor Fusion Status',
            spec:[  { name:'itow',                  type:'U4', scale:1e-3, unit:'s'     },
                    { name:'version',               type:'U1'                           },
                    { /*name:'res0',*/              type:'U1[7]'                        },
                    { name:'fusionMode',            type:'U1'                           }, // 0:init, 1:fusion mode, 2:temp suspended, 3:disabled
                    { /*name:'res1',*/              type:'U1[2]'                        },
                    { name:'numSens',               type:'U1'                           },
                    { name:'sensor', repeat:'numSens', spec: [
                        { name:'sensStatus1',       spec: [
                            { name:'type',          type:'x6'                           },
                            { name:'used',          type:'x1'                           },
                            { name:'ready',         type:'x1'                           } ] },
                        { name:'sensStatus1',       spec: [
                            { name:'calibStatus',   type:'x2'                           },
                            { name:'timeStatus',    type:'x2'                           },
                            {                       type:'x4'                           } ] },
                        { name:'freq',              type:'U1', unit:'Hz' }, 
                        { name:'faults',       spec: [
                            { name:'badMeas',       type:'x1'                           },
                            { name:'badTtag',       type:'x1'                           },
                            { name:'missingMeas',   type:'x1'                           },
                            { name:'noisyMeas',     type:'x1'                           },
                            {                       type:'x4'                           } ] } ] } ] },
        'MGA-GPS': { 
            descr: 'GPS Assistance Date',
            spec:[  { name:'type',                  type:'U1'                           }, // 1:EPH, 2: ALM, 3:TIMEOFFSET, 4:HEALTH 5:UTC 6:IONO
                    { name:'version',               type:'U1'                           },
                    { name:'svid',                  type:'U1'                           },
                    { name:'gnss',                  type:'U1'                           } ] },
        'MGA-GAL': { 
            descr: 'Galileo Assistance Date',
            spec:[  { name:'type',                  type:'U1'                           },
                    { name:'version',               type:'U1'                           },
                    { name:'svid',                  type:'U1'                           },
                    { name:'gnss',                  type:'U1'                           } ] },
        'MGA-BDS': { 
            descr:'Beidou Assistance Date',
            spec:[  { name:'type',                  type:'U1'                           },
                    { name:'version',               type:'U1'                           },
                    { name:'svid',                  type:'U1'                           },
                    { name:'gnss',                  type:'U1'                           }, ] },
        'MGA-QZSS': { 
            descr:'QZSS Assistance Date',
            spec:[  { name:'type',                  type:'U1'                           },
                    { name:'version',               type:'U1'                           },
                    { name:'svid',                  type:'U1'                           },
                    { name:'gnss',                  type:'U1'                           } ] },
        'MGA-GLO': { 
            descr:  'Glonass Assistance Date',
            spec:[  { name:'type',                  type:'U1'                           },
                    { name:'version',               type:'U1'                           },
                    { name:'svid',                  type:'U1'                           },
                    { name:'gnss',                  type:'U1'                           } ] },
        'MGA-ANO': { 
            descr:  'Assist Now Offline',
            spec:[  { name:'type',                  type:'U1'                           },
                    { name:'version',               type:'U1'                           },
                    { name:'svid',                  type:'U1'                           },
                    { name:'gnss',                  type:'U1'                           },
                    { name:'year',                  type:'U1'                           },
                    { name:'month',                 type:'U1'                           },
                    { name:'day',                   type:'U1'                           },
                    {/*name:'res1', */              type:'U1'                           },
                    { name:'data',                  type:'U1[64]'                       },
                    {/*name:'res2',*/               type:'U1[4]'                        } ] },
        'MGA-FLASH': { 
            descr:  'Assist Now Flash Commands',
            spec:[  { name:'type',                  type:'U1'                           }, // 1:DATA, 2:STOP, 3:ACK
                    { name:'version',               type:'U1'                           },
                    { name:'_data_', repeat:'((type==1)?1:0)', spec: [
                        { name:'sequence',          type:'U2'                           },
                        { name:'size',              type:'U2'                           },
                        { name:'data',              type:'U1[]'                         }, ] },
                    { name:'_ack_', repeat:'((type==3)?1:0)', spec: [
                        { name:'ack',               type:'U1'                           },
                        {/*name:'res1',*/           type:'U1'                           },
                        { name:'sequence',          type:'U2'                           } ] } ] }
    };
}

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
            txt = hex(num,2);;
    }
    return [txt, num];
}

function repeat(s,f) {
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

const mapCls = {
    0x01:'NAV',  0x02:'RXM',  0x04:'INF', 0x05:'ACK', 0x06:'CFG', 0x08:'TUN', 
    0x09:'UPD',  0x0A:'MON',  0x0B:'AID', 0x0D:'TIM',
    0x10:'ESF',  0x13:'MGA',  0x21:'LOG', 0x27:'SEC', 0x28:'HNR',
    0xF0:'NMEA', 0xF1:'PUBX', 0xF5:'RTCM',
};

const mapMsg = {
    0x01/*NAV*/: {  0x01:'POSECEF',   0x02:'POSLLH',    0x03:'STATUS',    0x04:'DOP',       0x05:'ATT',
                    0x06:'SOL',       0x07:'PVT',       0x09:'ODO',
                    0x10:'RESETODO',  0x11:'VELECEF',   0x12:'VELNED',    0x13:'HPPOSECEF', 0x14:'HPPOSLLH',
                    0x20:'TIMEGPS',   0x21:'TIMEUTC',   0x22:'CLOCK',     0x23:'TIMEGLO',   0x24:'TIMEBDS',
                    0x25:'TIMEGAL',   0x26:'TIMELS',    0x30:'SVINFO',    0x31:'DGPS',      0x32:'SBAS',
                    0x34:'ORB',       0x35:'SAT',       0x39:'GEOFENCE',  0x3B:'SVIN',      0x3C:'RELPOSNED',
                    0x42:'SLAS',      0x43:'SIG',       0x60:'AOPSTATUS', 0x61:'EOE',       0x62:'PL' },
    0x02/*RXM*/: {  0x13:'SFRBX',     0x14:'MEASX',     0x15:'RAWX',      0x20:'SVSI',      0x32:'RTCM',
                    0x34:'COR',       0x41:'PMREQ',     0x61:'IMES',      0x59:'RLM',       0x72:'PMP',
                    0x73:'QZSSL6', },
    0x04/*INF*/: {  0x00:'ERROR',     0x01:'WARNING',   0x02:'NOTICE',    0x03:'TEST',      0x04:'DEBUG', },
    0x05/*ACK*/: {  0x00:'NAK',       0x01:'ACK', },
    0x06/*CFG*/: {  0x00:'PRT',       0x01:'MSG',       0x02:'INF',       0x04:'RST',       0x06:'DAT',
                    0x08:'RATE',      0x09:'CFG',       0x11:'RXM',       0x13:'ANT',       0x16:'SBAS',
                    0x17:'NMEA',      0x1B:'USB',       0x1E:'ODO',       0x23:'NAVX5',     0x24:'NAV5',
                    0x31:'TP5',       0x34:'RINV',      0x39:'ITFM',      0x3B:'PM2',       0x3D:'TMODE2',
                    0x3E:'GNSS',      0x47:'LOGFILTER', 0x53:'TXSLOT',    0x57:'PWR',       0x5C:'HNR',
                    0x60:'ESRC',      0x61:'DOSC',      0x62:'SMGR',      0x69:'GEOFENCE',  0x70:'DGNSS',
                    0x71:'TMODE3',    0x84:'FIXSEED',   0x85:'DYNSEED',   0x86:'PMS',       0x93:'BATCH',
                    0x8A:'VALSET',    0x8B:'VALGET',    0x8C:'VALDEL',    0x8D:'SLAS',},
    0x08/*TUN*/: {  0x01:'MEAS', },
    0x09/*SOS*/: {  0x14:'SOS', },
    0x0A/*MON*/: {  0x02:'IO',        0x04:'VER',       0x06:'MSGPP',     0x07:'RXBUF',     0x08:'TXBUF',
                    0x09:'HW',        0x0B:'HW2',       0x21:'RXR',       0x27:'PATCH',     0x28:'GNSS',
                    0x2E:'SMGR',      0x32:'BATCH',     0x35:'PMP', },
    0x0B/*AID*/: {  0x01:'INI',       0x02:'HUI',       0x30:'ALM',       0x31:'EPH',       0x33:'AOP', },
    0x0D/*TIM*/: {  0x01:'TP',        0x03:'TM2',       0x04:'SVIN',      0x06:'VRFY',      0x11:'DOSC',
                    0x12:'TOS',       0x13:'SMEAS',     0x16:'FCHG',      0x15:'VCOCAL',    0x17:'HOC', },
    0x10/*ESF*/: {  0x02:'MEAS',      0x03:'RAW',       0x10:'STATUS',    0x15:'INS', },
    0x13/*MGA*/: {  0x00:'GPS',       0x02:'GAL',       0x03:'BDS',       0x05:'QZSS',      0x06:'GLO',
                    0x20:'ANO',       0x21:'FLASH',
                    0x40:'INI',       0x60:'ACK',       0x80:'DBD', },
    0x21/*LOG*/: {  0x03:'ERASE',     0x04:'STRING',    0x07:'CREATE',    0x08:'INFO',      0x09:'RETRIEVE',
                    0x0B:'RETRIEVEPOS',                 0x0D:'RETRIEVESTRING',              0x0E:'FINDTIME',
                    0x0F:'RETRIEVEPOSEXTRA',            0x10:'RETRIEVEBATCH',               0x11:'BATCH', },
    0x27/*SEC*/: {  0x01:'SIGN',      0x03:'UNIQID', },
    0x28/*HNR*/: {  0x00:'PVT',       0x02:'INS', },
    0xF0/*NMEA*/:{  0x00:'GGA',       0x01:'GLL',       0x02:'GSA',       0x03:'GSV',
                    0x04:'RMC',       0x05:'VTG',       0x06:'GRS',       0x07:'GST',
                    0x08:'ZDA',       0x09:'GBS',       0x0A:'DTM',       0x0D:'GNS',
                    0x0F:'VLW', }, 
    0xF1/*PUBX*/:{  0x00:'PUBX,00',   0x01:'PUBX,01',   0x03:'PUBX,03',   0x04:'PUBX,04',    },
    0xF5/*RTCM*/:{  0x05:'1005',      0x4A:'1074',      0x4D:'1077',      0x54:'1084',
                    0x57:'1087',      0x5E:'1094',      0x61:'1097',      0x7C:'1124',
                    0x7F:'1027',      0xE6:'1230',      0xFD:'4072.1',    0xFE:'4072.0', }, 
};

const mapPort     = { 0:'DDC',   1:'UART1',   2:'UART2',  3:'USB',  4:'SPI', };

const mapProtocol = { 0:'UBX',   1:'NMEA',    2:'RTCM',   /* ... */ 5:'RTCM3', };

const mapInf      = { 0:'ERROR', 1:'WARNING', 2:'NOTICE', 3:'TEST', 4:'DEBUG', };

const mapCfgLayer = { 0:'RAM',   1:'BBR',     2:'FLASH',  /* ... */ 7:'DEFAULT', };
