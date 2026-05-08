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
async function processNotifQueue(tokensByUser) {
  const snap = await db.collection("notif_queue")
    .where("sent", "==", false)
    .orderBy("createdAt", "asc")
    .get();

  if (snap.empty) {
    console.log("File de notifs : vide.");
    return;
  }

  console.log(`File de notifs : ${snap.size} notification(s) à envoyer.`);

  for (const doc of snap.docs) {
    const n = doc.data();
    const tokens = tokensByUser[n.to] || [];
    if (tokens.length > 0) {
      await sendToTokens(tokens, n.title, n.body, n.type);
    } else {
      console.log(`  Pas de token pour ${n.to} — notif ignorée`);
    }
    // Marquer comme envoyé
    await doc.ref.update({ sent: true, sentAt: Date.now() });
  }
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

  console.log(`Déverrouillages aujourd'hui : ${snap.size} message(s).`);

  for (const doc of snap.docs) {
    const m = doc.data();
    // La notif va au destinataire (l'autre personne)
    const dest = m.author === "lui" ? "elle" : "lui";
    const authorName = m.author === "lui" ? "A" : "N";
    const tokens = tokensByUser[dest] || [];
    await sendToTokens(
      tokens,
      "Un message scellé s'ouvre aujourd'hui 💌",
      `Le message de ${authorName} est enfin disponible ♡`,
      "message_unlock"
    );
    // Éviter de notifier plusieurs fois le même jour
    await doc.ref.update({ unlockedNotified: today });
  }
}

// ── 3. Message d'amour quotidien (seulement si on tourne à 8h UTC±1) ──────────
async function sendDailyMessage(tokensByUser) {
  const hour = new Date().getUTCHours();
  // GitHub Actions cron en UTC → 8h Paris en été = 6h UTC, en hiver = 7h UTC
  // On envoie entre 6h et 8h UTC pour être sûr d'attraper la bonne exécution
  if (hour < 6 || hour > 9) {
    console.log(`Message quotidien : pas l'heure (${hour}h UTC). Skipped.`);
    return;
  }

  const day     = getDayCount();
  const message = LOVE_MESSAGES[day % LOVE_MESSAGES.length];
  const title   = `Jour ${day} ensemble ♡`;

  console.log(`Message quotidien → "${title}"`);

  // Envoi à tous les tokens (lui + elle)
  const allTokens = [...(tokensByUser.lui || []), ...(tokensByUser.elle || [])];
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
