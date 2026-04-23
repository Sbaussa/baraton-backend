import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middlewares/auth.middleware';
import { io } from '../server';

const prisma = new PrismaClient();

const generateOrderNumber = (): string => {
  const now = new Date();
  const date = now.toISOString().slice(2, 10).replace(/-/g, '');
  const time = Date.now().toString().slice(-5);
  return `ALM-${date}-${time}`;
};

// Incluye delivery info siempre
const orderInclude = {
  items: { include: { product: { include: { category: true } } } },
  user: { select: { id: true, name: true } },
  delivery: true,
};

// GET /api/orders
export const getOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, type, date } = req.query as any;
    const where: any = {};
    if (status) where.status = status;
    if (type) where.orderType = type;
    if (date) {
      const TZ = 5 * 60 * 60 * 1000; // UTC-5 Colombia
      const d    = new Date(date + 'T00:00:00.000Z');
      d.setTime(d.getTime() + TZ);
      const next = new Date(d.getTime() + 24 * 60 * 60 * 1000);
      where.createdAt = { gte: d, lt: next };
    }

    // DOMICILIOS primero, luego por fecha desc
    const orders = await prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: [
        { orderType: 'asc' }, // DOMICILIO < LLEVAR < MESA alfabéticamente... usamos otro enfoque
        { createdAt: 'desc' },
      ],
    });

    // ONLINE primero, luego domicilios, llevar, mesas
    const sorted = [
      ...orders.filter((o) => o.orderType === 'ONLINE'),
      ...orders.filter((o) => o.orderType === 'DOMICILIO'),
      ...orders.filter((o) => o.orderType === 'LLEVAR'),
      ...orders.filter((o) => o.orderType === 'MESA'),
    ];

    res.json(sorted);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo pedidos' });
  }
};

// GET /api/orders/active
export const getActiveOrders = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const orders = await prisma.order.findMany({
      where: { status: { in: ['PENDING', 'PREPARING', 'READY'] } },
      include: orderInclude,
    });

    const sorted = [
      ...orders.filter((o) => o.orderType === 'ONLINE'),
      ...orders.filter((o) => o.orderType === 'DOMICILIO'),
      ...orders.filter((o) => o.orderType === 'LLEVAR'),
      ...orders.filter((o) => o.orderType === 'MESA'),
    ];

    res.json(sorted);
  } catch {
    res.status(500).json({ error: 'Error' });
  }
};

// GET /api/orders/:id
export const getOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: Number(req.params.id) },
      include: orderInclude,
    });
    if (!order) { res.status(404).json({ error: 'Pedido no encontrado' }); return; }
    res.json(order);
  } catch {
    res.status(500).json({ error: 'Error' });
  }
};

// POST /api/orders
export const createOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { orderType, tableNumber, notes, items, delivery } = req.body;

    if (!items?.length) { res.status(400).json({ error: 'El pedido necesita al menos un ítem' }); return; }
    if (orderType === 'DOMICILIO' && !delivery?.address) { res.status(400).json({ error: 'La dirección es requerida para domicilios' }); return; }

    // Calcular total
    let total = 0;
    const enrichedItems = [];
    for (const item of items) {
      const product = await prisma.product.findUnique({ where: { id: item.productId } });
      if (!product?.available) { res.status(400).json({ error: `Producto no disponible: ${product?.name}` }); return; }
      total += product.price * item.quantity;
      enrichedItems.push({ productId: item.productId, quantity: item.quantity, unitPrice: product.price, notes: item.notes || null });
    }

    const order = await prisma.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        orderType: orderType || 'MESA',
        tableNumber: tableNumber || null,
        notes: notes || null,
        total,
        userId: req.user!.id,
        items: { create: enrichedItems },
        ...(orderType === 'DOMICILIO' && delivery ? {
          delivery: {
            create: {
              customerName: delivery.customerName || null,
              phone: delivery.phone || null,
              address: delivery.address,
              neighborhood: delivery.neighborhood || null,
              notes: delivery.notes || null,
            },
          },
        } : {}),
      },
      include: orderInclude,
    });

    // Emitir a todos los canales en tiempo real
    io.emit('new-order', order);

    // Notificación específica a domiciliario si aplica
    if (order.orderType === 'DOMICILIO') {
      io.to('delivery').emit('new-delivery', order);
    }

    res.status(201).json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creando pedido' });
  }
};

// PATCH /api/orders/:id/status
export const updateStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status } = req.body;
    const validStatuses = ['PENDING', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'];
    if (!validStatuses.includes(status)) { res.status(400).json({ error: 'Estado inválido' }); return; }

    const order = await prisma.order.update({
      where: { id: Number(req.params.id) },
      data: { status },
      include: orderInclude,
    });

    // Emitir cambio de estado
    io.emit('order-status-changed', { orderId: order.id, status: order.status, order });

    res.json(order);
  } catch {
    res.status(500).json({ error: 'Error actualizando estado' });
  }
};

// PATCH /api/orders/:id/payment
export const processPayment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { paymentMethod, cashGiven, markDelivered } = req.body;
    const order = await prisma.order.findUnique({ where: { id: Number(req.params.id) } });
    if (!order) { res.status(404).json({ error: 'Pedido no encontrado' }); return; }

    const cashChange = paymentMethod === 'EFECTIVO' && cashGiven ? cashGiven - order.total : null;

    // Si es domicilio, NO marcar como DELIVERED automáticamente — el domiciliario lo hace
    // Si markDelivered es true (pedidos de mesa/llevar) sí lo marca
    const isDelivery = order.orderType === 'DOMICILIO' || order.orderType === 'ONLINE';
    const newStatus  = (!isDelivery || markDelivered) ? 'DELIVERED' : order.status;

    const updated = await prisma.order.update({
      where: { id: Number(req.params.id) },
      data: { paymentMethod, cashGiven: cashGiven || null, cashChange, status: newStatus },
      include: orderInclude,
    });

    io.emit('order-status-changed', { orderId: updated.id, status: updated.status, order: updated });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Error procesando pago' });
  }
};

// PATCH /api/orders/:id — editar items y notas
export const updateOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { notes, items } = req.body;
    const orderId = Number(req.params.id);

    let total = 0;
    const enrichedItems = [];
    for (const item of items || []) {
      const product = await prisma.product.findUnique({ where: { id: item.productId } });
      if (!product) continue;
      total += product.price * item.quantity;
      enrichedItems.push({ productId: item.productId, quantity: item.quantity, unitPrice: product.price });
    }

    await prisma.orderItem.deleteMany({ where: { orderId } });

    const order = await prisma.order.update({
      where: { id: orderId },
      data: {
        notes: notes || null,
        total,
        items: { create: enrichedItems },
      },
      include: {
        items: { include: { product: { include: { category: true } } } },
        user: { select: { id: true, name: true } },
        delivery: true,
      },
    });

    io.emit('order-status-changed', { orderId: order.id, status: order.status, order });
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error editando pedido' });
  }
}; 

// PATCH /api/orders/:id/cancel
export const cancelOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.update({
      where: { id: Number(req.params.id) },
      data: { status: 'CANCELLED' },
      include: orderInclude,
    });
    io.emit('order-status-changed', { orderId: order.id, status: 'CANCELLED', order });
    res.json(order);
  } catch {
    res.status(500).json({ error: 'Error cancelando pedido' });
  }
};

// PATCH /api/orders/:id/approve
export const approveOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { deliveryUserId } = req.body;
    const order = await prisma.order.update({
      where: { id: Number(req.params.id) },
      data: { onlineStatus: 'APPROVED', status: 'PENDING', deliveryUserId: deliveryUserId || null },
      include: {
        items: { include: { product: { include: { category: true } } } },
        user: { select: { id: true, name: true } },
        delivery: true,
        deliveryUser: { select: { id: true, name: true } },
      },
    });
    io.emit('order-status-changed', { orderId: order.id, status: order.status, order });
    io.to(`tracking-${order.customerToken}`).emit('order-approved', order);
    res.json(order);
  } catch { res.status(500).json({ error: 'Error aprobando pedido' }); }
};

// PATCH /api/orders/:id/reject
export const rejectOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.update({
      where: { id: Number(req.params.id) },
      data: { onlineStatus: 'REJECTED', status: 'CANCELLED' },
      include: {
        items: { include: { product: { include: { category: true } } } },
        user: { select: { id: true, name: true } },
        delivery: true,
      },
    });
    io.emit('order-status-changed', { orderId: order.id, status: order.status, order });
    io.to(`tracking-${order.customerToken}`).emit('order-rejected', order);
    res.json(order);
  } catch { res.status(500).json({ error: 'Error rechazando pedido' }); }
};

// PATCH /api/orders/:id/location — domiciliario actualiza ubicación
export const updateLocation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { lat, lng } = req.body;
    const order = await prisma.order.update({
      where: { id: Number(req.params.id) },
      data: { deliveryLat: lat, deliveryLng: lng },
      select: { id: true, customerToken: true, deliveryLat: true, deliveryLng: true },
    });
    // Emitir al cliente que sigue el pedido
    io.to(`tracking-${order.customerToken}`).emit('location-update', { lat, lng });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error' }); }
};

// PATCH /api/orders/:id/rider-confirm — solo el domiciliario confirma entrega
export const riderConfirm = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.update({
      where: { id: Number(req.params.id) },
      data: { riderConfirmed: true, status: 'DELIVERED' },
      include: orderInclude,
    });
    io.emit('order-status-changed', { orderId: order.id, status: 'DELIVERED', order });
    res.json(order);
  } catch {
    res.status(500).json({ error: 'Error confirmando entrega' });
  }
};