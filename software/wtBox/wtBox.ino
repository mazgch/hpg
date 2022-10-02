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
 
#define SIDES 2
#define PINS 3

// Using D1 mini Wemos
const int8_t PINIDS[SIDES][PINS] = { 
#ifdef ARDUINO_ESP8266_WEMOS_D1MINI
  {  D2/*GREEN*/, D1/*YELLOW*/, D0/*BLUE*/ }, // LEFT
  {  D5/*GREEN*/, D6/*YELLOW*/, D7/*BLUE*/ }, // RIGHT
#define ESF_MEAS_TX D3
/*
 *                         --- ANTENNA ---
 *                         |        LED  |
 *                         RST          TX -> CDC @ 115200
 *                         ADC0         RX 
 *     BLUE / HALL_RL_A -> D0,WAKE      D1 <- HALL_RL_B / YELLOW 
 *    GREEN / HALL_RR_C -> D5           D2 <- HALL_RL_C / GREEN
 *   YELLOW / HALL_RR_B -> D6   CHIPS   D3
 *     BLUE / HALL_RR_A -> D7   LED,TXI,D4 -> ESF-MEAS @ 38400 -> ZED RXI
 *                         D8          GND
 *                         3v3          5V <- IN
 *                         ---------------
 *                               USB
 */
#else
  #error "add the pins for your target here"
#endif
};

#define ESF_DATATYPE_FRONTLEFT       6
#define ESF_DATATYPE_FRONTRIGHT      7
#define ESF_DATATYPE_REARLEFT        8
#define ESF_DATATYPE_REARRIGHT       9
#define ESF_DATATYPE_SINGLETICK      10
#define ESF_DATATYPE_SPEED           11

enum { LEFT = 0, RIGHT = 1, SINGLE = 2, SPEED = 3, ESF_MEAS_NUM } MEAS;

#define ESF_OUT_MEAS       4
#define ESF_SIZE (8 + 4 * ESF_OUT_MEAS) // four measurements (e.g. RR, RL)
#define ESF_PERIOD_MS      100
#define ESF_FLAGS          (ESF_OUT_MEAS<<11)
#define ESF_PROVIDER       0x0000
#define ESF_DATA_TICKS     0x007FFFFF
#define ESF_DATA_DIRECTION 0x00800000
#define ESF_DATA_TYPE      0xFF000000
// convert ticks per period to a speed (e.g. 0.05 = 5cm / tick) 
#define ESF_METER_PER_TICK   (0.53 /* wheel circumference */ / 1200 /* ticks per revolution*/) // BOSCH Indigo S+ 500
#define ESF_TICKtoSPEED(t) (int32_t)((ESF_METER_PER_TICK/*tick*/ * 1e3 /*scale*/ * (1e3/*ms*/ / ESF_PERIOD_MS)) * t) 

#define LED_RATE_100MS     20

#define STATES 6
#define IGNORE -1
int8_t state[2];
int32_t wt[ESF_MEAS_NUM];
uint32_t esfWt[ESF_MEAS_NUM];
uint32_t esfMs;
uint32_t esfTtag;

size_t esfMeas(uint8_t* m) {
  size_t i = 0;
  m[i++] = 0xB5; // µ
  m[i++] = 0x62; // b
  m[i++] = 0x10; // ESF
  m[i++] = 0x02; // MEAS
  m[i++] = ESF_SIZE >> 0; 
  m[i++] = ESF_SIZE >> 8;
  m[i++] = esfTtag >> 0;
  m[i++] = esfTtag >> 8;
  m[i++] = esfTtag >> 16;
  m[i++] = esfTtag >> 24;
  m[i++] = ESF_FLAGS >> 0;
  m[i++] = ESF_FLAGS >> 8;
  m[i++] = ESF_PROVIDER >> 0;
  m[i++] = ESF_PROVIDER >> 8;
  for (int s = 0; s < ESF_OUT_MEAS; s ++) {
    m[i++] = esfWt[s] >> 0;
    m[i++] = esfWt[s] >> 8;
    m[i++] = esfWt[s] >> 16;
    m[i++] = esfWt[s] >> 24;
  }
  uint8_t cka = 0;
  uint8_t ckb = 0;
  for (int c = 2; c < i; c++) {
    cka += m[c];
    ckb += cka;
  }
  m[i++] = cka;
  m[i++] = ckb;
  return i;
}

void setup() {
  Serial.begin(115200);
  while (!Serial)
    /*nothing*/;
  Serial.print("\n\n"
              "|-- time --|-- rear left wheel tick ---------|-- rear right wheel tick --------|-- single wheel tick -----|-- speed --------------|\n"
              "    esfTtag    wt   esfWt Rev    esfWt Pin St    wt   esfWt Rev    esfWt Pin St    wt   esfWt Rev    esfWt    wt    speed    esfWt\n"); 
  // the default baud rate of u-blox GNSS is 38400 baud
  Serial1.begin(38400);
  // init pins to hall sensor pins
  for (int s = 0; s < SIDES; s ++) {
    for (int i = 0; i < PINS; i ++) {
      pinMode(PINIDS[s][i], INPUT);
    }
    state[s] = IGNORE;
  }
  // prepare the variables 
  ledCnt = 0;
  esfMs = millis();
  esfTtag = 0;
  for (int s = 0; s < ESF_MEAS_NUM; s ++) {
    wt[s] = 0;
    esfWt[s] = (ESF_DATATYPE_REARLEFT + s) << 24;
  }
}
    
void loop() {
  /*  
   *  Phase   | A . B . C . D . E . F | A . B . C . D . E . F | A . B . C . D . E . F | 
   *          |   .   .   .   .   .   |   .   .   .   .   .   |   .   .   .   .   .   | 
   *  Hall 1: ________/-----------\___________/-----------\___________/-----------\____
   *          |   .   .   .   .   .   |   .   .   .   .   .   |   .   .   .   .   .   |  
   *  Hall 2: ----\___________/-----------\___________/-----------\___________/--------
   *          |   .   .   .   .   .   |   .   .   .   .   .   |   .   .   .   .   .   | 
   *  Hall 3: ------------\___________/-----------\___________/-----------\___________/
   *          |   .   .   .   .   .   |   .   .   .   .   .   |   .   .   .   .   .   | 
   *  State:  -000-111-222-333-444-555-000-111-222-333-444-555-000-111-222-333-444-555-
   */
  char lvl[SIDES][PINS+1] { "---", "---" };
  int8_t st[SIDES];
  // sample the pins and integrate the difference of state onto the wt variable
  for (int s = 0; s < SIDES; s ++) {
    for (int p = 0; p < PINS; p ++) {
      lvl[s][p] = (digitalRead(PINIDS[s][p]) == HIGH) ? 'H' : 'L';
    }
    const char* LUT[] = { "LHH" ,"LLH", "HLH", "HLL", "HHL", "LHL" };
    st[s] = IGNORE;
    for (int i = 0; i < STATES; i ++) {
      if (0 == strcmp(lvl[s], LUT[i])) {
        st[s] = i;
        break;
      }
    }
    if (st[s] != IGNORE) {
      if ((state[s] != IGNORE) && (state[s] != st[s])) {
        // calc the difference, this can under-/overflow, 
        int8_t inc = st[s] - state[s];
        // make it signed in range -2 .. 0 .. 3, 
        // assuming we usually drive fowards
        if (PINS < inc) {
          inc -= 2*PINS;
        }
        else if (-PINS >= inc) {
          inc += 2*PINS;
        }
        wt[s]      += inc;
        wt[SINGLE] += inc;
        wt[SPEED]  += inc;
      }
      state[s] = st[s]; 
    }
  }
  uint32_t now = millis();
  if ((now - esfMs) > ESF_PERIOD_MS) {
    esfMs += ESF_PERIOD_MS;
    esfTtag += ESF_PERIOD_MS;
    char buf[256];
    char* p = buf;
    p+= sprintf(p, " %10u", esfTtag);
    for (int s = 0; s < ESF_MEAS_NUM; s ++) {
      if (s == SPEED) {
        int32_t spd = ESF_TICKtoSPEED(wt[s]);
        esfWt[s] = (spd & ~ESF_DATA_TYPE) |  // speed
                   (esfWt[s] & ESF_DATA_TYPE); // type
        p+= sprintf(p, " %5i %8.3f %08X", wt[s], 1e-3*spd, esfWt[s]); 
      } else {
        uint32_t dir = 0;
        int32_t ticks = wt[s];
        if (0 > ticks) { // u-center ESF-MEAS graph may look funny due to polarity bit
          dir = ESF_DATA_DIRECTION;
          ticks = -ticks;
        }
        ticks += esfWt[s];
        ticks &= ESF_DATA_TICKS; // mask relevant bits 
        esfWt[s] = ticks | dir | (esfWt[s] & ESF_DATA_TYPE);
        p+= sprintf(p, " %5i %7u %s %08X", wt[s], ticks, dir?"Rev":"Fwd", esfWt[s]); 
        if (s != SINGLE) {
          p+= sprintf(p, " %.3s %c ", lvl[s], (st[s]!=IGNORE)?st[s]+'0':'-');
        }
      }
      wt[s] = 0;
    }
    // assemble the UBX-ESF-MEAS message
    uint8_t msg[6 + ESF_SIZE + 2];
    size_t size = esfMeas(msg);
    Serial1.write(msg, size);
    // print the debug string
    Serial.println(buf);
  }
}
