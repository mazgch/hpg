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

import { Message }  from '../message.js';
import { Protocol } from './protocol.js';

export class ProtocolNmea extends Protocol {

    parse(data, i) {
        const len = data.length; 
        const hex = '0123456789ABCDEF';
        if (i >= len) return Protocol.WAIT;
        let by = data.charCodeAt(i++);
        if (36 !== by) return Protocol.NOTFOUND; // $
        let crc = 0;
        while (i < len) {
            by = data.charCodeAt(i++);
            if ((32 > by) || (126 < by)) return Protocol.NOTFOUND; // not printable
            if (42 === by) break; // *
            crc ^= by;
        }
        if (i >= len) return Protocol.WAIT;
        by = data.charCodeAt(i++);
        if (hex.charCodeAt((crc>>4)&0xF) !== by) return Protocol.NOTFOUND;
        if (i >= len) return Protocol.WAIT;
        by = data.charCodeAt(i++);
        if (hex.charCodeAt(crc&0xF) !== by) return Protocol.NOTFOUND;
        if (i >= len) return Protocol.WAIT;
        by = data.charCodeAt(i++);
        if (13 !== by) return Protocol.NOTFOUND; // \r
        if (i >= len) return Protocol.WAIT;
        by = data.charCodeAt(i++);
        if (10 !== by) return Protocol.NOTFOUND; // \n
        return i;
    }

    process(data, type) {
        let message = new Message('NMEA', data, type, false);
        let m;
        let msgSpec;
        let payload;
        if (m = message.data.match(/\$(G[ABLNPQ])([A-Z]{3}),(.*)\*[0-9A-F]{2}\r\n$/)) { // Standard Nav device
            message.talker = m[1];
            message.id = m[2];
            payload = m[3];
            message.name = message.talker + message.id;
            msgSpec = ProtocolNmea.spec[message.id];
        } else if (m = message.data.match(/\$PUBX,(\d{2}),(.*)\*[0-9A-F]{2}\r\n$/i)) { // P:proprietary PUBX
            message.pubxid = _pad(m[1],2,16);
            message.id = 'PUBX,'+message.pubxid;
            payload = m[2];
            message.name = message.id;
            msgSpec = ProtocolNmea.spec[message.id];
        } else if (m = message.data.match(/\$([A-OQ-Z][A-Z])(G[ABNLPQ]Q),(.*)\*[0-9A-F]{2}\r\n$/)) { // Poll request to nav device
            message.talker = m[1];
            message.id = m[2];
            payload = m[3];
            message.name = message.talker + message.id;
            msgSpec = ProtocolNmea.spec['Q'];
        }
        if (msgSpec) {
            message.descr = msgSpec.descr;
            message.spec = msgSpec.spec;
            if (msgSpec.spec && (payload !== ''))
                message.fields = Protocol.decode(payload, msgSpec.spec);
        }
        message.text = message.data.replace(/[\r\n]/gm, '');
        return message;
    }

    fromText(data) {
        let m;
        if (m = data.match(/^\$[A-Z]{4,}\d*/i)) {
            let end = data.match(/\*[0-9A-F]{2}$/); // strip crc and cr/lf
            end = end ? -end[0].length : undefined;
            data = data.slice(1, end);
            return this.make(data);
        } 
    }

    make(data) {
        data = conv(data);
        let crc = 0;
        const len = data.length;
        for (let i = 0; i < len; i ++)
            crc = crc ^ data.charCodeAt(i);
        crc &= 0xFF;
        crc = ('0'+crc.toString(16).toUpperCase()).slice(-2);
        data = '$' + data + '*' + crc + "\r\n"
        return this.process(data, Message.TYPE_INPUT);
    }

    hint(spec) {
        return Protocol.hint(spec, ',');
    }
    
    // valid types:
    // S:String, C:Char, *:Anything
    // I:Integer, U:Unsigned, R:Real/Float, 
    // L:Lat/Long, T:Time, D:Date, 
    // [xx]: Array, add optional size xx
    static spec = {
        DTM: { 
            suggest:false, 
            descr: 'GNSS Satellite Fault Detection',
            spec:[  { name:'datum',                 type:'S'                            },
                    { name:'subDatum',              type:'S'                            },
                    { name:'offsetLat',             type:'R', unit:'min'                }, 
                    { name:'latI',                  type:'C'                            }, // N/S
                    { name:'offsetLong',            type:'R', unit:'min'                }, 
                    { name:'longI',                 type:'C'                            }, // E/W
                    { name:'offsetAlt',             type:'R', unit:'m'                  },
                    { name:'refDatum',              type:'S'                            } ] },
        GBS: { 
            suggest:false, 
            descr:  'GNSS Satellite Fault Detection',
            spec:[  { name:'time',                  type:'T'                            },
                    { name:'errLat',                type:'R', unit:'m'                  },
                    { name:'errLon',                type:'R', unit:'m'                  },
                    { name:'errAlt',                type:'R', unit:'m'                  },
                    { name:'svid',                  type:'U'                            },
                    { name:'prob',                  type:'R'                            },
                    { name:'bias',                  type:'R', unit:'m'                  },
                    { name:'stddev',                type:'R', unit:'m'                  },
                    { name:'systemId',              type:'U'                            },
                    { name:'signalId',              type:'U'                            } ] },
        GGA: { 
            suggest:false, 
            descr:  'Global positioning system fix data',
            spec:[  { name:'time',                  type:'T'                            },
                    { name:'latN',                  type:'L'                            }, 
                    { name:'latI',                  type:'C'                            }, // N/S
                    { name:'longN',                 type:'L'                            }, 
                    { name:'longI',                 type:'C'                            }, // E/W
                    { name:'quality',               type:'I'                            },
                    { name:'numSV',                 type:'U'                            },
                    { name:'hDop',                  type:'R'                            },
                    { name:'msl',                   type:'R', unit:'m'                  },
                    {/*name:'mslI',*/               type:'C'                            },
                    { name:'gsep',                  type:'R', unit:'m'                  }, 
                    {/*name:'sepI',*/               type:'C'                            },
                    { name:'diffAge',               type:'I', unit:'s'                  },
                    { name:'diffStation',           type:'S'                            } ] },
        GLL:{ 
            suggest:false, 
            descr:  'Latitude and longitude, with time of position fix and status',
            spec:[  { name:'latN',                  type:'L'                            }, 
                    { name:'latI',                  type:'C'                            },
                    { name:'longN',                 type:'L'                            }, 
                    { name:'longI',                 type:'C'                            },
                    { name:'time',                  type:'T'                            },
                    { name:'status',                type:'S'                            },
                    { name:'posMode',               type:'S'                            } ] },
        EIGNQ: { 
            descr:  'Poll a standard message',
            spec:[  { name:'msgId',                 type:'S'                            } ] },
        GNS:{ 
            suggest:false, 
            descr:  'GNSS fix data' ,
            spec:[  { name:'time',                  type:'T'                            },
                    { name:'latN',                  type:'L'                            }, 
                    { name:'latI',                  type:'C'                            },
                    { name:'longN',                 type:'L'                            }, 
                    { name:'longI',                 type:'C'                            },
                    { name:'posMode',               type:'S'                            }, // two posModec chars for GPS + GLONASS
                    { name:'numSV',                 type:'U'                            },
                    { name:'hDop',                  type:'R'                            },
                    { name:'msl',                   type:'R', unit:'m'                  }, 
                    { name:'gsep',                  type:'R', unit:'m'                  }, 
                    { name:'diffAge',               type:'I', unit:'s'                  },
                    { name:'diffStation',           type:'S'                            },
                    { name:'navStatus',             type:'C'                            } ] },
        GRS:{ 
            suggest:false, 
            descr:  'GNSS Range Residuals',
            spec:[  { name:'time',                  type:'T'                            },
                    { name:'mode',                  type:'U'                            },
                    { name:'residual',              type:'R[12]', unit:'m'              },
                    { name:'systemId',              type:'U'                            },
                    { name:'signalId',              type:'U'                            } ] },
        GSA:{ 
            suggest:false, 
            descr:  'GNSS DOP and Active Satellites',
            spec:[  { name:'opMode',                type:'S'                            },
                    { name:'navMode',               type:'U'                            },
                    { name:'sv',                    type:'U[12]'                        },
                    { name:'pDop',                  type:'R'                            },
                    { name:'hDop',                  type:'R'                            },
                    { name:'vDop',                  type:'R'                            },
                    { name:'systemId',              type:'U'                            } ] },
        GST:{ 
            suggest:false, 
            descr:  'GNSS Pseudo Range Error Statistics',
            spec:[  { name:'time',                  type:'T'                            },
                    { name:'rangeRms',              type:'R', unit:'m'                  },
                    { name:'stdMajor',              type:'R', unit:'m'                  },
                    { name:'stdMinor',              type:'R', unit:'m'                  },
                    { name:'orient',                type:'R', unit:'deg'                },
                    { name:'stdLat',                type:'R', unit:'m'                  },
                    { name:'stdLong',               type:'R', unit:'m'                  },
                    { name:'stdAlt',                type:'R', unit:'m'                  } ] },
        GSV:{ 
            suggest:false, 
            descr:  'GNSS Satellites in View',
            spec:[  { name:'numMsg',                type:'U'                            },
                    { name:'msgNum',                type:'U'                            },
                    { name:'numSV',                 type:'U'                            },
                    { name:'svs', repeat:'min(numSV-(msgNum-1)*4,4)', spec: [
                        { name:'sv',                type:'U'                            },
                        { name:'elv',               type:'U', unit:'deg'                },
                        { name:'az',                type:'U', unit:'deg'                },
                        { name:'cno',               type:'U', unit:'dBHz'               } ] },
                    { name:'signalId',              type:'U'                            } ] },
        RMC:{ 
            suggest:false, 
            descr: 'Recommended Minimum data',
            spec:[  { name:'time',                  type:'T'                            },
                    { name:'status',                type:'C'                            },
                    { name:'latN',                  type:'L'                            }, 
                    { name:'latI',                  type:'C'                            },
                    { name:'longN',                 type:'L'                            },
                    { name:'longI',                 type:'C'                            },
                    { name:'spdKn',                 type:'R', unit:'knots'              },
                    { name:'cog',                   type:'R', unit:'deg'                },
                    { name:'date',                  type:'D'                            },
                    { name:'mv',                    type:'R', unit:'deg'                },
                    { name:'mvI',                   type:'C'                            }, // E/W
                    { name:'posMode',               type:'S'                            },
                    { name:'navStatus',             type:'S'                            } ] },
        TXT:{ 
            suggest:false, 
            descr:  'Text Transmission',
            spec:[  { name:'msg',                   type:'U'                            },
                    { name:'num',                   type:'U'                            },
                    { name:'lvl',                   type:'U'                            },
                    { name:'infTxt',                type:'*'                            } ] },
        VLW:{ 
            suggest:false, 
            descr:  'Dual ground/water distance',
            spec:[  { name:'twd',                   type:'R', unit:'nm'                 }, 
                    {/*name:'twdUnit',*/            type:'C'                            },
                    { name:'wd',                    type:'R', unit:'nm'                 }, 
                    {/*name:'wdUnit',*/             type:'C'                            },
                    { name:'tgd',                   type:'R', unit:'nm'                 }, 
                    {/*name:'tgdUnit',*/            type:'C'                            },
                    { name:'gd',                    type:'R', unit:'nm'                 }, 
                    {/*name:'gdUnit',*/             type:'C'                            } ] },
        VTG:{ 
            suggest:false, 
            descr:  'Track made good and speed over ground',
            spec:[  { name:'cog',                   type:'R', unit:'deg'                }, 
                    {/*name:'cogI',*/               type:'C'                            },
                    { name:'cogm',                  type:'R', unit:'deg'                }, 
                    {/*name:'cogmI',*/              type:'C'                            },
                    { name:'spdKn',                 type:'R', unit:'knots'              }, 
                    {/*name:'spdKnI',*/             type:'C'                            },
                    { name:'spdKm',                 type:'R', unit:'km/h'               }, 
                    {/*name:'spdKmI',*/             type:'C'                            },
                    { name:'posMode',               type:'S'                            } ] },
        ZDA:{ 
            suggest:false, 
            descr:  'Time and Date',
            spec:[  { name:'time',                  type:'T'                            },
                    { name:'day',                   type:'U'                            },
                    { name:'month',                 type:'U'                            },
                    { name:'year',                  type:'U'                            },
                    { name:'ltzh',                  type:'I'                            } ] },
        
        // Proprietary Sentences aka PUBX
        'PUBX,00':{ 
            suggest:false, 
            descr:  'Lat/Long Position Data',
            spec:[  { name:'time',                  type:'T'                            },
                    { name:'latN',                  type:'L'                            }, 
                    { name:'latI',                  type:'C'                            },
                    { name:'longN',                 type:'L'                            }, 
                    { name:'longI',                 type:'C'                            },
                    { name:'altRef',                type:'R', unit:'m'                  },
                    { name:'navStatus',             type:'S'                            }, 
                        // e.g. NF:No Fix DR:Dead reckoning only solution
                        // G2:Stand alone 2D solution G3:Stand alone 3D solution
                        // D2:Differential 2D solution D3:Differential 3D solution
                        // RK:Combined GPS + dead reckoning solution TT:Time only solution
                    { name:'hAcc',                  type:'R', unit:'m'                  },
                    { name:'vAcc',                  type:'R', unit:'m'                  },
                    { name:'sog',                   type:'R', unit:'km/h'               },
                    { name:'cog',                   type:'R', unit:'deg'                },
                    { name:'vVel',                  type:'R', unit:'m/s'                },
                    { name:'diffAge',               type:'I', unit:'s'                  },
                    { name:'hDop',                  type:'R'                            },
                    { name:'vDop',                  type:'R'                            },
                    { name:'tDop',                  type:'R'                            },
                    { name:'numSvs',                type:'U'                            },
                    {                               type:'S'                            },
                    { name:'DRused',                type:'U'                            } ] },
        'PUBX,03':{
            suggest:false, 
            descr:  'Satellite Status',
            spec:[  { name:'numSV',                 type:'U'                            },
                    { name:'svs',                   spec: [
                        { name:'sv',                type:'U'                            },
                        { name:'status',            type:'U'                            }, // U:Used, e:Ephemeris but not used, -:Not used
                        { name:'az',                type:'U', unit:'deg'                },
                        { name:'elv',               type:'U', unit:'deg'                },
                        { name:'cno',               type:'U', unit:'dBHz'               },
                        { name:'lck',               type:'U', unit:'s'                  } ] } ] },
        'PUBX,04':{ 
            suggest:false, 
            descr:  'Time of Day and Clock Information',
            spec:[  { name:'time',                  type:'T', unit:'hhmmss.ss'          },
                    { name:'date',                  type:'D', unit:'ddmmyy'             },
                    { name:'utcTow',                type:'R', unit:'s'                  },
                    { name:'utcWk',                 type:'U', unit:'weeks'              },
                    { name:'leapSec',               type:'S', unit:'s'                  },
                    { name:'clkBias',               type:'R', unit:'ns'                 },
                    { name:'clkDrift',              type:'R', unit:'ns/s'               },
                    { name:'tpGran',                type:'R', unit:'ns'                 } ] },
        'PUBX,40':{
            descr:  'Set NMEA message output rate',
            spec:[  { name:'msgID',                 type:'Q'                            },
                    { name:'rate',                  type:'U[6]'                         } ] },
        'PUBX,41':{ 
            descr: 'Set Protocols and Baudrate',
            spec:[  { name:'portId',                type:'U'                            },
                    { name:'inProto',               type:'X'                            },
                    { name:'outProto',              type:'X'                            },
                    { name:'baudrate',              type:'U', unit:'bits/s'             },
                    { name:'autobauding',           type:'U'                            } ] },
    };
}
