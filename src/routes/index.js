import { Router } from "express";
import healthRoutes from "./health.routes.js";
import plansRoutes from "./plans.routes.js";
import brandsRoutes from "./brands.routes.js";

const router = Router();

// Public routes
router.use("/", healthRoutes);

// Protected API v1 resources
router.use("/api/v1/plans", plansRoutes);
router.use("/api/v1/brands", brandsRoutes);

export default router;
