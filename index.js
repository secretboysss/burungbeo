// index.js — Final (Pairing Code + Telegram Notify, optimized for Railway)
import fs from "fs-extra";
import { Telegraf } from "telegraf";
import {
  makeWASocket,
  useMultiFileAuthState,
  Browsers,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import * as dotenv from "dotenv";
dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

if (!BOT_TOKEN || !ADMIN_ID) {
  console.error("❌ TELEGRAM_BOT_TOKEN dan ADMIN_ID belum diatur di Secrets/Env.");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const AUTH_DIR = "./session";
fs.ensureDirSync(AUTH_DIR);

let globalSock = null; // supaya tidak bikin socket baru terus

async function createSocket() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const sock = makeWASocket({
      auth: state,
      browser: Browsers.macOS("Chrome"),
      printQRInTerminal: false,
      keepAliveIntervalMs: 10000,
      connectTimeoutMs: 30000,
      mobile: false,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === "open") {
        await bot.telegram.sendMessage(
          ADMIN_ID,
          "✅ WhatsApp berhasil terhubung via Pairing Code!"
        );
      } else if (connection === "close") {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect) {
          await bot.telegram.sendMessage(
            ADMIN_ID,
            "⚠️ Koneksi terputus. Mencoba reconnect..."
          );
          setTimeout(createSocket, 5000);
        } else {
          await bot.telegram.sendMessage(
            ADMIN_ID,
            "❌ Koneksi terputus permanen. Silakan pairing ulang."
          );
        }
      }
    });

    globalSock = sock;
    return sock;
  } catch (error) {
    console.error("Error creating socket:", error);
    await bot.telegram.sendMessage(
      ADMIN_ID,
      `❌ Gagal membuat socket: ${error.message}`
    );
    return null;
  }
}

bot.start(async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID)
    return ctx.reply("❌ Kamu bukan admin yang diizinkan.");
  ctx.reply("✅ Kirim nomor untuk pairing (contoh: 62812xxxxxxx)");
  if (!globalSock) await createSocket();
});

bot.on("text", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID)
    return ctx.reply("❌ Kamu bukan admin.");

  const number = ctx.message.text.trim();
  if (!/^\d+$/.test(number))
    return ctx.reply("❌ Format nomor tidak valid. Contoh: 62812xxxxxxx");

  ctx.reply(`⏳ Membuat pairing code untuk nomor: ${number} ...`);

  try {
    if (!globalSock) globalSock = await createSocket();
    if (!globalSock)
      return ctx.reply("❌ Gagal membuat koneksi WhatsApp.");

    const pairing = await globalSock.requestPairingCode(number);

    if (pairing) {
      await bot.telegram.sendMessage(
        ADMIN_ID,
        `🔑 Pairing code untuk *${number}*:\n\n\`\`\`${pairing}\`\`\`\n\n📱 Buka WhatsApp > Linked Devices > Link with phone number.`
      );
    } else {
      ctx.reply("❌ Gagal mendapatkan pairing code (respon kosong).");
    }
  } catch (err) {
    console.error("Error pairing:", err);
    ctx.reply("❌ Gagal membuat pairing code.\n" + err.message);
  }
});

bot.launch();
console.log("🤖 Bot Telegram aktif dan siap menerima nomor pairing...");
