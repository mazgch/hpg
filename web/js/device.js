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
        agent:     deviceGetAgent,
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
const REMOTE_AGENT = 'Remote Device Agent';
const LOCAL_AGENT = 'Local Device Agent';
const DISCONNECTED = 'Disconnected';

function deviceGetAgent()     { 
	const platform = navigator.platform.toUpperCase();
	const file = (platform.indexOf('MAC')>=0)   ? 'u-bloxDeviceAgentInstallerMac.pkg' : 
				 (platform.indexOf('WIN')>=0)   ? 'u-bloxDeviceAgentInstallerWin.exe' : 
			//	 (platform.indexOf('LINUX')>=0) ? undefined : 
												  undefined;
	if (file) {
		const tempLink = document.createElement('a');
		tempLink.download  = file;
		tempLink.innerHTML = 'Download Device Agent';
		tempLink.href      = MOD_DIR + 'agent/' + file;
		tempLink.onclick   = function (e) { document.body.removeChild(e.target); };
		tempLink.style.display = 'none';
		document.body.appendChild(tempLink);
		tempLink.click();
	} else {
		alert('Unfortunately our device agent does not yet support your operating system. ' +
			  'We currently support only Windows and MacOs. ' +
			  'Please let us know if you like to contribute to this project.');
	}
}

function deviceInit(url) {
	//let elSet = document.getElementById('device_settings');
	//if (elSet) elSet.addEventListener('click', deviceSettings);
	const match = document.cookie.match(new RegExp('(^| )device=([^;]+)'));
	device.host = (url == undefined) ? window.location.hostname + ":2101" : url;
/* REM   if (match) {
        const json = JSON.parse(match[2]);
        device.baudrate = Number(json.baudrate);
        device.name = json.name;
        device.host = json.host;
        device.status = 'waiting';
        deviceStatusUpdate();
        Console.debug('event', 'INIT', 'cookie', json);
	}
*/
    USTART.statusLed('error');
    if (window.WebSocket) {
/*        const el = document.getElementById('device_host');
        if (el) {
			const m = device.host.match('^https?://'+LOCAL_HOST+':[1-9]{1,5}$');
			if (m)
				appendSelectOption(el, LOCAL_AGENT, device.host);
			else if ((device.host !== '') || OPT.dbg)
				appendSelectOption(el, REMOTE_AGENT, device.host);
			
			el.onchange = onSocketChange;
            if ('' !== device.host)*/
                socketOpen(device.host);
/*        }*/
    } else
        appendSelectOption(el.host, 'Websockets not available!');
/*    const elbr = document.getElementById('device_baudrate');
    if (elbr) {
        if (device.baudrate) elbr.value = device.baudrate;
        elbr.onchange = onDeviceChange;
    }
*/    const el = document.getElementById('device_name');
    if (el) {
        el.onchange = onDeviceChange;
    }
}

function deviceSettings() {
	let el = document.getElementById('dropdown-device');
	if (el) deviceRefreshActive(el, el.style.display !== 'block');
}

function deviceRefreshActive(el, active) {
	el.style.display = (active) ? 'block' : 'none';
	if (el.intervalId) {
		clearInterval(el.intervalId);
		el.intervalId = undefined; 
	}
	if (active) {
		deviceDoRefresh();
		el.intervalId = setInterval(deviceDoRefresh, 2000);
	}
}

function deviceDoRefresh() {
	const el = document.getElementById('device_host');
	const url = window.location.o + '//' + window.location.host + ':' + 2101;
	//if (appendSelectOption(el, LOCAL_AGENT, url)) {
		if ('' === device.host) {
			device.host = url;
			socketOpen(url);
		}
	//}
/*	
	if (device.socket && device.socket.connected) {
		socketCommand('list');
	} else {
		for (let p = 8991; p <= 8999; p ++) {
			const Http = new XMLHttpRequest();
			Http.onreadystatechange = function _loadOptions(e){
				if (this.readyState === 4) {
					if (this.status === 200) {
						const obj = JSON.parse(this.responseText);
						if (obj) {
							const el = document.getElementById('device_host');
							const url = (window.location.protocol === 'https:') ? obj.https : obj.http;
							if (appendSelectOption(el, LOCAL_AGENT, url)) {
								if ('' === device.host) {
									device.host = url;
									socketOpen(url);
								}
							}
						}
					} else if (this.status !== 0) {
						console.log('Error probing agent: ' + Http.requestUrl + ' ' + this.status);
					}
				}
			}
			Http.onerror = function() { };
			Http.requestUrl = window.location.protocol + '//' + LOCAL_HOST + ':' + p;
			Http.open('GET' , Http.requestUrl + '/info', true);
			Http.send();
		}
	}*/
}

function appendSelectOption(el, name, value) {
	let o;
	if (value) {
		for (o = 0; o < el.options.length; o ++) {
			const compare = value.localeCompare(el.options[o].value);
			if (compare < 0) break;
			if (compare === 0) return false;
		}
	}
/*REMOVE*/ //console.log('appendSelectOption ' + value);
	var opt = document.createElement('option');
	opt.innerHTML = name + (value ? SEPARATOR + value : '');
	opt.value = value ? value : '';
	opt.selected = (value === device.host);
	if (o < el.options.length)
		el.insertBefore(opt,  el.options[o]);
	else 
	el.appendChild(opt);
	if ((el.length > 2) || (name === REMOTE_AGENT) || OPT.dbg)
		el.parentNode.style.display = 'block';
	return true;
}

function deviceStatusUpdate() {
    USTART.tableEntry('dev_agent', '<a href="'+device.host+'">'+device.host+'</a>'+
            ((device.socket && device.socket.connected)?SEPARATOR+'connected':''), true);
    USTART.tableEntry('dev_port', device.name+
            ((device.name!=='')?SEPARATOR+device.baudrate+SEPARATOR+device.status:''));
	// show hide the window
	const ok = device.socket && (device.socket.readyState == 1) &&//device.socket.connected && 
			  (device.name !== '') && (device.status === 'opened');
	let el = document.getElementById('dropdown-device');
	if (el) deviceRefreshActive(el, !ok);
	
	el = document.getElementById('tile_message');
	if (el) el.style.display = ok ? 'block' : 'none';
	el = document.getElementById('tile_parameter');
	if (el) el.style.display = ok ? 'block' : 'none';
	el = document.getElementById('tile_automate');
	if (el) el.style.display = (ok && OPT.js) ? 'block' : 'none';
}
    
function deviceUninit() {
    let date = new Date();
    date.setFullYear(date.getFullYear()+10);
    const cookie = { host:device.host,name:device.name,baudrate:device.baudrate };
    document.cookie = 'device=' + JSON.stringify(cookie) + '; expires=' + date.toGMTString() + '; path=/';
    deviceClose();
    socketClose();
}

function deviceSelectList(list) {
    let el = document.getElementById('device_name');
    let o = 0;
    let l = 0;
    if (el) {
        list.sort(function(a, b) { return a.Name.localeCompare(b.Name); })
        while (o < el.options.length || l < list.length) {
            if (o === el.options.length) {
                el.appendChild(portOption(list[l]));
                l ++;
                o ++;
            } else if (el.options[o].value === '') {
                o ++;
            } else if ((l < list.length) && (el.options[o].value === list[l].Name)) {
                o ++;
                l ++;
            } else {
                el.removeChild(el.options[o]);
            }
        }
        function portOption(p) {
            let hint = [ ];
            let productId = p.ProductID;
            let vendorId = p.VendorID;
            if (vendorId) {
                if (productId && (vendorId=='0x1546')) {
                    const prodLut = {
                        // Positioning
                        '0x01A4':'ATR0635','0x01A5':'UBX-5','0x01A6':'UBX-6',
                        '0x01A7':'UBX-7','0x01A8':'UBX-M8','0x01A9':'UBX-F9/M9',
                        // Cellular
                        '0x1000':'SARA-R4', '0x1010':'TOBY-L4', '0x1100':'LUCY-H',
                        '0x1001':'LISA-U1', '0x1002':'LISA-U2',
                        '0x1102':'SARA/LISA-U2', '0x1103':'SARA/LISA-U2', '0x1104':'SARA/LISA-U2', '0x1105':'SARA/LISA-U2', '0x1106':'SARA/LISA-U2',
                        '0x1107':'TOBY-R2', '0x1108':'TOBY-R2', '0x1109':'TOBY-R2', '0x110A':'TOBY-R2', '0x110B':'TOBY-R2', '0x110C':'TOBY-R2', '0x110D':'TOBY-R2',
                        '0x1121':'FW75-D2', '0x1131':'TOBY-L1',
                        '0x1140':'TOBY-L2', '0x1141':'TOBY-L2', '0x1142':'TOBY-L2', '0x1143':'TOBY-L2', '0x1144':'TOBY-L2', '0x1145':'TOBY-L2', '0x1146':'TOBY-L2', '0x1147':'TOBY-L2', '0x114F':'TOBY-L2',
                        '0x1201':'LARA-R3', '0x1202':'LARA-R3', '0x1203':'LARA-R3',
                        '0x1211':'LARA-R3', '0x1212':'LARA-R3', '0x1213':'LARA-R3',
                        '0x1221':'ALEX/LARA-R5', '0x1222':'ALEX/LARA-R5', '0x1223':'ALEX/LARA-R5',}
                    if (prodLut[productId]) productId += '/'+prodLut[productId];
                    else {
                        var pid = prodLut[productId] & 0xF000;
                        if      (pid == 0x1000) productId += '/Positioning';
                        else if (pid == 0x1000) productId += '/Cellular';
                        else if (pid == 0x2000) productId += '/Short Range';
                    }
                }
                const venLut = {
                    '0x1546':'u-blox',
                    '0x0403':'FTDI', '0x05C6':'Qualcomm','0x1286':'Marvel',
                    '0x042B':'Intel','0x8086':'Intel',   '0x8087':'Intel',}
                if (venLut[vendorId]) vendorId += '/'+venLut[vendorId];
            }
            if (vendorId)  hint.push('Vendor: ' + vendorId);
            if (productId) hint.push('Product: ' + productId);
            if (p.SerialNumber) hint.push('Serial: ' + p.SerialNumber);
            let opt = document.createElement('option');
            opt.innerHTML = p.Name + SEPARATOR + hint.join(', ');
            opt.value = p.Name;
            if (p.IsOpen) {
                if ((p.Baud === device.baudrate) && (p.Name === device.name) && (device.status === 'waiting')) {
                    device.status = 'opened';
                    Console.debug('event', 'DEVICE', 'reopened ' + device.name);
                    deviceStatusUpdate();
                    deviceIdentification();
                } else {
                    Console.debug('command', 'DEVICE', 'force close ' + p.Name);
                    socketCommand('close ' + p.Name);
                }
            }
            // auto connect
            if ((p.Name === device.name) && (device.status === 'waiting')) {
                opt.selected = true;
                deviceOpen(device.name, device.baudrate);
            }
            return opt;
        }
    }
}

function deviceIdentification() {
    sendAtWait(undefined,undefined,undefined, 
        function _onSuccess(data) { deviceSendCommands(lutAtIdent) },
        function _onError(error)  { sendUbx('mon','ver') } // a GPS ? parsed in
    );
}

var lutAtIdent = [
    { send:'I0',              match:'(.+)',           tab:['dev_typenum'], },
    { send:'I9',              match:'(.+),(.+)',      tab:['dev_flash','dev_ext'], },
    { send:'+CGMM',           match:'(.+)',           tab:['dev_mod'], func:function(data) {
        if (data[data.length-1] === 'OK') {
            if (data[1]) {
                if (data[1].match(/(NINA|ODIN|ANNA)-/)) {
					USTART.tableEntry('dev_tech', /*'\uE003 '+*/
							'<a href="https://www.u-blox.com/en/short-range-radio-modules">Short Range Radio</a>', true);
                    deviceSendCommands(lutAtIdentSho);
                } else if (data[1].match(/^(LISA|LEON|LARA|TOBY|SARA|LUCY|ALEX)-/)) {
                    USTART.tableEntry('dev_tech', /*'\uE002 '+*/
							'<a href="https://www.u-blox.com/en/cellular-modules>Cellular</a>', true);
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

var device = { host:'', name:'', baudrate:'', status:'idle', ports_net:[], ports_hw:[] };
function deviceClose() {
/*REMOVE*/ //console.log('deviceClose');
    if ((device.name !== '') && (device.status === 'opened')) {
        Console.debug('command', 'DEVICE', 'close ' + device.name);
        socketCommand('close ' + device.name);
        device.status = 'closing';
        deviceStatusUpdate();
    }
}
function deviceOpen(name, baudrate) {
/*REMOVE*/ //console.log('deviceOpen '+name);
    USTART.resetGui();
    device.name = name;
    device.baudrate = Number(baudrate);
    device.status = 'opening';
    deviceStatusUpdate();
    Console.debug('command', 'DEVICE', 'open ' + name + ' ' + baudrate);
    socketCommand('open ' + name + ' ' + baudrate + ' ' + BUFFER_FORMAT);
    Engine.parseReset();
}
function onDeviceChange(e) {
    let el = document.getElementById('device_name');
    let elbr = document.getElementById('device_baudrate');
/*REMOVE*/ //console.log('onDeviceChange '+el.value);
    deviceClose();
    if (el.value !== '')
        deviceOpen(el.value, elbr.value);
}

function socketClose() {
/*REMOVE*/ //console.log('socketClose');
    if (device.socket && device.socket.connected)
        device.socket.disconnect();
}
function socketOpen(url) {
/*REMOVE*/ //console.log('socketOpen '+url);
    if (!device.socket) {
        device.socket = new WebSocket("ws://" + url);
        if (device.socket) {
            device.socket.binaryType = "arraybuffer";
            device.socket.addEventListener('open', function(e) { onSocketConnect(e); } );
            device.socket.addEventListener('close', function(e) { onSocketDisconnect(e); } );
            //device.socket.addEventListener('message', function(e) { onSocketMessage(e); } );
            device.socket.addEventListener('message', function(e) { onmessageEval(e); } );
            Console.debug('command', 'SOCKET', 'connect ' + url);
        }
    } else {
        device.socket.io.uri = url;
        Console.debug('command', 'SOCKET', 'connect ' + url);
        device.socket.connect();
    }
}
function onSocketChange(e) {
/*REMOVE*/ //console.log('onSocketChange '+this.value);
    const host = this.options[this.selectedIndex];
    let url = this.value;
    if (host.textContent.match(REMOTE_AGENT)) {
        url = prompt('Please enter Url from Remote Server',
            url ? url : (window.location.protocol + '//' + LOCAL_HOST + ':8991'));
        if (url) {
            this.options[this.selectedIndex].innerHTML = REMOTE_AGENT + SEPARATOR + url;
            this.options[this.selectedIndex].value = url;
        } else {
            url = this.value = '';
        }
    }
    deviceClose();
    if (this.value !== '')
        socketOpen(this.value);
    else 
		socketClose();
}
function onSocketConnect(e) {
/*REMOVE*/ //console.log('onSocketConnect '+this.io.uri);
    device.host = e.currentTarget.url;//this.io.uri;
    Console.debug('event', 'SOCKET', 'connected ' + device.host);
    device.name = 'u-blox HPG device';
    deviceStatusUpdate();
    // configure the agent and enumerate the devices
    USTART.statusLed(/*clear*/);
    /*
    socketCommand('log off');
    action('list');

	let el = document.getElementById('device_baudrate');
    if (el) el.parentNode.style.display = 'block';
    el = document.getElementById('device_name');
    if (el) el.parentNode.style.display = 'block';*/
    device.status = 'opened';
    //Console.debug('event', 'DEVICE', 'opened ' + device.name + ' ' + device.baudrate, obj);
    deviceStatusUpdate();
    deviceIdentification();                    
}

function onSocketDisconnect(e) {
/*REMOVE*/ //console.log('onSocketDisconnect');
    Console.debug('event', 'SOCKET', 'disconnected');
    device.host = '';
    deviceStatusUpdate();
    let el = document.getElementById('device_host');
    if (el) el.value = '';
    deviceSelectList([]);
    USTART.statusLed('error');

/*	el = document.getElementById('device_baudrate');
    if (el) el.parentNode.style.display = 'none';
    el = document.getElementById('device_name');
    if (el) el.parentNode.style.display = 'none';*/
}

function onSocketMessage(e) {
    if (e && (e.indexOf('{') === 0)) {
        const obj = JSON.parse(e);
        if (obj.D !== undefined) {
            USTART.statusLed('data');
        } else {
            Console.debug('event', 'AGENT', 'json ' + e, obj);
            
            if (obj.Ports) {
                if (obj.Network === true) device.ports_net = obj.Ports;
                else                      device.ports_hw  = obj.Ports;
                const list = device.ports_hw.concat(device.ports_net);
                //Console.debug('event', 'DEVICE', 'list updated', obj);
                deviceSelectList(list);
            } else if (obj.Error) {
                // Console.debug('event', 'ERROR', obj.Error, obj);
            } else if (obj.Cmd) {
                if (obj.Cmd == 'Open') {
                    if ((device.status === 'opening') && (device.name === obj.Port) && (device.baudrate === obj.Baud)) {
                        device.status = 'opened';
                        //Console.debug('event', 'DEVICE', 'opened ' + device.name + ' ' + device.baudrate, obj);
                        deviceStatusUpdate();
                        deviceIdentification();
                        // hide it
                        const el = document.getElementById('block-uos-uos-dropdown-login');
                        if (el) el.style.display = 'none';
                    }
                }
                else if ((obj.Cmd == 'Close') && (device.name == obj.Port)) {
                    if ((device.status === 'closing') && (device.name === obj.Port) && (device.baudrate === obj.Baud)) {
                        //Console.debug('event', 'DEVICE', 'closed ' + device.name, obj);
                        device.name = '';
                        device.status = '';
                        deviceStatusUpdate();
                    }
                }
                if (obj.Cmd == 'OpenFail') {
                    if ((device.status === 'opening') && (device.name === obj.Port) && (device.baudrate === obj.Baud)) {
                        //Console.debug('event', 'DEVICE', 'failed ' + device.name, obj);
                        device.status = 'failed';
                        device.name = '';
                        deviceStatusUpdate();
                    }
                }
            }
        }
    } else if (e) {
        const str = e.toString();
        Console.debug('event', 'AGENT', 'string "' + str + '"');
    }
}
function socketCommand(data) {
/*    if (data && (data !== '')) {
        if (!device.socket || (device.host === '')) throw new Error('no Socket');
        //device.socket.emit('command', data);
        device.socket.send(data);
    }*/
}
function socketSend(messages){
    if (!device.socket/*       || (device.host === '')*/) throw new Error('no Socket');
    //if ((device.name === '') || (device.status !== 'opened')) throw new Error('no Device');
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
        //device.socket.emit('command', 'sendb64 ' + device.name + ' ' + btoa(message.data));
        len += message.data.length;
    }
    return len;
}
// Protocol
// ------------------------------------------------------------------------------------
function onmessageEval(evt) {
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
        Console.debug('event', 'AGENT', evt.data);
        Console.update();
    }
}

/* END OF MODULE */ return {
    deviceInit:     deviceInit,
    deviceUninit:   deviceUninit,
    socketCommand:  socketCommand,
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

