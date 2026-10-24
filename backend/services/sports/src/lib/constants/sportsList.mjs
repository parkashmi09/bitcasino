// constants/sportsList.js — mssports core, moved unchanged
import { isHiddenSport } from "./hiddenSports.mjs";

var ALL_SPORTS = [
  ["1", "Football"],
  ["2", "Tennis"],
  ["3", "Mixed Martial Arts"],
  ["4", "Cricket"],
  ["5", "Golf"],
  ["6", "Boxing"],
  ["7", "Beach Volleyball"],
  ["8", "Table Tennis"],
  ["9", "Futsal"],
  ["10", "Horse Racing"],
  ["11", "E Games"],
  ["15", "Basketball"],
  ["16", "MotoGP"],
  ["17", "Chess"],
  ["18", "Volleyball"],
  ["19", "Ice Hockey"],
  ["22", "Badminton"],
  ["25", "Hockey"],
  ["29", "Cycling"],
  ["32", "Motorbikes"],
  ["33", "Athletics"],
  ["35", "Basketball 3X3"],
  ["37", "Sumo"],
  ["38", "Virtual sports"],
  ["39", "Handball"],
  ["40", "Politics"],
  ["52", "Motor Sports"],
  ["53", "Baseball"],
  ["54", "Rugby Union"],
  ["55", "Rugby League"],
  ["57", "Darts"],
  ["58", "American Football"],
  ["59", "Snooker"],
  ["62", "Soccer"],
  ["64", "Esports"],
  ["65", "Greyhound Racing"],
  ["66", "Kabaddi"],
  ["67", "Boat Racing"],
  ["68", "Esoccer"],
  ["69", "Wrestling"]
];
// Settings and pickers list only the sports this site offers; names of the hidden ones stay
// resolvable for old bets and reports.
var SPORTS_LIST = ALL_SPORTS.filter(([sid]) => !isHiddenSport(sid));
var sportNameById = (id) => {
  const hit = ALL_SPORTS.find(([sid]) => String(sid) === String(id));
  return hit ? hit[1] : `Sport ${id}`;
};

export { SPORTS_LIST, sportNameById };
