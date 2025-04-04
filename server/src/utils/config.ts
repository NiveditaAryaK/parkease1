import { z } from "zod";

const configSchema = z.object({
  PORT: z.string().default("3000").transform(Number),
  DATABASE_URL: z
    .string()
    .default("postgres://postgres:postgres@localhost:5432/parkease"),
  JWT_SECRET: z.string().default("secret"),
  ADMIN_API_KEY: z.string(),
  AWS_ACCESS_KEY_ID: z.string(),
  AWS_SECRET_ACCESS_KEY: z.string(),
  AWS_REGION: z.string(),
  FROM_MAIL: z.string(),
  FROM_NAME: z.string(),
  VERIFY_EMAIL: z.string().transform((val) => val === "true"),
  REDIS_HOST: z.string().default("127.0.0.1"),
  REDIS_PORT: z.string().default("6379"),
});

export const {
  PORT,
  DATABASE_URL,
  JWT_SECRET,
  ADMIN_API_KEY,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_REGION,
  FROM_MAIL,
  FROM_NAME,
  VERIFY_EMAIL,
  REDIS_HOST,
  REDIS_PORT,
} = configSchema.parse(Bun.env);
