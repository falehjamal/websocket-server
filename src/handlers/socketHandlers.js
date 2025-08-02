const logger = require('../services/logger');
const { createTimestamp, getRoomClientCount } = require('../utils/helpers');

class SocketHandlers {
    constructor(io, connectionManager) {
        this.io = io;
        this.connectionManager = connectionManager;
    }

    handleJoinGroup(socket, data) {
        try {
            const { groupId, groupName } = data;

            if (!groupId) {
                socket.emit('error', { message: 'Group ID is required' });
                return;
            }

            const roomName = `group_${groupId}`;

            // Store the permalink (groupName) for this group
            if (groupName) {
                this.connectionManager.setGroupPermalink(groupId, groupName);
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
    }

    handleLeaveGroup(socket, data) {
        try {
            const { groupId } = data;
            const roomName = `group_${groupId}`;

            socket.leave(roomName);
            
            // Check if no more clients in this group, then remove permalink
            const remainingClients = getRoomClientCount(this.io, roomName);
            if (remainingClients === 0) {
                this.connectionManager.removeGroupPermalink(groupId);
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
    }

    handleJoinPrescription(socket) {
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
    }

    handleLeavePrescription(socket) {
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
    }

    handleConnection(socket) {
        logger.info(`✅ Client connected: ${socket.id} from ${socket.handshake.address}`);

        this.connectionManager.addConnection(socket.id, socket.handshake.address);

        // Event handlers
        socket.on('join-group', (data) => this.handleJoinGroup(socket, data));
        socket.on('leave-group', (data) => this.handleLeaveGroup(socket, data));
        socket.on('join-prescription', () => this.handleJoinPrescription(socket));
        socket.on('leave-prescription', () => this.handleLeavePrescription(socket));
        
        socket.on('disconnect', (reason) => {
            logger.info(`❌ Client disconnected: ${socket.id}`, { reason });
            
            // Clean up permalinks for empty groups
            this.connectionManager.cleanupEmptyGroups();
            this.connectionManager.removeConnection(socket.id);
        });

        socket.on('ping', () => {
            socket.emit('pong', { timestamp: createTimestamp() });
        });
    }
}

module.exports = SocketHandlers;
