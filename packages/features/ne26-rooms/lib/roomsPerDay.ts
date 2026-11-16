/**
 * Every sentence that states how many rooms one exhibitor may book per day.
 *
 * They live together because they used to be five separate hard-coded "one room
 * per day" strings — a landing paragraph, a bookings-page subtitle and caption,
 * a shortlist warning and a room-page refusal — written when the number could
 * not change. The number is now `Ne26RoomSettings.maxRoomsPerDayPerExhibitor`,
 * which an admin can raise mid-event, and five copies of a number are five
 * chances for the product to tell an exhibitor something the server will not
 * honour.
 *
 * Plain strings and no dependencies on purpose: this is imported by server
 * pages and by client components, so it must not drag anything into the browser
 * bundle.
 */

/** "one room" / "two rooms" — small numbers read better as words here. */
function roomCount(cap: number): string {
  const words: Record<number, string> = {
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
    9: "nine",
  };
  const word = words[cap] ?? String(cap);
  return cap === 1 ? `${word} room` : `${word} rooms`;
}

/**
 * The refusal, shown wherever the cap bites so it never reads as unexplained.
 *
 * The one-room wording is kept verbatim at a cap of 1: that is the sentence the
 * event opened with.
 */
export function tooManyRoomsPerDayMessage(cap: number): string {
  if (cap <= 1) {
    return "Each exhibitor can book one meeting room per day. You already have a room that day — choose another day, or cancel the one you have.";
  }
  return `Each exhibitor can book ${roomCount(cap)} per day. You already have that many on that day — choose another day, or cancel one you have.`;
}

/** The rule as a statement of fact, for a caption or a subtitle. */
export function roomsPerDayRule(cap: number): string {
  return cap <= 1
    ? "Each exhibitor can book one meeting room per day."
    : `Each exhibitor can book up to ${roomCount(cap)} per day.`;
}

/** The same, compressed to sit in a line of metadata. */
export function roomsPerDayShort(cap: number): string {
  return cap <= 1 ? "One room per day" : `Up to ${roomCount(cap)} per day`;
}

/** Inside the landing paragraph, which runs on into the slot lengths. */
export function roomsPerDayAllowance(cap: number): string {
  return cap <= 1
    ? "You can book a maximum of one room per day, for one time slot of either 1, 2, or 3 hours."
    : `You can book up to ${roomCount(cap)} per day, each for one time slot of either 1, 2, or 3 hours.`;
}

/** Told to a buyer standing on a day they have already filled. */
export function dayAlreadyFullNotice(cap: number): string {
  return cap <= 1
    ? "You already have a meeting room that day. Each exhibitor can book one room per day — pick another day, or cancel the room you have."
    : `You already have ${roomCount(cap)} that day, which is the most an exhibitor can book — pick another day, or cancel one of them.`;
}
