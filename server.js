// server.js
// Minimal Node.js + Express + Socket.io backend for a Mafia-style
// social deduction game. Handles:
//   1. Creating a room with a random 4-letter code
//   2. Joining a room by code
//   3. Broadcasting the updated player list to everyone in the room

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Socket.io server. CORS is wide open here for easy local testing —
// lock `origin` down to your real frontend URL before deploying.
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Serve index.html (and any other static assets) from this same folder,
// so you can just open http://localhost:3000 to test.
app.use(express.static(__dirname));

// -----------------------------------------------------------------------
// In-memory room storage.
// Shape: { ROOMCODE: { hostId: string, players: [{ id, name }] } }
//
// NOTE: This lives in server RAM, so it resets on restart and won't work
// if you scale to multiple server instances. For production, swap this
// for Redis (or similar) shared storage.
// -----------------------------------------------------------------------
const rooms = {};

// Generates a random 4-letter uppercase room code (e.g. "KXQZ").
// Re-rolls on the rare chance it collides with an existing room.
function generateRoomCode() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += letters[Math.floor(Math.random() * letters.length)];
    }
  } while (rooms[code]);
  return code;
}

// Small helper so we always send the same shape of player list to clients.
function getPlayerList(roomCode) {
  return rooms[roomCode] ? rooms[roomCode].players : [];
}

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // ---- CREATE ROOM --------------------------------------------------
  // Client sends: { playerName }
  socket.on('createRoom', ({ playerName }) => {
    const roomCode = generateRoomCode();

    rooms[roomCode] = {
      hostId: socket.id,
      players: [{ id: socket.id, name: playerName }],
    };

    // Join the underlying Socket.io room so io.to(roomCode) reaches this socket.
    socket.join(roomCode);

    // Stash room info on the socket itself — makes cleanup on disconnect easy.
    socket.data.roomCode = roomCode;
    socket.data.playerName = playerName;

    // Only the creator needs this event — tells them their new room code.
    socket.emit('roomCreated', {
      roomCode,
      players: getPlayerList(roomCode),
    });

    console.log(`Room ${roomCode} created by ${playerName}`);
  });

  // ---- JOIN ROOM ------------------------------------------------------
  // Client sends: { roomCode, playerName }
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    roomCode = (roomCode || '').toUpperCase().trim();
    const room = rooms[roomCode];

    if (!room) {
      socket.emit('errorMessage', `Room "${roomCode}" doesn't exist.`);
      return;
    }

    room.players.push({ id: socket.id, name: playerName });
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerName = playerName;

    // Confirm to the joining player specifically that it worked.
    socket.emit('roomJoined', {
      roomCode,
      players: getPlayerList(roomCode),
    });

    // Broadcast the updated player list to EVERYONE in the room (including
    // the new player) so every open lobby screen updates in real time.
    io.to(roomCode).emit('updatePlayerList', getPlayerList(roomCode));

    console.log(`${playerName} joined room ${roomCode}`);
  });

  // ---- DISCONNECT -------------------------------------------------------
  // Remove the player from their room and let everyone else know.
  socket.on('disconnect', () => {
    const { roomCode, playerName } = socket.data;
    if (!roomCode || !rooms[roomCode]) return;

    const room = rooms[roomCode];
    room.players = room.players.filter((p) => p.id !== socket.id);

    if (room.players.length === 0) {
      // Nobody left — clean up the room entirely.
      delete rooms[roomCode];
      console.log(`Room ${roomCode} closed (empty)`);
    } else {
      io.to(roomCode).emit('updatePlayerList', getPlayerList(roomCode));
      console.log(`${playerName} left room ${roomCode}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
