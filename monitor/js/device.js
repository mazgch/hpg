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
const Device = (function () {

const BUFFER_FORMAT  = 'timedraw';
const LOCAL_HOST = 'localhost';

// Interface
// -----------------------------------------------------------------------------------

function action(task) {
    const lutActions = {
        hotstart:  function _hotstart()  { sendUbx('CFG','RST','\x00\x00\x02\x00'); },
        warmstart: function _warmstart() { sendUbx('CFG','RST','\x01\x00\x02\x00'); },
        coldstart: function _coldstart() { sendUbx('CFG','RST','\xFF\xFF\x02\x00'); },
        list:      function _list()      { socketCommand('list'); },
        discover:  deviceDiscovery,
        settings:  deviceConfigPortal,
        identify:  deviceIdentification,
    };
    var t = (typeof task !== 'string') ? task : task.toLowerCase();
    if (!lutActions[t])
        throw new Error('Parameter "task" is not found.');
    else {
        Console.debug('command', 'DEVICE', task);
        lutActions[t]();
    }
}

function send(data)             { return socketSend(Engine.make(data)); }
function sendText(data)         { return socketSend(Engine.makeText(data)); }
function sendUbx(cls,id,data)   { return socketSend(Engine.makeUbx(cls,id,data)); }
function sendNmea(data)         { return socketSend(Engine.makeNmea(data)); }
function sendAt(data)           { return socketSend(Engine.makeAt(data)); }
function sendAtWait(data, match, timeout, onSuccess, onError) {
    // discard what is pending
    let message = Engine.parsePending();
    if (message) {
        Console.update(message);
        window.postMessage(message, window.location.origin);
    }
    // send the AT command
    if (data === undefined) data = '';
    if (match === undefined) match = '';
    if (typeof match === 'string') {
        let re = atRegExp(data, match) + AT_ENDSEQ;
        match = new RegExp(re, 'm');
    }
    let ret = waitMatch(match, timeout, onSuccess, onError);
    sendAt(data);
    return ret;
}

function waitMatch(match, timeout, onSuccess, onError) {
	if (!timeout) timeout = 2000;
	let data = '';
	let timeoutId;
	if (timeout > 0)
		timeoutId = setTimeout(timeoutFunction, timeout);
	addEventListener('message', waitForListener);
	function timeoutFunction(){
		removeEventListener('message', waitForListener);
		if (onError) {
			onError(new Error('timeout'));
		}
	}
	function waitForListener(e) {
		if (e.type == 'message' && e.data && e.data.data) {
			data += e.data.data;
			const matched = data.match(match);
			if (matched) {
				removeEventListener('message', waitForListener);
				if (timeoutId !== undefined)
					clearTimeout(timeoutId);
				onSuccess(matched);
			}
		}
	}
}

const AT_ENDSEQ = '\r\n(OK|ERROR|ABORTED|\\+CME ERROR: .*)\r\n$';
function atRegExp(c, m) {
    if (!c) c = '';
    if (!m) m = '';
    c = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return  '(?:AT'+c+'[\r\n]+)?(?:'+m+')?[\r\n]*';
}

// Device
// ------------------------------------------------------------------------------------

function deviceInit(ip) {
    const match = document.cookie.match(/device=([^;]+)/);
	const json = JSON.parse(((match != undefined) ? (match.length == 2) : false) ? match[1] : '{}');
    const proto = (window.location.protocol == 'https') ? 'wss://': 'ws://';
    device.status = 'disconnected';
    if (ip !== undefined) { // from url argument
        device.name = 'unknown';
        const m = ip.match(/^([^:]*)(:[0-9]+)?$/);
        if (m != undefined) {
          device.ip = ip;
          device.ws = proto + ip + ((m[2] !== undefined) ? '/ws' : ':8080');
        }    
    } else if (json.ip !== undefined) { // from cookie argument
        device.name = json.name;
        device.ip = json.ip;
        device.ws = json.ws;
    } else {
        device.name = 'unknown';
        device.ip = window.location.hostname;
        device.ws = proto + device.ip + ':8080';
    }
    USTART.statusLed('error');
    USTART.tableEntry('dev_name', device.name);
    USTART.tableEntry('dev_ip', device.ip);
    if (window.WebSocket) {
        socketOpen(device.ws);
    }
    deviceStatusUpdate();
}

function deviceStatusUpdate() {
    let status = 'closed';
    if (device.socket !== undefined) {
        status =    (device.socket.readyState == WebSocket.CONNECTING)  ? 'connecting' :
                    (device.socket.readyState == WebSocket.OPEN)        ? 'open' :
                    (device.socket.readyState == WebSocket.CLOSING)     ? 'closing' :
                    (device.socket.readyState == WebSocket.CLOSED)      ? 'closed' : 'unknown'
    }
    USTART.tableEntry('dev_socket', device.ws  + '  -  ' + status + '');
    USTART.tableEntry('dev_status', device.status);
	// show hide the window
	const ok = device.socket && (device.socket.readyState == WebSocket.OPEN);
    if (ok) {
        // unhide all device elements
        let el = document.getElementById('tile_message');
        if (el) el.removeAttribute('hidden');
        el = document.getElementById('tile_parameter');
        if (el) el.removeAttribute('hidden');
        el = document.getElementById('tile_automate');
        if (el && OPT.js) el.removeAttribute('hidden');
    }
}
    
function deviceUninit() {
    socketClose();
    deviceStatusUpdate();
}

function deviceIdentification() {
    sendAtWait(undefined,undefined,undefined, 
        function _onSuccess(data) { deviceSendCommands(lutAtIdent) }, // ONLY UBX for now
        function _onError(error)  { sendUbx('mon','ver') } // a GPS ? parsed in
    );
}

function deviceConfigPortal() {
    if (device.ip) {
        window.open('http://' + device.ip,'_blank').focus();
    }
}

function deviceDiscovery() {
    let modal = document.getElementById('discover');
	if (modal) {
		modal.removeAttribute('hidden');
        let el = document.getElementById("modal-close");
        el.onclick = function() { 
            modal.setAttribute('hidden','');
        }
        el = document.getElementById("scan-devices");
        el.onclick = testNet
        window.onclick = function(event) {
            if (event.target == modal) {
                modal.setAttribute('hidden','');
            }
        }
    }
}

let scaning = {};
function testNet() {
    let format = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})\s*(-\s*(\d{1,3}))?$/;
    let radios = document.getElementsByName("scan-ips");
    for (var i = 0, length = radios.length; i < length; i++) {
        if (radios[i].checked) {
            let value = radios[i].value;
            if (!radios[i].value.match(format)) {
                let li = document.getElementById("scan-range")
                if (li && li.value) { 
                    value = li.value;
                }
            }
            let m = value.match(format)
            if ((m != undefined) && ((m.length == 3) || (m.length == 5))) {
                let ip = m[1]
                let from = Number(m[2]) & 0xFF
                let to = (m.length == 5) ? Number(m[4]) & 0xFF : from
                if (to <= from) to = from;
                for (let i = from; i < to; i ++) {
                    testIp(ip + i)
                }
            }
        }
    }

    function testIp(ip) {
        if ((scaning[ip] == undefined) || (scaning[ip] == 'found')) {
            let ws = new WebSocket((window.location.protocol == 'https') ? 'wss://' : 'ws://' + ip + ':8080')
            if (ws != undefined) {
                scaning[ip] = 0;
                ws.addEventListener('open',_onOpen)
                ws.addEventListener('error',_onDone)
                ws.addEventListener('close',_onDone)
                ws.addEventListener('message',_onMessage)
                function _report(ip,host) {
                    let tr = document.getElementById('scan-'+ip)
                    let th = document.getElementById('scan-results')
                    th.removeAttribute("hidden");
                    if (tr == undefined) {
                        tr = document.createElement('tr')
                        tr.id = 'scan-'+ip
                    } else {
                        tr = th.parentNode.removeChild(tr)
                    }
                    
                    let name = 'indentifying ...'
                    let open = ''; 
                    let config = '';
                    if (host != undefined) {
                        name = host;
                        open = '<a href="' + window.location.origin + '?ip=' + ip + '"><b>open</b></a>'
                        config = '<a target="_blank" href="' + window.location.protocol + '//'+ ip + '">configure</a>'
                    } 
                    tr.innerHTML = '<td>'+host+'</td><td>'+ip+'</td><td>' + open + '</td><td>' + config + '</td>'
                    th.parentNode.appendChild(tr);
                }
                ws.timer = setTimeout(10000, _onDone)
                function _onDone() { 
                    scaning[ip] = undefined; 
                    ws.removeEventListener('open', _onOpen);
                    ws.removeEventListener('error', _onDone);
                    ws.removeEventListener('close', _onDone);
                    ws.removeEventListener('message', _onMessage);
                    clearTimeout(ws.timer);
                    try {
                        ws.destroy()
                    } catch (e) {}
                    ws.close() // we are done
                }
                 function _onOpen(msg) {
                    _report(ip)
                    scaning[ip] = 1;
                }
                function _onMessage(msg) {
                    scaning[ip] ++;
                    if (typeof(msg.data) == 'string') {
                        const m = msg.data.match(/^Connected to (hpg-[a-z0-9]{6})/)
                        if ((m != undefined) && (m.length == 2)) {
                            _report(ip, m[1])
                            _onDone();
                        }
                    }
                }
            }
        }
    }
}

var lutAtIdent = [
    { send:'I0',              match:'(.+)',           tab:['dev_typenum'], },
    { send:'I9',              match:'(.+),(.+)',      tab:['dev_flash','dev_ext'], },
    { send:'+CGMM',           match:'(.+)',           tab:['dev_mod'], func:function(data) {
        if (data[data.length-1] === 'OK') {
            if (data[1]) {
                if (data[1].match(/(NINA|ODIN|ANNA)-/)) {
					USTART.tableEntry('dev_tech', /*'\uE003 '+*/
							'<a target="_blank" href="https://www.u-blox.com/en/short-range-radio-modules">Short Range Radio</a>', true);
                    deviceSendCommands(lutAtIdentSho);
                } else if (data[1].match(/^(LISA|LEON|LARA|TOBY|SARA|LUCY|ALEX)-/)) {
                    USTART.tableEntry('dev_tech', /*'\uE002 '+*/
							'<a target="_blank" href="https://www.u-blox.com/en/cellular-modules>Cellular</a>', true);
                    deviceSendCommands(lutAtIdentCel);
				}
            }
        }
        return false;
    } },
];

var lutAtIdentSho = [
    { send:'+UMLA=1',         match:'\\+UMLA:\\s*(.+)',     tab:['dev_mac_bt']  },
    { send:'+UMLA=2',         match:'\\+UMLA:\\s*(.+)',     tab:['dev_mac_sta'] },
    { send:'+UMLA=3',         match:'\\+UMLA:\\s*(.+)',     tab:['dev_mac_eth'] },
    { send:'+UMLA=4',         match:'\\+UMLA:\\s*(.+)',     tab:['dev_mac_ap']  },
    { send:'+UBTD', },
    { send:'+UWSCAN',         timeout:10000, },
];
    
var lutAtIdentCel = [
    { send:'+CGSN',           match:'(.+)',           tab:['dev_imei']    },
    { send:'+CMEE=2',         match:'', },
//]; var lutAtIdentCel = [
    // sim card info
    { send:'+CLCK="SC",2',     match:'', },
    { send:'+CPIN?',          match:'', },
    // time
    { send:'+CCLK?',          match:'\\+CCLK:\\s*"([^"]*)"', },
    // power save
    { send:'+UPSV?',          match:'\\+UPSV:\\s*(\\d)',},
    // network information refresh
    //                                          mode
    { send:'+COPS?',         match:'\\+COPS:\\s*(\\d+)(?:,(\\d)(?:,"([^"]*)"(?:,"(\\d)")?)?)?', },
    { send:'+CREG=2',         match:'',},
    { send:'+CREG?',         match:'\\+CREG:\\s*(\\d+),(\\d+)',        timeout:10000, },
    { send:'+CREG=0',         match:'',},
    { send:'+CSQ',             match:'\\+CSQ:\\s*(\\d+),(\\d+)',         func:function(data) {
        if ((data[data.length-1] === 'OK') && (data.length === 4)) {
            // 0: -113 1: -111 ... 30: -53 dBm with 2 dBm steps, 31: >-51 dBm
            if (data[1]) USTART.tableEntry('dev_rssi', (data[1] != 99) ? -113 + 2*data[1] : '');
            let _ber = [ 49, 43, 37, 25, 19, 13, 7, 0 ]; // see 3GPP TS 45.008 [20] subclause 8.2.4
            if (data[2]) USTART.tableEntry('dev_ber', ((data[2] != 99) && _ber[data[2]]) ? _ber[data[2]] : '');
        }
        return true;
    } },
    // ICCID (Integrated Circuit Card ID) of the SIM-card.
    { send:'+CCID',         match:'\\+CCID:\\s*(\\d+)',     tab:['dev_iccid'], },
    // IMSI (International Mobile Subscriber Identification)
    { send:'+CIMI',         match:'(\\d+)',            tab:['dev_imsi'], },
    // the operator list
    { send:'+COPS=?',         match:'\\+COPS:\\s*(.*)', timeout:120000, func:function(data) {
        if ((data[data.length-1] === 'OK') && (data.length === 3)) {
            if (data[1]) {
                const arr = data[1].replace(/^\((.+(?=\)$))\)$/,'$1').split('),(');
				let txt = '<table>'
                for (let i = 0; i < arr.length; i ++) {
                    const m = arr[i].match(/(?:\d+),"([^"]*)","([^"]*)","(\d*)",(\d*)/);
                    if (m && (m.length === 5)) {
                        let _act = [ 'GSM', 'GSM compact', 'UTRAN', 'GSM + EDGE', 'UTRAN+HSDPA',
                                'UTRAN+HSUPA', 'UTRAN+HSDPA+HSUPA', 'LTE', 'EC-GSM-IOT', 'E-UTRAN' ];
						txt += '<tr><td>'+m[1]+'</td><td>'+m[2]+'</td><td>'+m[3]+'</td><td>'+_act[m[4]]+'</td></tr>';
                    }
                }
                txt += '</table>';
                USTART.tableEntry('dev_net', txt, true);
            }
        }
        return true;
    } },
];

function deviceSendCommands(list) {
    if (list.length > 0) {
        // handle the first item
        let match = list[0].match;
        sendAtWait(list[0].send, match, list[0].timeout, 
			function _onSuccess(data) { /* got error or ok */
				  let next = true;
				if (data[data.length-1] === 'OK') {
					if (list[0].tab) {
						for (let i = 0; (i < list[0].tab.length) && (i+2 < data.length); i ++)
							USTART.tableEntry(list[0].tab[i], data[i+1]);
					}
					if (list[0].func)
						next = list[0].func(data);
				}
				if (next)
					deviceSendCommands(list.slice(1));
			},
			function _onError(error) { /* timeout -> continue */ deviceSendCommands(list.slice(1)) }
		);
	}
}

var device = { name:'', ip:'', ws:'', status:'', ports_net:[], ports_hw:[] };

function socketClose() {
/*REMOVE*/ //console.log('socketClose');
    if (device.socket && (device.socket.readyState == WebSocket.OPEN)) {
        //device.status = 'closing';
        device.socket.close();
    }
}

function socketOpen(url) {
/*REMOVE*/ //console.log('socketOpen '+url);
    socketClose();
    device.socket = new WebSocket(url);
    if (device.socket) {
        //device.status = 'opening';
        device.socket.binaryType = "arraybuffer";
        device.socket.addEventListener('open',      onSocketConnect );
        device.socket.addEventListener('close',     onSocketDisconnect );
        device.socket.addEventListener('error',     onSocketError );
        device.socket.addEventListener('message',   onSocketMessage );
    }
}

function onSocketConnect(e) {
/*REMOVE*/ //console.log('onSocketConnect '+this.io.uri);
    device.ws = e.currentTarget.url;
    Console.debug('event', 'SOCKET', 'connected ' + device.ws);
    USTART.timeConnected = new Date();    
    device.status = 'connected';
    // update the cookie 
    let date = new Date();
    date.setFullYear(date.getFullYear()+10);
    const cookie = { ip:device.ip, ws:device.ws, name:device.name, };
    document.cookie = 'device=' + JSON.stringify(cookie) + '; expires=' + date.toGMTString() + '; path=/';
    USTART.statusLed(/*clear*/);
    deviceStatusUpdate();
    deviceIdentification();                    
}

function onSocketDisconnect(evt) {
/*REMOVE*/ //console.log('onSocketDisconnect');
    Console.debug('event', 'SOCKET', 'disconnected');
    USTART.timeConnected = undefined; 
    device.status = 'disconnected';
    device.waitPong = undefined;
    USTART.statusLed('error');
    deviceStatusUpdate();
    if (device.timeout) {
        clearTimeout(device.timeout);
        device.timeout = undefined;
    }
}

function onSocketError(evt) {
/*REMOVE*/ //console.log('onSocketDisconnect');
    if ( device.status == 'connected') {
        Console.debug('event', 'SOCKET', (evt && evt.type) ? evt.type : 'timeout');
        device.status = 'disconnected';
        USTART.timeConnected = undefined;
        device.waitPong = undefined;
        USTART.statusLed('error');
        deviceStatusUpdate();
        if (device.timeout) {
            clearTimeout(device.timeout);
            device.timeout = undefined;
        }
    }
    if (device.socket) {
        device.socket.removeEventListener('open',     onSocketConnect );
        device.socket.removeEventListener('close',    onSocketDisconnect );
        device.socket.removeEventListener('error',    onSocketError );
        device.socket.removeEventListener('message',  onSocketMessage );
        try {
            device.socket.destroy()
        } catch (e) {}
        device.socket.close() // we are done
        device.socket = undefined;
    }
    if (device.ws) {
        Console.debug('event', 'SOCKET', 'reconnecting ' + device.ws);
        socketOpen(device.ws); // try to repoen 
        deviceStatusUpdate();
    }
}
    
function socketSend(messages){
    if ((device.socket !== undefined) && (device.socket.readyState == WebSocket.OPEN)) {
        Console.update(messages);
        if (!Array.isArray(messages)) messages = [ messages ];
        let len = 0;
        for (let m = 0; m < messages.length; m ++) {
            const message = messages[m];
            USTART.updateStatus(message);
            //  convert to binary
            var data = new Uint8Array( message.data.length );
            for ( var i = 0; i < data.length; ++i ) {
                data[i] = message.data.charCodeAt(i);
            }
            device.socket.send(data.buffer);
            len += message.data.length;
        }
        return len;
    }
}
// Protocol
// ------------------------------------------------------------------------------------
function onSocketMessage(evt) {
    if (evt.data instanceof ArrayBuffer) {
        const data = String.fromCharCode.apply(null, new Uint8Array(evt.data));
        if (data && (0 < data.length)) {
            USTART.statusLed('data');
            Engine.parseAppend(data);
            let messages = Engine.parseMessages();
            if (messages.length) {
                Console.update(messages);
                messages.forEach( function(message) {
                    USTART.updateStatus(message);
                    if (message.type === 'output') {
                        window.postMessage(message, window.location.origin);
                    }
                } );
            }
        }
    } else if (typeof(evt.data) == 'string') {
        const m = evt.data.match(/^Connected to (hpg-[a-z0-9]{6})/)
        if ((m != undefined) && (m.length == 2)) {
            device.name = m[1];
            USTART.tableEntry('dev_name', '<a target="_blank" href="http://'+device.ip+'">'+device.name+'</a>',true);
        }
        Console.debug('event', 'TEXT', evt.data);
    }
    if (device.timeout) {
        clearTimeout(device.timeout);
        device.timeout = undefined;
    }
    device.timeout = setTimeout( onSocketError, 5000)
}

/* END OF MODULE */ return {
    deviceInit:     deviceInit,
    deviceUninit:   deviceUninit,
    socketSend:     socketSend,
    action:         action,
    send:           send,
    sendUbx:        sendUbx,
    sendNmea:       sendNmea,
    sendAt:         sendAt,
    sendAtWait:     sendAtWait,
    waitMatch:      waitMatch,
    atRegExp:       atRegExp,
    AT_ENDSEQ:      AT_ENDSEQ,
};
})();
// ------------------------------------------------------------------------------------

