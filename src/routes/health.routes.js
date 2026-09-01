import { Router } from "express";
import { getHealth } from "../controllers/health.controller.js";

const router = Router();

// GET /health - Public health check & Render cold-start warm-up ping
router.get("/health", getHealth);

export default router;
