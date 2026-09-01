import { defineConfig } from "vitest/config";
import dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 20000,
    env: {
      NODE_ENV: "test",
      PORT: process.env.PORT || "5001",
      SUPABASE_URL: process.env.SUPABASE_URL || "https://placeholder-test.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-test-service-key",
      AUTH_SECRET: process.env.AUTH_SECRET || "placeholder-test-auth-secret-123456789",
      INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET || "placeholder-test-internal-api-secret-987654321",
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || "placeholder-test-gemini-key",
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "placeholder-test-client-id",
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "placeholder-test-client-secret",
    },
  },
});
