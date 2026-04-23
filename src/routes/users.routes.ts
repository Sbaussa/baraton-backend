// users.routes.ts
import { Router } from 'express';
import { authenticate, requireRole } from '../middlewares/auth.middleware';
import { getUsers, createUser, updateUser, deleteUser } from '../controllers/users.controller';
const r = Router();
r.use(authenticate, requireRole('ADMIN'));
r.get('/', getUsers);
r.post('/', createUser);
r.put('/:id', updateUser);
r.delete('/:id', deleteUser);
export default r;
