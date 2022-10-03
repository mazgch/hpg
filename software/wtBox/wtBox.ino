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

const int8_t PINIDS[SIDES][PINS] = { 
#ifdef ARDUINO_ESP8266_WEMOS_D1MINI
/*  Using Board: LOLIN (WEMOS) D1 R2 & mini
 * 
 *                         ---------- ANTENNA --
 *                         |              LED  |
 *                         RST   ESP8266      TX -> CDC @ 115200
 *                         ADC0               RX 
 *     BLUE / HALL_RL_A -> D0/WAKE            D1 <- HALL_RL_C / GREEN 
 *    GREEN / HALL_RR_C -> D5                 D2 <- HALL_RL_B / YELLOW
 *   YELLOW / HALL_RR_B -> D6            BOOT/D3
 *     BLUE / HALL_RR_A -> D7         LED/TX1/D4 -> ESF-MEAS @ 38400 -> ZED RXI
 *                         D8   FLASH        GND
 *                         3v3                5V <- IN
 *                         [BTN                |
 *                          ------- USB --------
 *                               
 */
  { // REAR LEFT (RL) WHEEL pins of hall sensors  
    D0, // HALL_RL_A / BLUE 
    D2, // HALL_RL_B / YELLOW 
    D1  // HALL_RL_C / GREEN
  },  
  {  // REAR RIGHT (RR) WHEEL pins of hall sensors (reverse order)
    D5, // HALL_RR_C / GREEN
    D6, // HALL_RR_B / YELLOW, 
    D7  // HALL_RR_A / BLUE
  },
#else
  #error "add the pins for your target here"
#endif
};

/* convert ticks per period to a speed, 
 * 
 * example for BOSCH Indigo S+ 500
 * - wheel diameter:       ~16.5 cm
 * - wheel circumference:  ~53.0 cm 
 * - ticks per revolution:  1540 ticks
*/
#define ESF_TICKS_PER_METER  ( 1540 /* ticks per revolution */ \
                                * 2 /* left and right wheel */ \
                             / 0.53 /* wheel circumference m */ )
#define ESF_PROVIDER         0x0000 // ESF-MEAS provider id 
#define ESF_PERIOD_MS           100 // ESF-MEAS output rate in ms => 100 = 10Hz

// you should not have to changes what is here below. 
#define ESF_TICKS_TO_MM_PER_S ( 1e3 /* value unit scale to 1e-3m/s = mm */ \
                              * 1e3 /* s/ms */ / ESF_PERIOD_MS /* mesurement perios ms */ \
                              / ESF_TICKS_PER_METER /* ticks / m */ )
#define ESF_TICKtoSPEED(t) (int32_t)(ESF_TICKS_TO_MM_PER_S * t)
#define ESF_DATA_TICKS      0x007FFFFF
#define ESF_DATA_DIRECTION  0x00800000
#define ESF_DATA_TYPE       0xFF000000
#define ESF_DATATYPE_FRONTLEFT       6
#define ESF_DATATYPE_FRONTRIGHT      7
#define ESF_DATATYPE_REARLEFT        8
#define ESF_DATATYPE_REARRIGHT       9
#define ESF_DATATYPE_SINGLETICK      10
#define ESF_DATATYPE_SPEED           11
enum { LEFT = 0, RIGHT = 1, SINGLE = 2, SPEED = 3, ESF_MEAS_NUM } MEAS;

#define STATES 6
#define IGNORE -1
int8_t state[2];
int32_t wt[ESF_MEAS_NUM];
uint32_t esfWt[ESF_MEAS_NUM];
uint32_t esfMs;
uint32_t esfTtag;

size_t esfMeas(uint32_t* p, size_t num) {
  size_t i = 0;
  uint8_t m[6 + 8 + (4 * num) + 2];  
  m[i++] = 0xB5; // µ
  m[i++] = 0x62; // b
  m[i++] = 0x10; // ESF
  m[i++] = 0x02; // MEAS
  uint16_t esfSize = (8 + 4 * num);
  m[i++] = esfSize >> 0; 
  m[i++] = esfSize >> 8;
  m[i++] = esfTtag >> 0;
  m[i++] = esfTtag >> 8;
  m[i++] = esfTtag >> 16;
  m[i++] = esfTtag >> 24;
  uint16_t esfFlags = num << 11;
  m[i++] = esfFlags >> 0;
  m[i++] = esfFlags >> 8;
  m[i++] = ESF_PROVIDER >> 0;
  m[i++] = ESF_PROVIDER >> 8;
  for (int s = 0; s < num; s ++) {
    m[i++] = p[s] >> 0;
    m[i++] = p[s] >> 8;
    m[i++] = p[s] >> 16;
    m[i++] = p[s] >> 24;
  }
  uint8_t cka = 0;
  uint8_t ckb = 0;
  for (int c = 2; c < i; c++) {
    cka += m[c];
    ckb += cka;
  }
  m[i++] = cka;
  m[i++] = ckb;
  return Serial1.write(m, i);
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
  esfMs = millis();
  esfTtag = 0;
  for (int s = 0; s < ESF_MEAS_NUM; s ++) {
    wt[s] = 0;
    esfWt[s] = (ESF_DATATYPE_REARLEFT + s) << 24;
  }
}
    
void loop() {
  /*  
   *  State:  -000-111-222-333-444-555-000-111-222-333-444-555-000-111-222-333-444-555-
   *          |   .   .   .   .   .   |   .   .   .   .   .   |   .   .   .   .   .   | 
   *  Hall C: ________/-----------\___________/-----------\___________/-----------\____
   *          |   .   .   .   .   .   |   .   .   .   .   .   |   .   .   .   .   .   |  
   *  Hall B: ----\___________/-----------\___________/-----------\___________/--------
   *          |   .   .   .   .   .   |   .   .   .   .   .   |   .   .   .   .   .   | 
   *  Hall A: ------------\___________/-----------\___________/-----------\___________/
   *          |   .   .   .   .   .   |   .   .   .   .   .   |   .   .   .   .   .   | 
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
        wt[s]      += inc*2; // multiply by 2 to make same scale as the single tick which integrates both wheels 
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
    esfMeas(&esfWt[LEFT], 2); // output LEFT and RIGHT wheel only, use (&esfWt[SINGLE],1) single tick or (&esfWt[SPEED],1) for speed 
        
    // print the debug string
    Serial.println(buf);
  }
}
