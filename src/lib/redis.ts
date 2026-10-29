import Redis from "ioredis";

const redisOptions = {
  maxRetriesPerRequest: 2, 
  enableReadyCheck: false, 
  tls: { rejectUnauthorized: false }, 
  reconnectOnError: (err: Error) => {
    console.error("❌ Redis Error:", err.message);
    return true;
  },
};

// The cache's Redis connection (src/lib/cache.ts)
export const redis = new Redis(process.env.REDIS_URL as string, redisOptions);

redis.on("error", (err) => console.error("❌ Redis Error:", err));
redis.on("end", () => console.warn("⚠ Redis connection ended. Reconnecting..."));
redis.on("close", () => console.warn("⚠ Redis connection closed. Reconnecting..."));
