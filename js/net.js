/**
 * Транспорты дуэли: доставка сообщений между двумя игроками.
 *
 * Все виды транспорта реализуют один интерфейс:
 *   send(message)          — отправить сообщение сопернику;
 *   onMessage(handler)     — слушать входящие сообщения;
 *   onStatus(handler)      — узнавать о состоянии соединения;
 *   close()                — закрыть канал;
 *   needsExchange          — нужно ли вручную обмениваться кодами (только P2P).
 *
 * Виды:
 *   local — BroadcastChannel: две вкладки или два окна на одном устройстве;
 *   p2p   — WebRTC: игра через интернет без сервера, игроки обмениваются кодами;
 *   hub   — шина, внедрённая тестом (tools/ui-test.js), в браузере её нет.
 */
'use strict';

/** Публичные STUN-серверы нужны только для установки соединения — данные идут напрямую. */
const P2P_STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];
const P2P_GATHER_TIMEOUT = 4000;

const TRANSPORT_KINDS = [
  {
    id: 'local',
    title: 'Две вкладки',
    description: 'Дуэль в двух окнах или вкладках на этом устройстве'
  },
  {
    id: 'p2p',
    title: 'Через интернет',
    description: 'Прямое соединение без сервера: игроки обмениваются кодами'
  }
];

/* ------------------------------------------------------------ общая основа */

/** Мини-эмиттер: подписка на сообщения и статусы транспорта. */
function createEmitter() {
  const listeners = { message: [], status: [] };
  return {
    on(type, handler) {
      if (typeof handler === 'function' && listeners[type]) {
        listeners[type].push(handler);
      }
    },
    emit(type, payload) {
      (listeners[type] || []).forEach((handler) => {
        try {
          handler(payload);
        } catch (error) {
          /* ошибка обработчика не должна ломать канал связи */
        }
      });
    }
  };
}

/** Идентификатор игрока внутри канала — по нему отбрасываем собственные сообщения. */
function randomClientId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Выполняет функцию в микрозадаче, если браузер это умеет. */
function soon(callback) {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(callback);
  } else {
    window.setTimeout(callback, 0);
  }
}

/** Есть ли в браузере нужные возможности для этого вида транспорта. */
function transportSupported(kind) {
  if (kind === 'p2p') {
    return typeof RTCPeerConnection === 'function';
  }
  if (kind === 'hub') {
    return Boolean(typeof window !== 'undefined' && window.__flagQuizHub);
  }
  return typeof BroadcastChannel === 'function';
}

/** Виды транспорта, доступные в текущем браузере. */
function availableTransportKinds() {
  const list = TRANSPORT_KINDS.filter((item) => transportSupported(item.id));
  if (transportSupported('hub')) {
    list.push({ id: 'hub', title: 'Тестовая шина', description: 'Режим для автотестов' });
  }
  return list;
}

/* ------------------------------------------------- локальная дуэль (вкладки) */

/**
 * BroadcastChannel: сообщение уходит всем вкладкам с тем же именем канала,
 * свою копию отбрасываем по clientId. Ничего настраивать не нужно,
 * поэтому такой дуэлью удобно проверять игру на одном компьютере.
 */
function createLocalTransport(options) {
  const settings = options || {};
  const clientId = settings.clientId || randomClientId();
  const emitter = createEmitter();
  const channel = new BroadcastChannel(roomChannelName(settings.code || ''));

  channel.onmessage = (event) => {
    const data = event && event.data;
    if (!data || typeof data !== 'object' || data.from === clientId) {
      return;
    }
    emitter.emit('message', data);
  };

  return {
    kind: 'local',
    clientId,
    needsExchange: false,
    send(message) {
      channel.postMessage(Object.assign({}, message, { from: clientId }));
      return true;
    },
    onMessage(handler) {
      emitter.on('message', handler);
    },
    onStatus(handler) {
      emitter.on('status', handler);
    },
    close() {
      try {
        channel.close();
      } catch (error) {
        /* канал уже закрыт */
      }
    },
    ready() {
      soon(() => emitter.emit('status', { state: 'open', text: 'Локальный канал открыт' }));
    }
  };
}

/* --------------------------------------------- шина, внедрённая автотестом */

/** Транспорт поверх window.__flagQuizHub — используется только в tools/ui-test.js. */
function createHubTransport(options) {
  const settings = options || {};
  const hub = (typeof window !== 'undefined' && window.__flagQuizHub) || null;
  const clientId = settings.clientId || randomClientId();
  const code = settings.code || '';
  const emitter = createEmitter();

  let unsubscribe = null;
  if (hub && typeof hub.join === 'function') {
    const result = hub.join(code, (message) => {
      if (!message || typeof message !== 'object' || message.from === clientId) {
        return;
      }
      emitter.emit('message', message);
    });
    /* Шина может вернуть функцию отписки — тогда закрывать её через hub.leave не нужно. */
    if (typeof result === 'function') {
      unsubscribe = result;
    }
  }

  return {
    kind: 'hub',
    clientId,
    needsExchange: false,
    send(message) {
      if (!hub || typeof hub.send !== 'function') {
        return false;
      }
      hub.send(code, Object.assign({}, message, { from: clientId }));
      return true;
    },
    onMessage(handler) {
      emitter.on('message', handler);
    },
    onStatus(handler) {
      emitter.on('status', handler);
    },
    close() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (hub && typeof hub.leave === 'function') {
        hub.leave(code, clientId);
      }
    },
    ready() {
      soon(() => emitter.emit('status', { state: 'open', text: 'Тестовая шина готова' }));
    }
  };
}

/* ------------------------------------------ дуэль через интернет (WebRTC) */

/** Ждёт завершения сбора ICE-кандидатов, но не дольше P2P_GATHER_TIMEOUT. */
function waitForCandidates(connection) {
  return new Promise((resolve) => {
    if (connection.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const finish = () => {
      window.clearTimeout(timerId);
      connection.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (connection.iceGatheringState === 'complete') {
        finish();
      }
    };
    const timerId = window.setTimeout(finish, P2P_GATHER_TIMEOUT);
    connection.addEventListener('icegatheringstatechange', onChange);
  });
}

/**
 * WebRTC-соединение с ручным обменом кодами: сервера нет, поэтому хост копирует
 * код-приглашение, гость возвращает код-ответ. Дальше данные идут напрямую.
 * Коды упаковывает js/signal.js.
 */
function createP2PTransport(options) {
  const settings = options || {};
  const clientId = settings.clientId || randomClientId();
  const emitter = createEmitter();
  const connection = new RTCPeerConnection({ iceServers: [{ urls: P2P_STUN_URLS }] });
  let channel = null;

  const status = (state, text) => emitter.emit('status', { state, text });

  function bindChannel(target) {
    channel = target;
    channel.onopen = () => status('open', 'Соединение установлено');
    channel.onclose = () => status('closed', 'Соединение закрыто');
    channel.onerror = () => status('error', 'Ошибка канала связи');
    channel.onmessage = (event) => {
      let data = event.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch (error) {
          return;
        }
      }
      if (data && typeof data === 'object') {
        emitter.emit('message', data);
      }
    };
  }

  connection.oniceconnectionstatechange = () => {
    if (connection.iceConnectionState === 'failed') {
      status('error', 'Не удалось соединиться: проверьте коды или сеть');
    }
  };

  return {
    kind: 'p2p',
    clientId,
    needsExchange: true,
    send(message) {
      if (!channel || channel.readyState !== 'open') {
        return false;
      }
      channel.send(JSON.stringify(message));
      return true;
    },
    onMessage(handler) {
      emitter.on('message', handler);
    },
    onStatus(handler) {
      emitter.on('status', handler);
    },
    close() {
      try {
        if (channel) {
          channel.close();
        }
        connection.close();
      } catch (error) {
        /* соединение уже закрыто */
      }
    },
    /** Хост: создаёт код-приглашение. */
    async createInvite() {
      bindChannel(connection.createDataChannel('flag-quiz', { ordered: true }));
      status('gathering', 'Собираем код-приглашение…');
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      await waitForCandidates(connection);
      return packSignal({
        type: connection.localDescription.type,
        sdp: connection.localDescription.sdp
      });
    },
    /** Гость: принимает код-приглашение и возвращает код-ответ. */
    async acceptInvite(invite) {
      const payload = await unpackSignal(invite);
      connection.ondatachannel = (event) => bindChannel(event.channel);
      await connection.setRemoteDescription({ type: payload.type, sdp: payload.sdp });
      status('gathering', 'Готовим код-ответ…');
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      await waitForCandidates(connection);
      status('connecting', 'Отправьте код-ответ хосту');
      return packSignal({
        type: connection.localDescription.type,
        sdp: connection.localDescription.sdp
      });
    },
    /** Хост: принимает код-ответ гостя. */
    async acceptReply(reply) {
      const payload = await unpackSignal(reply);
      await connection.setRemoteDescription({ type: payload.type, sdp: payload.sdp });
      status('connecting', 'Соединяемся…');
    }
  };
}

/* ------------------------------------------------------ выбор транспорта */

/** Создаёт транспорт нужного вида и сразу открывает его. */
function createTransport(kind, options) {
  const settings = options || {};
  let transport;
  if (kind === 'p2p') {
    transport = createP2PTransport(settings);
  } else if (kind === 'hub') {
    transport = createHubTransport(settings);
  } else {
    transport = createLocalTransport(settings);
  }
  if (typeof transport.ready === 'function') {
    transport.ready();
  }
  return transport;
}

