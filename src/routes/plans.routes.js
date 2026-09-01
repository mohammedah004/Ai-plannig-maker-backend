import { Router } from "express";
import { plansController } from "../controllers/plans.controller.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createPlanSchema, regeneratePostSchema } from "../schemas/plans.schema.js";

const router = Router();

// All plan routes require authentication
router.use(authenticate);

// 1. List plans & Create plan
router.get("/", (req, res, next) => plansController.getPlans(req, res, next));
router.post("/", validate(createPlanSchema), (req, res, next) => plansController.createPlan(req, res, next));

// 2. Status polling endpoint
router.get("/:id/status", (req, res, next) => plansController.getPlanStatus(req, res, next));

// 3. Retry failed generation
router.post("/:id/retry", (req, res, next) => plansController.retryPlan(req, res, next));

// 4. Retry failed Google Sheets export
router.post("/:id/retry-export", (req, res, next) => plansController.retryExport(req, res, next));

// 5. Single post regeneration
router.post(
  "/:id/content/:day/regenerate",
  validate(regeneratePostSchema),
  (req, res, next) => plansController.regeneratePost(req, res, next)
);

// 6. Get plan by ID & Delete plan
router.get("/:id", (req, res, next) => plansController.getPlanById(req, res, next));
router.delete("/:id", (req, res, next) => plansController.deletePlan(req, res, next));

export default router;
