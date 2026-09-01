import { Router } from "express";
import { brandsController } from "../controllers/brands.controller.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createBrandSchema, updateBrandSchema } from "../schemas/brands.schema.js";

const router = Router();

// All brand routes require authentication
router.use(authenticate);

router.get("/", (req, res, next) => brandsController.getBrands(req, res, next));
router.post("/", validate(createBrandSchema), (req, res, next) => brandsController.createBrand(req, res, next));
router.get("/:id", (req, res, next) => brandsController.getBrandById(req, res, next));
router.put("/:id", validate(updateBrandSchema), (req, res, next) => brandsController.updateBrand(req, res, next));
router.delete("/:id", (req, res, next) => brandsController.deleteBrand(req, res, next));

export default router;
