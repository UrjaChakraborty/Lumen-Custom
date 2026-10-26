import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import Icon from "./Icon.jsx";

// ---- Toast -----------------------------------------------------------
//
// `toast("Saved")` is unchanged. `toast("Deleted X", { action: { label: "Undo",
// onAction } })` renders the same bar with a button in it.
//
// An action toast is not just a longer plain one. A control that disappears on
// a timer is unusable if you cannot reach it in time, so the action variant
// runs for ten seconds instead of 2.4, PAUSES while it is hovered or while
// anything inside it has focus, and carries an explicit dismiss so waiting is
// never the only way to get rid of it.
//
// Pausing on focus is not enough on its own, because the bar renders last in the
// document. A keyboard user who deleted something mid-page would have to tab
// through every remaining control to reach Undo, which is not happening inside
// ten seconds. So focus MOVES to the action when — and only when — the person
// was already driving by keyboard; the last input modality is tracked the same
// way :focus-visible decides whether to paint a ring. Someone who clicked Delete
// with a mouse is not interrupted. Focus returns to where it came from when the
// bar closes, so undoing does not dump you at the top of the page.
//
// The timer also moved off `window.__toastT`. That global was shared by every
// toast in the app, so an unrelated message firing a second later cancelled the
// pending one's timeout — which, once undo exists, silently cuts an undo window
// short.
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

const PLAIN_MS = 2400;
const ACTION_MS = 10000;

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(0);
  const endsAt = useRef(0);
  const remaining = useRef(0);
  const seq = useRef(0);

  const barRef = useRef(null);
  const actionRef = useRef(null);
  const returnTo = useRef(null);
  const modality = useRef("pointer");

  const stop = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = 0;
  }, []);

  // Hand focus back to whatever had it, but only if it is still inside the bar —
  // if the person has since clicked elsewhere, moving them is the rude thing.
  const releaseFocus = useCallback(() => {
    const el = returnTo.current;
    returnTo.current = null;
    if (!el) return;
    if (!barRef.current?.contains(document.activeElement)) return;
    if (document.contains(el)) el.focus();
  }, []);

  const close = useCallback(() => {
    releaseFocus();
    setToast(null);
  }, [releaseFocus]);

  const arm = useCallback(
    (ms) => {
      stop();
      endsAt.current = Date.now() + ms;
      remaining.current = ms;
      timer.current = window.setTimeout(() => {
        timer.current = 0;
        close();
      }, ms);
    },
    [stop, close]
  );

  const dismiss = useCallback(() => {
    stop();
    close();
  }, [stop, close]);

  const notify = useCallback(
    (text, options) => {
      const action = options?.action || null;
      returnTo.current = action ? document.activeElement : null;
      seq.current += 1;
      setToast({ id: seq.current, text, action });
      // `duration` is for messages that are longer than an acknowledgement and
      // must actually be read — a blocked send naming what it matched is not a
      // 2.4-second message.
      arm(options?.duration || (action ? ACTION_MS : PLAIN_MS));
    },
    [arm]
  );

  // Which input device is driving. Same signal :focus-visible uses, and the only
  // way to move focus for keyboard users without yanking it from mouse users.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Tab" || e.key === "Enter" || e.key === " ") modality.current = "keyboard";
    };
    const onPointer = () => {
      modality.current = "pointer";
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);

  useEffect(() => {
    if (toast?.action && modality.current === "keyboard") actionRef.current?.focus();
  }, [toast?.id, toast?.action]);

  // Clear on unmount so a pending timeout cannot call setState on a dead tree.
  useEffect(() => stop, [stop]);

  const pause = () => {
    if (!timer.current) return;
    remaining.current = Math.max(0, endsAt.current - Date.now());
    stop();
  };
  const resume = () => {
    if (timer.current || !toast?.action) return;
    arm(remaining.current || ACTION_MS);
  };

  const runAction = () => {
    const fn = toast?.action?.onAction;
    dismiss();
    fn?.();
  };

  return (
    <ToastCtx.Provider value={notify}>
      {children}
      {toast && (
        <div
          key={toast.id}
          ref={barRef}
          className={`toast${toast.action ? " toast--action" : ""}`}
          role="status"
          aria-live="polite"
          onPointerEnter={pause}
          onPointerLeave={resume}
          // React's onFocus/onBlur are focusin/focusout, so these fire for
          // anything inside the bar — the focus-within half of the pause.
          onFocus={pause}
          onBlur={resume}
        >
          <Icon name={toast.action ? "alert" : "check"} size="sm" />
          <span className="toast__text">{toast.text}</span>
          {toast.action && (
            <>
              <button
                type="button"
                ref={actionRef}
                className="toast__action"
                onClick={runAction}
              >
                {toast.action.label}
              </button>
              <button
                type="button"
                className="toast__dismiss"
                onClick={dismiss}
                aria-label="Dismiss"
              >
                <Icon name="plus" size="sm" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

// ---- Theme (CensusBot parity: light default, view-transition reveal) -
const THEME_KEY = "lumen-theme";

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function withThemeTransition(origin, mutate) {
  const root = document.documentElement;
  if (typeof document.startViewTransition !== "function" || prefersReducedMotion()) {
    mutate();
    return;
  }
  if (origin) {
    root.style.setProperty("--vt-x", `${origin.x}px`);
    root.style.setProperty("--vt-y", `${origin.y}px`);
  }
  root.classList.add("theme-reveal");
  const transition = document.startViewTransition(() => mutate());
  // An aborted transition — a second toggle interrupting the first, or the tab
  // being hidden mid-flight — rejects every promise the ViewTransition exposes,
  // not just `finished`. Any one left without a handler surfaces as an
  // unhandled rejection, so neutralise all three; aborting is routine here.
  transition.ready?.catch(() => {});
  transition.updateCallbackDone?.catch(() => {});
  transition.finished.catch(() => {}).finally(() => root.classList.remove("theme-reveal"));
}

export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      /* ignore */
    }
    return "light";
  });
  const themeRef = useRef(theme);

  useEffect(() => {
    const attr = document.documentElement.dataset.theme;
    if (attr === "light" || attr === "dark") {
      themeRef.current = attr;
      setThemeState(attr);
      return;
    }
    applyTheme(theme);
  }, []);

  const setTheme = useCallback((next, origin) => {
    themeRef.current = next;
    withThemeTransition(origin, () => {
      setThemeState(next);
      applyTheme(next);
    });
  }, []);

  const toggleTheme = useCallback((origin) => {
    const next = themeRef.current === "dark" ? "light" : "dark";
    themeRef.current = next;
    withThemeTransition(origin, () => {
      setThemeState(next);
      applyTheme(next);
    });
  }, []);

  const toggle = useCallback(() => toggleTheme(), [toggleTheme]);

  return { theme, setTheme, toggleTheme, toggle };
}

// ---- Scroll reveal ---------------------------------------------------
// Adds `is-visible` to `.reveal` elements as they enter the viewport.
export function useRevealOnScroll(dep) {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll(".reveal:not(.is-visible)"));
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [dep]);
}

// ---- Custom animated dropdown (accessible <select> replacement) ------
export function Dropdown({ id, value, options, onChange, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef(null);
  const selected = options.find((o) => o.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusBtn = () => ref.current?.querySelector(".dropdown__btn")?.focus();
  const choose = (opt) => {
    onChange(opt.value);
    setOpen(false);
    focusBtn();
  };

  const onKey = (e) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) setOpen(true);
        else setActive((a) => Math.min(options.length - 1, a + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        if (open) setActive((a) => Math.max(0, a - 1));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (open) choose(options[active]);
        else setOpen(true);
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          setActive(options.length - 1);
        }
        break;
      default:
        break;
    }
  };

  return (
    <div className={`dropdown${open ? " dropdown--open" : ""}`} ref={ref}>
      <button
        type="button"
        id={id}
        className="dropdown__btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
      >
        <span>{selected?.label}</span>
        <Icon name="chevronDown" size="sm" className="dropdown__chev" />
      </button>
      {open && (
        <ul
          className="dropdown__menu"
          role="listbox"
          aria-activedescendant={`${id}-opt-${active}`}
          tabIndex={-1}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`dropdown__opt${i === active ? " is-active" : ""}${
                o.value === value ? " is-selected" : ""
              }`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o);
              }}
            >
              <span>{o.label}</span>
              {o.value === value && <Icon name="check" size="sm" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- Contextual acronym tooltip -------------------------------------
const TERM_DEFS = {
  CRP: "Culturally Responsive Pedagogy",
  CRT: "Culturally Responsive Teaching",
  CSP: "Culturally Sustaining Pedagogy",
  UDL: "Universal Design for Learning",
  PBL: "Project-Based Learning",
};
export function Term({ children, term, definition }) {
  const key = term || (typeof children === "string" ? children.trim() : "");
  const def = definition || TERM_DEFS[key] || "";
  const tipRef = useRef(null);

  // The tip is centred on the term, so a term near a screen edge would push it
  // past the viewport where an ancestor's overflow clip cuts the text off.
  // Nudge it back inside on reveal; CSS alone can't measure the distance.
  const clampToViewport = () => {
    const tip = tipRef.current;
    if (!tip) return;
    tip.style.marginLeft = "0px";
    const r = tip.getBoundingClientRect();
    const pad = 8;
    const over = r.right - (document.documentElement.clientWidth - pad);
    const under = pad - r.left;
    if (over > 0) tip.style.marginLeft = `${-over}px`;
    else if (under > 0) tip.style.marginLeft = `${under}px`;
  };

  if (!def) return <>{children}</>;
  return (
    <span
      className="term"
      tabIndex={0}
      aria-label={`${key}: ${def}`}
      onPointerEnter={clampToViewport}
      onFocus={clampToViewport}
    >
      {children}
      <span className="term__tip" role="tooltip" ref={tipRef}>
        {def}
      </span>
    </span>
  );
}

// ---- Accordion (smooth expand/collapse) -----------------------------
export function Accordion({ items, allowMultiple = false, defaultOpen = [] }) {
  const [open, setOpen] = useState(() => new Set(defaultOpen));
  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(allowMultiple ? prev : []);
      if (prev.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="accordion">
      {items.map((it) => {
        const isOpen = open.has(it.id);
        return (
          <div className={`acc-item${isOpen ? " is-open" : ""}`} key={it.id}>
            <button
              type="button"
              className="acc-head"
              aria-expanded={isOpen}
              onClick={() => toggle(it.id)}
            >
              <span className="acc-head__title">
                {it.icon && (
                  <span className="acc-head__icon">
                    <Icon name={it.icon} size="sm" />
                  </span>
                )}
                <span>{it.title}</span>
              </span>
              <Icon name="chevronDown" size="sm" className="acc-head__chev" />
            </button>
            <div className="acc-body" role="region">
              <div className="acc-body__inner">{it.content}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Small building blocks ------------------------------------------
export function Badge({ children, variant }) {
  return <span className={`badge${variant ? ` badge--${variant}` : ""}`}>{children}</span>;
}

export function SectionHead({ eyebrow, title, children }) {
  return (
    <div className="section-head">
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h2>{title}</h2>
      {children && (
        <p className="muted" style={{ maxWidth: "68ch", margin: "6px 0 0" }}>
          {children}
        </p>
      )}
    </div>
  );
}

export function Guardrail({ children }) {
  return (
    <div className="guardrail" role="note">
      <Icon name="alert" size="sm" style={{ marginTop: 2 }} />
      <div>{children}</div>
    </div>
  );
}

function execCommandCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    // Keep it off-screen but selectable; readOnly stops the mobile keyboard.
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const okay = document.execCommand("copy");
    document.body.removeChild(ta);
    return okay;
  } catch {
    return false;
  }
}

/**
 * Copies `text`, resolving to true on success and false on failure.
 *
 * navigator.clipboard.writeText rejects on a non-secure origin, when the
 * document isn't focused, or when the permission is denied. That rejection used
 * to escape to the console and callers still announced success, so a failed
 * copy looked identical to a successful one. Fall back to execCommand and
 * report the outcome instead.
 */
export async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return execCommandCopy(text);
    }
  }
  return execCommandCopy(text);
}

export function download(filename, text, type = "text/markdown") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
