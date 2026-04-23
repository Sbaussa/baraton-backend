import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const setDailyAvailability = async (req: Request, res: Response): Promise<void> => {
  try {
    const { available, unavailable } = req.body as { available: number[]; unavailable: number[] };

    await Promise.all([
      ...(available || []).map((id) => prisma.product.update({ where: { id }, data: { available: true } })),
      ...(unavailable || []).map((id) => prisma.product.update({ where: { id }, data: { available: false } })),
    ]);

    const products = await prisma.product.findMany({
      include: { category: true },
      orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
    });

    res.json({ ok: true, products });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error actualizando disponibilidad' });
  }
};