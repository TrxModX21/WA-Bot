import fs from "fs";
import os from "os";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from "baileys";
import qrcode from "qrcode-terminal";

const delay = (ms = 500) => new Promise((res) => setTimeout(res, ms));

function createProgressBar(percent, length = 10) {
  const filled = Math.round((percent / 100) * length);
  const empty = Math.max(0, length - filled);
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}D ${h}H ${m}M ${s}S`;
}

async function sendPerformanceDashboard(sock, from, msg) {
  const startTimer = Date.now();
  const tempMessage = await sock.sendMessage(from, { text: "_Testing speed..._" }, { quoted: msg });
  const responseTime = Date.now() - startTimer;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const ramPercent = (usedMem / totalMem) * 100;

  const heapInfo = process.memoryUsage();
  const heapPercent = (heapInfo.heapUsed / heapInfo.heapTotal) * 100;

  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  cpus.forEach(cpu => {
    for (let type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });
  const cpuPercent = 100 - ((totalIdle / totalTick) * 100);

  const dashboard = `🎯 *PERFORMANCE DASHBOARD*

📶 *RESPONSE TIME:* ${responseTime} ms
⏳ *UPTIME:* ${formatUptime(process.uptime())}

📊 *RESOURCE USAGE*
🟢 RAM: ${createProgressBar(ramPercent)} ${ramPercent.toFixed(1)}%
🟢 CPU: ${createProgressBar(cpuPercent)} ${cpuPercent.toFixed(1)}%
🟢 HEAP: ${createProgressBar(heapPercent)} ${heapPercent.toFixed(1)}%

💾 *MEMORY DETAILS*
├ Used: ${(usedMem / 1024 / 1024 / 1024).toFixed(2)} GB / ${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB
├ Free: ${(freeMem / 1024 / 1024 / 1024).toFixed(2)} GB
└ Heap: ${(heapInfo.heapUsed / 1024 / 1024).toFixed(2)} MB

👥 *CHAT STATISTICS*
├ Groups: 0
└ Personal: 0`;

  await delay(1000);
  await sock.sendMessage(from, {
    text: dashboard,
    edit: tempMessage.key,
  });
}

// Load data produk dari file JSON
const products = JSON.parse(fs.readFileSync("./products.json", "utf-8"));
const aliases = {
  gdrive: "drive",
  veo3: "veo",
  vnpro: "vn",
  "vn pro": "vn",
  "gamma ai": "gamma",
  prime: "amazon",
  appletv: "apple tv",
  "mango tv": "mango",
  applemusic: "apple music",
  mojo: "mojo pro",
  viki: "viki rakuten",
  "alight motion": "alightmotion",
  "we tv": "wetv",
};

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("session");

  const sock = makeWASocket({
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, null),
    },
    browser: ["Ubuntu", "Chrome", "20.0.04"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n=== Scan QR Code berikut di WhatsApp Web ===\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;

      console.log(
        "❌ Koneksi terputus. Reconnect:",
        shouldReconnect ? "Ya" : "Tidak",
      );

      if (shouldReconnect) startBot();
    } else if (connection === "open") {
      console.log("✅ Bot berhasil tersambung ke WhatsApp!");
    }
  });

  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith("@g.us");
    const sender = isGroup ? msg.key.participant : from;

    const text =
      msg.message.conversation || msg.message.extendedTextMessage?.text || "";

    if (!text.trim()) return;

    console.log(
      `📩 Pesan dari ${isGroup ? "grup" : "personal"} ${from}: ${text}`,
    );

    if (isGroup) {
      await handleGroupMessage(sock, from, sender, text, msg);
    } else {
      await handlePrivateMessage(sock, from, text, msg);
    }
  });

  sock.ev.on("group-participants.update", async (update) => {
    const { id, participants, action } = update;

    if (action === "add") {
      try {
        const mentions = participants;
        const mentionsText = participants.map((jid) => `@${jid.split("@")[0]}`).join(", ");

        const welcomeText = `Halo ${mentionsText} 👋\n\nSelamat datang di grup! Jangan lupa baca deskripsi grup dan patuhi aturan yang ada ya.\n\nKetik *!menu* untuk melihat daftar produk kami.`;

        const bannerPath = "./banners/welcome.jpeg";
        const bannerPathAlt = "./banners/welcome.jpg";
        
        await delay();
        
        if (fs.existsSync(bannerPath)) {
          await sock.sendMessage(id, {
            image: fs.readFileSync(bannerPath),
            caption: welcomeText,
            mentions: mentions,
          });
        } else if (fs.existsSync(bannerPathAlt)) {
          await sock.sendMessage(id, {
            image: fs.readFileSync(bannerPathAlt),
            caption: welcomeText,
            mentions: mentions,
          });
        } else {
          await sock.sendMessage(id, {
            text: welcomeText,
            mentions: mentions,
          });
        }
      } catch (error) {
        console.error("Gagal mengirim pesan welcome:", error);
      }
    }
  });
}

async function handleGroupMessage(sock, from, sender, text, msg) {
  const lower = text.toLowerCase();

  if (lower === "ping" || lower === ".ping" || lower === "!ping") {
    await sendPerformanceDashboard(sock, from, msg);
  } else if (lower === "!menu") {
    // const list = Object.keys(products)
    //   .map((key) => `• *${products[key].title}* — ketik *${key}*`)
    //   .join("\n");
    const list = Object.keys(products)
      .map((key) => `- ${products[key].title}`)
      .join("\n");

    await delay();
    await sock.sendMessage(from, {
      text: `📋 *Menu Produk Tersedia:*\n\n${list}\n\n*ketik nama produk\n(contoh: *youtube*) untuk lihat detailnya.\n\n*Untuk informasi pembayaran bisa ketik payment\n\n*Untuk pemesanan bisa langsung hubungi admin 082312300176\n(Admin Software Murah)`,
      quoted: {
        key: msg.key,
        message: msg.message,
      },
    });
  } else if (["pay", "payment", "bayar", "pembayaran"].includes(lower)) {
    const paymentText = `💳 Payment disini ya kak\n\n` +
      `BCA       : 8465868071\n` +
      `DANA    : 088232144813\n` +
      `OVO      : 088232144813\n` +
      `SPay      : 088232144813\n` +
      `A/N Danu Tri Wicaksono\n\n` +
      `-------------------------------------------------------\n\n` +
      `*Kirim Bukti Transfer bisa ke Grup ini, atau ke nomor\n` +
      `Admin 1 : 088232144813\n` +
      `Admin 2 : 082312300176`;

    await delay();

    // Kirim gambar QRIS jika file tersedia
    const qrisPath = "./banners/qris.jpeg";
    if (fs.existsSync(qrisPath)) {
      await sock.sendMessage(from, {
        image: fs.readFileSync(qrisPath),
        caption: paymentText,
        quoted: {
          key: msg.key,
          message: msg.message,
        },
      });
    } else {
      await sock.sendMessage(from, {
        text: paymentText,
        quoted: {
          key: msg.key,
          message: msg.message,
        },
      });
    }
  } else if (products[lower]) {
    const p = products[lower];
    let plans = "";

    if (p.is_ready === false) {
      await delay();
      return sock.sendMessage(from, {
        text: `${p.title}\nKosong ❌`,
        quoted: {
          key: msg.key,
          message: msg.message,
        },
      });
    }

    if (
      lower === "chatgpt" ||
      lower === "we tv" ||
      lower === "wetv" ||
      lower === "vidio" ||
      lower === "spotify" ||
      lower === "capcut"
    ) {
      const sharingPlans = p.plans
        .filter((plan) => plan.type === "sharing")
        .map((plan) => `- ${plan.duration} : *${plan.price}*`)
        .join("\n");

      const privatePlans = p.plans
        .filter((plan) => plan.type === "private")
        .map((plan) => `- ${plan.duration} : *${plan.price}*`)
        .join("\n");

      const privateGaransi = p.plans
        .filter((plan) => plan.type === "private-full")
        .map((plan) => `- ${plan.duration} : *${plan.price}*`)
        .join("\n");

      const privateNonGaransi = p.plans
        .filter((plan) => plan.type === "private-non-garansi")
        .map((plan) => `- ${plan.duration} : *${plan.price}*`)
        .join("\n");

      if (lower === "vidio") {
        plans = `Paket Sharing:\n${sharingPlans}\n\nPaket Private:\n${privatePlans}\n\n*Tonton tanpa iklan, kualitas HD, dan legal resmi dari Vidio!`;
      } else if (lower === "chatgpt") {
        plans = `Private Garansi Full\n${privateGaransi}\n\nPrivate Non Garansi\n${privateNonGaransi}`;
      } else if (lower === "spotify") {
        plans = `Private Garansi Full\n${privateGaransi}\n\nPrivate Non Garansi\n${privateNonGaransi}`;
      } else {
        plans = `Sharing\n${sharingPlans}\n\nPrivate\n${privatePlans}`;
      }
    } else if (p.plans && Array.isArray(p.plans)) {
      plans = p.plans
        .map((plan) => {
          if (plan.details && Array.isArray(plan.details)) {
            // format untuk TikTok dan netflix dan Netflix
            if (plan.is_ready === false) {
              return `*${plan.type}*\n(kosong) ❌`;
            }

            return `*${plan.type}*\n${plan.details
              .map((d) => `- ${d}`)
              .join("\n")}`;
          } else if (plan.duration && plan.price && !plan.isPromo) {
            // format umum
            if (plan.type && plan.duration && plan.price) {
              return `\n${plan.type}\n   - ${plan.duration} : *${plan.price}*`;
            } else {
              return `- ${plan.duration} : *${plan.price}*`;
            }
          } else if (plan.type && plan.price) {
            // format seperti CorelDraw / Vidio
            return `- ${plan.type} : *${plan.price}*`;
          } else if (plan.isPromo && plan.isPromo === true) {
            return `\nPROMO\n- ${plan.duration} : *${plan.price}*`;
          } else if (plan.custom) {
            return `- ${plan.custom}`;
          } else {
            return ""; // fallback
          }
        })
        .join("\n");
    }
    const notes = p.notes.map((n) => `• ${n}`).join("\n");
    const notesAddition = p.notesAddition ? `\n*${p.notesAddition}` : "";
    const extendNotes = p.extended_notes
      ? "\nNote:\n" + p.extended_notes.map((en) => `*${en}`).join("\n")
      : "";

    const featuresTitle = p.features_title ? `\n\n${p.features_title}` : "";
    let features = "";
    if (p.features) {
      features = p.features.map((f) => `+ ${f}`).join("\n");
    }

    let description = "";
    if (p.description) {
      description = `${p.description}\n\n`;
    }

    let forChatGpt = "";
    if (lower === "chatgpt") {
      forChatGpt =
        "\nCek perbedaannya Go, Plus, Business, dan Pro disini : https://chatgpt.com/id-ID/pricing/";
    }
    const footer = p.footer ? `\n${p.footer}` : "";

    await delay();
    await sock.sendMessage(from, {
      text: `${p.title}\n\n${description}${plans}\n\nSyarat & Ketentuan:\n${notes}${featuresTitle}\n${features}${notesAddition}${extendNotes}${forChatGpt}${footer}`,
      quoted: {
        key: msg.key,
        message: msg.message,
      },
    });
  } else {
    const key = aliases[lower] || lower;
    const p = products[key];
    if (p) {
      if (p.is_ready === false) {
        await delay();
        return sock.sendMessage(from, {
          text: `${p.title}\nKosong ❌`,
          quoted: {
            key: msg.key,
            message: msg.message,
          },
        });
      }

      let plans = "";
      if (
        lower === "chatgpt" ||
        lower === "we tv" ||
        lower === "wetv" ||
        lower === "vidio" ||
        lower === "spotify" ||
        lower === "capcut"
      ) {
        const sharingPlans = p.plans
          .filter((plan) => plan.type === "sharing")
          .map((plan) => `- ${plan.duration} : *${plan.price}*`)
          .join("\n");

        const privatePlans = p.plans
          .filter((plan) => plan.type === "private")
          .map((plan) => `- ${plan.duration} : *${plan.price}*`)
          .join("\n");

        const privateGaransi = p.plans
          .filter((plan) => plan.type === "private-full")
          .map((plan) => `- ${plan.duration} : *${plan.price}*`)
          .join("\n");

        const privateNonGaransi = p.plans
          .filter((plan) => plan.type === "private-non-garansi")
          .map((plan) => `- ${plan.duration} : *${plan.price}*`)
          .join("\n");

        if (lower === "vidio") {
          plans = `Paket Sharing:\n${sharingPlans}\n\nPaket Private:\n${privatePlans}\n\n*Tonton tanpa iklan, kualitas HD, dan legal resmi dari Vidio!`;
        } else if (lower === "chatgpt") {
          plans = `Private Garansi Full\n${privateGaransi}\n\nPrivate Non Garansi\n${privateNonGaransi}`;
        } else if (lower === "spotify") {
          plans = `Private Garansi Full\n${privateGaransi}\n\nPrivate Non Garansi\n${privateNonGaransi}`;
        } else {
          plans = `Sharing\n${sharingPlans}\n\nPrivate\n${privatePlans}`;
        }
      } else if (p.plans && Array.isArray(p.plans)) {
        plans = p.plans
          .map((plan) => {
            if (plan.details && Array.isArray(plan.details)) {
              // format untuk TikTok dan Netflix
              if (plan.is_ready === false) {
                return `*${plan.type}*\n(kosong) ❌`;
              }

              return `*${plan.type}*\n${plan.details
                .map((d) => `- ${d}`)
                .join("\n")}`;
            } else if (plan.duration && plan.price && !plan.isPromo) {
              // format umum
              if (plan.type && plan.duration && plan.price) {
                return `\n${plan.type}\n   - ${plan.duration} : *${plan.price}*`;
              } else {
                return `- ${plan.duration} : *${plan.price}*`;
              }
            } else if (plan.type && plan.price) {
              // format seperti CorelDraw / Vidio
              return `- ${plan.type} : *${plan.price}*`;
            } else if (plan.isPromo && plan.isPromo === true) {
              return `\nPROMO\n- ${plan.duration} : *${plan.price}*`;
            } else {
              return ""; // fallback
            }
          })
          .join("\n");
      }
      const notes = p.notes.map((n) => `• ${n}`).join("\n");
      const notesAddition = p.notesAddition ? `\n*${p.notesAddition}` : "";
      const extendNotes = p.extended_notes
        ? "\nNote:\n" + p.extended_notes.map((en) => `*${en}`).join("\n")
        : "";

      const featuresTitle = p.features_title ? `\n\n${p.features_title}` : "";
      let features = "";
      if (p.features) {
        features = p.features.map((f) => `+ ${f}`).join("\n");
      }

      let description = "";
      if (p.description) {
        description = `${p.description}\n\n`;
      }

      let forChatGpt = "";
      if (lower === "chatgpt") {
        forChatGpt =
          "\nCek perbedaannya Go, Plus, Business, dan Pro disini : https://chatgpt.com/id-ID/pricing/";
      }
      const footer = p.footer ? `\n${p.footer}` : "";

      //   const messageText = `${p.title}\n\n${description}${plans}\n\nSyarat & Ketentuan:\n${notes}${featuresTitle}\n${features}`;
      // await delay();
      // await sock.sendMessage(from, {
      //   image: p.banner ? fs.readFileSync(p.banner) : undefined,
      //   caption: messageText,
      //   quoted: {
      //     key: msg.key,
      //     message: msg.message,
      //   },
      // });

      await delay();
      await sock.sendMessage(from, {
        text: `${p.title}\n\n${description}${plans}\n\nSyarat & Ketentuan:\n${notes}${featuresTitle}\n${features}${notesAddition}${extendNotes}${forChatGpt}${footer}`,
        quoted: {
          key: msg.key,
          message: msg.message,
        },
      });
    }
  }
}

async function handlePrivateMessage(sock, from, text, msg) {
  const lower = text.toLowerCase();

  if (lower === "halo") {
    await delay();
    await sock.sendMessage(from, {
      text: "Hai 👋, ini bot otomatis! Ketik *!menu* untuk melihat daftar produk.",
      quoted: {
        key: msg.key,
        message: msg.message,
      },
    });
  } else if (lower === "!menu") {
    const list = Object.keys(products)
      .map((key) => `• ${products[key].title}`)
      .join("\n");

    await delay();
    await sock.sendMessage(from, {
      text: `📦 *Daftar Produk Kami:*\n\n${list}\n\nKetik nama produk (contoh: *youtube*) untuk lihat detailnya.\nUntuk pemesanan bisa langsung hubungi admin\n082312300176 (Admin Software Murah)`,
      quoted: {
        key: msg.key,
        message: msg.message,
      },
    });
  } else if (products[lower]) {
    const p = products[lower];
    let plans = "";
    if (p.plans && Array.isArray(p.plans)) {
      plans = p.plans
        .map((plan) => {
          if (plan.details && Array.isArray(plan.details)) {
            return `*${plan.type}*\n${plan.details
              .map((d) => `- ${d}`)
              .join("\n")}`;
          } else if (plan.duration && plan.price) {
            return `- ${plan.duration} : *${plan.price}*`;
          } else if (plan.type && plan.price) {
            return `- ${plan.type} : *${plan.price}*`;
          } else if (plan.custom) {
            return `- ${plan.custom}`;
          } else {
            return "";
          }
        })
        .join("\n");
    }
    const notes = p.notes.map((n) => `• ${n}`).join("\n");
    const footer = p.footer ? `\n${p.footer}` : "";

    await delay();
    await sock.sendMessage(from, {
      text: `${p.title}\n\n${p.description}\n\n${plans}\n\nSyarat & Ketentuan:\n${notes}${footer}`,
      quoted: {
        key: msg.key,
        message: msg.message,
      },
    });
  } else if (lower === "ping" || lower === ".ping" || lower === "!ping") {
    await sendPerformanceDashboard(sock, from, msg);
  }
}

startBot().catch((err) => console.error("Gagal menjalankan bot:", err));
