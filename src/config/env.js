import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z
    .string()
    .default("5000")
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0 && val <= 65535, {
      message: "PORT must be a valid port number (1-65535)",
    }),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  FRONTEND_URL: z
    .string()
    .default("http://localhost:3000"),

  // Supabase Configuration
  SUPABASE_URL: z
    .string()
    .url("SUPABASE_URL must be a valid HTTP/HTTPS URL"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),

  // NextAuth Verification Secret (End-user sessions)
  AUTH_SECRET: z
    .string()
    .min(1, "AUTH_SECRET is required to verify JWT sessions"),

  // Internal API Secret (Service-to-service auth)
  INTERNAL_API_SECRET: z
    .string()
    .min(1, "INTERNAL_API_SECRET is required for internal service-to-service auth"),

  // AI Service (Google Gemini)
  GEMINI_API_KEY: z
    .string()
    .min(1, "GEMINI_API_KEY is required for strategic planning"),

  // Google OAuth2 Configuration (Sheets & Drive Integration)
  GOOGLE_CLIENT_ID: z
    .string()
    .min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z
    .string()
    .min(1, "GOOGLE_CLIENT_SECRET is required"),

  // Optional during initial standing-up before generate-google-token.js has been run
  GOOGLE_SHEETS_OWNER_REFRESH_TOKEN: z
    .string()
    .optional(),
});

/**
 * Validates environment variables at startup.
 * Fails fast with clear actionable error output if required variables are missing.
 */
function parseEnvironment() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.format();
    const missingVars = [];

    for (const [key, value] of Object.entries(formatted)) {
      if (key !== "_errors" && value?._errors?.length) {
        missingVars.push(`  - ${key}: ${value._errors.join(", ")}`);
      }
    }

    console.error("\n❌ FATAL: Invalid or missing backend environment variables:\n");
    console.error(missingVars.join("\n"));
    console.error("\nPlease configure .env based on backend/.env.example\n");

    if (process.env.NODE_ENV !== "test") {
      process.exit(1);
    } else {
      throw new Error("Invalid test environment variables.");
    }
  }

  return result.data;
}

export const env = parseEnvironment();
