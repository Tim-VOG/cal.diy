import { createContainer } from "@calcom/features/di/di";
import type { Ne26OrderRepository } from "../repositories/Ne26OrderRepository";
import { moduleLoader as ne26OrderRepositoryModule } from "./Ne26OrderRepository.module";

const container = createContainer();

export function getNe26OrderRepository(): Ne26OrderRepository {
  ne26OrderRepositoryModule.loadModule(container);
  return container.get<Ne26OrderRepository>(ne26OrderRepositoryModule.token);
}
