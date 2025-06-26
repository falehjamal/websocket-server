// Import Library
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');

// Setup HTTP Server
const app = express();
const httpServer = createServer(app);

// Setup endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Selamat datang di WebSocket Server',
        status: 'running',
        port: 6001,
        version: '1.0.0'
    });
});

// Setup Socket.io

const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    pingInterval: 25000,  // Kirim ping setiap 25 detik
    pingTimeout: 60000,   // Timeout tunggu ping 60 detik
    allowEIO3: true       // Kalau versi client agak lama
});

// Setup Redis Subscriber
const redis = new Redis(); // Default: localhost:6379

// Subscribe semua channel redis
redis.psubscribe('*', (err, count) => {
    if (err) console.error('Error subscribe Redis:', err);
    console.log('Redis subscribed to all channels');
});

// Listen Redis broadcast dari Laravel
redis.on('pmessage', (pattern, channel, message) => {
    console.log('Broadcast from Laravel ->', channel, message);

    const parsedMessage = JSON.parse(message);
    const event = parsedMessage.event;
    const data = parsedMessage.data;

    // Broadcast ke semua client yang connect
    io.emit(`${channel}:${event}`, data);
});

// Listen Client Connection
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Optional: Handle client disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Start Server
httpServer.listen(6001, () => {
    console.log('Socket.io server running on port 6001');
});
