
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

export function log(...args) {
    const stack = new Error().stack.split("\n");
    const text = stack.slice(1).map((str) => {
        const m = str.match(/^([^@]*)@.*\/([^\/]+)\.js(:\d*)/);;
        return (m) ? `${m[2]}:${m[1]||m[3]}` : str; 
    }).reverse().join(' ');
    const time = formatTime(Date.now());
    console.log.apply(console, [ time, ...args/*, text*/]);
}

export function def(value) {
    return (undefined !== value) && (null !== value);
}

export function get(obj, path) {
    const parts = path.split(".");
    const val = obj;
    for (const part of parts) {
        if (!def(val)) {
            break;
        }
        val = val[part];
    }
    return val;
}

// 000000000011111111112222
// 012345678901234567890123
// YYYY-MM-DDTHH:MM:SS.sssZ
// \__0-10__/.\__11-23___/.
export function formatDateTime(utcMs) {
    const utcTxt = new Date(utcMs).toISOString();
    return utcTxt.replace('T', ' ').slice(0, 23);
}

export function formatDateTimeShort(utcMs) {
    const utcTxt = new Date(utcMs).toISOString();
    return utcTxt.replace('T', ' ').slice(0, 19);
}

export function formatDate(utcMs) {
    const utcTxt = new Date(utcMs).toISOString();
    return utcTxt.slice(0, 10);
}

export function formatTime(utcMs) {
    const utcTxt = new Date(utcMs).toISOString();
    return utcTxt.slice(11, 23);
}

export function setAlpha(hexColor, alpha = 1) {
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

export function bytesToString(bytes) {
    return Array.from(bytes, byte => String.fromCharCode(byte)).join('');
}

export function isGzip(value) {
    return (value instanceof Uint8Array) && (2 <= value?.length) && 
           (value[0] === 0x1f) && (value[1] === 0x8b);
}