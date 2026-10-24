// utils/sportsNames.js — mssports core, moved unchanged

var sportsDataSet2 = [
  { sid: 4, name: "Cricket", active: true },
  { sid: 1, name: "Football", active: true },
  { sid: 2, name: "Tennis", active: true },
  { sid: 8, name: "Table Tennis", active: true },
  { sid: 68, name: "Esoccer", active: true },
  { sid: 10, name: "Horse Racing", active: true },
  { sid: 65, name: "Greyhound Racing", active: true },
  { sid: 15, name: "Basketball", active: true },
  { sid: 69, name: "Wrestling", active: true },
  { sid: 18, name: "Volleyball", active: true },
  { sid: 22, name: "Badminton", active: true },
  { sid: 59, name: "Snooker", active: true },
  { sid: 57, name: "Darts", active: true },
  { sid: 6, name: "Boxing", active: true },
  { sid: 3, name: "Mixed Martial Arts", active: true },
  { sid: 58, name: "American Football", active: true },
  { sid: 11, name: "E Games", active: true },
  { sid: 19, name: "Ice Hockey", active: true },
  { sid: 9, name: "Futsal", active: true },
  { sid: 40, name: "Politics", active: true },
  { sid: 67, name: "Boat Racing", active: true },
  { sid: 52, name: "Motor Sports", active: true },
  { sid: 12, name: "Greyhounds", active: true },
  // not present in the upstream sports tree
  { sid: 66, name: "Kabaddi", active: true }
];
var nameBySid = new Map(sportsDataSet2.map((s) => [String(s.sid), s.name]));
var sidByName = new Map(sportsDataSet2.map((s) => [s.name.toLowerCase(), s.sid]));

export { sportsDataSet2 };
