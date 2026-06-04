import { createContainer } from "@calcom/features/di/di";
import type { RoomVatPreviewService } from "../services/RoomVatPreviewService";
import { moduleLoader as roomVatPreviewServiceModule } from "./RoomVatPreviewService.module";

const container = createContainer();

export function getRoomVatPreviewService(): RoomVatPreviewService {
  roomVatPreviewServiceModule.loadModule(container);
  return container.get<RoomVatPreviewService>(roomVatPreviewServiceModule.token);
}
