/* =============================================================
   firebase-messaging-sw.js  —  Plan Spark, Firebase v10 compat
   Reçoit les notifications de la Console Firebase ET celles
   déclenchées par l'app quand elle est en arrière-plan.
   ⚠️  Placer à la RACINE de public/ (même niveau qu'index.html)
   ============================================================= */

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:            "AIzaSyAg98bxN-3ZYAdpfyy1-cd1g8tugOMKva8",
  authDomain:        "love-67092.firebaseapp.com",
  projectId:         "love-67092",
  messagingSenderId: "734347959336",
  appId:             "1:734347959336:web:07de94241ab0ea8135e91d"
});

const messaging = firebase.messaging();

/* ── Arrière-plan / app fermée ──────────────────────────────────────────────
   Reçoit les messages de la Console Firebase → Messaging (onglet "Envoyer
   un message test") ainsi que les pushes FCM directs si tu en ajoutes plus tard. */
messaging.onBackgroundMessage(function(payload) {
  console.log("[SW] Message arrière-plan:", payload);
  var n     = payload.notification || {};
  var title = n.title || "Notre Histoire ♡";
  var body  = n.body  || "";

  return self.registration.showNotification(title, {
    body:     body,
    icon:     "/icon-192.png",
    badge:    "/badge-72.png",
    vibrate:  [200, 100, 200, 100, 200],
    tag:      "notre-histoire",   /* Remplace les doublons */
    renotify: true,
    data:     payload.data || {}
  });
});

/* ── Clic sur la notification → ouvre ou focus l'app ───────────────────── */
self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(function(list) {
        for (var i = 0; i < list.length; i++) {
          if (list[i].url.indexOf(self.location.origin) === 0 && "focus" in list[i]) {
            return list[i].focus();
          }
        }
        return clients.openWindow("https://anymz.netlify.app/");
      })
  );
});

/* ── Cycle de vie ─────────────────────────────────────────────────────── */
self.addEventListener("install",  function() { self.skipWaiting(); });
self.addEventListener("activate", function(e) { e.waitUntil(clients.claim()); });
