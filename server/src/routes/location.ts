import { Hono } from "hono";
import authenticateAdmin from "../middlewares/authenticate-admin";
import validator from "../middlewares/validator";
import {
  AddParkingLotSchema,
  DeleteParkingLotParamSchema,
  parkingLot,
  UpdateParkingLotBodySchema,
  UpdateParkingLotParamSchema,
} from "../schema/parkingLot";
import { db } from "../utils/db";
import {
  AddParkingSpaceBodySchema,
  AddParkingSpaceParamSchema,
  GetParkingSpacesParamSchema,
  parkingSpace,
} from "../schema/parkingSpace";
import { eq, and, sql } from "drizzle-orm";
import { redis } from "../utils/redis";

const router = new Hono();

router.get("/all", async (c) => {
  const parkingLots = await db
    .select({
      id: parkingLot.id,
      name: parkingLot.name,
      address: parkingLot.address,
      location: parkingLot.location,
      capacity: parkingLot.capacity,
      availableSpaces: sql`COUNT(${parkingSpace.id})`,
    })
    .from(parkingLot)
    .leftJoin(
      parkingSpace,
      and(
        eq(parkingSpace.parkingLotId, parkingLot.id),
        eq(parkingSpace.isAvailable, true)
      )
    )
    .groupBy(parkingLot.id);

  return c.json({
    success: true,
    message: "Successfully fetched all parking lots",
    data: { parkingLots },
  });
});

router.get(
  "/:parkingLotId",
  validator("param", GetParkingSpacesParamSchema),
  async (c) => {
    const { parkingLotId } = c.req.valid("param");
    const [requestedParkingLot] = await db
      .select()
      .from(parkingLot)
      .where(eq(parkingLot.id, parkingLotId));

    return c.json({
      success: true,
      message: "Successfully fetched parking lot",
      data: { parkingLot: requestedParkingLot },
    });
  }
);

router.get(
  "/:parkingLotId/spaces",
  validator("param", GetParkingSpacesParamSchema),
  async (c) => {
    const { parkingLotId } = c.req.valid("param");
    const [requestedParkingLot] = await db
      .select()
      .from(parkingLot)
      .where(eq(parkingLot.id, parkingLotId));

    const parkingSpaces = await db
      .select()
      .from(parkingSpace)
      .where(eq(parkingSpace.parkingLotId, parkingLotId));

    const updatedSpaces = await Promise.all(
      parkingSpaces.map(async (space) => {
        const lockKey = `lock:space:${space.id}`;
        const isLocked = await redis.get(lockKey);

        return {
          ...space,
          isAvailable: space.isAvailable && !isLocked,
        };
      })
    );

    return c.json({
      success: true,
      message: "Successfully fetched parking spaces",
      data: { parkingLot: requestedParkingLot, spaces: updatedSpaces },
    });
  }
);

router.post(
  "/new",
  authenticateAdmin,
  validator("json", AddParkingLotSchema),
  async (c) => {
    const { name, address, location } = c.req.valid("json");

    const [newParkingLot] = await db
      .insert(parkingLot)
      .values({ name, address, location })
      .returning();

    return c.json({
      success: true,
      message: "Successfully created new parking lot",
      data: { parkingLot: newParkingLot },
    });
  }
);

router.post(
  "/:parkingLotId/space",
  authenticateAdmin,
  validator("param", AddParkingSpaceParamSchema),
  validator("json", AddParkingSpaceBodySchema),
  async (c) => {
    const { parkingLotId } = c.req.valid("param");
    const { row, column } = c.req.valid("json");

    const [requestedParkingLot] = await db
      .select()
      .from(parkingLot)
      .where(eq(parkingLot.id, parkingLotId));

    if (!requestedParkingLot) {
      return c.json({
        success: false,
        error: "Parking lot not found",
      });
    }

    const [updatedParkingSpace, updatedParkingLot] = await db.transaction(
      async (trx) => {
        const [updatedParkingSpace] = await trx
          .insert(parkingSpace)
          .values({ type: "standard", parkingLotId, row, column })
          .returning();

        const [updatedParkingLot] = await trx
          .update(parkingLot)
          .set({
            capacity: sql`${parkingLot.capacity} + 1`,
          })
          .where(eq(parkingLot.id, parkingLotId))
          .returning();

        return [updatedParkingSpace, updatedParkingLot];
      }
    );

    return c.json({
      success: true,
      message: "Successfully created new parking space",
      data: { parkingLot: updatedParkingLot, space: updatedParkingSpace },
    });
  }
);

router.put(
  "/:parkingLotId",
  authenticateAdmin,
  validator("param", UpdateParkingLotParamSchema),
  validator("json", UpdateParkingLotBodySchema),
  async (c) => {
    const { parkingLotId } = c.req.valid("param");
    const { name, address } = c.req.valid("json");

    const [requestedParkingLot] = await db
      .select()
      .from(parkingLot)
      .where(eq(parkingLot.id, parkingLotId));
    if (!requestedParkingLot) {
      return c.json({
        success: false,
        error: "Parking lot not found",
      });
    }

    const [updatedParkingLot] = await db
      .update(parkingLot)
      .set({ name, address })
      .where(eq(parkingLot.id, parkingLotId))
      .returning();

    return c.json({
      success: true,
      message: "Successfully updated parking lot",
      data: { parkingLot: updatedParkingLot },
    });
  }
);

router.delete(
  "/:parkingLotId",
  authenticateAdmin,
  validator("param", DeleteParkingLotParamSchema),
  async (c) => {
    const { parkingLotId } = c.req.valid("param");

    const [requestedParkingLot] = await db
      .select()
      .from(parkingLot)
      .where(eq(parkingLot.id, parkingLotId));
    if (!requestedParkingLot) {
      return c.json({
        success: false,
        error: "Parking lot not found",
      });
    }

    await db.delete(parkingLot).where(eq(parkingLot.id, parkingLotId));

    return c.json({
      success: true,
      message: "Successfully deleted parking lot",
    });
  }
);

export default router;
