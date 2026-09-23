"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Home as HomeIcon,
  Wallet,
  ArrowLeftRight,
  CalendarDays,
  ListChecks,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Menu,
  X,
  ShieldCheck,
} from "lucide-react";
import { AuthScreen } from "./auth-screen";
import { Home } from "./home";
import { Budget } from "./budget";
import { Tasks } from "./tasks";
import { Plan } from "./plan";
import { Transactions } from "./transactions";
import { Settings } from "./settings";
import { browserDb } from "@/lib/supabase/client";
import { defaults } from "@/lib/defaults";
import { previewAction, readSnapshot, writeAction } from "@/lib/store";
import { addMonths, monthLabel, monthOf, today } from "@/lib/finance";
import type { MemberRole, Snapshot } from "@/lib/types";
const navigation = [
  { name: "Home", icon: HomeIcon },
  { name: "Budget", icon: Wallet },
  { name: "Transactions", icon: ArrowLeftRight },
  { name: "Plan", icon: CalendarDays },
  { name: "Tasks", icon: ListChecks },
];
export function FinanceApp({
  configured,
  allowPreview,
}: {
  configured: boolean;
  allowPreview: boolean;
}) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [preview, setPreview] = useState(false);
  const [auth, setAuth] = useState<"loading" | "out" | "in">(
    configured ? "loading" : "out",
  );
  const [name, setName] = useState("Household");
  const [role, setRole] = useState<MemberRole>("viewer");
  const [tab, setTab] = useState("Home");
  const [transactionFilter, setTransactionFilter] = useState("all");
  const [month, setMonth] = useState(monthOf(today()));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [theme, setTheme] = useState("light");
  const [toast, setToast] = useState("");
  const dataRef = useRef(data);
  const loadVersion = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const value = await readSnapshot();
      if (version === loadVersion.current) {
        dataRef.current = value;
        setData(value);
        setError("");
      }
    } catch (e) {
      if (version === loadVersion.current) setError((e as Error).message);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const stored = localStorage.getItem("squires-theme") ?? "light";
    setTheme(stored);
    document.documentElement.dataset.theme = stored;
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  useEffect(() => {
    if (!configured) return;
    const db = browserDb();
    let active = true;
    let sequence = 0;
    const check = async () => {
      const own = ++sequence;
      const { data: user } = await db.auth.getUser();
      if (!active || own !== sequence) return;
      if (!user.user) {
        setAuth("out");
        setData(null);
        dataRef.current = null;
        return;
      }
      const member = await db
        .from("members")
        .select("name,role")
        .eq("id", user.user.id)
        .single();
      if (!active || own !== sequence) return;
      if (!member.data) {
        setError("This account is not approved for the Squires household.");
        setAuth("out");
        await db.auth.signOut();
        return;
      }
      setName(member.data.name);
      setRole(member.data.role as MemberRole);
      setAuth("in");
      await refresh();
    };
    void check();
    const { data: subscription } = db.auth.onAuthStateChange(() => {
      setTimeout(() => void check(), 0);
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [configured, refresh]);
  useEffect(() => {
    if (auth !== "in" || preview) return;
    const channel = browserDb()
      .channel("household")
      .on(
        "postgres_changes",
        { event: "*", schema: "public" },
        () => void refresh(),
      )
      .subscribe();
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => {
      void browserDb().removeChannel(channel);
      window.removeEventListener("focus", focus);
    };
  }, [auth, preview, refresh]);
  const save = async (action: string, payload: Record<string, unknown>) => {
    if (role === "viewer" && !preview)
      throw new Error("Read-only access cannot change household finances.");
    if (preview) {
      const next = previewAction(dataRef.current!, action, payload);
      dataRef.current = next;
      setData(next);
    } else {
      await writeAction(action, payload);
      await refresh();
    }
    setToast(preview ? "Saved in local preview" : "Saved");
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2500);
  };
  const navigate = (value: string, categoryId?: string) => {
    if (value === "Transactions") setTransactionFilter(categoryId ?? "all");
    setTab(value);
    setMobile(false);
    window.scrollTo({ top: 0 });
  };
  const logout = async () => {
    ++loadVersion.current;
    dataRef.current = null;
    setData(null);
    setPreview(false);
    setAuth("out");
    setError("");
    if (configured) await browserDb().auth.signOut();
  };
  if (auth === "loading")
    return (
      <div className="loading-screen">
        <RefreshCw className="spin" />
        <p>Opening your household...</p>
      </div>
    );
  if (auth === "out")
    return (
      <>
        <AuthScreen
          configured={configured}
          allowPreview={allowPreview}
          preview={() => {
            const initial = defaults();
            setPreview(true);
            setAuth("in");
            dataRef.current = initial;
            setData(initial);
            setName("Luke");
            setRole("admin");
          }}
        />
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
      </>
    );
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (mobile ? "mobile-open" : "")}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("Home");
          }}
        >
          <img src="/icons/icon-192.png" width="36" height="36" alt="" />
          <span>
            Squires<span className="brand-sub">FAMILY FINANCE</span>
          </span>
        </a>
        <button
          className="mobile-close icon-btn"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        >
          <X size={20} />
        </button>
        <nav>
          {navigation.map(({ name, icon: Icon }) => (
            <button
              className={tab === name ? "active" : ""}
              key={name}
              onClick={() => navigate(name)}
            >
              <Icon size={19} />
              <span>{name}</span>
              {name === "Tasks" && data && (
                <small>
                  {data.tasks.filter((t) => t.status === "Active").length}
                </small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="household-mark">
            <ShieldCheck size={16} />
            <span>Just our family.</span>
          </div>
          <button
            className={"profile " + (tab === "Settings" ? "active" : "")}
            onClick={() => navigate("Settings")}
          >
            <span className="avatar">{name[0]}</span>
            <span>
              <strong>{name}</strong>
              <small>Squires household</small>
            </span>
            <SettingsIcon size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="mobile-menu icon-btn"
            aria-label="Open navigation"
            onClick={() => setMobile(true)}
          >
            <Menu size={20} />
          </button>
          <span className="breadcrumb">
            Our household <span>/</span> <strong>{tab}</strong>
          </span>
          <div className="month-control">
            <button
              className="icon-btn"
              title="Previous month"
              aria-label="Previous month"
              onClick={() => setMonth(addMonths(month, -1))}
            >
              <ChevronLeft size={16} />
            </button>
            <span>{monthLabel(month)}</span>
            <button
              className="icon-btn"
              title="Next month"
              aria-label="Next month"
              onClick={() => setMonth(addMonths(month, 1))}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </header>
        {preview && (
          <div className="preview-banner">
            Local preview · changes last until you leave or reload. Bank
            connections are not active.
          </div>
        )}
        <main className="main-content">
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button className="text-btn" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}
          {!data ? (
            <div className="loading-screen">
              <RefreshCw className="spin" />
              <p>Loading household data...</p>
            </div>
          ) : (
            <>
              {tab === "Home" && (
                <Home
                  data={data}
                  role={role}
                  month={month}
                  navigate={navigate}
                  save={save}
                  onError={setError}
                />
              )}{" "}
              {tab === "Budget" && (
                <Budget data={data} month={month} save={save} />
              )}{" "}
              {tab === "Transactions" && (
                <Transactions data={data} save={save} initialFilter={transactionFilter} />
              )}{" "}
              {tab === "Tasks" && <Tasks data={data} save={save} />}{" "}
              {tab === "Plan" && <Plan data={data} save={save} />}{" "}
              {tab === "Settings" && (
                <Settings
                  data={data}
                  role={role}
                  preview={preview}
                  refresh={() => void refresh()}
                  signOut={() => void logout()}
                  theme={theme}
                  toggleTheme={() => {
                    const next = theme === "dark" ? "light" : "dark";
                    setTheme(next);
                    document.documentElement.dataset.theme = next;
                    localStorage.setItem("squires-theme", next);
                  }}
                />
              )}
            </>
          )}
          <footer className="page-footer">
            <span>SQUIRES FAMILY FINANCE</span>
            <span>
              {loading
                ? "Updating..."
                : preview
                  ? "Local preview"
                  : data?.accounts.length
                    ? "Bank updates may be delayed"
                    : "No bank accounts connected"}
            </span>
          </footer>
        </main>
      </div>
      <nav className="bottom-nav">
        {navigation.map(({ name, icon: Icon }) => (
          <button
            key={name}
            className={tab === name ? "active" : ""}
            onClick={() => navigate(name)}
          >
            <Icon size={20} />
            <span>{name}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
