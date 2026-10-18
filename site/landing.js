// Campaign-first entry: preserve the invitation ID through installation and explicit app return.
(() => {
  const find = (id) => document.getElementById(id);
  const match = /^\/challenge\/([0-9]{1,12})\/?$/.exec(location.pathname);
  const id = match?.[1];
  const validId = id && Number(id) > 0;
  const httpsUrl = (value) => {
    if (typeof value !== "string") return undefined;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
    } catch {
      return undefined;
    }
  };
  const read = async (url) => {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" } });
    if (!response.ok) throw Object.assign(new Error("Could not load"), { status: response.status });
    return response.json();
  };
  const showStatus = (message, retry = false) => {
    find("status-text").textContent = message;
    find("retry").hidden = !retry;
  };
  const setInstall = (platform, url) => {
    const link = find(`install-${platform}`);
    link.hidden = !url;
    if (url) link.href = url;
    else link.removeAttribute("href");
    find(`${platform}-unavailable`).hidden = !!url;
    find(`${platform}-steps`).hidden = !url;
  };
  // The order stays fixed (design/install-journey-and-gate.md §1); on a phone, the other platform starts collapsed.
  const ua = navigator.userAgent;
  const phone = /Android/i.test(ua) ? "android" : /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "ios" : undefined;
  if (phone) {
    const other = find(phone === "ios" ? "android" : "ios");
    other.open = false;
  }
  let loading = false;
  const load = async () => {
    if (loading) return;
    loading = true;
    find("found").hidden = true;
    setInstall("ios");
    setInstall("android");
    find("retry").disabled = true;
    showStatus("Loading this campaign…");
    try {
      let config;
      try {
        config = await read("/config.json");
        const backend = new URL(config.backend);
        if (!["https:", "http:"].includes(backend.protocol) || backend.username || backend.password || backend.pathname !== "/" || backend.search || backend.hash) throw new Error("Invalid backend");
        config.backend = backend.origin;
      } catch {
        showStatus("We couldn't load the campaign settings. Check your connection and try again.", true);
        return;
      }
      let campaign;
      try {
        campaign = await read(`${config.backend}/api/v2/challenge/${id}`);
        if (!campaign || typeof campaign.name !== "string" || !campaign.name.trim()) throw new Error("Invalid campaign");
      } catch (error) {
        showStatus(error.status === 404 ? "We can't find this campaign. Check the invitation link or scan the code again." : "We couldn't load this campaign. Check your connection and try again.", true);
        return;
      }
      find("name").textContent = campaign.name.trim();
      document.title = `${campaign.name.trim()} · Street Tally`;
      // The app's welcome card shows the description, so it leads here too.
      const text = [campaign.description, campaign.blurb].find((t) => typeof t === "string" && t.trim())?.trim() ?? "";
      find("blurb").textContent = text ? (text.length > 280 ? `${text.slice(0, 279)}…` : text) : "Check the places around you and answer a few quick questions.";
      // Both app manifests already support mrchoice. Keep the same campaign through installation, and
      // the wizard's "try it on your phone" link in preview mode (design/preview-mode.md §3).
      const preview = new URLSearchParams(location.search).get("preview") === "1";
      find("open").href = `mrchoice://challenge/${id}${preview ? "?preview=1" : ""}`;
      setInstall("ios", httpsUrl(config.installUrl));
      const version = typeof config.androidVersion === "string" ? config.androidVersion.trim() : "";
      // A version is required to identify the intended pilot artifact, not just an arbitrary APK.
      setInstall("android", version ? httpsUrl(config.androidInstallUrl) : undefined);
      find("android-version").textContent = version ? `Street Tally pilot, version ${version}` : "Street Tally pilot";
      find("found").hidden = false;
      showStatus("");
    } finally {
      loading = false;
      find("retry").disabled = false;
    }
  };
  if (!validId) {
    showStatus("This campaign link isn't valid. Check the invitation link or scan the code again.");
    return;
  }
  find("retry").addEventListener("click", load);
  load();
})();
