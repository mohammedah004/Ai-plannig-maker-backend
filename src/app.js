import express from "express";
import cors from "cors";
import routes from "./routes/index.js";
import { errorHandler } from "./middleware/error-handler.js";
import { NotFoundError } from "./utils/errors.js";
import { env } from "./config/env.js";

const app = express();

// 1. CORS Configuration
const allowedOrigins = [
  env.FRONTEND_URL,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS policy.`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// 2. Request Parsing Middleware
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// 3. Mount Routes
app.use("/", routes);

// 4. Unmatched 404 Route Handler
app.use((req, res, next) => {
  next(new NotFoundError(`المسار غير موجود: ${req.method} ${req.originalUrl}`));
});

// 5. Global Error Handling Middleware
app.use(errorHandler);

export default app;
