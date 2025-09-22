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

import { Message } from "./message.js";
import {
    Protocol, 
    ProtocolUbx, 
    ProtocolNmea, 
    ProtocolRtcm3, 
    ProtocolSpartn,
    ProtocolAt, 
    ProtocolText, 
    ProtocolUnknown 
} from "./protocols/index.js";

export class Engine {

    constructor () {
        this.#parseBuffer = ''
        this.#protocolUnknown = new ProtocolUnknown;
        this.#protocolUbx = new ProtocolUbx;
        this.#protocolNmea = new ProtocolNmea;
        this.#protocolAt = new ProtocolAt;
        this.#protocols = [ 
            this.#protocolUbx, 
            this.#protocolNmea, 
            new ProtocolRtcm3, 
            new ProtocolSpartn, 
            this.#protocolAt, 
            new ProtocolText /*UNKNOWN, DEBUG, TRACE */ 
        ];
        
    }

    append(data) {
        this.#parseBuffer += data;
    }

    reset() {
        this.#parseBuffer = '';
    }

    parse() {
        let ret = this.#parse(this.#parseBuffer, Message.TYPE_OUTPUT);
        let messages = ret[0];
        let done = ret[1];
        // rcompact the buffer
        if (done > 0) this.#parseBuffer = this.#parseBuffer.slice(done);
        // remainder as unknown (but mark temporary pending)
        if (this.#parseBuffer.length) {
            const message = this.#protocolUnknown.process( this.#parseBuffer, Message.TYPE_PENDING);
            messages.push( message );
        }
        return messages;
    }

    pending() {
        if (this.#parseBuffer === '') return undefined;
        const message = this.#protocolUnknown.process( this.#parseBuffer, Message.TYPE_OUTPUT);
        this.#parseBuffer = '';
        return message;
    }

    make(data) {
        data = Engine.#conv(data);
        // parse them into separate messages
        let ret = this.#parse(data, Message.TYPE_INPUT);
        let messages = ret[0];
        let done = ret[1];
        // remainder as unknown
        if (done !== data.length) {
            let message = this.#protocolUnknown.process( data.slice(done), Message.TYPE_INPUT);
            messages.push( message );
        }
        return messages;
    }

    makeFromText(data) {
        let message
        for (prot = 0; (prot < this.#protocols.length) && !def(message); prot ++) {
            if (this.#protocols[prot].fromText)
                message = this.#protocols[prot].fromText();
        }
        return message;
    }

    makeSuggestions() {
        let arr = []; 
        _suggestions('AT',   this.#protocolAt.spec,   this.#protocolAt.hint); 
        _suggestions('$',    this.#protocolNmea.spec, this.#protocolNmea.hint); 
        _suggestions('UBX ', this.#protocolUbx.spec,  this.#protocolUbx.hint); 
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
    }

    #parse(buffer, type) {
        let messages = [];
        let ofs = 0;
        let done = 0;
        while (ofs < buffer.length) {
            let prot = 0;
            while (prot < this.#protocols.length) {
                let end = this.#protocols[prot].parse(buffer, ofs);
                if (Protocol.WAIT === end) {
                    // exit loops
                    ofs = buffer.length;
                    prot = this.#protocols.length;
                } else if ((Protocol.NOTFOUND !== end) && (end > ofs)) {
                    if (ofs > done)
                        messages.push( ProtocolUnknown.process(buffer.slice(done,ofs), type) );
                    messages.push( this.#protocols[prot].process(buffer.slice(ofs,end), type) );
                    done = ofs = end;
                    prot = 0;
                } else {
                    prot ++; // next protocol
                    if (prot === this.#protocols.length)
                        ofs ++; // skip a byte
                }
            }
        }
        return [ messages, done ];
    }

    static #conv(data) {
        if (typeof data === 'string') {
            return data;
        } else if (data instanceof Array) {
            let str = '';
            for (let i = 0; i <  data.length; i ++) {
                if (data[i] < 0 || data[i] > 255) {
                    throw new Error('Array "data" does not contain Bytes.');
                }
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

    #protocolUnknown
    #protocolUbx
    #protocolNmea
    #protocolAt
    #parseBuffer
    #protocols
}