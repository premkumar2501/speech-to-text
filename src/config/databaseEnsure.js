import { prisma } from "../services/database.js";
import { databaseError } from "../utils/dbError.js";

export function ensureDatabase(response) {
  if (prisma) return true;
  databaseError(response, new Error("DATABASE_URL is not configured."));
  return false;
}
