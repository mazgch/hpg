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
                        tdFormated.className = "right";
                        if (def(track.currentEpoch?.svs)) {
                            const svg = this.chartSignalBars(track.currentEpoch.svs);
                            const wrapper = document.createElement("div");
                            wrapper.appendChild(svg);
                            wrapper.style.padding = "2px";
                            wrapper.style.width = svg.getAttribute("width") + "px";
                            wrapper.style.height = svg.getAttribute("height") + "px";
                            wrapper.style.display = "inline-block";  // prevents shrinkage
                            tdFormated.appendChild(wrapper);
                        }
                    } else if (field === 'posSV') {
                        tdFormated.className = "right";
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
                        tdFormated.className = "right";
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

    chartSignalBars(svs) {
        // --- Build dataset
        const list = [];
        let cnt = 0;
        Object.entries(svs).sort().forEach(([sv, svIt]) => {
            if (def(svIt.sigs)) {
                Object.entries(svIt.sigs).forEach(([sigId, sigIt]) => {
                    if (0 < sigIt.cno) {
                        cnt ++;
                    }
                });
            }
        });
        cnt = Math.max(12, cnt);
        // --- Dimensions
        const h = 55;
        const b = Math.max((100-1) / cnt, 1);
        const w = b * cnt + 1;
        
        // --- Create SVG
        const svg = d3.create("svg")
            .attr("width", w)
            .attr("height", h+1)
            .style("font-family", "sans-serif");

        // --- Scales
        const y = d3.scaleLinear()
            .domain([0, 55])
            .range([h, 0]);

        // --- Gridlines
        const yGrd= d3.range(0, h, 10);
        yGrd.forEach(i => {
            const g = y(i);
            svg.append("line")
                .attr("class", "svGrid")
                .attr("x1", 0)
                .attr("y1", g)
                .attr("x2", w)
                .attr("y2", g);
        });
        svg.append("line")
                .attr("class", "svGrid")
                .attr("x1", 0)
                .attr("y1", 0.5)
                .attr("x2", w)
                .attr("y2", 0.5);
        svg.append("line")
                .attr("class", "svGrid")
                .attr("x1", 0.5)
                .attr("y1", 0)
                .attr("x2", 0.5)
                .attr("y2", h);
        svg.append("line")
                .attr("class", "svGrid")
                .attr("x1", w-0.5)
                .attr("y1", 0)
                .attr("x2", w-0.5)
                .attr("y2", h);
        svg.selectAll(".domain").remove(); 
        let ix = 0;
        Object.entries(svs).sort(this.#sortKey).forEach(([sv, svIt]) => {
            if (def(svIt.sigs)) {
                Object.entries(svIt.sigs).sort().forEach(([sigId, sigIt]) => {
                    if (0 < sigIt.cno) {
                        svg.append("rect")
                            .attr("x", b * ix + 0.5)
                            .attr("y", d => y(sigIt.cno))
                            .attr("width", b - 0.5)
                            .attr("height", sigIt.cno)
                            .attr("fill", sigIt.used ? "rgba(0,200,0,0.8)" : "rgba(0,100,255,0.8)")
                            .on("mouseover", (evt) => {
                                const sigTxt = ((sigId !== '?') ? `<br>Signal: ${sigId}`: '');
                                const hint = `<strong>${sv}</strong>${sigTxt}<br>C/N0: ${sigIt.cno}`;
                                const tip = d3.select("body")
                                    .append("div")
                                    .attr("class", "svToolTip")
                                    .html(hint)
                                    .style("left", (evt.pageX + 10) + "px")
                                    .style("top", (evt.pageY - 20) + "px");
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
                        ix ++;
                    }
                });
            }
        });
        return svg.node();
    }

    chartSatellitePositions(svs) {
        const w = 100, h = 100, d = 3;
        const c = { x: w / 2, y: h / 2 };
        const r = Math.min(w, h) / 2 - d;
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

        Object.entries(svs).forEach(([sv, svIt]) => {
            if (def(svIt.az) && def(svIt.el) && def(svIt.sigs)) {
                const radAz = svIt.az * Math.PI / 180;
                const rsEl = rs(svIt.el); 
                const cnoTxt = [];
                let used = false;
                Object.entries(svIt.sigs).forEach(([sigId, sigIt]) => {
                    const sigTxt = ((sigId !== '?') ? ' ' + sigId : '');
                    if (0 < sigIt.cno) cnoTxt.push(`<br>C/N0:${sigTxt} ${sigIt.cno} dBHz `);
                    if (def(sigIt.used)) used ||= sigIt.used;
                });
                const color = used      ? 'rgba(0,200,0,0.8)' : 
                    (0 < cnoTxt.length) ? 'rgba(0,100,255,0.8)' : 
                                          'rgba(255,0,0,0.8)';
                const hint = `<strong>${sv}</strong><br>Azimuth: ${svIt.az} degrees<br>Elevation: ${svIt.el} degrees${cnoTxt.join('')}`;
                svg.append("circle")
                    .attr("r", d)
                    .attr("fill", color)
                    .attr("cx", c.x + rsEl * Math.sin(radAz))
                    .attr("cy", c.y - rsEl * Math.cos(radAz))
                    .on("mouseover", (evt) => this.tooltipMouseOver(evt, hint))
                    .on("mousemove", (evt) => this.tooltipMouseMove(evt))
                    .on("mouseout", (evt) => this.tooltipMouseOut(evt));
            }
        });
        return svg.node();
    }

    tooltipMouseOver(evt, hint) {
        const tip = d3.select("body")
            .append("div")
            .attr("class", "svToolTip")
            .html(typeof hint === "function" ? hint(evt) : hint)
            .style("left", (evt.pageX + 10) + "px")
            .style("top",  (evt.pageY - 20) + "px");

        d3.select(evt.currentTarget).property("_tooltip", tip.node());
    }

    tooltipMouseMove(evt) {
        const tip = d3.select(evt.currentTarget).property("_tooltip");
        if (tip) d3.select(tip)
            .style("left", (evt.pageX + 10) + "px")
            .style("top",  (evt.pageY - 20) + "px");
    }

    tooltipMouseOut(evt) {
        const tip = d3.select(evt.currentTarget).property("_tooltip");
        if (tip) 
            d3.select(tip).remove();
        d3.select(evt.currentTarget).property("_tooltip", null);
    }

    chartSatelliteResiduals(svs) {
        const w = 100, h = 100, d = 3;
        const c = { x: w / 2, y: h / 2 };
        const r = Math.min(w, h) / 2 - d;
        const svg = d3.create("svg")
            .attr("width", w)
            .attr("height", h);

        const dec = 3
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

        Object.entries(svs).forEach(([sv, svIt]) => {
            if (def(svIt.az) && def(svIt.el) && (0 <= svIt.el) && def(svIt.sigs)) {
                const radAz = (svIt.res < 0 ? Math.PI : 0) + svIt.az * Math.PI / 180;
                const sinAz = Math.sin(radAz);
                const cosAz = Math.cos(radAz);
                const cosEl = Math.cos(svIt.el * Math.PI / 180);
                Object.entries(svIt.sigs).forEach(([sigId, sigIt]) => {
                    if (def(sigIt.res)) {
                        const colRes = (sigIt.res < 0) ? 'rgba(0,0,255,0.8)' : 'rgba(255,0,0,0.8)';
                        const res = Number((cosEl * sigIt.res).toFixed(1));
                        const resLog = Math.max(0, Math.min(dec, (1 + Math.log10(Math.abs(res))))) * r / dec;
                        const color = sigIt.used ? 'rgba(0,200,0,0.8)' : 'rgba(0,100,255,0.8)';
                        const cx = c.x + resLog * sinAz;
                        const cy = c.y - resLog * cosAz;
                        const sigTxt = ((sigId !== '?') ? `<br>Signal: ${sigId}`: '');
                        let hint = `<strong>${sv}</strong>${sigTxt}<br>Residual: ${sigIt.res} m<br>Residual 2D proj.: ${res} m`;
                        if (def(svIt.az) && def(svIt.el)) {
                            hint += `<br>Azimuth: ${svIt.az} degrees<br>Elevation: ${svIt.el} degrees`;
                        }
                        if (sigIt.cno) {
                            hint += `<br>C/N0: ${sigIt.cno} dBHz`;
                        }
                        svg.append("circle")
                            .attr("r", d)
                            .attr("fill", color)
                            .attr("cx", cx)
                            .attr("cy", cy)
                            .on("mouseover", (evt) => this.tooltipMouseOver(evt, hint))
                            .on("mousemove", (evt) => this.tooltipMouseMove(evt))
                            .on("mouseout", (evt) => this.tooltipMouseOut(evt));
                        svg.append("line")
                            .attr("class", "svRes")
                            .attr("stroke", colRes)
                            .attr("x1", c.x)
                            .attr("y1", c.x)
                            .attr("x2", cx)
                            .attr("y2", cy);
                    }
                });
            }
        });
        return svg.node();
    }

    // ===== Save Restore API =====

    // ===== Internals =====

    #sortKey([a], [b]) {
        const mA = a.match(/^([A-Z])(\d+|\?)$/);
        const mB = b.match(/^([A-Z])(\d+|\?)$/);
        if (!def(mA)) return  1;
        if (!def(mB)) return -1;
        if (mA[1] !== mB[1]) {
            return mA[1].localeCompare(mB[1]);
        } else if (!isNaN(mA[2]) && !isNaN(mB[2])) {
            return Number(mA[2]) - Number(mB[2]);
        } else {
            return mA[2].localeCompare(mB[2]);
        }
    }

    // ===== Utils =====
    #emit(name, detail) {
        this.#container.dispatchEvent(new CustomEvent(name, { detail }));
    }

    #container
}
