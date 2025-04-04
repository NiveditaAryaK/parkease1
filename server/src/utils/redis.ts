import Redis from "ioredis";
import Redlock from "redlock";

export const redis = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT || "6379"),
});

export const redlock = new Redlock([redis], {
  retryCount: 3,
  retryDelay: 200,
});
