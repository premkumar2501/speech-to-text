const databaseUnavailableMessage =
  "Transcription history is unavailable. Check DATABASE_URL and apply the database migration.";

export function databaseError(response, error) {
  console.error("Transcription database error:", error);
  response.status(503).json({ error: databaseUnavailableMessage });
}