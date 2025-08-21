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

export class TrimPlayer {
    constructor(root, opts = {}) {
        this.#dom = { root:root }

        // Absolute UTC state (no offsets)
        this.#state = {};
        this.#state.gap = opts.gap ?? 10_000;
        this.#state.speedUp = 20;
        this.#state.start = opts.start ?? Date.now();
        this.#state.end   = Math.max(opts.end ?? 0, this.#state.start + this.#state.gap);
        this.#state.trimStart = this.#clampUtc(opts.trimStart ?? 0, this.#state.start, this.#state.end - this.#state.gap);
        this.#state.trimEnd   = this.#clampUtc(opts.trimEnd ?? 0, this.#state.trimStart + this.#state.gap, this.#state.end);
        this.#state.current   = this.#clampUtc(opts.current ?? 0, this.#state.trimStart, this.#state.trimEnd); 
        this.#state.speedUp = 20;
        this.#state.playing = false;
        this.#state.scrubbing = false;
        
        this.#bindDom();
        this.#bindControls();
        this.#bindInteractions();
        this.#render({ source: 'init' });
        this.#showFloatingAt(this.#dom.playhead, this.#utcLabel(this.#state.current));
        this.#loop();

        window.addEventListener('resize', () => this.#positionFloatingLabel());
        document.addEventListener('scroll', () => this.#positionFloatingLabel(), true);
    }

    // ===== Public API =====

    setBounds(bounds) {
        this.#state.start = bounds[0];
        this.#state.end = Math.max(this.#state.start + 1, bounds[1]);
        this.#ensureTrimInside();
        this.#render({ source: 'api' });
    }

    setTrim(range) {
        const s = Math.max(this.#state.start, range[0]);
        const e = Math.min(this.#state.end, range[1]);
        this.#state.trimStart = Math.min(s, e - this.#state.gap);
        this.#state.trimEnd = Math.max(e, s + this.#state.gap);
        this.#state.current = this.#clampUtc(this.#state.current, this.#state.trimStart, this.#state.trimEnd);
        this.#showFloatingAt(this.#dom.playhead, this.#utcLabel(this.#state.current));
        this.#render({ source: 'api' });
    }

    setCurrent(current) {
        this.#state.current = this.#clampUtc(current, this.#state.trimStart, this.#state.trimEnd);
        this.#showFloatingAt(this.#dom.playhead, this.#utcLabel(this.#state.current));
        this.#render({ source: 'api' });
    }

    play() {
        this.#state.playing = true;
        this.#emit('play', true);
        this.#render({ source: 'api' });
    }

    pause() {
        this.#state.playing = false;
        this.#emit('play', false);
        this.#render({ source: 'api' });
    }

    restart() {
        this.#state.current = this.#state.trimStart;
        this.#showFloatingAt(this.#dom.playhead, this.#utcLabel(this.#state.current));
        this.pause();
        this.#render({ source: 'api' });
    }

    // ===== Internals =====
    #bindDom() {
        this.#dom.btnPlayPause = this.#dom.root.querySelector('#btnPlayPause');
        this.#dom.btnRestart = this.#dom.root.querySelector('#btnRestart');
        this.#dom.timeline = this.#dom.root.querySelector('.timeline');
        this.#dom.rail = this.#dom.root.querySelector('.rail');
        this.#dom.trimWin = this.#dom.root.querySelector('#trimWindow');
        this.#dom.handleL = this.#dom.root.querySelector('#handleL');
        this.#dom.handleR = this.#dom.root.querySelector('#handleR');
        this.#dom.playhead = this.#dom.root.querySelector('#playhead');
        this.#dom.scrubKnob = this.#dom.root.querySelector('#scrubKnob');
        this.#dom.labelsLayer = this.#dom.root.parentElement.querySelector('.labels-layer');
        this.#dom.lblFloating = this.#dom.root.parentElement.querySelector('#lblFloating');
        if (!this.#dom.btnPlayPause || !this.#dom.timeline || !this.#dom.lblFloating || !this.#dom.rail) {
            throw new Error('TrimPlayer: required elements missing');
        }
    }

    #bindControls() {
        this.#dom.btnPlayPause.addEventListener('click', () => {
            this.#state.playing = !this.#state.playing;
            this.#emit('play', this.#state.playing );
            this.#render({ source: 'button' });
        });
        if (this.#dom.btnRestart) {
            this.#dom.btnRestart.addEventListener('click', () => {
                this.#state.current = this.#state.trimStart;
                this.#showFloatingAt(this.#dom.handleL, this.#utcLabel(this.#state.current));
                this.#state.playing = false;
                this.#emit('play', false);
                this.#render({ source: 'button' });
            });
        }
    }

    #bindInteractions() {
        // Timeline scrubbing (not on handles/knob)
        this.#dom.timeline.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.handle') || e.target.closest('.knob')) return;
            this.#state.scrubbing = true;
            this.#dom.timeline.setPointerCapture(e.pointerId);
            this.#state.current = this.#snapUtcToTrim(this.#pxToUtc(e.clientX));
            this.#showFloatingAt(this.#dom.playhead, this.#utcLabel(this.#state.current));
            this.#render({ source: 'scrub' });
        });
        this.#dom.timeline.addEventListener('pointermove', (e) => {
            if (!this.#state.scrubbing) return;
            this.#state.current = this.#snapUtcToTrim(this.#pxToUtc(e.clientX));
            this.#showFloatingAt(this.#dom.playhead, this.#utcLabel(this.#state.current));
            this.#render({ source: 'scrub' });
        });
        this.#dom.timeline.addEventListener('pointerup', (e) => {
            if (this.#dom.timeline.hasPointerCapture?.(e.pointerId)) 
                this.#dom.timeline.releasePointerCapture(e.pointerId);
            if (this.#state.scrubbing) {
                this.#state.scrubbing = false;
                this.#emit('seek', this.#state.current);
                this.#showFloatingAt(this.#dom.playhead, this.#utcLabel(this.#state.current));
            }
        });

        // Scrub knob
        this.#dom.scrubKnob.addEventListener('pointerdown', (e) => {
            e.preventDefault(); e.stopPropagation();
            this.#state.scrubbing = true;
            this.#dom.scrubKnob.setPointerCapture(e.pointerId);
            this.#showFloatingAt(this.#dom.playhead, this.#utcLabel(this.#state.current));
            const move = (ev) => { 
                const utc = this.#pxToUtc(ev.clientX);
                this.#state.current = this.#snapUtcToTrim(utc); 
                this.#showFloatingAt(this.#dom.playhead, this.#utcLabel(this.#state.current)); 
                this.#render({ source: 'scrub' }); 
            };
            const up = (ev) => {
                this.#dom.scrubKnob.releasePointerCapture(ev.pointerId);
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                this.#state.scrubbing = false;
                this.#emit('seek', this.#state.current);
                this.#showFloatingAt(this.#dom.playhead, this.#utcLabel(this.#state.current));
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });

        // Handles
        this.#dragHandle(this.#dom.handleL, 'L');
        this.#dragHandle(this.#dom.handleR, 'R');
    }

    #dragHandle(handle, which) {
        handle.addEventListener('pointerdown', (e) => {
            e.preventDefault(); e.stopPropagation();
            handle.setPointerCapture(e.pointerId);
            const move = (ev) => {
                const utc = this.#pxToUtc(ev.clientX);
                if (which === 'L') {
                    const maxLeft = this.#state.trimEnd - this.#state.gap;
                    this.#state.trimStart = this.#clampUtc(utc, this.#state.start, maxLeft);
                    if (this.#state.current < this.#state.trimStart) this.#state.current = this.#state.trimStart;
                    this.#showFloatingAt(this.#dom.handleL, this.#utcLabel(this.#state.trimStart));
                } else {
                    const minRight = this.#state.trimStart + this.#state.gap;
                    this.#state.trimEnd = this.#clampUtc(utc, minRight, this.#state.end);
                    if (this.#state.current > this.#state.trimEnd) this.#state.current = this.#state.trimEnd;
                    this.#showFloatingAt(this.#dom.handleR, this.#utcLabel(this.#state.trimEnd));
                }
                this.#render({ source: 'trim' });
            };
            const up = (ev) => {
                handle.releasePointerCapture(ev.pointerId);
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                this.#emit('trim', [ this.#state.trimStart,this.#state.trimEnd ]);
                this.#showFloatingAt(this.#dom.playhead, this.#utcLabel(this.#state.current));
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });
    }

    #render({ source } = {}) {
        const l = this.#utcToPct(this.#state.trimStart);
        const r = this.#utcToPct(this.#state.trimEnd);
        const c = this.#utcToPct(this.#state.current);

        this.#dom.trimWin.style.left  = l + '%';
        this.#dom.trimWin.style.right = (100 - r) + '%';
        this.#dom.handleL.style.left  = l + '%';
        this.#dom.handleR.style.left  = r + '%';
        this.#dom.playhead.style.left = c + '%';
        // toggle icon using feather placeholders + replace
        if (this.#state.playing) {
            this.#dom.btnPlayPause.classList.add('playing');
        } else {
            this.#dom.btnPlayPause.classList.remove('playing');
        }
        // Maintain label at active element
        if (this.#state.scrubbing || this.#state.playing) {
            this.#showFloatingAt(this.#dom.playhead, this.#utcLabel(this.#state.current));
        }
        // Emit timeupdate with UTC
        this.#emit('time', this.#state.current);
    }

    #loop() {
        let lastT = 0;
        const tick = (t) => {
            if (!this.#state.playing) { 
                lastT = t; 
                requestAnimationFrame(tick); 
                return; 
            }
            const dt = t - lastT; lastT = t;
            const progressMs = dt;
            const nextUtc = this.#state.current + progressMs * this.#state.speedUp;
            this.#state.current = this.#clampUtc(nextUtc, this.#state.trimStart, this.#state.trimEnd);
            if (this.#state.current >= this.#state.trimEnd) {
                this.#state.playing = false;
                this.#emit('play', false );
                this.#render({ source: 'play' });
                requestAnimationFrame(tick);
                return;
            }
            this.#render({ source: 'play' });
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    // ===== Utils =====
    #emit(name, detail) {
        this.#dom.root.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
    }

    #duration() {
        return Math.max(1, this.#state.end - this.#state.start);
    }

    #utcToPct(utc) {
        return ((utc - this.#state.start) / this.#duration()) * 100;
    }

    #pctToUtc(pct) {
        return this.#state.start + (pct / 100) * this.#duration();
    }

    #pxToUtc(x) {
        const r = this.#dom.rail.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, (x - r.left) / r.width));
        return this.#pctToUtc(p * 100);
    }

    #snapUtcToTrim(utc) {
        return this.#clampUtc(utc, this.#state.trimStart, this.#state.trimEnd);
    }

    #clampUtc(x, min, max) {
        return Math.min(max, Math.max(min, x));
    }

    #utcLabel(utcMs) {
        const d = new Date(utcMs);
        return d.toISOString().replace('T', ' ').slice(0, 19);
    }

    #positionFloatingLabel(anchorEl = null) {
        const anchor = anchorEl || this.#dom.playhead;
        const a = anchor.getBoundingClientRect();
        const layer = this.#dom.labelsLayer.getBoundingClientRect();
        const x = a.left + a.width / 2 - layer.left;
        const max = layer.width - 4;
        const clamped = Math.max(4, Math.min(max, x));
        this.#dom.lblFloating.style.left = clamped + 'px';
    }

    #showFloatingAt(anchorEl, text) {
        this.#dom.lblFloating.textContent = text;
        this.#positionFloatingLabel(anchorEl);
        this.#dom.lblFloating.classList.remove('hidden');
    }

    #ensureTrimInside() {
        const minGap = this.#state.gap;
        this.#state.trimStart = Math.max(this.#state.start, Math.min(this.#state.trimStart, this.#state.end - minGap));
        this.#state.trimEnd = Math.min(this.#state.end, Math.max(this.#state.trimEnd, this.#state.start + minGap));
        this.#state.current = this.#clampUtc(this.#state.current, this.#state.trimStart, this.#state.trimEnd);
    }

    #state
    #dom
}