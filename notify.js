// notify.js — Notifications "Notre Histoire" ♡
// Déployé via GitHub Actions (cron toutes les 30 min)

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore }        = require("firebase-admin/firestore");
const { getMessaging }        = require("firebase-admin/messaging");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
initializeApp({ credential: cert(serviceAccount) });

const db        = getFirestore();
const messaging = getMessaging();

const START_DATE = new Date("2025-03-21T00:00:00Z");

const LOVE_MESSAGES = [
  "Chaque jour avec toi est le plus beau de ma vie. 🌙",
  "Tu es mon endroit préféré dans ce monde. ♡",
  "Je t'aime un peu plus qu'hier, un peu moins que demain.",
  "Merci d'être toi, et d'être là. 💫",
  "Mon cœur bat exactement comme ça, à cause de toi. ♡",
  "Je pourrais passer mille jours encore, et ce ne serait jamais assez.",
  "Tu es la meilleure chose qui me soit arrivée. 🌸",
  "À toi, encore et toujours. ♡",
  "Chaque matin est plus doux quand c'est avec toi.",
  "Tu es mon histoire préférée.",
];

function getDayCount() {
  return Math.floor((Date.now() - START_DATE.getTime()) / 86400000);
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function getTokensByUser() {
  const snap = await db.collection("fcm_tokens").get();
  const map = { lui: [], elle: [] };
  snap.forEach((doc) => {
    const d = doc.data();
    if (d.token && d.user && map[d.user]) {
      map[d.user].push(d.token);
    }
  });
  console.log(`Tokens → lui:${map.lui.length} elle:${map.elle.length}`);
  return map;
}

async function sendToTokens(tokens, title, body, type) {
  if (!tokens || tokens.length === 0) {
    console.log(`  Aucun token pour ${type}`);
    return;
  }
  const res = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
    webpush: {
      notification: {
        title, body,
        icon: "/icon-192.png",
        badge: "/icon-72.png",
        vibrate: [200, 100, 200],
      },
      // ✅ NOUVEAU LIEN DE REDIRECTION
      fcmOptions: { link: "https://anymz.netlify.app/" },
    },
  });
  console.log(`  [${type}] succès:${res.successCount} échecs:${res.failureCount}`);

  const invalid = ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"];
  res.responses.forEach((r, i) => {
    if (!r.success && invalid.includes(r.error?.code)) {
      console.warn(`  Token invalide supprimé: ${tokens[i].slice(0,20)}...`);
      db.collection("fcm_tokens").where("token", "==", tokens[i]).get()
        .then(s => s.forEach(d => d.ref.delete()))
        .catch(() => {});
    }
  });
}

function resolveTarget(notifData) {
  if (notifData.to)     return notifData.to;
  if (notifData.target) {
    if (notifData.target === "user_A") return "lui";
    if (notifData.target === "user_B" || notifData.target === "user_N") return "elle";
  }
  return null;
}

async function processCollection(colName, sentField, tokensByUser) {
  const snap = await db.collection(colName)
    .where(sentField, "==", false)
    .get();

  if (snap.empty) {
    console.log(`[${colName}] : vide.`);
    return;
  }

  console.log(`[${colName}] : ${snap.size} notification(s) à envoyer.`);

  for (const doc of snap.docs) {
    const n   = doc.data();
    const to  = resolveTarget(n);
    const tokens = tokensByUser[to] || [];
    if (tokens.length > 0) {
      await sendToTokens(tokens, n.title, n.body, n.type || "notif");
    } else {
      console.log(`  Pas de token pour "${to}" — ignoré`);
    }
    const update = { sentAt: Date.now() };
    update[sentField] = true;
    await doc.ref.update(update);
  }
}

async function processNotifQueue(tokensByUser) {
  await processCollection("notif_queue",      "sent", tokensByUser);
  await processCollection("notification_queue", "read", tokensByUser);
}

async function checkMessageUnlocks(tokensByUser) {
  const today = todayStr();
  const snap = await db.collection("messages_caches")
    .where("unlockDate", "==", today)
    .get();

  if (snap.empty) {
    console.log("Déverrouillages aujourd'hui : aucun.");
    return;
  }

  const toNotify = snap.docs.filter(doc => doc.data().unlockedNotified !== today);
  if (toNotify.length === 0) {
    console.log("Déverrouillages aujourd'hui : déjà notifiés.");
    return;
  }
  console.log(`Déverrouillages aujourd'hui : ${toNotify.length} message(s) à notifier.`);

  for (const doc of toNotify) {
    const m = doc.data();
    const dest = m.author === "lui" ? "elle" : "lui";
    const authorName = m.author === "lui" ? "A" : "N";
    const tokens = tokensByUser[dest] || [];
    await sendToTokens(
      tokens,
      "Un message scellé s'ouvre aujourd'hui 💌",
      `Le message de ${authorName} est enfin disponible ♡`,
      "message_unlock"
    );
    await doc.ref.update({ unlockedNotified: today });
  }
}

async function sendDailyMessage(tokensByUser) {
  const now   = new Date();
  const day   = now.getDate();
  const month = now.getMonth();

  const allTokens = [...(tokensByUser.lui || []), ...(tokensByUser.elle || [])];

  if (day === 21 && month === 2) {
    const years  = now.getFullYear() - 2025;
    const months = Math.round((Date.now() - START_DATE.getTime()) / (30.44 * 24 * 3600 * 1000));
    const title  = years >= 1
      ? `🎂 ${years} an${years > 1 ? "s" : ""} ensemble aujourd'hui ! 🎂`
      : `🎉 Notre premier anniversaire ensemble ! 🎉`;
    const body   = years >= 1
      ? `Ça fait ${years} an${years > 1 ? "s" : ""} et ${months} mois — et c'est encore mieux chaque jour. Je t'aime. ♡`
      : `Un an que tout a commencé, le 21 mars 2025. Merci d'être là, pour toujours. 🥂♡`;
    await sendToTokens(allTokens, title, body, "anniv_annuel");
    return;
  }

  if (day === 21) {
    const moisEcoules = Math.round((Date.now() - START_DATE.getTime()) / (30.44 * 24 * 3600 * 1000));
    const title = `🥂 ${moisEcoules} mois ensemble ! 🥂`;
    const body  = `Déjà ${moisEcoules} mois depuis le 21 mars 2025 — et chaque journée est une chance de t'aimer encore plus fort. ♡`;
    await sendToTokens(allTokens, title, body, "anniv_mensuel");
    return;
  }

  const dayCount = getDayCount();
  const message  = LOVE_MESSAGES[dayCount % LOVE_MESSAGES.length];
  const title    = `Jour ${dayCount} ensemble ♡`;
  await sendToTokens(allTokens, title, message, "daily");
}

async function main() {
  console.log(`\n🚀 notify.js — ${new Date().toISOString()}\n`);
  const tokensByUser = await getTokensByUser();
  await processNotifQueue(tokensByUser);
  await checkMessageUnlocks(tokensByUser);
  await sendDailyMessage(tokensByUser);
  console.log("\n✅ Terminé.\n");
}

main().catch((err) => {
  console.error("💥 Erreur fatale :", err);
  process.exit(1);
});
