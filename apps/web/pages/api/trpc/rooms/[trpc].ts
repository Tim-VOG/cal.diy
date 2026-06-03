import { createNextApiHandler } from "@calcom/trpc/server/createNextApiHandler";
import { roomsRouter } from "@calcom/trpc/server/routers/viewer/rooms/_router";

export default createNextApiHandler(roomsRouter);
