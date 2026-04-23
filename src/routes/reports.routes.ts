import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { getDashboard, getSalesByHour } from '../controllers/reports.controller';
const r = Router();
r.use(authenticate);
r.get('/dashboard', getDashboard);
r.get('/sales-by-hour', getSalesByHour);
export default r;