/**
 * Логика игры: пулы стран по режиму и уровню, генерация раундов и вариантов
 * ответа. Файл не зависит от DOM, поэтому его же проверяет tools/selftest.js.
 *
 * Требует глобальные COUNTRIES (js/data.js) и AVAILABLE (js/assets.js).
 */
'use strict';

/** Режимы игры: флаги и форма территории. */
const MODES = [
  {
    id: 'flags',
    title: 'Флаги',
    icon: '🏳️',
    description: 'Узнай страну по государственному флагу',
    question: 'Чей это флаг?',
    asset: (code) => `assets/flags/${code}.svg`,
    pool: () => AVAILABLE.flags,
    poolLabel: 'флагов'
  },
  {
    id: 'shapes',
    title: 'Территории',
    icon: '🗺️',
    description: 'Узнай страну по форме её территории',
    question: 'Чья это территория?',
    asset: (code) => `assets/shapes/${code}.svg`,
    pool: () => AVAILABLE.shapes,
    poolLabel: 'контуров'
  }
];

/** Уровни сложности. */
const LEVELS = [
  {
    id: 'easy',
    title: 'Лёгкий',
    description: 'Флаги, которые знают все',
    accent: '#34d399'
  },
  {
    id: 'medium',
    title: 'Средний',
    description: 'Популярные страны мира',
    accent: '#60a5fa'
  },
  {
    id: 'hard',
    title: 'Сложный',
    description: 'Малоизвестные страны',
    accent: '#fbbf24'
  },
  {
    id: 'impossible',
    title: 'Невозможный',
    description: 'Микрогосударства, острова, заморские территории',
    accent: '#f87171'
  }
];

/** Сколько вариантов ответа показывать в каждом вопросе. */
const OPTION_COUNT = 4;
const MIN_ROUNDS = 1;
const MAX_ROUNDS = 50;

/** Перемешивает массив (алгоритм Фишера — Йетса), не меняя исходный. */
function shuffle(items, random = Math.random) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = result[i];
    result[i] = result[j];
    result[j] = swap;
  }
  return result;
}

/** Приводит количество раундов к диапазону 1…50. */
function clampRounds(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) {
    return MIN_ROUNDS;
  }
  return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, number));
}

function modeById(modeId) {
  return MODES.find((mode) => mode.id === modeId) || MODES[0];
}

function levelById(levelId) {
  return LEVELS.find((level) => level.id === levelId) || LEVELS[0];
}

/** Все страны, для которых есть картинка в выбранном режиме. */
function availableCountries(modeId) {
  const assets = modeById(modeId).pool();
  return COUNTRIES.filter((country) => assets[country.code]);
}

/** Страны одного режима и уровня — из них берутся и вопросы, и «обманки». */
function poolFor(modeId, levelId) {
  return availableCountries(modeId).filter((country) => country.level === levelId);
}

/**
 * Выбирает страны-вопросы без повторов внутри прохода. Если раундов больше,
 * чем стран в уровне, список проходится заново в новом порядке — при этом
 * два подряд одинаковых вопроса не выпадают.
 */
function pickQuestions(pool, rounds, random) {
  const questions = [];
  let cycle = [];
  while (questions.length < rounds) {
    if (cycle.length === 0) {
      cycle = shuffle(pool, random);
      const previous = questions[questions.length - 1];
      if (previous && cycle.length > 1 && cycle[0].code === previous.code) {
        const first = cycle[0];
        cycle[0] = cycle[1];
        cycle[1] = first;
      }
    }
    questions.push(cycle.shift());
  }
  return questions;
}

/**
 * Собирает четыре варианта ответа: один верный и три «обманки» из того же
 * уровня (если стран в уровне мало — добирает из остальных).
 * Возвращает варианты в случайном порядке.
 */
function buildOptions(correct, pool, allPool, random) {
  const names = [correct.name];
  const takeFrom = (candidates) => {
    for (const candidate of shuffle(candidates, random)) {
      if (names.length >= OPTION_COUNT) {
        return;
      }
      if (!names.includes(candidate.name)) {
        names.push(candidate.name);
      }
    }
  };

  takeFrom(pool.filter((country) => country.code !== correct.code));
  if (names.length < OPTION_COUNT) {
    takeFrom(allPool.filter((country) => country.code !== correct.code));
  }

  return shuffle(names, random).map((name) => ({
    name,
    correct: name === correct.name
  }));
}

/** Создаёт набор раундов для игры. */
function createQuiz({ modeId, levelId, rounds, random = Math.random }) {
  const mode = modeById(modeId);
  const pool = poolFor(modeId, levelId);
  if (pool.length < OPTION_COUNT) {
    throw new Error(`Недостаточно данных: уровень "${levelId}" в режиме "${modeId}"`);
  }

  const questions = pickQuestions(pool, clampRounds(rounds), random).map((country) => ({
    code: country.code,
    name: country.name,
    image: mode.asset(country.code),
    options: buildOptions(country, pool, availableCountries(modeId), random)
  }));

  return {
    modeId: mode.id,
    levelId: levelById(levelId).id,
    rounds: questions.length,
    questions
  };
}

/** Процент правильных ответов. */
function percent(correct, rounds) {
  return rounds > 0 ? Math.round((correct / rounds) * 100) : 0;
}

/** Ключ для личного рекорда в localStorage. */
function bestKey(modeId, levelId) {
  return `flagquiz:best:${modeId}:${levelId}`;
}

/** Текстовая оценка результата. */
function rateResult(value) {
  if (value === 100) {
    return 'Идеально! Ни одной ошибки 🏆';
  }
  if (value >= 90) {
    return 'Профессор географии 🌍';
  }
  if (value >= 70) {
    return 'Отличный результат 🎉';
  }
  if (value >= 50) {
    return 'Неплохо, но можно лучше 💪';
  }
  if (value >= 25) {
    return 'Есть над чем поработать 📚';
  }
  return 'Начало положено 🌱';
}
