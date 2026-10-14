import { prisma } from "@calcom/prisma";
import { Ne26AccountRepository } from "../repositories/Ne26AccountRepository";

let instance: Ne26AccountRepository | null = null;

export function getNe26AccountRepository(): Ne26AccountRepository {
  instance ??= new Ne26AccountRepository(prisma);
  return instance;
}
