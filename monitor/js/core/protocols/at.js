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

import { Message } from '../message.js';
import { Protocol } from './protocol.js';

export class ProtocolAt extends Protocol {

    parse(data, i) {
    //    [AT.*\r]      \\ echo / command
    //    [\r\n.*]\r\n  \\ intermediate
    //    [\r\n.*\r\n]  \\ final response
        const len = data.length;
        const ofs = i;
        let format;
        let by;
        if (i >= len) return Protocol.WAIT;
        by = data.charCodeAt(i++);
        if (65 === by || 97 === by) { // A,a
            if (i >= len) return Protocol.WAIT;
            by = data.charCodeAt(i++);
            if (84 !== by && 116 !== by) return Protocol.NOTFOUND; // T,t
            by = data.charCodeAt(i++);
            format = 0;
        } else if (13 === by) { // \r
            if (i >= len) return Protocol.WAIT;
            by = data.charCodeAt(i++);
            if (10 !== by) return Protocol.NOTFOUND; // \n
            by = data.charCodeAt(i++);
            format = 1;
            // avoid capturing NMEA
            if (36 === by) { // $
                if (i >= len) return Protocol.WAIT;
                by = data.charCodeAt(i++);
                if ((71 === by) || (80 === by)) return Protocol.NOTFOUND; // G, P
            }
        } else return Protocol.NOTFOUND;
        while ((32 <= by) && (126 >= by)) {
            if (i >= len) return Protocol.WAIT;
            by = data.charCodeAt(i++);
        }
        if (13 !== by)  return Protocol.NOTFOUND; // \r
        if (0 === format) return i;
        if (i >= len)   return Protocol.WAIT;
        by = data.charCodeAt(i++);
        if (10 !== by)  return Protocol.NOTFOUND; // \n
        // (1 === format)
        const payload = data.slice(ofs+2, i-2);
        const m = payload.match(/^(?:OK|BUSY|RING|CONNECT|NO (?:CARRIER|DIALDONE|ANSWER)|ABORTED|ERROR|\+CM[ES] Error:.*)$/i);
        if (m) return i;
        // check if we need to include trailing cr lr
        if (i >= len) return Protocol.WAIT;
        by = data.charCodeAt(i++);
        if (13 !== by) return i-3;
        if (i >= len) return Protocol.WAIT;
        by = data.charCodeAt(i++);
        if (10 !== by) return i-4;
        return i-2;
    }

    process(data, type) {
        let message = new Message('AT', data, type, false);
        let m;
        let payload;
        if (m = message.data.match(/^AT([\+&]?[A-Z0-9]*)[=?]*\s*(.*)\r$/i)) { // Echo
            message.id = m[1].toUpperCase();
            payload = m[2];
            this.#lastId = message.id;
        } else if (m = message.data.match(/^\r\n(OK|BUSY|RING|CONNECT|NO (?:CARRIER|DIALDONE|ANSWER)|ABORTED|ERROR)\r\n$/i)) { // final result
            message.id = m[1].toUpperCase();
            payload = '';
            this.#lastId = undefined;
        } else if (m = message.data.match(/^\r\n(\+CM[ES])\s*Error:\s*(.*)\r\n$/i)) { // Final result Error
            message.id = m[1].toUpperCase();
            payload = m[2];
            this.#lastId = undefined;
        } else if (m = message.data.match(/^\r\n([\+][A-Z0-9]+:)\s*(.*)(\r\n)?$/i)) { // URCs
            message.id = m[1].toUpperCase();
            payload = m[2];
        } else if (m = message.data.match(/^\r\n(.*)(?:\r\n)?$/i)) {
            message.id = this.#lastId;
            payload = m[1];
        }
        if (message.id !== undefined) {
            message.name = message.id;
            let msgSpec = this.spec[message.id];
            if (!msgSpec && (m = message.id.match(/^(\+[A-Z0-9]+):$/))) msgSpec = spec[m[1]];
            if (msgSpec) {
                message.descr = msgSpec.descr;
                //message.spec = msgSpec.spec;
                if (msgSpec.spec && (payload !== ''))
                    message.fields = Protocol.decode(payload, msgSpec.spec);
            }
        }
        message.text = message.data.replace(/[\r\n]/gm, '');
        return message;
    }

    fromText(data) {
        let m;
        if (m = data.match(/^AT/i)) {
            data = data.slice(2);
            return this.make(data);
        } 
    }

    make(data) {
        data = conv(data);
        data = 'AT' + data + '\r';
        return this.process(data, Message.TYPE_INPUT);
    }

    hint(spec) {
        return Protocol.hint(spec, '=');
    }
    
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
    spec = {
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

    #lastId
}
