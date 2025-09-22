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

import { formatDateTime, formatTime, pad } from "./utils.js";
import { dumpText, dumpHex, dumpJson } from "./dump.js";

const LOG_LEN_TIME = 14;
const LOG_LEN_TYPE = 8;
const LOG_LEN_PROTOCOL = 10;
const LOG_LEN_NAME = 16;
const LOG_LEN_SIZE = 16;

// Message
// ------------------------------------------------------------------------------------
/*
    //                                                  Console  Details  Logfile  Ubxfile
    protocol  UBX,NMEA,RTCM3,SPARTN,AT,TEXT,...         yes      yes      yes
    type      output,pending,input                      yes      yes      yes      yes
    name      the name of the message                   yes      yes      yes
    time      hh.mm.ss.sss                              yes               yes
    date      yyyy-mm-dd hh.mm.ss.sss                            yes
    text      some textual representation               yes
    color     color of the text                         yes
    data      the binary data (may be just text)                 yes      yes      yes
    binary    protocol is binary                                          yes
    -- optional --
    fields    decoded fields                                     yes
    spec      specification                                      yes
    id        protocol specific id
    
    Protocol  Name                    Type
    SCRIPT:   INFO, ERROR, TRACE      command
    USER:     TRACE                   command
    DEBUG:    AGENT(event), DEVICE(command,event)
*/
export class Message {
    constructor(protocol, data, type, binary) {
        this.protocol = protocol
        this.type = type
        this.data = data
        this.binary = binary
        const datetime = new Date().getTime()
        this.time = formatTime(datetime)
        this.date = formatDateTime(datetime)
        this.name = '?'
        this.text = ''
    }
    
    lineHtml(filter) {
        const head = `${this.time} ${this.protocol} `
        if ((filter === undefined) || filter.exec(head + this.text)) {
            // create the message DOM
            let div = document.createElement('div')
            div.className = 'message ' + this.type
            div.message = this
            let span = document.createElement('div')
            span.className = 'messagehead preformated'
            span.textContent = head
            div.appendChild(span)
            span = document.createElement('div')
            span.className = 'messagetext preformated'
            span.textContent = this.text
            if (this.color) span.style.color = this.color
            div.appendChild(span)
            return div
        }
    }
    
    tableHtml() {
        let dump = '<table class="table">'
        dump += '<tr><td><b>Protocol</b></td><td style="width:100%">' + this.protocol + '</td></tr>'
        dump += '<tr><td><b>Name</b></td><td>' + this.name + '</td></tr>'
        //if (message.id) dump += '<tr><td><b>Identifyer</b></td><td>' + message.id + '</td></tr>'
        if (this.descr)
            dump += '<tr><td><b>Description</b></td><td>' + this.descr + '</td></tr>'
        dump += '<tr><td><b>Type</b></td><td>' + this.type.toUpperCase() + '</td></tr>'
        dump += '<tr><td><b>Length</b></td><td>' + this.data.length + '</td></tr>'
        dump += '<tr><td><b>Text Dump</b></td><td class="preformated">' + dumpText(this.data, this.binary) + '</td></tr>'
        dump += '<tr><td><b>Hex Dump</b></td><td class="preformated">' + dumpHex(this.data) + '</td></tr>'
        if (this.fields)
            dump += '<tr><td><b>Fields</b></td><td class="preformated">' + dumpJson(this.fields) + '</td></tr>'
    //   if (message.spec)
    //       dump += '<tr><td><b>Definition</b></td><td>' + dumpJson(message.spec) + '</td></tr>'
        dump += '<tr><td><b>Timestamp</b></td><td>' + this.date + '</td></tr>';
        dump += '</table>';
        let div = document.createElement('div')
        div.className = 'messagehint'
        div.innerHTML = dump
        return div
    }

    logText() {
        let data
        if (this.binary === false)
            data = textDump(this.data, false)
        else {
            const hex = this.data.split('').map(_convert)
            function _convert(c) {
                const by = c.charCodeAt(0)
                return ('0'+by.toString(16).toUpperCase()).slice(-2)
            }
            data = '[ ' + hex.join(' ') + ' ]'
        }
        return pad(this.time, LOG_LEN_TIME)  +
            pad(this.type.toUpperCase(), LOG_LEN_TYPE) +
            pad(this.protocol, LOG_LEN_PROTOCOL) +
            pad(this.name, LOG_LEN_NAME) +
            pad(this.data.length.toString(), LOG_LEN_SIZE) +
            data + '\r\n'
    }

    static logHeader = 
        pad('TIME', LOG_LEN_TIME) +
        pad('TYPE', LOG_LEN_TYPE) + 
        pad('PROTOCOL', LOG_LEN_PROTOCOL) + 
        pad('MESSAGE', LOG_LEN_NAME) + 
        pad('SIZE', LOG_LEN_SIZE) + 
        'TEXT/HEX\r\n';

    static TYPE_INPUT = 'input';       // to device 
    static TYPE_OUTPUT = 'output';     // from device 
    static TYPE_PENDING = 'pending';   // from device 
}
