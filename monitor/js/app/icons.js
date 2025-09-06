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

export function iconsExtend(feather) {
    const attrs = {
        xmlns: "http://www.w3.org/2000/svg",
        width: 24,
        height: 24,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": 2,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
    };
    const icons = {
        "chart-time"   : `<path d="M 2 15 l 2 0 l 1 -2 h 2 l 4 5 l 3 0 l 2 -3 l 2 -7 l 2 -1 l 2 3"/>`,
        "chart-diff"   : `<path d="M 2 14 l 1 -4 l 2 7 l 1 -5 l 2 2 l 2 -1 h 2 l 1 2 l 1 -4 l 1 4 l 1 -3 l 2 2 l 1 -6 l 1 5 l 1 -3 l 1 5"/>`,
        "chart-int"    : `<path d="M 2 22 c 9 -16 7 -15 20 -20"/>`,
        "chart-cdf"    : `<path d="M 2 22 q 3 0 5 -10 t 15 -10"/>`,
        
        "chart-hist"   : `<path d="M 2 22 l 1 0 l 1 -5 l 2 5 l 1 -13 l 1 6 l 2 -13 l 2 12 l 1 -3 l 1 6 l 2 1 l 2 -1 l 1 4 l 3 1"/>`,
        "chart-histFD" : `<path d="M 2 22 c 6 0 5 -20 7 -20 s 2 9 6 10 s 1 9 7 10"/>`,
        "chart-kde"    : `<path d="M 2 22 l 3 -6 l 3 1 l 4 -15 l 4 11 l 2 -1 l 2 10 l 2 0"/>`,
        "chart-freq"   : `<path d="M 2 2 c 0 9 2 13 5 16 s 5 1 6 0 s 1 -2 2 0 s 1 2 7 4"/>`,
        "chart-freqDB" : `<path d="M 2 6 q 3 7 5 7 q 2 1 4 0 t 4 0 t 7 3"/>`,
    };    
    function newIcon(name, contents) {
        return {
            name,
            contents,
            attrs,
            toSvg(extraAttrs = {}) {
                const merged = { ...this.attrs, ...extraAttrs };
                const attrsStr = Object.entries(merged)
                .map(([k, v]) => `${k}="${v}"`)
                .join(" ");
                return `<svg ${attrsStr}>${this.contents}</svg>`;
            },
        };
    }
    Object.entries(icons).forEach(([name,contents]) => {
        feather.icons[name] = newIcon(name, contents);
    });
}