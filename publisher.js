// sixtyhype publisher: static page, talks to the local backend (python -m gta6clips publisher)
const API = "http://127.0.0.1:8765";
const $ = (id) => document.getElementById(id);
const PRIVACY_LABELS = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};
let creator = null;
let current = null;

async function api(path, body) {
  const opts = body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  };
  const res = await fetch(API + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.status);
  return data;
}

function show(id) {
  for (const s of ["offline", "login", "app"]) $(s).hidden = s !== id;
}

async function init() {
  let status;
  try { status = await api("/api/status"); } catch { return show("offline"); }
  if (!status.connected) return show("login");
  show("app");
  $("avatar").src = status.user.avatar_url || "";
  $("nickname").textContent = status.user.display_name || "";
  $("username").textContent = status.user.username ? "@" + status.user.username : "";
  creator = await api("/api/creator-info");
  if (creator.creator_nickname) $("nickname").textContent = creator.creator_nickname;
  if (creator.creator_avatar_url) $("avatar").src = creator.creator_avatar_url;
  $("cannot-post").hidden = creator.can_post !== false;
  setupForm();
  loadClips();
}

function setupForm() {
  const sel = $("privacy");
  for (const opt of creator.privacy_level_options || []) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = PRIVACY_LABELS[opt] || opt;
    sel.appendChild(o);
  }
  // disabled in the creator's TikTok settings -> greyed out, cannot be enabled here
  $("allow-comment").disabled = !!creator.comment_disabled;
  $("allow-duet").disabled = !!creator.duet_disabled;
  $("allow-stitch").disabled = !!creator.stitch_disabled;
  for (const id of ["privacy", "disclose", "brand-organic", "branded-content", "title"]) {
    $(id).addEventListener("input", validate);
  }
}

async function loadClips() {
  const { clips } = await api("/api/clips");
  const box = $("clips");
  box.innerHTML = "";
  if (!clips.length) box.innerHTML = '<p class="muted">No finished clips yet.</p>';
  for (const clip of clips) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn clip";
    b.innerHTML = `<span></span><span class="muted"></span>`;
    b.children[0].textContent = `${clip.streamer} · ${clip.duration}s`;
    b.children[1].textContent = clip.tiktok.startsWith("done") ? "posted" : "ready";
    b.onclick = () => select(clip, b);
    box.appendChild(b);
  }
}

function select(clip, button) {
  current = clip;
  document.querySelectorAll(".clip").forEach((el) => el.classList.toggle("active", el === button));
  $("post-form").hidden = false;
  $("preview").src = `${API}/video/${clip.id}.mp4`;
  $("title").value = clip.caption;
  $("result").hidden = true;
  const max = creator.max_video_post_duration_sec;
  const tooLong = max && clip.duration > max;
  $("duration-warn").hidden = !tooLong;
  $("duration-warn").textContent = tooLong ? `This clip is longer than the ${max}s allowed for this account.` : "";
  validate();
}

function validate() {
  const disclose = $("disclose").checked;
  $("disclose-options").hidden = !disclose;
  const organic = $("brand-organic").checked;
  const branded = $("branded-content").checked;
  // branded content cannot be private (TikTok rule)
  const selfOnly = [...$("privacy").options].find((o) => o.value === "SELF_ONLY");
  if (selfOnly) {
    selfOnly.disabled = disclose && branded;
    selfOnly.title = selfOnly.disabled ? "Branded content visibility cannot be set to private." : "";
    if (selfOnly.disabled && $("privacy").value === "SELF_ONLY") $("privacy").value = "";
  }
  let label = "";
  if (disclose && branded) label = "Your video will be labeled as 'Paid partnership'.";
  else if (disclose && organic) label = "Your video will be labeled as 'Promotional content'.";
  else if (disclose) label = "You need to indicate if your content promotes yourself, a third party, or both.";
  $("disclose-label").textContent = label;
  const policy = disclose && branded
    ? ` and <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noopener">Branded Content Policy</a>`
    : "";
  $("consent").innerHTML = `By posting, you agree to TikTok's <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener">Music Usage Confirmation</a>${policy}.`;
  const tooLong = !$("duration-warn").hidden;
  const ok = current && $("privacy").value && (!disclose || organic || branded)
    && !tooLong && creator.can_post !== false;
  $("post-btn").disabled = !ok;
}

async function post(mode) {
  const result = $("result");
  result.hidden = false;
  result.textContent = mode === "inbox" ? "Sending to your TikTok inbox…" : "Uploading to TikTok…";
  $("post-btn").disabled = true;
  try {
    const { publish_id } = await api("/api/post", {
      clip_id: current.id, mode,
      title: $("title").value,
      privacy_level: $("privacy").value,
      disable_comment: !$("allow-comment").checked,
      disable_duet: !$("allow-duet").checked,
      disable_stitch: !$("allow-stitch").checked,
      brand_organic: $("disclose").checked && $("brand-organic").checked,
      branded_content: $("disclose").checked && $("branded-content").checked,
    });
    result.textContent = mode === "inbox"
      ? "Sent! Open the TikTok app and check your inbox notifications to finish editing and post."
      : "Uploaded! Your video is being processed — it may take a few minutes to appear on your profile.";
    pollStatus(publish_id);
    loadClips();
  } catch (err) {
    result.textContent = "Error: " + err.message;
    validate();
  }
}

async function pollStatus(publishId) {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const s = await api("/api/post-status", { publish_id: publishId });
      if (s.status === "PUBLISH_COMPLETE" || s.status === "SEND_TO_USER_INBOX") {
        $("result").textContent += " Status: done.";
        return;
      }
      if (s.status === "FAILED") {
        $("result").textContent = "TikTok could not process the video: " + (s.fail_reason || "unknown");
        return;
      }
    } catch { /* keep polling */ }
  }
}

$("login-btn").onclick = async () => {
  const { url } = await api("/api/login-url");
  location.href = url;
};
$("logout-btn").onclick = async () => { await api("/api/logout", {}); init(); };
$("post-form").onsubmit = (e) => { e.preventDefault(); post("direct"); };
$("inbox-btn").onclick = () => current && post("inbox");
init();
