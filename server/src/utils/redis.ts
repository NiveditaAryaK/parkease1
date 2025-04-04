import Redis from "ioredis";
import Redlock from "redlock";
import { REDIS_HOST, REDIS_PORT } from "./config";

export const redis = new Redis({
  host: REDIS_HOST || "127.0.0.1",
  port: parseInt(REDIS_PORT || "6379"),
});

export const redlock = new Redlock([redis], {
  retryCount: 3,
  retryDelay: 200,
});
