import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getProducts = async (_req: Request, res: Response): Promise<void> => {
  try {
    const products = await prisma.product.findMany({
      include: { category: true },
      orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
    });
    res.json(products);
  } catch { res.status(500).json({ error: 'Error' }); }
};

export const getAvailableProducts = async (_req: Request, res: Response): Promise<void> => {
  try {
    const products = await prisma.product.findMany({
      where: { available: true },
      include: { category: true },
      orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
    });
    res.json(products);
  } catch { res.status(500).json({ error: 'Error' }); }
};

export const createProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, price, categoryId, available } = req.body;
    if (!name || !price || !categoryId) { res.status(400).json({ error: 'Campos requeridos: name, price, categoryId' }); return; }
    const product = await prisma.product.create({ data: { name, price: Number(price), categoryId: Number(categoryId), available: available ?? true }, include: { category: true } });
    res.status(201).json(product);
  } catch { res.status(500).json({ error: 'Error creando producto' }); }
};

export const updateProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, price, categoryId, available } = req.body;
    const product = await prisma.product.update({
      where: { id: Number(req.params.id) },
      data: { ...(name && { name }), ...(price !== undefined && { price: Number(price) }), ...(categoryId && { categoryId: Number(categoryId) }), ...(available !== undefined && { available }) },
      include: { category: true },
    });
    res.json(product);
  } catch { res.status(500).json({ error: 'Error actualizando' }); }
};

export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.product.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error eliminando' }); }
};
