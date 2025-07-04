const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const cors = require('cors');
const winston = require('winston');
const fs = require('fs');

// Configuration
const config = {
    port: process.env.SOCKETIO_PORT || 6001,
    redis: { url: process.env.REDIS_URL || 'redis://127.0.0.1:6379/0' },
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        credentials: false
    }
};

// Logger setup
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
        new winston.transports.Console({ format: winston.format.simple() })
    ]
});

// App setup
const app = express();
app.use(cors(config.cors));
app.use(express.json());

const server = createServer(app);
const io = new Server(server, {
    cors: config.cors,
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

// Redis clients
let redisSubscriber, redisPublisher;
const activeConnections = new Map();

// Utility functions
const extractGroupIdFromChannel = (channel) => {
    const match = channel.match(/antrian\.group\.(\d+)/);
    return match ? match[1] : null;
};

const updateClientActivity = (socketId) => {
    const connection = activeConnections.get(socketId);
    if (connection) {
        connection.lastActivity = new Date().toISOString();
    }
};

const getRoomClientCount = (roomName) => {
    return io.sockets.adapter.rooms.get(roomName)?.size || 0;
};

const createTimestamp = () => new Date().toISOString();

// Redis functions
const initializeRedis = async () => {
    try {
        logger.info('🔄 Initializing Redis with URL:', config.redis.url);

        redisSubscriber = createClient({ url: config.redis.url });
        redisPublisher = createClient({ url: config.redis.url });

        const handleRedisError = (clientType) => (err) => {
            logger.error(`❌ Redis ${clientType} Error:`, err);
        };

        redisSubscriber.on('error', handleRedisError('Subscriber'));
        redisPublisher.on('error', handleRedisError('Publisher'));

        await Promise.all([
            redisSubscriber.connect(),
            redisPublisher.connect()
        ]);

        logger.info('✅ Redis connections established');
        await setupRedisListeners();

    } catch (error) {
        logger.error('🔥 Failed to initialize Redis:', error);
        logger.warn('⚠️ Continuing without Redis connection...');
    }
};

const processRedisMessage = (message, channel, isAntrian = false) => {
    logger.info(`📨 === REDIS MESSAGE RECEIVED (${isAntrian ? 'ANTRIAN' : 'ALL'}) ===`);
    logger.info('📡 Channel:', channel);
    logger.info('📄 Raw message:', message);

    try {
        const data = JSON.parse(message);
        logger.info('📋 Parsed data:', data);

        if (!data.event || !data.data) {
            logger.warn('⚠️ Invalid message format:', data);
            return;
        }

        if (isAntrian) {
            const groupId = extractGroupIdFromChannel(channel);
            if (!groupId) {
                logger.warn('⚠️ Could not extract group ID from channel:', channel);
                return;
            }
            logger.info('📢 Broadcasting to group', groupId);
            broadcastToClients(channel, data.event, data.data, groupId);
        } else {
            handleGeneralMessage(channel, data);
        }

    } catch (error) {
        logger.error('❌ Error processing message:', error);
    }
};

const handleGeneralMessage = (channel, data) => {
    const { event } = data;

    if (event.startsWith('prescription.')) {
        logger.info('💊 Prescription event detected:', event);
        broadcastToPrescriptionRoom(channel, event, data.data);
    } else if (!channel.startsWith('antrian.')) {
        logger.info('📢 Broadcasting general event to all clients:', event);
        io.emit(`${channel}:${event}`, data.data);
    }
};

const setupRedisListeners = async () => {
    try {
        logger.info('🔄 Setting up Redis pattern subscription...');

        // Subscribe to antrian pattern
        await redisSubscriber.pSubscribe('antrian.*', (message, channel) => {
            processRedisMessage(message, channel, true);
        });

        // Subscribe to all channels for prescription events
        await redisSubscriber.pSubscribe('*', (message, channel) => {
            processRedisMessage(message, channel, false);
        });

        logger.info('✅ Subscribed to Redis patterns: antrian.* and *');

    } catch (error) {
        logger.error('🔥 Failed to setup Redis listeners:', error);
        throw error;
    }
};

// Broadcasting functions
const broadcastToClients = (channel, event, data, groupId) => {
    const roomName = `group_${groupId}`;
    const clientCount = getRoomClientCount(roomName);

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
};

const broadcastToPrescriptionRoom = (channel, event, data) => {
    const roomName = 'prescription';
    const clientCount = getRoomClientCount(roomName);

    logger.info(`💊 Prescription Room: ${roomName} (${clientCount} clients)`);

    if (clientCount === 0) {
        logger.warn(`⚠️ No clients in prescription room`);
        return;
    }

    logger.info(`📡 Emitting prescription "${event}" to room "${roomName}"`);
    io.to(roomName).emit(`${channel}:${event}`, data);

    logger.info(`✅ Broadcasted prescription ${event} to ${clientCount} clients`, {
        channel, event, clientCount, roomName
    });
};

// Socket handlers
const handleJoinGroup = (socket, data) => {
    try {
        const { groupId, groupName } = data;

        if (!groupId) {
            socket.emit('error', { message: 'Group ID is required' });
            return;
        }

        const roomName = `group_${groupId}`;

        // Leave previous group rooms
        socket.rooms.forEach(room => {
            if (room !== socket.id && room.startsWith('group_')) {
                socket.leave(room);
                logger.info(`🚪 Client ${socket.id} left room ${room}`);
            }
        });

        socket.join(roomName);
        socket.emit('joined-group', {
            groupId, groupName, roomName,
            timestamp: createTimestamp()
        });

        logger.info(`🏠 Client ${socket.id} joined group ${groupId} (${groupName})`);

    } catch (error) {
        logger.error('❌ Error handling join-group:', error);
        socket.emit('error', { message: 'Failed to join group' });
    }
};

const handleLeaveGroup = (socket, data) => {
    try {
        const { groupId } = data;
        const roomName = `group_${groupId}`;

        socket.leave(roomName);
        socket.emit('left-group', {
            groupId, roomName,
            timestamp: createTimestamp()
        });

        logger.info(`🚪 Client ${socket.id} left group ${groupId}`);

    } catch (error) {
        logger.error('❌ Error handling leave-group:', error);
        socket.emit('error', { message: 'Failed to leave group' });
    }
};

const handleJoinPrescription = (socket) => {
    try {
        const roomName = 'prescription';
        
        socket.join(roomName);
        socket.emit('prescription-joined', { 
            message: 'Successfully joined prescription room',
            socketId: socket.id,
            roomName,
            timestamp: createTimestamp()
        });

        logger.info(`💊 Client ${socket.id} joined prescription room`);

    } catch (error) {
        logger.error('❌ Error handling join-prescription:', error);
        socket.emit('error', { message: 'Failed to join prescription room' });
    }
};

const handleLeavePrescription = (socket) => {
    try {
        const roomName = 'prescription';
        
        socket.leave(roomName);
        socket.emit('prescription-left', { 
            message: 'Successfully left prescription room',
            socketId: socket.id,
            roomName,
            timestamp: createTimestamp()
        });

        logger.info(`💊 Client ${socket.id} left prescription room`);

    } catch (error) {
        logger.error('❌ Error handling leave-prescription:', error);
        socket.emit('error', { message: 'Failed to leave prescription room' });
    }
};

// Socket.IO Connection Handler
io.on('connection', (socket) => {
    logger.info(`✅ Client connected: ${socket.id} from ${socket.handshake.address}`);

    activeConnections.set(socket.id, {
        id: socket.id,
        connectedAt: createTimestamp(),
        lastActivity: createTimestamp(),
        ipAddress: socket.handshake.address
    });

    // Universal event listener
    socket.onAny((eventName, ...args) => {
        logger.info(`📡 Universal event received: ${eventName}`, args);
        updateClientActivity(socket.id);
        socket.broadcast.emit(eventName, ...args);
        logger.info(`📢 Universal broadcast: ${eventName} to all clients`);
    });

    // Event handlers
    socket.on('join-group', (data) => handleJoinGroup(socket, data));
    socket.on('leave-group', (data) => handleLeaveGroup(socket, data));
    socket.on('join-prescription', () => handleJoinPrescription(socket));
    socket.on('leave-prescription', () => handleLeavePrescription(socket));
    
    socket.on('disconnect', (reason) => {
        logger.info(`❌ Client disconnected: ${socket.id}`, { reason });
        activeConnections.delete(socket.id);
    });

    socket.on('ping', () => {
        socket.emit('pong', { timestamp: createTimestamp() });
    });
});

// API Routes
app.get('/health', (req, res) => {
    const connections = Array.from(activeConnections.values());
    const allRooms = Array.from(io.sockets.adapter.rooms.keys());
    const groupRooms = allRooms.filter(room => room.startsWith('group_'));
    const prescriptionRoom = allRooms.find(room => room === 'prescription');
    const prescriptionClients = prescriptionRoom ? getRoomClientCount('prescription') : 0;

    res.json({
        status: 'ok',
        timestamp: createTimestamp(),
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
        rooms: {
            groups: groupRooms,
            prescription: {
                exists: !!prescriptionRoom,
                clients: prescriptionClients
            },
            total: allRooms.length
        }
    });
});

app.get('/status', (req, res) => {
    res.json({
        status: 'running',
        version: '1.0.0',
        features: [
            'Universal Event Broadcasting',
            'Redis Integration',
            'Group Management',
            'Prescription Room Management',
            'Health Monitoring',
            'Connection Tracking'
        ]
    });
});

app.post('/broadcast', (req, res) => {
    try {
        const { event, data, room } = req.body;

        if (!event || !data) {
            return res.status(400).json({ error: 'Event and data are required' });
        }

        if (room) {
            io.to(room).emit(event, data);
            logger.info(`📡 Manual broadcast to room ${room}: ${event}`);
            if (room === 'prescription') {
                logger.info(`💊 Manual broadcast to prescription room: ${event}`);
            }
        } else {
            io.emit(event, data);
            logger.info(`📢 Manual broadcast to all: ${event}`);
        }

        res.json({
            success: true,
            message: `Event ${event} broadcasted successfully`,
            target: room || 'all clients',
            timestamp: createTimestamp()
        });

    } catch (error) {
        logger.error('❌ Error in manual broadcast:', error);
        res.status(500).json({ error: 'Failed to broadcast message' });
    }
});

// Server startup and shutdown
const startServer = async () => {
    try {
        if (!fs.existsSync('logs')) {
            fs.mkdirSync('logs');
            logger.info('📁 Created logs directory');
        }

        await initializeRedis();

        server.listen(config.port, '0.0.0.0', () => {
            logger.info(`🔥 Universal WebSocket server running on port ${config.port}`);
            logger.info(`🏥 Health check: http://localhost:${config.port}/health`);
            logger.info(`📊 Status check: http://localhost:${config.port}/status`);
            logger.info(`📡 Manual broadcast: POST http://localhost:${config.port}/broadcast`);
        });

    } catch (error) {
        logger.error('🔥 Failed to start server:', error);
        process.exit(1);
    }
};

const gracefulShutdown = async () => {
    logger.info('🛑 Shutting down gracefully');

    if (redisSubscriber) await redisSubscriber.quit();
    if (redisPublisher) await redisPublisher.quit();

    server.close(() => {
        logger.info('✅ Server shut down successfully');
        process.exit(0);
    });
};

// Graceful shutdown handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start the server
startServer();
