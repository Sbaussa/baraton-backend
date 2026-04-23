import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function getDateRange(req: Request) {
  const { date, from, to } = req.query as any;

  // Colombia es UTC-5: medianoche local = 05:00 UTC
  const TZ_OFFSET = 5 * 60 * 60 * 1000;

  if (date) {
    const d    = new Date(date + 'T00:00:00.000Z');
    d.setTime(d.getTime() + TZ_OFFSET);          // medianoche Colombia en UTC
    const next = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    return { gte: d, lt: next };
  }
  if (from && to) {
    const f = new Date(from + 'T00:00:00.000Z');
    f.setTime(f.getTime() + TZ_OFFSET);
    const t = new Date(to + 'T00:00:00.000Z');
    t.setTime(t.getTime() + TZ_OFFSET + 24 * 60 * 60 * 1000);
    return { gte: f, lt: t };
  }
  // Sin filtro → hoy en Colombia
  const now   = new Date();
  const local = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
  const todayStr = local.toISOString().split('T')[0];
  const d    = new Date(todayStr + 'T00:00:00.000Z');
  d.setTime(d.getTime() + TZ_OFFSET);
  const next = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  return { gte: d, lt: next };
}

export const getDashboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const createdAt = getDateRange(req);

    const [delivered, cancelled, pending, active, paymentMethods, topProductsRaw, categoryRaw, recentOrders] = await Promise.all([
      // Ventas entregadas
      prisma.order.aggregate({
        where: { status: 'DELIVERED', createdAt },
        _sum: { total: true }, _count: true,
      }),
      // Cancelados
      prisma.order.count({ where: { status: 'CANCELLED', createdAt } }),
      // Pendientes ahora (sin filtro fecha)
      prisma.order.count({ where: { status: 'PENDING' } }),
      // Activos ahora
      prisma.order.count({ where: { status: { in: ['PENDING','PREPARING','READY'] } } }),
      // Métodos de pago
      prisma.order.groupBy({
        by: ['paymentMethod'],
        where: { status: 'DELIVERED', createdAt, paymentMethod: { not: null } },
        _sum: { total: true }, _count: true,
      }),
      // Top productos
      prisma.orderItem.groupBy({
        by: ['productId'],
        where: { order: { status: 'DELIVERED', createdAt } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),
      // Categorías
      prisma.orderItem.findMany({
        where: { order: { status: 'DELIVERED', createdAt } },
        include: { product: { include: { category: true } } },
      }),
      // Últimos pedidos
      prisma.order.findMany({
        where: { createdAt },
        include: { items: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
    ]);

    // Enriquecer top productos
    const topProducts = await Promise.all(
      topProductsRaw.map(async (p) => {
        const product = await prisma.product.findUnique({ where: { id: p.productId } });
        return { id: p.productId, name: product?.name || '', totalSold: p._sum.quantity || 0 };
      })
    );

    // Ranking categorías
    const catMap: Record<string, { name: string; total: number }> = {};
    categoryRaw.forEach((item) => {
      const cat = item.product.category.name;
      if (!catMap[cat]) catMap[cat] = { name: cat, total: 0 };
      catMap[cat].total += item.quantity;
    });
    const categoryRanking = Object.values(catMap).sort((a, b) => b.total - a.total).slice(0, 5);

    const totalRevenue = delivered._sum.total || 0;
    const totalOrders  = delivered._count;
    const avgTicket    = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    res.json({
      totalRevenue, totalOrders, avgTicket,
      pendingOrders: pending,
      activeOrders: active,
      cancelledOrders: cancelled,
      paymentMethods,
      topProducts,
      categoryRanking,
      recentOrders,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error' });
  }
};

export const getSalesByHour = async (req: Request, res: Response): Promise<void> => {
  try {
    const createdAt = getDateRange(req);
    const orders = await prisma.order.findMany({
      where: { status: 'DELIVERED', createdAt },
      select: { total: true, createdAt: true },
    });

    const byHour: Record<number, { revenue: number; orders: number }> = {};
    for (let h = 6; h <= 22; h++) byHour[h] = { revenue: 0, orders: 0 };

    orders.forEach((o) => {
      const h = new Date(o.createdAt).getHours();
      if (byHour[h]) { byHour[h].revenue += o.total; byHour[h].orders++; }
    });

    const result = Object.entries(byHour).map(([hour, data]) => ({
      hour: Number(hour), ...data,
    }));

    res.json(result);
  } catch {
    res.status(500).json({ error: 'Error' });
  }
};