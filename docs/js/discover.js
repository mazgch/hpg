"use strict";

const MAXTIME = 5000;
const RETRY = 10000;

function a(ip, host) {
  return '<a href="http://' + ip + '">' + host + '</a>';
}

function report(ip, msg) {
  let li = document.getElementById(ip)
  if (msg == undefined) {
    if (li != undefined && !li.innerHTML.match(/^Found/)) 
      li.parentNode.removeChild(li)
  } else {
    if (li == undefined) {
      let ul = document.getElementById('list')
      li = document.createElement('li')
      li.id = ip
      li.innerHTML = msg
      ul.appendChild(li)
    } else {
      let ul = li.parentNode
      li = ul.removeChild(li)
      li.innerHTML = msg
      ul.insertBefore(li, ul.firstChild);
    }
  }
}

function testIp(ip){
  if (!document.getElementById(ip)) {
    report(ip, 'IP ' + ip+ ' connecting...')
    let ws = new WebSocket((window.location.protocol == 'https') ? 'wss://' : 'ws://' + ip + ':2101')
    if (ws != undefined) {
      function _onDone(msg) {
        report(ip, undefined)
      }
      function _onOpen(msg) {
        report(ip, 'IP ' + ip + ' indentifying')
      }
      function _onMessage(msg) {
        if (typeof(msg.data) == 'string') {
          const m = msg.data.match(/^Connected to u-blox-hpg-([a-z0-9]{6})/)
          if ((m != undefined) && (m.length == 2)) {
            let host = "u-blox-HPG-" + m[1]
            report(ip, 'Found ' + a(host,host) + ' with IP ' + a(ip,ip) + ', you can now ' + a(ip+'/param"','setup') + ' or ' + a(ip+'/uc.html"','monitor') + ' this device.')
            ws.close() // we are done
          }
        }
      }
      ws.addEventListener('open',_onOpen)
      ws.addEventListener('error',_onDone)
      ws.addEventListener('close',_onDone)
      ws.addEventListener('message',_onMessage)
    }
  }
}
  
function testNet() {
  let el = document.getElementById("hint")
  if (el) el.removeAttribute("hidden")
  // iOS Personal HotSpot uses 172.20.10.0/4 so 172.20.10.0 - 172.20.10.15
  for (let i = 0; i < 16; i ++) {
    testIp("172.20.10." + i)
  }
  // Android WiFi Thetering uses 192.168.42.1/24 so 192.168.42.2 - 192.168.42.254 
  for (let i = 1; i <= 254; i ++) {
    testIp("192.168.42." + i)
  }
  let li = document.getElementById("local")
  if (li && li.value) { 
    let m = li.value.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})(-(\d{1,3}))?$/)
    if ((m != undefined) && ((m.length == 3) || (m.length == 5))) {
      let ip = m[1]
      let from = Number(m[2])
      let to = (m.length == 5) ? Number(m[4]) : from
      for (let i = from; i < to; i ++) {
        testIp(ip + i)
      }
    }
  }
}
