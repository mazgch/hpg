
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

export class Statistics {
    constructor(data) {
        this.#data = data.sort((a, b) => (a - b));
        this.length = this.#data.length;
        this.min = this.#data[0];
        this.max = this.#data[this.length - 1];
        this.range = this.max - this.min;
        const mean = this.mean = this.#data.reduce((a, b) => (a + b), 0) / this.length;
        const variance = this.variance = this.#data.reduce((s, x) => (s + (x - mean) ** 2), 0) / (this.length - 1 || 1);
        this.sigma = Math.sqrt(variance);
        this.q25 = this.#quantile(0.25);
        this.q50 = this.#quantile(0.50); // median
        this.q68 = this.#quantile(0.68);
        this.q75 = this.#quantile(0.75);
        this.q95 = this.#quantile(0.95);
        this.q99 = this.#quantile(0.997);
    }

    // --- Build {x, y} kernel density histogram
    kde(bandWidth = this.#silvermanBandwidth, gridN = 512) {
        const n = this.length;
        if (n === 0) return [];
        // grid with padding
        const ofs = 0; // gridN / 8;
        const L = gridN + 2 * ofs;
        const xGrid = new Float64Array(L);
        for (let i = 0; i < L; i++) {
            xGrid[i] = this.min + ((i - ofs) * this.range) / (gridN - 1);
        }
        const h = (typeof bandWidth === 'function') ? bandWidth.call(this) : bandWidth;
        const invNh = 1 / (n * h);
        const data = this.#data; // avoid property lookup in inner loop
        const y = new Float64Array(L);
        for (let i = 0; i < L; i++) {
            const x = xGrid[i];
            let sum = 0;
            for (let j = 0; j < n; j++) {
                sum += this.#gaussian((x - data[j]) / h);
            }
            y[i] = sum * invNh;
        }
        // build object output (must be plain array)
        const out = new Array(L);
        for (let i = 0; i < L; i++) out[i] = { x: xGrid[i], y: y[i] };
        return out;
    }

    kdeAdaptive(bandWidth = this.#silvermanBandwidth, gridN = 512, alpha = 0.5) {
        const n = this.length;
        if (n === 0) return [];
        const ofs = 0; // gridN / 8;
        const L = gridN;
        const xGrid = new Float64Array(L);
        for (let i = 0; i < L; i++) {
            xGrid[i] = this.min + ((i - ofs) * this.range) / (gridN - 1);
        }
        const data = this.#data;
        const hPilot = (typeof bandWidth === 'function') ? bandWidth.call(this) : bandWidth;
        // pilot density at sample points
        const pilotAtXi = new Float64Array(n);
        const invNh = 1 / (n * hPilot);
        for (let i = 0; i < n; i++) {
            const xi = data[i];
            let s = 0;
            for (let j = 0; j < n; j++) {
                s += this.#gaussian((xi - data[j]) / hPilot);
            }
            pilotAtXi[i] = Math.max(s * invNh, 1e-12);
        }
        // local bandwidths
        let logSum = 0;
        for (let i = 0; i < n; i++) logSum += Math.log(pilotAtXi[i]);
        const geomMean = Math.exp(logSum / n);
        const hi = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            hi[i] = hPilot * Math.pow(pilotAtXi[i] / geomMean, -alpha);
        }
        // evaluate adaptive KDE
        const y = new Float64Array(L);
        for (let i = 0; i < L; i++) {
            const x = xGrid[i];
            let s = 0;
            for (let j = 0; j < n; j++) {
                const hij = hi[j];
                s += this.#gaussian((x - data[j]) / hij) / hij;
            }
            y[i] = s / n;
        }
        // build object output
        const out = new Array(L);
        for (let i = 0; i < L; i++) out[i] = { x: xGrid[i], y: y[i] };
        return out;
    }

    // --- Build {x, y} density histogram using FD bins
    histogram(numBins = this.#freedmanDiaconis, maxBinN = 512) {
        const n = this.length;
        if (n === 0) return [];
        const min = this.min;
        const range = this.range;
        // If all values are equal (range==0): single spike
        if (!(range > 0)) return [{ x: min, y: 1 }];
        // Resolve bin count
        const k = (typeof numBins === "function") ? numBins.call(this) : numBins;
        const nBins = Math.max(1, Math.min(Math.ceil(k), maxBinN));
        const binWidth = range / nBins;
        const data = this.#data;
        // Counts (zeros by default)
        const counts = new Uint32Array(nBins);
        // Fill counts (clamped, include max in last bin)
        for (let j = 0; j < n; j++) {
            const v = data[j];
            let idx = Math.floor((v - min) / binWidth);
            if (idx < 0) idx = 0;
            else if (idx >= nBins) idx = nBins - 1;
            counts[idx]++;
        }
        // Build {x, y} density; avoid push in loop
        const out = new Array(nBins);
        const invNw = 1 / n;
        for (let i = 0; i < nBins; i++) {
            out[i] = {
                x: min + (i + 0.5) * binWidth,
                y: counts[i] * invNw
            };
        }
        return out;
    }

    histogram2() {
        const n = this.length;
        if (n === 0) return [];
        const data = this.#data;
        let x = data[0];
        let c = 1;
        const out = new Array();
        for (let i = 1; i < n; i++) {
            const d = data[i];
            if (x === d) {
                c++;
            } else {
                out.push({ x:x, y:c/n});
                x = d;
                c = 1;
            }
        }
        out.push({ x:x, y:c/n });
        return out;
    }
    
    cdf2() {
        const n = this.length;
        if (n === 0) return [];
        const data = this.#data;
        let x = data[0];
        let c = 1;
        let y = 0;
        const out = new Array();
        out.push({ x:x, y:y });
        for (let i = 1; i < n; i++) {
            const d = data[i];
            if (x === d) {
                c++;
            } else {
                y = c/n;
                out.push({ x:x, y:y });
                out.push({ x:d, y:y });
                x = d;
            }
        }
        out.push({ x:x, y:c/n });
        return out;
    }

    cdf(numBins = this.#freedmanDiaconis, maxBinN = 512) {
        const n = this.length;
        if (n === 0) return [];
        const min = this.min;
        const range = this.range;
        // If all values are equal (range==0): single spike
        if (!(range > 0)) return [{ x: min, y: 1 }];
        // Resolve bin count
        const k = (typeof numBins === "function") ? numBins.call(this) : numBins;
        const nBins = Math.max(1, Math.min(Math.ceil(k), maxBinN));
        const binWidth = range / nBins;
        const data = this.#data;
        // Counts (zeros by default)
        const counts = new Uint32Array(nBins);
        // Fill counts (clamped, include max in last bin)
        for (let j = 0; j < n; j++) {
            const v = data[j];
            let idx = Math.floor((v - min) / binWidth);
            if (idx < 0) idx = 0;
            else if (idx >= nBins) idx = nBins - 1;
            counts[idx]++;
        }
        // Build {x, y} density; avoid push in loop
        let sum = 0;
        const out = new Array(nBins);
        const invNw = 1 / n;
        for (let i = 0; i < nBins; i++) {
            sum += counts[i];
            out[i] = {
                x: min + (i + 0.5) * binWidth,
                y: sum * invNw
            };
        }
        return out;
    }


    fft(ts, opt = {}) {
        const data = this.#data; 
        const mu = this.mean;
        const xs = data.map(y => y - mu); 
        if ((ts.length < 4) || (0 === this.range)) return [];
        // effective Nyquist via median dt
        const dts = [];
        for (let i = 1; i < ts.length; i++) {
            dts.push(ts[i] - ts[i - 1]);
        }
        dts.sort((a, b) => a - b);
        const dt = dts[Math.floor(dts.length / 2)] || (ts.at(-1) - ts[0]) / (ts.length - 1);
        const fNy = 0.5 / (dt || 1);
        const nfreq = opt.nfreq || Math.min(2048, Math.ceil(5 * xs.length));
        const fmax = opt.fmax ?? fNy;
        const fmin = opt.fmin ?? 0;
        const freq = new Float64Array(nfreq);
        for (let k = 0; k < nfreq; k++) {
            freq[k] = fmin + (fmax - fmin) * k / (nfreq - 1 || 1);
        }
        // normalized LS -> amplitude-like
        const amp = new Float64Array(nfreq);
        const varx = xs.reduce((s, v) => s + v * v, 0);
        const twoPI = 2 * Math.PI;
        for (let k = 0; k < nfreq; k++) {
            const w = twoPI * freq[k];
            // tau per Scargle
            let c2wt = 0, s2wt = 0;
            for (let i = 0; i < ts.length; i++) { 
                const a = 2 * w * ts[i]; 
                c2wt += Math.cos(a); 
                s2wt += Math.sin(a); 
            }
            const tau = (w === 0) ? 0 : 0.5 * Math.atan2(s2wt, c2wt) / w;
            let xc = 0, xs_ = 0, cc = 0, ss = 0;
            for (let i = 0; i < ts.length; i++) {
                const wt = w * (ts[i] - tau);
                const c = Math.cos(wt), s = Math.sin(wt);
                xc += xs[i] * c; 
                xs_ += xs[i] * s; 
                cc += c * c; 
                ss += s * s;
            }
            const P = ((xc * xc) / cc + (xs_ * xs_) / ss) / varx;
            amp[k] = Math.sqrt(P * varx * 4 / ts.length);
        }
        const out = new Array(nfreq);
        for (let i = 0; i < nfreq; i++) {
            out[i] = {
                x: freq[i],// * dt / 2,
                y: amp[i]
            };
        }
        // fs_eff: 1 / dt
        return out;
    }

    // --- Quantile with linear interpolation (Hyndman & Fan type 7)
    #quantile(p) {
        let quantile = NaN;
        const n = this.length;
        if (n !== 0) {
            const data = this.#data;
            if (p <= 0) {
                quantile = data[0];
            } else if (p >= 1) {
                quantile = data[n - 1];
            } else {
                const idx = (n - 1) * p;
                const lo = Math.floor(idx);
                const hi = Math.ceil(idx);
                const w = idx - lo;
                quantile = (1 - w) * data[lo] + w * data[hi];
            }
        }
        return quantile;
    }

    // --- Freedman–Diaconis bin width & count
    // robust, density-friendly
    #freedmanDiaconis() {
        let k = 1;
        const n = this.length;
        const range = this.range;
        if ((n >= 2) && (range !== 0)) {
            let h;
            const q1 = this.q25;
            const q3 = this.q75;
            const iqr = q3 - q1;
            if (iqr > 0) {
                h = 2 * (iqr / Math.cbrt(n));        // FD bin width
            } else {
                // Fallback: Scott's rule if IQR=0 (e.g., many duplicates)
                h = 3.49 * ((this.sigma || range / 6 || 1) / Math.cbrt(n));
            }
            // Guard against pathological tiny widths
            if (!(h > 0)) {
                h = range / Math.sqrt(n);
            }
            k = range / h;
        }
        return k;
    }

    // Square-root choice, quick & simple, good default.
    #squareRootChoice() {
        Math.sqrt(this.length);
    }

    // Sturges’ rule, works OK for smaller datasets (N < 200)
    // but can under-bin for large data.
    #sturgesRule() {
        return 1 + Math.log2(this.length);
    }

    // Rice rule, tends to give more bins than Sturges. 
    #riceRule() {
        return 2 * Math.cbrt(this.length);
    }

    // Scott's rule assumes roughly normal distribution, 
    // optimizes MSE for estimating density.
    #scottRule() {
        return this.range / (3.5 * this.sigma / Math.cbrt(this.length));
    }

    #silvermanBandwidth() {
        return 1.06 * this.sigma * Math.pow(this.length, -1 / 5);
    }

    #gaussian(u) {
        return Math.exp(-0.5 * (u ** 2)) / Math.sqrt(2 * Math.PI);
    }

    #data
}