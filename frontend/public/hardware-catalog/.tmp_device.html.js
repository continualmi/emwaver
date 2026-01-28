tailwind.config = {
        theme: {
          extend: {
            fontFamily: { sans: ["Inter", "sans-serif"] },
            colors: {
              brand: { 400: "#38bdf8", 500: "#0ea5e9", 600: "#0284c7" },
            },
          },
        },
      };
    


      const params = new URLSearchParams(window.location.search);
      const deviceId = params.get("id");

      function prettyTitle(text) {
        return String(text || "")
          .replace(/[_-]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      function safeUrl(url) {
        if (!url) return null;
        const s = String(url).trim();
        if (!s) return null;
        return s;
      }

      function pill(text, className) {
        return `<span class="inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold rounded-full border ${className}">${text}</span>`;
      }

      function statusPill(status) {
        if (status !== "module") return "";
        return pill("Module", "text-cyan-700 bg-cyan-50 border-cyan-200");
      }

      const ICONS = {
        android: "https://cdn-icons-png.flaticon.com/512/174/174836.png",
        ios: "https://icons.veryicon.com/png/o/application/skills-section/ios-1.png",
        desktop: "https://static.thenounproject.com/png/1982056-200.png",
        esp32: "https://www.mouser.com/Images/espressifsystems/lrg/ESP32-S3FH4R2_SPL.jpg",
        stm32: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQGA1dAJdCt6ImQBjINirfxm0lm7rqspmRK4g&s",
      };

      function iconImg(src, label, className) {
        return `<img src="${src}" alt="${label}" title="${label}" loading="lazy" referrerpolicy="no-referrer" class="${className}" onerror="this.onerror=null; this.style.display='none';" />`;
      }

      function groupBadge(group) {
        if (group === "esp32") {
          return `${iconImg(ICONS.esp32, "ESP32", "w-5 h-5 rounded object-cover border border-slate-200 bg-white")}<span class="font-semibold text-slate-900">ESP32</span>`;
        }
        if (group === "stm32") {
          return `${iconImg(ICONS.stm32, "STM32", "w-5 h-5 rounded object-cover border border-slate-200 bg-white")}<span class="font-semibold text-slate-900">STM32</span>`;
        }
        if (group === "module") {
          return `<span class="font-semibold text-slate-900">Module</span>`;
        }
        return `<span class="font-semibold text-slate-900">Other</span>`;
      }

      function deriveSupport(group, support) {
        const normalized = Array.isArray(support) ? support : null;
        return (
          normalized ||
          (group === "esp32"
            ? ["android", "ios", "desktop"]
            : group === "stm32" || group === "module"
              ? ["android", "desktop"]
              : [])
        );
      }

      function supportIcons(group, support) {
        const derived = deriveSupport(group, support);
        const map = {
          android: () => iconImg(ICONS.android, "Android", "w-4 h-4 object-contain opacity-90"),
          ios: () => iconImg(ICONS.ios, "iOS", "w-4 h-4 object-contain opacity-90"),
          desktop: () => iconImg(ICONS.desktop, "Desktop", "w-4 h-4 object-contain opacity-90"),
        };
        return derived.filter((x) => map[x]).map((x) => map[x]()).join("");
      }

      function actionButton(label, url, primary) {
        if (!url) {
          return `<button disabled class="px-4 py-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-400 text-sm font-medium cursor-not-allowed">${label}</button>`;
        }
        if (primary) {
          return `<a href="${url}" target="_blank" rel="noreferrer" class="px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold transition shadow-lg shadow-brand-500/10">${label}</a>`;
        }
        return `<a href="${url}" target="_blank" rel="noreferrer" class="px-4 py-2.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-sm font-medium transition">${label}</a>`;
      }

      function showError(message, detail) {
        const errorEl = document.getElementById("error");
        const isFileProtocol = window.location && window.location.protocol === "file:";
        errorEl.classList.remove("hidden");
        errorEl.innerHTML = `
          <div class="text-slate-900 font-semibold">${message}</div>
          <div class="text-slate-600 text-sm mt-2">${detail || ""}</div>
          ${
            isFileProtocol
              ? `<div class="text-slate-600 text-sm mt-2">
                   You’re opening this page via <code>file://</code>, which blocks <code>fetch()</code>.
                   Run a local server: <code>python3 -m http.server 8000</code> then open
                   <code>http://localhost:8000/device.html?id=EMWAVER_UNO_V4</code>.
                 </div>`
              : ""
          }
        `;
      }

      async function load() {
        if (!deviceId) {
          showError("Missing device id", "Use: device.html?id=EMWAVER_UNO_V4");
          return;
        }

        const res = await fetch(`hardware/${deviceId}/device.json`, { cache: "no-store" });
        if (!res.ok) throw new Error(`device.json not found for ${deviceId} (${res.status})`);
        const device = await res.json();

        const title = prettyTitle(device.displayTitle || device.title || deviceId);
        document.title = `${title} — EMWaver Hardware`;
        document.getElementById("crumb-title").textContent = title;
        document.getElementById("device-title").textContent = title;
        document.getElementById("device-description").textContent =
          device.description || "Description coming soon.";

        const group = device.group || null;
        document.getElementById("group-badge").innerHTML = groupBadge(group);
        document.getElementById("support-icons").innerHTML = supportIcons(group, device.appSupport);

        document.getElementById("status-pill").innerHTML = statusPill(device.status);
        document.getElementById("device-folder").textContent = `hardware/${deviceId}/`;

        const img = device.image
          ? String(device.image).includes("/")
            ? String(device.image)
            : `${deviceId}/${device.image}`
          : `${deviceId}/${deviceId}.png`;
        const imgEl = document.getElementById("device-image");
        imgEl.src = `hardware/${img}`;
        imgEl.alt = title;

        const oshwLabUrl = safeUrl(device.oshwLabUrl);
        const githubUrl = safeUrl(device.githubUrl);
        const schematicUrl = safeUrl(device.schematicUrl);

        document.getElementById("action-buttons").innerHTML = [
          actionButton("Open in OSHW Lab", oshwLabUrl, true),
          actionButton("GitHub files", githubUrl, false),
          actionButton("Schematic", schematicUrl, false),
        ].join("");

        const relationsEl = document.getElementById("relations");
        const parent = device.parent ? String(device.parent).trim() : "";
        if (parent) {
          relationsEl.classList.remove("hidden");
          relationsEl.innerHTML = `
            <div class="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
              <div class="text-xs text-slate-500">Requires</div>
              <a href="device.html?id=${encodeURIComponent(parent)}" class="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-brand-600 transition">
                ${prettyTitle(parent)}
                <span class="text-slate-400">→</span>
              </a>
            </div>
          `;
        }

        const tags = Array.isArray(device.tags) ? device.tags.slice(0, 8) : [];
        document.getElementById("tags").innerHTML = tags
          .map(
            (t) =>
              `<span class="text-xs px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700">${t}</span>`
          )
          .join("");

        document.getElementById("content").classList.remove("hidden");
      }

      load().catch((err) => showError("Couldn’t load device", String(err)));
