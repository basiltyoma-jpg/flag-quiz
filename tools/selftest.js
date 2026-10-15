/**
 * Проверка данных и логики игры без браузера.
 *
 * Запуск:
 *     node tools/selftest.js
 *
 * Проверяет, что страны уникальны, что для них есть картинки на диске и что
 * во всех режимах и на всех уровнях генерируются корректные раунды с четырьмя
 * вариантами ответа.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const OPTION_COUNT = 4;

let checks = 0;
let failures = 0;

function check(condition, label) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.log(`  [ОШИБКА] ${label}`);
  }
}

function section(title) {
  console.log(`\n== ${title}`);
}

/** Загружает браузерные скрипты в один контекст — так же, как это делает страница. */
function loadGame() {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  ['js/data.js', 'js/assets.js', 'js/game.js', 'js/duel.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  });
  vm.runInContext(
    'this.__api = { COUNTRIES, AVAILABLE, MODES, LEVELS, OPTION_COUNT, MIN_ROUNDS, ' +
      'MAX_ROUNDS, createQuiz, clampRounds, percent, poolFor, bestKey, rateResult, shuffle, ' +
      'lettersIn, normalizeAnswer, editDistance, answerVariants, compareTypedAnswer, roundsWord, ' +
      'createPartyCode, normalizePartyCode, sanitizeName, describeDuelSettings, normalizeDuelSettings, ' +
      'normalizeDuelDeck, duelMessage, parseDuelMessage, createDuelSession };',
    sandbox
  );
  return sandbox.__api;
}

/** Предсказуемый генератор случайных чисел, чтобы тесты не «мигали». */
function seedRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const game = loadGame();
const { COUNTRIES, AVAILABLE, MODES, LEVELS } = game;

/* ------------------------------------------------------------- данные */

section('данные о странах');

const codes = new Set();
const names = new Set();
let badCode = null;
let emptyName = null;
let badLevel = null;

COUNTRIES.forEach((country) => {
  if (!/^[a-z]{2}$/.test(country.code)) {
    badCode = country.code;
  }
  if (!country.name || country.name.trim() === '') {
    emptyName = country.code;
  }
  if (!LEVELS.some((level) => level.id === country.level)) {
    badLevel = `${country.code}:${country.level}`;
  }
  codes.add(country.code);
  names.add(country.name);
});

check(COUNTRIES.length >= 200, `стран должно быть много, а их ${COUNTRIES.length}`);
check(badCode === null, `некорректный код страны: ${badCode}`);
check(emptyName === null, `пустое название у ${emptyName}`);
check(badLevel === null, `неизвестный уровень у ${badLevel}`);
check(codes.size === COUNTRIES.length, 'коды стран должны быть уникальны');
check(names.size === COUNTRIES.length, 'названия стран должны быть уникальны');

LEVELS.forEach((level) => {
  const count = COUNTRIES.filter((country) => country.level === level.id).length;
  check(count >= OPTION_COUNT * 2, `в уровне ${level.id} слишком мало стран: ${count}`);
  console.log(`  ${level.title.padEnd(14)} стран: ${count}`);
});

/* ----------------------------------------------------------- картинки */

section('картинки на диске');
check(AVAILABLE.flags && typeof AVAILABLE.flags === 'object', 'в js/assets.js нет AVAILABLE.flags');
check(AVAILABLE.shapes && typeof AVAILABLE.shapes === 'object', 'в js/assets.js нет AVAILABLE.shapes');

function checkAssets(kind) {
  const manifest = AVAILABLE[kind];
  let missing = 0;
  let wrongSize = 0;
  Object.keys(manifest).forEach((code) => {
    const file = path.join(ROOT, 'assets', kind, `${code}.svg`);
    if (!fs.existsSync(file)) {
      missing += 1;
      if (missing <= 3) {
        console.log(`  [ОШИБКА] нет файла assets/${kind}/${code}.svg`);
      }
      return;
    }
    if (fs.statSync(file).size !== manifest[code]) {
      wrongSize += 1;
    }
  });
  check(missing === 0, `файлов ${kind}: не хватает ${missing}`);
  check(wrongSize === 0, `размеры файлов ${kind} не совпадают с манифестом: ${wrongSize}`);
  return Object.keys(manifest).length;
}

const flagFiles = checkAssets('flags');
const shapeFiles = checkAssets('shapes');
check(flagFiles === COUNTRIES.length, `флагов ${flagFiles}, а стран ${COUNTRIES.length}`);

/* ------------------------------------------------------------- логика */

section('границы настроек');
check(game.clampRounds(0) === 1, 'clampRounds(0) должен давать 1');
check(game.clampRounds(51) === 50, 'clampRounds(51) должен давать 50');
check(game.clampRounds('12') === 12, "clampRounds('12') должен давать 12");
check(game.clampRounds('abc') === 1, "clampRounds('abc') должен давать 1");
check(game.clampRounds(6.6) === 7, 'clampRounds(6.6) должен округлять до 7');
check(game.MIN_ROUNDS === 1 && game.MAX_ROUNDS === 50, 'диапазон раундов должен быть 1…50');
check(game.percent(5, 10) === 50, 'percent(5, 10) должен быть 50');
check(game.percent(0, 0) === 0, 'percent(0, 0) должен быть 0 без деления на ноль');
check(
  game.bestKey('flags', 'easy') !== game.bestKey('shapes', 'easy'),
  'у режимов должны быть разные ключи рекордов'
);

section('генерация раундов');

MODES.forEach((mode) => {
  LEVELS.forEach((level) => {
    const pool = game.poolFor(mode.id, level.id);
    check(
      pool.length >= OPTION_COUNT,
      `${mode.id}/${level.id}: стран с картинкой всего ${pool.length}`
    );

    const rounds = Math.min(game.MAX_ROUNDS, Math.max(1, pool.length));
    const quiz = game.createQuiz({
      modeId: mode.id,
      levelId: level.id,
      rounds,
      random: seedRandom(2024)
    });

    check(quiz.rounds === rounds, `${mode.id}/${level.id}: ожидалось ${rounds} раундов`);
    check(
      quiz.questions.length === rounds,
      `${mode.id}/${level.id}: вопросов ${quiz.questions.length} вместо ${rounds}`
    );

    let badOptions = 0;
    let badLetters = 0;
    let badImage = 0;
    quiz.questions.forEach((question) => {
      if (quiz.kind === 'typing') {
        /* В режиме «Название по флагу» вариантов нет, зато известна длина ответа. */
        if (question.options.length !== 0 || question.letters !== game.lettersIn(question.name)) {
          badLetters += 1;
        }
      } else {
        const optionNames = question.options.map((option) => option.name);
        const correct = question.options.filter((option) => option.correct);
        if (
          question.options.length !== OPTION_COUNT ||
          new Set(optionNames).size !== OPTION_COUNT ||
          correct.length !== 1 ||
          correct[0].name !== question.name ||
          optionNames.indexOf(question.name) < 0
        ) {
          badOptions += 1;
        }
      }
      if (!fs.existsSync(path.join(ROOT, question.image))) {
        badImage += 1;
      }
    });
    check(badOptions === 0, `${mode.id}/${level.id}: некорректных наборов ответов ${badOptions}`);
    check(
      badLetters === 0,
      `${mode.id}/${level.id}: неверная подсказка о длине названия у ${badLetters} вопросов`
    );
    check(badImage === 0, `${mode.id}/${level.id}: не найдено картинок ${badImage}`);

    const uniqueCodes = new Set(quiz.questions.map((question) => question.code));
    check(
      uniqueCodes.size === rounds,
      `${mode.id}/${level.id}: вопросы повторяются (${uniqueCodes.size} уникальных из ${rounds})`
    );

    console.log(
      `  ${`${mode.title} / ${level.title}`.padEnd(26)} стран: ${String(pool.length).padStart(3)}` +
        `, раундов проверено: ${rounds}`
    );
  });
});

section('50 раундов: повторы допустимы, но не подряд');
MODES.forEach((mode) => {
  LEVELS.forEach((level) => {
    const pool = game.poolFor(mode.id, level.id);
    const quiz = game.createQuiz({
      modeId: mode.id,
      levelId: level.id,
      rounds: 50,
      random: seedRandom(777)
    });
    check(quiz.rounds === 50, `${mode.id}/${level.id}: не 50 раундов`);

    let backToBack = 0;
    for (let i = 1; i < quiz.questions.length; i += 1) {
      if (quiz.questions[i].code === quiz.questions[i - 1].code) {
        backToBack += 1;
      }
    }
    check(backToBack === 0, `${mode.id}/${level.id}: есть одинаковые вопросы подряд`);

    const used = new Set(quiz.questions.map((question) => question.code));
    const expectedUnique = Math.min(pool.length, game.MAX_ROUNDS);
    check(
      used.size === expectedUnique,
      `${mode.id}/${level.id}: уникальных стран ${used.size} вместо ${expectedUnique}`
    );

    console.log(
      `  ${`${mode.title} / ${level.title}`.padEnd(26)} 50 раундов,` +
        ` уникальных стран: ${used.size}`
    );
  });
});

/* ------------------------------------------ проверка набранного ответа */

section('набранный ответ (режим «Название по флагу»)');

const TYPING_MODE = MODES.find((mode) => mode.kind === 'typing');
check(Boolean(TYPING_MODE), 'в MODES должен быть режим с kind: "typing"');

check(game.roundsWord(1) === 'раунд', '«1 раунд»');
check(game.roundsWord(3) === 'раунда', '«3 раунда»');
check(game.roundsWord(5) === 'раундов', '«5 раундов»');
check(game.roundsWord(11) === 'раундов', '«11 раундов»');
check(game.roundsWord(21) === 'раунд', '«21 раунд»');

check(game.lettersIn('Кот-д’Ивуар') === 9, `букв в «Кот-д’Ивуар»: ${game.lettersIn('Кот-д’Ивуар')}`);
check(game.normalizeAnswer('  Кот-д’Ивуар ') === 'котдивуар', 'регистр, пробелы и дефис отбрасываются');
check(game.normalizeAnswer('Ёж') === game.normalizeAnswer('еж'), '«ё» и «е» — одно и то же');
check(game.editDistance('испания', 'испания') === 0, 'одинаковые слова — 0 правок');
check(game.editDistance('испания', 'испани') === 1, 'пропущенная буква — 1 правка');
check(game.editDistance('испания', 'испании') === 1, 'лишняя буква — 1 правка');
check(game.editDistance('перу', 'ирак') === 4, 'разные слова — 4 правки');

const france = COUNTRIES.find((country) => country.code === 'fr');
check(Boolean(france), 'в данных должна быть Франция');
check(
  game.compareTypedAnswer('Франция', france).verdict === 'correct',
  'точное название принимается'
);
check(
  game.compareTypedAnswer('  фРАНЦИЯ ', france).verdict === 'correct',
  'регистр и пробелы не мешают'
);
check(
  game.compareTypedAnswer('франци', france).verdict === 'close',
  'пропущенная буква считается опечаткой'
);
check(
  game.compareTypedAnswer('фраанция', france).verdict === 'close',
  'лишняя буква считается опечаткой'
);
check(game.compareTypedAnswer('франция!', france).verdict === 'correct', 'знак в конце не мешает');
check(game.compareTypedAnswer('германия', france).verdict === 'wrong', 'другая страна не проходит');
check(game.compareTypedAnswer('франц', france).verdict === 'wrong', 'короткий ответ без снисхождения');
check(game.compareTypedAnswer('ф', france).verdict === 'wrong', 'одна буква — не ответ');
check(game.compareTypedAnswer('', france).verdict === 'wrong', 'пустой ответ не принимается');
check(game.compareTypedAnswer('   ', france).verdict === 'wrong', 'одни пробелы не принимаются');
check(game.compareTypedAnswer(null, france).verdict === 'wrong', 'null не ломает проверку');
check(
  game.compareTypedAnswer('франци', france).correct === true,
  'опечатка засчитывается как верный ответ'
);
check(
  game.compareTypedAnswer('германия', france).correct === false,
  'неверный ответ не засчитывается'
);

let badAlias = null;
let aliasCount = 0;
COUNTRIES.forEach((country) => {
  (country.aliases || []).forEach((alias) => {
    aliasCount += 1;
    if (game.compareTypedAnswer(alias, country).verdict !== 'correct') {
      badAlias = `${country.code}: «${alias}»`;
    }
  });
});
check(aliasCount >= 15, `синонимов должно быть много, а их ${aliasCount}`);
check(badAlias === null, `синоним не принимается: ${badAlias}`);

let badUpperCase = null;
let badVariant = null;
COUNTRIES.forEach((country) => {
  const messy = ` ${country.name.toUpperCase().replace(/Ё/g, 'Е')} `;
  if (game.compareTypedAnswer(messy, country).verdict !== 'correct') {
    badUpperCase = country.code;
  }
  if (game.answerVariants(country)[0] !== country.name) {
    badVariant = country.code;
  }
});
check(badUpperCase === null, `название в верхнем регистре не принимается: ${badUpperCase}`);
check(badVariant === null, `название должно быть первым вариантом ответа: ${badVariant}`);

const shortCountry = COUNTRIES.find((country) => game.normalizeAnswer(country.name).length === 4);
if (shortCountry) {
  const shortTypo = game.normalizeAnswer(shortCountry.name).slice(0, -1);
  check(
    game.compareTypedAnswer(shortTypo, shortCountry).verdict !== 'close',
    `короткое название (${shortCountry.name}) не прощает опечаток`
  );
}

const strictDeck = game.createQuiz({
  modeId: TYPING_MODE.id,
  levelId: 'easy',
  rounds: 5,
  random: seedRandom(3003)
});
check(strictDeck.kind === 'typing', 'колода режима «Название по флагу» помечена kind: "typing"');
check(
  strictDeck.questions.every((question) => question.options.length === 0),
  'в этом режиме варианты ответа не нужны'
);
check(
  strictDeck.questions.every((question) => question.letters === game.lettersIn(question.name)),
  'в каждом вопросе есть подсказка о числе букв'
);
check(
  strictDeck.questions.every((question) => game.compareTypedAnswer(question.name, question).verdict === 'correct'),
  'название каждого вопроса принимается'
);

/* ------------------------------------------------------------------ дуэль */

section('дуэль: код пати, протокол и матч');

const partyCode = game.createPartyCode(seedRandom(7));
check(partyCode.length === 4, `код пати из четырёх символов (${partyCode})`);
check(
  partyCode.split('').every((char) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.includes(char)),
  'в коде только легко различимые символы'
);
check(game.normalizePartyCode('abcd') === 'ABCD', 'код приводится к верхнему регистру');
check(game.normalizePartyCode('ABCD') === 'ABCD', 'валидный код не меняется');
check(game.normalizePartyCode('abc') === '', 'слишком короткий код не принимается');
check(game.normalizePartyCode('0O1I') === '', 'символы 0/O/1/I запрещены');
check(game.normalizePartyCode('LOVE') === '', 'буква O из алфавита исключена');

check(game.sanitizeName('  Алекс  ') === 'Алекс', 'имя обрезается по краям');
check(game.sanitizeName('') === 'Игрок', 'пустое имя заменяется заглушкой');
check(game.sanitizeName('<script>') === 'script', 'угловые скобки убираются');
check(game.sanitizeName('длинное'.repeat(10)).length === 16, 'имя не длиннее 16 символов');

const normDuel = game.normalizeDuelSettings({ modeId: 'typing', levelId: 'nope', rounds: 500 });
check(normDuel.modeId === 'typing', 'режим пати сохраняется');
check(normDuel.levelId === 'easy', 'неизвестный уровень откатывается к лёгкому');
check(normDuel.rounds === 50, 'раунды в пати ограничены сверху 50');

const duelDeck = game.createQuiz({ modeId: 'flags', levelId: 'easy', rounds: 4, random: seedRandom(42) });
const normDeck = game.normalizeDuelDeck(duelDeck);
check(Boolean(normDeck && normDeck.rounds === 4), 'колода дуэли нормализуется');
check(normDeck && normDeck.questions[0].options.length === 4, 'в колоде сохраняются варианты ответа');
check(game.normalizeDuelDeck(null) === null, 'пустая колода не принимается');
check(game.normalizeDuelDeck({ questions: [] }) === null, 'пустой список вопросов не принимается');

const joinMsg = game.duelMessage('join', { name: 'x' });
check(joinMsg.v === 1 && joinMsg.type === 'join', 'сообщение протокола несёт версию и тип');
check(game.parseDuelMessage(null) === null, 'мусорное сообщение отбрасывается');
check(game.parseDuelMessage('text') === null, 'строка вместо объекта отбрасывается');
check(game.parseDuelMessage({ type: 'hack' }) === null, 'неизвестный тип сообщения отбрасывается');
check(game.parseDuelMessage(joinMsg) !== null, 'валидное сообщение проходит проверку');

/* Полный матч «хост против гостя» на общей шине сообщений. */
const host = game.createDuelSession({
  role: 'host', clientId: 'h', name: 'Хост', code: 'ABCD',
  settings: { modeId: 'flags', levelId: 'easy', rounds: 5 }
});
const guest = game.createDuelSession({
  role: 'guest', clientId: 'g', name: 'Гость', code: 'ABCD', settings: {}
});
function deliver(to, messages) {
  const out = [];
  messages.forEach((message) => { out.push(...to.handle(message)); });
  return out;
}

const welcomes = deliver(host, guest.join());
check(host.state.connected, 'хост видит подключившегося гостя');
deliver(guest, welcomes);
check(guest.state.connected, 'гость получил подтверждение от хоста');

const quizMessages = host.start();
check(quizMessages.length === 1 && quizMessages[0].type === 'quiz', 'хост раздаёт колоду раундов');
deliver(guest, quizMessages);
check(guest.state.phase === 'playing', 'гость переходит к игре после колоды');
check(guest.state.rounds === 5, 'гость получил все 5 раундов');

const hostAnswers = [true, true, true, true, true];
const guestAnswers = [true, false, true, true, false];
for (let round = 0; round < 5; round += 1) {
  deliver(guest, host.submit({ correct: hostAnswers[round], ms: 100 + round }));
  deliver(host, guest.submit({ correct: guestAnswers[round], ms: 200 + round }));
}

const hostSummary = host.summary();
const guestSummary = guest.summary();
check(hostSummary.finished, 'матч завершён для хоста');
check(guestSummary.finished, 'матч завершён для гостя');
check(hostSummary.me.correct === 5, 'хост ответил верно на все раунды');
check(guestSummary.me.correct === 3, 'гость ответил верно на три раунда');
check(hostSummary.outcome === 'win' && guestSummary.outcome === 'lose', 'победитель определён одинаково с обеих сторон');
check(hostSummary.rival && hostSummary.rival.name === 'Гость', 'хост видит имя соперника');

/* «Ещё раз» на тех же настройках. */
deliver(guest, host.rematch());
check(host.state.phase === 'playing', 'после «ещё раз» хост снова в игре');
check(guest.state.phase === 'playing', 'после «ещё раз» гость снова в игре');
check(host.me().correct === 0 && guest.me().correct === 0, 'счёт обнуляется перед новой партией');

section('итог');
console.log(`проверок: ${checks}, ошибок: ${failures}`);
console.log(`стран: ${COUNTRIES.length}, флагов: ${flagFiles}, контуров: ${shapeFiles}`);
process.exit(failures > 0 ? 1 : 0);

