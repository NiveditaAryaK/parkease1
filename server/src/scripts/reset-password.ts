// src/scripts/reset-password.ts
import { db } from "../utils/db";
import { users } from "../schema/users";
import { eq } from "drizzle-orm";

const email = "nk4501@srmist.edu.in";
const newPassword = Bun.password.hashSync("Range@123");

async function resetPassword() {
  const [updated] = await db
    .update(users)
    .set({ password: newPassword })
    .where(eq(users.email, email))
    .returning();

  if (updated) {
    console.log("✅ Password reset for:", updated.email);
  } else {
    console.log("❌ User not found");
  }
}

resetPassword();
