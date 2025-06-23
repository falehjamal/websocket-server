const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const cors = require('cors');
const winston = require('winston');
const fs = require('fs');

// Setup logging
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'socketio-server' },
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});

// Configuration
const config = {
    port: process.env.SOCKETIO_PORT || 6001,
    redis: {
        url: 'redis://10.0.108.248:6379/0'
    },
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        credentials: false
    }
};

// Express app
const app = express();
app.use(cors(config.cors));
app.use(express.json());

// HTTP Server
const server = createServer(app);

// Socket.IO Server
const io = new Server(server, {
    cors: config.cors,
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

// Redis Clients
let redisSubscriber;
let redisPublisher;

// Active connections tracking
const activeConnections = new Map();

// Initialize Redis connections
async function initializeRedis() {
    try {
        logger.info('🔄 Initializing Redis with URL:', config.redis.url);
        
        redisSubscriber = createClient({ url: config.redis.url });
        redisPublisher = createClient({ url: config.redis.url });

        redisSubscriber.on('error', (err) => {
            logger.error('❌ Redis Subscriber Error:', err);
        });

        redisPublisher.on('error', (err) => {
            logger.error('❌ Redis Publisher Error:', err);
        });

        await redisSubscriber.connect();
        await redisPublisher.connect();

        logger.info('✅ Redis connections established');
        await setupRedisListeners();

    } catch (error) {
        logger.error('🔥 Failed to initialize Redis:', error);
        logger.warn('⚠️ Continuing without Redis connection...');
    }
}

// Setup Redis message listeners
async function setupRedisListeners() {
    try {
        logger.info('🔄 Setting up Redis pattern subscription...');
        
        // Subscribe to specific pattern
        await redisSubscriber.pSubscribe('antrian.*', (message, channel) => {
            logger.info('📨 === REDIS MESSAGE RECEIVED ===');
            logger.info('📡 Channel:', channel);
            logger.info('📄 Raw message:', message);
            
            try {
                const data = JSON.parse(message);
                logger.info('📋 Parsed data:', data);

                if (!data.event || !data.data) {
                    logger.warn('⚠️ Invalid message format:', data);
                    return;
                }

                const groupId = extractGroupIdFromChannel(channel);
                if (!groupId) {
                    logger.warn('⚠️ Could not extract group ID from channel:', channel);
                    return;
                }

                logger.info('📢 Broadcasting to group', groupId);
                broadcastToClients(channel, data.event, data.data, groupId);

            } catch (error) {
                logger.error('❌ Error processing message:', error);
            }
        });

        logger.info('✅ Subscribed to Redis pattern: antrian.*');
        
    } catch (error) {
        logger.error('🔥 Failed to setup Redis listeners:', error);
        throw error;
    }
}

function extractGroupIdFromChannel(channel) {
    const match = channel.match(/antrian\.group\.(\d+)/);
    return match ? match[1] : null;
}

function broadcastToClients(channel, event, data, groupId) {
    const roomName = `group_${groupId}`;
    const clientCount = io.sockets.adapter.rooms.get(roomName)?.size || 0;

    logger.info(`🏠 Room: ${roomName} (${clientCount} clients)`);

    if (clientCount === 0) {
        logger.warn(`⚠️ No clients in room ${roomName}`);
        return;
    }

    logger.info(`📡 Emitting "${event}" to room "${roomName}"`);
    io.to(roomName).emit(event, data);

    logger.info(`✅ Broadcasted ${event} to ${clientCount} clients`, {
        channel, event, groupId, clientCount, roomName
    });
}

// Socket.IO Connection Handler
io.on('connection', (socket) => {
    logger.info(`✅ Client connected: ${socket.id} from ${socket.handshake.address}`);

    activeConnections.set(socket.id, {
        id: socket.id,
        connectedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        ipAddress: socket.handshake.address
    });

    // Universal event listener - mendengarkan SEMUA event yang dikirim client
    socket.onAny((eventName, ...args) => {
        logger.info(`📡 Universal event received: ${eventName}`, args);
        
        // Update last activity
        const connection = activeConnections.get(socket.id);
        if (connection) {
            connection.lastActivity = new Date().toISOString();
        }

        // Broadcast ke semua client dengan event yang sama
        socket.broadcast.emit(eventName, ...args);
        
        logger.info(`📢 Universal broadcast: ${eventName} to all clients`);
    });

    // Handler untuk join group (dari index.js)
    socket.on('join-group', (data) => {
        try {
            const { groupId, groupName } = data;

            if (!groupId) {
                socket.emit('error', { message: 'Group ID is required' });
                return;
            }

            const roomName = `group_${groupId}`;

            // Leave previous rooms
            socket.rooms.forEach(room => {
                if (room !== socket.id && room.startsWith('group_')) {
                    socket.leave(room);
                    logger.info(`🚪 Client ${socket.id} left room ${room}`);
                }
            });

            socket.join(roomName);

            socket.emit('joined-group', {
                groupId, groupName, roomName,
                timestamp: new Date().toISOString()
            });

            logger.info(`🏠 Client ${socket.id} joined group ${groupId} (${groupName})`);

        } catch (error) {
            logger.error('❌ Error handling join-group:', error);
            socket.emit('error', { message: 'Failed to join group' });
        }
    });

    // Handler untuk leave group
    socket.on('leave-group', (data) => {
        try {
            const { groupId } = data;
            const roomName = `group_${groupId}`;
            
            socket.leave(roomName);
            socket.emit('left-group', {
                groupId, roomName,
                timestamp: new Date().toISOString()
            });

            logger.info(`🚪 Client ${socket.id} left group ${groupId}`);

        } catch (error) {
            logger.error('❌ Error handling leave-group:', error);
            socket.emit('error', { message: 'Failed to leave group' });
        }
    });

    // Handler untuk disconnect
    socket.on('disconnect', (reason) => {
        logger.info(`❌ Client disconnected: ${socket.id}`, { reason });
        activeConnections.delete(socket.id);
    });

    // Handler untuk ping/pong (keep alive)
    socket.on('ping', () => {
        socket.emit('pong', { timestamp: new Date().toISOString() });
    });
});

// Health endpoint
app.get('/health', (req, res) => {
    const connections = Array.from(activeConnections.values());
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        server: {
            port: config.port,
            uptime: process.uptime()
        },
        connections: {
            total: connections.length,
            active: connections.length,
            details: connections
        },
        redis: {
            subscriber: redisSubscriber?.isReady || false,
            publisher: redisPublisher?.isReady || false
        },
        rooms: Array.from(io.sockets.adapter.rooms.keys()).filter(room => room.startsWith('group_'))
    });
});

// Status endpoint
app.get('/status', (req, res) => {
    res.json({
        status: 'running',
        version: '1.0.0',
        features: [
            'Universal Event Broadcasting',
            'Redis Integration',
            'Group Management', 
            'Health Monitoring',
            'Connection Tracking'
        ]
    });
});

// API endpoint untuk broadcast manual
app.post('/broadcast', (req, res) => {
    try {
        const { event, data, room } = req.body;
        
        if (!event || !data) {
            return res.status(400).json({ error: 'Event and data are required' });
        }

        if (room) {
            io.to(room).emit(event, data);
            logger.info(`📡 Manual broadcast to room ${room}: ${event}`);
        } else {
            io.emit(event, data);
            logger.info(`📢 Manual broadcast to all: ${event}`);
        }

        res.json({ 
            success: true, 
            message: `Event ${event} broadcasted successfully`,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('❌ Error in manual broadcast:', error);
        res.status(500).json({ error: 'Failed to broadcast message' });
    }
});

// Start server
async function startServer() {
    try {
        // Create logs directory if it doesn't exist
        if (!fs.existsSync('logs')) {
            fs.mkdirSync('logs');
            logger.info('📁 Created logs directory');
        }

        // Initialize Redis (optional)
        await initializeRedis();

        // Start HTTP server
        server.listen(config.port, () => {
            logger.info(`🔥 Universal WebSocket server running on port ${config.port}`);
            logger.info(`🏥 Health check: http://localhost:${config.port}/health`);
            logger.info(`📊 Status check: http://localhost:${config.port}/status`);
            logger.info(`📡 Manual broadcast: POST http://localhost:${config.port}/broadcast`);
        });

    } catch (error) {
        logger.error('🔥 Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('🛑 SIGTERM received, shutting down gracefully');
    
    if (redisSubscriber) await redisSubscriber.quit();
    if (redisPublisher) await redisPublisher.quit();
    
    server.close(() => {
        logger.info('✅ Server shut down successfully');
        process.exit(0);
    });
});

process.on('SIGINT', async () => {
    logger.info('🛑 SIGINT received, shutting down gracefully');
    
    if (redisSubscriber) await redisSubscriber.quit();
    if (redisPublisher) await redisPublisher.quit();
    
    server.close(() => {
        logger.info('✅ Server shut down successfully');
        process.exit(0);
    });
});

// Start the server
startServer();
