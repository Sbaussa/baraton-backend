import { Router } from 'express';
import { authenticate, requireRole } from '../middlewares/auth.middleware';
import { setDailyAvailability } from '../controllers/menu.controller';

const r = Router();
r.use(authenticate);
r.patch('/availability', requireRole('ADMIN', 'CASHIER'), setDailyAvailability);

export default r;