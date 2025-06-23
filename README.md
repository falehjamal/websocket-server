# Universal WebSocket Server

Server WebSocket yang menggabungkan fungsi dari index.js dan server.js menjadi satu aplikasi yang lengkap dengan fitur:

## 🚀 Fitur Utama

- **Universal Event Broadcasting**: Mendengarkan dan mem-broadcast semua event yang dikirim client
- **Redis Integration**: Integrasi dengan Redis untuk pub/sub messaging  
- **Group Management**: Sistem room/group untuk targeted messaging
- **Health Monitoring**: Endpoint health check dan status monitoring
- **Connection Tracking**: Tracking koneksi aktif dan detail client
- **Manual Broadcasting**: API endpoint untuk broadcast manual
- **Graceful Shutdown**: Shutdown yang aman dengan cleanup Redis connection

## 📁 Struktur Server

Server ini menggabungkan fungsi dari:
- `index.js` → Redis integration, group management, logging
- `server.js` → Universal event broadcasting, basic WebSocket functionality

## 🛠️ Installation & Setup

```bash
# Install dependencies
npm install

# Start server
npm start
# atau
node server.js
```

## 📡 API Endpoints

- `GET /health` - Health check dengan detail koneksi dan Redis status
- `GET /status` - Status server dan daftar fitur
- `POST /broadcast` - Manual broadcast message

### Manual Broadcast Example:
```bash
curl -X POST http://localhost:6001/broadcast \
  -H "Content-Type: application/json" \
  -d '{
    "event": "notification",
    "data": {"message": "Hello World"},
    "room": "group_1"
  }'
```

## 🏠 Room/Group Management

Client dapat join/leave group:
```javascript
// Join group
socket.emit('join-group', { groupId: 1, groupName: 'Antrian Poli' });

// Leave group  
socket.emit('leave-group', { groupId: 1 });
```

## 📨 Universal Event Broadcasting

Server mendengarkan SEMUA event yang dikirim client dan mem-broadcast ke client lain:
```javascript
// Client mengirim event apapun
socket.emit('custom-event', { data: 'anything' });

// Server otomatis broadcast ke semua client lain
```

## 🔴 Redis Integration

Server subscribe ke pattern `antrian.*` dan mem-broadcast pesan ke room terkait:
- Channel format: `antrian.group.{groupId}`
- Message format: `{"event": "event_name", "data": {...}}`

## 🚨 Error Handling

- Redis connection error → Server tetap jalan tanpa Redis
- Invalid message format → Log warning, skip message
- Group ID tidak ditemukan → Log warning, skip broadcast

## 📝 Logging

Menggunakan Winston dengan:
- Console output untuk development
- File logging (`logs/combined.log`, `logs/error.log`)
- Structured JSON format dengan timestamp

## 🌐 WebSocket Events

### Client → Server Events:
- `join-group` - Join room/group tertentu
- `leave-group` - Leave room/group
- `ping` - Keep alive check
- `*` - Semua event lain akan di-broadcast universal

### Server → Client Events:
- `joined-group` - Konfirmasi join group
- `left-group` - Konfirmasi leave group  
- `pong` - Response ping
- `error` - Error message
- `*` - Event dari Redis atau client lain

## 🔧 Configuration

```javascript
const config = {
    port: process.env.SOCKETIO_PORT || 6001,
    redis: {
        url: 'redis://127.0.0.1:6379/0'
    },
    cors: {
        origin: ["http://localhost", "http://127.0.0.1", "http://127.0.0.1:8000", "http://localhost:8000", "http://simrs.test", "*"],
        methods: ["GET", "POST"],
        credentials: true
    }
};
```

## 📋 Dependencies

```json
{
  "cors": "^2.8.5",
  "express": "^5.1.0", 
  "redis": "^5.5.6",
  "socket.io": "^4.8.1",
  "winston": "^3.17.0"
}
```

## 🧪 Testing

```bash
# Test health endpoint
curl http://localhost:6001/health

# Test status endpoint  
curl http://localhost:6001/status

# Test manual broadcast
curl -X POST http://localhost:6001/broadcast \
  -H "Content-Type: application/json" \
  -d '{"event": "test", "data": {"msg": "hello"}}'
```

## 🔄 Migration dari Server Terpisah

Server ini menggabungkan:
1. **index.js** - Redis integration, group management, structured logging
2. **server.js** - Universal broadcasting, basic WebSocket

Semua fungsi dari kedua file sudah terintegrasi dalam satu `server.js` yang baru.

## 📞 Support

Jika ada pertanyaan atau masalah, silakan buat issue di repository ini. 
