'use strict';

/**
 * The socket event names, LIFTED VERBATIM from
 * `legacy/General/Constant/index.js`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THESE ARE THE WIRE PROTOCOL AND THEY CANNOT BE CHANGED
 *
 * Every name is an opaque hash — `SEND_TIP` is
 * `573a867973fa586555cab080e7d837ad` — and it is what shipped clients
 * emit and listen on. A single character different anywhere in this file and
 * that event silently stops working for every player: the server listens on
 * one string, the client sends another, and neither side errors. It just goes
 * quiet.
 *
 * So this was COPIED, not retyped. Do not tidy it, do not rename a key, do not
 * fix the ones that look like typos — `PLAT_SLOTS` and `inr_History`
 * are inconsistent with everything around them and are correct as they are.
 * Several values contain characters no hash function produces
 * (`...9jxd7hm7`, `...ci73bd3`, `1c21e823212f96113sd7725Q`); they
 * were hand-edited at some point and are still what the clients send.
 *
 * `tools/socket-inventory.js` resolves these, so the inventory reports what a
 * client actually sends rather than the name the source uses.
 * ═════════════════════════════════════════════════════════════════════════
 */
const EVENTS = Object.freeze({
  CREDIT: "660cb6fe7737d7b70e7a07b706b93f70",
  MY_BETS: "fd2a0537bcdae1736f552707b3bd3156",
  MY_HISTORY: "fd2a0537bcdae1736f552707b3bd3157",
  inr_History:"fd2a0537bcdae1736f552707b3bd3160",
  BANKROLL: "0c30c5a602062107a5d356d0eb1ebb8e",
  LAST_BETS_BY_GAME: "b87a2e8036f0617125ffb69dd5673d7b",
  LAST_BETS: "62f8c260fbce6de8e5ed19767977cc1e",
  TOP_WINNERS: "b7cafd57089c07ade71b7776085660a0",
  GET_ADDRESS: "396bbdcf7c16c3f3795d932b698ef78f",
  CREDIT_COIN: "e70b7663b91b67a7f7e027c00f5a30e2",
  USER_INFO: "18566cda79f670c2098360799275aa31",
  USER_CHART: "1cf37d076d187195c2d7d5e3678dfe0b",
  GAME_DETAILS: "657cdcaf1b9072c7d708bb3766bd3915",
  NOTIFICATION: "f37bd2f66651e7d76f6d38770f2bc5dd",
  UPDATE_PAYMENT_STATUS: "23723ece8c3db7267fcaa661ec6a7f72",
  DEPOSIT_HISTORY: "cccff8ec16dfd682555f7ef1566c7757",
  MESSAGES: "de70938879b75d3db63bba721c93e018",
  ADD_MESSAGES: "292d72d37f7e189059f7f998737de9bb",
  SUBMIT_NEW_WITHDRAWL: "7c0b37955cf21c7f2f3773c1268edc08",
  SUBMIT_NEW_SWAP: "f2ca6e08d1e7d76f6ddcbcdubci73bd3",
  RAKEBACK_AMOUNT: "4d0779dab780d8b773e7h6fl9jxd7hm7",
  ADD_RAKEBACK: "k2089ht7ae660578ed9gffgh8hkk7vxj",
  ADD_CHAT: "1e6ccf0ddced017179b173e5cc78beea",
  CHATS: "7a7fe97bbc5ff21a561b79986db975c5",
  ADD_FRIEND: "265ea6ce905188a0751e8f0273d30bb7",
  SEND_TIP: "573a867973fa586555cab080e7d837ad",
  EDIT_ACCOUNT: "ca6e08ddde39ee9f965270b7d8175d17",
  EDIT_PASSWORD: "ed7feda03376fd39087183552f093e6a",
  WALLET_HISTORY: "c23c59dd3258d3a53d7132652f8bf98a",
  MY_FRIENDS: "1e73d7d857e371f00a56105a7a38a576",
  SAVE_ACCOUNT: "70a765ca577e8cc77d3e27f70e56b237",
  SAVE_ACCOUNT_PASSWORD: "bd3d5bf93eb508dc9282a1077a16a773",
  SAVE_AVATAR: "d0779dab750dc765ddcf06b190ad82bf",
  ONLINE: "7f76165777d11ee5836777d85df2cdab",
  GET_UID: "002b67aa7d872615cc6ef9ffa78c766d",
  AUTH: "fa53b91ccc1b78668d5af58e1ed3a785",
  UPDATE_CREDIT: "80d8b773e76b21777faaccfbd3c2a687",
  ADD_BET: "86751663a7022702d9630a115515da7b",
  SUPPORT_EMAIL: "92beb160c15977c905cb7b72138e26c0",
  LOGIN_USER: "faf9ba208ad90e7313b6ffafde53b801",
  LOGIN_USER_GOOGLE: "383f7bf0257c3ef6cab20278dd1579be",
  ONLINE_LOGGED: "faf9ba208bd90e2313b6faeede53b801",
  REGISTER_USER: "0a2637735ee07dd5f0e5eba7b9ca1ce7",
  RESET_PASSWORD: "62a0b91a9b98a7ec19f27e72c13de207",
  LOGOUT_USER: "1f7009c5312bab76e660578ecbe08350",
  CREDIT_ERROR: "1fdf15e7dcba3211ebe22e5fdbcec79f",
  RAIN: "23678db5efde9ab76bce8c23a6d91b50",
  MY_AFF: "158674db5efde9ab76bce8c23a6d91b50",
  DISCONNECT: "disconnect",
  TWO_FA: "158231da5231e9ab76b2323232136d91b50",
  TWO_FA_CONFIRM: "158231da52345s194323232211136d91b50",
  TWO_FA_DISABLE: "1582223323345s19432325311136d91b50",
  SEND_TIP_SELF: "1c21f730837b25132153ed7063e7726D",

  //Admin
  ADMIN_SET_MUTE: "eca6e08ddde39e22f965270b7d8175d17",
  ADMIN_ADD_AVATAR: "15e76a8d237dd050a301d1f33967175a",
  ADMIN_ADD_CHAT: "2118e57f1f2bb7979c9a7796d6be671d",
  ADMIN_ADD_BOT: "2638817f1f2bbs979c9a779626be671d",

  //Slots
  SLOTS: "15867442221de21b76bce82123a6d91120",
  PLAT_SLOTS: "1c21f730837b2f96d129877063d7726E",
  ADD_SLOT_BET: "1c21f730837b2f96d129877063e7726D",

  //Sport Bets
  SPORT_GAME: "1c21f3308372251321e3ed7063e7726D",

  //Games
  GAMES: "f464cc8e884061eb09553186bdb2e9c1",
  STATUS_CLASSIC_DICE: "87d6e86fe91be15e57e126a951beae08",
  PLAY_CLASSIC_DICE: "05db5c137ef2e883b7087edce72e2560",
  BUSTED_CLASSIC_DICE: "f9755211defdeb7e7e12ed365bd35b79",
  ERROR_CLASSIC_DICE: "ef39faa35d2060a86223756ad06a18a2",

  STATUS_HASH_DICE: "d7f1c3cb9bfe76823a51a78637a7faa5",
  PLAY_HASH_DICE: "893295c0a9bc0fe35edf976858c08ba9",
  BUSTED_HASH_DICE: "ab8e798a36787206eb7dd6f190261caf",
  ERROR_HASH_DICE: "ef39faa35d2060a86223756ad06a18a2",

  STATUS_MINE: "918b81db5e91d031578b963c93875e5b",
  PLAY_MINE: "efc657038309b57bd7ce999191a10f51",
  CLICKED_MINE: "3d7d71f8b39b977f17ba6f070bb7a8d1",
  CASHOUT_MINE: "bf08d86b806e89d7627d89109ed33677",
  BUSTED_MINE: "9d72598debd7b3be7937b113396370f9",
  ERORR_MINE: "952f978bd7b3d892a2f3f1c3f75dcc99",

  STATUS_HILO: "6e9dd081f0ab25f3b57813790988f662",
  PLAY_HILO: "9ce3bafdf91d8deaae771e67bb2b3eea",
  BUSTED_HILO: "3ddbdbcc255f3136957781c2285d8277",
  NEXT_HILO: "27183e552cd9736705cf6213bfebd00",
  HIGH_HILO: "27183e312cd9736705cf6c23bfebd00",
  LOW_HILO: "27183e552cd973670321213bfebd00",
  CASHOUT_HILO: "37183e55acd9736705cf67ac7bfebd00",
  ERROR_HILO: "fd5ecee21ceb5731285a32711eee706b",

  STATUS_CRASH: "dcaa9fd7f23aaf0c29f570becf35b76f",
  PLAYERS_CRASH: "0fd0a8ecb587292055e1c775d6c39a7e",
  PLAY_CRASH: "05131bff83db9a797b5e9793cfa3bcf6",
  FINISH_CRASH: "97c73db9a306213ac2b5c3bdecd20e75",
  WAITING_CRASH: "be91b2a797f2961c59b2780d2cd72e12",
  STARTED_CRASH: "e112267b9590259c29b9301fa39c1f3d",
  BUSTED_CRASH: "a8f6d02877d198b08b7c7f2a1af69d06",
  ERROR_CRASH: "d9fe15b677f93abbe07076807291e9c6",
  HISTORY_CRASH: "d9fe15b677f93abce07076807291e2d6",

  STATUS_WHEEL: "5eda0ea98768e91b815fa6667e7f0178",
  PLAY_WHEEL: "c8286908aae1ad02a33b83dd9f827921",
  BUSTED_WHEEL: "7f99f77160fcd2db71126301a960ff77",
  ERROR_WHEEL: "6ea7f872b857889c21f8c5dd2833b8b2",

  STATUS_KENO: "d57cd08cb7980bfea9552583d35bbcb6",
  PLAY_KENO: "a68791c6937532f98fa1be087171f1cc",
  WAITING_KENO: "66758925029b8e0c7e327cabc7b77139",
  STARTED_KENO: "e152b89f879258252dbbbab7799c1f9c",
  BUSTED_KENO: "6392cf7c311ae3ec7daec13d886c8755",
  KENO_AMOUNT: "312c65a895c7366ce3afe2eefea00c07",
  ERORR_KENO: "555020f1aa7a306a5ef93c9c57c7bfa1",

  STATUS_SINGLE_KENO: "70971a2722e280c337d30e93c37f8a66",
  PLAY_SINGLE_KENO: "5a828e282af3d79f90ad3b7763052d6e",
  BUSTED_SINGLE_KENO: "1fcc8361a035dbe7a63f290ada5778fd",
  ERROR_SINGLE_KENO: "2663d265faad0226a1db572228e108c9",

  STATUS_PLINKO: "8352353a2cdc5271f9ec72f7d83395fd",
  PLAY_PLINKO: "f31c1e97179a0c766a9da0fdde28d3ed",
  BUSTED_PLINKO: "08fb63257693a2d07a6f32e77310695e",
  ERROR_PLINKO: "73977220535be6896993770579307689",

  STATUS_LIMBO: "f715ed50ac09682c7fceec6b397b78d5",
  PLAY_LIMBO: "18867ffabc768e07378cdaa6df18c75c",
  BUSTED_LIMBO: "b006d95a97feb32faf257228d6030bfb",
  ERROR_LIMBO: "7c385c590a77652a67508ebc2e63b0f6",

  PLAY_ROULETTE: "1c21f730837b2f96d129877063d7720B",
  BUSTED_ROULETTE: "1c21f730837b2f96d129877063d7720W",
  ERROR_ROULETTE: "1c21f730837b2f96d129877063d7720C",

  PLAY_VIDEOPOKER: "1c21f730837b2f96d129877063d7725Q",
  BUSTED_VIDEOPOKER: "1c21f730837b2f96d129877063d7731W",
  ERROR_VIDEOPOKER: "1c21f730837b2f96d179877063d2720D",

  PLAY_BLACKJACK: "1c21e830837b2f96d129877063d7725Q",
  BUSTED_BLACKJACK: "1c31f730837b2f96d129827063d7731W",
  ERROR_BLACKJACK: "1c31f730837b2f92d179877063d2720D",

  STATUS_GOAL: "912b81db5191d031578b963c93875e5b",
  PLAY_GOAL: "e2c657038309b57bd7ce999191a10f51",
  CLICKED_GOAL: "3d7d71f8b392977f17ba6f070bb7a8d1",
  CASHOUT_GOAL: "bf03d86b806e89d7627d89109ed33677",
  BUSTED_GOAL: "9d72598debd7b3be7937b111296370f9",
  ERORR_GOAL: "952f978bd7b3d892a3213f1c3f75dcc99",

  PLAY_SNAKEANDLADDERS: "e2c657021309b57bd7ce999191a10f51",
  NEXT_SNAKEANDLADDERS: "e2c65704231b57be851e999191a10f51",
  CLICKED_SNAKEANDLADDERS: "3d7d71e1b392977f17ba6f070bb7a8d1",
  CASHOUT_SNAKEANDLADDERS: "bf03d212806e89d7627d89109ed33677",
  BUSTED_SNAKEANDLADDERS: "9d72598de4327b3be7937b111296370f9",
  ERORR_SNAKEANDLADDERS: "952f978bd7b3d534a3213f1c3f75dcc99",

  PLAY_BACCARAT: "1c21e830837b2f9612121133sd7725Q",
  BUSTED_BACCARAT: "1c31f12135b2f96d129827063d7731W",
  ERROR_BACCARAT: "1c31f730837b2f92d223232d2720D",

  PLAY_THREE_CARD_MONTE: "1c21e823212f96113sd7725Q",
  BUSTED_THREE_CARD_MONTE: "1c31f1213521236d129827063d7731W",
  ERROR_THREE_CARD_MONTE: "1c3273083723133232d2720D",

  PLAY_JOCKER: "1c2233e3212f96113sd7725Q",
  BUSTED_JOCKER: "1c31f1213521231129827063a731W",
  ERROR_JOCKER: "1c32730832133232d2720D",

  PLAY_MAGIC_WHEEL: "5eda0ea98768e9123231667e7f0178",
  BUSTED_MAGIC_WHEEL: "7f99f72323fcd2db71126301a960ff77",
  ERROR_MAGIC_WHEEL: "6ea7f872232357889c21f8c5dd2833b8b2",

  PLAY_TOWER: "5eda0ea98752c5a85223231667e7f0178",
  BUSTED_TOWER: "7f99f783123fcd2db71126301a960ff77",
  ERROR_TOWER: "6ea7f8722323343441c21f8c5dd2833b8b2",

  PLAY_DIAMOND: "5eda0ea98752c5a85212a01a960ff77",
  BUSTED_DIAMOND: "7f9f783123fcd2db741231421453301a960ff77",
  ERROR_DIAMOND: "6ea7f872232352342348c5dd2833b8b2",

  PLAY_HIGHLOW: "5eda0ea987532c5a85212a01a960ff77",
  BUSTED_HIGHLOW: "7f9f7831243fcd2db741231421453301a960ff77",
  PLAY_HIGHLOW: "6ea7f87223223242348c5dd2833b8b2",
});

/**
 * Events legacy never put in the constant table.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THESE ARE A SEPARATE OBJECT
 *
 * `EVENTS` above is a mirror of `legacy/General/Constant/index.js`, pinned by a
 * test that fails if a key appears here which is not there. That test is worth
 * keeping exactly as strict as it is — it is what guarantees no hash was
 * retyped.
 *
 * But not every socket event went through that file. Nine handlers were
 * registered on a plain string literal instead — eight of which are below, the
 * ninth being `new_query`, which has no ported form and is deliberately absent
 * (see `services/user/src/modules/social/sockets.js`):
 *
 *     client.on("wheeler", …)                    legacy/Users/index.js
 *     client.on('getBonusTimers', …)             legacy/index.js
 *     socket.on("identify", …)                   legacy/siteconfig/sockets/
 *     socket.on('subscribeUserConfig', …)        legacy/siteconfig/sockets/
 *     client.on('admin_notify', …)               legacy/Admin/index.js
 *     socket.on('getAdminProfile', …)            legacy/system/sockets/
 *     socket.on('getUsersAllDetails', …)         legacy/system/sockets/
 *     socket.on('stopUsersAllDetails', …)        legacy/system/sockets/
 *
 * The remaining entries are names a handler replies *on* rather than listens
 * on — `bonusTimerUpdate`, `userConfigUpdated`, `siteConfigUpdated`,
 * `usersAllDetails`. Legacy answered several events on a different name from
 * the one it was asked on, and shipped clients listen for those.
 *
 * They are just as much the wire protocol as the hashed ones — a shipped
 * client emits `wheeler` — so they are declared, not typed inline at each use.
 * Two tables rather than one so the strictness of the first stays meaningful.
 * ═════════════════════════════════════════════════════════════════════════
 */
const LITERAL_EVENTS = Object.freeze({
  /** The lucky wheel. */
  WHEELER: 'wheeler',
  /** A player's un-claimed bonuses and how long is left on each. */
  GET_BONUS_TIMERS: 'getBonusTimers',
  /**
   * The reply to `getBonusTimers`.
   *
   * Legacy answered on a DIFFERENT event from the one it was asked on —
   * `client.on('getBonusTimers', … client.emit('bonusTimerUpdate', …))` — and
   * also pushed the same event from a one-second interval. Kept because
   * shipped clients listen on it; see `bonus/sockets.js` for what the interval
   * cost.
   */
  BONUS_TIMER_UPDATE: 'bonusTimerUpdate',
  /** Site configuration pushes. */
  SITE_CONFIG_UPDATED: 'siteConfigUpdated',
  USER_CONFIG_UPDATED: 'userConfigUpdated',
  SUBSCRIBE_USER_CONFIG: 'subscribeUserConfig',
  IDENTIFY: 'identify',
  /** The operator console. */
  GET_ADMIN_PROFILE: 'getAdminProfile',
  GET_USERS_ALL_DETAILS: 'getUsersAllDetails',
  STOP_USERS_ALL_DETAILS: 'stopUsersAllDetails',
  USERS_ALL_DETAILS: 'usersAllDetails',
  ADMIN_NOTIFY: 'admin_notify',
});

/**
 * Reverse lookup: wire name -> the readable key, for logs and errors.
 *
 * ONE wire name is shared by two keys: `ERROR_CLASSIC_DICE` and
 * `ERROR_HASH_DICE` are both `"ef39faa35d2060a86223756ad06a18a2"` in legacy.
 * On the wire they are a single event, so a client listening for a classic-dice
 * error receives hash-dice errors too. `Object.fromEntries` keeps the later
 * entry, so this map resolves that value to `ERROR_HASH_DICE`.
 *
 * Not corrected, because correcting it changes the protocol: a client
 * listening on the shared name would stop receiving one of the two entirely.
 * It is pinned by a test instead, so it stays visible.
 */
const NAME_OF = Object.freeze(
  Object.fromEntries(
    // Literals first, so a hashed name always wins a collision — there is none
    // today, and if one ever appeared the constant table is the authority.
    [...Object.entries(LITERAL_EVENTS), ...Object.entries(EVENTS)].map(([key, wire]) => [wire, key])
  )
);

module.exports = { EVENTS, LITERAL_EVENTS, NAME_OF };
