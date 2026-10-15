/**
 * Логика дуэли: код пати, протокол обмена сообщениями, счёт и ход матча.
 *
 * Здесь нет ни DOM, ни сети: модуль принимает сообщения соперника и возвращает
 * те, которые нужно отправить в ответ. Поэтому весь сценарий «хост против гостя»
 * проверяется в tools/selftest.js на общей шине, без браузера.
 */
'use strict';

const DUEL_PROTOCOL = 1;
const DUEL_MAX_NAME = 16;
const DUEL_MAX_ROUNDS = MAX_ROUNDS;
const PARTY_CODE_LENGTH = 4;
/** В коде пати нет символов 0/O и 1/I — их слишком легко перепутать при вводе. */
const PARTY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PARTY_CHANNEL_PREFIX = 'flagquiz-party-';
const DUEL_MESSAGE_TYPES = ['join', 'welcome', 'quiz', 'answer', 'rematch', 'leave', 'error'];
const DUEL_MESSAGE_LIMIT = 200000;
/** Больше 10 минут на раунд ответ ждать не имеет смысла. */
const DUEL_MAX_ANSWER_MS = 600000;
const PLACEHOLDER_NAME = 'Игрок';

/* ------------------------------------------------------------- код и имена */

/** Генерирует код пати из четырёх символов. */
function createPartyCode(random = Math.random) {
  let code = '';
  while (code.length < PARTY_CODE_LENGTH) {
    const position = Math.floor(random() * PARTY_ALPHABET.length);
    const index = Math.min(Math.max(position, 0), PARTY_ALPHABET.length - 1);
    code += PARTY_ALPHABET.charAt(index);
  }
  return code;
}

/** Приводит введённый код к каноническому виду; пустая строка — код неверный. */
function normalizePartyCode(value) {
  const text = String(value == null ? '' : value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (text.length !== PARTY_CODE_LENGTH) {
    return '';
  }
  const ok = text.split('').every((char) => PARTY_ALPHABET.includes(char));
  return ok ? text : '';
}

/** Имя игрока: без управляющих символов и угловых скобок, не длиннее 16 знаков. */
function sanitizeName(value) {
  const text = String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim();
  const cut = text.slice(0, DUEL_MAX_NAME).trim();
  return cut || PLACEHOLDER_NAME;
}

/** Имя канала для локальной дуэли (две вкладки на одном устройстве). */
function roomChannelName(code) {
  return PARTY_CHANNEL_PREFIX + code;
}

/* Склонение слова «раунд» и описание настроек берут helpers из js/game.js. */

/** Описание настроек пати для интерфейса: «Флаги · Лёгкий · 5 раундов». */
function describeDuelSettings(settings) {
  const mode = modeById(settings.modeId);
  const level = levelById(settings.levelId);
  const rounds = clampRounds(settings.rounds);
  return `${mode.title} · ${level.title} · ${rounds} ${roundsWord(rounds)}`;
}

/** Приводит настройки пати к допустимым значениям. */
function normalizeDuelSettings(value) {
  const settings = value && typeof value === 'object' ? value : {};
  return {
    modeId: modeById(settings.modeId).id,
    levelId: levelById(settings.levelId).id,
    rounds: clampRounds(settings.rounds)
  };
}

/* ---------------------------------------------------------------- протокол */

/** Собирает сообщение протокола. */
function duelMessage(type, payload) {
  return Object.assign({ v: DUEL_PROTOCOL, type }, payload || {});
}

/** Проверяет входящее сообщение: посторонний мусор в канале игнорируем. */
function parseDuelMessage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  if (typeof raw.type !== 'string' || !DUEL_MESSAGE_TYPES.includes(raw.type)) {
    return null;
  }
  try {
    if (JSON.stringify(raw).length > DUEL_MESSAGE_LIMIT) {
      return null;
    }
  } catch (error) {
    return null;
  }
  return raw;
}

/**
 * Достаёт из сообщения колоду раундов, не доверяя чужому содержимому:
 * длинные строки обрезаем, лишние варианты ответа отбрасываем.
 */
function normalizeDuelDeck(value) {
  const deck = value && typeof value === 'object' ? value : {};
  const list = Array.isArray(deck.questions) ? deck.questions.slice(0, DUEL_MAX_ROUNDS) : [];
  const questions = list
    .filter((question) => question && typeof question === 'object')
    .map((question) => ({
      code: String(question.code || '').slice(0, 8),
      name: String(question.name || '').slice(0, 120),
      image: String(question.image || '').slice(0, 300),
      letters: Math.max(0, Math.round(Number(question.letters) || 0)),
      options: (Array.isArray(question.options) ? question.options.slice(0, OPTION_COUNT) : []).map(
        (option) => ({
          name: String((option && option.name) || '').slice(0, 120),
          correct: Boolean(option && option.correct)
        })
      )
    }))
    .filter((question) => question.name && question.image);

  if (!questions.length) {
    return null;
  }
  const mode = modeById(deck.modeId);
  return {
    modeId: mode.id,
    kind: (mode.kind || 'options') === 'typing' ? 'typing' : 'options',
    levelId: levelById(deck.levelId).id,
    rounds: questions.length,
    questions
  };
}

/* ------------------------------------------------------------------ матч */

/** Игрок внутри матча: счёт, число пройденных раундов и суммарное время ответов. */
function duelPlayer(id, name, isHost) {
  return { id, name, isHost, correct: 0, answered: 0, ms: 0 };
}

/** Время ответа приводится к разумному диапазону: чужому сообщению не доверяем. */
function clampAnswerMs(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }
  return Math.min(DUEL_MAX_ANSWER_MS, number);
}

/**
 * Собирает состояние одного игрока в дуэли.
 *
 * Роли: host собирает колоду из своих настроек и начинает матч, guest получает
 * колоду сообщением. Счёт каждый игрок считает сам из общей колоды, поэтому
 * интерфейсу видно, сколько раундов успел пройти соперник.
 *
 * Методы, возвращающие сообщения, никак не отправляют их сами — этим занимается
 * транспорт (js/net.js), поэтому весь матч проверяется в tools/selftest.js.
 *
 *   join()             — гость заявляет о себе;
 *   hello()            — хост переспрашивает состав пати;
 *   start()            — хост раздаёт колоду и открывает матч;
 *   submit(answer)     — игрок отвечает на раунд;
 *   rematch()          — «ещё раз»: хост собирает новую колоду, гость просит её;
 *   leave()            — игрок выходит из пати;
 *   handle(message)    — принять сообщение соперника;
 *   me()/rival()/answeredCount()/summary() — данные для интерфейса.
 */
function createDuelSession(options) {
  const settings = options && typeof options === 'object' ? options : {};
  const role = settings.role === 'guest' ? 'guest' : 'host';
  const localId = String(settings.clientId || role);
  const local = duelPlayer(localId, sanitizeName(settings.name), role === 'host');
  let opponent = null;

  const state = {
    role,
    code: normalizePartyCode(settings.code) || String(settings.code || ''),
    phase: 'lobby',
    connected: false,
    settings: normalizeDuelSettings(settings.settings),
    rounds: 0,
    quiz: null,
    error: '',
    note: ''
  };
  state.rounds = state.settings.rounds;

  function reset(player) {
    player.correct = 0;
    player.answered = 0;
    player.ms = 0;
  }

  function resetScores() {
    reset(local);
    if (opponent) {
      reset(opponent);
    }
  }

  function record(player, isCorrect, ms) {
    player.answered += 1;
    if (isCorrect) {
      player.correct += 1;
    }
    player.ms += clampAnswerMs(ms);
  }

  /** Запоминает соперника; повторная заявка того же игрока счёт не сбрасывает. */
  function ensureOpponent(id, name, isHost) {
    if (opponent && opponent.id === id) {
      opponent.name = sanitizeName(name);
      return false;
    }
    opponent = duelPlayer(id, name, isHost);
    return true;
  }

  /** Матч сыгран, когда раунды прошли оба игрока (вышедший соперник считается прошедшим). */
  function checkFinished() {
    if (state.phase !== 'playing' || !state.rounds) {
      return;
    }
    const rivalDone = !opponent || !state.connected || opponent.answered >= state.rounds;
    if (local.answered >= state.rounds && rivalDone) {
      state.phase = 'finished';
    }
  }

  function copy(player) {
    return player
      ? {
          id: player.id,
          name: player.name,
          isHost: player.isHost,
          correct: player.correct,
          answered: player.answered,
          ms: player.ms
        }
      : null;
  }

  /** Колода раундов из настроек пати — её собирает только хост. */
  function buildQuiz() {
    try {
      return createQuiz({
        modeId: state.settings.modeId,
        levelId: state.settings.levelId,
        rounds: state.settings.rounds
      });
    } catch (error) {
      state.error = 'Не удалось собрать вопросы для этой пары настроек';
      return null;
    }
  }

  /** Принимает колоду соперника (гость) и заодно выравнивает настройки пати. */
  function applyDeck(value) {
    const deck = normalizeDuelDeck(value);
    if (!deck) {
      state.error = 'Колода соперника не подошла';
      return false;
    }
    state.quiz = deck;
    state.rounds = deck.rounds;
    state.settings = { modeId: deck.modeId, levelId: deck.levelId, rounds: deck.rounds };
    state.error = '';
    state.note = '';
    resetScores();
    state.phase = 'playing';
    return true;
  }

  /** Новая партия на тех же настройках (кнопка «Ещё раз»). */
  function restart() {
    const deck = buildQuiz();
    if (!deck) {
      return false;
    }
    state.quiz = deck;
    state.rounds = deck.rounds;
    state.settings = { modeId: deck.modeId, levelId: deck.levelId, rounds: deck.rounds };
    state.note = '';
    state.error = '';
    resetScores();
    state.phase = 'playing';
    return true;
  }

  /** Колода уходит гостю; resume — повторная заявка уже играющего соперника. */
  function quizMessage(resume) {
    return duelMessage('quiz', { deck: state.quiz, resume: Boolean(resume) });
  }

  function welcomeMessage() {
    return duelMessage('welcome', { id: localId, name: local.name, settings: state.settings });
  }

  /** Итог матча глазами одного игрока: счёт, соперник, победитель. */
  function summary() {
    const me = copy(local);
    const rival = copy(opponent);
    const finished = state.phase === 'finished';
    let outcome = 'draw';
    if (finished) {
      if (!rival) {
        outcome = 'win';
      } else if (me.correct !== rival.correct) {
        outcome = me.correct > rival.correct ? 'win' : 'lose';
      } else if (me.ms !== rival.ms) {
        outcome = me.ms < rival.ms ? 'win' : 'lose';
      }
    }
    let text = 'Ждём соперника…';
    if (!rival) {
      text = 'Соперник не подключился';
    } else if (finished) {
      text = 'Матч завершён';
    } else if (!state.connected) {
      text = 'Соперник вышел из пати';
    } else {
      text = `Соперник прошёл ${rival.answered} из ${state.rounds} ${roundsWord(state.rounds)}`;
    }
    return { finished, outcome, me, rival, text, total: state.rounds };
  }

  return {
    state,
    role,
    host: role === 'host',

    /** Заявка гостя: хост узнаёт имя игрока и настройки пати. */
    join() {
      return role === 'guest' ? [duelMessage('join', { id: localId, name: local.name })] : [];
    },

    /** Ответ хоста: имя, клиентский id и настройки пати. */
    hello() {
      if (role !== 'host' || !state.connected) {
        return [];
      }
      const outgoing = [welcomeMessage()];
      if (state.quiz) {
        outgoing.push(quizMessage(false));
      }
      return outgoing;
    },

    /** Хост начинает матч: собирает колоду и раздаёт её сопернику. */
    start() {
      if (role !== 'host') {
        return [];
      }
      if (!state.connected) {
        state.error = 'Сначала подключите второго игрока';
        return [];
      }
      if (!restart()) {
        return [];
      }
      return [quizMessage()];
    },

    /** Ответ на раунд: счёт ведёт каждый игрок сам, сопернику уходит только результат. */
    submit(answer) {
      if (state.phase !== 'playing') {
        return [];
      }
      const data = answer && typeof answer === 'object' ? answer : {};
      const isCorrect = Boolean(data.correct);
      record(local, isCorrect, data.ms);
      checkFinished();
      return [
        duelMessage('answer', {
          correct: isCorrect,
          ms: clampAnswerMs(data.ms),
          rounds: local.answered
        })
      ];
    },

    /** «Ещё раз»: хост собирает новую колоду, гость просит её у хоста. */
    rematch() {
      if (state.phase === 'lobby') {
        return [];
      }
      if (role === 'host') {
        return restart() ? [quizMessage()] : [];
      }
      return [duelMessage('rematch', { name: local.name })];
    },

    /** Выход из пати. */
    leave() {
      state.connected = false;
      state.note = 'Вы вышли из пати';
      return [duelMessage('leave', { name: local.name })];
    },

    /** Обработка сообщения соперника: возвращает сообщения для отправки. */
    handle(raw) {
      const message = parseDuelMessage(raw);
      if (!message) {
        return [];
      }
      switch (message.type) {
        case 'join': {
          if (role !== 'host') {
            break;
          }
          const wasConnected = state.connected;
          const isNewPlayer = ensureOpponent(String(message.id || 'guest'), message.name, false);
          state.connected = true;
          state.error = '';
          state.note = '';
          const greeting = [welcomeMessage()];
          if (state.quiz) {
            /* повторная заявка уже играющего соперника не должна сбрасывать его прогресс */
            greeting.push(quizMessage(!isNewPlayer && wasConnected && opponent.answered > 0));
          }
          checkFinished();
          return greeting;
        }
        case 'welcome':
          if (role !== 'guest') {
            break;
          }
          ensureOpponent(String(message.id || 'host'), message.name, true);
          state.connected = true;
          state.settings = normalizeDuelSettings(message.settings);
          state.rounds = state.settings.rounds;
          checkFinished();
          break;
        case 'quiz':
          if (role === 'guest') {
            if (message.resume && state.phase === 'playing' && local.answered > 0) {
              break;
            }
            applyDeck(message.deck);
          }
          break;
        case 'answer':
          if (opponent) {
            record(opponent, Boolean(message.correct), message.ms);
            checkFinished();
          }
          break;
        case 'rematch':
          if (role === 'host' && state.connected) {
            return restart() ? [quizMessage()] : [];
          }
          break;
        case 'leave':
          state.connected = false;
          state.note = 'Соперник вышел из пати';
          checkFinished();
          break;
        case 'error':
          state.error = String(message.text || 'Соперник сообщил об ошибке').slice(0, 120);
          break;
        default:
          break;
      }
      return [];
    },

    me() {
      return copy(local);
    },
    rival() {
      return copy(opponent);
    },
    /** Сколько раундов прошёл игрок — по этому числу панель рисует полоски. */
    answeredCount(playerId) {
      if (playerId && playerId === local.id) {
        return local.answered;
      }
      if (opponent && playerId === opponent.id) {
        return opponent.answered;
      }
      return 0;
    },
    /** Идентификатор соперника (пустая строка, пока его нет). */
    rivalId() {
      return opponent ? opponent.id : '';
    },
    /** Итог матча для экрана результатов. */
    summary
  };
}

