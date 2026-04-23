import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { io } from '../server';
import crypto from 'crypto';

const prisma = new PrismaClient();

const orderInclude = {
  items: { include: { product: { include: { category: true } } } },
  user: { select: { id: true, name: true } },
  delivery: true,
  deliveryUser: { select: { id: true, name: true } },
};

// GET /api/public/products
export const getPublicProducts = async (_req: Request, res: Response): Promise<void> => {
  try {
    const products = await prisma.product.findMany({
      where: { available: true },
      include: { category: true },
      orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
    });
    res.json(products);
  } catch { res.status(500).json({ error: 'Error' }); }
};

// POST /api/public/order — crear pedido online sin autenticación
export const createPublicOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { items, delivery, notes } = req.body;
    if (!items?.length) { res.status(400).json({ error: 'Agrega al menos un producto' }); return; }
    if (!delivery?.address) { res.status(400).json({ error: 'La dirección es requerida' }); return; }

    // Buscar usuario "sistema" para asignar el pedido
    let systemUser = await prisma.user.findFirst({ where: { email: 'admin@baraton.com' } });
    if (!systemUser) { res.status(500).json({ error: 'Sistema no configurado' }); return; }

    let total = 0;
    const enrichedItems = [];
    for (const item of items) {
      const product = await prisma.product.findUnique({ where: { id: item.productId } });
      if (!product?.available) continue;
      total += product.price * item.quantity;
      enrichedItems.push({ productId: item.productId, quantity: item.quantity, unitPrice: product.price, notes: item.notes || null });
    }

    const token = crypto.randomBytes(16).toString('hex');
    const now = new Date();
    const orderNumber = `ONL-${now.toISOString().slice(2,10).replace(/-/g,'')}-${Date.now().toString().slice(-5)}`;

    const order = await prisma.order.create({
      data: {
        orderNumber,
        orderType: 'ONLINE',
        onlineStatus: 'PENDING_APPROVAL',
        customerToken: token,
        total,
        notes: notes || null,
        userId: systemUser.id,
        items: { create: enrichedItems },
        delivery: {
          create: {
            customerName: delivery.customerName || null,
            phone: delivery.phone || null,
            address: delivery.address,
            neighborhood: delivery.neighborhood || null,
            notes: delivery.notes || null,
          },
        },
      },
      include: orderInclude,
    });

    // Notificar al sistema en tiempo real
    io.emit('new-order', order);

    res.status(201).json({ token, orderNumber: order.orderNumber, total: order.total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creando pedido' });
  }
};

// GET /api/public/order/:token — estado del pedido para el cliente
export const getPublicOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.findUnique({
      where: { customerToken: req.params.token },
      include: orderInclude,
    });
    if (!order) { res.status(404).json({ error: 'Pedido no encontrado' }); return; }
    res.json(order);
  } catch { res.status(500).json({ error: 'Error' }); }
};