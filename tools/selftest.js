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
  ['js/data.js', 'js/assets.js', 'js/game.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  });
  vm.runInContext(
    'this.__api = { COUNTRIES, AVAILABLE, MODES, LEVELS, OPTION_COUNT, MIN_ROUNDS, ' +
      'MAX_ROUNDS, createQuiz, clampRounds, percent, poolFor, bestKey, rateResult, shuffle };',
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
    let badImage = 0;
    quiz.questions.forEach((question) => {
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
      if (!fs.existsSync(path.join(ROOT, question.image))) {
        badImage += 1;
      }
    });
    check(badOptions === 0, `${mode.id}/${level.id}: некорректных наборов ответов ${badOptions}`);
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

section('итог');
console.log(`проверок: ${checks}, ошибок: ${failures}`);
console.log(`стран: ${COUNTRIES.length}, флагов: ${flagFiles}, контуров: ${shapeFiles}`);
process.exit(failures > 0 ? 1 : 0);

