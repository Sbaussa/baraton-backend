import { Router } from 'express';
import { getPublicProducts, createPublicOrder, getPublicOrder } from '../controllers/public.controller';
const r = Router();
r.get('/products', getPublicProducts);
r.post('/order', createPublicOrder);
r.get('/order/:token', getPublicOrder);
export default r;