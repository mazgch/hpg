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

import { def, formatDate, formatTime } from './utils.js';

export class Field {
    constructor(name, opt = {} ) {
        this.name = name;
        this.unit = opt.unit || '';
        this.hidden = opt.hidden || false;
        this.#prec = opt.prec;
        this.#hint = opt.hint || '';
        this.map = opt.map;
        if (0 <= opt.colors?.length) {
            this.#colors = opt.colors.map( (row) => {
                return {
                    val:row.val, color:row.color, 
                    r: parseInt(row.color.slice(1,3), 16),
                    g: parseInt(row.color.slice(3,5), 16),
                    b: parseInt(row.color.slice(5,7), 16) 
                };
            });
        }
    }

    // get a numeric value of ths field 
    number(val) {
        let number;
        if (this.map) {
            if (Number.isInteger(val)) {
                number = val;
            } else {
                const ix = Object.keys(this.map).indexOf(val); 
                if (0 <= ix) {
                    number = ix; 
                }
            }
        } else {
            number = this.#val2Number(val, null);
        }
        return number;
    }

    format(val) {
        let formated;
        if (this.map) {
            if (def(this.map[val])) {
                formated = val;
            }
        } else {
            formated = this.#val2Number(val);
            if (formated === undefined) {
                formated = val;
            }
        }
        return formated;
    }

    hint(val) {
        let hint;
        if (this.map?.[val]?.hint) {
            hint = this.map[val].hint;
        } else if (this.#hint) {
            hint = this.#hint;
        }
        return hint;
    }  
    
    // FORMAT html : '◌ value' || 'value'
    formatHtml(val) {
        const el = document.createElement('span');
        const hint = this.hint(val);
        hint && (el.title = hint);
        const elColor = this.colorHtml(val);
        const formated = this.format(val);
        if (elColor) {
            el.appendChild(elColor);
        }
        formated && el.appendChild(document.createTextNode(` ${formated} `));
        return el;
    }
    
    // COLOR 
    color(val) {
        let color;
        if (0 < this.#colors?.length) {
            color = this.#val2Color(val, this.#colors);
        } else {
            color = this.map?.[val]?.color;
        }
        return color;
    }

    colorHtml(val) {
        let el;
        const color = this.color(val);
        if (color) {
            el = document.createElement('span');
            el.style.color = color;
            el.className = 'dot';
        }
        return el;
    }

    // LABEL html : 'name formated unit'
    label(val) {
        return `${this.name} ${this.format(val)} ${this.unit}`;
    }

    labelHtml(val) {
        const el = document.createElement('span');
        this.name && el.appendChild(document.createTextNode(` ${this.name} `));
        el.appendChild(this.formatHtml(val));
        this.unit && el.appendChild(document.createTextNode(` ${this.unit} `));
        return el;
    }

    // TABLE ROW html : | name | formated | unit | 
    trHtml(val) {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.className = "ellipsis";
        if (this.name) {
            tdName.title = this.name;
            tdName.textContent = this.name;
        }
        tr.appendChild(tdName);
        const tdFormated = document.createElement('td');
        tdFormated.className = "right";
        tdFormated.appendChild(this.formatHtml(val));
        tr.appendChild(tdFormated);
        const tdUnit = document.createElement('td');
        tdUnit.innerHTML = this.unit || '&nbsp;';
        tr.appendChild(tdUnit);
        return tr;
    }

    // ---------- helpers ----------
    
    #val2Number(val) {
        let number = Number(val);
        if (!Number.isFinite(number)) {
            number = undefined;
        } else if (0 < this.#prec) {
            number = Number(number.toFixed(this.#prec));
        } else {
            number = number.toFixed(13).replace(/^([.\d]*[1-9])[.0]*$/,"$1");
            number = Number(number)
        }
        return number;
    }   
    
    #val2Color(val, colors) {
        const ix = colors.findIndex( (row) => row.val > val);
        let color;
        if (ix === 0) {
            color = colors[0].color;
        } else if (ix !== -1) {
            const A = colors[ix-1];
            const B = colors[ ix ];
            const f = (val - A.val) / (B.val - A.val);
            // Linear interpolate in sRGB
            const r = _lerp(A.r, B.r, f);
            const g = _lerp(A.g, B.g, f);
            const b = _lerp(A.b, B.b, f);
            color = `#${r}${g}${b}`;
        } else {
            color = colors[colors.length - 1].color;
        } 
        return color;
        function _lerp(a, b, f) { 
            return Math.round(a + f *  (b - a)).toString(16).padStart(2, "0");
        }
    }

    // some protected local vars 
    //#map;
    #prec;
    #hint;
    #colors;
}

export class FieldMap extends Field {
    number(val) {
        if (this.map) {
            const ix = Object.keys(this.map).indexOf(val); 
            val = (0 <= ix) ? ix : undefined;
        }
    }
    format(val) {
        val = Object.keys(this.map)[val]
        return val;
    }
}

export class FieldTime extends Field {
    number(val) {
        if (!Number.isFinite(val)) {
            val = new Date(`1980-01-06T${val}Z`).getTime();
            val = Number.isNaN(val) ? undefined : val; 
        }
        return val;
    }
    format(val) {
        if (Number.isFinite(val)) {
            val = formatTime(val); 
        }
        return val;
    }
}

export class FieldDate extends Field {
    number(val) {
        if (!Number.isFinite(val)) {
            val = new Date(`${val}T00:00:00.000T`).getTime();
            val = Number.isNaN(val) ? undefined : val; 
        }
        return val;
    }
    format(val) {
        if (Number.isFinite(val)) {
            val = formatDate(val); 
        }
        return val;
    }
}