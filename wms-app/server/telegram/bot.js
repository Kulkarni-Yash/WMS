import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import FormData from "form-data";
import fetch from "node-fetch";
import TelegramBot from "node-telegram-bot-api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, "config.json");
const INGEST_URL = process.env.INGEST_URL || "https://wms-app-orpin.vercel.app/api/imports";

let bot = null;

export async function loadConfig() {
  const raw = await fs.readFile(CONFIG_FILE, "utf8");
  const cfg = JSON.parse(raw);
  return {
    token: process.env.TELEGRAM_BOT_TOKEN || cfg.token || "",
    allowedUserIds: Array.isArray(cfg.allowedUserIds) ? cfg.allowedUserIds : [],
  };
}

export async function pushPdf({ buffer, fileName, sender, source, mime }) {
  const form = new FormData();
  form.append("file", buffer, {
    filename: fileName || "telegram-document.pdf",
    contentType: mime || "application/pdf",
  });
  if (sender) form.append("sender", sender);
  if (source) form.append("source", source);

  const res = await fetch(INGEST_URL, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `OCR server responded ${res.status}`);
  }
  return data;
}

export async function runBot() {
  const cfg = await loadConfig();
  if (!cfg.token) {
    console.log("[telegram] no token in config.json — bot disabled.");
    return;
  }

  bot = new TelegramBot(cfg.token, { polling: true });
  console.log("[telegram] bot started — listening for documents...");

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const name = msg.from?.first_name || "there";

    if (cfg.allowedUserIds.length > 0 && !cfg.allowedUserIds.includes(userId)) {
      bot.sendMessage(chatId, "Access denied. Contact your warehouse admin.");
      return;
    }

    bot.sendMessage(
      chatId,
      `Hi ${name}! Send me a PDF or image of a warehouse document and I'll process it for you.\n\nSupported formats: PDF, PNG, JPEG`
    );
  });

  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(
      chatId,
      "Send any PDF or image document. I'll run OCR and add it to the import queue for approval."
    );
  });

  bot.on("document", async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const doc = msg.document;
    const sender = `${msg.from?.first_name || ""} ${msg.from?.last_name || ""} (@${msg.from?.username || "unknown"})`.trim();

    if (cfg.allowedUserIds.length > 0 && !cfg.allowedUserIds.includes(userId)) {
      bot.sendMessage(chatId, "Access denied.");
      return;
    }

    const mime = doc.mime_type || "";
    const accepted = ["application/pdf", "image/png", "image/jpeg"];
    if (!accepted.includes(mime)) {
      bot.sendMessage(chatId, `Unsupported file type: ${mime}. Please send a PDF, PNG, or JPEG.`);
      return;
    }

    const statusMsg = await bot.sendMessage(chatId, "Processing document...", { parse_mode: "Markdown" });

    try {
      const fileLink = await bot.getFileLink(doc.file_id);
      const response = await fetch(fileLink);
      if (!response.ok) throw new Error("Failed to download file from Telegram");
      const buffer = Buffer.from(await response.arrayBuffer());

      const item = await pushPdf({
        buffer,
        fileName: doc.file_name || "document.pdf",
        sender,
        source: "telegram",
      });

      await bot.editMessageText(
        `Document received and queued for review.\n\n**ID:** ${item.id}\n**File:** ${item.fileName}\n\nCheck the Import page in your WMS dashboard.`,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: "Markdown",
        }
      );
    } catch (err) {
      console.error("[telegram] error processing document:", err.message);
      await bot.editMessageText(`Error processing document: ${err.message}`, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
      });
    }
  });

  bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const sender = `${msg.from?.first_name || ""} ${msg.from?.last_name || ""} (@${msg.from?.username || "unknown"})`.trim();

    if (cfg.allowedUserIds.length > 0 && !cfg.allowedUserIds.includes(userId)) {
      bot.sendMessage(chatId, "Access denied.");
      return;
    }

    const statusMsg = await bot.sendMessage(chatId, "Processing photo...", { parse_mode: "Markdown" });

    try {
      const largest = msg.photo[msg.photo.length - 1];
      const fileLink = await bot.getFileLink(largest.file_id);
      const response = await fetch(fileLink);
      if (!response.ok) throw new Error("Failed to download photo from Telegram");
      const buffer = Buffer.from(await response.arrayBuffer());

      const item = await pushPdf({
        buffer,
        fileName: `photo-${Date.now()}.jpg`,
        sender,
        source: "telegram",
        mime: "image/jpeg",
      });

      await bot.editMessageText(
        `Photo received and queued for review.\n\n**ID:** ${item.id}\n**File:** ${item.fileName}\n\nCheck the Import page in your WMS dashboard.`,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: "Markdown",
        }
      );
    } catch (err) {
      console.error("[telegram] error processing photo:", err.message);
      await bot.editMessageText(`Error processing photo: ${err.message}`, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
      });
    }
  });

  bot.on("polling_error", (err) => {
    console.error("[telegram] polling error:", err.message);
    // node-telegram-bot-api stops polling permanently on EFATAL; bring it back
    // with a short backoff so transient network failures self-resolve.
    if (err.message && err.message.includes("EFATAL")) {
      console.error("[telegram] EFATAL - restarting polling in 5s...");
      setTimeout(() => {
        bot.startPolling({ restart: true }).catch((e) => {
          console.error("[telegram] polling restart failed:", e.message);
        });
      }, 5000);
    }
  });
}

export async function stopBot() {
  if (bot) {
    await bot.stopPolling();
    bot = null;
    console.log("[telegram] bot stopped.");
  }
}
