const express = require('express');
const logger = require('../services/logger');
const { createTimestamp } = require('../utils/helpers');

const createApiRoutes = (connectionManager) => {
    const router = express.Router();

    router.get('/displays/active', (req, res) => {
        try {
            const activeDisplays = connectionManager.getActiveDisplays();

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

    return router;
};

module.exports = createApiRoutes;
