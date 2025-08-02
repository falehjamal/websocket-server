// Export all services and utilities for easy access
const config = require('./config');
const logger = require('./services/logger');
const RedisService = require('./services/redis');
const BroadcastService = require('./services/broadcast');
const ConnectionManager = require('./services/connectionManager');
const SocketHandlers = require('./handlers/socketHandlers');
const createApiRoutes = require('./handlers/apiRoutes');
const helpers = require('./utils/helpers');
const WebSocketServer = require('./app');

module.exports = {
    config,
    logger,
    RedisService,
    BroadcastService,
    ConnectionManager,
    SocketHandlers,
    createApiRoutes,
    helpers,
    WebSocketServer
};
