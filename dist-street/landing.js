// Campaign landing page (/challenge/<id>). Plain script, no build step: it fills in the install and
// open links from /config.json and, when the backend allows it, the campaign's name and blurb.
(() => {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!ios) document.body.classList.add("not-ios");

  const match = /^\/challenge\/([0-9]{1,12})\/?$/.exec(location.pathname);
  if (!match) {
    document.getElementById("found").hidden = true;
    document.getElementById("missing").hidden = false;
    return;
  }
  const id = match[1];
  const open = document.getElementById("open");
  // iOS won't follow a universal link tapped on its own domain, so the button uses the app's scheme.
  open.href = `mrchoice://challenge/${id}`;

  fetch("/config.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`config.json: HTTP ${r.status}`))))
    .then((config) => {
      if (config.appScheme) open.href = `${config.appScheme}://challenge/${id}`;
      const install = document.getElementById("install");
      if (config.installUrl) install.href = config.installUrl;
      else {
        install.hidden = true;
        document.getElementById("install-text").textContent = "Ask your organizer for the link to install the beta.";
      }
      if (!config.backend) return;
      return fetch(`${config.backend}/api/v2/challenge/${id}`, { headers: { Accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : undefined))
        .then((c) => {
          if (!c || typeof c.name !== "string") return;
          // Text only: the name and blurb come from the server.
          document.getElementById("name").textContent = c.name;
          document.title = `${c.name} · Street Tally`;
          const blurb = typeof c.blurb === "string" && c.blurb.trim() ? c.blurb.trim() : "";
          if (blurb) document.getElementById("blurb").textContent = blurb.length > 280 ? `${blurb.slice(0, 279)}…` : blurb;
        });
    })
    // Without config or campaign details the page still works, with the generic text.
    .catch(() => undefined);
})();
