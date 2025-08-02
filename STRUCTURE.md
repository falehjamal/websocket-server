# WebSocket Server - Modular Structure

## Struktur Folder

```
websocket-server/
├── server.js                    # Entry point utama
├── package.json
├── README.md
├── logs/
│   ├── combined.log
│   └── error.log
└── src/
    ├── app.js                   # Main application class
    ├── config/
    │   └── index.js             # Konfigurasi aplikasi
    ├── services/
    │   ├── logger.js            # Winston logger service
    │   ├── redis.js             # Redis service
    │   ├── broadcast.js         # Broadcasting service
    │   └── connectionManager.js # Connection management service
    ├── handlers/
    │   ├── socketHandlers.js    # Socket event handlers
    │   └── apiRoutes.js         # API route handlers
    └── utils/
        └── helpers.js           # Utility functions
```

## Penjelasan Setiap Service

### 1. **server.js** - Entry Point
- File utama yang menjalankan aplikasi
- Hanya menangani inisialisasi dan graceful shutdown
- Import dan menjalankan WebSocketServer class

### 2. **src/app.js** - Main Application
- Class utama yang menginisialisasi semua service
- Mengatur middleware, routes, dan socket handlers
- Mengelola lifecycle aplikasi (start/shutdown)

### 3. **src/config/index.js** - Configuration
- Konfigurasi aplikasi (port, Redis URL, CORS settings)
- Environment variables handling

### 4. **src/services/** - Business Logic Services

#### **logger.js** - Logging Service
- Winston logger configuration
- Log levels dan transport settings
- Centralized logging untuk seluruh aplikasi

#### **redis.js** - Redis Service
- Redis connection management
- Message processing dari Redis channels
- Pattern subscription handling
- Redis error handling

#### **broadcast.js** - Broadcasting Service
- Broadcasting ke group rooms
- Broadcasting ke prescription room
- Message emission logic

#### **connectionManager.js** - Connection Management
- Active connections tracking
- Group permalink management
- Room cleanup functions
- Active displays data management

### 5. **src/handlers/** - Request/Event Handlers

#### **socketHandlers.js** - Socket Event Handlers
- Socket connection handling
- Join/leave group events
- Join/leave prescription events
- Ping/pong handling

#### **apiRoutes.js** - API Route Handlers
- REST API endpoints
- Active displays endpoint
- Error handling untuk API calls

### 6. **src/utils/helpers.js** - Utility Functions
- Helper functions yang digunakan di berbagai service
- Group ID extraction
- Room client counting
- Timestamp creation

## Keuntungan Struktur Modular

1. **Separation of Concerns**: Setiap service memiliki tanggung jawab yang jelas
2. **Maintainability**: Mudah untuk maintain dan update kode
3. **Testability**: Setiap service dapat ditest secara terpisah
4. **Reusability**: Service dapat digunakan kembali di bagian lain
5. **Scalability**: Mudah untuk menambah feature baru
6. **Clean Code**: Kode lebih terorganisir dan mudah dibaca

## Cara Menjalankan

```bash
# Install dependencies
npm install

# Run server
npm start
# atau
node server.js
```

## Environment Variables

- `SOCKETIO_PORT`: Port untuk WebSocket server (default: 6001)
- `REDIS_URL`: URL Redis connection (default: redis://127.0.0.1:6379/0)

## API Endpoints

- `GET /displays/active`: Mendapatkan daftar display yang aktif

## Socket Events

### Client to Server:
- `join-group`: Join ke group tertentu
- `leave-group`: Leave dari group
- `join-prescription`: Join ke prescription room
- `leave-prescription`: Leave dari prescription room
- `ping`: Health check

### Server to Client:
- `joined-group`: Konfirmasi join group
- `left-group`: Konfirmasi leave group
- `prescription-joined`: Konfirmasi join prescription room
- `prescription-left`: Konfirmasi leave prescription room
- `pong`: Response dari ping
- `error`: Error messages
