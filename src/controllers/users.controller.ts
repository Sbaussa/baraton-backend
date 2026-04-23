import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();

export const getUsers = async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, active: true, createdAt: true } });
    res.json(users);
  } catch { res.status(500).json({ error: 'Error' }); }
};

export const createUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) { res.status(400).json({ error: 'Campos requeridos' }); return; }
    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { name, email: email.toLowerCase(), password: hashed, role: role || 'CASHIER' }, select: { id: true, name: true, email: true, role: true, active: true } });
    res.status(201).json(user);
  } catch { res.status(500).json({ error: 'Error creando usuario' }); }
};

export const updateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, role, active, password } = req.body;
    const data: any = {};
    if (name) data.name = name;
    if (email) data.email = email.toLowerCase();
    if (role) data.role = role;
    if (active !== undefined) data.active = active;
    if (password) data.password = await bcrypt.hash(password, 10);

    // Proteger admin principal
    const existing = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
    if (existing?.email === 'admin@baraton.com' && (email || role)) {
      res.status(403).json({ error: 'No se puede modificar el admin principal' }); return;
    }

    const user = await prisma.user.update({ where: { id: Number(req.params.id) }, data, select: { id: true, name: true, email: true, role: true, active: true } });
    res.json(user);
  } catch { res.status(500).json({ error: 'Error' }); }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
    if (user?.email === 'admin@baraton.com') { res.status(403).json({ error: 'No se puede eliminar el admin principal' }); return; }
    await prisma.user.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error' }); }
};
