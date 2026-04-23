import { Router } from 'express';
import { authenticate, requireRole } from '../middlewares/auth.middleware';
import {
  getOrders, getActiveOrders, getOrder,
  createOrder, updateStatus, updateOrder, processPayment, cancelOrder,
  approveOrder, rejectOrder, updateLocation, riderConfirm,
} from '../controllers/orders.controller';

const router = Router();
router.use(authenticate);

router.get('/', getOrders);
router.get('/active', getActiveOrders);
router.get('/:id', getOrder);
router.post('/', requireRole('ADMIN', 'CASHIER'), createOrder);
router.patch('/:id/status', updateStatus);
router.patch('/:id/payment', requireRole('ADMIN', 'CASHIER'), processPayment);
router.patch('/:id/cancel', requireRole('ADMIN', 'CASHIER'), cancelOrder);
router.patch('/:id/approve', requireRole('ADMIN', 'CASHIER'), approveOrder);
router.patch('/:id/reject', requireRole('ADMIN', 'CASHIER'), rejectOrder);
router.patch('/:id/location', updateLocation);
router.patch('/:id/rider-confirm', riderConfirm);
router.patch('/:id', requireRole('ADMIN', 'CASHIER'), updateOrder);

export default router;