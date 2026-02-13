import fs from "fs";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
} from "baileys";
import qrcode from "qrcode-terminal";

const delay = (ms = 3000) => new Promise((res) => setTimeout(res, ms));

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
    browser: ["Bot WhatsApp", "Chrome", "1.0.0"],
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
        shouldReconnect ? "Ya" : "Tidak"
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
      `📩 Pesan dari ${isGroup ? "grup" : "personal"} ${from}: ${text}`
    );

    if (isGroup) {
      await handleGroupMessage(sock, from, sender, text, msg);
    } else {
      await handlePrivateMessage(sock, from, text, msg);
    }
  });
}

async function handleGroupMessage(sock, from, sender, text, msg) {
  const lower = text.toLowerCase();

  if (lower === "!menu") {
    // const list = Object.keys(products)
    //   .map((key) => `• *${products[key].title}* — ketik *${key}*`)
    //   .join("\n");
    const list = Object.keys(products)
      .map((key) => `- ${products[key].title}`)
      .join("\n");

    await delay();
    await sock.sendMessage(from, {
      text: `📋 *Menu Produk Tersedia:*\n\n${list}\n\n*ketik nama produk\n(contoh: *youtube*) untuk lihat detailnya.\n\n*Untuk pemesanan bisa langsung hubungi admin 082312300176\n(Admin Software Murah)`,
      quoted: {
        key: msg.key,
        message: msg.message,
      },
    });
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
      lower === "vidio"
    ) {
      const sharingPlans = p.plans
        .filter((plan) => plan.type === "sharing")
        .map((plan) => `- ${plan.duration} : *${plan.price}*`)
        .join("\n");

      const privatePlans = p.plans
        .filter((plan) => plan.type === "private")
        .map((plan) => `- ${plan.duration} : *${plan.price}*`)
        .join("\n");

      if (lower === "vidio") {
        plans = `Paket Sharing:\n${sharingPlans}\n\nPaket Private:\n${privatePlans}\n\n*Tonton tanpa iklan, kualitas HD, dan legal resmi dari Vidio!`;
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
              return `\n${plan.type}\n   - *${plan.price}*`;
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

    const featuresTitle = p.features_title ? `\n\n${p.features_title}` : "";
    let features = "";
    if (p.features) {
      features = p.features.map((f) => `+ ${f}`).join("\n");
    }

    let description = "";
    if (p.description) {
      description = `${p.description}\n\n`;
    }

    await delay();
    await sock.sendMessage(from, {
      text: `${p.title}\n\n${description}${plans}\n\nSyarat & Ketentuan:\n${notes}${featuresTitle}\n${features}`,
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
        lower === "vidio"
      ) {
        const sharingPlans = p.plans
          .filter((plan) => plan.type === "sharing")
          .map((plan) => `- ${plan.duration} : *${plan.price}*`)
          .join("\n");

        const privatePlans = p.plans
          .filter((plan) => plan.type === "private")
          .map((plan) => `- ${plan.duration} : *${plan.price}*`)
          .join("\n");

        if (lower === "vidio") {
          plans = `Paket Sharing:\n${sharingPlans}\n\nPaket Private:\n${privatePlans}\n\n*Tonton tanpa iklan, kualitas HD, dan legal resmi dari Vidio!`;
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
                return `\n${plan.type}\n   - *${plan.price}*`;
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

      const featuresTitle = p.features_title ? `\n\n${p.features_title}` : "";
      let features = "";
      if (p.features) {
        features = p.features.map((f) => `+ ${f}`).join("\n");
      }

      let description = "";
      if (p.description) {
        description = `${p.description}\n\n`;
      }

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
        text: `${p.title}\n\n${description}${plans}\n\nSyarat & Ketentuan:\n${notes}${featuresTitle}\n${features}`,
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
          } else {
            return "";
          }
        })
        .join("\n");
    }
    const notes = p.notes.map((n) => `• ${n}`).join("\n");

    await delay();
    await sock.sendMessage(from, {
      text: `${p.title}\n\n${p.description}\n\n${plans}\n\n${notes}`,
      quoted: {
        key: msg.key,
        message: msg.message,
      },
    });
  } else if (lower === "ping") {
    await delay();
    await sock.sendMessage(from, { text: "Pong 🏓" });
  }
}

startBot().catch((err) => console.error("Gagal menjalankan bot:", err));
