import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { printReceipt, printKitchen } from '../controllers/print.controller';
const r = Router();
r.use(authenticate);
r.post('/receipt/:id', printReceipt);
r.post('/kitchen/:id', printKitchen);
export default r;
