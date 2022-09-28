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

// Console
// ------------------------------------------------------------------------------------
const Console = (function () {

const CONSOLE_INVISIBLE_PAGES  	= 5;
const CONSOLE_SCROLL_LINES      = 100000;
const CONSOLE_SCROLL_TIMEOUT 	= 20000;
const CONSOLE_SCROLL_ENDPOS  	= 0x7FFFFFF;

function consoleInit() {
    if ((undefined !== OPT.lines) && !isNaN(OPT.lines)) list.maxMessages = Number(OPT.lines);
    const editor = editorInit('console');
    let el;
    if (editor) {
        el = document.getElementById('console_execute');
        if (el) el.addEventListener('click', function _execute(e) {
            onConsoleExecute(this, editor.getSession().getValue());
        } );
		el = document.getElementById('console_abort');
        if (el) el.addEventListener('click', onConsoleAbort );
    }
    list.el = document.getElementById('console_data');
    if (list.el) {
		onConsoleClear();
		list.el.addEventListener('scroll', onConsoleScroll/*, {passive: true}*/);
        el = document.getElementById('console_filter');
		if (el) {
			el.value = OPT.filter ? OPT.filter : '';
            el.addEventListener('keyup', onConsoleFilter);
            consoleFilterUpdate(el.value);
            el.addEventListener('focusout', onConsoleFilterFocusLost);
        }
        el = document.getElementById('console_send');
		if (el) {
			consoleAutocomplete(el, Engine.makeSuggestions());
			//el.addEventListener('keyup', onConsoleSend);
		}
		el = document.getElementById('console_down');
        if (el) el.addEventListener('click', consoleScrollToEnd);
        el = document.getElementById('console_clear');
        if (el) el.addEventListener('click', onConsoleClear );
        el = document.getElementById('console_logfile');
        if (el) el.addEventListener('click', onConsoleLogfile );
        el = document.getElementById('console_ubxfile');
        if (el) el.addEventListener('click', onConsoleUbxfile );
    }
}

function onConsoleSend(e) {
	e.preventDefault();
	if (e.keyCode === 0xD/* \r enter key*/) {
		consoleSend(this);
    }
} 

function consoleSend(el) {
	let m;
	if (OPT.dbg && (m = el.value.match(/^DEBUG\s+(.*)$/)))
		Device.socketCommand(m[1]);
	else if (m = el.value.match(/^TRACE\s+(.*)$/))
		consoleTrace('TRACE', m[1], undefined, 'USER');
	else {
		Device.socketSend(Engine.makeFromText(el.value));
		el.setSelectionRange(0,el.value.length);
	}
}

function onConsoleFilter(e) {
    e.preventDefault();
    if (e.keyCode === 0xD/* \r enter key*/) {
        consoleFilterUpdate(this.value);
    }
}

function onConsoleFilterFocusLost(e) {
    e.preventDefault();
    const filter = (list.filter) ? list.filter.toString() : '';
    if (this.value !== filter)
        this.value = filter;
}

function consoleFilterCheck(child) {
    const match = (list.filter !== undefined) ? list.filter.exec(child.textContent) : true;
    child.style.display = (match) ? 'block' : 'none';
}

function consoleFilterUpdate(filter) {
    if (filter === '')
        list.filter = undefined;
    else {
		try {
			let flags;
			const m = filter.match(/^\/([^\/]*)\/([gimsuy]*)$/);
			if (m) {
				filter = m[1];
				flags = m[2];
			}
			list.filter = new RegExp(filter, flags);
        } catch (e) { }
    }
    consoleScrollToEnd();
}

function onConsoleClear(e) {
    if (e) e.preventDefault();
    list.messages = [];
    list.offsetIx = 0;
    consoleScrollToEnd();
}

let list = {
    messages:[],
    offsetIx:0,
    startIx:0,
    nextIx:0,
    maxMessages:CONSOLE_SCROLL_LINES,
};

let actionTimeout = 0;

function onConsoleScroll(e) {
	e.preventDefault();
    const scrollPos = this.scrollTop;
    const scrollHeight = this.scrollHeight;
    const clientHeight = this.clientHeight;
    const canScrollDown = (scrollPos + 1) < scrollHeight - clientHeight;
    consoleMessage(); // call consoleMessage with null to force updating of invisble elements
    let el = document.getElementById("console_down");
    if (el) {
        if (canScrollDown)
            el.removeAttribute('hidden');
        else 
            el.setAttribute('hidden','')
        el = el.previousElementSibling;
        if (el) el.style.borderBottomRightRadius = el.style.borderBottomLeftRadius = canScrollDown ? "0" : "2px";
    }
    if (canScrollDown) actionTimeout = new Date().getTime() + CONSOLE_SCROLL_TIMEOUT;
}

function consoleScrollToEnd() {
    // force a reload
    if (list.el) {
        list.el.innerHTML = '<div class="message head"><pre class="messagehead">             start</pre></div>'+
                            '<div class="message head"><pre class="messagehead">          no messages</pre></div>';
        const endIx = list.offsetIx + list.messages.length;
        list.startIx = endIx;
        list.nextIx = endIx;
        actionTimeout = 0;
        consoleMessage();
    }
}

function consoleMessage(messages) {
    const doUpdate = (messages !== undefined);
    if (doUpdate) {
        if (!Array.isArray(messages)) messages = [ messages ];
		if (messages.length) {
			// special console for WEBIDE demo
			if (window.location.pathname === '/edit.html') {
				for (let m = 0; m < messages.length; m ++) {
					const message = messages[m];
					if (message.protocol === 'TEXT')
						scriptOutput(message.data, true);
				}
			}
			
			// pop the pending item from the end of our array
			let len = list.messages.length;
			if (len && (list.messages[len-1].type === 'pending')) {
				const pending = list.messages.pop()
				if (list.nextIx === list.offsetIx + (len - 1)) {
					list.nextIx --;
					len --;
				}
				if (!messages[0].type.match(/output|pending/)) {
					messages.push(pending);
				}
			}
			// remove any messages we can't keep in the memory
			const remove = len + messages.length - list.maxMessages;
			if (remove > 0) {
				list.messages = list.messages.slice(remove);
				// keep track of discarded messages as offsetIx
				list.offsetIx += remove;
			}
			// finally attach the new messages (including pushed saved pending element)
			list.messages = list.messages.concat(messages);
        }
	}
	if (list.el) {
		const el = list.el;
		// determine if we need to do some scrolling at the end
        const scrollTop = el.scrollTop;
        const clientHeight = el.clientHeight;
        const firstItem = el.firstChild;
        const lastItem = el.lastChild;
        const headItemHeight = firstItem.nextSibling.offsetTop; // scrollHeight
        const typicalItemHeight = firstItem.clientHeight; // scrollHeight
        let scrollHeight = Math.min(lastItem.offsetTop + headItemHeight, el.scrollHeight);
        let scrollPos = scrollTop;
		const doScroll = ((scrollPos + 1) >= (scrollHeight - clientHeight)) ||
                         (new Date().getTime() > actionTimeout);
        let numMsg = el.childElementCount - 2;
        
	//	let dbg = {sr:0,sc:0,sa:0,ea:0,er:0,p:0};
        let nextIx = list.nextIx;
        let startIx = list.startIx;
        const endIx = list.offsetIx + list.messages.length;
        const endPos = scrollPos + (CONSOLE_INVISIBLE_PAGES+1)*clientHeight;
        const invisibleHeight = CONSOLE_INVISIBLE_PAGES*clientHeight;
        if (doUpdate) {
            
            if (numMsg) _removePending(); // eventually remove the pending item from the DOM list too
			// Safari likes ho have _removeStart after _addEnd 
			// Chrome is somehow scrolling the outer window for some reason  
            _addEnd(); // no need to remove first we should have enough space at the end
			_removeStart(); // messages that were discarded and are no longer in view
        } else {
            _removeEnd();
            _removeStart();
            _addStart();
            _addEnd();
        }
        list.startIx = startIx;
        list.nextIx = nextIx;
        const nextMore = endIx - nextIx;
        const num = endIx - list.offsetIx;
        const startMore = startIx - list.offsetIx;
        lastItem.firstChild.textContent  = (nextMore ? _align(nextMore) + ' more messages' : num ? _align(num) + ' messages' :'          no messages');
        firstItem.firstChild.textContent = (startMore ? _align(startMore) + ' more messages' : list.offsetIx ? _align(list.offsetIx) + ' discarded' :'             start');
        // *** DONE ***
        // *** SCROLL *** this will cause a layout update
        if (scrollPos < 0) scrollPos = 0;
		
		el.scrollTop = doScroll ? CONSOLE_SCROLL_ENDPOS : scrollPos;
	//	console.log('update '+doScroll+' msg ' + (messages ? messages.length : messages) + ' dbg: ' + JSON.stringify(dbg) + ' top ' + scrollPos +'/'+ scrollTop + ' height ' +scrollHeight +'/'+ clientHeight);
        
        // Helper for DOM manipulations
        function _removePending() {
            const pendingItem = lastItem.previousSibling;
            if (pendingItem.message.type === 'pending') {
                nextIx = pendingItem.messageIx;
                scrollHeight -= pendingItem.clientHeight
                el.removeChild(pendingItem);
                numMsg --;
    //            dbg.p--;
            }
        }
        function _removeEnd() {
            // remove Items from end which are not visible within a page
            while (numMsg > 0) {
                const item = lastItem.previousSibling;
                const itemHeight = item.clientHeight;
                if (scrollHeight - itemHeight < endPos)
                    break;
                nextIx = item.messageIx;
                scrollHeight -= itemHeight;
                el.removeChild(item);
                numMsg --;
    //            dbg.er--;
            }
        }
        function _removeStart() {
            // remove items from start if not visible (need to remove from biggest to avoid layout recalc)
			const startPos = scrollPos - invisibleHeight;
			let item = firstItem.nextSibling;                            // causes a layout update
			while ((numMsg > 0) && ((item.messageIx < list.offsetIx) || (item.nextSibling.offsetTop < startPos))) {
                item = item.nextSibling;
                numMsg --;
    //            dbg.sc--;
            }
            if (startIx < list.offsetIx)
				startIx = list.offsetIx;
            let itemRemove = item.previousSibling;
            if (itemRemove !== firstItem) {
                // we will remove all but the head(first) item
                const removeHeight = item.offsetTop - firstItem.nextSibling.offsetTop;
                scrollPos -= removeHeight;
                scrollHeight -= removeHeight;
                startIx = itemRemove.messageIx+1; // the next item would be the one to check
                do {
                    el.removeChild(itemRemove);
                    itemRemove = item.previousSibling;
    //                dbg.sr--;
                } while (itemRemove !== firstItem);
            }
        }
        function _addEnd() {
            // if they will be within a certain number + current visible page
            while ((nextIx < endIx) && (scrollHeight <= endPos)) {
                if (_insertBefore(nextIx, lastItem)) {
                    numMsg ++;
                    scrollHeight += typicalItemHeight;
    //                dbg.ea++;
                }
                nextIx ++;
            }
            if (doScroll)
                 scrollPos = Math.max(0, scrollHeight - clientHeight);
        }
        function _addStart() {
            while ((startIx > list.offsetIx) && (scrollPos < invisibleHeight)) {
                startIx --;
                if (_insertBefore(startIx, firstItem.nextSibling)) {
                    numMsg ++;
    //                dbg.sa++;
                    scrollPos += typicalItemHeight;
                    scrollHeight += typicalItemHeight;
                }
            }
        }
        // helpers
        function _align(v) {
            v = v.toString();
            return ('            '+v).slice(-12);
        }
        function _insertBefore(ix, refItem) {
            const message = list.messages[ix - list.offsetIx];
            let div = Engine.messageLine(message, list.filter);
            if (!div) return null;
            div.messageIx = ix;
            div.message = message;
            div.addEventListener('click', _onMessageClick);
            el.insertBefore(div, refItem)
            return div;
        }
        function _onMessageClick(e) {
            const sel = window.getSelection();
            const el = this.parentNode;
            if (sel && (sel.type !== 'Range')) {
                if (this.lastChild.className === 'messagehint') {
                    this.removeChild(this.lastChild);
                } else {
                    this.appendChild(Engine.messageTable(this.message));
                    const visibleHeight = Math.min(el.clientHeight, this.scrollHeight)
                    let scrollPos = el.scrollTop;
                    if (this.offsetTop + visibleHeight > scrollPos + el.clientHeight) {
                        el.scrollTop = this.offsetTop + visibleHeight - el.clientHeight;
                    } else if (this.offsetTop < scrollPos) {
                        el.scrollTop = this.offsetTop;
                    }
                }
            }
            actionTimeout = new Date().getTime() + CONSOLE_SCROLL_TIMEOUT;
        }
    }
}

function onConsoleUbxfile(e) {
    e.preventDefault();
    if (list.messages.length) {
        // anything that went to or came from the device
        const data = list.messages.map( _checkMessage ).join('');
        const len = data.length;
        // convert our sting to a binary Byte Array
        let binary = new Uint8Array(len);
        for (let i=0; i < len; i++) {
            binary[i] = data.charCodeAt(i);
        }
        const blob = new Blob( [ binary ], {type:'text/plain'});
        const link = window.URL.createObjectURL(blob);
        const tempLink = document.createElement('a');
        tempLink.download  = 'Logfile.ubx';
        tempLink.innerHTML = 'Download Ubxfile';
        tempLink.href      = link;
        tempLink.onclick   = function (e) { document.body.removeChild(e.target); };
        tempLink.style.display = 'none';
        document.body.appendChild(tempLink);
        tempLink.click();
    }
	function _checkMessage(m) { 
		return m.type.match(/^input|output|pending$/) ? m.data : '';
	}
}

function onConsoleLogfile(e) {
    e.preventDefault();
    if (list.messages.length) {
        const data = Engine.messageLogFile() + list.messages.map( Engine.messageLogFile ).join('');
        const blob = new Blob( [ data ], {type:'text/plain'});
        const link = window.URL.createObjectURL(blob);
        const tempLink = document.createElement('a');
        tempLink.download  = 'Logfile.txt';
        tempLink.innerHTML = 'Download Logfile';
        tempLink.href      = link;
        tempLink.onclick   = function (e) { document.body.removeChild(e.target); };
        tempLink.style.display = 'none';
        document.body.appendChild(tempLink);
        tempLink.click();
    }
}

function consoleTrace(name,text,col,protocol) {
    if (text) {
        if (protocol === undefined) protocol = 'SCRIPT';
        let message = Engine.Message(protocol,text/*data*/,'command',false);
        message.name = name;
        message.text = name + ': ' + text.replace(/\s+/gm, ' ');
        message.color = (col === 'hero')    ? COL_PPT.hero :
                        (col !== undefined) ? col :
                        (name === 'ERROR')  ? COL_PPT.red :
                        (name === 'INFO')   ? COL_PPT.green :
                                              undefined;
        consoleMessage(message);
    }
}

function consoleDebug(type, name, text, fields) {
	if (OPT.dbg) {
		let message = Engine.Message('DEBUG',text/*data*/,type,false);
		message.name = name;
		message.text = name + ': ' + text.replace(/\s+/gm, ' ');
		message.fields = fields;
		consoleMessage(message);
	}
}

// Console Automation
// ------------------------------------------------------------------------------------

function consoleAutocomplete(inp, arr) {
	let currentFocus;
	inp.addEventListener("input", function(e) {
		removeAutoCompleteList();
		if (!this.value) { return false;}
		currentFocus = -1;
		const el = document.createElement("DIV");
		el.id = this.id + 'autocomplete-list';
		el.className = 'autocomplete-list';
		this.parentNode.appendChild(el);

		const regStr = this.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const regex = new RegExp(regStr, "i");

		for (let i = 0; i < arr.length; i++) {
			const a = arr[i];
			const descr = a.descr; 
			if (regex.exec(a.data) || 
				(descr && regex.exec(descr))) {
				const eli = document.createElement("DIV");
				eli.setAttribute("class", "autocomplete-item");
				eli.innerHTML = '<div class="preformated">' + a.data.replace(regex, _strong) + '</div>'+
				                (descr ? '<div style="font-size:0.8em;">' + descr.replace(regex, _strong) + '</div>' : '');
				eli.messageDraft = a.data;
				eli.messageHint = a.payload;
				eli.addEventListener("click", function(e) {
					inp.value = this.messageDraft;
					removeAutoCompleteList();
				});
				eli.addEventListener("contextmenu", function(e) {
					e.preventDefault();
					inp.value = this.messageDraft+this.messageHint;
					removeAutoCompleteList();
					return false;
				});
				el.appendChild(eli);
				function _strong(x) { return "<strong>" + x + "</strong>"; }
			}
		}
	});
	/*execute a function presses a key on the keyboard:*/
	inp.addEventListener("keydown", function(e) {
		var x = document.getElementById(this.id + "autocomplete-list");
		if (x) x = x.getElementsByClassName("autocomplete-item");
		if (x && (x.length > 0) && 
		    (((e.keyCode === 40/*down*/) && (currentFocus < x.length-1)) || 
			 ((e.keyCode === 38/*up*/)   && (currentFocus > 0)))) {
			if (-1 !== currentFocus) 
				x[currentFocus].classList.remove("autocomplete-active");
			currentFocus += (e.keyCode == 40 ? 1 : -1);
			x[currentFocus].classList.add("autocomplete-active");
		} else if (e.keyCode == 13) {
			e.preventDefault();
			if (x && (currentFocus > -1)) {
				x[currentFocus].click();
			} else {
				consoleSend(inp);
				removeAutoCompleteList();
			}
		}
	});
	function removeAutoCompleteList(e) {
		const el = document.getElementById(inp.id + "autocomplete-list");
		if (el) el.parentNode.removeChild(el);
	}
	document.addEventListener("click", removeAutoCompleteList );
}

// Console Automation
// ------------------------------------------------------------------------------------

let worker;
function onConsoleExecute(el, code) {
     //code = 'importScripts(\''+window.location.origin+MOD_DIR+'console/api.js\');\r\n' + code;
     const api = '\
function action(t) { postMessage( { msg:"action", task:t } ); }\
function send(d) { postMessage( { msg:"send", data:d } ); }\
function sendAt(d) { postMessage( { msg:"sendAt", data:d } ); }\
function sendNmea(d) { postMessage( { msg:"sendNmea", data:d } ); }\
function sendUbx(c,i,d) { postMessage( { msg:"sendUbx", cls:c, id:i, data:d } ); }\
function trace(d,c) { postMessage( { msg:"trace", txt:d, col:c } ); }\
function close() { postMessage( { msg:"close" } ); }\
';
    code += api;
    const blob = new Blob([code], { type: 'text/javascript' });
    if (worker) {
        consoleTrace('ERROR', 'Script still running');
    } else {
        worker = new Worker(window.URL.createObjectURL(blob));
        if (worker) {
            worker.handler = function _postToWorker(e) {
                worker.postMessage(e.data);
            };
            addEventListener('message', worker.handler );
            worker.addEventListener('message', _onConsoleWorkerMessage, false);
            worker.addEventListener('error', _onConsoleWorkerError, false);
            worker.postMessage('start');
            document.getElementById('console_abort').style.display = 'block';
            document.getElementById('console_execute').style.display = 'none';
        } else if (script.out) {
            consoleTrace('ERROR', 'Console Script failed');
        }
    }
    
    function _onConsoleWorkerMessage(e) {
        if (!e.data.msg)                     consoleTrace('ERROR', 'Unknown message format');
        else if (e.data.msg =='action')      Device.action(e.data.task);
        else if (e.data.msg =='send')        Device.send(e.data.data);
        else if (e.data.msg =='sendUbx')     Device.sendUbx(e.data.cls, e.data.id, e.data.data);
        else if (e.data.msg =='sendNmea')    Device.sendNmea(e.data.data);
        else if (e.data.msg =='sendAt')      Device.sendAt(e.data.data);
        else if (e.data.msg =='trace')       consoleTrace('TRACE',e.data.txt,e.data.col);
        else if (e.data.msg =='close')       onConsoleAbort();
        else consoleTrace('ERROR', 'Unknown message \''+e.data.msg);
    }

    function _onConsoleWorkerError(e) {
        consoleTrace('ERROR', 'in line:' + (e.lineno-1) + ' ' + e.message);
        onConsoleAbort();
    }
}

function onConsoleAbort(e) {
	if (worker) {
        removeEventListener('message', worker.handler);
		worker.terminate();
		worker = undefined;
		consoleTrace('INFO', 'Script Terminated');
        document.getElementById('console_abort').style.display = 'none';
        document.getElementById('console_execute').style.display = 'block';
	}
}

return { init: consoleInit, reset:onConsoleClear, update:consoleMessage,
         debug:consoleDebug };
})();

// ------------------------------------------------------------------------------------

