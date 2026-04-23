// kitchen.routes.ts
import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { getKitchenOrders, startPreparing, markReady } from '../controllers/kitchen.controller';
const r = Router();
r.use(authenticate);
r.get('/orders', getKitchenOrders);
r.patch('/:id/preparing', startPreparing);
r.patch('/:id/ready', markReady);
export default r;
