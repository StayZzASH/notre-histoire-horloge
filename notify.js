// notify.js — Notifications "Notre Histoire" ♡
// Déployé via GitHub Actions (cron toutes les 30 min)
// Gère : file de notifs (cœurs/messages), déverrouillages, message quotidien (8h)

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore }        = require("firebase-admin/firestore");
const { getMessaging }        = require("firebase-admin/messaging");

// ── Init Firebase Admin ───────────────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
initializeApp({ credential: cert(serviceAccount) });

const db        = getFirestore();
const messaging = getMessaging();

// ── Constantes ────────────────────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────
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

// Récupère les tokens FCM par utilisateur (lui/elle)
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

// Envoie une notification FCM à une liste de tokens
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
      fcmOptions: { link: "https://stayzzash.github.io/notre-histoire-horloge/" },
    },
  });
  console.log(`  [${type}] succès:${res.successCount} échecs:${res.failureCount}`);

  // Nettoyage des tokens invalides
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

// ── 1. Traite la file de notifications (cœurs + messages scellés) ─────────────

// Mappe l'ancien format (target: "user_A") vers le nouveau (to: "lui"/"elle")
function resolveTarget(notifData) {
  if (notifData.to)     return notifData.to; // nouveau format
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
  // Nouveau format (mon code)
  await processCollection("notif_queue",      "sent", tokensByUser);
  // Ancien format (ancien code)
  await processCollection("notification_queue", "read", tokensByUser);
}

// ── 2. Vérifie les messages qui se déverrouillent aujourd'hui ─────────────────
async function checkMessageUnlocks(tokensByUser) {
  const today = todayStr();
  const snap = await db.collection("messages_caches")
    .where("unlockDate", "==", today)
    .get();

  if (snap.empty) {
    console.log("Déverrouillages aujourd'hui : aucun.");
    return;
  }

  // Filtre ceux déjà notifiés aujourd'hui (le cron tourne toutes les 30 min)
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
    // Marquer pour ne pas renvoyer lors du prochain run du cron
    await doc.ref.update({ unlockedNotified: today });
  }
}

// ── 3. Message d'amour quotidien (+ anniversaires le 21) ─────────────────────
async function sendDailyMessage(tokensByUser) {
  const now   = new Date();
  const day   = now.getDate();   // 1-31
  const month = now.getMonth();  // 0-indexé, mars = 2

  // Tous les tokens (lui + elle) pour les notifs communes
  const allTokens = [...(tokensByUser.lui || []), ...(tokensByUser.elle || [])];

  // ── Cas 1 : 21 mars → anniversaire de l'année ──────────────────────────────
  if (day === 21 && month === 2) {
    const years  = now.getFullYear() - 2025; // 0 la 1ère année, 1 la 2ème…
    const months = Math.round((Date.now() - START_DATE.getTime()) / (30.44 * 24 * 3600 * 1000));
    const title  = years >= 1
      ? `🎂 ${years} an${years > 1 ? "s" : ""} ensemble aujourd'hui ! 🎂`
      : `🎉 Notre premier anniversaire ensemble ! 🎉`;
    const body   = years >= 1
      ? `Ça fait ${years} an${years > 1 ? "s" : ""} et ${months} mois qu'on s'est rencontrés — et c'est encore mieux chaque jour. Je t'aime. ♡`
      : `Un an que tout a commencé, le 21 mars 2025. Merci d'être là, pour toujours. 🥂♡`;
    console.log(`🎂 Anniversaire annuel → "${title}"`);
    await sendToTokens(allTokens, title, body, "anniv_annuel");
    return;
  }

  // ── Cas 2 : autre 21 → mois-niversaire ────────────────────────────────────
  if (day === 21) {
    const moisEcoules = Math.round((Date.now() - START_DATE.getTime()) / (30.44 * 24 * 3600 * 1000));
    const nomsMois = ["janvier","février","mars","avril","mai","juin",
                      "juillet","août","septembre","octobre","novembre","décembre"];
    const title = `🥂 ${moisEcoules} mois ensemble ! 🥂`;
    const body  = `Déjà ${moisEcoules} mois depuis le 21 mars 2025 — et chaque journée est une chance de t'aimer encore plus fort. ♡`;
    console.log(`🥂 Mois-niversaire (${moisEcoules} mois) → "${title}"`);
    await sendToTokens(allTokens, title, body, "anniv_mensuel");
    return;
  }

  // ── Cas 3 : jour normal → message d'amour ─────────────────────────────────
  const dayCount = getDayCount();
  const message  = LOVE_MESSAGES[dayCount % LOVE_MESSAGES.length];
  const title    = `Jour ${dayCount} ensemble ♡`;
  console.log(`Message quotidien → "${title}"`);
  await sendToTokens(allTokens, title, message, "daily");
}

// ── Main ──────────────────────────────────────────────────────────────────────
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
