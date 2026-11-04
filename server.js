
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const questions = require('./questions');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const MAX_PLAYERS = 5;
const QUESTION_MS = 20_000;
const REVEAL_MS = 2_500;
const TOTAL_QUESTIONS = questions.length;

app.use(express.static('public'));

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

function code() {
  return String(crypto.randomInt(100000, 1000000));
}

function cleanName(value) {
  return String(value || '')
    .trim()
    .replace(/[<>]/g, '')
    .slice(0, 18);
}

function safeAck(cb) {
  return typeof cb === 'function' ? cb : () => {};
}

function publicPlayers(room) {
  return [...room.players.values()].map(player => ({
    id: player.id,
    name: player.name,
    ready: player.ready,
    score: player.score,
    answered: player.answered
  }));
}

function emitLobby(room) {
  io.to(room.code).emit('lobby:update', {
    code: room.code,
    hostId: room.hostId,
    players: publicPlayers(room),
    canStart:
      room.players.size >= 1 &&
      [...room.players.values()].every(player => player.ready)
  });
}

function shuffledQuestions() {
  const result = questions.map(question => ({ ...question }));

  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function currentPublicQuestion(room) {
  const question = room.round[room.index];

  return {
    number: room.index + 1,
    total: room.round.length,
    question: question.q,
    options: question.o,
    endsAt: room.endsAt,
    duration: QUESTION_MS
  };
}

function sendQuestion(room) {
  if (room.phase !== 'question' && room.phase !== 'starting') return;

  if (room.index >= room.round.length) {
    return finishRoom(room);
  }

  room.phase = 'question';
  room.endsAt = Date.now() + QUESTION_MS;

  for (const player of room.players.values()) {
    player.answered = false;
  }

  io.to(room.code).emit(
    'game:question',
    currentPublicQuestion(room)
  );

  clearTimeout(room.timer);
  room.timer = setTimeout(() => closeQuestion(room), QUESTION_MS);
}

function closeQuestion(room) {
  if (room.phase !== 'question') return;

  clearTimeout(room.timer);
  room.phase = 'reveal';

  const question = room.round[room.index];

  io.to(room.code).emit('game:reveal', {
    correctIndex: question.a,
    scores: publicPlayers(room)
  });

  room.timer = setTimeout(() => {
    room.index++;
    sendQuestion(room);
  }, REVEAL_MS);
}

function finishRoom(room) {
  clearTimeout(room.timer);
  room.phase = 'finished';

  const ranking = publicPlayers(room).sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name)
  );

  io.to(room.code).emit('game:finished', {
    ranking,
    totalQuestions: room.round.length
  });
}

function removePlayer(socket) {
  const roomCode = socket.data.roomCode;
  if (!roomCode) return;

  const room = rooms.get(roomCode);
  if (!room) return;

  const player = room.players.get(socket.id);

  if (player) {
    room.players.delete(socket.id);
  }

  socket.leave(roomCode);
  socket.data.roomCode = null;

  if (room.players.size === 0) {
    clearTimeout(room.timer);
    rooms.delete(roomCode);
    return;
  }

  if (room.hostId === socket.id) {
    room.hostId = room.players.keys().next().value;
  }

  io.to(roomCode).emit(
    'notice',
    `${player?.name || 'Bir oyuncu'} odadan ayrıldı.`
  );

  emitLobby(room);
}

io.on('connection', socket => {

  socket.on('room:create', (data = {}, cb) => {
    const ack = safeAck(cb);

    if (socket.data.roomCode) removePlayer(socket);

    const playerName = cleanName(data.name);

    if (!playerName) {
      return ack({ ok: false, error: 'Bir oyuncu adı gir.' });
    }

    let roomCode;

    do {
      roomCode = code();
    } while (rooms.has(roomCode));

    const room = {
      code: roomCode,
      hostId: socket.id,
      players: new Map(),
      phase: 'lobby',
      round: [],
      index: 0,
      endsAt: 0,
      timer: null
    };

    room.players.set(socket.id, {
      id: socket.id,
      name: playerName,
      ready: false,
      score: 0,
      answered: false
    });

    rooms.set(roomCode, room);

    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    ack({
      ok: true,
      code: roomCode,
      playerId: socket.id
    });

    emitLobby(room);
  });

  socket.on('room:join', (data = {}, cb) => {
    const ack = safeAck(cb);

    if (socket.data.roomCode) removePlayer(socket);

    const roomCode = String(data.code || '').trim();
    const room = rooms.get(roomCode);
    const playerName = cleanName(data.name);

    if (!playerName) {
      return ack({ ok: false, error: 'Bir oyuncu adı gir.' });
    }

    if (!room) {
      return ack({ ok: false, error: 'Bu oda bulunamadı.' });
    }

    if (room.phase !== 'lobby') {
      return ack({ ok: false, error: 'Yarışma başlamış.' });
    }

    if (room.players.size >= MAX_PLAYERS) {
      return ack({
        ok: false,
        error: 'Oda dolu (en fazla 5 oyuncu).'
      });
    }

    room.players.set(socket.id, {
      id: socket.id,
      name: playerName,
      ready: false,
      score: 0,
      answered: false
    });

    socket.join(room.code);
    socket.data.roomCode = room.code;

    ack({
      ok: true,
      code: room.code,
      playerId: socket.id
    });

    emitLobby(room);
    io.to(room.code).emit('notice', `${playerName} odaya katıldı.`);
  });

  socket.on('room:ready', (ready, cb) => {
    const ack = safeAck(cb);
    const room = rooms.get(socket.data.roomCode);

    if (!room || room.phase !== 'lobby') {
      return ack({ ok: false });
    }

    const player = room.players.get(socket.id);

    if (!player) {
      return ack({ ok: false });
    }

    player.ready = !!ready;

    emitLobby(room);
    ack({ ok: true });
  });

  socket.on('game:start', cb => {
    const ack = safeAck(cb);
    const room = rooms.get(socket.data.roomCode);

    if (!room || room.hostId !== socket.id) {
      return ack({
        ok: false,
        error: 'Yalnızca oda sahibi başlatabilir.'
      });
    }

    if (room.phase !== 'lobby') {
      return ack({
        ok: false,
        error: 'Yarışma zaten başlamış.'
      });
    }

    if (room.players.size === 0 ||
        ![...room.players.values()].every(player => player.ready)) {
      return ack({
        ok: false,
        error: 'Herkes hazır olmalı.'
      });
    }

    room.phase = 'starting';
    room.round = shuffledQuestions();
    room.index = 0;

    for (const player of room.players.values()) {
      player.score = 0;
      player.answered = false;
    }

    ack({ ok: true });

    io.to(room.code).emit('game:started');

    clearTimeout(room.timer);
    room.timer = setTimeout(() => sendQuestion(room), 900);
  });

  socket.on('game:answer', (choice, cb) => {
    const ack = safeAck(cb);
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.get(socket.id);

    if (!room || !player || room.phase !== 'question') {
      return ack({
        ok: false,
        error: 'Şu anda cevap alınmıyor.'
      });
    }

    if (player.answered) {
      return ack({
        ok: false,
        error: 'Cevabın zaten kilitlendi.'
      });
    }

    if (!Number.isInteger(choice) || choice < 0 || choice > 3) {
      return ack({
        ok: false,
        error: 'Geçersiz cevap.'
      });
    }

    player.answered = true;

    const correct = choice === room.round[room.index].a;
    let earned = 0;

    if (correct) {
      const remaining = Math.max(0, room.endsAt - Date.now());

      earned = 100 + Math.floor(
        (remaining / QUESTION_MS) * 50
      );

      player.score += earned;
    }

    ack({
      ok: true,
      correct,
      earned,
      locked: true
    });

    io.to(room.code).emit('game:progress', {
      playerId: player.id,
      answered: true,
      score: player.score
    });

    if ([...room.players.values()].every(p => p.answered)) {
      closeQuestion(room);
    }
  });

  socket.on('disconnect', () => {
    removePlayer(socket);
  });
});

server.listen(PORT, () => {
  console.log(`LoL Bilgi Arenası listening on ${PORT}`);
});
