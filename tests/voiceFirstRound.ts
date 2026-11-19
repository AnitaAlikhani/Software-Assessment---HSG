/**
 * The first real round of the voice check: English, read aloud in Chrome on a laptop in a quiet
 * room on 19 November 2026, in the first shape of the results file. Only the texts and the order
 * of events are kept here; the times of the unfinished words are left out.
 *
 * It is what the browser's speech recognition really wrote, with its real slips: "Leah Bruner"
 * for Lea Brunner, "5:45" for quarter to four, "half past 10:10", a sentence cut off before its time.
 */
export const FIRST_ROUND: unknown = {
 "kind": "slotbee-voice-check",
 "version": 1,
 "createdAt": "2026-11-19T12:06:17.451Z",
 "browser": {
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36",
  "languages": [
   "en-US",
   "en"
  ]
 },
 "support": {
  "recognition": true,
  "onDevice": true,
  "boost": true
 },
 "settings": {
  "label": "",
  "language": "en",
  "locale": "en-GB",
  "variety": "standard",
  "noise": "quiet",
  "microphone": "built-in",
  "onDevice": false,
  "boost": false
 },
 "sentences": [
  {
   "id": "en-01",
   "attempts": [
    {
     "startedAt": "2026-11-19T12:00:41.074Z",
     "heard": "",
     "alternatives": [],
     "interimCount": 0,
     "errors": [
      "no-speech"
     ],
     "events": [
      {"ms": 3888, "name": "start"},
      {"ms": 4242, "name": "audiostart"},
      {"ms": 12093, "name": "audioend"},
      {"ms": 12093, "name": "error:no-speech"},
      {"ms": 12094, "name": "end"}
     ]
    },
    {
     "startedAt": "2026-11-19T12:02:02.731Z",
     "heard": "",
     "alternatives": [],
     "interimCount": 4,
     "errors": [],
     "events": [
      {"ms": 13, "name": "start"},
      {"ms": 307, "name": "audiostart"},
      {"ms": 2440, "name": "soundstart"},
      {"ms": 2440, "name": "speechstart"},
      {"ms": 6196, "name": "speechend"},
      {"ms": 6196, "name": "soundend"},
      {"ms": 6196, "name": "audioend"},
      {"ms": 6302, "name": "end"}
     ]
    },
    {
     "startedAt": "2026-11-19T12:03:11.176Z",
     "heard": "do you have anything free on Thursday at 3:00 p.m.",
     "alternatives": [
      {"text": "do you have anything free on Thursday at 3:00 p.m.", "confidence": 0.9682568311691284},
      {"text": "do we have anything free on Thursday at 3:00 p.m.", "confidence": 0.9734953045845032}
     ],
     "interimCount": 17,
     "errors": [],
     "events": [
      {"ms": 23, "name": "start"},
      {"ms": 293, "name": "audiostart"},
      {"ms": 1061, "name": "soundstart"},
      {"ms": 1061, "name": "speechstart"},
      {"ms": 5385, "name": "final"},
      {"ms": 5500, "name": "speechend"},
      {"ms": 5500, "name": "soundend"},
      {"ms": 5500, "name": "audioend"},
      {"ms": 5764, "name": "end"}
     ]
    }
   ]
  },
  {
   "id": "en-02",
   "attempts": [
    {
     "startedAt": "2026-11-19T12:03:25.368Z",
     "heard": "a haircut on Friday the 27th of November at half past 10:10",
     "alternatives": [
      {"text": "a haircut on Friday the 27th of November at half past 10:10", "confidence": 0.8175505995750427},
      {"text": "ah haircut on Friday the 27th of November at half past 10:10", "confidence": 0.8175505995750427},
      {"text": "ahhh haircut on Friday the 27th of November at half past 10:10", "confidence": 0.8175505995750427}
     ],
     "interimCount": 22,
     "errors": [],
     "events": [
      {"ms": 2, "name": "start"},
      {"ms": 294, "name": "audiostart"},
      {"ms": 890, "name": "soundstart"},
      {"ms": 890, "name": "speechstart"},
      {"ms": 6438, "name": "speechend"},
      {"ms": 6438, "name": "soundend"},
      {"ms": 6438, "name": "audioend"},
      {"ms": 6464, "name": "final"},
      {"ms": 6465, "name": "end"}
     ]
    }
   ]
  },
  {
   "id": "en-03",
   "attempts": [
    {
     "startedAt": "2026-11-19T12:03:40.648Z",
     "heard": "tomorrow morning at 9:00 at 9:15",
     "alternatives": [
      {"text": "tomorrow morning at 9:00 at 9:15", "confidence": 0.9115888476371765}
     ],
     "interimCount": 13,
     "errors": [],
     "events": [
      {"ms": 5, "name": "start"},
      {"ms": 284, "name": "audiostart"},
      {"ms": 881, "name": "soundstart"},
      {"ms": 881, "name": "speechstart"},
      {"ms": 4637, "name": "speechend"},
      {"ms": 4637, "name": "soundend"},
      {"ms": 4637, "name": "audioend"},
      {"ms": 4639, "name": "final"},
      {"ms": 4644, "name": "end"}
     ]
    },
    {
     "startedAt": "2026-11-19T12:03:48.581Z",
     "heard": "tomorrow morning at 9:15 for a coloring",
     "alternatives": [
      {"text": "tomorrow morning at 9:15 for a coloring", "confidence": 0.9876760840415955},
      {"text": "tomorrow morning at 9:15 for a colouring", "confidence": 0.9876760840415955},
      {"text": "tomorrow morning at 9:15 for a collaring", "confidence": 0.9876760840415955}
     ],
     "interimCount": 13,
     "errors": [],
     "events": [
      {"ms": 6, "name": "start"},
      {"ms": 293, "name": "audiostart"},
      {"ms": 891, "name": "soundstart"},
      {"ms": 891, "name": "speechstart"},
      {"ms": 5128, "name": "final"},
      {"ms": 5158, "name": "speechend"},
      {"ms": 5158, "name": "soundend"},
      {"ms": 5158, "name": "audioend"},
      {"ms": 5229, "name": "end"}
     ]
    }
   ]
  },
  {
   "id": "en-04",
   "attempts": [
    {
     "startedAt": "2026-11-19T12:03:57.235Z",
     "heard": "next Tuesday at 5:45 with Salina",
     "alternatives": [
      {"text": "next Tuesday at 5:45 with Salina", "confidence": 0.7085335850715637},
      {"text": "next Tuesday at 5:45 with Salinas", "confidence": 0.6880897879600525},
      {"text": "next Tuesday at 5:45 to 4:00 with Salina", "confidence": 0.7132008671760559}
     ],
     "interimCount": 12,
     "errors": [],
     "events": [
      {"ms": 4, "name": "start"},
      {"ms": 282, "name": "audiostart"},
      {"ms": 879, "name": "soundstart"},
      {"ms": 879, "name": "speechstart"},
      {"ms": 5429, "name": "final"},
      {"ms": 5489, "name": "speechend"},
      {"ms": 5489, "name": "soundend"},
      {"ms": 5490, "name": "audioend"},
      {"ms": 5563, "name": "end"}
     ]
    }
   ]
  },
  {
   "id": "en-05",
   "attempts": [
    {
     "startedAt": "2026-11-19T12:04:16.131Z",
     "heard": "is Luca free on Saturday afternoon",
     "alternatives": [
      {"text": "is Luca free on Saturday afternoon", "confidence": 0.9202365875244141},
      {"text": "is Luka free on Saturday afternoon", "confidence": 0.9202365875244141},
      {"text": "is Lucca free on Saturday afternoon", "confidence": 0.9202365875244141}
     ],
     "interimCount": 12,
     "errors": [],
     "events": [
      {"ms": 5, "name": "start"},
      {"ms": 289, "name": "audiostart"},
      {"ms": 886, "name": "soundstart"},
      {"ms": 886, "name": "speechstart"},
      {"ms": 4556, "name": "speechend"},
      {"ms": 4556, "name": "soundend"},
      {"ms": 4556, "name": "audioend"},
      {"ms": 4573, "name": "final"},
      {"ms": 4574, "name": "end"}
     ]
    }
   ]
  },
  {
   "id": "en-06",
   "attempts": [
    {
     "startedAt": "2026-11-19T12:04:24.018Z",
     "heard": "the customer is Leah Brunner",
     "alternatives": [
      {"text": "the customer is Leah Brunner", "confidence": 0.8720346689224243},
      {"text": "the customer is Leah Bruner", "confidence": 0.8720346689224243},
      {"text": "the customer is Leah brooner", "confidence": 0.8720346689224243}
     ],
     "interimCount": 11,
     "errors": [],
     "events": [
      {"ms": 3, "name": "start"},
      {"ms": 285, "name": "audiostart"},
      {"ms": 966, "name": "soundstart"},
      {"ms": 966, "name": "speechstart"},
      {"ms": 3652, "name": "final"},
      {"ms": 3699, "name": "speechend"},
      {"ms": 3699, "name": "soundend"},
      {"ms": 3699, "name": "audioend"},
      {"ms": 3784, "name": "end"}
     ]
    }
   ]
  },
  {
   "id": "en-07",
   "attempts": [
    {
     "startedAt": "2026-11-19T12:04:33.189Z",
     "heard": "her phone number is 078-555-2744",
     "alternatives": [
      {"text": "her phone number is 078-555-2744", "confidence": 0.8101626634597778},
      {"text": "Herr phone number is 078-555-2744", "confidence": 0.8101626634597778}
     ],
     "interimCount": 22,
     "errors": [],
     "events": [
      {"ms": 4, "name": "start"},
      {"ms": 285, "name": "audiostart"},
      {"ms": 881, "name": "soundstart"},
      {"ms": 881, "name": "speechstart"},
      {"ms": 7579, "name": "final"},
      {"ms": 7624, "name": "speechend"},
      {"ms": 7624, "name": "soundend"},
      {"ms": 7624, "name": "audioend"},
      {"ms": 7687, "name": "end"}
     ]
    }
   ]
  },
  {
   "id": "en-08",
   "attempts": [
    {
     "startedAt": "2026-11-19T12:04:44.756Z",
     "heard": "move Leah Broner from Thursday to Friday at 11:00",
     "alternatives": [
      {"text": "move Leah Broner from Thursday to Friday at 11:00", "confidence": 0.8929545283317566},
      {"text": "move Leah broenner from Thursday to Friday at 11:00", "confidence": 0.8929545283317566},
      {"text": "moov Leah Broner from Thursday to Friday at 11:00", "confidence": 0.8929545283317566}
     ],
     "interimCount": 18,
     "errors": [],
     "events": [
      {"ms": 5, "name": "start"},
      {"ms": 285, "name": "audiostart"},
      {"ms": 1052, "name": "soundstart"},
      {"ms": 1052, "name": "speechstart"},
      {"ms": 6259, "name": "speechend"},
      {"ms": 6259, "name": "soundend"},
      {"ms": 6259, "name": "audioend"},
      {"ms": 6277, "name": "final"},
      {"ms": 6277, "name": "end"}
     ]
    }
   ]
  },
  {
   "id": "en-09",
   "attempts": [
    {
     "startedAt": "2026-11-19T12:04:54.507Z",
     "heard": "cancel the appointment on the 2nd of December",
     "alternatives": [
      {"text": "cancel the appointment on the 2nd of December", "confidence": 0.9911867380142212}
     ],
     "interimCount": 15,
     "errors": [],
     "events": [
      {"ms": 4, "name": "start"},
      {"ms": 283, "name": "audiostart"},
      {"ms": 1222, "name": "soundstart"},
      {"ms": 1222, "name": "speechstart"},
      {"ms": 5036, "name": "final"},
      {"ms": 5062, "name": "speechend"},
      {"ms": 5062, "name": "soundend"},
      {"ms": 5062, "name": "audioend"},
      {"ms": 5163, "name": "end"}
     ]
    }
   ]
  },
  {
   "id": "en-10",
   "attempts": [
    {
     "startedAt": "2026-11-19T12:05:03.822Z",
     "heard": "confirm booking",
     "alternatives": [
      {"text": "confirm booking", "confidence": 0.9008039236068726},
      {"text": "confirm book King", "confidence": 0.6715981364250183},
      {"text": "confirm Bo King", "confidence": 0.5484225749969482}
     ],
     "interimCount": 5,
     "errors": [],
     "events": [
      {"ms": 5, "name": "start"},
      {"ms": 286, "name": "audiostart"},
      {"ms": 969, "name": "soundstart"},
      {"ms": 969, "name": "speechstart"},
      {"ms": 2281, "name": "final"},
      {"ms": 2335, "name": "speechend"},
      {"ms": 2335, "name": "soundend"},
      {"ms": 2335, "name": "audioend"},
      {"ms": 2391, "name": "end"}
     ]
    }
   ]
  },
  {
   "id": "en-11",
   "attempts": [
    {
     "startedAt": "2026-11-19T12:05:09.171Z",
     "heard": "no not Thursday Friday at",
     "alternatives": [
      {"text": "no not Thursday Friday at", "confidence": 0.9620953798294067},
      {"text": "no knot Thursday Friday at", "confidence": 0.9620953798294067},
      {"text": "know not Thursday Friday at", "confidence": 0.9620953798294067}
     ],
     "interimCount": 9,
     "errors": [],
     "events": [
      {"ms": 2, "name": "start"},
      {"ms": 275, "name": "audiostart"},
      {"ms": 1499, "name": "soundstart"},
      {"ms": 1499, "name": "speechstart"},
      {"ms": 3348, "name": "speechend"},
      {"ms": 3348, "name": "soundend"},
      {"ms": 3348, "name": "audioend"},
      {"ms": 3497, "name": "final"},
      {"ms": 3500, "name": "end"}
     ]
    }
   ]
  },
  {
   "id": "en-12",
   "attempts": [
    {
     "startedAt": "2026-11-19T12:05:17.760Z",
     "heard": "yes of course no problem one moment please",
     "alternatives": [
      {"text": "yes of course no problem one moment please", "confidence": 0.9870477914810181},
      {"text": "yes of course no problem won moment please", "confidence": 0.9870477914810181}
     ],
     "interimCount": 13,
     "errors": [],
     "events": [
      {"ms": 4, "name": "start"},
      {"ms": 285, "name": "audiostart"},
      {"ms": 881, "name": "soundstart"},
      {"ms": 881, "name": "speechstart"},
      {"ms": 4600, "name": "final"},
      {"ms": 4638, "name": "speechend"},
      {"ms": 4638, "name": "soundend"},
      {"ms": 4638, "name": "audioend"},
      {"ms": 4724, "name": "end"}
     ]
    }
   ]
  }
 ],
 "talk": {
  "startedAt": "2026-11-19T12:05:28.435Z",
  "heard": "Bella hair salon good morning a haircut sure Thursday the 26th at 3:00 in the afternoon one moment let me check 3 is taken but I can offer you 3:30 perfect 3:30 on Thursday and your name please Leah Bruner thank you confirm booking",
  "segments": [
   {"ms": 4567, "text": "Bella hair salon good morning"},
   {"ms": 7064, "text": "a haircut sure"},
   {"ms": 15948, "text": "Thursday the 26th at 3:00 in the afternoon one moment let me check"},
   {"ms": 23050, "text": "3 is taken but I can offer you 3:30"},
   {"ms": 29144, "text": "perfect 3:30 on Thursday and your name please"},
   {"ms": 32629, "text": "Leah Bruner thank you"},
   {"ms": 35155, "text": "confirm booking"}
  ],
  "reopened": 0,
  "errors": [],
  "events": [
   {"ms": 4, "name": "start"},
   {"ms": 284, "name": "audiostart"},
   {"ms": 1478, "name": "soundstart"},
   {"ms": 1478, "name": "speechstart"},
   {"ms": 4567, "name": "final"},
   {"ms": 7064, "name": "final"},
   {"ms": 15948, "name": "final"},
   {"ms": 23050, "name": "final"},
   {"ms": 29144, "name": "final"},
   {"ms": 32629, "name": "final"},
   {"ms": 35155, "name": "final"},
   {"ms": 39122, "name": "speechend"},
   {"ms": 39122, "name": "soundend"},
   {"ms": 39122, "name": "audioend"},
   {"ms": 39242, "name": "end"}
  ],
  "durationMs": 39242
 }
};

/**
 * What a small language model answered for these texts when the prompt of the reading route was
 * tried out, before any check: one raw answer per text, the call after each of its phrases.
 */
export const FIRST_ROUND_MODEL_ANSWERS: Record<string, unknown> = {
 "en-01": {
  "intent": "availability",
  "language": "en",
  "serviceId": "",
  "employeeId": "",
  "date": "2026-11-26",
  "time": "15:00",
  "partOfDay": "",
  "customerName": ""
 },
 "en-02": {
  "intent": "availability",
  "language": "en",
  "serviceId": "srv-2",
  "employeeId": "",
  "date": "2026-11-27",
  "time": "10:30",
  "partOfDay": "",
  "customerName": ""
 },
 "en-03": {
  "intent": "availability",
  "language": "en",
  "serviceId": "srv-3",
  "employeeId": "",
  "date": "2026-11-20",
  "time": "09:15",
  "partOfDay": "",
  "customerName": ""
 },
 "en-04": {
  "intent": "availability",
  "language": "en",
  "serviceId": "",
  "employeeId": "emp-2",
  "date": "2026-11-24",
  "time": "17:45",
  "partOfDay": "",
  "customerName": ""
 },
 "en-05": {
  "intent": "availability",
  "language": "en",
  "serviceId": "",
  "employeeId": "emp-3",
  "date": "2026-11-21",
  "time": "",
  "partOfDay": "afternoon",
  "customerName": ""
 },
 "en-06": {
  "intent": "unknown",
  "language": "en",
  "serviceId": "",
  "employeeId": "",
  "date": "",
  "time": "",
  "partOfDay": "",
  "customerName": "Leah Brunner"
 },
 "en-07": {
  "intent": "unknown",
  "language": "en",
  "serviceId": "",
  "employeeId": "",
  "date": "",
  "time": "",
  "partOfDay": "",
  "customerName": ""
 },
 "en-08": {
  "intent": "availability",
  "language": "en",
  "serviceId": "",
  "employeeId": "",
  "date": "2026-11-20",
  "time": "11:00",
  "partOfDay": "",
  "customerName": "Leah Broner"
 },
 "en-09": {
  "intent": "cancel",
  "language": "en",
  "serviceId": "",
  "employeeId": "",
  "date": "2026-12-02",
  "time": "",
  "partOfDay": "",
  "customerName": ""
 },
 "en-10": {
  "intent": "book",
  "language": "en",
  "serviceId": "",
  "employeeId": "",
  "date": "",
  "time": "",
  "partOfDay": "",
  "customerName": ""
 },
 "en-11": {
  "intent": "availability",
  "language": "en",
  "serviceId": "",
  "employeeId": "",
  "date": "2026-11-20",
  "time": "",
  "partOfDay": "",
  "customerName": ""
 },
 "en-12": {
  "intent": "unknown",
  "language": "en",
  "serviceId": "",
  "employeeId": "",
  "date": "",
  "time": "",
  "partOfDay": "",
  "customerName": ""
 },
 "call-1": {
  "intent": "unknown",
  "language": "en",
  "serviceId": "",
  "employeeId": "",
  "date": "",
  "time": "",
  "partOfDay": "",
  "customerName": ""
 },
 "call-2": {
  "intent": "availability",
  "language": "en",
  "serviceId": "srv-2",
  "employeeId": "",
  "date": "",
  "time": "",
  "partOfDay": "",
  "customerName": ""
 },
 "call-3": {
  "intent": "availability",
  "language": "en",
  "serviceId": "srv-2",
  "employeeId": "",
  "date": "2026-11-26",
  "time": "15:00",
  "partOfDay": "",
  "customerName": ""
 },
 "call-4": {
  "intent": "availability",
  "language": "en",
  "serviceId": "srv-2",
  "employeeId": "",
  "date": "2026-11-26",
  "time": "15:30",
  "partOfDay": "",
  "customerName": ""
 },
 "call-5": {
  "intent": "availability",
  "language": "en",
  "serviceId": "srv-2",
  "employeeId": "",
  "date": "2026-11-26",
  "time": "15:30",
  "partOfDay": "",
  "customerName": ""
 },
 "call-6": {
  "intent": "availability",
  "language": "en",
  "serviceId": "srv-2",
  "employeeId": "",
  "date": "2026-11-26",
  "time": "15:30",
  "partOfDay": "",
  "customerName": "Leah Bruner"
 },
 "call-7": {
  "intent": "book",
  "language": "en",
  "serviceId": "srv-2",
  "employeeId": "",
  "date": "2026-11-26",
  "time": "15:30",
  "partOfDay": "",
  "customerName": "Leah Bruner"
 }
};
