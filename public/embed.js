/*!
 * Tempo booking pop-up.
 *
 *   <script src="https://YOUR-TEMPO-DOMAIN/embed.js" data-slug="your-business" async></script>
 *   <button data-tempo-open>Book now</button>
 *   <button data-tempo-open data-tempo-service="haircut">Book a haircut</button>
 *
 * Add data-floating to the script tag for a floating "Book now" button.
 * JavaScript: Tempo.open({ slug, service }) / Tempo.close().
 * Fires a "tempo:booked" event on window when a booking is made.
 *
 * Contact form ("ask a question before booking"):
 *   <button data-tempo-contact>Ask a question</button>            pop-up
 *   <div data-tempo-form></div>                                    inline, right on the page
 * Either can take data-tempo-service="slug" to pre-select a service.
 * Fires a "tempo:inquiry" event on window when a message is sent.
 */
(function () {
  if (window.Tempo && window.Tempo.__loaded) return;

  var script =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName("script");
      for (var i = all.length - 1; i >= 0; i--) if (/\/embed\.js(\?|$)/.test(all[i].src)) return all[i];
      return null;
    })();
  if (!script || !script.src) return;

  var ORIGIN = new URL(script.src).origin;
  var DEFAULT_SLUG = script.getAttribute("data-slug") || "";
  var DEFAULT_SERVICE = script.getAttribute("data-service") || "";
  var overlay = null;
  var lastFocus = null;
  var prevOverflow = "";

  function injectStyles() {
    if (document.getElementById("tempo-embed-styles")) return;
    var css =
      ".tempo-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);opacity:0;transition:opacity .2s ease}" +
      ".tempo-overlay.tempo-in{opacity:1}" +
      ".tempo-modal{position:relative;width:min(1040px,94vw);height:min(720px,90vh);background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.4);transform:translateY(12px) scale(.985);transition:transform .25s cubic-bezier(.2,.8,.2,1)}" +
      ".tempo-modal.tempo-contact{width:min(560px,94vw);height:min(700px,92vh)}" +
      ".tempo-inline{display:block;width:100%;border:0;min-height:420px;background:transparent;color-scheme:normal}" +
      ".tempo-overlay.tempo-in .tempo-modal{transform:none}" +
      ".tempo-modal iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}" +
      ".tempo-spin{position:absolute;left:50%;top:50%;width:28px;height:28px;margin:-14px 0 0 -14px;border:3px solid rgba(0,0,0,.12);border-top-color:rgba(0,0,0,.5);border-radius:50%;animation:tempo-rot .7s linear infinite}" +
      "@keyframes tempo-rot{to{transform:rotate(360deg)}}" +
      ".tempo-close{position:absolute;top:14px;right:18px;z-index:1;width:40px;height:40px;border:0;border-radius:50%;background:transparent;color:#fff;font:400 30px/1 -apple-system,system-ui,sans-serif;cursor:pointer}" +
      ".tempo-close:hover{background:rgba(255,255,255,.15)}" +
      ".tempo-float{position:fixed;bottom:20px;right:20px;z-index:2147482000;border:0;border-radius:999px;padding:14px 22px;color:#fff;font:600 15px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25);transition:transform .15s ease}" +
      ".tempo-float:hover{transform:translateY(-2px)}" +
      ".tempo-float.tempo-left{right:auto;left:20px}" +
      "@media (max-width:640px){.tempo-modal{width:100%;height:100%;border-radius:0}.tempo-close{top:8px;right:8px;color:#111;background:rgba(255,255,255,.9)}}";
    var style = document.createElement("style");
    style.id = "tempo-embed-styles";
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  function frameUrl(opts) {
    var u = ORIGIN + "/embed/" + encodeURIComponent(opts.slug) + (opts.kind === "contact" ? "/contact" : "");
    return opts.service ? u + "?service=" + encodeURIComponent(opts.service) : u;
  }

  function open(opts) {
    opts = opts || {};
    opts.slug = opts.slug || DEFAULT_SLUG;
    opts.service = opts.service || "";
    if (!opts.slug) {
      console.error("[Tempo] No business set. Add data-slug to the embed script, or call Tempo.open({ slug }).");
      return;
    }
    if (overlay) return;
    injectStyles();
    lastFocus = document.activeElement;
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    overlay = document.createElement("div");
    overlay.className = "tempo-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", opts.kind === "contact" ? "Send a message" : "Book an appointment");

    var modal = document.createElement("div");
    modal.className = "tempo-modal" + (opts.kind === "contact" ? " tempo-contact" : "");
    var spin = document.createElement("div");
    spin.className = "tempo-spin";
    var frame = document.createElement("iframe");
    frame.src = frameUrl(opts);
    frame.title = opts.kind === "contact" ? "Contact form" : "Booking";
    if (opts.kind !== "contact") frame.setAttribute("allow", "payment");
    frame.addEventListener("load", function () {
      if (spin.parentNode) spin.parentNode.removeChild(spin);
    });
    var closeBtn = document.createElement("button");
    closeBtn.className = "tempo-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", close);

    modal.appendChild(spin);
    modal.appendChild(frame);
    overlay.appendChild(modal);
    overlay.appendChild(closeBtn);
    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) close();
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(function () {
      if (overlay) overlay.classList.add("tempo-in");
    });
    closeBtn.focus();
  }

  function close() {
    if (!overlay) return;
    var el = overlay;
    overlay = null;
    el.classList.remove("tempo-in");
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 200);
    document.body.style.overflow = prevOverflow;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
  });

  // Messages from the booking page inside the pop-up.
  window.addEventListener("message", function (e) {
    if (e.origin !== ORIGIN || !e.data || typeof e.data !== "object") return;
    if (e.data.type === "tempo:redirect" && typeof e.data.url === "string") {
      // Stripe can't load inside a frame, so the whole page goes to checkout.
      if (/^https:\/\/checkout\.stripe\.com\//.test(e.data.url)) window.location.href = e.data.url;
    } else if (e.data.type === "tempo:booked") {
      window.dispatchEvent(new CustomEvent("tempo:booked", { detail: { token: e.data.token } }));
    } else if (e.data.type === "tempo:close") {
      close();
    } else if (e.data.type === "tempo:inquiry") {
      window.dispatchEvent(new CustomEvent("tempo:inquiry"));
    } else if (e.data.type === "tempo:resize" && typeof e.data.height === "number") {
      // An inline contact form grows or shrinks to fit its content.
      var frames = document.querySelectorAll("iframe.tempo-inline");
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow === e.source) frames[i].style.height = Math.min(Math.max(Math.ceil(e.data.height), 200), 4000) + "px";
      }
    }
  });

  // Any element with data-tempo-contact opens the contact form pop-up.
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("[data-tempo-contact]") : null;
    if (!el) return;
    e.preventDefault();
    open({ slug: el.getAttribute("data-tempo-slug") || DEFAULT_SLUG, service: el.getAttribute("data-tempo-service") || "", kind: "contact" });
  });

  // <div data-tempo-form> becomes the contact form, right on the page.
  function mountForms() {
    var holders = document.querySelectorAll("[data-tempo-form]");
    for (var i = 0; i < holders.length; i++) {
      var h = holders[i];
      if (h.getAttribute("data-tempo-mounted")) continue;
      var slug = h.getAttribute("data-tempo-slug") || DEFAULT_SLUG;
      if (!slug) {
        console.error("[Tempo] No business set. Add data-slug to the embed script.");
        continue;
      }
      h.setAttribute("data-tempo-mounted", "1");
      injectStyles();
      var f = document.createElement("iframe");
      f.className = "tempo-inline";
      f.title = "Contact form";
      f.loading = "lazy";
      f.src = frameUrl({ slug: slug, service: h.getAttribute("data-tempo-service") || "", kind: "contact" });
      h.appendChild(f);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountForms);
  else mountForms();

  // Any element with data-tempo-open (or data-tempo-service) opens the pop-up.
  // A plain link to the booking page also works and keeps working without JavaScript.
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("[data-tempo-open],[data-tempo-service]") : null;
    if (!el || el.hasAttribute("data-tempo-contact")) return;
    var slug = el.getAttribute("data-tempo-slug") || "";
    var service = el.getAttribute("data-tempo-service") || "";
    if (!slug && el.href) {
      try {
        var u = new URL(el.href);
        if (u.origin === ORIGIN) {
          slug = u.pathname.split("/")[1] || "";
          service = service || u.searchParams.get("service") || "";
        }
      } catch (err) {
        void err; // not a valid URL: fall back to the script defaults
      }
    }
    e.preventDefault();
    open({ slug: slug || DEFAULT_SLUG, service: service });
  });

  if (script.hasAttribute("data-floating")) {
    var mount = function () {
      injectStyles();
      var b = document.createElement("button");
      b.className = "tempo-float" + (script.getAttribute("data-position") === "left" ? " tempo-left" : "");
      b.style.background = script.getAttribute("data-color") || "#007AFF";
      b.textContent = script.getAttribute("data-label") || "Book now";
      b.addEventListener("click", function () {
        open({ slug: DEFAULT_SLUG, service: DEFAULT_SERVICE });
      });
      document.body.appendChild(b);
    };
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount);
  }

  window.Tempo = { __loaded: true, open: open, close: close, mount: mountForms };
})();
