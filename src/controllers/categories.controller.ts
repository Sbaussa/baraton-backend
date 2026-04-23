import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const getCategories = async (_req: Request, res: Response): Promise<void> => {
  try {
    const cats = await prisma.category.findMany({ include: { _count: { select: { products: true } } }, orderBy: { name: 'asc' } });
    res.json(cats);
  } catch { res.status(500).json({ error: 'Error' }); }
};

export const createCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, color } = req.body;
    if (!name) { res.status(400).json({ error: 'Nombre requerido' }); return; }
    const cat = await prisma.category.create({ data: { name, color } });
    res.status(201).json(cat);
  } catch { res.status(500).json({ error: 'Error' }); }
};

export const updateCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    const cat = await prisma.category.update({ where: { id: Number(req.params.id) }, data: req.body });
    res.json(cat);
  } catch { res.status(500).json({ error: 'Error' }); }
};

export const deleteCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.category.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error' }); }
};
