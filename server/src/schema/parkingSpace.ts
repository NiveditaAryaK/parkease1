import {
  pgTable,
  uuid,
  timestamp,
  boolean,
  integer,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { parkingLot } from "./parkingLot";
import { z } from "zod";

export const parkingSpace = pgTable(
  "parking_space",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parkingLotId: uuid("parking_lot_id")
      .notNull()
      .references(() => parkingLot.id),
    row: integer("row").notNull(),
    column: integer("column").notNull(),
    isAvailable: boolean("is_available").default(true),
    createdAt: timestamp("created_at").defaultNow(),
    type: varchar("type", { length: 64 }).notNull(),
  },
  (t) => ({ ak: unique().on(t.parkingLotId, t.row, t.column) })
);

export const GetParkingSpacesParamSchema = z.object({
  parkingLotId: z.string({ message: "Parking Lot ID is a required field" }),
});

export const AddParkingSpaceParamSchema = z.object({
  parkingLotId: z.string({ message: "Parking Lot ID is a required field" }),
});

export const AddParkingSpaceBodySchema = z.object({
  row: z.number({ message: "Row is a required field" }),
  column: z.number({ message: "Column is a required field" }),
  type: z.string({ message: "Type is a required field" }),
});

export const ReserveParkingSpaceParamSchema = z.object({
  parkingSpaceId: z.string({ message: "Parking Space ID is a required field" }),
});
