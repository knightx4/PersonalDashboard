/**
 * Pairing the slots a message describes with the rounds already booked.
 *
 * A superday arrives as two different kinds of mail. Four calendar invites
 * book the four slots, and a covering note lists the same four times against
 * the people who take them. Only the invites reached the interviews table, so
 * the panel the covering note named had nothing to attach to and was dropped.
 *
 * Joining them on the instant is the obvious rule and is not quite enough: the
 * invites carry a Windows TZID (`Eastern Standard Time`) that Intl does not
 * know, so the whole schedule is stored some hours away from where the body
 * says it is. That error is the same for every slot in the mail, which is what
 * makes the second rule sound -- a set of times whose gaps match exactly, on
 * the same day, is the same schedule written twice.
 */

export interface Slot {
  /** ISO instant the message gave for this slot. */
  at: string;
}

export interface BookedInterview {
  id: string;
  /** ISO instant the interview is stored at. */
  scheduledAt: string;
}

export interface SlotPairing {
  slotIndex: number;
  interviewId: string;
}

/**
 * How far a whole schedule may be shifted and still be the same schedule.
 *
 * Zone errors top out around fourteen hours. A day is comfortably past every
 * one of them and comfortably short of pairing a mail with a round in a
 * different week.
 */
const MAX_SHIFT_MS = 24 * 60 * 60 * 1000;

function instant(value: string): number {
  return new Date(value).getTime();
}

/**
 * Pair each slot with the interview it refers to, or with nothing.
 *
 * Exact instants win. Where they do not resolve every slot and the two lists
 * are the same length, the gaps decide: identical gaps within a day of each
 * other are one schedule, and they pair off in time order.
 */
export function pairSlots(
  slots: readonly Slot[],
  interviews: readonly BookedInterview[],
): SlotPairing[] {
  const usable = slots
    .map((slot, slotIndex) => ({ slotIndex, at: instant(slot.at) }))
    .filter((slot) => Number.isFinite(slot.at));
  const booked = interviews
    .map((interview) => ({ id: interview.id, at: instant(interview.scheduledAt) }))
    .filter((interview) => Number.isFinite(interview.at));

  if (!usable.length || !booked.length) return [];

  const taken = new Set<string>();
  const pairs: SlotPairing[] = [];

  for (const slot of usable) {
    const hit = booked.find((interview) => interview.at === slot.at && !taken.has(interview.id));
    if (!hit) continue;
    taken.add(hit.id);
    pairs.push({ slotIndex: slot.slotIndex, interviewId: hit.id });
  }

  if (pairs.length === usable.length) return pairs;
  if (usable.length !== booked.length) return pairs;

  // The same schedule in a zone one of the two got wrong: same count, same
  // gaps, within a day of each other.
  const bySlot = [...usable].sort((a, b) => a.at - b.at);
  const byBooked = [...booked].sort((a, b) => a.at - b.at);
  const shift = byBooked[0].at - bySlot[0].at;
  if (Math.abs(shift) > MAX_SHIFT_MS) return pairs;

  const sameShape = bySlot.every((slot, index) => byBooked[index].at - slot.at === shift);
  if (!sameShape) return pairs;

  return bySlot.map((slot, index) => ({
    slotIndex: slot.slotIndex,
    interviewId: byBooked[index].id,
  }));
}
