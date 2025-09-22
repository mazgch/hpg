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

const INVALID_CHAR = '\u25ab';  // ▯ a box char '\u25ab' a box char;
const ELLIPSIS_CHAR = '\u2026'; // …;

export function dumpChar(by) {
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

export function dumpText(txt, binary) {
    if (binary === true)
        txt = txt.replace(/[\x00-\x1F\x7F-\xA0]+/gm, ELLIPSIS_CHAR);
    return txt.replace(/[\x00-\x20\x7F-\xA0]/g, _replaceChar);
    function _replaceChar(c) { return dumpChar(c.charCodeAt(0)); }
}

export function dumpJson(json) {
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
        .replace(/&/g, '&amp;')
        .replace(/\\"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(jsonLine, replacer);
}
                                
export function dumpHex(data, newLine = '</br>')
{
    let i;
    let line = '';
    let txt = ''
    for (i = 0; i < data.length; i ++) {
        if ((i&0xF) == 0) line += ('000'+i.toString(16).toUpperCase()).slice(-4) + ' ';
        const by = data.charCodeAt(i);
        line += ('0'+by.toString(16).toUpperCase()).slice(-2) + ' ';
        txt += dumpChar(by);
        
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
