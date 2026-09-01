import { supabaseAdmin } from "../config/supabase.js";
import { AppError } from "../utils/errors.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Brands Repository - Data Access Layer for brand_profiles
 * All queries are strictly scoped by user_id.
 */
export class BrandsRepository {
  /**
   * Retrieves all brand profiles owned by a user
   *
   * @param {string} userId - Canonical user ID
   * @returns {Promise<Array>}
   */
  async getBrandsByUser(userId) {
    const { data, error } = await supabaseAdmin
      .from("brand_profiles")
      .select("*")
      .eq("user_id", String(userId))
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      throw new AppError("DB_ERROR", "تعذر جلب ملفات البراند.", 500, error);
    }

    return data || [];
  }

  /**
   * Retrieves a single brand profile by ID verifying ownership
   *
   * @param {string} brandId - UUID of the brand
   * @param {string} userId - Canonical user ID
   * @returns {Promise<Object|null>}
   */
  async getBrandById(brandId, userId) {
    if (!brandId || !UUID_REGEX.test(brandId)) {
      return null;
    }

    const { data, error } = await supabaseAdmin
      .from("brand_profiles")
      .select("*")
      .eq("id", brandId)
      .eq("user_id", String(userId))
      .maybeSingle();

    if (error) {
      throw new AppError("DB_ERROR", "تعذر جلب ملف البراند.", 500, error);
    }

    return data;
  }

  /**
   * Creates a new brand profile for a user
   *
   * @param {string} userId - Canonical user ID
   * @param {Object} brandInput - Validated brand data
   * @returns {Promise<Object>} Created brand row
   */
  async createBrand(userId, brandInput) {
    const isDefault = Boolean(brandInput.is_default);

    // If new brand is default, unset is_default on other brands owned by this user
    if (isDefault) {
      await supabaseAdmin
        .from("brand_profiles")
        .update({ is_default: false })
        .eq("user_id", String(userId));
    }

    const payload = {
      user_id: String(userId),
      name: brandInput.name,
      product_name: brandInput.product_name,
      product_description: brandInput.product_description,
      product_category: brandInput.product_category,
      target_audience: brandInput.target_audience,
      problem_solved: brandInput.problem_solved,
      brand_tone: Array.isArray(brandInput.brand_tone) ? brandInput.brand_tone : [],
      website_url: brandInput.website_url || null,
      additional_context: brandInput.additional_context || null,
      is_default: isDefault,
    };

    const { data, error } = await supabaseAdmin
      .from("brand_profiles")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new AppError("DB_ERROR", "تعذر حفظ ملف البراند في قاعدة البيانات.", 500, error);
    }

    return data;
  }

  /**
   * Updates an existing brand profile verifying ownership
   *
   * @param {string} brandId - UUID of the brand
   * @param {string} userId - Canonical user ID
   * @param {Object} updateData - Updated fields
   * @returns {Promise<Object|null>} Updated row or null if not found
   */
  async updateBrand(brandId, userId, updateData) {
    if (!brandId || !UUID_REGEX.test(brandId)) {
      return null;
    }

    // 1. Check ownership
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("brand_profiles")
      .select("id")
      .eq("id", brandId)
      .eq("user_id", String(userId))
      .maybeSingle();

    if (fetchErr) {
      throw new AppError("DB_ERROR", "تعذر التحقق من ملف البراند.", 500, fetchErr);
    }

    if (!existing) {
      return null;
    }

    const isDefault = Boolean(updateData.is_default);

    // If setting as default, unset other brands of this user
    if (isDefault) {
      await supabaseAdmin
        .from("brand_profiles")
        .update({ is_default: false })
        .eq("user_id", String(userId))
        .neq("id", brandId);
    }

    const payload = {
      ...(updateData.name ? { name: updateData.name } : {}),
      ...(updateData.product_name ? { product_name: updateData.product_name } : {}),
      ...(updateData.product_description ? { product_description: updateData.product_description } : {}),
      ...(updateData.product_category ? { product_category: updateData.product_category } : {}),
      ...(updateData.target_audience ? { target_audience: updateData.target_audience } : {}),
      ...(updateData.problem_solved ? { problem_solved: updateData.problem_solved } : {}),
      ...(updateData.brand_tone ? { brand_tone: updateData.brand_tone } : {}),
      ...(updateData.website_url !== undefined ? { website_url: updateData.website_url } : {}),
      ...(updateData.additional_context !== undefined ? { additional_context: updateData.additional_context } : {}),
      ...(updateData.is_default !== undefined ? { is_default: isDefault } : {}),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("brand_profiles")
      .update(payload)
      .eq("id", brandId)
      .eq("user_id", String(userId))
      .select()
      .single();

    if (error) {
      throw new AppError("DB_ERROR", "تعذر تحديث بيانات البراند.", 500, error);
    }

    return data;
  }

  /**
   * Deletes a brand profile verifying ownership
   *
   * @param {string} brandId - UUID of the brand
   * @param {string} userId - Canonical user ID
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async deleteBrand(brandId, userId) {
    if (!brandId || !UUID_REGEX.test(brandId)) {
      return false;
    }

    const { error, count } = await supabaseAdmin
      .from("brand_profiles")
      .delete({ count: "exact" })
      .eq("id", brandId)
      .eq("user_id", String(userId));

    if (error) {
      throw new AppError("DB_ERROR", "تعذر حذف ملف البراند.", 500, error);
    }

    return Boolean(count && count > 0);
  }
}

export const brandsRepository = new BrandsRepository();
