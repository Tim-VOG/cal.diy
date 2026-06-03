import authedProcedure from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";
import { ZCreateBookingInputSchema } from "./createBooking.schema";

export const roomsRouter = router({
  // Create a PENDING NE26 room booking with a temporary hold. Requires login;
  // the booker identity comes from the session. Payment (Stripe) is a later step.
  createBooking: authedProcedure.input(ZCreateBookingInputSchema).mutation(async ({ ctx, input }) => {
    const { getResourceBookingService } = await import(
      "@calcom/features/ne26-rooms/di/ResourceBookingService.container"
    );
    return getResourceBookingService().createBooking({
      slug: input.slug,
      startUtc: new Date(input.startUtc),
      durationHours: input.durationHours,
      booker: { userId: ctx.user.id, email: ctx.user.email, name: ctx.user.name ?? ctx.user.email },
      addOns: input.addOns,
    });
  }),
});
