(() => {
  const $ = (s) => document.querySelector(s);
  const cfg = window.QN_CONFIG || {};
  const status = $("#status");

  // --- Stockage local (cache des notes + file d'attente hors ligne) ---
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  if (!window.supabase || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("VOTRE-PROJET")) {
    $("#login").hidden = false;
    $("#email-form").hidden = true;
    $("#login-msg").textContent = "Configuration manquante : renseignez config.js (voir LISEZMOI.md).";
    $("#login-msg").className = "msg err";
    return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    // "implicit" : le lien fonctionne même s'il s'ouvre dans un autre onglet que celui de la demande.
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
  });

  // ================= Connexion (e-mail + mot de passe) =================
  let signup = false;
  $("#switch-mode").addEventListener("click", () => {
    signup = !signup;
    $("#login-title").textContent = signup ? "Créer un compte" : "Connexion";
    $("#login-btn").textContent = signup ? "Créer mon compte" : "Se connecter";
    $("#switch-mode").textContent = signup ? "Déjà un compte ? Se connecter" : "Pas encore de compte ? Créer un compte";
    $("#password").autocomplete = signup ? "new-password" : "current-password";
    setLoginMsg("");
  });
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#email").value.trim(), password = $("#password").value;
    setLoginMsg(signup ? "Création du compte…" : "Connexion…");
    const { data, error } = signup
      ? await sb.auth.signUp({ email, password })
      : await sb.auth.signInWithPassword({ email, password });
    if (error) {
      if (/invalid login/i.test(error.message)) return setLoginMsg("E-mail ou mot de passe incorrect.", true);
      if (/already registered/i.test(error.message)) return setLoginMsg("Ce compte existe déjà : connectez-vous.", true);
      if (/not confirmed/i.test(error.message)) return setLoginMsg("Confirmez d'abord votre adresse via l'e-mail reçu.", true);
      return setLoginMsg(error.message, true);
    }
    if (signup && !data.session) return setLoginMsg("Compte créé. Confirmez votre adresse via l'e-mail reçu, puis connectez-vous.");
    $("#password").value = "";
    setLoginMsg("");
  });
  $("#logout").addEventListener("click", async () => {
    await sb.auth.signOut();
    ls.set("qn-notes", []); ls.set("qn-queue", []);
  });
  function setLoginMsg(t, err) { $("#login-msg").textContent = t; $("#login-msg").className = "msg" + (err ? " err" : ""); }

  // ================= Notes =================
  const text = $("#text"), save = $("#save"), list = $("#list"), empty = $("#empty");
  let user = null, channel = null;
  let kind = ls.get("qn-kind", "idea"), filter = "all", pendingDelete = null;
  let serverNotes = ls.get("qn-notes", []);
  let queue = ls.get("qn-queue", []);
  text.value = ls.get("qn-draft", "");
  setKind(kind);

  function notes() {
    // Applique les modifications en attente par-dessus la dernière copie du serveur.
    let out = serverNotes.slice();
    for (const q of queue) {
      if (q.op === "insert" && !out.some((n) => n.id === q.row.id)) out.unshift(q.row);
      if (q.op === "update") out = out.map((n) => (n.id === q.id ? { ...n, ...q.data } : n));
      if (q.op === "delete") out = out.filter((n) => n.id !== q.id);
    }
    return out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }

  function enqueue(item) { queue.push(item); ls.set("qn-queue", queue); render(); flush(); }

  let flushing = false;
  async function flush() {
    if (flushing || !user) return;
    flushing = true;
    try {
      while (queue.length) {
        const q = queue[0];
        let res;
        if (q.op === "insert") res = await sb.from("notes").upsert(q.row);
        if (q.op === "update") res = await sb.from("notes").update(q.data).eq("id", q.id);
        if (q.op === "delete") res = await sb.from("notes").delete().eq("id", q.id);
        if (res.error) { if (!navigator.onLine || /fetch|network/i.test(res.error.message)) break; console.error(res.error); }
        queue.shift(); ls.set("qn-queue", queue);
      }
    } catch { /* hors ligne : on réessaiera */ }
    flushing = false;
    if (!queue.length) await refresh(); else setStatus();
  }

  async function refresh() {
    if (!user) return;
    const { data, error } = await sb.from("notes").select("id,text,kind,done,created_at").order("created_at", { ascending: false });
    if (!error) { serverNotes = data; ls.set("qn-notes", data); }
    setStatus(error);
    render();
  }

  function setStatus(err) {
    if (!navigator.onLine) status.textContent = queue.length ? `Hors ligne · ${queue.length} en attente` : "Hors ligne";
    else if (queue.length) status.textContent = "Envoi…";
    else status.textContent = err ? "Erreur de synchro" : "Synchronisé";
  }

  function add() {
    const t = text.value.trim();
    if (!t) return;
    stopMic();
    const row = { id: crypto.randomUUID(), text: t, kind, done: false, created_at: new Date().toISOString() };
    text.value = ""; ls.set("qn-draft", ""); updateSave();
    enqueue({ op: "insert", row });
  }

  function setKind(k) {
    kind = k; ls.set("qn-kind", k);
    document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === k)));
  }
  function updateSave() { save.disabled = !text.value.trim(); }

  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => setKind(b.dataset.kind)));
  document.querySelectorAll(".filters button").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.f;
    document.querySelectorAll(".filters button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    render();
  }));
  text.addEventListener("input", () => { ls.set("qn-draft", text.value); updateSave(); });
  text.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); } });
  save.addEventListener("click", add);

  function when(iso) {
    const d = new Date(iso), now = new Date();
    const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return "Aujourd'hui " + time;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Hier " + time;
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) + " " + time;
  }

  function render() {
    const all = notes();
    const tasks = all.filter((n) => n.kind === "task");
    $("#n-all").textContent = all.length;
    $("#n-idea").textContent = all.length - tasks.length;
    $("#n-task").textContent = tasks.filter((n) => !n.done).length;

    let shown = filter === "all" ? all : all.filter((n) => n.kind === filter);
    if (filter === "task") shown = [...shown].sort((a, b) => a.done - b.done);

    list.replaceChildren(...shown.map((n) => {
      const li = document.createElement("li");
      if (n.kind === "task" && n.done) li.className = "done";
      let lead;
      if (n.kind === "task") {
        lead = document.createElement("input");
        lead.type = "checkbox"; lead.checked = !!n.done;
        lead.setAttribute("aria-label", "Terminée");
        lead.addEventListener("change", () => enqueue({ op: "update", id: n.id, data: { done: lead.checked } }));
      } else {
        lead = document.createElement("span"); lead.className = "dot";
      }
      const body = document.createElement("div"); body.className = "body";
      const p = document.createElement("div"); p.className = "text"; p.textContent = n.text;
      const meta = document.createElement("div"); meta.className = "meta";
      const tag = document.createElement("span"); tag.className = "tag " + n.kind; tag.textContent = n.kind === "task" ? "Tâche" : "Idée";
      const date = document.createElement("span"); date.textContent = when(n.created_at);
      meta.append(tag, date); body.append(p, meta);

      const del = document.createElement("button");
      del.type = "button"; del.className = "del";
      const confirming = pendingDelete === n.id;
      del.textContent = confirming ? "Supprimer ?" : "✕";
      del.setAttribute("aria-label", confirming ? "Confirmer la suppression" : "Supprimer la note");
      if (confirming) del.classList.add("confirm");
      del.addEventListener("click", () => {
        if (pendingDelete === n.id) { pendingDelete = null; enqueue({ op: "delete", id: n.id }); }
        else {
          pendingDelete = n.id; render();
          setTimeout(() => { if (pendingDelete === n.id) { pendingDelete = null; render(); } }, 3000);
        }
      });
      li.append(lead, body, del);
      return li;
    }));
    empty.hidden = shown.length > 0;
    empty.textContent = all.length ? (filter === "task" ? "Aucune tâche." : "Aucune idée.") : "Vos notes apparaîtront ici. Touchez le micro pour dicter la première.";
  }

  // ================= Dictée vocale =================
  // Dans l'APK Android : reconnaissance vocale native (plugin Capacitor).
  // Dans un navigateur : Web Speech API.
  const native = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins : null;
  const NativeSR = native?.SpeechRecognition;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $("#mic");
  let rec = null, listening = false, base = "";
  if (!NativeSR && !SR) { mic.hidden = true; $("#mic-hint").hidden = false; }
  mic.addEventListener("click", () => (listening ? stopMic() : startMic()));

  function showDictation(said) {
    text.value = base + capitalize(said.trim());
    ls.set("qn-draft", text.value); updateSave();
  }
  function setListening(on) {
    listening = on;
    mic.classList.toggle("rec", on);
    mic.setAttribute("aria-label", on ? "Arrêter la dictée" : "Dicter");
  }
  function micDenied() {
    $("#mic-hint").textContent = "Autorisez le micro pour Quick Note dans les réglages du téléphone.";
    $("#mic-hint").hidden = false;
  }

  if (NativeSR) {
    NativeSR.addListener("partialResults", (d) => { if (listening && d.matches?.[0]) showDictation(d.matches[0]); });
    NativeSR.addListener("listeningState", (d) => { if (d.status === "stopped") setListening(false); });
  }

  async function startMic() {
    base = text.value.trim() ? text.value.trim() + " " : "";
    if (NativeSR) {
      try {
        const perm = await NativeSR.requestPermissions();
        if (perm.speechRecognition !== "granted") return micDenied();
        setListening(true);
        await NativeSR.start({ language: "fr-FR", partialResults: true, popup: false, maxResults: 1 });
      } catch { setListening(false); }
      return;
    }
    rec = new SR();
    rec.lang = "fr-FR";
    rec.interimResults = true;
    // Chrome Android renvoie en mode continu des résultats cumulatifs
    // ("application", "application de", …) : on dicte une phrase à la fois.
    rec.continuous = !/Android/i.test(navigator.userAgent);
    rec.onresult = (e) => {
      let said = "";
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim();
        if (!t) continue;
        // Si ce résultat reprend le précédent en l'allongeant, il le remplace.
        if (t.toLowerCase().startsWith(said.toLowerCase())) said = t;
        else if (!said.toLowerCase().endsWith(t.toLowerCase())) said += " " + t;
      }
      showDictation(said);
    };
    rec.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") micDenied(); };
    rec.onend = () => { rec = null; setListening(false); };
    rec.start();
    setListening(true);
  }
  function stopMic() {
    if (NativeSR) { if (listening) NativeSR.stop().catch(() => {}); setListening(false); }
    else if (rec) rec.stop();
  }
  function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

  // ================= Démarrage =================
  function showApp(session) {
    user = session?.user || null;
    $("#login").hidden = !!user;
    $("#app").hidden = !user;
    if (!user) { status.textContent = ""; if (channel) { sb.removeChannel(channel); channel = null; } return; }
    $("#who").textContent = user.email;
    render();
    flush();
    if (!channel) {
      channel = sb.channel("notes-" + user.id)
        .on("postgres_changes", { event: "*", schema: "public", table: "notes", filter: "user_id=eq." + user.id }, () => { if (!queue.length) refresh(); })
        .subscribe();
    }
  }

  sb.auth.onAuthStateChange((_evt, session) => showApp(session));
  sb.auth.getSession().then(({ data }) => showApp(data.session));
  window.addEventListener("online", flush);
  window.addEventListener("offline", () => setStatus());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") flush(); });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
