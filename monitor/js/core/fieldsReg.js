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

import { Field, FieldDate, FieldTime } from './field.js';


const COLORS = Object.freeze( {
    RBG: [ 
        { val: -100, color: '#ff0000' }, 
        { val:    0, color: '#0000ff' }, 
        { val:  100, color: '#00ff00' }
    ],
    BW: [ 
        { val:    0, color: '#ffffff' },
        { val:  100, color: '#000000' }
    ],
    RAINBOW: [ 
        { val:    0, color: '#FF0000' },
        { val:   17, color: '#FF7F00' },
        { val:   33, color: '#FFFF00' },
        { val:   50, color: '#00FF00' },
        { val:   66, color: '#0000FF' },
        { val:   83, color: '#4B0082' },
        { val:  100, color: '#8B00FF' }
    ],
    PALE: [ 
        { val:    0, color: '#e41a1c' },
        { val:   25, color: '#377eb8' },
        { val:   50, color: '#4daf4a' },
        { val:   75, color: '#984ea3' },
        { val:  100, color: '#ff7f00' }
    ],
    BLUES: [
        { val:    0, color: '#deebf7' },
        { val:  100, color: '#3182bd' }
    ],
    REDBLUE: [
        { val:    0, color: '#d73027' },
        { val:  100, color: '#4575b4' }
    ],
    GREENS: [
        { val:    0, color: '#e5f5e0' },
        { val:  100, color: '#31a354' }
    ],
    ALERT: [
        { val:    0, color: '#ffffb2' },
        { val:   50, color: '#fd8d3c' },
        { val:  100, color: '#bd0026' }
    ],
    SUNRISE: [
        { val:    0, color: '#ff512f' },
        { val:  100, color: '#dd2476' }
    ]
} );

const MAP = Object.freeze( {
    fix: {
        'NO':    { hint: 'No fix',                       color: '#ff0000' },
        'SIM':   { hint: 'Simulation',                   color: '#ff0000' },
        'BAD':   { hint: 'Invalid fix',                  color: '#0000ff' },
        'DR':    { hint: 'Dead reckoning only',          color: '#ff00ff' },
        '2D':    { hint: '2D fix',                       color: '#00ffff' },
        '2D/3D': { hint: '2D/3D fix',                    color: '#00ff00' },
        '3D':    { hint: '3D fix',                       color: '#00ff00' },
        'DGPS':  { hint: 'Differential GNSS fix',        color: '#00ff00' },
        '3D+DR': { hint: 'GNSS + Dead reckoning',        color: '#ffbf00' },
        'TIME':  { hint: 'Time only fix',                color: '#00ff00' },
        'FLOAT': { hint: 'RTK float',                    color: '#00C000' },
        'FIXED': { hint: 'RTK fixed',                    color: '#008000' }
    },
    psm: {
        'DIS':   { hint: 'Disabled',                     color: '#c0c0c0' },
        'INIT':  { hint: 'Initialiszing',                color: '#ff00ff' },
        'ACQ':   { hint: 'Acquisition',                  color: '#0000ff' },
        'TRK':   { hint: 'Tracking',                     color: '#00ffff' },
        'PSM':   { hint: 'PSM',                          color: '#00ff00' },
        'OFF':   { hint: 'Inactive',                     color: '#ff0000' },
    },
    bool: {
        0:       { hint: 'false',                        color: '#ff0000' },
        1:       { hint: 'true',                         color: '#00ff00' },
    },
    UBX: {
        ESF: {
            fusionMode: {
                0: { hint: 'Initilizing',                color: '#ff00ff' },
                1: { hint: 'Fusion Mode',                color: '#00ff00' },
                2: { hint: 'Temporary Disabled',         color: '#00ffff' },
                3: { hint: 'Disabled',                   color: '#0000ff' }
            },
            calibMode: {
                0: { hint: 'Initialization',             color: '#ff00ff' },
                1: { hint: 'Fusion Mode',                color: '#00ff00' },
                2: { hint: 'Suspended',                  color: '#00ffff' },
                3: { hint: 'Disabled',                   color: '#0000ff' }
            }
        },
        NAV: {
            fixType: {
                0: { hint: 'No fix',                     color: '#ff0000' },
                1: { hint: 'Dead reckoning only',        color: '#ff00ff' },
                2: { hint: '2D-fix',                     color: '#00ffff' },
                3: { hint: '3D-fix',                     color: '#00ff00' },
                4: { hint: 'GNSS + Dead reckoning',      color: '#ffbf00' },
                5: { hint: 'Time only fix',              color: '#00ff00' }
            },
            psmStateNavPvt: {
                0: { hint: 'Disabled',                   color: '#808080' },
                1: { hint: 'Enabled',                    color: '#ff00ff' },
                2: { hint: 'Acquisition',                color: '#0000ff' },
                3: { hint: 'Tracking',                   color: '#00ffff' },
                4: { hint: 'PSM',                        color: '#00ff00' },
                5: { hint: 'Inactive',                   color: '#ff0000' }
            },
            psmStateNavStatus: {
                0: { hint: 'Acquisition',                color: '#0000ff' },
                1: { hint: 'Tracking',                   color: '#00ffff' },
                2: { hint: 'PSM',                        color: '#00ff00' },
                3: { hint: 'Inactive',                   color: '#ff0000' }
            },
            carrSol: {
                0: { hint: 'No carrier phase range solution',                          color: '#ff0000' },
                1: { hint: 'Carrier phase range solution with floating ambiguities',   color: '#00C000' },
                2: { hint: 'Carrier phase range solution with fixed ambiguities',      color: '#008000' }
            }
        }            
    },
    NMEA: {
        status: {
            'V':{ hint: 'Data invalid',                  color: '#ff0000' },
            'A':{ hint: 'Data valid',                    color: '#00ff00' }
        },
        navMode: {
            '1':{ hint: 'No fix',                        color: '#ff0000' },
            '2':{ hint: '2D fix',                        color: '#00ffff' },
            '3':{ hint: '3D fix',                        color: '#00ff00' }
        },
        quality: {
            '0':{ hint: 'No fix',                        color: '#ff0000' },
            '1':{ hint: 'Autonomous GNSS fix',           color: '#00ff00' },
            '2':{ hint: 'Differential GNSS fix',         color: '#00ff00' },
            '3':{ hint: 'PPS fix',                       color: '#00ff00' },
            '4':{ hint: 'RTK fixed',                     color: '#00ff00' },
            '5':{ hint: 'RTK float',                     color: '#00ff00' },
            '6':{ hint: 'Estimated/Dead reckoning fix',  color: '#ff00ff' },
            '7':{ hint: 'Manual input',                  color: '#ff0000' },
            '8':{ hint: 'Simulation',                    color: '#ff0000' }
        },
        posMode: {
            'N':{ hint: 'No fix',                        color: '#ff0000' },
            'E':{ hint: 'Estimated/Dead reckoning fix',  color: '#ff00ff' },
            'A':{ hint: 'Autonomous GNSS fix',           color: '#00ff00' },
            'D':{ hint: 'Differential GNSS fix',         color: '#00ff00' },
            'F':{ hint: 'RTK float',                     color: '#00ff00' },
            'R':{ hint: 'RTK fixed',                     color: '#00ff00' }
        },
        opMode: {
            'M':{ hint: 'Manually set to 2D or 3D mode', color: '#0000ff' },
            'A':{ hint: 'Automatic 2D or 3D mode',       color: '#00ff00' }
        },
        signalId: { 
            '1': { hint: 'GPS',                          color: '#0000ff' },  
            '2': { hint: 'GLONASS',                      color: '#ff0000' },
            '3': { hint: 'Galileo',                      color: '#00ff00' },
            '4': { hint: 'BeiDou',                       color: '#ffff00' },
            '5': { hint: 'QZSS',                         color: '#00ffff' },
            '6': { hint: 'IRNSS',                        color: '#ff00ff' }
        },
        talkerId: {
            'GP': { hint: 'GPS'                                             }, 
            'GL': { hint: 'GLONASS'                                         }, 
            'GA': { hint: 'Galileo'                                         }, 
            'GB': { hint: 'BeiDou'                                          }, 
            'GQ': { hint: 'QZSS'                                            }, 
            'GI': { hint: 'IRNSS'                                           }, 
            'GN': { hint: 'GNSS'                                            }, 
            'BD': { hint: 'BeiDou'                                          } 
        }
    }
} );

export const FieldsReg = Object.freeze( {
    date       : new FieldDate( 'Date UTC',                          { unit:'yyyy-mm-dd'      } ),
    time       : new FieldTime( 'Time UTC',                          { unit:'hh:mm:ss.sss'    } ),
    wno        : new Field( 'GPS week number',                       { unit:'s',       prec:3, hint:'weeks since 1980-01-06 modulo 1024' } ),
    itow       : new Field( 'GPS time of week',                      { unit:'s',       prec:3, hint:'offset by leap seconds to UTC' } ),
    fix        : new Field( 'Position fix',                          { map:MAP.fix            } ),
    psm        : new Field( 'Power Save',                            { map:MAP.psm            } ),
    ecefX      : new Field( 'ECEF X coordinate',                     { unit:'m',       prec:3 } ),
    ecefY      : new Field( 'ECEF Y coordinate',                     { unit:'m',       prec:3 } ),
    ecefZ      : new Field( 'ECEF Z coordinate',                     { unit:'m',       prec:3 } ),
    pAcc       : new Field( 'Position accuracy estimate',            { unit:'m',       prec:3 } ),
    lat        : new Field( 'Latitude',                              { unit:'degrees', prec:8 } ),
    lng        : new Field( 'Longitude',                             { unit:'degrees', prec:8 } ),
    hAcc       : new Field( 'Horizontal accuarcy estimate',          { unit:'m',       prec:3 } ),
    height     : new Field( 'Height above ellipsoid',                { unit:'m',       prec:3 } ),
    msl        : new Field( 'Height above mean sea level',           { unit:'m',       prec:3 } ),
    gsep       : new Field( 'Geoidal separation',                    { unit:'m',       prec:3 } ),
    vAcc       : new Field( 'Vertical position accuarcy',            { unit:'m',       prec:3 } ),
    ecefVX     : new Field( 'ECEF X velocity',                       { unit:'m/s',     prec:3 } ),
    ecefVY     : new Field( 'ECEF Y velocity',                       { unit:'m/s',     prec:3 } ),
    ecefVZ     : new Field( 'ECEF Z velocity',                       { unit:'m/s',     prec:3 } ),
    sAcc       : new Field( 'Velocity (3D) accuarcy',                { unit:'m/s',     prec:3 } ),
    speed      : new Field( 'Speed (3D)',                            { unit:'m/s',     prec:3 } ),
    gSpeed     : new Field( 'Ground Speed (2D)',                     { unit:'m/s',     prec:3 } ),
    velN       : new Field( 'NED north velocity',                    { unit:'m/s',     prec:3 } ),
    velE       : new Field( 'NED east velocity',                     { unit:'m/s',     prec:3 } ),
    velD       : new Field( 'NED down velocity',                     { unit:'m/s',     prec:3 } ),
    heading    : new Field( 'Heading of motion 2-D',                 { unit:'degrees', prec:2 } ),
    cogt       : new Field( 'Course over Ground',                    { unit:'degrees', prec:2 } ), // == heading
    cAcc       : new Field( 'Heading accuracy estimate',             { unit:'degrees', prec:2 } ),
    numSV      : new Field( 'Number of Satellites',                  {                 prec:0 } ),
    gDop       : new Field( 'Geometric DOP',                         {                 prec:2 } ),
    pDop       : new Field( 'Position DOP',                          {                 prec:2 } ),
    hDop       : new Field( 'Horizontal DOP',                        {                 prec:2 } ),
    vDop       : new Field( 'Vertical DOP',                          {                 prec:2 } ),
    nDop       : new Field( 'Northing DOP',                          {                 prec:2 } ),
    eDop       : new Field( 'Easting DOP',                           {                 prec:2 } ),
    tDop       : new Field( 'Time DOP',                              {                 prec:2 } ),
    plPosValid : new Field( 'Position protection level valid',       { map:MAP.bool,           hide:true } ), // assuming frame PL 3
    plPos1     : new Field( 'Position protection level major',       { unit:'m',       prec:3 } ),
    plPos2     : new Field( 'Position protection level minor',       { unit:'m',       prec:3 } ),
    plPos3     : new Field( 'Position protection level vertical',    { unit:'m',       prec:3 } ),
    plPosHorOr : new Field( 'Position protection level orientation', { unit:'degrees', prec:1 } ),
    plVelValid : new Field( 'Velocity protection level valid',       { map:MAP.bool,           hide:true } ), // assuming frame PL 3
    plVel1     : new Field( 'Velocity protection level major',       { unit:'m/s',     prec:3, hide:true } ),
    plVel2     : new Field( 'Velocity protection level minor',       { unit:'m/s',     prec:3, hide:true } ),
    plVel3     : new Field( 'Velocity protection level vertical',    { unit:'m/s',     prec:3, hide:true } ),
    plVelHorOr : new Field( 'Velocity protection level orientation', { unit:'degrees', prec:1, hide:true } ),
    status     : new Field( 'NMEA valid status',                     { map:MAP.NMEA.status    } ),
    posMode    : new Field( 'NMEA position mode',                    { map:MAP.NMEA.posMode   } ),
    opMode     : new Field( 'NMEA operation status',                 { map:MAP.NMEA.opMode    } ),
    navMode    : new Field( 'NMEA navigation mode',                  { map:MAP.NMEA.navMode   } ),
    quality    : new Field( 'NMEA quality',                          { map:MAP.NMEA.quality   } ),
    fusionMode : new Field( 'ESF fusion mode',                       { map:MAP.UBX.ESF.fusionMode } ),
    lBebn0     : new Field( 'LBAND Eb/N0',                           { unit:'dB',      prec:1 } ),
    lBcn0      : new Field( 'LBAND C/N0',                            { unit:'dB',      prec:1 } ),
    epIndex    : new Field( 'Epoch index',                           {                        } ),
    epNumMsg   : new Field( 'Messages in epoch',                     {                 prec:0 } ),
    epBytes    : new Field( 'Bytes in epoch',                        { unit:'Bytes',   prec:0 } ),
    hErr       : new Field( 'Horizontal reference offset',           { unit:'m',       prec:3 } ),
    vErr       : new Field( 'Vertical reference offset',             { unit:'m',       prec:3 } ),
    pErr       : new Field( '3D reference offset',                   { unit:'m',       prec:3 } ),
    sErr       : new Field( 'Speed reference offset',                { unit:'m/s',     prec:3 } ),
    gsErr      : new Field( 'Ground speed reference offset',         { unit:'m/s',     prec:3 } ),
    power      : new Field( 'Power consumption',                     { unit:'mW',      prec:6 } ),
} );

