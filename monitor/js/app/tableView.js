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
            thV.style.maxWidth = '120px';
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
                    if (field === 'cnoLev') {
                        tdFormated.className = "center";
                        tdFormated.style.width = "100px";
                        tdFormated.style.height = "6em";
                        tdFormated.style.padding = "2px";
                        const canvas = document.createElement('canvas');
                        this.chartSignalCn0(canvas, track.currentEpoch?.svs);
                        tdFormated.appendChild(canvas);
                    } else if (field === 'svPos') {
                        tdFormated.className = "center";
                        tdFormated.style.width = "100px";
                        tdFormated.style.height = "100px";
                        tdFormated.style.padding = "2px";
                        const canvas = document.createElement('canvas');
                        this.chartSatellitePositions(canvas, track.currentEpoch?.svs);
                        tdFormated.appendChild(canvas);
                    } else {
                        tdFormated.className = "right";
                        if (def(track.currentEpoch?.fields?.[field])) {
                            const html = reg.formatHtml(track.currentEpoch.fields[field]);
                            tdFormated.appendChild(html);
                        }
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

    chartSignalCn0(canvas, svs) {
        const labels = [];
        const values = [];
        const colors = [];
        Object.entries(svs).forEach(([sv, it]) => {
            const color = it.used ? "rgba(0,200,0,0.8)" : "rgba(0,100,255,0.8)"
            if (typeof it.cno === 'object') {
                Object.entries(it.cno).forEach(([sig, cno]) => {
                    if (0 < cno) {
                        labels.push(sv + ' ' + sig);
                        values.push(cno);
                        colors.push(color);
                    }
                });
            } else if (0 < it.cno) {
                labels.push(sv);
                values.push(it.cno);
                colors.push(color);
            }
        });
        new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [ { data: values, backgroundColor: colors }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                transitions: { active: { animation: false } },
                scales: {
                    x: { display: false },
                    y: { display: true, min: 0, max: 55, step:5,
                         ticks: { font: { size: 8 } }, 
                         grid: { drawTicks: false, } 
                       }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        usePointStyle: false, displayColors: false,
                        backgroundColor: 'rgba(245,245,245,0.8)',
                        titleColor: '#000', titleFont: { size: 10 },
                        bodyColor: '#000', bodyFont: { size: 10 },
                        borderColor: '#888', borderWidth: 1, cornerRadius: 0,
                        callbacks: { label: (ctx) => `${ctx.parsed.y} dB-Hz` }
                    }
                }
            }
        });
    }

    chartSatellitePositions(canvas, svs) {
        
    }

    // ===== Save Restore API =====

    // ===== Internals =====

    // ===== Utils =====
    #emit(name, detail) {
        this.#container.dispatchEvent(new CustomEvent(name, { detail } ));
    }

    #container
}
