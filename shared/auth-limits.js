export function authLimitConfig(env = process.env) {
  const positive = (value, fallback) => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  return {
    attempts: positive(env.AUTH_MAX_ATTEMPTS, 3),
    windowMs: positive(env.AUTH_WINDOW_MINUTES, 10) * 60_000,
  };
}

