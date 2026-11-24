/* ==========================================================================
   Maison Noir — site interactions
   ========================================================================== */
(() => {
  "use strict";

  /* ---------- Configuration ---------- */
  const CONFIG = {
    // Set to a form endpoint (e.g. Formspree, Basin, your own API) to receive
    // bookings as JSON POST. While empty, the form NEVER reports a booking as
    // received: it tells the visitor the request was not submitted and offers
    // email / phone instead.
    bookingEndpoint: "",
    requestTimeoutMs: 15000,
    bookingEmail: "hello@example.com",
    phoneDisplay: "+1 (555) 010-2040",
    timeZone: "America/New_York",
    slotMinutes: 30,
    bookingWindowDays: 60,
    // Opening hours by weekday (0 = Sunday). null = closed. Times are 24h "HH:MM".
    hours: {
      0: ["11:00", "16:00"],
      1: null,
      2: ["10:00", "20:00"],
      3: ["10:00", "20:00"],
      4: ["10:00", "20:00"],
      5: ["10:00", "20:00"],
      6: ["09:00", "18:00"],
    },
    // Must match the mobile-navigation breakpoint in styles.css.
    mobileNavMaxWidth: 1024,
  };

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const root = document.documentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hasIO = "IntersectionObserver" in window;
  const toMinutes = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const pad = (n) => String(n).padStart(2, "0");

  const header = $(".site-header");
  const main = $("#main");
  const footer = $(".site-footer");
  const hero = $(".hero");
  const fab = $(".fab-book");

  /* ---------- Footer year ---------- */
  const yearEl = $("#year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- Scroll lock (iOS-safe, no layout shift) ----------
     overflow:hidden on <body> does not stop scrolling in iOS Safari, so the body
     is pinned with position:fixed at the current offset and restored on unlock.
     Layout shift from the disappearing scrollbar is prevented by
     `scrollbar-gutter: stable` (styles.css); browsers without it get the lost
     width back as padding via --lock-gap. Calls are counted so nested overlays
     (menu → booking form) unlock correctly. */
  const gutterSupported = window.CSS && CSS.supports && CSS.supports("scrollbar-gutter", "stable");
  const scrollLock = (() => {
    let depth = 0;
    let savedY = 0;
    return {
      lock() {
        if (depth++ > 0) return;
        savedY = window.scrollY;
        const widthBefore = root.clientWidth;
        document.body.style.top = `-${savedY}px`;
        document.body.classList.add("is-locked");
        const gap = root.clientWidth - widthBefore;
        if (!gutterSupported && gap > 0) root.style.setProperty("--lock-gap", `${gap}px`);
      },
      unlock() {
        if (depth === 0 || --depth > 0) return;
        document.body.classList.remove("is-locked");
        document.body.style.top = "";
        root.style.removeProperty("--lock-gap");
        window.scrollTo({ top: savedY, left: 0, behavior: "instant" });
      },
    };
  })();

  /* ---------- Background inert helper ---------- */
  const setInert = (els, on) => els.forEach((el) => {
    if (!el) return;
    el.inert = on;
    el.toggleAttribute("inert", on);
  });

  /* ---------- Focus trap helper ---------- */
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const focusables = (container) => $$(FOCUSABLE, container).filter((el) =>
    el.getClientRects().length > 0 && !el.closest("[hidden], [inert]") && getComputedStyle(el).visibility !== "hidden");
  const trapFocus = (container, e) => {
    if (e.key !== "Tab") return;
    const items = focusables(container);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (!container.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  /* ---------- Header state + floating button (no scroll listener) ---------- */
  if (hasIO) {
    // 1px sentinel 20px down the page: once it leaves the viewport, the header turns solid.
    const sentinel = document.createElement("div");
    sentinel.className = "scroll-sentinel";
    sentinel.setAttribute("aria-hidden", "true");
    document.body.prepend(sentinel);
    // Several entries can be queued per callback; the last one is the current state.
    const latest = (entries) => entries[entries.length - 1];
    new IntersectionObserver((entries) => {
      header.classList.toggle("is-scrolled", !latest(entries).isIntersecting);
    }).observe(sentinel);

    // Floating "Book" button: shown once most of the hero has scrolled away,
    // hidden again while the booking banner or footer is on screen.
    if (fab && hero) {
      const fabState = { pastHero: false, blocked: new Set() };
      const applyFab = () => fab.classList.toggle("is-visible", fabState.pastHero && fabState.blocked.size === 0);
      new IntersectionObserver((entries) => {
        const entry = latest(entries);
        fabState.pastHero = entry.intersectionRatio < 0.3 && entry.boundingClientRect.top < 0;
        applyFab();
      }, { threshold: [0, 0.3, 1] }).observe(hero);
      const blockers = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) fabState.blocked.add(entry.target);
          else fabState.blocked.delete(entry.target);
        });
        applyFab();
      });
      $$(".cta-band, .site-footer").forEach((el) => blockers.observe(el));
    }
  } else {
    header.classList.add("is-scrolled");
  }

  /* ---------- Mobile navigation ---------- */
  const nav = $("#primary-nav");
  const navToggle = $(".nav-toggle");
  const isNavOpen = () => nav.classList.contains("is-open");

  const setNav = (open) => {
    if (open === isNavOpen()) return;
    nav.classList.toggle("is-open", open);
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    header.classList.toggle("nav-open", open);
    setInert([main, footer, fab], open);
    if (open) {
      scrollLock.lock();
      nav.scrollTop = 0;
      const firstLink = $(".nav-list a", nav);
      if (firstLink) firstLink.focus();
    } else {
      scrollLock.unlock();
    }
  };
  navToggle.addEventListener("click", () => setNav(!isNavOpen()));
  $$("a, button", nav).forEach((el) => el.addEventListener("click", () => setNav(false)));
  $$(".brand").forEach((el) => el.addEventListener("click", () => setNav(false)));
  window.matchMedia(`(min-width: ${CONFIG.mobileNavMaxWidth + 1}px)`)
    .addEventListener("change", (e) => { if (e.matches) setNav(false); });

  // Keep keyboard focus inside the header (logo, menu links, Book, close) while the menu is open.
  header.addEventListener("keydown", (e) => {
    if (!isNavOpen()) return;
    if (e.key === "Escape") { setNav(false); navToggle.focus(); return; }
    trapFocus(header, e);
  });

  /* ---------- Active nav link ---------- */
  const navLinks = $$(".nav-list a");
  const sections = navLinks.map((a) => $(a.getAttribute("href"))).filter(Boolean);
  if (hasIO) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((a) => {
          const active = a.getAttribute("href") === `#${entry.target.id}`;
          a.classList.toggle("is-active", active);
          if (active) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
        });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    sections.forEach((s) => spy.observe(s));
  }

  /* ---------- Reveal on scroll ---------- */
  const reveals = $$(".reveal");
  if (hasIO && !reducedMotion) {
    const revealObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const siblings = $$(".reveal", entry.target.parentElement);
        const idx = Math.max(0, siblings.indexOf(entry.target));
        entry.target.style.transitionDelay = `${Math.min(idx * 80, 400)}ms`;
        entry.target.classList.add("is-visible");
        obs.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    reveals.forEach((el) => revealObserver.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("is-visible"));
  }
  // Tell the inline safety net in <head> that reveal handling is active.
  root.classList.add("js-ready");

  /* ---------- Stat counters ---------- */
  const counters = $$("[data-count]");
  if (hasIO && !reducedMotion) {
    const fmt = new Intl.NumberFormat("en-US");
    const countObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = Number(el.dataset.count);
        const suffix = el.dataset.suffix || "";
        const duration = 1600;
        const start = performance.now();
        const tick = (now) => {
          const p = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - p, 4);
          el.textContent = fmt.format(Math.round(target * eased)) + (p === 1 ? suffix : "");
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        obs.unobserve(el);
      });
    }, { threshold: 0.6 });
    counters.forEach((el) => countObserver.observe(el));
  }

  /* ---------- Open / closed status (shop time zone) ---------- */
  const statusEl = $("#open-status");
  const shopNow = () => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: CONFIG.timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
  };
  const updateStatus = () => {
    if (!statusEl) return;
    try {
      const { day, minutes } = shopNow();
      const h = CONFIG.hours[day];
      const open = h && minutes >= toMinutes(h[0]) && minutes < toMinutes(h[1]);
      statusEl.textContent = open ? `Open now · until ${h[1]}` : "Closed now";
      statusEl.classList.toggle("is-open", Boolean(open));
    } catch (_) { statusEl.textContent = ""; }
  };
  updateStatus();
  setInterval(updateStatus, 60 * 1000);

  /* ---------- Booking modal ---------- */
  const modal = $("#booking-modal");
  const form = $("#booking-form");
  const formView = $("#booking-form-view");
  const successView = $("#booking-success");
  const unsentView = $("#booking-unsent");
  const bookingConnected = Boolean(CONFIG.bookingEndpoint);

  if (!bookingConnected) {
    $("#booking-offline-note").hidden = false;
    modal.setAttribute("aria-describedby", "booking-offline-note");
    console.warn("[booking] CONFIG.bookingEndpoint is empty — online booking requests are not submitted.");
  }
  const dateInput = $("#b-date");
  const timeSelect = $("#b-time");
  const submitBtn = $("#booking-submit");
  const formStatus = $("#form-status");
  let lastFocus = null;

  // Link each error message to its field so screen readers read it with the field.
  $$(".field", form).forEach((wrap) => {
    const field = $("input, select, textarea", wrap);
    const error = $(".field-error", wrap);
    if (!field || !error) return;
    error.id = `${field.id}-error`;
    field.setAttribute("aria-describedby", error.id);
  });

  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISODate = (v) => { const [y, m, d] = v.split("-").map(Number); return new Date(y, m - 1, d); };

  const today = new Date();
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + CONFIG.bookingWindowDays);
  dateInput.min = isoDate(today);
  dateInput.max = isoDate(maxDate);

  const fmtTime = (mins) => {
    const h = Math.floor(mins / 60), m = mins % 60;
    const suffix = h >= 12 ? "PM" : "AM";
    return `${((h + 11) % 12) + 1}:${pad(m)} ${suffix}`;
  };

  const populateTimes = () => {
    timeSelect.innerHTML = "";
    const add = (value, label, disabled = false) => {
      const o = document.createElement("option");
      o.value = value; o.textContent = label; o.disabled = disabled;
      timeSelect.appendChild(o);
    };
    if (!dateInput.value) { add("", "Select a date first"); return; }

    const date = parseISODate(dateInput.value);
    const h = CONFIG.hours[date.getDay()];
    if (!h) { add("", "Closed on this day"); return; }

    const isToday = dateInput.value === isoDate(new Date());
    const nowMins = isToday ? shopNow().minutes : -1;
    add("", "Select a time");
    let count = 0;
    // Last slot starts 30 minutes before closing.
    for (let t = toMinutes(h[0]); t <= toMinutes(h[1]) - 30; t += CONFIG.slotMinutes) {
      if (t <= nowMins + 30) continue;
      add(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`, fmtTime(t));
      count++;
    }
    if (!count) { timeSelect.innerHTML = ""; add("", "No times left today"); }
  };
  dateInput.addEventListener("change", () => { populateTimes(); validateField(dateInput); });

  const openModal = () => {
    if (!modal.hidden) return;
    const opener = document.activeElement;
    setNav(false);
    // If opened from inside the mobile menu, return focus to the menu button afterwards.
    lastFocus = nav.contains(opener) ? navToggle : opener;
    formView.hidden = false;
    successView.hidden = true;
    unsentView.hidden = true;
    modal.hidden = false;
    setInert([header, main, footer, fab], true);
    scrollLock.lock();
    $("#b-name").focus({ preventScroll: true });
  };
  const closeModal = () => {
    if (modal.hidden) return;
    modal.hidden = true;
    setInert([header, main, footer, fab], false);
    scrollLock.unlock();
    if (lastFocus && typeof lastFocus.focus === "function" && lastFocus.getClientRects().length) lastFocus.focus();
  };

  $$("[data-open-booking]").forEach((btn) => btn.addEventListener("click", openModal));
  $$("[data-close-modal]", modal).forEach((btn) => btn.addEventListener("click", closeModal));
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeModal(); return; }
    trapFocus(modal, e);
  });

  /* Validation */
  const messages = {
    name: "Please enter your name.",
    phone: "Please enter a valid phone number.",
    email: "Please enter a valid email address.",
    service: "Please choose a service.",
    date: "Please choose a date.",
    time: "Please choose a time.",
  };

  function validateField(field) {
    const wrap = field.closest(".field");
    const errorEl = wrap && $(".field-error", wrap);
    let msg = "";
    if (!field.checkValidity()) msg = messages[field.name] || "This field is required.";
    if (!msg && field.name === "phone" && field.value.replace(/\D/g, "").length < 7) {
      msg = messages.phone;
    }
    if (!msg && field === dateInput && field.value) {
      const d = parseISODate(field.value);
      if (!CONFIG.hours[d.getDay()]) msg = "We're closed on Mondays — please pick another day.";
      else if (field.value < field.min || field.value > field.max) msg = `Please pick a date within the next ${CONFIG.bookingWindowDays} days.`;
    }
    if (wrap) wrap.classList.toggle("has-error", Boolean(msg));
    if (errorEl) errorEl.textContent = msg;
    field.setAttribute("aria-invalid", msg ? "true" : "false");
    return !msg;
  }

  $$("input[required], select[required]", form).forEach((field) => {
    field.addEventListener("blur", () => { if (field.value) validateField(field); });
    field.addEventListener("input", () => { if (field.closest(".field").classList.contains("has-error")) validateField(field); });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formStatus.textContent = "";

    const fields = $$("input[required], select[required]", form);
    const results = fields.map(validateField);
    if (results.includes(false)) {
      const firstInvalid = fields[results.indexOf(false)];
      firstInvalid.focus();
      return;
    }

    const data = Object.fromEntries(new FormData(form).entries());
    if (data.website) return; // honeypot triggered — silently drop
    delete data.website;

    const dateLabel = parseISODate(data.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    const timeLabel = timeSelect.options[timeSelect.selectedIndex].textContent;

    // No endpoint: never claim success. Explain that nothing was submitted and
    // offer a pre-filled email draft and the phone number instead.
    if (!bookingConnected) {
      showUnsent(data, dateLabel, timeLabel);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

    try {
      const res = await fetch(CONFIG.bookingEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...data, submittedAt: new Date().toISOString() }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);

      // Only reached when the server confirmed delivery (2xx response).
      $("#success-summary").textContent =
        `${data.name.trim().split(/\s+/)[0]}, we've received your request for a ${data.service.split(" — ")[0]} ` +
        `on ${dateLabel} at ${timeLabel}. We'll confirm shortly at ${data.email}.`;
      formView.hidden = true;
      successView.hidden = false;
      $(".modal-title", successView).focus();
      form.reset();
      populateTimes();
    } catch (err) {
      formStatus.textContent = err.name === "AbortError"
        ? `The booking service did not respond in time, so we can't confirm your request was received. Please call us at ${CONFIG.phoneDisplay} to confirm.`
        : `Your request could not be sent, so no booking has been made. Please try again or call us at ${CONFIG.phoneDisplay}.`;
    } finally {
      clearTimeout(timer);
      submitBtn.disabled = false;
      submitBtn.textContent = "Request Booking";
    }
  });

  function showUnsent(data, dateLabel, timeLabel) {
    const body = [
      `Name: ${data.name}`, `Phone: ${data.phone}`, `Email: ${data.email}`,
      `Service: ${data.service}`, `Barber: ${data.barber}`,
      `Date: ${dateLabel}`, `Time: ${timeLabel}`,
      data.notes ? `Notes: ${data.notes}` : "",
    ].filter(Boolean).join("\n");
    const subject = `Booking request — ${data.name} — ${dateLabel} ${timeLabel}`;
    $("#unsent-email").href =
      `mailto:${CONFIG.bookingEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    formView.hidden = true;
    unsentView.hidden = false;
    $(".modal-title", unsentView).focus();
  }

  // Return to the form with the visitor's entries intact.
  $("#unsent-back").addEventListener("click", () => {
    unsentView.hidden = true;
    formView.hidden = false;
    submitBtn.focus();
  });

  /* ---------- Gallery lightbox ---------- */
  const lightbox = $("#lightbox");
  const lbMedia = $(".lightbox-media", lightbox);
  const lbCaption = $(".lightbox-caption", lightbox);
  const lbCount = $(".lightbox-count", lightbox);
  const lbStatus = $("#lightbox-status");
  const galleryItems = $$(".gallery-item");
  const total = galleryItems.length;
  let lbIndex = 0;
  let lbLastFocus = null;

  // Give every tile a descriptive name, e.g. "Open image 2 of 8: Classic side part…".
  galleryItems.forEach((item, i) => {
    item.setAttribute("aria-haspopup", "dialog");
    item.setAttribute("aria-label", `Open image ${i + 1} of ${total}: ${item.dataset.caption || ""}`);
  });

  const showLightbox = (i) => {
    lbIndex = (i + total) % total;
    const item = galleryItems[lbIndex];
    const caption = item.dataset.caption || "";
    lbMedia.innerHTML = "";
    const img = $("img", item);
    if (img) {
      // Use a larger source when provided (data-full), otherwise reuse the tile's srcset.
      const full = new Image();
      full.alt = img.alt;
      full.decoding = "async";
      if (img.dataset.full) {
        full.src = img.dataset.full;
      } else {
        if (img.srcset) { full.srcset = img.srcset; full.sizes = "(max-width: 900px) 100vw, 900px"; }
        full.src = img.currentSrc || img.src;
      }
      lbMedia.appendChild(full);
    }
    lbCaption.textContent = caption;
    if (lbCount) lbCount.textContent = `${pad(lbIndex + 1)} / ${pad(total)}`;
    lbStatus.textContent = `Image ${lbIndex + 1} of ${total}: ${caption}`;
  };
  const openLightbox = (i) => {
    lbLastFocus = document.activeElement;
    showLightbox(i);
    lightbox.hidden = false;
    setInert([header, main, footer, fab], true);
    scrollLock.lock();
    $(".lightbox-close", lightbox).focus();
  };
  const closeLightbox = () => {
    if (lightbox.hidden) return;
    lightbox.hidden = true;
    lbStatus.textContent = "";
    setInert([header, main, footer, fab], false);
    scrollLock.unlock();
    if (lbLastFocus) lbLastFocus.focus();
  };

  galleryItems.forEach((item, i) => item.addEventListener("click", () => openLightbox(i)));
  $(".lightbox-close", lightbox).addEventListener("click", closeLightbox);
  $(".lightbox-nav.prev", lightbox).addEventListener("click", () => showLightbox(lbIndex - 1));
  $(".lightbox-nav.next", lightbox).addEventListener("click", () => showLightbox(lbIndex + 1));
  lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });
  lightbox.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") showLightbox(lbIndex - 1);
    else if (e.key === "ArrowRight") showLightbox(lbIndex + 1);
    else trapFocus(lightbox, e);
  });

  // Touch swipe: left → next, right → previous. Ignores vertical drags and pinch-zoom.
  const SWIPE_MIN = 50;
  let touchStart = null;
  lightbox.addEventListener("touchstart", (e) => {
    touchStart = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  lightbox.addEventListener("touchmove", (e) => { if (e.touches.length > 1) touchStart = null; }, { passive: true });
  lightbox.addEventListener("touchend", (e) => {
    if (!touchStart || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    showLightbox(lbIndex + (dx < 0 ? 1 : -1));
  }, { passive: true });
  lightbox.addEventListener("touchcancel", () => { touchStart = null; }, { passive: true });
})();
