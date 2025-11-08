// index.js — Final version (Pairing Code, Telegram Notify)
import fs from "fs-extra";
import { Telegraf } from "telegraf";
import {
  makeWASocket,
  useMultiFileAuthState,
  Browsers,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import * as dotenv from 'dotenv'
dotenv.config()

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

if (!BOT_TOKEN || !ADMIN_ID) {
  console.error("❌ TELEGRAM_BOT_TOKEN dan ADMIN_ID belum diatur di Secrets.");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const AUTH_DIR = "./session";

async function createSocket() {
  try {
    fs.ensureDirSync(AUTH_DIR);
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const sock = makeWASocket({
      auth: state,
      browser: Browsers.macOS("Chrome"),
      printQRInTerminal: false,
      // Konfigurasi tambahan untuk mengatasi masalah koneksi
      keepAliveIntervalMs: 10000, // Kirim pesan keep-alive setiap 10 detik
      mobile: false, // Set ke false jika berjalan di server
      connectTimeoutMs: 30000, // Timeout koneksi setelah 30 detik
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
          lastDisconnect?.error?.output?.statusCode !==
          DisconnectReason.loggedOut;

        if (shouldReconnect) {
          await bot.telegram.sendMessage(
            ADMIN_ID,
            "⚠️ Koneksi terputus. Mencoba menghubungkan kembali..."
          );
          // Coba reconnect setelah beberapa detik
          setTimeout(createSocket, 5000);
        } else {
          await bot.telegram.sendMessage(
            ADMIN_ID,
            "❌ Koneksi terputus dan tidak dapat dihubungkan kembali. Silakan pairing ulang."
          );
        }
      }
    });

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
  // Pastikan socket dibuat saat bot dimulai
  await createSocket();
});

bot.on("text", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID)
    return ctx.reply("❌ Kamu bukan admin.");

  const number = ctx.message.text.trim();
  if (!/^\d+$/.test(number))
    return ctx.reply("❌ Format nomor tidak valid. Contoh: 62812xxxxxxx");

  ctx.reply(`⏳ Membuat pairing code untuk nomor: ${number} ...`);

  try {
    const sock = await createSocket();
    if (!sock) {
      return ctx.reply("❌ Gagal membuat socket WhatsApp.");
    }
    const pairing = await sock.requestPairingCode(number);

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
      
