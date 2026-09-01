import { brandsRepository } from "../repositories/brands.repository.js";
import { sendSuccess } from "../utils/response.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";

/**
 * Brands Controller
 */
export class BrandsController {
  /**
   * GET /api/v1/brands
   * Lists all brand profiles for the authenticated user
   */
  async getBrands(req, res, next) {
    try {
      const brands = await brandsRepository.getBrandsByUser(req.user.userId);
      return sendSuccess(res, brands);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/brands/:id
   * Retrieves single brand profile by ID
   */
  async getBrandById(req, res, next) {
    try {
      const brand = await brandsRepository.getBrandById(req.params.id, req.user.userId);
      if (!brand) {
        throw new NotFoundError("ملف البراند غير موجود أو ليس لديك صلاحية الوصول إليه.");
      }
      return sendSuccess(res, brand);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/brands
   * Creates a new brand profile
   */
  async createBrand(req, res, next) {
    try {
      const body = req.body;
      if (!body.name || !body.product_name || !body.product_description) {
        throw new ValidationError("يرجى ملء الحقول الأساسية لملف البراند (الاسم، اسم المنتج، ووصفه).");
      }

      const brand = await brandsRepository.createBrand(req.user.userId, body);
      return sendSuccess(res, brand, 201, "تم إنشاء ملف البراند بنجاح.");
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/v1/brands/:id
   * Updates an existing brand profile
   */
  async updateBrand(req, res, next) {
    try {
      const updated = await brandsRepository.updateBrand(req.params.id, req.user.userId, req.body);
      if (!updated) {
        throw new NotFoundError("ملف البراند غير موجود أو ليس لديك صلاحية تعديله.");
      }
      return sendSuccess(res, updated, 200, "تم تحديث ملف البراند بنجاح.");
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/brands/:id
   * Deletes a brand profile
   */
  async deleteBrand(req, res, next) {
    try {
      const deleted = await brandsRepository.deleteBrand(req.params.id, req.user.userId);
      if (!deleted) {
        throw new NotFoundError("ملف البراند غير موجود أو ليس لديك صلاحية حذفه.");
      }
      return sendSuccess(res, null, 200, "تم حذف ملف البراند بنجاح.");
    } catch (err) {
      next(err);
    }
  }
}

export const brandsController = new BrandsController();
