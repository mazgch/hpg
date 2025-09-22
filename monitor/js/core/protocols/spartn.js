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

import { crcTable4, crcTable8, crcTable16, crcTable24, crcTable32 } from '../crcTables.js';
import { Message }  from '../message.js';
import { Protocol } from './protocol.js';

export class ProtocolSpartn extends Protocol {

    parse(data, i) {
        const len = data.length; 
        if (i >= len) return Protocol.WAIT;
        let by = data.charCodeAt(i);
        if (0x73 !== by) return Protocol.NOTFOUND;
        if (i + 4 >= len) return Protocol.WAIT;
        let crc4 = 0;
        by = data.charCodeAt(i+1);
        let frameStart = by << 16;
        crc4 = crcTable4[by ^ crc4]
        by = data.charCodeAt(i+2);
        frameStart += by << 8;
        crc4 = crcTable4[by ^ crc4]
        by = data.charCodeAt(i+3);
        frameStart += by;
        crc4 = crcTable4[(by & 0xF0) ^ crc4]
        let lenData     = (frameStart & 0x01FF80) >> 7;           // E1 encrypted
        const e1        = (frameStart & 0x000040) >> 6;           // E1 encrypted
        const crcType   = (frameStart & 0x000030) >> 4;           // MCT2
        const fc4       = (frameStart & 0x00000F) >> 0;           // FC4 header crc 4
        if (crc4 != fc4) return Protocol.NOTFOUND;
        if (i >= len) return Protocol.WAIT;              // must match min header message 
        by = data.charCodeAt(i+4);
        const tt1 = ((by & 0x8) >> 3)           // TT1 ttag size 16 / 32 bits
        let lenHead = 8 + (tt1 ? 2 : 0) + (e1 ? 2 : 0);
        if (i + lenHead >= len) return Protocol.WAIT;    // must have header 
        if (e1) {
            by = data.charCodeAt(i + lenHead - 1); // check auth indicator in payload
            const ai3 = (by & 0x38) >> 3;
            const al3 = (by & 0x07) >> 0;
            if (ai3 > 1) {
                const lutAuthSize = [ 8, 12, 16, 32, 64, 0, 0, 0 ];
                lenData += lutAuthSize[al3]; // size of auth block 
            }
        }
        const lenCrc = crcType + 1;
        let crcBits = lenCrc * 8;
        const crcTable = { 
            8:  crcTable8,
            16: crcTable16, 
            24: crcTable24, 
            32: crcTable32 
        }[crcBits]
        const crcMask = [ 0xFF, 0xFFFF, 0xFFFFFF, 0xFFFFFFFF ];
        let l = i + lenData + lenHead + lenCrc;
        if (l >= len) return Protocol.WAIT;
        i ++; // skip the 0x73
        let crc = 0;
        while (i < l) {
            by = data.charCodeAt(i++);
            const ix = (by ^ (crc >> (crcBits - 8)));
            crc =  crcTable[ix] ^ (crc << 8);
            crc &= crcMask[crcType];
        }
        if (crc != 0) return Protocol.NOTFOUND;
        return l;
    }

    process(data, type) {
        let message = new Message('SPARTN', data, type, true);
        message.spartnType    = (message.data.charCodeAt(1) & 0xF7) >> 1;
        message.spartnSubType = (message.data.charCodeAt(4) & 0xF0) >> 4;
        let msgSpec;
        const id = mapType[message.spartnType];
        if (id !== undefined) {
            if (this.spec[id]) msgSpec = ProtocolSpartn.spec[id]; // try to get the descr just by type
            const subId = mapSubType[message.spartnType]?.[message.spartnSubType];
            if (subId !== undefined) {
                id += "-" + subId;
            } else {
                id += "-" + message.spartnSubType;
            }
            message.id = id;
            if (this.spec[id]) msgSpec = ProtocolSpartn.spec[id];
        } else {
            message.id = message.spartnType + "-" + message.spartnSubType;
        }
        message.name = message.id;
        message.text = message.name;
        if (msgSpec) {
            ///message.spec = msgSpec.spec;
            message.descr = msgSpec.descr;
            if (msgSpec.spec && (message.data.length > 4)) {
                //let payload = message.data.slice(3, -3);
                //message.fields = Protocol.decode(payload, msgSpec.spec);
            }
        }
        return message;
    } 

    static spec = {
        // type 0: GNSS Orbit, Clock, Bias (OCB) messages
        'OCB'             : { descr: 'GNSS Orbit, Clock, Bias'                              },
        'OCB-GPS'         : { descr: 'GPS Orbit, Clock, Bias'                               },
        'OCB-GLONASS'     : { descr: 'Glonass Orbit, Clock, Bias'                           },
        'OCB-GALILEO'     : { descr: 'Galileo Orbit, Clock, Bias'                           },
        'OCB-BEIDOU'      : { descr: 'BeiDou Orbit, Clock, Bias'                            },
        'OCB-QZSS'        : { descr: 'QZSS Orbit, Clock, Bias'                              },
        // type 1: High-precision atmosphere correction (HPAC) messages 
        'HPAC'            : { descr: 'GNSS High-precision atmosphere correction'            }, 
        'HPAC-GPS'        : { descr: 'GPS High-precision atmosphere correction'             }, 
        'HPAC-GLONASS'    : { descr: 'Glonass High-precision atmosphere correction'         },  
        'HPAC-GALILEO'    : { descr: 'Galileo High-precision atmosphere correction'         },
        'HPAC-BEIDOU'     : { descr: 'BeiDou High-precision atmosphere correction'          },
        'HPAC-QZSS'       : { descr: 'QZSS High-precision atmosphere correction'            },
        // type 2: Geographic Area Definition (GAD) messages 
        'GAD'             : { descr: 'Geographic Area Definition'                           }, 
        'GAD-MSG0'        : { descr: 'Geographic Area Definition'                           }, 
        // type 3: Basic-peecision atmosphere correction (BPAC) messages 
        'BPAC'            : { descr: 'Basic-precision atmosphere correction'                }, 
        'BPAC-POLYNOMIAL' : { descr: 'Basic-precision atmosphere correction polynomial'     }, 
        // type 4: Encryption and Authentication Support (EAS) messages 
        'EAS'             : { descr: 'Encryption and Authentication Support'                }, 
        'EAS-DYNAMICKEY'  : { descr: 'Dynamic Key'                                          }, 
        'EAS-GROUPAUTH'   : { descr: 'Group Authentication'                                 },
        // type 120: Proprietary messages  
        'PROP'            : { descr: 'Proprietary'                                          }, 
        'PROP-SAPCORDA'   : { descr: 'Proprietary Sapcorda'                                 }, 
        'PROP-UBLOX'      : { descr: 'Proprietary u-blox AG'                                }, 
        'PROP-SWIFT'      : { descr: 'Proprietary Swift Navigation'                         }
    };
};

const mapType = {
    0:'OCB',  1:'HPAC',  2:'GAD',  3:'BPAC',  4:'EAS',  120:'PROP', 
}

const mapSubType = {
    0/*OCB*/:     { 0:'GPS',  1:'GLONASS',  2:'GALILEO',  3:'BEIDOU',  4:'QZSS'         },
    1/*HPAC*/:    { 0:'GPS',  1:'GLONASS',  2:'GALILEO',  3:'BEIDOU',  4:'QZSS'         },
    2/*GAD*/:     { 0:'MSG0'                                                            },
    3/*BPAC*/:    { 0:'POLYNOMIAL'                                                      },
    4/*EAS*/:     { 0:'DYNAMICKEY',  1:'GROUPAUTH'                                      },
    120/*PROP*/:  { 0:'SAPCORDA',    1:'UBLOX',  2:'SWIFT'                              }
}