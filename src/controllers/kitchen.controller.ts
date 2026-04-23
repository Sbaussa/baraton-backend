import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middlewares/auth.middleware';
import { io } from '../server';

const prisma = new PrismaClient();

const orderInclude = {
  items: { include: { product: { include: { category: true } } } },
  user: { select: { id: true, name: true } },
  delivery: true,
};

// GET /api/kitchen/orders — solo pedidos activos, domicilios primero
export const getKitchenOrders = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const orders = await prisma.order.findMany({
      where: { status: { in: ['PENDING', 'PREPARING'] } },
      include: orderInclude,
    });

    const sorted = [
      ...orders.filter((o) => o.orderType === 'DOMICILIO'),
      ...orders.filter((o) => o.orderType === 'LLEVAR'),
      ...orders.filter((o) => o.orderType === 'MESA'),
    ];

    res.json(sorted);
  } catch {
    res.status(500).json({ error: 'Error' });
  }
};

// PATCH /api/kitchen/:id/preparing
export const startPreparing = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.update({
      where: { id: Number(req.params.id) },
      data: { status: 'PREPARING' },
      include: orderInclude,
    });
    io.emit('order-status-changed', { orderId: order.id, status: 'PREPARING', order });
    res.json(order);
  } catch {
    res.status(500).json({ error: 'Error' });
  }
};

// PATCH /api/kitchen/:id/ready
export const markReady = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.update({
      where: { id: Number(req.params.id) },
      data: { status: 'READY' },
      include: orderInclude,
    });
    io.emit('order-status-changed', { orderId: order.id, status: 'READY', order });
    // Notificar a domiciliario si aplica
    if (order.orderType === 'DOMICILIO') {
      io.to('delivery').emit('delivery-ready', order);
    }
    res.json(order);
  } catch {
    res.status(500).json({ error: 'Error' });
  }
};
