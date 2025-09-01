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

import { Track } from '../core/track.js';
import { FieldsReg } from '../core/fieldsReg.js';
import { def } from '../core/utils.js';

export class TableView {
    constructor(container) {
        this.#container = container;
        this.updateColumns([])
    }

    // ===== Public API =====
    updateColumns(tracks) {
        // header
        const filteredTracks = tracks.filter((track) => (track.mode !== Track.MODE_HIDDEN));
        const thead = document.createElement('thead');
        table.appendChild(thead);
        const tr = document.createElement('tr');
        thead.appendChild(tr);
        const thP = document.createElement('th');
        thP.textContent = 'Parameter';
        tr.appendChild(thP);
        filteredTracks.forEach( (track) => {
            const thV = document.createElement('th');
            thV.className = 'right';
            thV.appendChild(track.nameHtml());
            tr.appendChild(thV);
        });
        const thU = document.createElement('th');
        thU.textContent = 'Unit';
        tr.appendChild(thU);
        
        // body
        const tbody = document.createElement('tbody');
        table.appendChild(tbody);
        Track.EPOCH_FIELDS.forEach((field) => {
            const foundIx = filteredTracks.findIndex( (track) => def(track.currentEpoch?.fields?.[field]));
            if (true /*always*/ || -1 !== foundIx) {
                // each row
                const reg = FieldsReg[field];
                const tr = document.createElement('tr');
                const tdName = document.createElement('td');
                tdName.className = "ellipsis";
                if (reg.name) {
                    tdName.title = reg.name;
                    tdName.textContent = reg.name;
                }
                tdName.style.cursor = 'pointer';
                tdName.addEventListener('click', (evt) => {
                    this.#emit('field', field);
                });
                tr.appendChild(tdName);
                filteredTracks.forEach( (track) => {
                    const tdFormated = document.createElement('td');
                    tdFormated.className = "right";
                    if (def(track.currentEpoch?.fields?.[field])) {
                        tdFormated.appendChild(reg.formatHtml(track.currentEpoch.fields[field]));
                    }
                    tr.appendChild(tdFormated);
                } );
                const tdUnit = document.createElement('td');
                tdUnit.innerHTML = reg.unit || '&nbsp;';
                tr.appendChild(tdUnit);
                tbody.appendChild(tr);
            }
        } );
        this.#container.replaceChildren(thead, tbody);
    }

    // ===== Save Restore API =====

    // ===== Internals =====

    // ===== Utils =====
    #emit(name, detail) {
        this.#container.dispatchEvent(new CustomEvent(name, { detail } ));
    }

    #container
}
