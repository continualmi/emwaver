tailwind.config = {
        theme: {
          extend: {
            fontFamily: {
              sans: ["Inter", "sans-serif"],
            },
            colors: {
              brand: {
                400: "#38bdf8", // sky-400
                500: "#0ea5e9", // sky-500
                600: "#0284c7", // sky-600
              },
            },
          },
        },
      };
    


      const MANIFEST_URL = "hardware/devices.json";
      const FEATURED_IDS = [
        "EMWAVER_UNO_V4",
        "GPIO_WAVER_V3",
        "USB_WAVER",
        "INFRARED_WAVER_V3",
        "ISM_WAVER_V2",
      ];

      const state = {
        devices: [],
      };

      const el = {
        listFeatured: document.getElementById("list-featured"),
      };

      function prettyTitle(folderOrTitle) {
        return String(folderOrTitle || "")
          .replace(/[_-]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      function pill(text, className) {
        return `<span class="inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold rounded-full border ${className}">${text}</span>`;
      }

      function modulePill(status) {
        if (status !== "module") return "";
        return `<span class="inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold rounded-full border text-cyan-700 bg-cyan-50 border-cyan-200">Module</span>`;
      }

      const ICONS = {
        android: "https://cdn-icons-png.flaticon.com/512/174/174836.png",
        ios: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTuBwquN0tazhKIHqb8QT2eW_6xUA0VRFSiXg&s",
        desktop: "https://cdn-icons-png.flaticon.com/512/3381/3381949.png",
      };

      function iconImg(src, label) {
        return `<img src="${src}" alt="${label}" title="${label}" loading="lazy" referrerpolicy="no-referrer" class="w-4 h-4 object-contain opacity-90" onerror="this.onerror=null; this.style.display='none';" />`;
      }

      function safeUrl(url) {
        if (!url) return null;
        const s = String(url).trim();
        if (!s) return null;
        return s;
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
          android: () => iconImg(ICONS.android, "Android"),
          ios: () => iconImg(ICONS.ios, "iOS"),
          desktop: () => iconImg(ICONS.desktop, "Desktop"),
        };
        return derived.filter((x) => map[x]).map((x) => map[x]()).join("");
      }

      function rowHtml(device) {
        const title = prettyTitle(device.displayTitle || device.title || device.folder);
        const description =
          device.description ||
          "Description coming soon. Add it in this device’s device.json.";

        const img = device.image
          ? String(device.image).includes("/")
            ? String(device.image)
            : `${device.folder}/${device.image}`
          : `${device.folder}/${device.folder}.png`;
        const group = device.group || "";
        const tags = Array.isArray(device.tags) ? device.tags.slice(0, 5) : [];

        return `
          <div class="rounded-2xl border border-slate-200 bg-white/80 hover:bg-white transition shadow-sm overflow-hidden">
            <a href="device.html?id=${encodeURIComponent(device.folder)}" class="block group">
              <div class="p-5 flex flex-col sm:flex-row gap-5">
                  <div class="sm:w-44 sm:shrink-0">
                    <div class="rounded-xl overflow-hidden border border-slate-200 bg-slate-50 aspect-[16/10]">
                      <img
                        src="hardware/${img}"
                        alt="${title}"
                        class="w-full h-full object-cover"
                        loading="lazy"
                        onerror="this.onerror=null; this.style.display='none';"
                      />
                    </div>
                  </div>

                  <div class="flex-1 min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      ${modulePill(device.status)}
                      <span class="text-slate-400 text-xs">→</span>
                      <span class="text-slate-500 text-xs">Open device page</span>
                    </div>

                    <h3 class="mt-3 text-lg font-bold text-slate-900 group-hover:text-brand-600 transition truncate">${title}</h3>
                    <p class="mt-2 text-sm text-slate-600 leading-relaxed">${description}</p>

                    <div class="mt-4 flex flex-wrap gap-2">
                      <div class="flex items-center gap-2">${supportIcons(group, device.appSupport)}</div>
                    </div>

                    ${
                      tags.length
                        ? `<div class="mt-4 flex flex-wrap gap-2">${tags
                            .map(
                              (t) =>
                                `<span class="text-xs px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700">${t}</span>`
                            )
                            .join("")}</div>`
                        : ""
                    }
                  </div>
              </div>
            </a>
          </div>
        `;
      }

      function render() {
        const byId = new Map(state.devices.map((d) => [d.folder, d]));
        const featured = FEATURED_IDS.map((id) => byId.get(id)).filter(Boolean);
        el.listFeatured.innerHTML = featured.map((d) => rowHtml(d)).join("");
      }

      async function loadDevices() {
        const res = await fetch(MANIFEST_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed manifest: ${res.status}`);
        const folders = await res.json();
        if (!Array.isArray(folders)) throw new Error("Manifest must be an array.");

        const reads = folders.map(async (folder) => {
          try {
            const r = await fetch(`hardware/${folder}/device.json`, { cache: "no-store" });
            const data = r.ok ? await r.json() : {};
            return { folder, ...data };
          } catch {
            return { folder, title: folder };
          }
        });

        const devices = await Promise.all(reads);
        state.devices = devices.filter((d) => d.group !== "module");
        render();
      }

      loadDevices().catch((err) => {
        const isFileProtocol = window.location && window.location.protocol === "file:";
        el.listFeatured.innerHTML = `
          <div class="md:col-span-2 xl:col-span-3 rounded-2xl border border-slate-200 bg-white/80 p-6">
            <div class="text-slate-900 font-semibold">Couldn’t load hardware list</div>
            <div class="text-slate-600 text-sm mt-2">
              Ensure <code>hardware/devices.json</code> exists and is valid JSON.
            </div>
            ${
              isFileProtocol
                ? `<div class="text-slate-600 text-sm mt-2">
                     You’re opening this page via <code>file://</code>, which blocks <code>fetch()</code>.
                     Run a local server instead: <code>python3 -m http.server 8000</code> then open
                     <code>http://localhost:8000/hardware.html</code>.
                   </div>`
                : ""
            }
            <div class="text-slate-500 text-xs mt-2">${String(err)}</div>
          </div>
        `;
      });