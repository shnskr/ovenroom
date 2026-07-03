const CONFIG = {
  API_URL: "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE",
  CALENDAR_EMBED_URL: "PASTE_YOUR_GOOGLE_CALENDAR_EMBED_URL_HERE",

  BUSINESS_NAME: "쿠키박스",
  ROOM_LABEL: "오븐룸",
  BANK_ACCOUNT: "신한은행 110-630-872960 김지윤",
  KAKAO_CHANNEL_URL: "http://pf.kakao.com/_KWxiRX/chat",

  OPEN_HOUR: 0,
  CLOSE_HOUR: 24,
  SLOT_MINUTES: 60,
  BOOKABLE_DAYS_AHEAD: 0,
  MAX_BOOKING_MINUTES: 0,

  ROOMS: [
    { id: "oven-room", name: "오븐룸" },
  ],

  PRICING: {
    weekdayBands: [
      { start: 0, end: 9, rate: 5000 },
      { start: 9, end: 17, rate: 7500 },
      { start: 17, end: 24, rate: 9000 },
    ],
    weekendBands: [
      { start: 0, end: 9, rate: 6000 },
      { start: 9, end: 13, rate: 9000 },
      { start: 13, end: 22, rate: 10000 },
      { start: 22, end: 24, rate: 9000 },
    ],
    weekendDays: [0, 6],
    extraPersonThreshold: 10,
    extraPersonFeePerHour: 1000,
    memberDiscount: 0.2,
    teamDiscount: 0.2,
  },
};
