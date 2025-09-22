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

import { formatDateTimeShort}   from '../utils.js'
import { crcTable24 }           from '../crcTables.js';
import { Message }              from '../message.js';
import { Protocol }             from './protocol.js';

export class ProtocolRtcm3 extends Protocol {

    parse(data, i) {
        const len = data.length; 
        if (i >= len) return Protocol.WAIT;
        let by = data.charCodeAt(i);
        if (0xD3 !== by) return Protocol.NOTFOUND;
        if (i+1 >= len) return Protocol.WAIT;
        by = data.charCodeAt(i+1);
        if ((0xFC & by) !== 0) return Protocol.NOTFOUND;
        let l = (by & 0x3) << 8;
        if (i+2 >= len) return Protocol.WAIT;
        by = data.charCodeAt(i+2);
        l += by + 6 + i;
        if (l > len) return Protocol.WAIT;
        let crc = 0x000000;
        while (i < l) {
            by = data.charCodeAt(i++);
            const ix = (by ^ (crc >> 16));
            crc = ((crc << 8) & 0xffffff) ^ crcTable24[ix];
        }
        if (crc != 0) return Protocol.NOTFOUND;
        return l;
    }

    process(data, type) {
        let message = new Message('RTCM3', data, type, true);
        message.id = (message.data.charCodeAt(4) >> 4) + 
                    (message.data.charCodeAt(3) << 4);
        message.name = message.id.toString();
        if (message.id === 4072) {
            message.subtype = ((message.data.charCodeAt(4) & 0xf) << 8) + 
                                message.data.charCodeAt(5);
            message.name += '.' + message.subtype.toString();
        } 
        message.text = message.name;
        const msgSpec = ProtocolRtcm3.spec[message.id];
        if (msgSpec) {
            message.spec = msgSpec.spec;
            message.descr = msgSpec.descr;
            if (msgSpec.spec && (message.data.length > 8)) {
                let payload = message.data.slice(
                            (message.id === 4072) ? 6 : 4, -3); // 4.5 / 6 bytes header, -3 bytes CRC24q
                let ofsBit = (message.id === 4072) ? 0 : 4;
                message.fields = Protocol.decode(payload, msgSpec.spec, false, ofsBit);
                if ((message.id === 1029) && message.fields){
                    const strDate = mjdToString(message.fields.mjdDay, message.fields.mjdSec);
                    message.text += ' ' + message.fields.refSta + ' ' + strDate + ' Message: "' + message.fields.txtUtf8 + '"';
                }
            }
        }
        return message;
    }
        
    static spec = {
        1001: { descr: 'L1-only GPS RTK observables'                                                }, 
        1002: { descr: 'Extended L1-only GPS RTK observables'                                       }, 
        1003: { descr: 'L1 & L2 GPS RTK observables'                                                }, 
        1004: { descr: 'Extended L1 & L2 GPS RTK observables'                                       }, 
        1005: { descr: 'Stationary RTK reference station ARP'                                       }, 
        1006: { descr: 'Stationary RTK reference station ARP with antenna height'                   }, 
        1007: { descr: 'Antenna descriptor'                                                         },
        1009: { descr: 'L1-only GLONASS RTK observables'                                            },
        1010: { descr: 'Extended L1-only GLONASS RTK observables'                                   }, 
        1011: { descr: 'L1 & L2 GLONASS RTK observables'                                            }, 
        1012: { descr: 'Extended L1 & L2 GLONASS RTK observables'                                   },
        1074: { descr: 'GPS MSM4'                                                                   },
        1077: { descr: 'GPS MSM7'                                                                   },
        1084: { descr: 'GLONASS MSM4'                                                               },
        1087: { descr: 'GLONASS MSM7'                                                               },
        1094: { descr: 'Galileo MSM4'                                                               },
        1097: { descr: 'Galileo MSM7'                                                               },
        1124: { descr: 'BeiDou MSM4'                                                                },
        1127: { descr: 'BeiDou MSM7'                                                                },
        4072: { descr: 'u-blox proprietary message'                                                 },
        '4072.0': { descr: 'u-blox sub-type 0: Reference station PVT'                               },
        '4072.1': { descr: 'u-blox sub-type 1: Additional reference station information'            },
        
        // not used by u-blox
        // https://www.use-snip.com/kb/knowledge-base/rtcm-3-message-list/
        1008: { descr: 'Antenna Descriptor and Serial Number'                                       },
        1013: { descr: 'System Parameters, time offsets, lists of messages sent'                    },
        1014: { descr: 'Network Auxiliary Station Data'                                             },
        1015: { descr: 'GPS Ionospheric Correction Differences'                                     },
        1016: { descr: 'GPS Geometric Correction Differences'                                       },
        1017: { descr: 'GPS Combined Geometric and Ionospheric Correction Differences'              },
        1019: { descr: 'GPS Broadcast Ephemeris (orbits)'                                           },
        1020: { descr: 'GLONASS Broadcast Ephemeris (orbits)'                                       },
        1021: { descr: 'Helmert / Abridged Molodenski Transformation Parameters'                    },
        1022: { descr: 'Molodenski-Badekas Transformation Parameters'                               },
        1023: { descr: 'Residuals, Ellipsoidal Grid Representation'                                 },
        1024: { descr: 'Residuals, Plane Grid Representation'                                       },
        1025: { descr: 'Projection Parameters, Projection Types other than Lambert Conic Conformal' },
        1026: { descr: 'Projection Parameters, Projection Type LCC2SP (Lambert Conic Conformal'     },
        1027: { descr: 'Projection Parameters, Projection Type OM (Oblique Mercator)'               },
        1029: { descr: 'Unicode Text String (used for human readable text)', 
                spec:[  { name:'refSta',         type:'u12'                                         },     // bit 12..23: Ref Station Id
                        { name:'mjdDay',         type:'u16'                                         },     // bit 24..47: MJD - day of year
                        { name:'mjdSec',         type:'u17'                                         },     // bit 48..56: UTC - sec of day
                        { name:'nUnicode',       type:'u7'                                          },     // bit 57..63: unicode Chars,
                        { name:'nUtf8',          type:'U1'                                          },     // num chars in utf8 (N)
                        { name:'txtUtf8',        type:'S*'                                          } ]},  // utf8(N)
        1030: { descr: 'GPS Network RTK Residual Message'                                           },
        1031: { descr: 'GLONASS Network RTK Residual'                                               },
        1032: { descr: 'Physical Reference Station Position'                                        },
        1033: { descr: 'Receiver and Antenna Descriptors'                                           },
        1034: { descr: 'GPS Network FKP Gradient'                                                   },
        1035: { descr: 'GLONASS Network FKP Gradient'                                               },
        1036: { descr: 'Not defined at this time'                                                   },
        1037: { descr: 'GLONASS Ionospheric Correction Differences'                                 },
        1038: { descr: 'GLONASS Geometric Correction Differences'                                   },
        1039: { descr: 'GLONASS Combined Geometric and Ionospheric Correction Differences'          },
        1042: { descr: 'BDS Satellite Ephemeris Data'                                               },
        1044: { descr: 'QZSS Ephemerides'                                                           },
        1045: { descr: 'Galileo Broadcast Ephemeris'                                                },
        1046: { descr: 'Galileo I/NAV Satellite Ephemeris Data'                                     },
        1057: { descr: 'SSR GPS orbit corrections to Broadcast Ephemeris'                           },
        1058: { descr: 'SSR GPS clock corrections to Broadcast Ephemeris'                           },
        1059: { descr: 'SSR GPS code biases'                                                        },
        1060: { descr: 'SSR Combined orbit and clock corrections to GPS Broadcast Ephemeris'        },
        1061: { descr: 'SSR GPS User Range Accuracy'                                                },
        1062: { descr: 'SSR High-rate GPS clock corrections to Broadcast Ephemeris'                 },
        1063: { descr: 'SSR GLONASS orbit corrections for Broadcast Ephemeris'                      },
        1064: { descr: 'SSR GLONASS clock corrections for Broadcast Ephemeris'                      },
        1065: { descr: 'SSR GLONASS code biases'                                                    },
        1066: { descr: 'SSR Combined orbit and clock corrections to GLONASS Broadcast Ephemeris'    },
        1067: { descr: 'SSR GLONASS User Range Accuracy (URA)'                                      },
        1068: { descr: 'High-rate GLONASS clock corrections to Broadcast Ephemeris'                 },
        /*
        MSM1    DGNSS uses, Pseudorange, (conventional and advanced)
        MSM2    RTK uses, Pseudorange only
        MSM3    RTK uses, Pseudorange (i.e. Code) and PhaseRange (i.e. Carrier)
        MSM4    RTK uses, Pseudorange, PhaseRange, CNR  (but No Doppler)
        MSM5    RTK uses, Pseudorange, PhaseRange, Doppler, CNR
        MSM6    RTK uses, Pseudorange, PhaseRange CNR, with high resolution
        MSM7    RTK uses, Pseudorange, PhaseRange, Doppler, CNR, with high resolution
        */
        1071: { descr: 'GPS MSM1'                                                                   },
        1072: { descr: 'GPS MSM2'                                                                   },
        1073: { descr: 'GPS MSM3'                                                                   },
        1075: { descr: 'GPS MSM5'                                                                   },
        1076: { descr: 'GPS MSM6'                                                                   },
        1081: { descr: 'GLONASS MSM1'                                                               },
        1082: { descr: 'GLONASS MSM2'                                                               },
        1083: { descr: 'GLONASS MSM3'                                                               },
        1085: { descr: 'GLONASS MSM5'                                                               },
        1086: { descr: 'GLONASS MSM6'                                                               },
        1091: { descr: 'Galileo MSM1'                                                               },
        1092: { descr: 'Galileo MSM2'                                                               },
        1093: { descr: 'Galileo MSM3'                                                               },
        1095: { descr: 'Galileo MSM5'                                                               },
        1096: { descr: 'Galileo MSM6'                                                               },
        1101: { descr: 'SBAS MSM1'                                                                  },
        1102: { descr: 'SBAS MSM2'                                                                  },
        1103: { descr: 'SBAS MSM3'                                                                  },
        1104: { descr: 'SBAS MSM4'                                                                  },
        1105: { descr: 'SBAS MSM5'                                                                  },
        1106: { descr: 'SBAS MSM6'                                                                  },
        1107: { descr: 'SBAS MSM7'                                                                  },
        1111: { descr: 'QZSS MSM1'                                                                  },
        1112: { descr: 'QZSS MSM2'                                                                  },
        1113: { descr: 'QZSS MSM3'                                                                  },
        1114: { descr: 'QZSS MSM4'                                                                  },
        1115: { descr: 'QZSS MSM5'                                                                  },
        1116: { descr: 'QZSS MSM6'                                                                  },
        1117: { descr: 'QZSS MSM7'                                                                  },
        1121: { descr: 'BeiDou MSM1'                                                                },
        1122: { descr: 'BeiDou MSM2'                                                                },
        1123: { descr: 'BeiDou MSM3'                                                                },
        1125: { descr: 'BeiDou MSM5'                                                                },
        1126: { descr: 'BeiDou MSM6'                                                                },
        1131: { descr: 'IRNSS/NavIC MSM1'                                                           },
        1132: { descr: 'IRNSS/NavIC MSM2'                                                           },
        1133: { descr: 'IRNSS/NavIC MSM3'                                                           },
        1134: { descr: 'IRNSS/NavIC MSM4'                                                           },
        1135: { descr: 'IRNSS/NavIC MSM5'                                                           },
        1136: { descr: 'IRNSS/NavIC MSM6'                                                           },
        1137: { descr: 'IRNSS/NavIC MSM7'                                                           },
        1230: { descr: 'GLONASS L1 and L2 Code-Phase Biases'                                        }
    };
}

function mjdToString(mjdDay, mjdSec) {
    if(mjdDay !== undefined && mjdSec !== undefined) {
        
        /* RTCM 3.0 DF051: Modified Julian Day (MJD)), is the continous count of day numbers since November 17, 1858 midnight. 
        For example, the first day in GPS week 0 has MJD 44244. The full MJD number shall always be transmitted. At this point 
        in time the rollover of the MJD is quite far away, but experience with the Y2K problem showed that the actual life of 
        software and applications can be considerably longer than expected. Therefore, it is foreseen to have a rollover of 
        the MJD in calendar year 2038. At day 65,536 MJD the counter will start at 0 again. */
        let d = new Date(Date.UTC(1858, 11, 17));
        // workaround for onocoy that sends only the day in current year
        if (mjdDay <= 366) { 
            d = new Date(Date.UTC(new Date().getUTCFullYear())); 
        }
        d.setUTCDate(d.getUTCDate() + mjdDay);
        d.setUTCSeconds(d.getUTCSeconds() + mjdSec);
        return formatDateTimeShort(d.getTime());
    }
    return '';
}