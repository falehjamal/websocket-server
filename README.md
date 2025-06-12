# WebSocket Server

Server WebSocket menggunakan Socket.io yang terintegrasi dengan Redis untuk real-time communication.

## 📋 Deskripsi

WebSocket server ini dibuat untuk menangani komunikasi real-time antara client dan server Laravel melalui Redis broadcasting. Server akan menerima pesan broadcast dari Laravel via Redis dan meneruskannya ke semua client yang terhubung.

## 🚀 Fitur

- ✅ Real-time WebSocket communication menggunakan Socket.io
- ✅ Integrasi dengan Redis untuk broadcasting
- ✅ CORS support untuk cross-origin requests
- ✅ Ping/pong untuk connection health check
- ✅ Endpoint status server
- ✅ Auto-subscribe ke semua channel Redis

## 🛠️ Teknologi

- **Node.js** - Runtime environment
- **Express.js** - HTTP server framework
- **Socket.io** - WebSocket library
- **Redis** - Message broker untuk broadcasting
- **ioredis** - Redis client untuk Node.js

## 📦 Instalasi

1. Clone repository ini:
```bash
git clone <repository-url>
cd websocket-server
```

2. Install dependencies:
```bash
npm install
```

3. Pastikan Redis server sudah berjalan di localhost:6379

4. Jalankan server:
```bash
node server.js
```

## ⚙️ Konfigurasi

Server berjalan dengan konfigurasi default:

- **Port**: 6001
- **Redis**: localhost:6379
- **CORS**: Mengizinkan semua origin (`*`)
- **Ping Interval**: 25 detik
- **Ping Timeout**: 60 detik

Untuk mengubah konfigurasi, edit file `server.js`.

## 🔗 Endpoints

### GET /
Endpoint untuk mengecek status server.

**Response:**
```json
{
    "message": "Selamat datang di WebSocket Server",
    "status": "running",
    "port": 6001,
    "version": "1.0.0"
}
```

## 🌐 WebSocket Events

Server akan menerima broadcast dari Laravel dan meneruskan ke client dengan format:
`{channel}:{event}`

Contoh:
- Channel: `notifications`
- Event: `new-message`
- Client akan menerima event: `notifications:new-message`

## 📝 Penggunaan Client

### JavaScript Client
```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:6001');

// Listen untuk event tertentu
socket.on('notifications:new-message', (data) => {
    console.log('Pesan baru:', data);
});

// Connection events
socket.on('connect', () => {
    console.log('Terhubung ke server');
});

socket.on('disconnect', () => {
    console.log('Terputus dari server');
});
```

### Laravel Broadcasting Setup

Di Laravel, konfigurasi broadcasting untuk Redis:

```php
// config/broadcasting.php
'redis' => [
    'driver' => 'redis',
    'connection' => 'default',
],

// .env
BROADCAST_DRIVER=redis
```

Contoh event Laravel:
```php
class NewMessage implements ShouldBroadcast
{
    public function broadcastOn()
    {
        return new Channel('notifications');
    }
    
    public function broadcastAs()
    {
        return 'new-message';
    }
}
```

## 🐛 Debugging

Server akan menampilkan log untuk:
- Client connection/disconnection
- Redis subscription status
- Broadcast messages dari Laravel

## 📁 Struktur Project

```
websocket-server/
├── server.js          # Main server file
├── package.json       # Dependencies
├── package-lock.json  # Lock file
├── .gitignore         # Git ignore rules
└── README.md          # Dokumentasi
```

## 🤝 Kontribusi

1. Fork repository
2. Buat feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push branch (`git push origin feature/AmazingFeature`)
5. Buat Pull Request

## 📄 License

Project ini menggunakan ISC License.

## 📞 Support

Jika ada pertanyaan atau masalah, silakan buat issue di repository ini. 
