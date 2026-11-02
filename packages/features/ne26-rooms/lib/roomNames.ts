/**
 * What to call a room in front of someone standing in the building.
 *
 * A room is sold as "Large Room 1" and its door says "Meeting 3". Both names
 * are right, for different jobs: the first is what the exhibitor bought and
 * what the invoice must keep saying, the second is the only one that helps
 * anybody find the room. The welcome desk needs the door name, because its
 * whole job is pointing people at doors.
 *
 * So neither name replaces the other. These are the two ways of putting them
 * together — one for a screen with room for a second line, one for a cell in a
 * spreadsheet — kept here so the desk, the planning board and the exports
 * cannot drift apart.
 */

export interface NamedRoom {
  name: string;
  /** The name on the door, when it differs. Null when the door says `name`. */
  venueName?: string | null;
}

function door(room: NamedRoom): string | null {
  const venue = room.venueName?.trim();
  return venue && venue !== room.name ? venue : null;
}

/** What to show first: the door name when there is one, the sold name otherwise. */
export function roomDoorName(room: NamedRoom): string {
  return door(room) ?? room.name;
}

/**
 * The quieter second line, or null when there is nothing to add.
 *
 * It is the name the room was sold under, which is what an exhibitor will read
 * off their confirmation when they say "I booked Large Room 1".
 */
export function roomSoldName(room: NamedRoom): string | null {
  return door(room) ? room.name : null;
}

/** Both names on one line, for a spreadsheet cell: "Meeting 3 (Large Room 1)". */
export function roomFullLabel(room: NamedRoom): string {
  const alias = roomSoldName(room);
  return alias ? `${roomDoorName(room)} (${alias})` : room.name;
}

/**
 * Order rooms the way the desk reads them: by the name on the door.
 *
 * The rooms are stored in the order they were created, which is grouped by
 * size — and the venue's numbering deliberately is not (Meeting 3 and 4 are
 * the large rooms, between the small ones). Left alone, the planning board
 * would list the doors as 3, 4, 1, 2, 5, 6, 7, which is unreadable for
 * somebody scanning it for a door number. Numeric-aware, so Meeting 10 would
 * follow Meeting 9 rather than Meeting 1.
 */
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function byDoorName(a: NamedRoom, b: NamedRoom): number {
  return collator.compare(roomDoorName(a), roomDoorName(b));
}
