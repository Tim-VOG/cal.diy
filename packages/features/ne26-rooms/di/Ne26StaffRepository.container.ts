import { createContainer } from "@calcom/features/di/di";
import type { Ne26StaffRepository } from "../repositories/Ne26StaffRepository";
import { moduleLoader as ne26StaffRepositoryModule } from "./Ne26StaffRepository.module";

const container = createContainer();

export function getNe26StaffRepository(): Ne26StaffRepository {
  ne26StaffRepositoryModule.loadModule(container);
  return container.get<Ne26StaffRepository>(ne26StaffRepositoryModule.token);
}
