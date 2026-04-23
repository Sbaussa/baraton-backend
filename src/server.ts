import dotenv from 'dotenv';
dotenv.config();

import { createServer } from 'http';
import { Server } from 'socket.io';
import app from './app';

const PORT = process.env.PORT || 4000;
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Exportar io para usarlo en controllers
export { io };

io.on('connection', (socket) => {
  console.log(`🔌 Cliente conectado: ${socket.id}`);

  socket.on('join-tracking', (token: string) => {
    socket.join(`tracking-${token}`);
    console.log(`📍 Cliente siguiendo pedido: ${token}`);
  });

  socket.on('join-kitchen', () => {
    socket.join('kitchen');
    console.log(`🍳 Cocina conectada: ${socket.id}`);
  });

  socket.on('join-delivery', () => {
    socket.join('delivery');
    console.log(`🛵 Domiciliario conectado: ${socket.id}`);
  });

  socket.on('join-cashier', () => {
    socket.join('cashier');
    console.log(`💰 Cajera conectada: ${socket.id}`);
  });

  socket.on('disconnect', () => {
    console.log(`❌ Cliente desconectado: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`🚀 El Baraton - Almuerzos corriendo en http://localhost:${PORT}`);
  console.log(`📡 Socket.io activo`);
});