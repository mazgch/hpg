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
import { def, formatDateTime, setAlpha, log } from '../core/utils.js';
import { Statistics } from '../core/statistics.js';

export class ChartView {
    constructor(container, fieldSelect, modeSelect) {
        this.#container = container;
        this.#container.addEventListener('mouseout', (evt) => this.#updateAnnotation(evt));
    
        const chartModeButtons = document.querySelectorAll("#chart_modes .overlay_button");
        chartModeButtons.forEach(radio => {
            radio.addEventListener("click", (evt) => {
                evt.stopPropagation();
                evt.preventDefault();
                chartModeButtons.forEach(r => r.classList.remove("selected"));
                radio.classList.add("selected");
                modeSelect.value = radio.getAttribute("value");
                this.configChange();
            });
        });

        this.#fieldSelect = fieldSelect;
        fieldSelect.addEventListener("change", (evt) => this.configChange() );
        Track.EPOCH_FIELDS.filter((field) => (!ChartView.FIELDS_HIDDEN.includes(field)) ).forEach( (field) => {
            const option = document.createElement("option");
            option.textContent = FieldsReg[field]?.name || field;
            option.value = field;
            fieldSelect.appendChild(option);
        })
        fieldSelect.value = 'msl';
        
        this.#modeSelect = modeSelect;
        modeSelect.addEventListener("change", (evt) => {
            const mode = this.#modeSelect.value;
            chartModeButtons.forEach(r => r.classList.remove("selected"));
            const radio = Array.from(chartModeButtons)
                .find(r => (r.getAttribute("value") === mode));
            radio.classList.add("selected");
            this.configChange();
        });
            
    
        this.chart = new Chart(container, {
            type: 'scatter',
            data: { datasets: [] },
            options: {
                onHover: (evt, active) => this.#updateAnnotation(evt, active),
                onLeave: (evt, active) => this.#updateAnnotation(evt, active),
                onClick: (evt) => this.#chartOnClick(evt),
                responsive: true, maintainAspectRatio: false, animation: false,
                interaction: { intersect: false, mode: 'nearest' },
                layout: {  padding: { left: 10, right: 10 + 10 + 24, top: 10, bottom: 10 } },
                transitions: { active: { animation: { duration: 0 } }, resize: { animation: { duration: 0 } }  },
                scales: {
                    y: {
                        type: 'linear',
                        title: { display: true },
                        ticks: { font: { size: 10 }, maxRotation: 0, autoSkipPadding: 10, beginAtZero: false }
                    },
                    x: {
                        type: 'linear',
                        title: { display: true, },
                        ticks: { font: { size: 10 }, maxRotation: 0, autoSkipPadding: 10, beginAtZero: false }
                    }
                },
                plugins: {
                    annotation: { annotations: {} },
                    legend: {
                        enabled: true,
                        labels: {
                            boxWidth: 20, boxHeight: 0,
                            filter: (legendItem) => (!legendItem.hidden),
                            generateLabels: (chart) => this.#generateLabels(chart)
                        },
                        onClick: (evt) => evt.stopPropagation()
                    },
                    tooltip: {
                        usePointStyle: false, displayColors: false,
                        backgroundColor: 'rgba(245,245,245,0.8)',
                        bodyColor: '#000', bodyFont: { size: 10 },
                        borderColor: '#888', borderWidth: 1, cornerRadius: 0,
                        callbacks: { label: (ctx) => this.#toolTipTitle(ctx), afterLabel: (ctx) => this.#toolTipText(ctx) }
                    },
                    zoom: {
                        pan: { enabled: true, mode: 'xy' },
                        zoom: {
                            mode: 'xy',
                            pinch: { enabled: true },
                            wheel: { enabled: true, modifierKey: 'shift' },
                            drag: { enabled: true, modifierKey: 'shift', borderWidth: 2 }
                        }
                    }
                }
            }
        });
        this.configChange(); // initial change
    }

    // ===== Public API =====

    addDataset(track) {
        const chart = this.chart;
        log(`ChartView add`, track.name);
        const dataset = {
            track: track,
            data: [],
            hidden: true, 
            showLine: true,
            spanGaps: false,
            borderCapStyle: 'round', 
            borderJoinStyle: 'bevel',
            borderWidth: ChartView.LINE_WIDTH, 
            borderColor: (ctx) => this.#datasetColor(ctx), 
            pointRadius: 0, 
            pointBorderWidth: 0, 
            pointHoverRadius: ChartView.HOVER_RADIUS, 
            pointHoverBorderWidth: 1,
            pointHoverBorderColor: (ctx) => this.#pointColor(ctx),
            pointHoverBackgroundColor: (ctx) => this.#pointBackgroundColor(ctx),
        };
        chart.data.datasets.push(dataset);
        track.dataset = dataset;
        this.updateDataset(track);
    }

    removeDataset(track) {
        const dataset = track.dataset;
        if (dataset) {
            const chart = this.chart;
            log('ChartView remove', track.name);
            const ix = chart.data.datasets.indexOf(dataset);
            if (ix !== -1) {
                chart.data.datasets.splice(ix, 1);
            }
            delete track.dataset;
            this.#update();
        }
    }

    updateDataset(track) {
        const dataset = track.dataset;
        if (dataset) {
            this.calcDataset(dataset);
            this.#updateAnnotation();
            this.resetZoom();
            this.#update();
        }
    }

    setTime(datetime) {
        const chart = this.chart;
        const mode = this.#modeSelect.value;
        if (ChartView.CHARTS_TIME.includes(mode)) {
            chart.options.plugins.annotation.annotations.time =  this.#timeAnnotation(datetime);
            this.#update();
        }
    }

    setField(field) {
        const select = this.#fieldSelect;
        const options = Array.from(select.options);
        const value = options.find((opt) => (opt.value === field))?.value;
        if (def(value)) {
            select.value = value;
        }
    }

    setMode(mode) {
        const select = this.#modeSelect;
        const options = Array.from(select.options);
        const value = options.find((opt) => (opt.value === mode))?.value;
        if (def(value)) {
            select.value = value;
        }
    }

    configChange() {
        const chart = this.chart;
        // update the data from epoch
        const field = this.#fieldSelect.value;
        const mode = this.#modeSelect.value;
        const defField = FieldsReg[field];
        const axisName = defField.name + def(defField.unit) ? (' [' + defField.unit + ']') : '';
        const category = def(defField.map) ? Object.keys(defField.map) : undefined;

        if (ChartView.CHARTS_TIME.includes(mode)) {
            chart.options.scales.x.title.text = 'Time UTC';
            chart.options.scales.x.ticks.callback = formatDateTime;
            chart.options.scales.x.ticks.maxTicksLimit = 8;
            chart.options.scales.x.ticks.autoSkip = true;
            chart.options.scales.x.ticks.stepSize = undefined;

            chart.options.scales.y.title.text = ((mode !== ChartView.CHART_TIMESERIES) ? `${mode} ${axisName}` : '');
            chart.options.scales.y.ticks.callback = _fmtVal;
            chart.options.scales.y.ticks.maxTicksLimit = category ? category.length : undefined;
            chart.options.scales.y.ticks.autoSkip = category ? false : true;
            chart.options.scales.y.ticks.stepSize = category ? 1 : undefined;
        } else if (ChartView.CHARTS_DIST.includes(mode)) {
            chart.options.scales.x.title.text = axisName;
            chart.options.scales.x.ticks.callback = _fmtVal;
            chart.options.scales.x.ticks.maxTicksLimit = category ? category.length : undefined;
            chart.options.scales.x.ticks.autoSkip = category ? false : true;
            chart.options.scales.x.ticks.stepSize = category ? 1 : undefined;

            chart.options.scales.y.title.text = (mode === ChartView.CHART_CDF) ? 'Cumulative density' : 'Density';
            chart.options.scales.y.ticks.callback = (v) => Number(v.toFixed(5));
            chart.options.scales.y.ticks.maxTicksLimit = undefined;
            chart.options.scales.y.ticks.autoSkip = true;
            chart.options.scales.y.ticks.stepSize = undefined;
        } else if (ChartView.CHARTS_FREQ.includes(mode)) {
            chart.options.scales.x.title.text = "Frequency Hz";
            chart.options.scales.x.ticks.callback = (v) => Number(v.toFixed(7));
            chart.options.scales.x.ticks.maxTicksLimit = undefined;
            chart.options.scales.x.ticks.autoSkip = true;
            chart.options.scales.x.ticks.stepSize = undefined;

            chart.options.scales.y.title.text = (mode === ChartView.CHART_FFT_DB) ? 'Amplitude dB' : 'Amplitude';
            chart.options.scales.y.ticks.callback = (v) => Number(v.toFixed(7));
            chart.options.scales.y.ticks.maxTicksLimit = undefined;
            chart.options.scales.y.ticks.autoSkip = true;
            chart.options.scales.y.ticks.stepSize = undefined;
        }

        if (0 < chart.data.datasets.length) {
            chart.data.datasets.forEach((dataset) => 
                this.calcDataset(dataset)
            );
            this.#updateAnnotation();
            this.resetZoom();
            this.#update();
        }
   
        function _fmtVal(v) {
            return category ? category[Math.round(v)] : defField.format(v);
        }
    }

    resetZoom() {
        const chart = this.chart;
        // find the bounds 
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        chart.data.datasets
            .filter((dataset) => (!dataset.hidden))
            .forEach((dataset) => {
                dataset.data.forEach((row) => {
                    if (Number.isFinite(row.x)) {
                        minX = Math.min(minX, row.x);
                        maxX = Math.max(maxX, row.x);
                    }
                    if (Number.isFinite(row.y)) {
                        minY = Math.min(minY, row.y);
                        maxY = Math.max(maxY, row.y);
                    }
                })
            });
        // category fields are fixed
        const field = this.#fieldSelect.value;
        const mode = this.#modeSelect.value;
        const defField = FieldsReg[field];
        if (defField.map) {
            // make it fixed size
            if (ChartView.CHARTS_TIME.includes(mode)) {
                minY = 0;
                maxY = Object.keys(defField.map).length - 1;
            } else {
                minX = 0;
                maxX = Object.keys(defField.map).length - 1;
            }
        }
        if (!ChartView.CHARTS_TIME.includes(mode)) {
            if (mode !== ChartView.CHART_FFT_DB)  {
                minY = 0;
            }
            if (mode === ChartView.CHART_CDF) {
                maxY = 1;
            }
        }
        // now reset the zoom plugin 
        chart.resetZoom();
        // set new scales
        chart.options.scales.x.min = Number.isFinite(minX) ? minX : undefined;
        chart.options.scales.x.max = Number.isFinite(maxX) ? maxX : undefined;
        chart.options.scales.y.min = Number.isFinite(minY) ? minY : undefined;
        chart.options.scales.y.max = Number.isFinite(maxY) ? maxY : undefined;
    }

    // ===== Save Restore API =====

    fromJson(json) {
        (typeof json.field === 'string') && this.setField(json.field);
        (typeof json.mode === 'string') && this.setMode(json.mode);
        this.configChange();
    }

    toJson(json) {
        json.field = this.#fieldSelect.value;
        json.mode = this.#modeSelect.value;
    }

    // ===== Internals =====

    #chartOnClick(evt) {
        const chart = evt.chart;
        const elems = chart.getElementsAtEventForMode(evt, "nearest", { intersect: false });
        if (0 < elems.length) {
            const pt = elems[0];
            const dataset = chart.data.datasets[pt.datasetIndex];
            const epoch = dataset.data[pt.index].epoch;
            this.#emit('epoch', epoch);
        }
    }

    calcDataset(dataset) {
        const chart = this.chart;
        // update the data from epoch
        const field = this.#fieldSelect.value;
        const mode = this.#modeSelect.value;
        const defField = FieldsReg[field];
        const category = def(defField.map) ? Object.keys(defField.map) : undefined;
        // created the chart data
        let c = 0;
        let l;
        const track = dataset.track;
        log('ChartView calc', track.name);
        let data = track.epochs
            .filter((epoch) => (epoch.selTime))
            .map((epoch) => {
                let v = epoch.fields[field];
                if (epoch.timeValid && ((track.mode === Track.MODE_ANYFIX) || epoch.fixGood) && def(v)) {
                    if (category) {
                        v = category.indexOf(`${v}`);
                        v = (0 <= v) ? v : null;
                    }
                    c += v;
                    const d = Number.isFinite(l) ? (v - l) : null;
                    l = v;
                    let y = (mode === ChartView.CHART_CUMULATIVE) ? (category ? null : Number(defField.format(c))) :
                            (mode === ChartView.CHART_DERIVATIVE) ? (category ? null : Number(defField.format(d))) : v;
                    //y = Number.isFinite(y) ? defField.format(y) : y;
                    return { x: epoch.datetime, y: y, epoch: epoch };
                } else {
                    l = undefined;
                    return { x: null, y: null, epoch: epoch };
                }
            });

        const valsFilt = data.filter((row) => Number.isFinite(row.y));
        const vals = valsFilt.map((row) => (row.y));
        dataset.stats = new Statistics(vals);
        if (!ChartView.CHARTS_TIME.includes(mode)) {
            // convert to cdf or histogram and calc median and quantiles 
            if (category) {
                if (mode === ChartView.CHART_HISTOGRAM) {
                    data = dataset.stats.histogram2();
                } else {
                    data = [];
                }
                data = data.map((row) => {
                    return {
                        x: row.x,
                        y: chart.options.scales.y.ticks.callback(row.y)
                    }
                });
            } else {
                if (mode === ChartView.CHART_CDF) {
                    data = dataset.stats.cdf(512);
                } else if (mode === ChartView.CHART_HISTOGRAM) {
                    data = dataset.stats.histogram(512);
                } else if (mode === ChartView.CHART_HISTOGRAM_FD) {
                    data = dataset.stats.histogram(/*freedmanDiaconis*/);
                } else if (mode === ChartView.CHART_KDE) {
                    data = dataset.stats.kde(/*silvermanBandwidth*/);
                } else if ((mode === ChartView.CHART_FFT) || 
                           (mode === ChartView.CHART_FFT_DB)) {
                    const times = valsFilt.map((row) => (row.x/1000)); // get matching times
                    data = dataset.stats.fft(times, { linear:(mode === ChartView.CHART_FFT) });
                } else {
                    data = [];
                }
                data = data.map((row) => {
                    return {
                        x: chart.options.scales.x.ticks.callback(row.x),
                        y: chart.options.scales.y.ticks.callback(row.y)
                    }
                });
            }
        }
        dataset.hidden = (0 === data.length) || (track.mode === Track.MODE_HIDDEN);
        dataset.data.length = 0;
        if (data.length) {
            dataset.data.push.apply(dataset.data, data);
        }
    }

    #updateAnnotation(evt, active) {
        const chart = this.chart;
        if (chart) {
            const mode = this.#modeSelect.value;
            let annotations = {};
            if (!ChartView.CHARTS_FREQ.includes(mode)) {
                if (mode === ChartView.CHART_CDF) {
                    const color = ChartView.COLOR_GRAY;
                    annotations.y50 = ChartView.#annotation('y', 0.500, color, '0.5');
                    annotations.y68 = ChartView.#annotation('y', 0.680, color, '0.68');
                    annotations.y95 = ChartView.#annotation('y', 0.950, color, '0.95');
                    annotations.y99 = ChartView.#annotation('y', 0.997, color, '0.997');
                }
                const datetime = chart.options.plugins.annotation.annotations?.time?.xMax;
                if (def(datetime)) {
                    annotations.time = this.#timeAnnotation(datetime);
                }
                if (active && (0 < active.length)) {
                    const axis = ChartView.CHARTS_TIME.includes(mode) ? 'y' : 'x';
                    const index = active[0].datasetIndex;
                    const dataset = chart.data.datasets[index];
                    if (!dataset.hidden) {
                        const color = dataset.track.color();
                        const _fmt = chart.options.scales[axis].ticks.callback;
                        if (mode === ChartView.CHART_CDF) {
                            if (def(dataset.stats.q50)) annotations.q50 = ChartView.#annotation(axis, dataset.stats.q50, color, `x̃ = ${_fmt(dataset.stats.q50)}`);
                            if (def(dataset.stats.q68)) annotations.q68 = ChartView.#annotation(axis, dataset.stats.q68, color, `Q68 = ${_fmt(dataset.stats.q68)}`);
                            if (def(dataset.stats.q95)) annotations.q95 = ChartView.#annotation(axis, dataset.stats.q95, color, `Q95 = ${_fmt(dataset.stats.q95)}`);
                            if (def(dataset.stats.q99)) annotations.q99 = ChartView.#annotation(axis, dataset.stats.q99, color, `Q99.7 = ${_fmt(dataset.stats.q99)}`);
                        } else {
                            if (def(dataset.stats.min)) annotations.min = ChartView.#annotation(axis, dataset.stats.min, color, `min = ${_fmt(dataset.stats.min)}`);
                            if (def(dataset.stats.max)) annotations.max = ChartView.#annotation(axis, dataset.stats.max, color, `max = ${_fmt(dataset.stats.max)}`);
                            if (def(dataset.stats.mean)) {
                                const field = this.#fieldSelect.value;
                                const defField = FieldsReg[field];
                                if (!def(defField.map)) {
                                    annotations.mean = ChartView.#annotation(axis, dataset.stats.mean, color, `μ = ${_fmt(dataset.stats.mean)}`);
                                    if (def(dataset.stats.sigma)) {
                                        const mps = dataset.stats.mean + dataset.stats.sigma;
                                        annotations.plus = ChartView.#annotation(axis, mps, color, `μ+σ = ${_fmt(mps)}`);
                                        const mms = dataset.stats.mean - dataset.stats.sigma;
                                        annotations.minus = ChartView.#annotation(axis, mms, color, `μ-σ = ${_fmt(mms)}`);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            chart.options.plugins.annotation.annotations = annotations;
            this.#update();
        }
    }

    #timeAnnotation(datetime) {
        return ChartView.#annotation('x', datetime, ChartView.COLOR_TIME);
    }

    #datasetColor(ctx) {
        return ctx.dataset.track?.color();
    }

    #pointColor(ctx) {
        const dataset = ctx.dataset;
        const epochColor = dataset.data[ctx.dataIndex]?.epoch?.color;
        return epochColor || this.#datasetColor(ctx);
    }

    #pointBackgroundColor(ctx) {
        const color = this.#pointColor(ctx);
        return setAlpha(color, 0.8);
    }

    #generateLabels(chart) {
        return chart.data.datasets.map((dataset, ix) => {
            const track = dataset.track;
            const color = track.color();
            return {
                text: track.name,
                fillStyle: color,
                strokeStyle: color,
                lineWidth: ChartView.LINE_WIDTH,
                hidden: dataset.hidden,
                datasetIndex: ix
            };
        });
    }

    #update() {
        try {
            this.chart.update();
        } catch (err) {
            console.error('ChartView update',err);
        }
    }

    static #annotation(axis, val, color, label) {
        const annotation = { type: Track.MODE_LINE, borderColor: color, borderWidth: 1, borderDash: [6, 6] };
        if (axis === 'x') {
            annotation.xMin = annotation.xMax = val;
        } else {
            annotation.yMin = annotation.yMax = val;
        }
        if (label) {
            const position = (axis === 'y') ? 'start' : 'end';
            const rotation = (axis === 'x') ? -90 : 0;
            annotation.label = {
                padding: 2, display: true, content: label||'', position: position,
                textStrokeColor: '#ffffffff', textStrokeWidth: 5, font: { weight: 'nomal' },
                backgroundColor: '#00000000', color: color, rotation: rotation
            };
        }
        return annotation;
    }

    #toolTipTitle(ctx) {
        return ctx.dataset.track.name;
    }

    #toolTipText(ctx) {
        const mode = this.#modeSelect.value;
        const field = this.#fieldSelect.value
        const defField = FieldsReg[field];
        const unit = (defField.unit ? ' ' + defField.unit : '')
        const category = defField.map ? Object.keys(defField.map) : undefined;
        if (ChartView.CHARTS_TIME.includes(mode)) {
            const txtX = ctx.chart.options.scales.x.title.text;
            const txtY = defField.name;
            const valX = ctx.chart.options.scales.x.ticks.callback(ctx.raw.x);
            const valY = (category ? category[ctx.raw.y] : ctx.raw.y) + unit;
            return `${txtY}: ${valY}\n${txtX}: ${valX}`;
        } else if (ChartView.CHARTS_DIST.includes(mode)) {
            const txtX = defField.name;
            const txtY = ctx.chart.options.scales.y.title.text;
            const valX = (category ? category[ctx.raw.x] : ctx.raw.x) + unit;
            const valY = ctx.chart.options.scales.y.ticks.callback(ctx.raw.y);
            return `${txtY}: ${valY}\n${txtX}: ${valX}`;
        } else if (ChartView.CHARTS_FREQ.includes(mode)){
            const valX = ctx.chart.options.scales.x.ticks.callback(ctx.raw.x);
            const valY = ctx.chart.options.scales.y.ticks.callback(ctx.raw.y);
            const unit = (mode === ChartView.CHART_FFT) ? '' : ' dB';
            return `Amplitude: ${valY}${unit}\nFrequency: ${valX} Hz`;
        }
    }

    #emit(name, detail) {
        this.#container.dispatchEvent(new CustomEvent(name, { detail }));
    }

    static FIELDS_HIDDEN       = ['time','date','itow'];
        
    static CHART_TIMESERIES    = 'Time series';
    static CHART_CUMULATIVE    = 'Cumulative';
    static CHART_DERIVATIVE    = 'Derivative';
    static CHART_CDF           = 'CDF';
    static CHART_HISTOGRAM     = 'Histogram';
    static CHART_HISTOGRAM_FD  = 'Histogram (FD)';
    static CHART_KDE           = 'Kernel density';
    static CHART_FFT           = 'Fourier';
    static CHART_FFT_DB        = 'Fourier (dB)';

    static CHARTS_TIME = [ 
        ChartView.CHART_TIMESERIES, 
        ChartView.CHART_CUMULATIVE, ChartView.CHART_DERIVATIVE 
    ];
    static CHARTS_DIST = [ 
        ChartView.CHART_CDF,        ChartView.CHART_KDE,
        ChartView.CHART_HISTOGRAM,  ChartView.CHART_HISTOGRAM_FD 
    ];
    static CHARTS_FREQ = [ 
        ChartView.CHART_FFT,        ChartView.CHART_FFT_DB 
    ];
    
    static LINE_WIDTH   = 2;
    static HOVER_RADIUS = 5;
    static COLOR_TIME   = '#ff4c00';
    static COLOR_GRAY   = '#808080';

    #container
    #fieldSelect
    #modeSelect
}
