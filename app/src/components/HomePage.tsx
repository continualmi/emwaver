import type { FragmentType } from "../App";

type HomePageProps = {
  onNavigateToFragment: (fragment: FragmentType) => void;
};

export default function HomePage({ onNavigateToFragment }: HomePageProps) {
  const fragments = [
    {
      id: "wavelets" as FragmentType,
      name: "Wavelets",
      description: "Manage and run wavelet scripts",
      icon: <WaveletIcon />,
      borderClass: "hover:border-sky-500/60",
      iconClass: "text-sky-400",
    },
    {
      id: "ism" as FragmentType,
      name: "ISM (CC1101)",
      description: "Sub-GHz radio control and signal capture",
      icon: <ISMIcon />,
      borderClass: "hover:border-emerald-500/60",
      iconClass: "text-emerald-400",
    },
    {
      id: "sampler" as FragmentType,
      name: "Sampler",
      description: "Signal sampling and analysis",
      icon: <SamplerIcon />,
      borderClass: "hover:border-purple-500/60",
      iconClass: "text-purple-400",
    },
    {
      id: "git" as FragmentType,
      name: "Git",
      description: "GitHub repository sync for wavelets",
      icon: <GitIcon />,
      borderClass: "hover:border-indigo-500/60",
      iconClass: "text-indigo-400",
    },
  ];

  return (
    <section className="flex flex-1 flex-col bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-900 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">EMWaver</h2>
          <p className="text-sm text-slate-400">Main hardware control and device management</p>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
        {/* EMWaver Main Content */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6">
          <h3 className="text-sm font-semibold text-slate-100 mb-2">Device Status</h3>
          <p className="text-xs text-slate-400">
            Connect your EMWaver device to begin interacting with hardware.
          </p>
          <div className="mt-4 rounded-lg border border-dashed border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
            <p>EMWaver hardware control placeholder - to be implemented</p>
          </div>
        </div>

        {/* Quick Access to Fragments */}
        <div>
          <h3 className="text-sm font-semibold text-slate-100 mb-4">Quick Access</h3>
          <div className="grid grid-cols-2 gap-4">
            {fragments.map((fragment) => (
              <button
                key={fragment.id}
                onClick={() => onNavigateToFragment(fragment.id)}
                className={`group rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-left transition-all ${fragment.borderClass} hover:bg-slate-900 hover:shadow-lg`}
              >
                <div className="flex items-start gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 ${fragment.iconClass} transition-colors group-hover:bg-slate-800`}>
                    <span className="h-5 w-5">{fragment.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-slate-100 truncate">{fragment.name}</h4>
                    <p className="mt-1 text-xs text-slate-400 line-clamp-2">{fragment.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function WaveletIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
      <path
        d="M3 12c1.5-3 3.5-3 5 0s3.5 3 5 0 3.5-3 5 0"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 5c1 2 2.5 2 4 0s3-2 4 0 3 2 4 0"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="opacity-70"
      />
    </svg>
  );
}

function ISMIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <circle cx="7" cy="10" r="1.5" />
      <circle cx="13" cy="10" r="1.5" />
      <line x1="10" y1="4" x2="10" y2="16" />
    </svg>
  );
}

function SamplerIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
      <path d="M3 10h14M5 6l2 4-2 4M15 6l-2 4 2 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


function GitIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
      <circle cx="7" cy="7" r="2" />
      <circle cx="13" cy="13" r="2" />
      <path d="M9 7l2 6" strokeLinecap="round" />
    </svg>
  );
}
