// notify.js — Cron quotidien "Notre Histoire" ♡
// Déployé via GitHub Actions, 0 coût (Firebase Spark compatible)

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore }        = require("firebase-admin/firestore");
const { getMessaging }        = require("firebase-admin/messaging");

// ── 1. Init Firebase Admin (via Secret GitHub) ───────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

initializeApp({ credential: cert(serviceAccount) });

const db        = getFirestore();
const messaging = getMessaging();

// ── 2. Calcul du jour depuis le début de votre histoire ──────────────────────
const START_DATE = new Date("2025-03-21T00:00:00Z");

function getDayCount() {
  const now        = new Date();
  const diffMs     = now.getTime() - START_DATE.getTime();
  const diffDays   = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return diffDays;
}

// ── 3. Messages d'amour aléatoires ───────────────────────────────────────────
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

function getRandomMessage() {
  return LOVE_MESSAGES[Math.floor(Math.random() * LOVE_MESSAGES.length)];
}

// ── 4. Récupération de tous les tokens FCM dans Firestore ────────────────────
async function getAllTokens() {
  const snapshot = await db.collection("fcm_tokens").get();

  if (snapshot.empty) {
    console.log("⚠️  Aucun token FCM trouvé dans Firestore.");
    return [];
  }

  const tokens = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    // Compatible avec user_A / user_B ET user_admin (anciens formats)
    if (data.token && typeof data.token === "string" && data.token.length > 10) {
      tokens.push({ id: doc.id, token: data.token });
    } else {
      console.warn(`⚠️  Document ${doc.id} sans token valide — ignoré.`);
    }
  });

  console.log(`✅  ${tokens.length} token(s) récupéré(s) : ${tokens.map(t => t.id).join(", ")}`);
  return tokens;
}

// ── 5. Envoi des notifications ────────────────────────────────────────────────
async function sendDailyNotification() {
  const day     = getDayCount();
  const message = getRandomMessage();
  const title   = `Jour ${day} avec toi ♡`;
  const body    = message;

  console.log(`\n📅  Envoi de la notification du ${new Date().toISOString()}`);
  console.log(`   Titre : ${title}`);
  console.log(`   Corps : ${body}\n`);

  const tokenDocs = await getAllTokens();

  if (tokenDocs.length === 0) {
    console.error("❌  Aucun token disponible. Arrêt du script.");
    process.exit(0);
  }

  const tokens = tokenDocs.map(t => t.token);

  // Envoi multicast (max 500 tokens par appel — largement suffisant ici)
  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
    webpush: {
      notification: {
        title,
        body,
        icon: "/icon-192.png",
        badge: "/icon-72.png",
        vibrate: [200, 100, 200],
      },
      fcmOptions: { link: "https://love-67092.web.app" },
    },
    android: {
      notification: {
        title,
        body,
        icon: "ic_notification",
        color: "#e91e8c",
        sound: "default",
      },
    },
  });

  // ── 6. Rapport détaillé ─────────────────────────────────────────────────────
  console.log(`\n📊  Résultats :`);
  console.log(`   Succès  : ${response.successCount}`);
  console.log(`   Échecs  : ${response.failureCount}`);

  response.responses.forEach((resp, idx) => {
    const docId = tokenDocs[idx].id;
    if (resp.success) {
      console.log(`   ✅ [${docId}] envoyé — messageId : ${resp.messageId}`);
    } else {
      const errCode = resp.error?.code || "UNKNOWN";
      console.error(`   ❌ [${docId}] échec — ${errCode} : ${resp.error?.message}`);

      // Nettoyage automatique des tokens invalides (expirés / désinstallés)
      if (
        errCode === "messaging/registration-token-not-registered" ||
        errCode === "messaging/invalid-registration-token"
      ) {
        console.warn(`   🗑️  Token [${docId}] invalidé — suppression de Firestore…`);
        db.collection("fcm_tokens").doc(docId).delete()
          .then(() => console.log(`   🗑️  [${docId}] supprimé.`))
          .catch(e => console.error(`   ⚠️  Impossible de supprimer [${docId}] : ${e.message}`));
      }
    }
  });

  console.log(`\n🎉  Script terminé avec succès.\n`);
}

// ── Lancement ─────────────────────────────────────────────────────────────────
sendDailyNotification().catch((err) => {
  console.error("💥  Erreur fatale :", err);
  process.exit(1);
});
