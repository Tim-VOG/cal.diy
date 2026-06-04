import { createContainer } from "@calcom/features/di/di";
import type { Ne26BillingProfileRepository } from "../repositories/Ne26BillingProfileRepository";
import { moduleLoader as ne26BillingProfileRepositoryModule } from "./Ne26BillingProfileRepository.module";

const container = createContainer();

export function getNe26BillingProfileRepository(): Ne26BillingProfileRepository {
  ne26BillingProfileRepositoryModule.loadModule(container);
  return container.get<Ne26BillingProfileRepository>(ne26BillingProfileRepositoryModule.token);
}
