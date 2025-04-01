import { Hono } from "hono";
import authenticateUser from "../middlewares/authenticate-user";
import validator from "../middlewares/validator";
import {
  ReserveParkingSpaceParamSchema,
  parkingSpace,
} from "../schema/parkingSpace";
import { history } from "../schema/history";
import { and, eq, isNull, not } from "drizzle-orm";
import { db } from "../utils/db";
import { users } from "../schema/users";
import redlock from "../utils/redlock";

const router = new Hono();

router.post(
  "/:parkingSpaceId/reserve",
  authenticateUser,
  validator("param", ReserveParkingSpaceParamSchema),
  async (c) => {
    const { parkingSpaceId } = c.req.valid("param");
    const { email } = c.get("jwtPayload");
    const lockKey = `lock:parkingSpace:${parkingSpaceId}`;

    try {
      const lock = await redlock.acquire([lockKey], 10_000);
      try {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email));

        if (!user) {
          await lock.release();
          return c.json({ success: false, error: "User not found" });
        }
        const [requestedParkingSpace] = await db
          .select()
          .from(parkingSpace)
          .where(eq(parkingSpace.id, parkingSpaceId));

        if (!requestedParkingSpace || !requestedParkingSpace.isAvailable) {
          await lock.release();
          return c.json({ success: false, error: "Parking space unavailable" });
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

        await lock.release();
        return c.json({
          success: true,
          message: "Successfully updated parking space",
          data: { space: updatedParkingSpace },
        });
      } catch (dbError) {
        await lock.release();
        throw dbError;
      }
    } catch (lockError) {
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
