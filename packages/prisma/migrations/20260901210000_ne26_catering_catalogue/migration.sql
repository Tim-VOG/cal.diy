-- NE26: the catering catalogue as the team settled it.
--
-- Prices are per person, excl. VAT, in cents, from the final price list. The
-- descriptions come from the caterer's own sheet so an exhibitor knows what
-- arrives; every field here stays editable in the admin afterwards.
--
-- Serving hours: only lunch has agreed hours (11:00-14:00 = 660-840). Breakfast
-- and dessert are deliberately left unrestricted rather than guessed — the team
-- sets them in the admin when they decide.

-- Lunch already exists; correct it rather than duplicating, so the bookings
-- already made keep pointing at the same product.
UPDATE "AddOn" SET
  "name" = 'Lunch',
  "price" = 3300,
  "vatRate" = 1200,
  "availableFromMinute" = 660,
  "availableToMinute" = 840,
  "description" = 'A light and satisfying lunch selection:
- Caprese ciabatta with mozzarella, tomato and pesto
- Grilled chicken wrap
- Brownie
- Carrot muffin
Per person, excl. VAT and beverages. Ordered for everyone in the room.'
WHERE "slug" = 'catering-lunch';

INSERT INTO "AddOn" ("name", "slug", "description", "price", "currency", "priceType", "vatRate", "isActive", "availableFromMinute", "availableToMinute")
VALUES
  ('Breakfast', 'catering-breakfast',
   'Start the day with a light breakfast selection:
- Croissant sandwich with smoked turkey and cheese
- Dill and cheese pastry
- Fruit, granola and yogurt cup
Per person, excl. VAT and beverages. Ordered for everyone in the room.',
   1900, 'EUR', 'PER_PERSON', 1200, true, NULL, NULL),

  ('Lunch (Vegetarian & Halal)', 'catering-lunch-veg-halal',
   'A vegetarian and halal lunch selection:
- Grilled vegetable sandwich
- Wrap with seasonal greens, cherry tomatoes, hummus and falafel
- Brownie
- Carrot muffin
Per person, excl. VAT and beverages. Ordered for everyone in the room.',
   3300, 'EUR', 'PER_PERSON', 1200, true, 660, 840),

  ('Dessert (Late Afternoon)', 'catering-dessert',
   'A sweet afternoon selection:
- Mini chocolate mousse cup
- Cinnamon cookie with apple filling
- Chocolate chip cookie
- Turkish-style pistachio baklava
Per person, excl. VAT and beverages. Ordered for everyone in the room.',
   2000, 'EUR', 'PER_PERSON', 1200, true, NULL, NULL),

  ('Non-Alcoholic Beverages', 'catering-beverages',
   'A selection of chilled non-alcoholic beverages:
- Soft drinks: Coca-Cola, Coca-Cola Zero, Sprite, Fanta and iced tea
- Bottled sparkling and mineral waters (0.33 L)
Per person, excl. VAT. Ordered for everyone in the room. Hot beverages are not available in the meeting rooms.',
   800, 'EUR', 'PER_PERSON', 1200, true, NULL, NULL)
ON CONFLICT ("slug") DO NOTHING;

-- The old hourly drinks line is superseded by the per-person beverages option.
-- Deactivated, not deleted: bookings already made reference it, and an admin
-- can bring it back in one click if that turns out to be wrong.
UPDATE "AddOn" SET "isActive" = false WHERE "slug" = 'drinks-service';
