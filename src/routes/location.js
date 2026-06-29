import express from 'express';
import { updateLocation, getAllLatest } from '../controllers/locationController.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();

router.post('/update', protect, updateLocation);      // Agent → POST location
router.get('/all-latest', protect, getAllLatest);      // Dashboard → GET all agents

export default router;