const { createClient } = require('redis');
const logger = require('./logger');
const { extractGroupIdFromChannel } = require('../utils/helpers');

class RedisService {
    constructor(config, io, broadcastService) {
        this.config = config;
        this.io = io;
        this.broadcastService = broadcastService;
        this.redisSubscriber = null;
        this.redisPublisher = null;
    }

    async initialize() {
        try {
            logger.info('🔄 Initializing Redis with URL:', this.config.redis.url);

            this.redisSubscriber = createClient({ url: this.config.redis.url });
            this.redisPublisher = createClient({ url: this.config.redis.url });

            const handleRedisError = (clientType) => (err) => {
                logger.error(`❌ Redis ${clientType} Error:`, err);
            };

            this.redisSubscriber.on('error', handleRedisError('Subscriber'));
            this.redisPublisher.on('error', handleRedisError('Publisher'));

            await Promise.all([
                this.redisSubscriber.connect(),
                this.redisPublisher.connect()
            ]);

            logger.info('✅ Redis connections established');
            await this.setupListeners();

        } catch (error) {
            logger.error('🔥 Failed to initialize Redis:', error);
            logger.warn('⚠️ Continuing without Redis connection...');
        }
    }

    processMessage(message, channel, isAntrian = false) {
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
                this.broadcastService.broadcastToClients(channel, data.event, data.data, groupId);
            } else {
                this.handleGeneralMessage(channel, data);
            }

        } catch (error) {
            logger.error('❌ Error processing message:', error);
        }
    }

    handleGeneralMessage(channel, data) {
        const { event } = data;

        if (event.startsWith('prescription.')) {
            logger.info('💊 Prescription event detected:', event);
            this.broadcastService.broadcastToPrescriptionRoom(channel, event, data.data);
        } else if (!channel.startsWith('antrian.')) {
            logger.info('📢 Broadcasting general event to all clients:', event);
            this.io.emit(`${channel}:${event}`, data.data);
        }
    }

    async setupListeners() {
        try {
            logger.info('🔄 Setting up Redis pattern subscription...');

            // Subscribe to antrian pattern
            await this.redisSubscriber.pSubscribe('antrian.*', (message, channel) => {
                this.processMessage(message, channel, true);
            });

            // Subscribe to all channels for prescription events
            await this.redisSubscriber.pSubscribe('*', (message, channel) => {
                this.processMessage(message, channel, false);
            });

            logger.info('✅ Subscribed to Redis patterns: antrian.* and *');

        } catch (error) {
            logger.error('🔥 Failed to setup Redis listeners:', error);
            throw error;
        }
    }

    async shutdown() {
        if (this.redisSubscriber) await this.redisSubscriber.quit();
        if (this.redisPublisher) await this.redisPublisher.quit();
    }
}

module.exports = RedisService;
