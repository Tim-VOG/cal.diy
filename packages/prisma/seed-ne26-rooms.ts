#!/usr/bin/env tsx

/**
 * NE26 Rooms seed — the 9 bookable meeting-room resources + add-on catalogue.
 * Idempotent: upserts by slug, safe to re-run. Run with:
 *   yarn workspace @calcom/prisma seed-ne26-rooms
 *
 * Prices (cents) and VAT rates (basis points) are PLACEHOLDERS — confirm the
 * real figures and Belgian VAT treatment (room rental vs catering) with VO
 * accounting before opening sales. See BRIEF_TECHNIQUE_NE26_ROOMS.md §2 & §4.5.
 */
import dotenv from "dotenv";
import path from "node:path";
import process from "node:process";

import { AddOnPriceType, ResourceCategory } from "@calcom/prisma/enums";

// Load the repo-root .env before importing the Prisma client, which reads
// DATABASE_URL at import time. The client is therefore imported dynamically
// inside main() (after this runs), unlike when launched via `prisma db seed`
// where the Prisma CLI injects the env for us.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// Uniform prices across all rooms for now (per-category differentiation is
// pending internal confirmation). Prices in cents.
const PRICES = {
  price1h: 35000, // 350.00 EUR
  price2h: 65000, // 650.00 EUR
  price3h: 90000, // 900.00 EUR
};

// Floor area in m², by room type.
const SURFACE_M2: Record<ResourceCategory, number> = {
  [ResourceCategory.PREMIUM]: 54, // Suite
  [ResourceCategory.INTERMEDIATE]: 36, // big meeting room
  [ResourceCategory.ENTRY]: 18, // small meeting room
};

const rooms: Array<{
  name: string;
  slug: string;
  category: ResourceCategory;
  capacity: number;
  description: string;
}> = [
  { name: "Suite 1", slug: "suite-1", category: ResourceCategory.PREMIUM, capacity: 24, description: "12 boardroom + 12 lounge" },
  { name: "Suite 2", slug: "suite-2", category: ResourceCategory.PREMIUM, capacity: 24, description: "12 boardroom + 12 lounge" },
  { name: "Large Room 1", slug: "large-room-1", category: ResourceCategory.INTERMEDIATE, capacity: 12, description: "Boardroom for 12" },
  { name: "Large Room 2", slug: "large-room-2", category: ResourceCategory.INTERMEDIATE, capacity: 12, description: "Boardroom for 12" },
  { name: "Small Room 1", slug: "small-room-1", category: ResourceCategory.ENTRY, capacity: 6, description: "Meeting room for 6" },
  { name: "Small Room 2", slug: "small-room-2", category: ResourceCategory.ENTRY, capacity: 6, description: "Meeting room for 6" },
  { name: "Small Room 3", slug: "small-room-3", category: ResourceCategory.ENTRY, capacity: 6, description: "Meeting room for 6" },
  { name: "Small Room 4", slug: "small-room-4", category: ResourceCategory.ENTRY, capacity: 6, description: "Meeting room for 6" },
  { name: "Small Room 5", slug: "small-room-5", category: ResourceCategory.ENTRY, capacity: 6, description: "Meeting room for 6" },
];

const addOns: Array<{
  name: string;
  slug: string;
  description: string;
  price: number;
  priceType: AddOnPriceType;
  vatRate: number;
  /** Minutes from event-local midnight; omitted means available all day. */
  availableFromMinute?: number;
  availableToMinute?: number;
}> = [
  // Catering is billed per cover; Belgian catering VAT often differs from room rental (placeholder 12%).
  // The catering catalogue as the team settled it. Prices are per person, excl.
  // VAT, in cents. Only lunch has agreed serving hours (11:00-14:00 = 660-840);
  // breakfast and dessert are left open until the team decides, and every field
  // here is editable in the admin afterwards.
  { name: "Breakfast", slug: "catering-breakfast", description: "Start the day with a light breakfast selection:\n- Croissant sandwich with smoked turkey and cheese\n- Dill and cheese pastry\n- Fruit, granola and yogurt cup\nPer person, excl. VAT and beverages. Ordered for everyone in the room.", price: 1900, priceType: AddOnPriceType.PER_PERSON, vatRate: 1200 },
  { name: "Lunch", slug: "catering-lunch", description: "A light and satisfying lunch selection:\n- Caprese ciabatta with mozzarella, tomato and pesto\n- Grilled chicken wrap\n- Brownie\n- Carrot muffin\nPer person, excl. VAT and beverages. Ordered for everyone in the room.", price: 3300, priceType: AddOnPriceType.PER_PERSON, vatRate: 1200, availableFromMinute: 660, availableToMinute: 840 },
  { name: "Lunch (Vegetarian & Halal)", slug: "catering-lunch-veg-halal", description: "A vegetarian and halal lunch selection:\n- Grilled vegetable sandwich\n- Wrap with seasonal greens, cherry tomatoes, hummus and falafel\n- Brownie\n- Carrot muffin\nPer person, excl. VAT and beverages. Ordered for everyone in the room.", price: 3300, priceType: AddOnPriceType.PER_PERSON, vatRate: 1200, availableFromMinute: 660, availableToMinute: 840 },
  { name: "Dessert (Late Afternoon)", slug: "catering-dessert", description: "A sweet afternoon selection:\n- Mini chocolate mousse cup\n- Cinnamon cookie with apple filling\n- Chocolate chip cookie\n- Turkish-style pistachio baklava\nPer person, excl. VAT and beverages. Ordered for everyone in the room.", price: 2000, priceType: AddOnPriceType.PER_PERSON, vatRate: 1200 },
  { name: "Non-Alcoholic Beverages", slug: "catering-beverages", description: "A selection of chilled non-alcoholic beverages:\n- Soft drinks: Coca-Cola, Coca-Cola Zero, Sprite, Fanta and iced tea\n- Bottled sparkling and mineral waters (0.33 L)\nPer person, excl. VAT. Ordered for everyone in the room. Hot beverages are not available in the meeting rooms.", price: 800, priceType: AddOnPriceType.PER_PERSON, vatRate: 1200 },
  { name: "AV Screen", slug: "av-screen", description: "Large display screen", price: 5000, priceType: AddOnPriceType.FLAT, vatRate: 2100 },
];

async function main(): Promise<void> {
  console.log("🌱 Seeding NE26 rooms & add-ons...");
  const { prisma } = await import("@calcom/prisma");

  for (const room of rooms) {
    const surface = SURFACE_M2[room.category];
    await prisma.resource.upsert({
      where: { slug: room.slug },
      // Prices, capacity and surface are deliberately NOT updated: they are set
      // by the team in the admin, and re-running this seed used to silently
      // revert real tariffs to the placeholders above. Only `create` seeds them.
      update: { name: room.name, category: room.category, description: room.description },
      create: { ...room, surface, ...PRICES },
    });
    console.log(
      `  🏛️  ${room.name} (${room.category}, cap ${room.capacity}, 1h ${PRICES.price1h / 100} / 2h ${PRICES.price2h / 100} / 3h ${PRICES.price3h / 100} EUR)`
    );
  }

  for (const addOn of addOns) {
    await prisma.addOn.upsert({
      where: { slug: addOn.slug },
      // Same reasoning: price and vatRate are admin-editable, so re-seeding must
      // not overwrite a corrected catering VAT rate or a negotiated price.
      update: { name: addOn.name, description: addOn.description, priceType: addOn.priceType },
      create: addOn,
    });
    console.log(`  ➕ ${addOn.name} (${addOn.priceType}, ${addOn.price / 100} EUR, VAT ${addOn.vatRate / 100}%)`);
  }

  console.log("✅ NE26 seed done.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
