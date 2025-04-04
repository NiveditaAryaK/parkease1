import { Hono } from "hono";
import authenticateUser from "../middlewares/authenticate-user";
import validator from "../middlewares/validator";
import {
  ReserveParkingSpaceParamSchema,
  parkingSpace,
} from "../schema/parkingSpace";
import { history } from "../schema/history";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../utils/db";
import { users } from "../schema/users";
import { redlock } from "../utils/redis";
import { redis } from "../utils/redis";

const router = new Hono();

router.post(
  "/:parkingSpaceId/lock",
  authenticateUser,
  validator("param", ReserveParkingSpaceParamSchema),
  async (c) => {
    console.log("Lock handler reached with ID:", c.req.param("parkingSpaceId"));

    const { parkingSpaceId } = c.req.valid("param");
    const { email } = c.get("jwtPayload");

    const concurrencyLockKey = `redlock:space:${parkingSpaceId}`;

    const userLockKey = `lock:user:${email}`;
    const holdKey = `hold:space:${parkingSpaceId}`;

    const [space] = await db
      .select({
        id: parkingSpace.id,
        parkingLotId: parkingSpace.parkingLotId,
        type: parkingSpace.type,
      })
      .from(parkingSpace)
      .where(eq(parkingSpace.id, parkingSpaceId));

    if (!space) {
      return c.json({ success: false, error: "Parking space not found" }, 404);
    }

    const existingLockedSpaceId = await redis.get(userLockKey);
    if (existingLockedSpaceId && existingLockedSpaceId !== parkingSpaceId) {
      const [lockedSpace] = await db
        .select({ type: parkingSpace.type })
        .from(parkingSpace)
        .where(eq(parkingSpace.id, existingLockedSpaceId));

      if (lockedSpace?.type === space.type) {
        return c.json(
          { success: false, error: "You already locked a space of this type" },
          409
        );
      }
    }

    try {
      const lock = await redlock.acquire([concurrencyLockKey], 5_000);

      try {
        await redis.set(userLockKey, parkingSpaceId, "EX", 60);
        await redis.set(holdKey, email, "EX", 60);

        return c.json({
          success: true,
          message: "Space locked for 60 seconds (soft hold)",
          data: { spaceId: parkingSpaceId, type: space.type },
        });
      } finally {
        await lock.release();
      }
    } catch (err) {
      console.error("Redlock acquisition failed:", err);
      return c.json(
        { success: false, error: "Space is already locked by someone else" },
        423
      );
    }
  }
);

router.post(
  "/:parkingSpaceId/reserve",
  authenticateUser,
  validator("param", ReserveParkingSpaceParamSchema),
  async (c) => {
    const { parkingSpaceId } = c.req.valid("param");
    const { email } = c.get("jwtPayload");

    const userLockKey = `lock:user:${email}`;
    const spaceLockKey = `lock:space:${parkingSpaceId}`;

    const lockedSpaceId = await redis.get(userLockKey);
    if (lockedSpaceId !== parkingSpaceId) {
      return c.json(
        {
          success: false,
          error: "You have not locked this space",
        },
        403
      );
    }

    try {
      const lock = await redlock.acquire([spaceLockKey], 10000);
      try {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email));
        if (!user) {
          return c.json({ success: false, error: "User not found" }, 404);
        }

        const [requestedParkingSpace] = await db
          .select()
          .from(parkingSpace)
          .where(eq(parkingSpace.id, parkingSpaceId));
        if (!requestedParkingSpace) {
          return c.json({
            success: false,
            error: "Parking space not found",
          });
        }

        const updatedParkingSpace = await db.transaction(async (trx) => {
          const [updatedParkingSpace] = await trx
            .update(parkingSpace)
            .set({ isAvailable: false })
            .where(eq(parkingSpace.id, parkingSpaceId))
            .returning();

          await trx.insert(history).values({
            userId: user.id,
            parkingSpaceId,
            parkingLotId: requestedParkingSpace.parkingLotId,
          });

          return updatedParkingSpace;
        });
        return c.json({
          success: true,
          message: "Successfully reserved parking space",
          data: { space: updatedParkingSpace },
        });
      } finally {
        await lock.release();
      }
    } catch {
      return c.json(
        {
          success: false,
          error: "Reservation already in progress, please try again later",
        },
        423
      );
    }
  }
);

router.post(
  "/:parkingSpaceId/end",
  authenticateUser,
  validator("param", ReserveParkingSpaceParamSchema),
  async (c) => {
    const { parkingSpaceId } = c.req.valid("param");

    const { email } = c.get("jwtPayload");
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) {
      return c.json({
        success: false,
        error: "User not found",
      });
    }

    const [historyEntry] = await db
      .select()
      .from(history)
      .where(
        and(
          eq(history.parkingSpaceId, parkingSpaceId),
          eq(history.userId, user.id),
          isNull(history.endTime)
        )
      );
    if (!historyEntry) {
      return c.json({
        success: false,
        error: "No active reservation found",
      });
    }

    const [requestedParkingSpace] = await db
      .select()
      .from(parkingSpace)
      .where(eq(parkingSpace.id, parkingSpaceId));
    if (!requestedParkingSpace) {
      return c.json({
        success: false,
        error: "Parking space not found",
      });
    }

    const updatedParkingSpace = await db.transaction(async (trx) => {
      const [updatedParkingSpace] = await trx
        .update(parkingSpace)
        .set({ isAvailable: true })
        .where(eq(parkingSpace.id, parkingSpaceId))
        .returning();

      await trx
        .update(history)
        .set({ endTime: new Date() })
        .where(eq(history.id, historyEntry.id));

      return updatedParkingSpace;
    });

    return c.json({
      success: true,
      message: "Successfully updated parking space",
      data: { space: updatedParkingSpace },
    });
  }
);
export default router;
