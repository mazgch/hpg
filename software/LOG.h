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
 
#ifndef __LOG_H__
#define __LOG_H__

/** This file allows you to have a separte log level for this application regardless 
 *  from the ARDUHAL_LOG_LEVEL setting of the arduino core.  Define here a custom 
 *  debug level for the whole application independent from the core.
 */
#define APP_LOG_LEVEL ARDUHAL_LOG_LEVEL_INFO

#if (APP_LOG_LEVEL >= ARDUHAL_LOG_LEVEL_NONE)
  #undef  log_n
  #define ARDUHAL_LOG_COLOR_N // do not color 
  #define log_n(format, ...)  log_printf(ARDUHAL_LOG_FORMAT(N, format), ##__VA_ARGS__)
#endif

#if (APP_LOG_LEVEL >= ARDUHAL_LOG_LEVEL_ERROR)
  #undef  log_e
  #define log_e(format, ...)  log_printf(ARDUHAL_LOG_FORMAT(E, format), ##__VA_ARGS__)
#endif

#if (APP_LOG_LEVEL >= ARDUHAL_LOG_LEVEL_WARN)
  #undef  log_w
  #define log_w(format, ...)  log_printf(ARDUHAL_LOG_FORMAT(W, format), ##__VA_ARGS__)
#endif

#if (APP_LOG_LEVEL >= ARDUHAL_LOG_LEVEL_INFO)
  #undef  log_i
  #define ARDUHAL_LOG_COLOR__ // do not color
  // using the _ is better visible and differentiable in the log
  #define log_i(format, ...)  log_printf(ARDUHAL_LOG_FORMAT(_, format), ##__VA_ARGS__)
#endif

#if (APP_LOG_LEVEL >= ARDUHAL_LOG_LEVEL_DEBUG)
  #undef  log_d
  #define log_d(format, ...)  log_printf(ARDUHAL_LOG_FORMAT(D, format), ##__VA_ARGS__)
#endif

#if (APP_LOG_LEVEL >= ARDUHAL_LOG_LEVEL_VERBOSE)
  #undef  log_v
  #define log_v(format, ...)  log_printf(ARDUHAL_LOG_FORMAT(V, format), ##__VA_ARGS__)
#endif

#endif // __LOG_H__
