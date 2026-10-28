import { ensureDatabase } from "../config/databaseEnsure.js";
import { prisma } from "../services/database.js";
import { databaseError } from "../utils/dbError.js";
import { isValidId } from "../utils/isValidId.js";

export async function getTranscription(_request, response) {
  if (!ensureDatabase(response)) return;
  try {
    const transcriptions = await prisma.transcription.findMany({
      orderBy: { createdAt: "desc" },
    });
    response.json(transcriptions);
  } catch (error) {
    databaseError(response, error);
  }
}

export async function fetchTranscription(request, response) {
  const title =
    typeof request.body?.title === "string" ? request.body.title.trim() : "";
  const text =
    typeof request.body?.text === "string" ? request.body.text.trim() : "";

  if (!text || text.length > 100_000 || title.length > 200) {
    response.status(400).json({
      error:
        "Enter a transcript up to 100,000 characters and a title up to 200 characters.",
    });
    return;
  }
  if (!ensureDatabase(response)) return;

  try {
    const transcription = await prisma.transcription.create({
      data: {
        title: title || `Transcription ${new Date().toLocaleString()}`,
        text,
      },
    });
    response.status(201).json(transcription);
  } catch (error) {
    databaseError(response, error);
  }
}

export async function updateTranscription(request, response) {
  const { id } = request.params;
  const data = {};
  if (Object.hasOwn(request.body ?? {}, "title")) {
    if (
      typeof request.body.title !== "string" ||
      !request.body.title.trim() ||
      request.body.title.trim().length > 200
    ) {
      response
        .status(400)
        .json({ error: "Title must contain 1 to 200 characters." });
      return;
    }
    data.title = request.body.title.trim();
  }
  if (Object.hasOwn(request.body ?? {}, "text")) {
    if (
      typeof request.body.text !== "string" ||
      !request.body.text.trim() ||
      request.body.text.trim().length > 100_000
    ) {
      response
        .status(400)
        .json({ error: "Transcript must contain 1 to 100,000 characters." });
      return;
    }
    data.text = request.body.text.trim();
  }
  if (!Object.keys(data).length) {
    response
      .status(400)
      .json({ error: "Provide a title or transcript to update." });
    return;
  }
  if (!isValidId(id)) {
    response.status(400).json({ error: "Invalid transcription ID." });
    return;
  }
  if (!ensureDatabase(response)) return;

  try {
    const transcription = await prisma.transcription.update({
      where: { id },
      data,
    });
    response.json(transcription);
  } catch (error) {
    if (error?.code === "P2025") {
      response.status(404).json({ error: "Transcription not found." });
      return;
    }
    databaseError(response, error);
  }
}

export async function deleteTranscription(request, response) {
  const { id } = request.params;
  if (!isValidId(id)) {
    response.status(400).json({ error: "Invalid transcription ID." });
    return;
  }
  if (!ensureDatabase(response)) return;

  try {
    await prisma.transcription.delete({ where: { id } });
    response.status(204).end();
  } catch (error) {
    if (error?.code === "P2025") {
      response.status(404).json({ error: "Transcription not found." });
      return;
    }
    databaseError(response, error);
  }
}

export default {
  getTranscription,
  fetchTranscription,
  updateTranscription,
  deleteTranscription,
};
