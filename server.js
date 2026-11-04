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

app.use(express.static('public'));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

function code() { return String(crypto.randomInt(100000, 1000000)); }
function cleanName(v) { return String(v || '').trim().replace(/[<>]/g, '').slice(0, 18); }
function publicPlayers(room) {
  return [...room.players.values()].map(p => ({ id:p.id, name:p.name, ready:p.ready, score:p.score, answered:p.answered }));
}
function emitLobby(room) {
  io.to(room.code).emit('lobby:update', { code:room.code, hostId:room.hostId, players:publicPlayers(room), canStart:room.players.size >= 1 && [...room.players.values()].every(p => p.ready) });
}
function shuffledQuestions() {
  return questions.map((q, i) => ({ ...q, originalIndex:i })).sort(() => Math.random() - 0.5);
}
function currentPublicQuestion(room) {
  const q = room.round[room.index];
  return { number:room.index + 1, total:30, question:q.q, options:q.o, endsAt:room.endsAt, duration:QUESTION_MS };
}
function sendQuestion(room) {
  if (room.index >= room.round.length) return finishRoom(room);
  room.phase = 'question';
  room.endsAt = Date.now() + QUESTION_MS;
  for (const p of room.players.values()) p.answered = false;
  io.to(room.code).emit('game:question', currentPublicQuestion(room));
  clearTimeout(room.timer);
  room.timer = setTimeout(() => closeQuestion(room), QUESTION_MS);
}
function closeQuestion(room) {
  if (room.phase !== 'question') return;
  clearTimeout(room.timer);
  room.phase = 'reveal';
  const q = room.round[room.index];
  io.to(room.code).emit('game:reveal', { correctIndex:q.a, scores:publicPlayers(room) });
  room.timer = setTimeout(() => {
    room.index++;
    sendQuestion(room);
  }, REVEAL_MS);
}
function finishRoom(room) {
  clearTimeout(room.timer);
  room.phase = 'finished';
  const ranking = publicPlayers(room).sort((a,b) => b.score - a.score || a.name.localeCompare(b.name));
  io.to(room.code).emit('game:finished', { ranking, totalQuestions:30 });
}
function removePlayer(socket, reason='disconnect') {
  const roomCode = socket.data.roomCode;
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  if (!room) return;
  const player = room.players.get(socket.id);
  if (player) room.players.delete(socket.id);
  socket.leave(roomCode);
  socket.data.roomCode = null;
  if (room.players.size === 0) {
    clearTimeout(room.timer);
    rooms.delete(roomCode);
    return;
  }
  if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
  io.to(roomCode).emit('notice', `${player?.name || 'Bir oyuncu'} odadan ayrıldı.`);
  emitLobby(room);
}

io.on('connection', socket => {
  socket.on('room:create', ({name}, cb=()=>{}) => {
    if (socket.data.roomCode) removePlayer(socket);
    const playerName = cleanName(name);
    if (!playerName) return cb({ok:false, error:'Bir oyuncu adı gir.'});
    let roomCode; do { roomCode = code(); } while (rooms.has(roomCode));
    const room = { code:roomCode, hostId:socket.id, players:new Map(), phase:'lobby', round:[], index:0, endsAt:0, timer:null };
    room.players.set(socket.id, {id:socket.id, name:playerName, ready:false, score:0, answered:false});
    rooms.set(roomCode, room); socket.join(roomCode); socket.data.roomCode = roomCode;
    cb({ok:true, code:roomCode, playerId:socket.id}); emitLobby(room);
  });
  socket.on('room:join', ({name, code:roomCode}, cb=()=>{}) => {
    if (socket.data.roomCode) removePlayer(socket);
    const room = rooms.get(String(roomCode || '').trim());
    const playerName = cleanName(name);
    if (!playerName) return cb({ok:false, error:'Bir oyuncu adı gir.'});
    if (!room) return cb({ok:false, error:'Bu oda bulunamadı.'});
    if (room.phase !== 'lobby') return cb({ok:false, error:'Yarışma başlamış.'});
    if (room.players.size >= MAX_PLAYERS) return cb({ok:false, error:'Oda dolu (en fazla 5 oyuncu).'});
    room.players.set(socket.id, {id:socket.id, name:playerName, ready:false, score:0, answered:false});
    socket.join(room.code); socket.data.roomCode = room.code;
    cb({ok:true, code:room.code, playerId:socket.id}); emitLobby(room);
    io.to(room.code).emit('notice', `${playerName} odaya katıldı.`);
  });
  socket.on('room:ready', (ready, cb=()=>{}) => {
    const room = rooms.get(socket.data.roomCode); if (!room || room.phase !== 'lobby') return cb({ok:false});
    const p = room.players.get(socket.id); if (!p) return cb({ok:false});
    p.ready = !!ready; emitLobby(room); cb({ok:true});
  });
  socket.on('game:start', (cb=()=>{}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return cb({ok:false, error:'Yalnızca oda sahibi başlatabilir.'});
    if (room.phase !== 'lobby') return cb({ok:false, error:'Yarışma zaten başlamış.'});
    if (![...room.players.values()].every(p => p.ready)) return cb({ok:false, error:'Herkes hazır olmalı.'});
    room.phase = 'starting'; room.round = shuffledQuestions(); room.index = 0;
    for (const p of room.players.values()) p.score = 0;
    cb({ok:true}); io.to(room.code).emit('game:started');
    setTimeout(() => sendQuestion(room), 900);
  });
  socket.on('game:answer', (choice, cb=()=>{}) => {
    const room = rooms.get(socket.data.roomCode); const p = room?.players.get(socket.id);
    if (!room || !p || room.phase !== 'question') return cb({ok:false, error:'Şu anda cevap alınmıyor.'});
    if (p.answered) return cb({ok:false, error:'Cevabın zaten kilitlendi.'});
    if (!Number.isInteger(choice) || choice < 0 || choice > 3) return cb({ok:false, error:'Geçersiz cevap.'});
    p.answered = true;
    const elapsed = Math.max(0, QUESTION_MS - Math.max(0, room.endsAt - Date.now()));
    const correct = choice === room.round[room.index].a;
    let earned = 0;
    if (correct) {
      const remaining = Math.max(0, room.endsAt - Date.now());
      earned = 100 + Math.floor((remaining / QUESTION_MS) * 50);
      p.score += earned;
    }
    cb({ok:true, correct, earned, locked:true});
    io.to(room.code).emit('game:progress', { playerId:p.id, answered:true, score:p.score });
    if ([...room.players.values()].every(x => x.answered)) closeQuestion(room);
  });
  socket.on('disconnect', () => removePlayer(socket));
});

server.listen(PORT, () => console.log(`LoL Bilgi Arenası listening on ${PORT}`));
