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
const groupPermalinks = new Map(); // Store permalinks for each group

// Utility functions
const extractGroupIdFromChannel = (channel) => {
    const match = channel.match(/antrian\.group\.(\d+)/);
    return match ? match[1] : null;
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

        // Store the permalink (groupName) for this group
        if (groupName) {
            // Ensure groupId is always stored as string for consistency
            const groupIdStr = String(groupId);
            groupPermalinks.set(groupIdStr, groupName);
            logger.info(`💾 Stored permalink for group ${groupIdStr}: "${groupName}"`);
        } else {
            logger.warn(`⚠️ No groupName provided for group ${groupId}`);
        }

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
        
        // Check if no more clients in this group, then remove permalink
        const remainingClients = getRoomClientCount(roomName);
        if (remainingClients === 0) {
            const groupIdStr = String(groupId);
            groupPermalinks.delete(groupIdStr);
            logger.info(`🗑️ Removed permalink for group ${groupIdStr} (no more clients)`);
        }
        
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
        ipAddress: socket.handshake.address
    });

    // Event handlers
    socket.on('join-group', (data) => handleJoinGroup(socket, data));
    socket.on('leave-group', (data) => handleLeaveGroup(socket, data));
    socket.on('join-prescription', () => handleJoinPrescription(socket));
    socket.on('leave-prescription', () => handleLeavePrescription(socket));
    
    socket.on('disconnect', (reason) => {
        logger.info(`❌ Client disconnected: ${socket.id}`, { reason });
        
        // Clean up permalinks for empty groups
        const allRooms = Array.from(io.sockets.adapter.rooms.keys());
        const groupRooms = allRooms.filter(room => room.startsWith('group_'));
        
        groupRooms.forEach(roomName => {
            const groupId = roomName.replace('group_', '');
            const clientCount = getRoomClientCount(roomName);
            if (clientCount === 0) {
                const groupIdStr = String(groupId);
                groupPermalinks.delete(groupIdStr);
                logger.info(`🗑️ Cleaned up permalink for empty group ${groupIdStr}`);
            }
        });
        
        activeConnections.delete(socket.id);
    });

    socket.on('ping', () => {
        socket.emit('pong', { timestamp: createTimestamp() });
    });
});

// API Routes

app.get('/displays/active', (req, res) => {
    try {
        const allRooms = Array.from(io.sockets.adapter.rooms.keys());
        const groupRooms = allRooms.filter(room => room.startsWith('group_'));
        
        const activeDisplays = groupRooms.map(roomName => {
            const groupId = roomName.replace('group_', '');
            const clientCount = getRoomClientCount(roomName);
            const clients = Array.from(io.sockets.adapter.rooms.get(roomName) || []);
            
            // Get client details for this room
            const clientDetails = clients.map(socketId => {
                const connection = activeConnections.get(socketId);
                return {
                    socketId,
                    connectedAt: connection?.connectedAt,
                    ipAddress: connection?.ipAddress
                };
            }).filter(Boolean);

            // Get the actual permalink from stored data, fallback to default format
            const storedPermalink = groupPermalinks.get(groupId);
            const actualPermalink = storedPermalink || `/display/group/${groupId}`;

            return {
                groupNumber: parseInt(groupId),
                permalink: actualPermalink,
                roomName,
                clientCount,
                clients: clientDetails,
                isActive: clientCount > 0,
                lastUpdated: createTimestamp()
            };
        }).filter(display => display.isActive); // Only return active displays

        // Sort by group number
        activeDisplays.sort((a, b) => a.groupNumber - b.groupNumber);

        res.json({
            success: true,
            totalActiveDisplays: activeDisplays.length,
            displays: activeDisplays,
            timestamp: createTimestamp()
        });

    } catch (error) {
        logger.error('❌ Error getting active displays:', error);
        res.status(500).json({ 
            error: 'Failed to get active displays',
            message: error.message 
        });
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
            logger.info(`🖥️ Active displays: GET http://localhost:${config.port}/displays/active`);
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
