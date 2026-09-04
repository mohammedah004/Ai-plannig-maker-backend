import { Router } from "express";
import { plansController } from "../controllers/plans.controller.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createPlanSchema, regeneratePostSchema } from "../schemas/plans.schema.js";
import {
  singleDayMutationSchema,
  batchMutationSchema,
  undoMutationSchema,
} from "../schemas/mutations.schema.js";
import { externalAiParseRequestSchema } from "../schemas/external-ai.schema.js";
import { scopedAiRequestSchema } from "../schemas/scoped-ai.schema.js";

const router = Router();

// All plan routes require authentication
router.use(authenticate);

// 1. List plans & Create plan & Quota info
router.get("/quota", (req, res, next) => plansController.getQuotaStatus(req, res, next));
router.get("/", (req, res, next) => plansController.getPlans(req, res, next));
router.post("/", validate(createPlanSchema), (req, res, next) => plansController.createPlan(req, res, next));

// 2. Status polling endpoint
router.get("/:id/status", (req, res, next) => plansController.getPlanStatus(req, res, next));

// 3. Retry failed generation
router.post("/:id/retry", (req, res, next) => plansController.retryPlan(req, res, next));

// 4. Retry failed Google Sheets export
router.post("/:id/retry-export", (req, res, next) => plansController.retryExport(req, res, next));

// 5. External AI Parse Proposal (Zero DB writes, 0 AI Quota)
router.post(
  "/:id/external-ai/parse",
  validate(externalAiParseRequestSchema),
  (req, res, next) => plansController.parseExternalAiResponse(req, res, next)
);

// 6. Multi-Day Atomic Batch Mutation
router.post(
  "/:id/content/batch",
  validate(batchMutationSchema),
  (req, res, next) => plansController.applyBatchMutation(req, res, next)
);

// 7. Scoped AI Proposal Generation (Consumes 1 AI post regen quota)
router.post(
  "/:id/content/:day/scoped-ai",
  validate(scopedAiRequestSchema),
  (req, res, next) => plansController.generateScopedAiProposal(req, res, next)
);

// 8. Single-Day Concurrency-Safe Undo
router.post(
  "/:id/content/:day/undo",
  validate(undoMutationSchema),
  (req, res, next) => plansController.undoContentMutation(req, res, next)
);

// 9. Single-Day Atomic Commit / Manual Edit (PATCH)
router.patch(
  "/:id/content/:day",
  validate(singleDayMutationSchema),
  (req, res, next) => plansController.applySingleDayMutation(req, res, next)
);

// 10. Legacy Single post regeneration (Preserved for backwards compatibility)
router.post(
  "/:id/content/:day/regenerate",
  validate(regeneratePostSchema),
  (req, res, next) => plansController.regeneratePost(req, res, next)
);

// 11. Get plan by ID & Delete plan
router.get("/:id", (req, res, next) => plansController.getPlanById(req, res, next));
router.delete("/:id", (req, res, next) => plansController.deletePlan(req, res, next));

export default router;
