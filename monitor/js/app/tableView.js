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
        filteredTracks.forEach((track) => {
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
            const foundIx = filteredTracks.findIndex((track) => def(track.currentEpoch?.fields?.[field]));
            if (true /*always*/ || -1 !== foundIx) {
                // each row
                const reg = FieldsReg[field];
                const tr = document.createElement('tr');
                tr.addEventListener('click', (evt) => {
                    this.#emit('field', field);
                });
                const tdName = document.createElement('td');
                tdName.className = "ellipsis";
                if (reg.name) {
                    tdName.title = reg.name;
                    tdName.textContent = reg.name;
                }
                tdName.style.cursor = 'pointer';
                tr.appendChild(tdName);
                filteredTracks.forEach((track) => {
                    const tdFormated = document.createElement('td');
                    if (field === 'cnoLev') {
                        tdFormated.className = "center";
                        if (def(track.currentEpoch?.svs)) {
                            tdFormated.style.width = "100px";
                            tdFormated.style.height = "6em";
                            tdFormated.style.overflow = "";
                            tdFormated.style.padding = "2px";
                            const canvas = document.createElement('canvas');
                            this.chartSignalCn0(canvas, track.currentEpoch?.svs);
                            tdFormated.appendChild(canvas);
                        }
                    } else if (field === 'posSV') {
                        tdFormated.className = "center";
                        if (def(track.currentEpoch?.svs)) {
                            const svg = this.chartSatellitePositions(track.currentEpoch.svs);
                            const wrapper = document.createElement("div");
                            wrapper.appendChild(svg);
                            wrapper.style.padding = "2px";
                            wrapper.style.width = svg.getAttribute("width") + "px";
                            wrapper.style.height = svg.getAttribute("height") + "px";
                            wrapper.style.display = "inline-block";  // prevents shrinkage
                            tdFormated.appendChild(wrapper);
                        }
                    } else if (field === 'resSV') {
                        tdFormated.className = "center";
                        if (def(track.currentEpoch?.svs)) {
                            const svg = this.chartSatelliteResiduals(track.currentEpoch.svs);
                            const wrapper = document.createElement("div");
                            wrapper.appendChild(svg);
                            wrapper.style.padding = "2px";
                            wrapper.style.width = svg.getAttribute("width") + "px";
                            wrapper.style.height = svg.getAttribute("height") + "px";
                            wrapper.style.display = "inline-block";  // prevents shrinkage
                            tdFormated.appendChild(wrapper);
                        }
                    } else {
                        tdFormated.className = "right";
                        if (def(track.currentEpoch?.fields?.[field])) {
                            const html = reg.formatHtml(track.currentEpoch.fields[field]);
                            tdFormated.appendChild(html);
                        }
                    }
                    tr.appendChild(tdFormated);
                });
                const tdUnit = document.createElement('td');
                tdUnit.innerHTML = reg.unit || '&nbsp;';
                tr.appendChild(tdUnit);
                tbody.appendChild(tr);
            }
        });
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
                datasets: [{ data: values, backgroundColor: colors }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                transitions: { active: { animation: false } },
                scales: {
                    x: { display: false },
                    y: {
                        display: true, min: 0, max: 55, step: 5,
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
                        callbacks: { label: (ctx) => `${ctx.parsed.y} dBHz` }
                    }
                }
            }
        });
    }

    chartSatellitePositions(svs) {
        const w = 100, h = 100;
        const c = { x: w / 2, y: h / 2 };
        const r = Math.min(w, h) / 2;
        const d = r / 15;
        const svg = d3.create("svg")
            .attr("width", w)
            .attr("height", h);

        // Radius mapping: elevation 90° (r=0), elevation 0°
        const rs = d3.scaleLinear()
            .domain([90, 0])
            .range([0, r]);

        // Draw el lines (every 30°)
        const elGrd = d3.range(0, 91, 30);
        elGrd.forEach(i => {
            svg.append("circle")
                .attr("class", "svGrid")
                .attr("cx", c.x)
                .attr("cy", c.y)
                .attr("r", rs(i))
                .attr("fill", "none")
        });

        // Draw azimuth lines every 45°
        const azGrd = d3.range(0, 360, 45);
        azGrd.forEach(i => {
            const rad = i * Math.PI / 180;
            svg.append("line")
                .attr("class", "svGrid")
                .attr("x1", c.x)
                .attr("y1", c.y)
                .attr("x2", c.x + r * Math.sin(rad))
                .attr("y2", c.y - r * Math.cos(rad));
        });

        Object.entries(svs).forEach(([sv, i]) => {
            if (def(i.az) && def(i.el)) {
                const rad = i.az * Math.PI / 180;
                const cnoTxt = [];
                if (typeof i.cno === 'object') {
                    Object.entries(i.cno).forEach(([sig, cno]) => {
                        if (0 < cno) cnoTxt.push(`<br>${sig}: ${cno} dBHz`);
                    });
                } else if (0 < i.cno) {
                    cnoTxt.push(`<br>C/N0: ${i.cno} dBHz`);
                }
                const color = i.used    ? 'rgba(0,200,0,0.8)' : 
                    (0 < cnoTxt.length) ? 'rgba(0,100,255,0.8)' : 
                                          'rgba(255,0,0,0.8)';
                svg.append("circle")
                    .attr("class", "svDot")
                    .attr("r", d)
                    .attr("fill", color)
                    .attr("cx", c.x + rs(i.el) * Math.sin(rad))
                    .attr("cy", c.y - rs(i.el) * Math.cos(rad))
                    .on("mouseover", (evt) => {
                        const hint = `<strong>${sv}</strong><br>Azimuth: ${i.az} degrees<br>Elevation: ${i.el} degrees${cnoTxt.join('')}`;
                        const tip = d3.select("body")
                            .append("div")
                            .attr("class", "svToolTip")
                            .html(hint)
                            .style("left", (evt.pageX + 10) + "px")
                            .style("top", (evt.pageY - 20) + "px");
                        // store the tooltip DOM node reference, not as an attribute
                        d3.select(evt.currentTarget).property("_tooltip", tip.node());
                    })
                    .on("mousemove", (evt) => {
                        const tip = d3.select(evt.currentTarget).property("_tooltip");
                        if (tip)
                            d3.select(tip)
                                .style("left", (evt.pageX + 10) + "px")
                                .style("top", (evt.pageY - 20) + "px");
                    })
                    .on("mouseout", (evt) => {
                        const tip = d3.select(evt.currentTarget).property("_tooltip");
                        if (tip) d3.select(tip).remove();
                        d3.select(evt.currentTarget).property("_tooltip", null);
                    });
            }
        });
        return svg.node();
    }

    chartSatelliteResiduals(svs) {
        const w = 100, h = 100;
        const c = { x: w / 2, y: h / 2 };
        const r = Math.min(w, h) / 2;
        const d = r / 15;
        const svg = d3.create("svg")
            .attr("width", w)
            .attr("height", h);

        const dec = 2
        // Draw res lines 0, 1, 10, 100
        const elGrd = d3.range(0, dec+1, 1);
        elGrd.forEach(i => {
            svg.append("circle")
                .attr("class", "svGrid")
                .attr("cx", c.x)
                .attr("cy", c.y)
                .attr("r", i * r / dec)
                .attr("fill", "none")
        });

        // Draw azimuth lines every °
        const azGrd = d3.range(0, 360, 45);
        azGrd.forEach(i => {
            const rad = i * Math.PI / 180;
            svg.append("line")
                .attr("class", "svGrid")
                .attr("x1", c.x)
                .attr("y1", c.y)
                .attr("x2", c.x + r * Math.sin(rad))
                .attr("y2", c.y - r * Math.cos(rad));
        });

        Object.entries(svs).forEach(([sv, i]) => {
            if (def(i.res) && def(i.az) && def(i.el) && (i.res !== 0)) {
                const colRes = (i.res < 0) ? 'rgba(0,0,255,0.8)' : 'rgba(255,0,0,0.8)';
                const rad = (i.res < 0 ? Math.PI : 0) + i.az * Math.PI / 180;
                const res = Number((Math.cos(i.el * Math.PI / 180) * i.res).toFixed(1));
                const resLog = Math.max(0, Math.min(dec, (1 + Math.log10(Math.abs(res))))) * r / dec;
                const color = i.used ? 'rgba(0,200,0,0.8)' : 'rgba(0,100,255,0.8)';
                const cx = c.x + resLog * Math.sin(rad);
                const cy = c.y - resLog * Math.cos(rad);
                svg.append("circle")
                    .attr("class", "svDot")
                    .attr("r", d)
                    .attr("fill", color)
                    .attr("cx", cx)
                    .attr("cy", cy)
                    .on("mouseover", (evt) => {
                        const hint = `<strong>${sv}</strong><br>Residual: ${i.res} m<br>Residual 2D: ${res} m<br>Azimuth: ${i.az} degrees<br>Elevation: ${i.el} degrees`;
                        const tip = d3.select("body")
                            .append("div")
                            .attr("class", "svToolTip")
                            .html(hint)
                            .style("left", (evt.pageX + 10) + "px")
                            .style("top", (evt.pageY - 20) + "px");
                        // store the tooltip DOM node reference, not as an attribute
                        d3.select(evt.currentTarget).property("_tooltip", tip.node());
                    })
                    .on("mousemove", (evt) => {
                        const tip = d3.select(evt.currentTarget).property("_tooltip");
                        if (tip)
                            d3.select(tip)
                                .style("left", (evt.pageX + 10) + "px")
                                .style("top", (evt.pageY - 20) + "px");
                    })
                    .on("mouseout", (evt) => {
                        const tip = d3.select(evt.currentTarget).property("_tooltip");
                        if (tip) d3.select(tip).remove();
                        d3.select(evt.currentTarget).property("_tooltip", null);
                    });
                svg.append("line")
                .attr("class", "svRes")
                .attr("stroke", colRes)
                .attr("x1", c.x)
                .attr("y1", c.x)
                .attr("x2", cx)
                .attr("y2", cy);
            }
        });
        return svg.node();
    }

    // ===== Save Restore API =====

    // ===== Internals =====

    // ===== Utils =====
    #emit(name, detail) {
        this.#container.dispatchEvent(new CustomEvent(name, { detail }));
    }

    #container
}
