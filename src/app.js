const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');

const config = require('./config');
const logger = require('./services/logger');
const RedisService = require('./services/redis');
const BroadcastService = require('./services/broadcast');
const ConnectionManager = require('./services/connectionManager');
const SocketHandlers = require('./handlers/socketHandlers');
const createApiRoutes = require('./handlers/apiRoutes');

class WebSocketServer {
    constructor() {
        this.config = config;
        this.app = express();
        this.server = createServer(this.app);
        this.io = new Server(this.server, {
            cors: config.cors,
            transports: ['websocket', 'polling'],
            allowEIO3: true
        });

        // Initialize services
        this.connectionManager = new ConnectionManager(this.io);
        this.broadcastService = new BroadcastService(this.io);
        this.redisService = new RedisService(config, this.io, this.broadcastService);
        this.socketHandlers = new SocketHandlers(this.io, this.connectionManager);

        this.setupMiddleware();
        this.setupRoutes();
        this.setupSocketHandlers();
    }

    setupMiddleware() {
        this.app.use(cors(this.config.cors));
        this.app.use(express.json());
    }

    setupRoutes() {
        const apiRoutes = createApiRoutes(this.connectionManager);
        this.app.use('/', apiRoutes);
    }

    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            this.socketHandlers.handleConnection(socket);
        });
    }

    async start() {
        try {
            // Create logs directory if it doesn't exist
            if (!fs.existsSync('logs')) {
                fs.mkdirSync('logs');
                logger.info('📁 Created logs directory');
            }

            // Initialize Redis
            await this.redisService.initialize();

            // Start server
            this.server.listen(this.config.port, '0.0.0.0', () => {
                logger.info(`🔥 Universal WebSocket server running on port ${this.config.port}`);
                logger.info(`🖥️ Active displays: GET http://localhost:${this.config.port}/displays/active`);
            });

        } catch (error) {
            logger.error('🔥 Failed to start server:', error);
            process.exit(1);
        }
    }

    async shutdown() {
        logger.info('🛑 Shutting down gracefully');

        await this.redisService.shutdown();

        this.server.close(() => {
            logger.info('✅ Server shut down successfully');
            process.exit(0);
        });
    }
}

module.exports = WebSocketServer;
