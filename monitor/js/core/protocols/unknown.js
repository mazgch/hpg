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

export class ProtocolUnknown extends Protocol {

    process(data, type) {
        let message = new Message('UNKNOWN', data, type, true);
        message.text = data.replace(/[\x00-\x1F\x7F-\xA0]+/gm, '\u2026'); // … ellipsis
        return message;
    }
}
