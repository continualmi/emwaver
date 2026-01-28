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
    


      const MANIFEST_URL = "hardware/devices.json";
      const ICONS = {
        android: "https://cdn-icons-png.flaticon.com/512/174/174836.png",
        ios: "https://icons.veryicon.com/png/o/application/skills-section/ios-1.png",
        desktop: "https://static.thenounproject.com/png/1982056-200.png",
        esp32: "https://www.mouser.com/Images/espressifsystems/lrg/ESP32-S3FH4R2_SPL.jpg",
        stm32: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQGA1dAJdCt6ImQBjINirfxm0lm7rqspmRK4g&s",
      };

      const el = {
        countPill: document.getElementById("count-pill"),
        countEsp32: document.getElementById("count-esp32"),
        countStm32: document.getElementById("count-stm32"),
        countModules: document.getElementById("count-modules"),
        listEsp32: document.getElementById("list-esp32"),
        listStm32: document.getElementById("list-stm32"),
        listModules: document.getElementById("list-modules"),
      };

      function prettyTitle(folderOrTitle) {
        return String(folderOrTitle || "")
          .replace(/[_-]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      function modulePill(status) {
        if (status !== "module") return "";
        return `<span class="inline-flex items-center gap-2 px-2.5 py-1 text-[11px] font-semibold rounded-full border text-cyan-700 bg-cyan-50 border-cyan-200">Module</span>`;
      }

      function iconImg(src, label, className) {
        return `<img src="${src}" alt="${label}" title="${label}" loading="lazy" referrerpolicy="no-referrer" class="${className}" onerror="this.onerror=null; this.style.display='none';" />`;
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

      function rowHtml(device, lookup) {
        const title = prettyTitle(device.displayTitle || device.title || device.folder);
        const group = device.group || "";
        const parent = device.parent ? String(device.parent).trim() : "";
        const parentTitle = parent && lookup[parent] ? prettyTitle(lookup[parent].displayTitle || lookup[parent].title || parent) : prettyTitle(parent);

        return `
          <div class="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition overflow-hidden">
            <a href="device.html?id=${encodeURIComponent(device.folder)}" class="block group">
              <div class="px-3 py-2.5">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-semibold text-slate-900 group-hover:text-brand-600 transition truncate">${title}</div>
                    <div class="mt-1 flex items-center gap-2 opacity-90">
                      <div class="flex items-center gap-2">${supportIcons(group, device.appSupport)}</div>
                    </div>
                    ${
                      parent
                        ? `<div class="text-[11px] text-slate-500 mt-1 truncate">Requires <span class="text-slate-700 font-semibold">${parentTitle}</span></div>`
                        : ""
                    }
                  </div>
                  <div class="shrink-0 flex items-center gap-2">
                    ${modulePill(device.status)}
                    <span class="text-slate-400 text-xs">→</span>
                  </div>
                </div>
              </div>
            </a>
          </div>
        `;
      }

      async function load() {
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
        const lookup = Object.fromEntries(devices.map((d) => [d.folder, d]));
        devices.sort((a, b) => prettyTitle(a.title || a.folder).localeCompare(prettyTitle(b.title || b.folder)));

        el.countPill.textContent = `${devices.length} entries`;

        const esp32 = devices.filter((d) => d.group === "esp32");
        const stm32 = devices.filter((d) => d.group === "stm32");
        const modules = devices.filter((d) => d.group === "module");

        el.countEsp32.textContent = `${esp32.length}`;
        el.countStm32.textContent = `${stm32.length}`;
        el.countModules.textContent = `${modules.length}`;

        el.listEsp32.innerHTML = esp32.map((d) => rowHtml(d, lookup)).join("");
        el.listStm32.innerHTML = stm32.map((d) => rowHtml(d, lookup)).join("");
        el.listModules.innerHTML = modules.map((d) => rowHtml(d, lookup)).join("");
      }

      load().catch((err) => {
        const isFileProtocol = window.location && window.location.protocol === "file:";
        const html = `
          <div class="rounded-2xl border border-slate-200 bg-white/80 p-6">
            <div class="text-slate-900 font-semibold">Couldn’t load catalog</div>
            <div class="text-slate-600 text-sm mt-2">
              Ensure <code>hardware/devices.json</code> exists and is valid JSON.
            </div>
            ${
              isFileProtocol
                ? `<div class="text-slate-600 text-sm mt-2">
                     You’re opening this page via <code>file://</code>, which blocks <code>fetch()</code>.
                     Run a local server: <code>python3 -m http.server 8000</code> then open
                     <code>http://localhost:8000/catalog.html</code>.
                   </div>`
                : ""
            }
            <div class="text-slate-500 text-xs mt-2">${String(err)}</div>
          </div>
        `;
        el.listEsp32.innerHTML = html;
        el.listStm32.innerHTML = "";
        el.listModules.innerHTML = "";
      });
