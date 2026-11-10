(() => {
  "use strict";

  const cfg = window.ONCEUPON_CONFIG || {};
  const configured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !String(cfg.SUPABASE_ANON_KEY).includes("PASTE_YOUR_"));
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[ch]));
  const dateText = value => value ? new Date(value).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"}) : "—";
  const niceError = error => error?.message || String(error || "Something went wrong.");
  let supa = null;
  let session = null;
  let profile = null;
  let roles = [];
  let activeView = "home";
  let currentStory = null;
  let currentChapters = [];
  let currentChapter = null;
  let currentPages = [];
  let currentPage = null;
  let catalogue = [];
  let authorStories = [];
  let adminProfiles = [];
  let toastTimer = null;
  let activeThreadId = null;
  let presenceTimer = null;
  let deferredInstallPrompt = null;
  let notificationPollTimer = null;
  let lastSeenNotificationAt = null;

  const main = $("#main");
  const toastNode = $("#toast");
  const roleIsAdmin = () => roles.includes("admin") || roles.includes("owner");
  const roleIsAuthor = () => roles.includes("author") || roleIsAdmin();
  const isApproved = () => profile?.approval_status === "approved" || roleIsAdmin();
  const userId = () => session?.user?.id;

  function toast(message, duration = 3200) {
    toastNode.textContent = message;
    toastNode.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastNode.classList.remove("show"), duration);
  }

  function setMessage(node, message, bad = false) {
    if (!node) return;
    node.textContent = message || "";
    node.style.color = bad ? "#a34f3d" : "";
  }

  function setAuthMode(mode) {
    $("#authModal").classList.remove("hidden");
    $$(".auth-form").forEach(form => form.classList.add("hidden"));
    $$(".auth-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.authMode === mode));
    const form = $(`#${mode}Form`);
    if (form) form.classList.remove("hidden");
    const titles = {login:"Sign in",signup:"Create your account",verify:"Verify your email"};
    $("#authTitle").textContent = titles[mode] || "Welcome";
    setMessage($("#authMessage"), "");
  }

  function closeModal() { $("#authModal").classList.add("hidden"); }

  function updateChrome() {
    const nav = $("#nav");
    const links = [{id:"home",label:"Library"},{id:"authors",label:"Authors"},{id:"ai",label:"Ask AI"},{id:"faq",label:"FAQ"}];
    if (session && isApproved()) { links.push({id:"wallet",label:"My tokens"},{id:"quests",label:"Quests"},{id:"community",label:"My library"},{id:"notifications",label:"Notifications"},{id:"help",label:"Help & feedback"}); }
    if (session && isApproved()) links.push({id:"author",label:"Write"});
    if (session && roleIsAdmin()) links.push({id:"admin",label:"Administration"});
    if (session) links.push({id:"messages",label:"Messages"},{id:"account",label:"Profile"});
    nav.innerHTML = links.map(item => `<button data-view="${item.id}" class="${activeView===item.id?"active":""}">${item.label}</button>`).join("");
    $("#authButton").classList.toggle("hidden", Boolean(session));
    $("#signOutButton").classList.toggle("hidden", !session);
  }

  async function rpc(name, args = {}) {
    const {data, error} = await supa.rpc(name, args);
    if (error) throw error;
    return data;
  }

  async function getCatalogue() {
    try {
      const data = await rpc("get_story_catalogue");
      catalogue = Array.isArray(data) ? data : [];
    } catch (error) {
      catalogue = [];
      console.error("Catalogue load:", error);
      toast("The library could not load. Check the get_story_catalogue function.");
    }
    renderCatalogue();
  }

  function storyCard(story) {
    const tags = Array.isArray(story.tags) ? story.tags : [];
    let coverUrl = "";
    if (story.cover_path) {
      const path = String(story.cover_path);
      if (/^https?:\/\//i.test(path)) coverUrl = path;
      else if (supa) coverUrl = supa.storage.from("story-covers").getPublicUrl(path).data?.publicUrl || "";
    }
    const cover = coverUrl
      ? `<img src="${esc(coverUrl)}" alt="Cover of ${esc(story.title)}" loading="lazy">`
      : `<span>OnceUpon</span>`;
    return `<article class="story-card">
      <div class="story-cover">${cover}</div>
      <div class="story-info">
        <div class="story-meta">${esc(story.genre || "Fiction")} · ${Number(story.chapter_count || 0)} chapters</div>
        <h3>${esc(story.title)}</h3>
        <p>${esc(story.synopsis || "A story waiting to be discovered.")}</p>
        <div>${tags.slice(0,3).map(tag => `<span class="tag">${esc(tag)}</span>`).join("")}</div>
        <button class="button button-outline button-xs" data-open-story="${esc(story.story_id)}">View story</button>
      </div>
    </article>`;
  }

  function renderCatalogue() {
    const query = ( $("#catalogueSearch")?.value || "" ).trim().toLowerCase();
    const filtered = catalogue.filter(story => {
      const haystack = [story.title, story.synopsis, story.genre, ...(Array.isArray(story.tags)?story.tags:[])].join(" ").toLowerCase();
      return haystack.includes(query);
    });
    $("#catalogue").innerHTML = filtered.length
      ? filtered.map(storyCard).join("")
      : `<div class="empty-state">No published stories match that search yet.</div>`;
  }

  function renderHome() {
    currentStory = null; currentChapter = null; currentPage = null;
    main.innerHTML = `
      <section class="hero">
        <div class="hero-copy"><p class="eyebrow">A home for stories</p><h1>Every story deserves<br><em>a place to be found.</em></h1><p class="hero-text">Discover thoughtful fiction, follow authors, and read at your own pace.</p><div class="hero-actions"><button class="button" data-action="browse">Explore the library</button>${session ? "" : `<button class="button button-outline" data-action="signup">Create an account</button>`}</div></div>
        <div class="hero-art" aria-hidden="true"><div class="book-shape"><span>Once<br>Upon</span><i>✦</i></div><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><span class="hero-star star-a">✦</span><span class="hero-star star-b">✧</span></div>
      </section>
      <section class="content-section" id="librarySection"><div class="section-heading"><div><p class="eyebrow">The collection</p><h2>Stories to discover</h2></div><label class="search-wrap"><span aria-hidden="true">⌕</span><input id="catalogueSearch" type="search" placeholder="Search titles, genres, tags…" aria-label="Search stories"></label></div><div id="catalogue" class="story-grid"><div class="loading">Loading published stories…</div></div></section>`;
    if (supa) getCatalogue();
    else { $("#catalogue").innerHTML = `<div class="empty-state">Connect your Supabase project to load the live catalogue.</div>`; }
    updateChrome();
  }

  async function openStory(storyId) {
    activeView = "reader";
    const story = catalogue.find(item => String(item.story_id) === String(storyId));
    if (!story) return toast("That story is no longer in the catalogue.");
    currentStory = story; currentChapter = null; currentPage = null;
    main.innerHTML = `<section class="page-wrap"><div class="loading">Loading chapters…</div></section>`;
    try {
      const data = await rpc("get_story_chapters", {p_story_id: story.story_id});
      currentChapters = Array.isArray(data) ? data : [];
      renderStoryDetail();
    } catch (error) {
      main.innerHTML = `<section class="page-wrap"><div class="notice danger-note">${esc(niceError(error))}</div><button class="button button-outline" data-action="browse">Back to library</button></section>`;
    }
  }

  function renderStoryDetail() {
    const s = currentStory;
    main.innerHTML = `<section class="page-wrap">
      <button class="text-button" data-action="browse">← Back to library</button>
      <div class="page-heading"><p class="eyebrow">${esc(s.genre || "Story")}</p><h2>${esc(s.title)}</h2><p>${esc(s.synopsis || "")}</p><small class="muted">Published ${dateText(s.published_at)} · ${currentChapters.length} chapters</small></div>
      ${!session ? `<div class="notice">Sign in, verify your email and wait for account approval to read story pages. The published catalogue is visible to everyone.</div>` : (!isApproved() ? `<div class="notice">Your account is ${esc(profile?.approval_status || "pending")}. Reading access starts after manual approval.</div>` : "")}
      <div class="form-actions">${session&&isApproved()?`<button class="button button-outline button-xs" data-bookmark-story="${esc(s.story_id)}">Save bookmark</button>`:""}</div><div class="chapter-layout"><aside class="panel"><h3>Chapters</h3><div class="chapter-list">${currentChapters.length ? currentChapters.map(ch => `<button class="chapter-button ${currentChapter?.chapter_id===ch.chapter_id?"active":""}" data-open-chapter="${esc(ch.chapter_id)}"><strong>${String(ch.chapter_number).padStart(2,"0")}</strong> · ${esc(ch.chapter_title)}<small class="muted">${Number(ch.page_count||0)} pages</small></button>`).join("") : `<p class="muted">No chapters are available yet.</p>`}</div></aside><div id="chapterPanel" class="panel"><h3>Choose a chapter</h3><p class="muted">Select a chapter to see its pages. The first five pages of a story are free.</p></div></div>${session&&isApproved()?`<div class="panel"><h3>Review this story</h3><form id="reviewForm" class="form-stack"><label class="field">Rating<select name="rating"><option value="5">5 — Excellent</option><option value="4">4 — Very good</option><option value="3">3 — Good</option><option value="2">2 — Fair</option><option value="1">1 — Needs work</option></select></label><label class="field">Review<textarea name="review_text" maxlength="3000"></textarea></label><button class="button">Submit review</button></form></div>`:""}
    </section>`;
  }

  async function openChapter(chapterId) {
    if (!session || !isApproved()) {
      toast("Reading requires a verified and approved account.");
      if (!session) setAuthMode("login");
      return;
    }
    const chapter = currentChapters.find(item => String(item.chapter_id) === String(chapterId));
    if (!chapter) return;
    currentChapter = chapter; currentPage = null;
    const panel = $("#chapterPanel");
    panel.innerHTML = `<div class="loading">Loading page list…</div>`;
    try {
      const data = await rpc("get_story_chapter_pages", {p_chapter_id: chapter.chapter_id});
      currentPages = Array.isArray(data) ? data : [];
      renderChapterPanel();
    } catch (error) {
      panel.innerHTML = `<div class="notice danger-note">${esc(niceError(error))}<br>Run the SQL patch included with this package, then reload.</div>`;
    }
  }

  function renderChapterPanel() {
    const ch = currentChapter;
    $("#chapterPanel").innerHTML = `<h3>${esc(ch.chapter_title)}</h3><p class="muted">Select a page below. Pages after the first five story pages may require tokens.</p>
      <div class="page-selector">${currentPages.map(page => `<button class="page-button ${currentPage?.page_id===page.page_id?"active":""}" data-open-page="${esc(page.page_id)}" title="${page.is_free?"Free":"Cost: "+page.token_cost+" tokens"}">${page.page_number}</button>`).join("")}</div>
      <div id="readerPane"><div class="empty-state">Choose a page to begin reading.</div></div>`;
  }

  async function openPage(pageId) {
    if (!session || !isApproved()) return toast("Reading access is not active for this account.");
    const page = currentPages.find(item => String(item.page_id) === String(pageId));
    if (!page) return;
    currentPage = page;
    const pane = $("#readerPane");
    pane.innerHTML = `<div class="loading">Opening page…</div>`;
    try {
      const raw = await rpc("get_story_page", {p_page_id: page.page_id});
      const row = Array.isArray(raw) ? raw[0] : raw;
      if (!row) throw new Error("Page content was not returned.");
      renderReaderPage(row, page);
      const progressWrite=await supa.from("reading_progress").upsert({user_id:userId(),story_id:currentStory.story_id,chapter_id:currentChapter.chapter_id,page_id:page.page_id,last_read_at:new Date().toISOString()},{onConflict:"user_id,story_id"}); if(progressWrite.error) console.warn("Reading progress:",progressWrite.error.message);
    } catch (error) {
      const cost = Math.max(0, Number(page.token_cost || 0));
      pane.innerHTML = `<div class="notice">This page is locked. ${cost === 0 ? "It has no token cost." : `Unlock cost: ${cost} tokens.`}</div>
        <div class="panel"><h3>Unlock page ${page.page_number}</h3><p class="muted">Your token batches are spent in earliest-expiry order. You will only be charged when the server confirms the unlock.</p>
        <div class="form-actions"><button class="button" data-unlock-page="${esc(page.page_id)}">${cost===0?"Unlock for free":`Unlock for ${cost} tokens`}</button><button class="button button-outline" data-action="refresh-wallet">Check token balance</button></div><p class="form-note">${esc(niceError(error))}</p></div>`;
    }
    renderChapterPanelButtonsOnly();
  }

  function renderChapterPanelButtonsOnly() {
    const strip = $("#chapterPanel .page-selector");
    if (!strip) return;
    strip.innerHTML = currentPages.map(page => `<button class="page-button ${currentPage?.page_id===page.page_id?"active":""}" data-open-page="${esc(page.page_id)}" title="${page.is_free?"Free":"Cost: "+page.token_cost+" tokens"}">${page.page_number}</button>`).join("");
  }

  function renderReaderPage(row, meta) {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    const pane = $("#readerPane");
    const content = String(row.content ?? "");
    pane.innerHTML = `<div class="panel"><div class="section-heading"><div><p class="eyebrow">${meta.is_free?"Free page":"Unlocked page"}</p><h3>Page ${meta.page_number}</h3></div><small class="muted">${Number(row.tokens_spent||0)} tokens spent</small></div>
      <article class="reader-content" id="readerText">${esc(content)}</article>${session&&isApproved()?`<form id="commentForm" class="form-stack"><label class="field">Comment on this page<textarea name="comment_text" maxlength="2000" required></textarea></label><button class="button button-outline button-xs">Post comment</button></form>`:""}<div class="form-actions"><button class="button button-outline button-xs" data-action="read-aloud">Read aloud</button><button class="button button-outline button-xs" data-action="stop-reading">Stop audio</button><button class="button button-outline button-xs" data-action="font-down">A−</button><button class="button button-outline button-xs" data-action="font-up">A+</button><button class="button button-outline button-xs" data-action="line-spacing">Line spacing</button></div></div>`;
    applyReadingPrefs();
  }

  async function unlockPage(pageId) {
    const page = currentPages.find(item => String(item.page_id) === String(pageId));
    if (!page) return;
    const btn = $(`[data-unlock-page="${CSS.escape(String(pageId))}"]`);
    if (btn) btn.disabled = true;
    try {
      await rpc("unlock_story_page", {p_page_id: pageId});
      await loadWallet(false);
      await openPage(pageId);
      toast("Page unlocked.");
    } catch (error) {
      toast(niceError(error), 5000);
      if (btn) btn.disabled = false;
    }
  }

  async function loadWallet(show = true) {
    if (!session || !isApproved()) return;
    try {
      const result = await rpc("get_token_balance");
      const row = Array.isArray(result) ? result[0] : result;
      if (show) renderWallet(row || {available_tokens:0,next_expiry:null});
      return row;
    } catch (error) {
      console.error("Wallet:", error);
      if (show) toast("Could not load token balance.");
    }
  }

  async function renderWalletView() {
    main.innerHTML = `<section class="page-wrap"><div class="page-heading"><p class="eyebrow">Your account</p><h2>Token wallet</h2><p>Credits expire seven days after they are issued. The earliest-expiring credits are spent first.</p></div><div id="walletPane" class="loading">Loading your wallet…</div></section>`;
    await loadWallet(true);
    try {
      const history = await rpc("get_token_history");
      const rows = Array.isArray(history) ? history : [];
      const host = $("#walletPane");
      const {available_tokens=0,next_expiry=null} = await loadWallet(false) || {};
      host.innerHTML = `<div class="stat-row"><div class="stat"><strong>${Number(available_tokens)}</strong><span>Available tokens</span></div><div class="stat"><strong>${next_expiry?dateText(next_expiry):"—"}</strong><span>Next expiry</span></div><div class="stat"><strong>35</strong><span>Daily starting allowance</span></div></div>
        <div class="panel"><h3>Daily credits</h3><p class="muted">Claim today's allowance. Claiming more than once on the same India calendar day will not duplicate credits.</p><button class="button" data-action="claim-tokens">Claim daily tokens</button></div>
        <div class="panel"><h3>Recent activity</h3>${rows.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Reason</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${dateText(r.created_at)}</td><td>${esc(r.transaction_type)}</td><td>${Number(r.amount)}</td><td>${esc(r.reason||"—")}</td></tr>`).join("")}</tbody></table></div>`:`<p class="muted">No token activity yet.</p>`}</div>`;
    } catch (error) {
      $("#walletPane").innerHTML = `<div class="notice danger-note">${esc(niceError(error))}</div>`;
    }
  }

  function renderWallet(row) {
    if (!$("#walletPane")) return;
    $("#walletPane").innerHTML = `<div class="stat-row"><div class="stat"><strong>${Number(row?.available_tokens||0)}</strong><span>Available tokens</span></div><div class="stat"><strong>${row?.next_expiry?dateText(row.next_expiry):"—"}</strong><span>Next expiry</span></div><div class="stat"><strong>35</strong><span>Daily starting allowance</span></div></div>`;
  }

  async function claimTokens() {
    try {
      const result = await rpc("claim_daily_tokens");
      const credited = typeof result === "object" ? result.credited : null;
      toast(credited === false ? "Today's tokens have already been claimed." : "Daily token claim processed.");
      if (activeView === "wallet") await renderWalletView();
      else await loadWallet(false);
    } catch (error) { toast(niceError(error), 5000); }
  }

  async function submitAuthorApplication(form) {
    if (!session || !isApproved()) return toast("An approved account is required to apply.");
    const fd = new FormData(form);
    const biography = String(fd.get("biography")||"").trim();
    if (biography.length < 30) return toast("Please write a little more in your biography.");
    try {
      const {error} = await supa.from("author_applications").insert({user_id:userId(),biography,writing_samples:[]});
      if (error) throw error;
      toast("Author application submitted for review.");
      renderAuthorView();
    } catch (error) { toast(niceError(error), 5000); }
  }

  async function loadAuthorStories() {
    const {data,error} = await supa.from("stories").select("id,title,synopsis,genre,status,created_at,updated_at").eq("author_id",userId()).order("created_at",{ascending:false});
    if (error) throw error;
    authorStories = data || [];
    return authorStories;
  }

  async function renderAuthorView() {
    main.innerHTML = `<section class="page-wrap"><div class="page-heading"><p class="eyebrow">For writers</p><h2>Author studio</h2><p>Create a draft, organise chapters and add pages. Only administrators can publish a story.</p></div><div id="authorPane" class="loading">Loading author workspace…</div></section>`;
    try {
      await loadAuthorStories();
      const {data:apps,error:appError} = await supa.from("author_applications").select("status,admin_note,created_at").eq("user_id",userId()).order("created_at",{ascending:false}).limit(5);
      if (appError) throw appError;
      const hasAuthor = roles.includes("author") || roleIsAdmin();
      const appPanel = !hasAuthor ? `<div class="panel"><h3>Apply to become an author</h3><p class="muted">Share a short biography. An administrator will review the application.</p><form id="authorApplicationForm" class="form-stack"><label class="field">Biography<textarea name="biography" minlength="30" required placeholder="Tell readers and reviewers a little about your writing…"></textarea></label><button class="button" type="submit">Submit application</button></form>${(apps||[]).map(a=>`<p class="form-note">Latest application: <strong>${esc(a.status)}</strong>${a.admin_note?` — ${esc(a.admin_note)}`:""}</p>`).join("")}</div>` : "";
      const storyRows = authorStories.map(s=>`<div class="list-item"><div><strong>${esc(s.title)}</strong><small>${esc(s.genre||"Uncategorised")} · Status: ${esc(s.status)}</small></div><div class="list-actions"><button class="button button-outline button-xs" data-edit-story="${esc(s.id)}">Manage chapters</button></div></div>`).join("") || `<p class="muted">No stories created yet.</p>`;
      $("#authorPane").innerHTML = `${appPanel}${hasAuthor?`<div class="panel"><h3>Create a story draft</h3><form id="newStoryForm" class="form-grid"><label class="field">Title<input name="title" maxlength="180" required></label><label class="field">Genre<input name="genre" maxlength="60" placeholder="Fantasy, science fiction…"></label><label class="field">Tags <span class="help">Separate tags with commas.</span><input name="tags" placeholder="mystery, friendship"></label><label class="field">Cover image path or public URL<input name="cover_path" placeholder="Optional"></label><label class="field" style="grid-column:1/-1">Synopsis<textarea name="synopsis" maxlength="2000"></textarea></label><div class="form-actions" style="grid-column:1/-1"><button class="button" type="submit">Save draft</button></div></form></div>`:""}<div class="panel"><h3>Your stories</h3><div class="item-list">${storyRows}</div></div><div id="storyEditor"></div>`;
    } catch (error) { $("#authorPane").innerHTML = `<div class="notice danger-note">${esc(niceError(error))}</div>`; }
  }

  async function createStory(form) {
    const fd = new FormData(form);
    const payload = {author_id:userId(),title:String(fd.get("title")).trim(),synopsis:String(fd.get("synopsis")||"").trim(),genre:String(fd.get("genre")||"").trim()||null,tags:String(fd.get("tags")||"").split(",").map(x=>x.trim()).filter(Boolean),cover_path:String(fd.get("cover_path")||"").trim()||null,status:"draft"};
    try {
      const {error} = await supa.from("stories").insert(payload);
      if (error) throw error;
      toast("Draft saved."); renderAuthorView();
    } catch (error) { toast(niceError(error),5000); }
  }

  async function editStory(storyId) {
    const story = authorStories.find(s=>String(s.id)===String(storyId));
    if (!story) return;
    const host = $("#storyEditor");
    host.innerHTML = `<div class="panel"><h3>${esc(story.title)} · Chapter manager</h3><p class="muted">Add a chapter, then add numbered pages to it. The first five pages across the story are free.</p><form id="newChapterForm" class="form-grid"><input type="hidden" name="story_id" value="${esc(story.id)}"><label class="field">Chapter title<input name="title" required maxlength="180"></label><label class="field">Chapter number<input name="chapter_number" type="number" min="1" step="1" required></label><div class="form-actions" style="grid-column:1/-1"><button class="button" type="submit">Add chapter</button></div></form><div id="chapterAdminList" class="item-list" style="margin-top:16px">Loading chapters…</div></div>`;
    try {
      const {data,error} = await supa.from("chapters").select("id,title,chapter_number").eq("story_id",story.id).order("chapter_number");
      if (error) throw error;
      const list = $("#chapterAdminList");
      list.innerHTML = (data||[]).map(ch=>`<div class="list-item"><div><strong>${esc(ch.chapter_number)}. ${esc(ch.title)}</strong><small>Chapter ID: ${esc(ch.id)}</small></div><div class="list-actions"><button class="button button-outline button-xs" data-edit-chapter="${esc(ch.id)}" data-chapter-title="${esc(ch.title)}">Add pages</button></div></div>`).join("") || `<p class="muted">No chapters yet.</p>`;
    } catch (error) { $("#chapterAdminList").textContent = niceError(error); }
  }

  async function createChapter(form) {
    const fd = new FormData(form);
    const payload = {story_id:String(fd.get("story_id")),title:String(fd.get("title")).trim(),chapter_number:Number(fd.get("chapter_number"))};
    try {
      const {error} = await supa.from("chapters").insert(payload);
      if (error) throw error;
      toast("Chapter added.");
      await editStory(payload.story_id);
    } catch (error) { toast(niceError(error),5000); }
  }

  async function editChapter(chapterId, title) {
    const host = $("#storyEditor");
    let form = $("#newPageForm");
    if (!form) {
      const wrapper = document.createElement("div"); wrapper.innerHTML = `<div class="panel" id="pageComposer"><h3>Add pages to ${esc(title)}</h3><form id="newPageForm" class="form-stack"><input type="hidden" name="chapter_id" value="${esc(chapterId)}"><label class="field">Page number<input name="page_number" type="number" min="1" step="1" required></label><label class="field">Token cost<input name="token_cost" type="number" min="0" step="1" value="0" required></label><label class="field">Page content<textarea name="content" required placeholder="Write the complete page content here…"></textarea></label><button class="button" type="submit">Save page</button></form></div>`;
      host.appendChild(wrapper.firstElementChild);
    } else {
      form.elements.chapter_id.value = chapterId;
      $("#pageComposer h3").textContent = `Add pages to ${title}`;
    }
    $("#pageComposer")?.scrollIntoView({behavior:"smooth",block:"start"});
  }

  async function createPage(form) {
    const fd = new FormData(form);
    const payload = {chapter_id:String(fd.get("chapter_id")),page_number:Number(fd.get("page_number")),token_cost:Number(fd.get("token_cost")),content:String(fd.get("content")||"")};
    try {
      const {error} = await supa.from("story_pages").insert(payload);
      if (error) throw error;
      toast("Page saved."); form.reset(); form.elements.token_cost.value = "0";
    } catch (error) { toast(niceError(error),5000); }
  }

  async function renderAdminView() {
    if (!roleIsAdmin()) return toast("Administrator access is required.");
    main.innerHTML = `<section class="page-wrap"><div class="page-heading"><p class="eyebrow">Restricted workspace</p><h2>Administration</h2><p>Review accounts, author applications and submitted stories. All changes are checked by Supabase row-level security.</p></div><div id="adminPane" class="loading">Loading administration data…</div></section>`;
    try {
      const [users, apps, stories] = await Promise.all([
        supa.from("profiles").select("id,full_name,phone,approval_status,created_at").order("created_at",{ascending:false}).limit(100),
        supa.from("author_applications").select("id,user_id,biography,status,admin_note,created_at").eq("status","pending").order("created_at"),
        supa.from("stories").select("id,author_id,title,status,genre,created_at").eq("status","pending_review").order("created_at")
      ]);
      for (const result of [users,apps,stories]) if (result.error) throw result.error;
      adminProfiles = users.data || [];
      const userRows = adminProfiles.map(p=>`<tr><td>${esc(p.full_name||"Reader")}<small class="muted">${esc(p.phone||"")}</small><div class="mono">${esc(p.id)}</div></td><td>${esc(p.approval_status)}</td><td><div class="list-actions">${p.approval_status!=="approved"?`<button class="button button-xs" data-user-status="approved" data-user-id="${esc(p.id)}">Approve</button>`:""}${p.approval_status!=="rejected"?`<button class="button button-outline button-xs" data-user-status="rejected" data-user-id="${esc(p.id)}">Reject</button>`:""}</div></td></tr>`).join("");
      const appRows = (apps.data||[]).map(a=>`<tr><td><strong>${esc(a.user_id)}</strong><p>${esc(a.biography)}</p></td><td>${dateText(a.created_at)}</td><td><input class="input" id="adminNote-${esc(a.id)}" placeholder="Optional note" maxlength="500"></td><td><div class="list-actions"><button class="button button-xs" data-review-app="approved" data-app-id="${esc(a.id)}">Approve</button><button class="button button-outline button-xs" data-review-app="rejected" data-app-id="${esc(a.id)}">Reject</button></div></td></tr>`).join("");
      const storyRows = (stories.data||[]).map(s=>`<tr><td><strong>${esc(s.title)}</strong><div class="mono">${esc(s.id)}</div></td><td>${esc(s.author_id)}</td><td><div class="list-actions"><button class="button button-xs" data-story-status="published" data-story-id="${esc(s.id)}">Publish</button><button class="button button-outline button-xs" data-story-status="rejected" data-story-id="${esc(s.id)}">Reject</button></div></td></tr>`).join("");
      $("#adminPane").innerHTML = `<div class="panel"><h3>Account approvals</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>User / UID</th><th>Status</th><th>Action</th></tr></thead><tbody>${userRows||`<tr><td colspan="3">No profiles found.</td></tr>`}</tbody></table></div></div>
        <div class="panel"><h3>Author applications awaiting review</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Applicant / biography</th><th>Submitted</th><th>Admin note</th><th>Decision</th></tr></thead><tbody>${appRows||`<tr><td colspan="4">No pending applications.</td></tr>`}</tbody></table></div></div>
        <div class="panel"><h3>Stories awaiting publication review</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Story</th><th>Author UID</th><th>Decision</th></tr></thead><tbody>${storyRows||`<tr><td colspan="3">No stories awaiting review.</td></tr>`}</tbody></table></div></div>
        <div class="panel"><h3>Platform analytics</h3><div id="adminAnalytics" class="loading">Preparing analytics…</div></div>
        <div class="panel"><h3>Backup & recovery</h3><p>For a full database backup, use the database export/backup method supported by your Supabase plan. Automated backup availability depends on your plan. This application cannot safely create a full database dump from a browser session. You can export published catalogue metadata below.</p><button class="button button-outline button-xs" data-action="export-catalogue">Export catalogue CSV</button><p class="form-note">Private story pages, authentication secrets and private files are intentionally excluded.</p></div>
        ${roles.includes("owner")?`<div class="panel"><h3>Owner role management</h3><p class="muted">Use the profile UID from the account list. Only the Owner can manage roles.</p><form id="roleForm" class="form-grid"><label class="field">User UID<input name="user_id" required></label><label class="field">Role<select name="role"><option value="admin">Admin</option><option value="author">Author</option><option value="reader">Reader</option></select></label><div class="form-actions" style="grid-column:1/-1"><button class="button" type="submit">Grant role</button></div></form></div>`:""}
        <div class="panel"><h3>Quest management</h3><form id="questForm" class="form-grid"><label class="field">Title<input name="title" required maxlength="160"></label><label class="field">Reward tokens<input name="reward_tokens" type="number" min="0" max="100000" value="0"></label><label class="field">Starts at<input name="starts_at" type="datetime-local"></label><label class="field">Deadline<input name="deadline" type="datetime-local"></label><label class="field">Maximum completions (optional)<input name="max_completions" type="number" min="1"></label><label class="field" style="grid-column:1/-1">Instructions<textarea name="instructions" required maxlength="5000"></textarea></label><div class="form-actions"><button class="button">Create active quest</button></div></form></div>
        <div class="panel"><h3>Quest submissions</h3><div id="adminQuestRows" class="loading">Loading submissions…</div></div>
        <div class="panel"><h3>Moderate comments & reviews</h3><div id="adminModerationRows" class="loading">Loading moderation queue…</div></div>
        <div class="panel"><h3>Reports & support</h3><div id="adminHelpRows" class="loading">Loading reports and support messages…</div></div>`;
      loadAdminExtras();
      loadAdminAnalytics();
    } catch (error) { $("#adminPane").innerHTML = `<div class="notice danger-note">${esc(niceError(error))}<br>Confirm that this account has an admin or owner role and that the admin RLS policies are enabled.</div>`; }
  }

  async function loadAdminExtras(){try{const [qs,cs,rs,reps,sups]=await Promise.all([supa.from("quest_submissions").select("id,quest_id,user_id,message,evidence_path,status,submitted_at").eq("status","pending").order("submitted_at"),supa.from("comments").select("id,user_id,story_id,comment_text,created_at").eq("moderation_status","pending").order("created_at").limit(50),supa.from("reviews").select("id,user_id,story_id,rating,review_text,created_at").eq("moderation_status","pending").order("created_at").limit(50),supa.from("reports").select("id,reporter_id,target_type,target_id,reason,details,created_at").eq("status","open").order("created_at"),supa.from("support_messages").select("id,user_id,subject,message,created_at").eq("status","open").order("created_at")]);for(const x of [qs,cs,rs,reps,sups])if(x.error)throw x.error;
    const qnames=new Map();const qids=[...new Set((qs.data||[]).map(x=>x.quest_id))];if(qids.length){const q=await supa.from("quests").select("id,title,reward_tokens").in("id",qids);if(!q.error)(q.data||[]).forEach(x=>qnames.set(x.id,x));}
    $("#adminQuestRows").innerHTML=(qs.data||[]).map(x=>`<div class="panel"><strong>${esc(qnames.get(x.quest_id)?.title||"Quest")}</strong><p>${esc(x.message||"")}</p><small class="muted">User ${esc(x.user_id)} · ${dateText(x.submitted_at)} · Reward ${Number(qnames.get(x.quest_id)?.reward_tokens||0)}</small>${x.evidence_path?`<p><button class="button button-outline button-xs" data-evidence="${esc(x.evidence_path)}">View private evidence</button></p>`:""}<input class="input" id="questNote-${esc(x.id)}" placeholder="Optional reviewer note"><div class="form-actions"><button class="button button-xs" data-quest-approve="${esc(x.id)}">Approve & credit</button><button class="button button-outline button-xs" data-quest-reject="${esc(x.id)}">Reject</button></div></div>`).join("")||"<p class='muted'>No pending quest submissions.</p>";
    $("#adminModerationRows").innerHTML=`<h4>Comments</h4>${(cs.data||[]).map(x=>`<div class="list-item"><div>${esc(x.comment_text)}<small>${esc(x.user_id)}</small></div><div class="list-actions"><button class="button button-xs" data-comment-moderate="${esc(x.id)}" data-comment-status="approved">Approve</button><button class="button button-outline button-xs" data-comment-moderate="${esc(x.id)}" data-comment-status="rejected">Reject</button></div></div>`).join("")||"<p class='muted'>No pending comments.</p>"}<h4>Reviews</h4>${(rs.data||[]).map(x=>`<div class="list-item"><div>${Number(x.rating)}/5 · ${esc(x.review_text)}<small>${esc(x.user_id)}</small></div><div class="list-actions"><button class="button button-xs" data-review-moderate="${esc(x.id)}" data-review-status="approved">Approve</button><button class="button button-outline button-xs" data-review-moderate="${esc(x.id)}" data-review-status="rejected">Reject</button></div></div>`).join("")||"<p class='muted'>No pending reviews.</p>"}`;
    $("#adminHelpRows").innerHTML=`<h4>Open reports</h4>${(reps.data||[]).map(x=>`<div class="list-item"><div><strong>${esc(x.reason)}</strong><small>${esc(x.target_type)} ${esc(x.target_id)} · ${esc(x.details||"")}</small></div><button class="button button-xs" data-report-resolve="${esc(x.id)}">Resolve</button></div>`).join("")||"<p class='muted'>No open reports.</p>"}<h4>Support inbox</h4>${(sups.data||[]).map(x=>`<div class="panel"><strong>${esc(x.subject)}</strong><p>${esc(x.message)}</p><small>${esc(x.user_id||"Guest")}</small><textarea class="input" id="reply-${esc(x.id)}" placeholder="Reply to user"></textarea><button class="button button-xs" data-support-reply="${esc(x.id)}">Send reply</button></div>`).join("")||"<p class='muted'>No open support messages.</p>"}`;
  }catch(e){["adminQuestRows","adminModerationRows","adminHelpRows"].forEach(id=>{if($("#"+id))$("#"+id).innerHTML=`<div class="notice danger-note">${esc(niceError(e))}</div>`;});}}
  async function updateProfileStatus(id, status) {
    try {
      const {error} = await supa.from("profiles").update({approval_status:status,updated_at:new Date().toISOString()}).eq("id",id);
      if (error) throw error;
      toast(`Account marked ${status}.`); await renderAdminView();
      if (id === userId()) await refreshSessionData();
    } catch (error) { toast(niceError(error),5000); }
  }

  async function reviewAuthorApplication(id, decision) {
    try {
      const note = $(`#adminNote-${CSS.escape(String(id))}`)?.value || null;
      await rpc("review_author_application",{p_application_id:id,p_decision:decision,p_admin_note:note});
      toast(`Author application ${decision}.`); await renderAdminView();
    } catch (error) { toast(niceError(error),5000); }
  }

  async function updateStoryStatus(id, status) {
    try {
      const patch = {status,updated_at:new Date().toISOString()};
      if (status === "published") patch.published_at = new Date().toISOString();
      const {error} = await supa.from("stories").update(patch).eq("id",id);
      if (error) throw error;
      toast(`Story marked ${status}.`); await renderAdminView();
    } catch (error) { toast(niceError(error),5000); }
  }

  async function grantRole(form) {
    if (!roles.includes("owner")) return;
    const fd = new FormData(form);
    const payload = {user_id:String(fd.get("user_id")).trim(),role:String(fd.get("role"))};
    try {
      const {error} = await supa.from("user_roles").upsert(payload,{onConflict:"user_id,role"});
      if (error) throw error;
      toast("Role granted."); form.reset();
    } catch (error) { toast(niceError(error),5000); }
  }

  async function renderAccountView() {
    const p = profile || {};

    main.innerHTML = `<section class="page-wrap"><div class="page-heading"><p class="eyebrow">Your OnceUpon identity</p><h2>Profile & settings</h2><p>Manage your public author presence, privacy and reading experience.</p></div>
      <div class="panel"><div class="profile-header"><img id="profileAvatar" class="avatar" alt="Profile photo" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100%25' height='100%25' fill='%2330313c'/%3E%3Ctext x='50%25' y='58%25' text-anchor='middle' font-size='40' fill='%23d7c19a'%3E${esc((p.full_name||"U").slice(0,1).toUpperCase())}%3C/text%3E%3C/svg%3E"><div><h3>${esc(p.full_name||"Your profile")}</h3><p class="muted">${esc(session?.user?.email||"")}</p><span class="tag">${esc(p.approval_status||"pending")} · ${roles.map(esc).join(", ")||"reader"}</span></div></div>
      <form id="profileForm" class="form-grid" style="margin-top:18px"><label class="field">Display name<input name="full_name" maxlength="100" required value="${esc(p.full_name||"")}"></label><label class="field">Phone (optional)<input name="phone" type="tel" maxlength="40" value="${esc(p.phone||"")}"></label><label class="field">Profile photo (JPG, PNG or WebP; max 5 MB)<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp"></label><label class="field" style="grid-column:1/-1">Bio<textarea name="bio" maxlength="1200" placeholder="Tell readers a little about yourself…">${esc(p.bio||"")}</textarea></label><label class="field">Instagram profile URL<input name="instagram_url" type="url" placeholder="https://www.instagram.com/username/" value="${esc(p.instagram_url||"")}"></label><label class="field">Profile visibility<select name="is_profile_public"><option value="true" ${p.is_profile_public!==false?"selected":""}>Public</option><option value="false" ${p.is_profile_public===false?"selected":""}>Private</option></select></label><label class="field">Online visibility<select name="online_visible"><option value="false" ${!p.online_visible?"selected":""}>Hidden</option><option value="true" ${p.online_visible?"selected":""}>Show when I'm active</option></select></label><div class="form-actions" style="grid-column:1/-1"><button class="button" type="submit">Save profile</button></div></form></div>
      <div class="panel"><h3>Account security</h3><p class="muted">Email changes require confirmation from Supabase. Use a strong, unique password.</p><form id="emailForm" class="form-grid"><label class="field">New email<input name="email" type="email" required value="${esc(session?.user?.email||"")}"></label><div class="form-actions"><button class="button button-outline" type="submit">Update email</button></div></form><form id="passwordForm" class="form-grid"><label class="field">New password<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><div class="form-actions"><button class="button button-outline" type="submit">Change password</button></div></form></div>
      <div class="panel"><h3>Reading preferences</h3><div class="form-grid"><label class="field">Theme<select id="prefTheme"><option value="dark">Midnight Library</option><option value="light">Warm paper</option><option value="system">Use device setting</option></select></label><label class="field">Reading font<select id="prefFamily"><option value="serif">Literary serif</option><option value="sans">Modern sans-serif</option></select></label><label class="field">Text size<select id="prefFont"><option value="16">Small</option><option value="18">Regular</option><option value="20">Large</option><option value="22">Extra large</option></select></label><label class="field">Line spacing<select id="prefLine"><option value="1.6">Compact</option><option value="1.8">Comfortable</option><option value="2">Spacious</option></select></label><label class="field">Contrast<select id="prefContrast"><option value="normal">Normal</option><option value="high">High contrast</option></select></label><label class="field">Motion<select id="prefMotion"><option value="normal">Allow motion</option><option value="reduced">Reduce motion</option></select></label></div><div class="form-actions"><button class="button" data-action="save-preferences">Save preferences</button></div></div>
      <div class="notice">Approval status and account roles are managed by the OnceUpon administration team, not by profile settings.</div></section>`;
    const prefs=readPrefs();$("#prefTheme").value=prefs.theme;$("#prefFamily").value=prefs.family||"serif";$("#prefFont").value=String(prefs.font);$("#prefLine").value=String(prefs.line);$("#prefContrast").value=prefs.contrast;$("#prefMotion").value=prefs.motion||"normal";
    if(p.avatar_path){const url=await signedAvatar(p.avatar_path);if(url&&$("#profileAvatar"))$("#profileAvatar").src=url;}
  }

  function readPrefs() {
    try { return {...{theme:"dark",font:18,line:1.8,contrast:"normal",family:"serif",motion:"normal"},...JSON.parse(localStorage.getItem("onceupon-prefs")||"{}")} }
    catch { return {theme:"dark",font:18,line:1.8,contrast:"normal",family:"serif",motion:"normal"}; }
  }
  function applyReadingPrefs() {
    const prefs = readPrefs();
    const text = $("#readerText");
    if (text) { text.style.fontSize = `${prefs.font}px`; text.style.lineHeight = prefs.line; text.style.fontFamily = prefs.family === "sans" ? "Inter, sans-serif" : "Cormorant Garamond, Georgia, serif"; }
  }
  function savePrefs() {
    const prefs = {theme:$("#prefTheme").value,font:Number($("#prefFont").value),line:Number($("#prefLine").value),contrast:$("#prefContrast").value,family:$("#prefFamily")?.value||"serif",motion:$("#prefMotion")?.value||"normal"};
    localStorage.setItem("onceupon-prefs",JSON.stringify(prefs));
    document.body.classList.toggle("theme-dark",prefs.theme==="dark");
    document.body.classList.toggle("theme-light",prefs.theme==="light"||(prefs.theme==="system"&&window.matchMedia?.("(prefers-color-scheme: light)").matches));
    document.documentElement.style.setProperty("--reader-motion",prefs.motion==="reduced"?"0":"1");document.body.classList.toggle("reduce-motion",prefs.motion==="reduced");
    document.body.classList.toggle("high-contrast",prefs.contrast==="high");
    toast("Reading preferences saved on this device.");
  }

  async function refreshSessionData() {
    if (!session) { profile=null;roles=[];updateChrome();renderHome();return; }
    try {
      const [{data:profileData,error:profileError},{data:roleData,error:roleError}] = await Promise.all([
        supa.from("profiles").select("id,full_name,phone,bio,instagram_url,avatar_path,is_profile_public,online_visible,last_seen_at,approval_status,created_at,updated_at").eq("id",userId()).maybeSingle(),
        supa.from("user_roles").select("role").eq("user_id",userId())
      ]);
      if (profileError) throw profileError;
      if (roleError) throw roleError;
      profile = profileData;
      syncPresence();
      roles = (roleData||[]).map(r=>r.role);
      updateChrome();
      if (isApproved()) {
        try { await rpc("claim_daily_tokens"); } catch (error) { console.info("Daily claim not made:", error.message); }
      }
      if (activeView === "admin" && roleIsAdmin()) await renderAdminView();
      else if (activeView === "author" && isApproved()) await renderAuthorView();
      else if (activeView === "wallet" && isApproved()) await renderWalletView();
      else if (activeView === "quests" && isApproved()) await renderQuestView();
      else if (activeView === "community" && isApproved()) await renderCommunityView();
      else if (activeView === "notifications" && isApproved()) await renderNotificationsView();
      else if (activeView === "help" && session) await renderHelpView();
      else if (activeView === "account") renderAccountView();
      else if (activeView === "reader" && currentStory) await openStory(currentStory.story_id);
      else if (activeView === "authors") await renderAuthorsView();
      else if (activeView === "author-profile" && window.__onceuponAuthorId) await renderAuthorProfileView(window.__onceuponAuthorId);
      else if (activeView === "messages") await renderMessagesView();
      else if (activeView === "ai") renderAIView();
      else if (activeView === "faq") renderFAQView();
      else if (activeView === "about") renderAboutView();
      else if (activeView === "guide") renderGuideView();
      else if (activeView === "legal") renderLegalView();
      else renderHome();
    } catch (error) {
      console.error("Account load:",error);
      main.innerHTML = `<section class="page-wrap"><div class="notice danger-note">Your session exists, but your OnceUpon profile or role could not be loaded: ${esc(niceError(error))}</div></section>`;
    }
  }

  async function handleLogin(form) {
    const fd = new FormData(form);
    setMessage($("#authMessage"),"Signing in…");
    try {
      const {data,error} = await supa.auth.signInWithPassword({email:String(fd.get("email")).trim(),password:String(fd.get("password"))});
      if (error) throw error;
      session = data.session;
      closeModal(); toast("Signed in."); await refreshSessionData();
    } catch (error) { setMessage($("#authMessage"),niceError(error),true); }
  }

  async function handleSignup(form) {
    const fd = new FormData(form);
    const email = String(fd.get("email")).trim();
    const fullName = String(fd.get("full_name")).trim();
    setMessage($("#authMessage"),"Creating your account…");
    try {
      const {data,error} = await supa.auth.signUp({email,password:String(fd.get("password")),options:{emailRedirectTo:window.location.origin,data:{full_name:fullName,phone:String(fd.get("phone")||"").trim()}}});
      if (error) throw error;
      if (data.session) {
        session = data.session; closeModal(); toast("Account created. Complete any requested email verification."); await refreshSessionData();
      } else {
        $("#verifyForm").elements.email.value = email;
        setAuthMode("verify");
        setMessage($("#authMessage"),"Account created. Check your inbox: enter the six-digit code if your email template sends OTP, or open the confirmation link if it sends a link.");
      }
    } catch (error) { setMessage($("#authMessage"),niceError(error),true); }
  }

  async function handleVerify(form) {
    const fd = new FormData(form);
    setMessage($("#authMessage"),"Verifying…");
    try {
      const {data,error} = await supa.auth.verifyOtp({email:String(fd.get("email")).trim(),token:String(fd.get("token")).trim(),type:"signup"});
      if (error) throw error;
      session = data.session; closeModal(); toast("Email verified. Your account is awaiting manual approval."); await refreshSessionData();
    } catch (error) { setMessage($("#authMessage"),niceError(error),true); }
  }

  async function resendOtp() {
    const email = $("#verifyForm").elements.email.value.trim();
    if (!email) return setMessage($("#authMessage"),"Enter your email address first.",true);
    try {
      const {error} = await supa.auth.resend({type:"signup",email});
      if (error) throw error;
      setMessage($("#authMessage"),"A new confirmation message has been requested.");
    } catch (error) { setMessage($("#authMessage"),niceError(error),true); }
  }

  async function forgotPassword() {
    const email = $("#loginForm").elements.email.value.trim();
    if (!email) return setMessage($("#authMessage"),"Enter your email in the sign-in form first.",true);
    try {
      const {error} = await supa.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin});
      if (error) throw error;
      setMessage($("#authMessage"),"Password reset email requested. Check your inbox.");
    } catch (error) { setMessage($("#authMessage"),niceError(error),true); }
  }

  async function signOut() {
    if(presenceTimer)clearInterval(presenceTimer);presenceTimer=null;if(notificationPollTimer)clearInterval(notificationPollTimer);notificationPollTimer=null;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    try { const {error} = await supa.auth.signOut(); if (error) throw error; }
    catch (error) { toast(niceError(error)); }
    session=null; profile=null; roles=[]; activeView="home"; updateChrome(); renderHome(); toast("Signed out.");
  }

  function setView(view) {
    const privateViews=["wallet","quests","community","notifications","help","account","messages"];
    if(privateViews.includes(view)&&!session){setAuthMode("login");return;}
    if(["wallet","quests","community","notifications"].includes(view)&&!isApproved()){toast("This area is available after account approval.");return;}
    if(view==="admin"&&!roleIsAdmin()){toast("Administrator access is required.");return;}
    if(view==="author"&&(!session||!isApproved())){if(!session)setAuthMode("login");else toast("An approved account is required to apply as an author.");return;}
    activeView = view;
    updateChrome();
    if (view === "home") renderHome();
    else if (view === "wallet") renderWalletView();
    else if (view === "author") renderAuthorView();
    else if (view === "admin") renderAdminView();
    else if (view === "account") renderAccountView();
    else if (view === "quests") renderQuestView();
    else if (view === "community") renderCommunityView();
    else if (view === "notifications") renderNotificationsView();
    else if (view === "guide") renderGuideView();
    else if (view === "legal") renderLegalView();
    else if (view === "about") renderAboutView();
    else if (view === "help") renderHelpView();
    else if (view === "authors") renderAuthorsView();
    else if (view === "author-profile") renderAuthorProfileView(window.__onceuponAuthorId);
    else if (view === "messages") renderMessagesView();
    else if (view === "ai") renderAIView();
    else if (view === "faq") renderFAQView();
  }

  // Feature-complete user workspaces mapped to the confirmed public schema.
  async function renderQuestView(){
    main.innerHTML=`<section class="page-wrap"><div class="page-heading"><p class="eyebrow">Write, explore, earn</p><h2>Community quests</h2><p>Complete creative challenges and submit evidence for moderator review.</p></div><div id="questHost" class="loading">Loading quests…</div></section>`;
    try{const [q,sub]=await Promise.all([supa.from("quests").select("id,title,instructions,reward_tokens,starts_at,deadline,max_completions,is_active,created_at").eq("is_active",true).order("created_at",{ascending:false}),supa.from("quest_submissions").select("id,quest_id,status,reviewer_note,submitted_at").eq("user_id",userId()).order("submitted_at",{ascending:false})]);if(q.error)throw q.error;if(sub.error)throw sub.error;
      const submitted=new Map((sub.data||[]).map(x=>[x.quest_id,x]));
      $("#questHost").innerHTML=(q.data||[]).length?(q.data||[]).map(x=>{const v=submitted.get(x.id);return `<article class="panel"><div class="section-heading"><div><h3>${esc(x.title)}</h3><small class="muted">Reward: ${Number(x.reward_tokens)} tokens · Deadline: ${dateText(x.deadline)}</small></div><span class="tag">${v?esc(v.status):"Open"}</span></div><p>${esc(x.instructions)}</p>${v?`<p class="form-note">Submitted ${dateText(v.submitted_at)}${v.reviewer_note?` · Moderator: ${esc(v.reviewer_note)}`:""}</p>`:`<form id="questSubmitForm" class="form-stack"><input type="hidden" name="quest_id" value="${esc(x.id)}"><label class="field">Your response<textarea name="message" maxlength="5000" placeholder="Describe your work or response…"></textarea></label><label class="field">Evidence image (optional)<input type="file" name="evidence" accept="image/png,image/jpeg,image/webp"></label><button class="button" type="submit">Submit quest</button></form>`}</article>`}).join(""):`<div class="empty-state">No active quests right now. Check back later.</div>`;
    }catch(e){$("#questHost").innerHTML=`<div class="notice danger-note">${esc(niceError(e))}</div>`;}
  }
  async function submitQuest(form){try{const fd=new FormData(form),qid=String(fd.get("quest_id"));let path=null;const file=fd.get("evidence");if(file&&file.size){if(file.size>5*1024*1024)throw new Error("Evidence image must be 5 MB or smaller.");if(!["image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("Use a JPG, PNG or WebP image.");const ext=file.type.split("/")[1].replace("jpeg","jpg"),name=`${userId()}/${crypto.randomUUID()}.${ext}`;const up=await supa.storage.from("quest-submissions").upload(name,file,{upsert:false,contentType:file.type});if(up.error)throw up.error;path=name;}
    const {error}=await supa.from("quest_submissions").insert({quest_id:qid,user_id:userId(),evidence_path:path,message:String(fd.get("message")||"").trim(),status:"pending"});if(error)throw error;toast("Quest submitted for review.");await renderQuestView();}catch(e){toast(niceError(e),5000);}}
  async function createQuest(form){try{const f=new FormData(form),row={title:String(f.get("title")).trim(),instructions:String(f.get("instructions")).trim(),reward_tokens:Math.max(0,Number(f.get("reward_tokens")||0)),starts_at:f.get("starts_at")||null,deadline:f.get("deadline")||null,max_completions:f.get("max_completions")?Number(f.get("max_completions")):null,is_active:true,created_by:userId()};const {error}=await supa.from("quests").insert(row);if(error)throw error;toast("Quest created.");await renderAdminView();}catch(e){toast(niceError(e),5000);}}
  async function reviewQuest(id,status){try{const note=$("#questNote-"+CSS.escape(id))?.value||null;const data=await rpc("review_quest_submission",{p_submission_id:id,p_decision:status,p_reviewer_note:note});toast(status==="approved"?`Quest approved. ${data?.reward_tokens||0} tokens credited.`:"Quest submission rejected.");await renderAdminView();}catch(e){toast(niceError(e),5000);}}
  async function renderCommunityView(){main.innerHTML=`<section class="page-wrap"><div class="page-heading"><p class="eyebrow">Your reading life</p><h2>My library</h2></div><div id="communityHost" class="loading">Loading your library…</div></section>`;try{const [b,l,p,n]=await Promise.all([supa.from("bookmarks").select("id,story_id,created_at").eq("user_id",userId()).order("created_at",{ascending:false}),supa.from("reading_lists").select("id,title,is_public,created_at").eq("user_id",userId()).order("created_at",{ascending:false}),supa.from("reading_progress").select("story_id,chapter_id,page_id,last_read_at").eq("user_id",userId()).order("last_read_at",{ascending:false}),supa.from("notifications").select("id,title,message,notification_type,is_read,created_at").eq("user_id",userId()).order("created_at",{ascending:false}).limit(30)]);for(const x of [b,l,p,n])if(x.error)throw x.error;
    const storyMap=new Map(catalogue.map(x=>[x.story_id,x]));const bookmarkRows=(b.data||[]).map(x=>`<div class="list-item"><div><strong>${esc(storyMap.get(x.story_id)?.title||"Saved story")}</strong><small>${dateText(x.created_at)}</small></div><button class="button button-outline button-xs" data-open-story="${esc(x.story_id)}">Open</button></div>`).join("");
    const listRows=(l.data||[]).map(x=>`<div class="list-item"><div><strong>${esc(x.title)}</strong><small>${x.is_public?"Public list":"Private list"}</small></div><button class="button button-outline button-xs" data-read-list-add="${esc(x.id)}">Add current story</button></div>`).join("");
    const progressRows=(p.data||[]).map(x=>`<div class="list-item"><div><strong>${esc(storyMap.get(x.story_id)?.title||"Reading in progress")}</strong><small>Last read ${dateText(x.last_read_at)}</small></div></div>`).join("");
    const noteRows=(n.data||[]).map(x=>`<div class="list-item"><div><strong>${esc(x.title)}</strong><small>${esc(x.message)} · ${dateText(x.created_at)}</small></div>${x.is_read?"<span class='tag'>Read</span>":`<button class="button button-xs" data-notification-read="${esc(x.id)}">Mark read</button>`}</div>`).join("");
    $("#communityHost").innerHTML=`<div class="panel"><h3>Bookmarks</h3><div class="item-list">${bookmarkRows||"<p class='muted'>No bookmarks yet. Save a story from its page.</p>"}</div></div><div class="panel"><h3>Reading lists</h3><form id="listForm" class="form-grid"><label class="field">New list name<input name="title" maxlength="80" required></label><label class="field">Visibility<select name="is_public"><option value="false">Private</option><option value="true">Public</option></select></label><div class="form-actions"><button class="button" type="submit">Create list</button></div></form><div class="item-list">${listRows}</div></div><div class="panel"><h3>Continue reading</h3><div class="item-list">${progressRows||"<p class='muted'>Your reading progress will appear here.</p>"}</div></div><div class="panel"><h3>Notifications</h3><div class="item-list">${noteRows||"<p class='muted'>You have no notifications.</p>"}</div></div>`;
    }catch(e){$("#communityHost").innerHTML=`<div class="notice danger-note">${esc(niceError(e))}</div>`;}}
  async function toggleBookmark(storyId){try{const {data,error}=await supa.from("bookmarks").select("id").eq("user_id",userId()).eq("story_id",storyId).maybeSingle();if(error)throw error;if(data){const d=await supa.from("bookmarks").delete().eq("id",data.id);if(d.error)throw d.error;toast("Bookmark removed.");}else{const a=await supa.from("bookmarks").insert({user_id:userId(),story_id:storyId});if(a.error)throw a.error;toast("Story bookmarked.");}if(activeView==="community")await renderCommunityView();}catch(e){toast(niceError(e),5000);}}
  async function createReadingList(form){try{const f=new FormData(form),{error}=await supa.from("reading_lists").insert({user_id:userId(),title:String(f.get("title")).trim(),is_public:f.get("is_public")==="true"});if(error)throw error;toast("Reading list created.");await renderCommunityView();}catch(e){toast(niceError(e),5000);}}
  async function addToList(listId){if(!currentStory)return toast("Open a story first, then add it to a list.");try{const {error}=await supa.from("reading_list_items").upsert({list_id:listId,story_id:currentStory.story_id},{onConflict:"list_id,story_id"});if(error)throw error;toast("Story added to reading list.");}catch(e){toast(niceError(e),5000);}}
  async function markNotification(id){const {error}=await supa.from("notifications").update({is_read:true}).eq("id",id).eq("user_id",userId());if(error)toast(niceError(error));else if(activeView==="notifications")await renderNotificationsView();else await renderCommunityView();}
  async function renderHelpView(){main.innerHTML=`<section class="page-wrap"><div class="page-heading"><p class="eyebrow">We're listening</p><h2>Help & feedback</h2></div><div class="panel"><h3>Contact support</h3><form id="supportForm" class="form-stack"><label class="field">Subject<input name="subject" maxlength="160" required></label><label class="field">Message<textarea name="message" maxlength="5000" required></textarea></label><button class="button">Send message</button></form></div><div class="panel"><h3>Report a concern</h3><form id="reportForm" class="form-stack"><label class="field">Target type<select name="target_type"><option value="story">Story</option><option value="comment">Comment</option><option value="review">Review</option><option value="user">User</option></select></label><label class="field">Target ID<input name="target_id" required></label><label class="field">Reason<input name="reason" maxlength="160" required></label><label class="field">Details<textarea name="details" maxlength="3000"></textarea></label><button class="button">Submit report</button></form></div></section>`;}
  async function sendSupport(form){try{const f=new FormData(form),{error}=await supa.from("support_messages").insert({user_id:userId(),subject:String(f.get("subject")).trim(),message:String(f.get("message")).trim()});if(error)throw error;toast("Support message sent.");form.reset();}catch(e){toast(niceError(e),5000);}}
  async function sendReport(form){try{const f=new FormData(form),{error}=await supa.from("reports").insert({reporter_id:userId(),target_type:String(f.get("target_type")),target_id:String(f.get("target_id")).trim(),reason:String(f.get("reason")).trim(),details:String(f.get("details")||"").trim()});if(error)throw error;toast("Report submitted for review.");form.reset();}catch(e){toast(niceError(e),5000);}}
  async function saveReview(form){try{const f=new FormData(form),{error}=await supa.from("reviews").upsert({user_id:userId(),story_id:currentStory.story_id,rating:Number(f.get("rating")),review_text:String(f.get("review_text")||"").trim(),moderation_status:"pending",updated_at:new Date().toISOString()},{onConflict:"user_id,story_id"});if(error)throw error;toast("Review submitted for moderation.");}catch(e){toast(niceError(e),5000);}}
  async function saveComment(form){try{const f=new FormData(form),{error}=await supa.from("comments").insert({user_id:userId(),story_id:currentStory.story_id,page_id:currentPage?.page_id||null,comment_text:String(f.get("comment_text")).trim(),moderation_status:"pending"});if(error)throw error;toast("Comment submitted for moderation.");}catch(e){toast(niceError(e),5000);}}
  async function moderateContent(table,id,status){try{const {error}=await supa.from(table).update({moderation_status:status}).eq("id",id);if(error)throw error;toast(`${table} marked ${status}.`);await renderAdminView();}catch(e){toast(niceError(e),5000);}}
  async function resolveReport(id){try{const {error}=await supa.from("reports").update({status:"resolved",resolved_by:userId(),resolved_at:new Date().toISOString()}).eq("id",id);if(error)throw error;toast("Report resolved.");await renderAdminView();}catch(e){toast(niceError(e),5000);}}
  async function replySupport(id){try{const reply=$("#reply-"+CSS.escape(id))?.value||"";if(!reply.trim())return toast("Enter a reply first.");const {error}=await supa.from("support_messages").update({admin_reply:reply.trim(),status:"replied",replied_by:userId(),replied_at:new Date().toISOString()}).eq("id",id);if(error)throw error;toast("Support reply sent.");await renderAdminView();}catch(e){toast(niceError(e),5000);}}

  async function startNotificationPolling(){if(notificationPollTimer||!session)return;try{const {data}=await supa.from("notifications").select("created_at").eq("user_id",userId()).order("created_at",{ascending:false}).limit(1);if(lastSeenNotificationAt===null&&data?.[0])lastSeenNotificationAt=new Date(data[0].created_at).getTime();}catch{}notificationPollTimer=setInterval(async()=>{try{const {data,error}=await supa.from("notifications").select("id,title,message,created_at").eq("user_id",userId()).eq("is_read",false).order("created_at",{ascending:false}).limit(5);if(error)throw error;const newest=(data||[])[0];if(newest){const stamp=new Date(newest.created_at).getTime();if(lastSeenNotificationAt===null)lastSeenNotificationAt=stamp;else if(stamp>lastSeenNotificationAt){lastSeenNotificationAt=stamp;toast(`${newest.title}: ${newest.message}`,6000);}}}catch(e){console.info("Notification check skipped",e.message);}},60000);}
  async function signedAvatar(path){if(!path||!supa)return "";try{const {data,error}=await supa.storage.from("profile-photos").createSignedUrl(path,300);if(error)throw error;return data?.signedUrl||"";}catch{return "";}}
  async function renderAuthorsView(){activeView="authors";updateChrome();main.innerHTML=`<section class="page-wrap"><div class="page-heading"><p class="eyebrow">Meet the storytellers</p><h2>Authors</h2><p>Discover the voices behind the stories and follow the writers you enjoy.</p></div><div id="authorsHost" class="story-grid"><div class="loading">Loading authors…</div></div></section>`;try{const {data,error}=await supa.from("public_author_profiles").select("id,full_name,bio,instagram_url,avatar_path,online_visible,is_online,last_seen_at,follower_count,published_story_count").order("full_name");if(error)throw error;const rows=await Promise.all((data||[]).map(async a=>({a,avatar:await signedAvatar(a.avatar_path)})));$("#authorsHost").innerHTML=rows.map(({a,avatar})=>`<article class="panel author-card">${avatar?`<img class="avatar" alt="${esc(a.full_name||"Author")}" src="${esc(avatar)}">`:`<div class="avatar" aria-label="Author initials">${esc((a.full_name||"A").slice(0,1).toUpperCase())}</div>`}<div><h3>${esc(a.full_name||"OnceUpon Author")}</h3><p>${esc(a.bio||"A OnceUpon storyteller.").slice(0,220)}</p><small class="muted">${Number(a.published_story_count)} published stories · ${Number(a.follower_count)} followers ${a.is_online?"· Online":""}</small><p><button class="button button-outline button-xs" data-open-author="${esc(a.id)}">View profile</button></p></div></article>`).join("")||`<div class="empty-state">No public author profiles are available yet.</div>`;}catch(e){$("#authorsHost").innerHTML=`<div class="notice danger-note">${esc(niceError(e))}<p>Run IMPLEMENTATION_MIGRATION.sql in Supabase before using author discovery.</p></div>`;}}
  async function renderAuthorProfileView(authorId){if(!authorId)return renderAuthorsView();activeView="author-profile";updateChrome();main.innerHTML=`<section class="page-wrap"><div class="loading">Loading author profile…</div></section>`;try{const [{data:a,error},{data:stories,error:storyErr}]=await Promise.all([supa.from("public_author_profiles").select("id,full_name,bio,instagram_url,avatar_path,online_visible,is_online,last_seen_at,follower_count,published_story_count").eq("id",authorId).maybeSingle(),supa.from("stories").select("id,title,synopsis,genre,cover_path,published_at").eq("author_id",authorId).eq("status","published").order("published_at",{ascending:false})]);if(error)throw error;if(storyErr)throw storyErr;if(!a)throw new Error("This author profile is unavailable or private.");const avatar=await signedAvatar(a.avatar_path);let following=false;if(session){const f=await supa.from("author_follows").select("id").eq("follower_id",userId()).eq("author_id",authorId).maybeSingle();if(!f.error)following=!!f.data;}main.innerHTML=`<section class="page-wrap"><button class="text-button" data-view="authors">← All authors</button><div class="panel"><div class="profile-header">${avatar?`<img class="avatar" alt="${esc(a.full_name)}" src="${esc(avatar)}">`:`<div class="avatar" aria-label="Author initials">${esc((a.full_name||"A").slice(0,1).toUpperCase())}</div>`}<div><p class="eyebrow">OnceUpon author</p><h2>${esc(a.full_name||"Author")}</h2><p class="muted">${Number(a.follower_count)} followers · ${Number(a.published_story_count)} stories ${a.is_online?"· Online":""}</p>${a.instagram_url?`<a href="${esc(a.instagram_url)}" target="_blank" rel="noopener noreferrer">Instagram profile</a>`:""}</div></div><p>${esc(a.bio||"This author hasn't added a biography yet.")}</p><div class="form-actions">${session&&userId()!==authorId?`<button class="button" data-action="toggle-follow" data-author-id="${esc(authorId)}">${following?"Unfollow":"Follow author"}</button><button class="button button-outline" data-action="start-author-thread" data-author-id="${esc(authorId)}">Contact author</button>`:!session?`<button class="button" data-action="signup">Create an account to follow</button>`:""}</div></div><div class="page-heading"><h2>Published stories</h2></div><div class="story-grid">${(stories||[]).map(st=>storyCard({...st,story_id:st.id})).join("")||`<div class="empty-state">This author hasn't published a story yet.</div>`}</div></section>`;}catch(e){main.innerHTML=`<section class="page-wrap"><div class="notice danger-note">${esc(niceError(e))}</div></section>`;}}
  async function toggleAuthorFollow(authorId){if(!session)return setAuthMode("login");try{const q=await supa.from("author_follows").select("id").eq("follower_id",userId()).eq("author_id",authorId).maybeSingle();if(q.error)throw q.error;if(q.data){const d=await supa.from("author_follows").delete().eq("id",q.data.id);if(d.error)throw d.error;toast("You unfollowed this author.");}else{const d=await supa.from("author_follows").insert({follower_id:userId(),author_id:authorId});if(d.error)throw d.error;toast("You are now following this author.");}await renderAuthorProfileView(authorId);}catch(e){toast(niceError(e),5000);}}
  async function syncPresence(){if(!session||!supa||!profile)return;startNotificationPolling();if(presenceTimer)clearInterval(presenceTimer);const send=async()=>{try{await supa.from("profiles").update({last_seen_at:new Date().toISOString()}).eq("id",userId()).eq("online_visible",true);}catch(e){console.info("Presence not updated",e.message);}};if(profile.online_visible){await send();presenceTimer=setInterval(send,180000);}else{await supa.from("profiles").update({last_seen_at:null}).eq("id",userId()).then(()=>{}).catch(()=>{});}}
  async function saveProfile(form){try{const f=new FormData(form||$("#profileForm"));const full_name=String(f.get("full_name")||"").trim();if(!full_name)throw new Error("Enter a display name.");let avatar_path=profile?.avatar_path||null;const file=f.get("avatar");if(file&&file.size){if(file.size>5*1024*1024)throw new Error("Profile photo must be 5 MB or smaller.");if(!["image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("Use a JPG, PNG or WebP image.");const ext=file.type.split("/")[1].replace("jpeg","jpg"),path=`${userId()}/${crypto.randomUUID()}.${ext}`;const up=await supa.storage.from("profile-photos").upload(path,file,{upsert:false,contentType:file.type});if(up.error)throw up.error;avatar_path=path;}const instagram=String(f.get("instagram_url")||"").trim();if(instagram&&!/^https:\/\/(www\.)?instagram\.com\//i.test(instagram))throw new Error("Enter a valid HTTPS Instagram profile URL.");const {error}=await supa.from("profiles").update({full_name,phone:String(f.get("phone")||"").trim()||null,bio:String(f.get("bio")||"").trim(),instagram_url:instagram||null,avatar_path,is_profile_public:f.get("is_profile_public")==="true",online_visible:f.get("online_visible")==="true"}).eq("id",userId());if(error)throw error;toast("Profile saved.");await refreshSessionData();}catch(e){toast(niceError(e),5000);}}
  async function updatePassword(form){try{const f=new FormData(form||$("#passwordForm"));const password=String(f.get("password")||"");if(password.length<8)throw new Error("Use at least 8 characters.");const {error}=await supa.auth.updateUser({password});if(error)throw error;toast("Password updated.");form?.reset();}catch(e){toast(niceError(e),5000);}}
  async function updateEmail(form){try{const f=new FormData(form||$("#emailForm"));const email=String(f.get("email")||"").trim();if(!email)throw new Error("Enter an email address.");const {error}=await supa.auth.updateUser({email});if(error)throw error;toast("Confirmation instructions sent to your email.");}catch(e){toast(niceError(e),5000);}}
  async function renderMessagesView(){activeView="messages";updateChrome();main.innerHTML=`<section class="page-wrap"><div class="page-heading"><p class="eyebrow">Reader ↔ author</p><h2>Author conversations</h2><p>Private conversations are only between a reader and the author they contact. There is no general user-to-user chat.</p></div><div id="messagesHost" class="loading">Loading conversations…</div></section>`;try{const {data,error}=await supa.from("author_threads").select("id,reader_id,author_id,subject,status,updated_at").or(`reader_id.eq.${userId()},author_id.eq.${userId()}`).order("updated_at",{ascending:false});if(error)throw error;const ids=[...new Set((data||[]).map(t=>t.reader_id===userId()?t.author_id:t.reader_id))];let names=new Map();if(ids.length){const q=await supa.from("public_author_profiles").select("id,full_name").in("id",ids);if(!q.error)(q.data||[]).forEach(x=>names.set(x.id,x.full_name));}$("#messagesHost").innerHTML=(data||[]).map(t=>`<div class="list-item"><div><strong>${esc(t.subject)}</strong><small>${esc(names.get(t.reader_id===userId()?t.author_id:t.reader_id)||"Conversation participant")} · ${esc(t.status)} · ${dateText(t.updated_at)}</small></div><button class="button button-outline button-xs" data-open-thread="${esc(t.id)}">Open</button></div>`).join("")||`<div class="empty-state">No author conversations yet. Visit an author's profile to contact them.</div>`;}catch(e){$("#messagesHost").innerHTML=`<div class="notice danger-note">${esc(niceError(e))}<p>Run IMPLEMENTATION_MIGRATION.sql first.</p></div>`;}}
  async function startAuthorThread(authorId){if(!session||!isApproved())return toast("Sign in with an approved account to contact an author.");main.innerHTML=`<section class="page-wrap"><div class="panel"><h3>Start a conversation</h3><form id="startThreadForm" class="form-stack"><input type="hidden" name="author_id" value="${esc(authorId)}"><label class="field">Subject<input name="subject" maxlength="160" required></label><label class="field">Message<textarea name="body" maxlength="5000" required></textarea></label><button class="button">Send message</button></form></div></section>`;}
  async function createAuthorThread(form){try{const f=new FormData(form),author_id=String(f.get("author_id")),subject=String(f.get("subject")).trim(),body=String(f.get("body")).trim();const {data,error}=await supa.from("author_threads").insert({reader_id:userId(),author_id,subject}).select("id").single();if(error)throw error;const msg=await supa.from("author_messages").insert({thread_id:data.id,sender_id:userId(),body});if(msg.error)throw msg.error;activeThreadId=data.id;toast("Message sent to the author.");await renderThreadView(data.id);}catch(e){toast(niceError(e),5000);}}
  async function renderThreadView(threadId){main.innerHTML=`<section class="page-wrap"><div class="loading">Loading conversation…</div></section>`;try{const {data:t,error}=await supa.from("author_threads").select("id,reader_id,author_id,subject,status,updated_at").eq("id",threadId).single();if(error)throw error;const q=await supa.from("author_messages").select("id,sender_id,body,created_at").eq("thread_id",threadId).order("created_at");if(q.error)throw q.error;main.innerHTML=`<section class="page-wrap"><button class="text-button" data-view="messages">← Conversations</button><div class="page-heading"><h2>${esc(t.subject)}</h2><p class="muted">${esc(t.status)} conversation</p></div><div class="panel">${(q.data||[]).map(m=>`<div class="message-bubble ${m.sender_id===userId()?"mine":""}">${esc(m.body)}<div class="message-meta">${m.sender_id===userId()?"You":"Author / reader"} · ${dateText(m.created_at)}</div></div>`).join("")}<form id="authorMessageForm" class="form-stack"><input type="hidden" name="thread_id" value="${esc(threadId)}"><label class="field">Reply<textarea name="body" maxlength="5000" required ${t.status==="closed"?"disabled":""}></textarea></label><button class="button" ${t.status==="closed"?"disabled":""}>Send reply</button></form><div class="form-actions">${t.status==="open"?`<button class="button button-outline button-xs" data-action="close-thread" data-thread-id="${esc(threadId)}">Close conversation</button>`:`<button class="button button-outline button-xs" data-action="reopen-thread" data-thread-id="${esc(threadId)}">Reopen conversation</button>`}</div></div></section>`;}catch(e){main.innerHTML=`<section class="page-wrap"><div class="notice danger-note">${esc(niceError(e))}</div></section>`;}}
  async function sendAuthorMessage(form){try{const f=new FormData(form),thread_id=String(f.get("thread_id")),body=String(f.get("body")).trim();const {error}=await supa.from("author_messages").insert({thread_id,sender_id:userId(),body});if(error)throw error;await supa.from("author_threads").update({updated_at:new Date().toISOString()}).eq("id",thread_id);await renderThreadView(thread_id);}catch(e){toast(niceError(e),5000);}}
  async function setThreadStatus(id,status){try{const {error}=await supa.from("author_threads").update({status,updated_at:new Date().toISOString()}).eq("id",id);if(error)throw error;await renderThreadView(id);}catch(e){toast(niceError(e),5000);}}
  async function renderNotificationsView(){activeView="notifications";updateChrome();main.innerHTML=`<section class="page-wrap"><div class="page-heading"><p class="eyebrow">Your updates</p><h2>Notification centre</h2><p>Publication announcements and account updates.</p></div><div id="notificationHost" class="loading">Loading notifications…</div></section>`;try{const {data,error}=await supa.from("notifications").select("id,title,message,notification_type,is_read,created_at").eq("user_id",userId()).order("created_at",{ascending:false}).limit(100);if(error)throw error;$("#notificationHost").innerHTML=(data||[]).map(n=>`<div class="list-item"><div><strong>${esc(n.title)}</strong><small>${esc(n.message)} · ${dateText(n.created_at)} · ${esc(n.notification_type||"update")}</small></div>${n.is_read?`<span class="tag">Read</span>`:`<button class="button button-xs" data-notification-read="${esc(n.id)}">Mark read</button>`}</div>`).join("")||`<div class="empty-state">You have no notifications yet.</div>`;}catch(e){$("#notificationHost").innerHTML=`<div class="notice danger-note">${esc(niceError(e))}</div>`;}}
  function renderGuideView(){activeView="guide";updateChrome();main.innerHTML=`<section class="page-wrap"><div class="page-heading"><p class="eyebrow">Getting started</p><h2>OnceUpon user guide</h2></div><div class="panel"><h3>Readers</h3><ol><li>Browse the public library and open a story to view its chapters.</li><li>Create an account, verify your email and wait for approval to read protected pages.</li><li>Claim daily tokens from My tokens. The first five pages of each story are free.</li><li>Save bookmarks, create reading lists and track progress in My library.</li><li>Use reading preferences to change theme, type size, font, spacing and motion.</li></ol><h3>Authors</h3><ol><li>Use Write to submit an author application.</li><li>After approval, create a draft, add chapters and pages, then submit it for review.</li><li>Use your public author profile to share a biography and optional Instagram link.</li><li>Readers can follow your public profile and contact you through private author conversations.</li></ol><h3>Privacy & safety</h3><p>Online visibility is optional. Never share passwords, verification codes, private contact details or personal location in public story comments. Report concerns through Help & feedback.</p><p>Need assistance? <a href="mailto:onceupon.admin@gmail.com">onceupon.admin@gmail.com</a></p></div></section>`;}
  function renderAboutView(){activeView="about";updateChrome();main.innerHTML=`<section class="page-wrap"><div class="page-heading"><p class="eyebrow">Our little corner of literature</p><h2>About OnceUpon</h2></div><div class="panel"><h3>Where every story finds its reader.</h3><p>OnceUpon is a community reading and writing space designed to help readers discover stories and help writers share their work. The platform combines a public story catalogue, a focused reading experience, author profiles, and moderated reader-author conversations.</p><p>OnceUpon is free to use. It does not sell subscriptions, tokens or paid features.</p><p>Questions or feedback: <a href="mailto:onceupon.admin@gmail.com">onceupon.admin@gmail.com</a></p></div></section>`;}
  function renderLegalView(){activeView="legal";updateChrome();main.innerHTML=`<section class="page-wrap"><div class="page-heading"><p class="eyebrow">Trust & safety</p><h2>Privacy and community guidelines</h2></div><div class="panel"><h3>Privacy</h3><p>OnceUpon uses account information to provide reading, writing, moderation and support features. Public author profile fields are shown only when profile visibility is enabled. Email addresses and phone numbers are not included in public author profiles. Online presence is opt-in.</p><h3>Community guidelines</h3><ul><li>Respect authors, readers and moderators.</li><li>Post only content you have the right to share.</li><li>Do not post harassment, threats, private information or spam.</li><li>Use reports for genuine safety, copyright or moderation concerns.</li><li>Do not attempt to bypass token, approval or access controls.</li></ul><h3>Account and data requests</h3><p>For account assistance or privacy requests, contact <a href="mailto:onceupon.admin@gmail.com">onceupon.admin@gmail.com</a>. This page is a platform guidance summary, not legal advice.</p></div></section>`;}
  async function installApp(){if(deferredInstallPrompt){deferredInstallPrompt.prompt();const choice=await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;toast(choice?.outcome==="accepted"?"OnceUpon installation started.":"Installation was not completed.");}else toast("If installation is supported, open your browser menu and choose Install app or Add to Home screen.",5000);}
  function renderAIView(){activeView="ai";updateChrome();main.innerHTML=`<section class="page-wrap"><div class="page-heading"><p class="eyebrow">A free creative companion</p><h2>Ask OnceUpon AI</h2><p>This assistant works locally in your browser using the public story catalogue and built-in writing guidance. Your prompts are not sent to a third-party AI provider.</p></div><div class="panel assistant-panel"><div id="aiReply" class="assistant-reply">Hello! I can help you discover stories, brainstorm a plot, improve a character, or give general writing feedback. What are you working on?</div><form id="aiForm" class="form-stack"><label class="field">Your question<textarea name="prompt" maxlength="3000" required placeholder="Ask for story recommendations or writing feedback…"></textarea></label><button class="button" type="submit">Ask OnceUpon AI</button></form></div></section>`;}
  function runAIResponse(form){const prompt=String(new FormData(form||$("#aiForm")).get("prompt")||"").trim();if(!prompt)return;const q=prompt.toLowerCase();let reply="";if(/recommend|suggest|find|read|story/.test(q)){const terms=q.split(/\W+/).filter(w=>w.length>3);const found=catalogue.filter(s=>terms.some(t=>[s.title,s.synopsis,s.genre,...(s.tags||[])].join(" ").toLowerCase().includes(t))).slice(0,5);reply=found.length?"Here are catalogue matches you may enjoy:\n"+found.map(s=>`• ${s.title} — ${s.genre||"Fiction"}: ${s.synopsis||"Explore this story on OnceUpon."}`).join("\n"):"I couldn't find an exact catalogue match. Try searching by genre, theme, or a keyword such as mystery, fantasy, or science fiction.";}else if(/character|protagonist|villain/.test(q)){reply="Character-development checklist:\n1. Give the character a concrete goal.\n2. Add a contradiction between what they want and what they need.\n3. Give them a believable fear or limitation.\n4. Make choices—not exposition—reveal their personality.\n5. Let the character change through consequences.";}else if(/plot|story idea|premise|brainstorm/.test(q)){reply="A useful plot seed: give your protagonist a goal, a deadline, and one piece of information that changes the meaning of everything they believed. Build three turning points: discovery, costly choice, and consequence. Keep the central conflict specific enough that the character must act.";}else if(/feedback|improve|review|writing/.test(q)){reply="For a useful revision, check five layers:\n• Clarity: can readers follow who acts and why?\n• Scene purpose: does something change by the end?\n• Specificity: replace vague description with concrete details.\n• Voice: make dialogue sound distinct for each character.\n• Pacing: vary reflection, action, and dialogue.\nIf you paste a short excerpt, I can give structured feedback on clarity, pacing, character and style.";}else{reply="I can help with story discovery, plot brainstorming, character development, and general writing feedback. Try asking: ‘Suggest a mystery story’, ‘Help me develop a protagonist’, or ‘How can I improve this paragraph?’ This is a free built-in assistant, not a live external language model.";}const node=$("#aiReply");if(node)node.textContent=reply;}
  function renderFAQView(){activeView="faq";updateChrome();main.innerHTML=`<section class="page-wrap"><div class="page-heading"><p class="eyebrow">A little guidance</p><h2>Frequently asked questions</h2></div><div class="panel"><h3>Is OnceUpon free?</h3><p>Yes. There are no payments or paid features. Eligible approved readers receive free daily tokens according to the platform settings.</p><h3>Why do I need an account?</h3><p>Published stories can be discovered publicly. Reading protected pages and using community features require a verified and approved account.</p><h3>How do tokens work?</h3><p>The first five pages of each story are free. Other pages may have an author/admin-set token cost. Credits expire according to the current platform rules.</p><h3>How do I become an author?</h3><p>Sign in, open the author application area when available, submit your biography and writing samples, and wait for admin review.</p><h3>Can readers message one another?</h3><p>No. Private conversations are limited to reader-to-author contact. There is no general user-to-user chat.</p><h3>How do I install OnceUpon?</h3><p>Open the browser menu and choose Install app or Add to Home screen when your browser offers it.</p><h3>How do I contact support?</h3><p>Email <a href="mailto:onceupon.admin@gmail.com">onceupon.admin@gmail.com</a> or use Help & feedback after signing in.</p></div></section>`;}
  async function loadAdminAnalytics(){try{const specs=[["Members","profiles"],["Published stories","stories",q=>q.eq("status","published")],["Pending stories","stories",q=>q.eq("status","pending_review")],["Author follows","author_follows"],["Author conversations","author_threads"]];const vals=await Promise.all(specs.map(async ([label,table,filter])=>{let q=supa.from(table).select("*",{count:"exact",head:true});if(filter)q=filter(q);const r=await q;if(r.error)throw r.error;return {label,count:r.count||0};}));const host=$("#adminAnalytics");if(host)host.innerHTML=`<div class="stat-grid">${vals.map(v=>`<div class="stat-card"><strong>${v.count}</strong><span>${esc(v.label)}</span></div>`).join("")}</div><p class="form-note">Counts reflect records visible to your current administrator role.</p>`;}catch(e){const host=$("#adminAnalytics");if(host)host.innerHTML=`<p class="muted">Analytics unavailable: ${esc(niceError(e))}</p>`;}}
  async function exportCatalogue(){try{const {data,error}=await supa.from("stories").select("id,author_id,title,synopsis,genre,status,published_at,created_at").eq("status","published").order("published_at",{ascending:false});if(error)throw error;const rows=data||[];const cols=["id","author_id","title","synopsis","genre","status","published_at","created_at"];const csv=[cols.join(","),...rows.map(r=>cols.map(k=>'"'+String(r[k]??"").replace(/"/g,'""')+'"').join(","))].join("\r\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`onceupon-published-catalogue-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);toast("Catalogue export created.");}catch(e){toast(niceError(e),5000);}}

  function speakCurrentPage() {
    const text = $("#readerText")?.textContent?.trim();
    if (!text) return toast("Open a page before starting read-aloud.");
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return toast("Read-aloud is not supported by this browser.");
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }

  document.addEventListener("click", async event => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.view) return setView(target.dataset.view);
    if (target.dataset.authMode) return setAuthMode(target.dataset.authMode);
    if (target.dataset.openStory) return openStory(target.dataset.openStory);
    if (target.dataset.openAuthor) { window.__onceuponAuthorId=target.dataset.openAuthor; activeView="author-profile"; return renderAuthorProfileView(target.dataset.openAuthor); }
    if (target.dataset.openThread) { activeThreadId=target.dataset.openThread; return renderThreadView(activeThreadId); }
    if (target.dataset.openChapter) return openChapter(target.dataset.openChapter);
    if (target.dataset.openPage) return openPage(target.dataset.openPage);
    if (target.dataset.unlockPage) return unlockPage(target.dataset.unlockPage);
    if (target.dataset.userId && target.dataset.userStatus) return updateProfileStatus(target.dataset.userId,target.dataset.userStatus);
    if (target.dataset.appId && target.dataset.reviewApp) return reviewAuthorApplication(target.dataset.appId,target.dataset.reviewApp);
    if (target.dataset.storyId && target.dataset.storyStatus) return updateStoryStatus(target.dataset.storyId,target.dataset.storyStatus);
    if (target.dataset.questApprove) return reviewQuest(target.dataset.questApprove,"approved");
    if (target.dataset.questReject) return reviewQuest(target.dataset.questReject,"rejected");
    if (target.dataset.bookmarkStory) return toggleBookmark(target.dataset.bookmarkStory);
    if (target.dataset.readListAdd) return addToList(target.dataset.readListAdd);
    if (target.dataset.commentModerate) return moderateContent("comments",target.dataset.commentModerate,target.dataset.commentStatus);
    if (target.dataset.reviewModerate) return moderateContent("reviews",target.dataset.reviewModerate,target.dataset.reviewStatus);
    if (target.dataset.reportResolve) return resolveReport(target.dataset.reportResolve);
    if (target.dataset.supportReply) return replySupport(target.dataset.supportReply);
    if (target.dataset.notificationRead) return markNotification(target.dataset.notificationRead);
    if (target.dataset.evidence) { try { const {data,error}=await supa.storage.from("quest-submissions").createSignedUrl(target.dataset.evidence,300); if(error)throw error; window.open(data.signedUrl,"_blank","noopener"); } catch(e){toast(niceError(e),5000);} return; }
    if (target.dataset.editStory) return editStory(target.dataset.editStory);
    if (target.dataset.editChapter) return editChapter(target.dataset.editChapter,target.dataset.chapterTitle||"chapter");
    const action = target.dataset.action;
    if (action === "browse") { activeView="home"; renderHome(); document.querySelector("#librarySection")?.scrollIntoView({behavior:"smooth"}); }
    else if (action === "signup") setAuthMode("signup");
    else if (action === "close-modal") closeModal();
    else if (action === "claim-tokens") await claimTokens();
    else if (action === "refresh-wallet") { const row = await loadWallet(false); toast(`Available tokens: ${Number(row?.available_tokens||0)}`); }
    else if (action === "resend-otp") await resendOtp();
    else if (action === "forgot-password") await forgotPassword();
    else if (action === "save-preferences") savePrefs();
    else if (action === "save-profile") await saveProfile();
    else if (action === "update-password") await updatePassword();
    else if (action === "update-email") await updateEmail();
    else if (action === "toggle-follow") await toggleAuthorFollow(target.dataset.authorId);
    else if (action === "start-author-thread") await startAuthorThread(target.dataset.authorId);
    else if (action === "close-thread") await setThreadStatus(target.dataset.threadId,"closed");
    else if (action === "reopen-thread") await setThreadStatus(target.dataset.threadId,"open");
    else if (action === "export-catalogue") await exportCatalogue();
    else if (action === "install-app") await installApp();
    else if (action === "ai-suggest") runAIResponse();
    else if (action === "read-aloud") speakCurrentPage();
    else if (action === "stop-reading") { if (window.speechSynthesis) window.speechSynthesis.cancel(); toast("Read-aloud stopped."); }
    else if (action === "font-up" || action === "font-down" || action === "line-spacing") {
      const prefs=readPrefs();
      if(action==="font-up") prefs.font=Math.min(28,prefs.font+1);
      if(action==="font-down") prefs.font=Math.max(14,prefs.font-1);
      if(action==="line-spacing") prefs.line=prefs.line>=1.95?1.6:prefs.line+0.2;
      localStorage.setItem("onceupon-prefs",JSON.stringify(prefs));applyReadingPrefs();
    }
  });

  document.addEventListener("submit", async event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    if (form.id === "loginForm") return handleLogin(form);
    if (form.id === "signupForm") return handleSignup(form);
    if (form.id === "verifyForm") return handleVerify(form);
    if (form.id === "authorApplicationForm") return submitAuthorApplication(form);
    if (form.id === "newStoryForm") return createStory(form);
    if (form.id === "newChapterForm") return createChapter(form);
    if (form.id === "newPageForm") return createPage(form);
    if (form.id === "roleForm") return grantRole(form);
    if (form.id === "questForm") return createQuest(form);
    if (form.id === "questSubmitForm") return submitQuest(form);
    if (form.id === "reviewForm") return saveReview(form);
    if (form.id === "commentForm") return saveComment(form);
    if (form.id === "listForm") return createReadingList(form);
    if (form.id === "supportForm") return sendSupport(form);
    if (form.id === "reportForm") return sendReport(form);
    if (form.id === "profileForm") return saveProfile(form);
    if (form.id === "passwordForm") return updatePassword(form);
    if (form.id === "emailForm") return updateEmail(form);
    if (form.id === "authorMessageForm") return sendAuthorMessage(form);
    if (form.id === "startThreadForm") return createAuthorThread(form);
    if (form.id === "aiForm") return runAIResponse(form);
  });

  document.addEventListener("input", event => {
    if (event.target.id === "catalogueSearch") renderCatalogue();
  });

  window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();deferredInstallPrompt=event;});
  $("#authButton").addEventListener("click",()=>setAuthMode("login"));
  $("#signOutButton").addEventListener("click",signOut);
  $("#themeToggle").addEventListener("click",()=>{
    const prefs=readPrefs();prefs.theme=prefs.theme==="dark"?"light":"dark";localStorage.setItem("onceupon-prefs",JSON.stringify(prefs));document.body.classList.toggle("theme-dark",prefs.theme==="dark");document.body.classList.toggle("theme-light",prefs.theme==="light");
  });
  $("#year").textContent = new Date().getFullYear();
  const prefs = readPrefs();
  document.body.classList.toggle("theme-dark",prefs.theme==="dark");
  document.body.classList.toggle("theme-light",prefs.theme==="light"||(prefs.theme==="system"&&window.matchMedia?.("(prefers-color-scheme: light)").matches));
  document.body.classList.toggle("high-contrast",prefs.contrast==="high");
  document.body.classList.toggle("reduce-motion",prefs.motion==="reduced");

  if (!configured) {
    renderHome();
    main.insertAdjacentHTML("afterbegin",`<section class="page-wrap"><div class="notice danger-note"><strong>One setup step remains:</strong> open <code>config.js</code> and replace <code>PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE</code> with the project's publishable key. Never paste a service_role key here.</div></section>`);
  } else if (!window.supabase?.createClient) {
    main.innerHTML = `<section class="page-wrap"><div class="notice danger-note">Supabase JavaScript did not load. Check your internet connection and try again.</div></section>`;
  } else {
    supa = window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    supa.auth.getSession().then(({data,error})=>{
      if(error) console.error(error);
      session=data?.session||null;
      if(session) refreshSessionData(); else { updateChrome(); renderHome(); }
    });
    supa.auth.onAuthStateChange((event,newSession)=>{
      session=newSession;
      if(event === "TOKEN_REFRESHED") return;
      if(newSession) refreshSessionData();
      else { profile=null;roles=[];activeView="home";updateChrome();renderHome(); }
    });
  }
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(err => console.warn("PWA worker:", err)));
  }
})();
