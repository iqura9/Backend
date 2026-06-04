import rateLimit from "express-rate-limit";

/** General API rate limiter — generous for CRUD usage. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "TOO_MANY_REQUESTS", message: "Too many requests, please try again later" } },
});

/** Stricter limiter for AI endpoints — each call consumes LLM quota. */
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "TOO_MANY_REQUESTS", message: "AI rate limit exceeded, please wait before retrying" } },
});
