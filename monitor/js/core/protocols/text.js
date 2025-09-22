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

import { Message }  from '../message.js';
import { Protocol } from './protocol.js';

export class ProtocolText extends Protocol {
    
    parse(data, i) {
        const len = data.length;
        if (i >= len) return Protocol.WAIT;
        let by = data.charCodeAt(i++);
        while ((32 <= by) && (126 >= by)) {
            if (i >= len) return Protocol.WAIT;
            by = data.charCodeAt(i++);
        }
        if (10 === by) return i;         // \n
        if (13 !== by) return Protocol.NOTFOUND; // \r
        if (i >= len) return i;
        by = data.charCodeAt(i);
        return (by === 10) ? i + 1 : i; // \n
    }

    process(data, type) {
        let message = new Message('TEXT', data, type, false);
        message.text = message.data.replace(/[\r\n]/gm, '');
        return message;
    }

    fromText(data) {
        return this.make(data);
    }

    make(data) {
        data = conv(data);
        data += '\r';
        return this.process(data, Message.TYPE_INPUT);
    }
}