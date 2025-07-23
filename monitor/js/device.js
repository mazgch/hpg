// Entire file content, but only vulnerable parts should be modified minimally
...
    const cookie = { ip:device.ip, ws:device.ws, name:device.name, };
    document.cookie = 'device=' + JSON.stringify(cookie) + '; expires=' + date.toGMTString() + '; path=/; Secure';
    USTART.statusLed(/*clear*/);
    deviceStatusUpdate();
    deviceIdentification();                    
}

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
            // Sanitize device.name before using it in innerHTML
            const sanitizedDeviceName = device.name.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            USTART.tableEntry('dev_name', '<a target="_blank" href="http://'+device.ip+'">'+sanitizedDeviceName+'</a>',true);
        }
        Console.debug('event', 'TEXT', evt.data);
    }
    if (device.timeout) {
        clearTimeout(device.timeout);
        device.timeout = undefined;
    }
    device.timeout = setTimeout( onSocketError, 5000)
}
...